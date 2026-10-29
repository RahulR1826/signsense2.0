// Application messages sent peer-to-peer over the WebRTC data channel ("app").
// Everything received is untrusted: parseMessage() validates shape and length before use, and the UI
// only ever renders these strings as text (never as HTML).

export type CommunicationRole = "signer" | "non_signer" | "both";

export type AppMessage =
  /** Who I am and how I communicate — sent when the channel opens and whenever it changes. */
  | { type: "hello"; name: string; mode: CommunicationRole; micOn: boolean; camOn: boolean }
  /** A typed message. */
  | { type: "chat"; id: string; text: string; at: number }
  /** Live speech-to-text of the sender's voice. Interim captions are replaced until `final`. */
  | { type: "caption"; id: string; text: string; final: boolean; at: number }
  /**
   * A recognised sign. `via`: "auto" = the model was confident and the signer let the countdown run (or
   * tapped Send now); "chosen" = the model was unsure and the signer picked the sign themself. For
   * "chosen", `confidence` is the model's score for that pick, not a measure of correctness.
   */
  | { type: "sign"; id: string; gloss: string[]; text: string; confidence: number; at: number; via: SignVia };

export type SignVia = "auto" | "chosen";

const MAX_TEXT = 500;
const MODES = new Set(["signer", "non_signer", "both"]);

const isStr = (v: unknown, max = MAX_TEXT): v is string => typeof v === "string" && v.length <= max;
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

export function parseMessage(raw: unknown): AppMessage | null {
  if (typeof raw !== "object" || raw === null) return null;
  const m = raw as Record<string, unknown>;
  switch (m.type) {
    case "hello":
      return isStr(m.name, 80) && typeof m.mode === "string" && MODES.has(m.mode) && typeof m.micOn === "boolean" && typeof m.camOn === "boolean"
        ? { type: "hello", name: m.name, mode: m.mode as CommunicationRole, micOn: m.micOn, camOn: m.camOn }
        : null;
    case "chat":
      return isStr(m.id, 64) && isStr(m.text) && m.text.trim() && isNum(m.at)
        ? { type: "chat", id: m.id, text: m.text, at: m.at }
        : null;
    case "caption":
      return isStr(m.id, 64) && isStr(m.text) && typeof m.final === "boolean" && isNum(m.at)
        ? { type: "caption", id: m.id, text: m.text, final: m.final, at: m.at }
        : null;
    case "sign":
      return isStr(m.id, 64) &&
        Array.isArray(m.gloss) &&
        m.gloss.length <= 20 &&
        m.gloss.every((g) => isStr(g, 40)) &&
        isStr(m.text) &&
        isNum(m.confidence) &&
        m.confidence >= 0 &&
        m.confidence <= 1 &&
        m.text.trim() &&
        isNum(m.at) &&
        (m.via === undefined || m.via === "auto" || m.via === "chosen")
        ? { type: "sign", id: m.id, gloss: m.gloss as string[], text: m.text, confidence: m.confidence, at: m.at, via: (m.via as SignVia) ?? "auto" }
        : null;
    default:
      return null;
  }
}

export const newId = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
