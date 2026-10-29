import { API_URL } from "@/lib/api";

export interface PeerInfo {
  peerId: string;
  name: string;
}

export type ServerMessage =
  | { type: "welcome"; peerId: string; name: string; peers: PeerInfo[]; iceServers: RTCIceServer[] }
  | { type: "peer-joined"; peer: PeerInfo }
  | { type: "peer-left"; peerId: string }
  | { type: "signal"; from: string; data: SignalData }
  | { type: "pong" }
  | { type: "error"; code: string };

export type SignalData = { sdp: RTCSessionDescriptionInit } | { candidate: RTCIceCandidateInit };

export function signalingUrl(code: string): string {
  const base = API_URL.replace(/^http/, "ws");
  return `${base}/ws/meetings/${encodeURIComponent(code)}`;
}

/** Thin WebSocket wrapper for the signaling server (media never goes through it). */
export class SignalingClient {
  private ws: WebSocket;
  private pingTimer: ReturnType<typeof setInterval> | undefined;

  constructor(
    url: string,
    /** Display name, sent as the first message (kept out of the URL so it isn't written to access logs). */
    name: string,
    onMessage: (msg: ServerMessage) => void,
    onClose: (code: number) => void,
  ) {
    this.ws = new WebSocket(url);
    this.ws.onopen = () => this.send({ type: "hello", name });
    this.ws.onmessage = (e) => {
      try {
        onMessage(JSON.parse(e.data) as ServerMessage);
      } catch {
        // ignore malformed server messages
      }
    };
    this.ws.onclose = (e) => {
      clearInterval(this.pingTimer);
      onClose(e.code);
    };
    // Keep idle connections alive through proxies / NAT timeouts.
    this.pingTimer = setInterval(() => this.send({ type: "ping" }), 25_000);
  }

  send(msg: Record<string, unknown>) {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  signal(to: string, data: SignalData) {
    this.send({ type: "signal", to, data });
  }

  close() {
    clearInterval(this.pingTimer);
    if (this.ws.readyState === WebSocket.OPEN) this.send({ type: "leave" });
    this.ws.close();
  }
}
