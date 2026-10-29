"use client";

import Link from "next/link";
import { Fragment, useState } from "react";

import { LandmarkCamera, type LandmarkStats } from "@/components/landmark-camera";
import { LEGEND } from "@/lib/landmarks/draw";
import type { Delegate } from "@/lib/landmarks/extractor";

export default function LandmarksPage() {
  const [face, setFace] = useState(true);
  const [delegate, setDelegate] = useState<Delegate>("GPU");
  const [stats, setStats] = useState<LandmarkStats | null>(null);

  const detected = stats
    ? { "Left hand": stats.leftHand, "Right hand": stats.rightHand, Pose: stats.pose, Face: stats.face }
    : {};

  return (
    <main className="mx-auto w-full max-w-5xl space-y-6 px-4 py-8">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-2xl font-semibold">Landmark viewer</h1>
        <Link href="/record" className="text-sm underline underline-offset-4">
          Go to recorder →
        </Link>
      </div>

      <div className="grid gap-6 md:grid-cols-[1fr_260px]">
        <LandmarkCamera face={face} delegate={delegate} onStats={setStats} />

        <aside className="space-y-5 text-sm">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={face} onChange={(e) => setFace(e.target.checked)} />
            Track face (mouth, eyebrows)
          </label>
          <label className="flex items-center gap-2">
            Run models on
            <select
              className="rounded-md border bg-background px-2 py-1"
              value={delegate}
              onChange={(e) => setDelegate(e.target.value as Delegate)}
            >
              <option value="GPU">GPU</option>
              <option value="CPU">CPU</option>
            </select>
          </label>

          <dl className="grid grid-cols-2 gap-y-1">
            <dt className="text-muted-foreground">FPS</dt>
            <dd className="tabular-nums">{stats ? stats.fps.toFixed(1) : "–"}</dd>
            <dt className="text-muted-foreground">Landmarks</dt>
            <dd className="tabular-nums">{stats ? `${stats.inferMs.toFixed(1)} ms/frame` : "–"}</dd>
            {stats &&
              (["hand", "pose", "face"] as const).map((m) => (
                <Fragment key={m}>
                  <dt className="pl-3 text-muted-foreground">· {m}</dt>
                  <dd className="tabular-nums">{stats.models[m].toFixed(1)} ms</dd>
                </Fragment>
              ))}
            <dt className="text-muted-foreground">Runs on</dt>
            <dd>{stats?.delegate ?? "–"}</dd>
          </dl>

          <ul className="space-y-1">
            {LEGEND.map(({ label, color }) => {
              const on = detected[label as keyof typeof detected];
              return (
                <li key={label} className="flex items-center gap-2">
                  <span className="size-3 rounded-full" style={{ background: color }} aria-hidden />
                  <span className="flex-1">{label}</span>
                  <span className={on ? "text-green-600" : "text-muted-foreground"}>{on ? "detected" : "—"}</span>
                </li>
              );
            })}
          </ul>
          <p className="text-muted-foreground">
            Left/right are your own hands. The view is mirrored like a selfie; the recorded data is not.
          </p>
        </aside>
      </div>
    </main>
  );
}
