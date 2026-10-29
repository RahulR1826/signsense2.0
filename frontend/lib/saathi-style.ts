// Which Saathi the viewer sees: "3d" (pre-rendered video) or "2d" (drawn live from the motion). A per-viewer
// convenience kept in localStorage; every Saathi on the page follows a change at once.
import { useSyncExternalStore } from "react";

export type SaathiStyle = "2d" | "3d";
export const DEFAULT_SAATHI_STYLE: SaathiStyle = "3d";
const KEY = "saathi-style";
const EVENT = "saathi-style-change";

function read(): SaathiStyle {
  try {
    const v = localStorage.getItem(KEY);
    return v === "2d" || v === "3d" ? v : DEFAULT_SAATHI_STYLE;
  } catch {
    return DEFAULT_SAATHI_STYLE;
  }
}

function subscribe(on: () => void) {
  window.addEventListener(EVENT, on);
  window.addEventListener("storage", on);
  return () => {
    window.removeEventListener(EVENT, on);
    window.removeEventListener("storage", on);
  };
}

export function useSaathiStyle(): [SaathiStyle, (s: SaathiStyle) => void] {
  const style = useSyncExternalStore(subscribe, read, () => DEFAULT_SAATHI_STYLE);
  const set = (s: SaathiStyle) => {
    try {
      localStorage.setItem(KEY, s);
    } catch {
      // storage blocked: the choice lasts until the page is reloaded
    }
    window.dispatchEvent(new Event(EVENT));
  };
  return [style, set];
}
