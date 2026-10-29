// Saathi motion files (sign-library/anim/<id>.json, built by ml/tools/build_sign_animations.py from the
// landmarks of the dictionary clip). Units: 1/100 of the signer's shoulder width, origin at the middle of the
// shoulders, x right / y down as seen by the viewer (the signer's right hand is on screen left).

import { clipUrl } from "@/lib/signs/library";

export interface AnimFrame {
  /** Arms: person's left shoulder, elbow, wrist, then right shoulder, elbow, wrist (x, y pairs). */
  a: number[];
  /** Which arm is nearer the camera (drawn last). */
  n: "L" | "R";
  /** Face: head x, y, size (forehead to chin), tilt (deg), mouth open, mouth width, left brow, right brow, eye open %. */
  f: number[];
  /** Person's left / right hand: 21 points (x, y pairs), absent when not tracked. */
  l?: number[];
  r?: number[];
}

export interface SignAnimation {
  id: string;
  fps: number;
  /** Frame to show when not playing. */
  poster: number;
  frames: AnimFrame[];
  /** Source video size and where the body frame sat in it (px), for re-rendering with the same framing. */
  camera?: { w: number; h: number; x: number; y: number; unit: number };
}

const cache = new Map<string, Promise<SignAnimation>>();

export function loadAnimation(path: string): Promise<SignAnimation> {
  let p = cache.get(path);
  if (!p) {
    p = fetch(clipUrl(path)).then((res) => {
      if (!res.ok) throw new Error(`Sign animation not found: ${path}`);
      return res.json() as Promise<SignAnimation>;
    });
    p.catch(() => cache.delete(path));
    cache.set(path, p);
  }
  return p;
}
