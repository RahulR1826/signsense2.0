import { API_URL } from "@/lib/api";
import { EXTRACTOR_VERSION, type LandmarkFrame } from "@/lib/landmarks/schema";

export interface Sign {
  id: string;
  label: string;
  category: string;
}

export interface DatasetSummary {
  total: number;
  counts: Record<string, Record<string, number>>;
}

export interface SavedSample {
  id: string;
  sign: string;
  signer: string;
}

export const NO_SIGN = "no_sign";
export const SIGNER_PATTERN = /^[a-z0-9_-]{1,32}$/;

export function toSignerId(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_-]/g, "").slice(0, 32);
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res.json() as Promise<T>;
}

export const fetchVocabulary = () => fetch(`${API_URL}/api/dataset/vocabulary`).then((r) => json<Sign[]>(r));

export const fetchSummary = () =>
  fetch(`${API_URL}/api/dataset/summary`, { cache: "no-store" }).then((r) => json<DatasetSummary>(r));

export const saveSample = (
  sign: string,
  signer: string,
  durationMs: number,
  frames: LandmarkFrame[],
  size: { width: number; height: number } | null,
) =>
  fetch(`${API_URL}/api/dataset/samples`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sign, signer, durationMs, frames, ...size, extractorVersion: EXTRACTOR_VERSION }),
  }).then((r) => json<SavedSample>(r));

export async function deleteSample(s: SavedSample): Promise<void> {
  const res = await fetch(`${API_URL}/api/dataset/samples/${s.sign}/${s.signer}/${s.id}`, { method: "DELETE" });
  if (!res.ok) throw new Error(`${res.status}`);
}

/** Returns a reason the take should be rejected, or null if it looks usable. */
export function checkTake(sign: string, frames: LandmarkFrame[]): string | null {
  if (frames.length < 15) return "Too few frames captured — is the camera running smoothly?";
  const share = (pred: (f: LandmarkFrame) => boolean) => frames.filter(pred).length / frames.length;
  if (share((f) => f.pose !== null) < 0.7) return "Your upper body wasn't visible — step back so shoulders and hands are in frame.";
  if (sign !== NO_SIGN && share((f) => f.leftHand !== null || f.rightHand !== null) < 0.4)
    return "Hands weren't visible for most of the take.";
  return null;
}
