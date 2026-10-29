// Sign library (sign-library/, built by ml/tools/build_sign_library.py + build_sign_animations.py). Only
// Saathi's motion files are served from public/; real signers' videos never appear on the website.

export interface LibrarySign {
  id: string;
  label: string;
  category: string;
  /** Saathi motion file (lib/signs/anim.ts). */
  anim: string;
  /** 3D Saathi video and poster (ml/tools/render_saathi3d.py), when rendered. */
  video3d?: string;
  poster3d?: string;
  duration: number;
}

export interface SignLibrary {
  attribution: string;
  signs: LibrarySign[];
  byId: Map<string, LibrarySign>;
  ids: Set<string>;
}

const BASE = "/sign-library";
let cached: Promise<SignLibrary> | null = null;

export function loadSignLibrary(): Promise<SignLibrary> {
  cached ??= fetch(`${BASE}/library.json`)
    .then((res) => {
      if (!res.ok) throw new Error("Sign library not found. Build it with ml/tools/build_sign_library.py.");
      return res.json() as Promise<{ attribution: string; signs: LibrarySign[] }>;
    })
    .then((lib) => ({
      attribution: lib.attribution,
      signs: lib.signs,
      byId: new Map(lib.signs.map((s) => [s.id, s])),
      ids: new Set(lib.signs.map((s) => s.id)),
    }))
    .catch((err) => {
      cached = null; // allow a retry later
      throw err;
    });
  return cached;
}

export const clipUrl = (path: string) => `${BASE}/${path}`;
