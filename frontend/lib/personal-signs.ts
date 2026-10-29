import { api } from "@/lib/auth";
import type { LandmarkFrame } from "@/lib/landmarks/schema";

export interface PersonalSample {
  aspect: number;
  extractor_version: string;
  frames: LandmarkFrame[];
}

export interface PersonalSign {
  id: string;
  label: string;
  emoji: string | null;
  created_at: string;
  samples: PersonalSample[];
}

export const listPersonalSigns = () => api<PersonalSign[]>("/api/personal-signs");

export const createPersonalSign = (body: {
  label: string;
  emoji: string | null;
  extractorVersion: string;
  samples: { aspect: number; frames: LandmarkFrame[] }[];
}) => api<PersonalSign>("/api/personal-signs", { method: "POST", body: JSON.stringify(body) });

export const deletePersonalSign = (id: string) => api<void>(`/api/personal-signs/${encodeURIComponent(id)}`, { method: "DELETE" });

/** Landmark frames are stored rounded to 4 decimals (about 0.1 px on a 1080p frame) to keep them small. */
export function compactFrames(frames: LandmarkFrame[]): LandmarkFrame[] {
  const r = (a: number[] | null) => (a ? a.map((v) => Math.round(v * 1e4) / 1e4) : null);
  return frames.map((f) => ({ t: Math.round(f.t), leftHand: r(f.leftHand), rightHand: r(f.rightHand), pose: r(f.pose), face: r(f.face) }));
}
