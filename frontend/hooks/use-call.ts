"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { SignalingClient, signalingUrl, type PeerInfo, type ServerMessage, type SignalData } from "@/lib/call/signaling";

export type CallStatus = "connecting" | "waiting" | "connected" | "reconnecting" | "ended" | "error";

export interface RemotePeer {
  peerId: string;
  name: string;
  stream: MediaStream | null;
}

// Server close codes that mean "don't retry" (see backend/app/api/signaling.py).
const FATAL_CLOSE = new Set([1008, 4404, 4409, 4410, 4429]);

const ERROR_TEXT: Record<string, string> = {
  not_found: "This meeting doesn't exist.",
  meeting_ended: "This meeting has ended.",
  room_full: "This call already has two people.",
  rate_limited: "Too many messages — the connection was closed.",
};

/**
 * One 1:1 WebRTC call. The newcomer makes the offer; the person already waiting answers.
 * Audio/video and the "app" data channel go peer-to-peer; the server only relays signaling.
 */
export function useCall(code: string, name: string, localStream: MediaStream | null, enabled: boolean) {
  const [status, setStatus] = useState<CallStatus>("connecting");
  const [error, setError] = useState<string | null>(null);
  const [remote, setRemote] = useState<RemotePeer | null>(null);
  const [channelOpen, setChannelOpen] = useState(false);

  const signaling = useRef<SignalingClient | null>(null);
  const pc = useRef<RTCPeerConnection | null>(null);
  const channel = useRef<RTCDataChannel | null>(null);
  const remoteId = useRef<string | null>(null);
  const names = useRef(new Map<string, string>());
  const iceServers = useRef<RTCIceServer[]>([]);
  const pendingCandidates = useRef<RTCIceCandidateInit[]>([]);
  const offerer = useRef(false);
  const dataListeners = useRef(new Set<(data: unknown) => void>());
  const left = useRef(false);

  const attachChannel = useCallback((dc: RTCDataChannel) => {
    channel.current = dc;
    dc.onopen = () => setChannelOpen(true);
    dc.onclose = () => setChannelOpen(false);
    dc.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        dataListeners.current.forEach((l) => l(data));
      } catch {}
    };
  }, []);

  const closePeer = useCallback(() => {
    channel.current?.close();
    channel.current = null;
    pc.current?.close();
    pc.current = null;
    remoteId.current = null;
    pendingCandidates.current = [];
    setChannelOpen(false);
    setRemote(null);
  }, []);

  const sendOffer = useCallback(async (iceRestart = false) => {
    const conn = pc.current;
    const to = remoteId.current;
    if (!conn || !to) return;
    const offer = await conn.createOffer({ iceRestart });
    await conn.setLocalDescription(offer);
    signaling.current?.signal(to, { sdp: conn.localDescription!.toJSON() });
  }, []);

  const startPeer = useCallback(
    async (peer: PeerInfo, asOfferer: boolean) => {
      closePeer();
      offerer.current = asOfferer;
      remoteId.current = peer.peerId;
      setRemote({ peerId: peer.peerId, name: peer.name, stream: null });

      const conn = new RTCPeerConnection({ iceServers: iceServers.current });
      pc.current = conn;

      if (localStream) {
        for (const track of localStream.getTracks()) {
          const sender = conn.addTrack(track, localStream);
          if (track.kind === "video") {
            // Signing needs smooth motion: drop resolution before frame rate when bandwidth is tight.
            const params = sender.getParameters();
            params.degradationPreference = "maintain-framerate";
            sender.setParameters(params).catch(() => undefined);
          }
        }
      }
      if (asOfferer && (!localStream || localStream.getAudioTracks().length === 0)) {
        conn.addTransceiver("audio", { direction: "recvonly" });
      }
      if (asOfferer && (!localStream || localStream.getVideoTracks().length === 0)) {
        conn.addTransceiver("video", { direction: "recvonly" });
      }

      conn.ontrack = (e) => {
        const stream = e.streams[0] ?? new MediaStream([e.track]);
        setRemote((r) => (r && r.peerId === peer.peerId ? { ...r, stream } : r));
      };
      conn.onicecandidate = (e) => {
        if (e.candidate) signaling.current?.signal(peer.peerId, { candidate: e.candidate.toJSON() });
      };
      conn.onconnectionstatechange = () => {
        if (pc.current !== conn) return;
        const s = conn.connectionState;
        if (s === "connected") setStatus("connected");
        else if (s === "disconnected") setStatus("reconnecting");
        else if (s === "failed") {
          setStatus("reconnecting");
          if (offerer.current) sendOffer(true).catch(() => undefined); // ICE restart
        }
      };

      if (asOfferer) {
        attachChannel(conn.createDataChannel("app", { ordered: true }));
        await sendOffer();
      } else {
        conn.ondatachannel = (e) => attachChannel(e.channel);
      }
    },
    [attachChannel, closePeer, localStream, sendOffer],
  );

  const handleSignal = useCallback(
    async (from: string, data: SignalData) => {
      if (!pc.current || remoteId.current !== from) {
        await startPeer({ peerId: from, name: names.current.get(from) ?? "Guest" }, false);
      }
      const conn = pc.current!;
      if ("sdp" in data) {
        await conn.setRemoteDescription(data.sdp);
        if (data.sdp.type === "offer") {
          const answer = await conn.createAnswer();
          await conn.setLocalDescription(answer);
          signaling.current?.signal(from, { sdp: conn.localDescription!.toJSON() });
        }
        for (const c of pendingCandidates.current.splice(0)) await conn.addIceCandidate(c).catch(() => undefined);
      } else if ("candidate" in data) {
        if (conn.remoteDescription) await conn.addIceCandidate(data.candidate).catch(() => undefined);
        else pendingCandidates.current.push(data.candidate);
      }
    },
    [startPeer],
  );

  useEffect(() => {
    if (!enabled) return;
    left.current = false;

    const onMessage = (msg: ServerMessage) => {
      switch (msg.type) {
        case "welcome":
          iceServers.current = msg.iceServers;
          msg.peers.forEach((p) => names.current.set(p.peerId, p.name));
          if (msg.peers.length > 0) {
            setStatus("connecting");
            startPeer(msg.peers[0], true).catch(() => setStatus("error"));
          } else {
            setStatus("waiting");
          }
          break;
        case "peer-joined":
          names.current.set(msg.peer.peerId, msg.peer.name);
          setRemote({ ...msg.peer, stream: null });
          setStatus("connecting");
          break;
        case "signal":
          handleSignal(msg.from, msg.data).catch((err) => console.error("signal failed", err));
          break;
        case "peer-left":
          if (msg.peerId === remoteId.current || remoteId.current === null) {
            closePeer();
            setStatus("waiting");
          }
          break;
        case "error":
          setError(ERROR_TEXT[msg.code] ?? `Connection error (${msg.code}).`);
          if (msg.code !== "unknown_peer") setStatus("error");
          break;
      }
    };

    // The signaling socket can drop (Wi-Fi switch, laptop sleep, server restart). Reconnect with
    // backoff; on rejoin the server's welcome lists the other person and we re-offer to them.
    let attempt = 0;
    let joinedBefore = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    const connect = () => {
      const client = new SignalingClient(
        signalingUrl(code),
        name,
        (msg) => {
          if (msg.type === "welcome") {
            attempt = 0;
            joinedBefore = true;
            setError(null);
          }
          onMessage(msg);
        },
        (closeCode) => {
          if (left.current || signaling.current !== client) return;
          signaling.current = null;
          // After a drop the server may still hold our old socket for a moment: "room full" is then temporary.
          if (FATAL_CLOSE.has(closeCode) && !(joinedBefore && closeCode === 4409)) {
            setStatus("error");
            setError((e) => e ?? "The server closed the connection.");
            return;
          }
          setStatus("reconnecting");
          const delay = Math.min(10_000, 1000 * 2 ** attempt++);
          retryTimer = setTimeout(connect, delay);
        },
      );
      signaling.current = client;
    };
    connect();

    return () => {
      left.current = true;
      clearTimeout(retryTimer);
      signaling.current?.close();
      signaling.current = null;
      closePeer();
    };
  }, [code, name, enabled, startPeer, handleSignal, closePeer]);

  const leave = useCallback(() => {
    left.current = true;
    signaling.current?.close();
    signaling.current = null;
    closePeer();
    setStatus("ended");
  }, [closePeer]);

  /** Send an application message (chat, sign translation, …) over the data channel. */
  const send = useCallback((data: unknown) => {
    const dc = channel.current;
    if (dc?.readyState !== "open") return false;
    dc.send(JSON.stringify(data));
    return true;
  }, []);

  const onData = useCallback((listener: (data: unknown) => void) => {
    dataListeners.current.add(listener);
    return () => {
      dataListeners.current.delete(listener);
    };
  }, []);

  return { status, error, remote, channelOpen, leave, send, onData };
}
