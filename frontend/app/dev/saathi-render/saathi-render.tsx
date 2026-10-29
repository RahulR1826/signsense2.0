"use client";

import { useEffect, useRef, useState } from "react";

import { DEFAULT_HAND, SaathiFigure, type HandStyle } from "@/components/saathi/saathi-figure";
import { LandmarkExtractor } from "@/lib/landmarks/extractor";
import type { LandmarkFrame } from "@/lib/landmarks/schema";
import { SignClassifier } from "@/lib/signs/classifier";
import { loadAnimation, type SignAnimation } from "@/lib/signs/anim";
import { windowVariants } from "@/lib/signs/features";

const RENDER_W = 640;
const DEFAULT_CAMERA = { w: 1920, h: 1080, x: 960, y: 400, unit: 3 };

export interface EvalResult {
  decision: string;
  top: string;
  prob: number;
  /** Frames where the motion has a hand vs. frames where MediaPipe found it in Saathi's drawing. */
  handFrames: number;
  handsFound: number;
  /** Median wrist error of found hands, as a fraction of the shoulder width. */
  wristError: number | null;
}

declare global {
  interface Window {
    /** Shows frame `index` of a sign; resolves with the frame count once it is painted. */
    __saathiShow?: (id: string, index: number) => Promise<number>;
    /** Saathi's drawing -> MediaPipe -> features -> sign model, over the whole motion (no camera). */
    __saathiEval?: (id: string) => Promise<EvalResult>;
    /** The same for rendered image frames of a sign (e.g. the 3D Saathi), one per motion frame. */
    __imagesEval?: (id: string, urls: string[]) => Promise<EvalResult>;
    /** The rigged live 3D Saathi (GLB clip of the sign), rendered at the source video's framing. */
    __rigEval?: (id: string) => Promise<EvalResult>;
    /** The same model on recorded landmark frames (the source clip), for comparison. */
    /** Experiment: hand style override for the drawing. */
    __saathiHandStyle?: Partial<HandStyle>;
    __landmarksEval?: (frames: LandmarkFrame[], aspect: number) => Promise<Omit<EvalResult, "handFrames" | "handsFound" | "wristError">>;
  }
}

const nextPaint = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

export function SaathiRender() {
  const [shown, setShown] = useState<{ anim: SignAnimation; index: number } | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    let extractor: Promise<LandmarkExtractor> | null = null;
    let classifier: Promise<SignClassifier> | null = null;
    const decide = async (frames: LandmarkFrame[], aspect: number) => {
      classifier ??= SignClassifier.load();
      const d = await (await classifier).decide(windowVariants(frames, aspect));
      return { decision: d.decision, top: d.ranked[0]?.label ?? "", prob: d.ranked[0]?.prob ?? 0 };
    };

    window.__saathiShow = async (id, index) => {
      const anim = await loadAnimation(`anim/${id}.json`);
      setShown({ anim, index });
      await nextPaint();
      return anim.frames.length;
    };

    window.__landmarksEval = decide;

    /** Frames from `draw(i)` (drawn onto a camera-sized canvas) -> extractor -> model; hands compared with the motion. */
    const evalFrames = async (id: string, count: number | null, draw: (i: number, ctx: OffscreenCanvasRenderingContext2D, w: number, h: number, anim: SignAnimation) => Promise<void>) => {
      extractor ??= LandmarkExtractor.create({ face: true });
      const ex = await extractor;
      const anim = await loadAnimation(`anim/${id}.json`);
      const cam = anim.camera ?? DEFAULT_CAMERA;
      const h = Math.round((RENDER_W * cam.h) / cam.w);
      const canvas = new OffscreenCanvas(RENDER_W, h);
      const ctx = canvas.getContext("2d")!;
      const frames: LandmarkFrame[] = [];
      let handFrames = 0;
      let handsFound = 0;
      const errors: number[] = [];
      const n = Math.min(count ?? anim.frames.length, anim.frames.length);
      for (let i = 0; i < n; i++) {
        await draw(i, ctx, RENDER_W, h, anim);
        const f = ex.detect(await createImageBitmap(canvas), Math.round((i * 1000) / anim.fps));
        frames.push(f);
        // Compare with the motion's own hands (motion units -> normalised image coordinates).
        const truth = anim.frames[i];
        for (const [want, got] of [
          [truth.l, f.leftHand],
          [truth.r, f.rightHand],
        ] as const) {
          if (!want) continue;
          handFrames++;
          if (!got) continue;
          handsFound++;
          const tx = (cam.x + want[0] * cam.unit) / cam.w;
          const ty = (cam.y + want[1] * cam.unit) / cam.h;
          errors.push(Math.hypot((got[0] - tx) * cam.w, (got[1] - ty) * cam.h) / (100 * cam.unit));
        }
      }
      errors.sort((a, b) => a - b);
      return {
        ...(await decide(frames, cam.w / cam.h)),
        handFrames,
        handsFound,
        wristError: errors.length ? Number(errors[Math.floor(errors.length / 2)].toFixed(3)) : null,
      };
    };

    const drawUrl = async (url: string, ctx: OffscreenCanvasRenderingContext2D, w: number, h: number) => {
      const img = new Image();
      img.src = url;
      await img.decode();
      ctx.drawImage(img, 0, 0, w, h);
    };

    window.__saathiEval = (id) =>
      evalFrames(id, null, async (i, ctx, w, h, anim) => {
        setShown({ anim, index: i });
        await nextPaint();
        const svg = new XMLSerializer().serializeToString(svgRef.current!);
        const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
        await drawUrl(url, ctx, w, h);
        URL.revokeObjectURL(url);
      });

    window.__imagesEval = (id, urls) => evalFrames(id, urls.length, (i, ctx, w, h) => drawUrl(urls[i], ctx, w, h));

    // Live 3D rig: three.js renders the sign's clip frame by frame with an orthographic camera that reproduces the
    // source camera's view (the motion's x/y are that camera's projection), then the same extractor + model.
    let rig: Promise<{ render: (id: string, t: number, w: number, h: number, cam: NonNullable<SignAnimation["camera"]>) => HTMLCanvasElement }> | null = null;
    const loadRig = () =>
      (rig ??= (async () => {
        const THREE = await import("three");
        const { GLTFLoader } = await import("three/examples/jsm/loaders/GLTFLoader.js");
        const gltf = await new GLTFLoader().loadAsync("/sign-library/saathi-rig/saathi.glb");
        const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
        const scene = new THREE.Scene();
        scene.background = new THREE.Color("#e9e6df");
        scene.add(new THREE.HemisphereLight("#ffffff", "#c7d3f2", 1.6));
        const key = new THREE.DirectionalLight("#ffffff", 2.4);
        key.position.set(-1.2, 1.5, 2.4);
        const fill = new THREE.DirectionalLight("#e8eeff", 0.9);
        fill.position.set(1.6, 0.4, 1.8);
        scene.add(key, fill, gltf.scene);
        const mixer = new THREE.AnimationMixer(gltf.scene);
        const S = 0.0038; // metres per motion unit (as in ml/blender/saathi_rig.py)
        return {
          render: (id, t, w, h, cam) => {
            renderer.setSize(w, h, false);
            const x0 = (-cam.x / cam.unit) * S, x1 = ((cam.w - cam.x) / cam.unit) * S;
            const y0 = (-cam.y / cam.unit) * S, y1 = ((cam.h - cam.y) / cam.unit) * S;
            const camera = new THREE.OrthographicCamera(x0, x1, -y0, -y1, 0.1, 20);
            camera.position.set(0, 0, 5);
            mixer.stopAllAction();
            const clip = gltf.animations.find((a) => a.name === id);
            if (clip) {
              const a = mixer.clipAction(clip);
              a.play();
              mixer.setTime(t);
            }
            renderer.render(scene, camera);
            return renderer.domElement;
          },
        };
      })());
    window.__rigEval = async (id) => {
      const r = await loadRig();
      return evalFrames(id, null, async (i, ctx, w, h, anim) => {
        ctx.drawImage(r.render(id, i / anim.fps, w, h, anim.camera ?? DEFAULT_CAMERA), 0, 0, w, h);
      });
    };
  }, []);

  if (!shown) return <p id="ready">ready</p>;
  const cam = shown.anim.camera ?? DEFAULT_CAMERA;
  // The same part of the scene the source camera saw, in motion units.
  const view = `${-cam.x / cam.unit} ${-cam.y / cam.unit} ${cam.w / cam.unit} ${cam.h / cam.unit}`;
  return (
    <svg
      ref={svgRef}
      id="stage"
      xmlns="http://www.w3.org/2000/svg"
      viewBox={view}
      width={RENDER_W}
      height={Math.round((RENDER_W * cam.h) / cam.w)}
      style={{ display: "block", background: "#e9e6df" }}
    >
      <rect x={-cam.x / cam.unit} y={-cam.y / cam.unit} width={cam.w / cam.unit} height={cam.h / cam.unit} fill="#e9e6df" />
      <SaathiFigure frame={shown.anim.frames[shown.index]} hands={{ ...DEFAULT_HAND, ...(typeof window !== "undefined" ? window.__saathiHandStyle : undefined) }} />
    </svg>
  );
}
