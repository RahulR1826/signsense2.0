import { notFound } from "next/navigation";

import { SaathiRender } from "./saathi-render";

// Development tool: draws one frame of Saathi at the framing of the source video, for
// scripts/saathi-check.mjs (renders each sign to video and runs the real recogniser on it).
export default function Page() {
  if (process.env.NODE_ENV === "production") notFound();
  return <SaathiRender />;
}
