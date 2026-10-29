"use client";

import { useEffect, useRef } from "react";

interface Props {
  stream: MediaStream | null;
  muted?: boolean;
  mirrored?: boolean;
  /** "contain" never crops — use it for anyone who may be signing. */
  fit?: "cover" | "contain";
  className?: string;
  label?: string;
  placeholder?: string;
}

/** A <video> bound to a MediaStream, with a name label and a placeholder when there's no video. */
export function VideoTile({ stream, muted = false, mirrored = false, fit = "cover", className = "", label, placeholder }: Props) {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    video.srcObject = stream;
    if (stream) video.play().catch(() => undefined);
  }, [stream]);

  const hasVideo = !!stream && stream.getVideoTracks().some((t) => t.readyState === "live");

  return (
    <div className={`relative overflow-hidden rounded-2xl bg-neutral-900 ${className}`}>
      <video
        ref={ref}
        autoPlay
        playsInline
        muted={muted}
        className={`size-full ${fit === "contain" ? "object-contain" : "object-cover"} ${mirrored ? "-scale-x-100" : ""} ${hasVideo ? "" : "invisible"}`}
      />
      {!hasVideo && placeholder && (
        <div className="absolute inset-0 flex items-center justify-center p-4 text-center text-neutral-300">{placeholder}</div>
      )}
      {label && (
        <span className="absolute bottom-2 left-2 rounded-md bg-black/60 px-2 py-0.5 text-sm text-white">{label}</span>
      )}
    </div>
  );
}
