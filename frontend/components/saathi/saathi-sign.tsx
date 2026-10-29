"use client";

import { useEffect, useRef, useState } from "react";

import { SAATHI_VIEWBOX, SaathiFigure } from "@/components/saathi/saathi-figure";
import { useSaathiStyle, type SaathiStyle } from "@/lib/saathi-style";
import { loadAnimation, type SignAnimation } from "@/lib/signs/anim";
import { clipUrl, type LibrarySign } from "@/lib/signs/library";

interface PlayProps {
  /** Plays when true; shows the poster frame when false. */
  playing?: boolean;
  loop?: boolean;
  /** Called once when a non-looping play reaches the end (or the motion cannot be loaded). */
  onEnded?: () => void;
  /** Accessible name; empty when the surrounding control already names the sign. */
  label: string;
  className?: string;
}

/**
 * Saathi signing one dictionary sign: the 3D video when the viewer chose 3D (the default) and the sign has one,
 * otherwise the 2D drawing. If the video cannot play, the 2D drawing takes over.
 */
export function SaathiSign({ sign, style: forced, ...props }: PlayProps & { sign: LibrarySign; /** Ignore the viewer's choice (previews). */ style?: SaathiStyle }) {
  const [chosen] = useSaathiStyle();
  const style = forced ?? chosen;
  const [failed, setFailed] = useState<string | null>(null);
  if (style === "3d" && sign.video3d && failed !== sign.id) {
    return <SaathiVideo key={sign.id} src={sign.video3d} poster={sign.poster3d} onError={() => setFailed(sign.id)} {...props} />;
  }
  return <SaathiDrawing anim={sign.anim} {...props} />;
}

/** The pre-rendered 3D Saathi (ml/tools/render_saathi3d.py). */
function SaathiVideo({ src, poster, playing = true, loop = false, onEnded, onError, label, className = "" }: PlayProps & { src: string; poster?: string; onError: () => void }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    if (playing) {
      v.play().catch(() => undefined);
    } else {
      v.pause();
      v.currentTime = 0;
    }
  }, [playing]);
  return (
    <video
      ref={ref}
      src={clipUrl(src)}
      poster={poster ? clipUrl(poster) : undefined}
      muted
      playsInline
      loop={loop}
      preload={playing ? "auto" : "none"}
      onEnded={onEnded}
      onError={onError}
      className={`object-cover ${className}`}
      data-saathi="3d"
      {...(label ? { role: "img", "aria-label": label } : { "aria-hidden": true })}
    />
  );
}

/** Saathi drawn live from the motion file (2D). */
export function SaathiDrawing({ anim, playing = true, loop = false, onEnded, label, className = "" }: PlayProps & { anim: string }) {
  const [data, setData] = useState<SignAnimation | null>(null);
  const [index, setIndex] = useState<number | null>(null);
  const ended = useRef(onEnded);
  useEffect(() => {
    ended.current = onEnded;
  });

  useEffect(() => {
    let alive = true;
    loadAnimation(anim)
      .then((a) => alive && setData(a))
      .catch(() => alive && ended.current?.());
    return () => {
      alive = false;
    };
  }, [anim]);

  useEffect(() => {
    if (!data || !playing) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- back to the poster frame when stopped
      setIndex(null);
      return;
    }
    let raf = 0;
    let start = 0;
    const tick = (now: number) => {
      start ||= now;
      let i = Math.floor(((now - start) / 1000) * data.fps);
      if (i >= data.frames.length) {
        if (!loop) {
          setIndex(data.frames.length - 1);
          ended.current?.();
          return;
        }
        start = now;
        i = 0;
      }
      setIndex(i);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [data, playing, loop]);

  const frame = data?.frames[index ?? data.poster];
  return (
    <svg
      viewBox={SAATHI_VIEWBOX}
      {...(label ? { role: "img", "aria-label": label } : { "aria-hidden": true })}
      className={className}
      data-saathi="2d"
      data-saathi-frame={index ?? "poster"}
    >
      {frame && <SaathiFigure frame={frame} />}
    </svg>
  );
}
