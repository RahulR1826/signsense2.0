"""WebSocket signaling for 1:1 WebRTC calls.

Client -> server: first {"type": "hello", "name": str} (the display name; not in the URL, so it stays out of
access logs), then {"type": "signal", "to": peerId, "data": {...}} | {"type": "leave"} | {"type": "ping"}
Server -> client: welcome | peer-joined | peer-left | signal | pong | error
`data` is relayed untouched (SDP offer/answer or ICE candidate); the server never inspects media.
"""

import asyncio
import json
import time
from datetime import UTC, datetime

from fastapi import APIRouter, WebSocket, WebSocketDisconnect, status

from app.core.config import origin_allowed, settings
from app.core.database import SessionLocal
from app.core.security import read_session_token, turn_credentials, ws_join_limiter
from app.models import MeetingStatus, Participant, User
from app.services.meetings import end_meeting, get_meeting, is_stale, normalize_code
from app.websocket.rooms import Peer, RoomFull, rooms

router = APIRouter(tags=["signaling"])

MAX_MESSAGE_BYTES = 64 * 1024
MAX_MESSAGES_PER_10S = 300  # an ICE gathering burst is a few dozen messages
# Clients ping every 25 s; silence this long means the socket is dead (sleep, lost network) -> free the seat.
IDLE_TIMEOUT_S = 70
HELLO_TIMEOUT_S = 10
MAX_NAME = 80


def ice_servers(peer_id: str) -> list[dict]:
    servers = list(settings.ice_servers)
    if settings.turn_urls and settings.turn_secret:
        username, credential = turn_credentials(peer_id, settings.turn_secret, settings.turn_ttl_s)
        servers.append({"urls": settings.turn_urls, "username": username, "credential": credential})
    return servers


async def _read_hello(ws: WebSocket) -> str | None:
    """The client's first message carries its display name. None if it doesn't arrive in time or is malformed."""
    try:
        msg = json.loads(await asyncio.wait_for(ws.receive_text(), HELLO_TIMEOUT_S))
    except (TimeoutError, json.JSONDecodeError, WebSocketDisconnect):
        return None
    if not isinstance(msg, dict) or msg.get("type") != "hello" or not isinstance(msg.get("name", ""), str):
        return None
    return msg.get("name", "").strip()[:MAX_NAME]


async def _send(ws: WebSocket, message: dict) -> None:
    try:
        await ws.send_text(json.dumps(message))
    except Exception:  # peer already gone; its own handler cleans up
        pass


async def _reject(ws: WebSocket, code: str, close_code: int) -> None:
    await ws.accept()
    await _send(ws, {"type": "error", "code": code})
    await ws.close(code=close_code)


@router.websocket("/ws/meetings/{code}")
async def signaling(ws: WebSocket, code: str) -> None:
    # Browsers always send Origin on WebSocket upgrades; refuse other sites (cross-site WebSocket hijacking).
    if not origin_allowed(ws.headers.get("origin")):
        await ws.close(code=status.WS_1008_POLICY_VIOLATION)
        return
    if not ws_join_limiter.hit(ws.client.host if ws.client else "unknown"):
        return await _reject(ws, "rate_limited", 4429)

    normalized = normalize_code(code)
    async with SessionLocal() as session:
        found = await get_meeting(session, normalized) if normalized else None
        if found is not None and is_stale(found[0], rooms.size(found[0].code)):
            await end_meeting(session, found[0])
        token = ws.cookies.get(settings.session_cookie)
        user_id = read_session_token(token) if token else None
        user = await session.get(User, user_id) if user_id else None

    if found is None:
        return await _reject(ws, "not_found", 4404)
    meeting, _host = found
    if meeting.status == MeetingStatus.ended:
        return await _reject(ws, "meeting_ended", 4410)

    await ws.accept()
    name = await _read_hello(ws)
    if name is None:
        await _send(ws, {"type": "error", "code": "bad_message"})
        await ws.close(code=status.WS_1008_POLICY_VIOLATION)
        return
    display_name = (user.name if user else name) or "Guest"
    try:
        peer, others = await rooms.join(meeting.code, display_name, ws, settings.max_participants)
    except RoomFull:
        await _send(ws, {"type": "error", "code": "room_full"})
        await ws.close(code=4409)
        return

    async with SessionLocal() as session:
        participant = Participant(meeting_id=meeting.id, user_id=user.id if user else None, display_name=display_name)
        session.add(participant)
        await session.commit()
        peer.participant_id = participant.id

    await _send(ws, {
        "type": "welcome",
        "peerId": peer.id,
        "name": display_name,
        "peers": [{"peerId": p.id, "name": p.name} for p in others],
        "iceServers": ice_servers(peer.id),
    })
    for other in others:
        await _send(other.ws, {"type": "peer-joined", "peer": {"peerId": peer.id, "name": display_name}})

    try:
        await _relay(ws, meeting.code, peer)
    except WebSocketDisconnect:
        pass
    finally:
        remaining = await rooms.leave(meeting.code, peer.id)
        for other in remaining:
            await _send(other.ws, {"type": "peer-left", "peerId": peer.id})
        async with SessionLocal() as session:
            row = await session.get(Participant, peer.participant_id)
            if row is not None:
                row.left_at = datetime.now(UTC)
                await session.commit()


async def close_meeting(code: str) -> None:
    """The host ended the meeting: tell everyone still connected and disconnect them."""
    for peer in rooms.peers(code):
        await _send(peer.ws, {"type": "error", "code": "meeting_ended"})
        try:
            await peer.ws.close(code=4410)
        except Exception:
            pass


async def _relay(ws: WebSocket, code: str, peer: Peer) -> None:
    window_start, count = time.monotonic(), 0
    while True:
        try:
            raw = await asyncio.wait_for(ws.receive_text(), IDLE_TIMEOUT_S)
        except TimeoutError:
            await ws.close(code=4408)
            return
        now = time.monotonic()
        if now - window_start > 10:
            window_start, count = now, 0
        count += 1
        if count > MAX_MESSAGES_PER_10S:
            await _send(ws, {"type": "error", "code": "rate_limited"})
            await ws.close(code=4429)
            return
        if len(raw) > MAX_MESSAGE_BYTES:
            await _send(ws, {"type": "error", "code": "too_large"})
            continue
        try:
            msg = json.loads(raw)
        except json.JSONDecodeError:
            await _send(ws, {"type": "error", "code": "bad_message"})
            continue
        kind = msg.get("type") if isinstance(msg, dict) else None

        if kind == "signal" and isinstance(msg.get("to"), str) and isinstance(msg.get("data"), dict):
            target = rooms.get(code, msg["to"])
            if target is None:
                await _send(ws, {"type": "error", "code": "unknown_peer"})
            else:
                await _send(target.ws, {"type": "signal", "from": peer.id, "data": msg["data"]})
        elif kind == "ping":
            await _send(ws, {"type": "pong"})
        elif kind == "leave":
            await ws.close()
            return
        else:
            await _send(ws, {"type": "error", "code": "bad_message"})
