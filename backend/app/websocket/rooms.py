"""In-memory meeting rooms for WebRTC signaling (single backend process).

The server only relays offers/answers/ICE candidates between the peers of one meeting; audio, video
and data-channel traffic go browser-to-browser and never pass through here.
"""

import asyncio
import uuid
from dataclasses import dataclass, field

from fastapi import WebSocket


@dataclass
class Peer:
    id: str
    name: str
    ws: WebSocket
    participant_id: uuid.UUID | None = None


@dataclass
class Room:
    code: str
    peers: dict[str, Peer] = field(default_factory=dict)


class RoomFull(Exception):
    pass


class Rooms:
    def __init__(self) -> None:
        self._rooms: dict[str, Room] = {}
        self._lock = asyncio.Lock()

    async def join(self, code: str, name: str, ws: WebSocket, capacity: int) -> tuple[Peer, list[Peer]]:
        """Add a peer; returns it and the peers already present."""
        async with self._lock:
            room = self._rooms.setdefault(code, Room(code))
            if len(room.peers) >= capacity:
                raise RoomFull
            peer = Peer(id=uuid.uuid4().hex[:12], name=name, ws=ws)
            others = list(room.peers.values())
            room.peers[peer.id] = peer
            return peer, others

    async def leave(self, code: str, peer_id: str) -> list[Peer]:
        """Remove a peer; returns the peers still in the room."""
        async with self._lock:
            room = self._rooms.get(code)
            if room is None:
                return []
            room.peers.pop(peer_id, None)
            if not room.peers:
                del self._rooms[code]
                return []
            return list(room.peers.values())

    def get(self, code: str, peer_id: str) -> Peer | None:
        room = self._rooms.get(code)
        return room.peers.get(peer_id) if room else None

    def peers(self, code: str) -> list[Peer]:
        room = self._rooms.get(code)
        return list(room.peers.values()) if room else []

    def size(self, code: str) -> int:
        room = self._rooms.get(code)
        return len(room.peers) if room else 0


rooms = Rooms()
