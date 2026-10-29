import { notFound } from "next/navigation";

import { SaathiLivePreview } from "./preview";

// Development tool: the call's Saathi stage for any text (?text=thank you doctor), for checking the live 3D rig
// and its fallbacks in a browser (scripts/saathi-live-check.mjs).
export default function Page() {
  if (process.env.NODE_ENV === "production") notFound();
  return <SaathiLivePreview />;
}
