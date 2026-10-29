"use client";

// Live 3D Saathi: the rigged model (sign-library/saathi-rig/saathi.glb) rendered with three.js / React Three Fiber,
// playing one animation clip per sign. A sequence of steps plays one after another with short cross-fades;
// words without a clip are shown as text and Saathi returns to rest (never a substitute sign).
// Renders only while something moves (frameloop "demand"), so it costs nothing between signs.

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";

import { RIG_BASE, type SaathiStep } from "@/lib/signs/saathi-rig";

const FADE_S = 0.25;
const TEXT_STEP_MS = 1300;
const GAP_MS = 180;

// Counters for the browser checks (no content): contexts created/lost, clips started.
interface LiveStats {
  canvases: number;
  disposed: number;
  clipsStarted: string[];
  loadErrors: number;
}
const stats: LiveStats = { canvases: 0, disposed: 0, clipsStarted: [], loadErrors: 0 };
if (typeof window !== "undefined") (window as unknown as { __saathiLive: LiveStats }).__saathiLive = stats;

let gltfPromise: Promise<GLTF> | null = null;

/** Load (once per page) the rigged model. A failure is not cached, so a later attempt can retry. */
export function loadSaathiRig(url = `${RIG_BASE}/saathi.glb`): Promise<GLTF> {
  gltfPromise ??= new GLTFLoader().loadAsync(url).catch((err) => {
    gltfPromise = null;
    stats.loadErrors++;
    throw err;
  });
  return gltfPromise;
}

/** True when this browser can create a WebGL context (checked once). */
let webglOk: boolean | null = null;
export function webglAvailable(): boolean {
  if (webglOk !== null) return webglOk;
  try {
    const c = document.createElement("canvas");
    const ctx = c.getContext("webgl2") ?? c.getContext("webgl");
    webglOk = !!ctx;
    (ctx as WebGLRenderingContext | null)?.getExtension("WEBGL_lose_context")?.loseContext();
  } catch {
    webglOk = false;
  }
  return webglOk;
}

interface PlayerProps {
  gltf: GLTF;
  steps: SaathiStep[];
  /** Index of the step to show; the parent advances it when `onStepEnd` fires. */
  index: number;
  /** Changes when the same sequence should restart (replay). */
  round: number;
  speed: number;
  onStepEnd: (index: number) => void;
}

function Rig({ gltf, steps, index, round, speed, onStepEnd }: PlayerProps) {
  const scene = useMemo(() => cloneSkinned(gltf.scene), [gltf]);
  const mixer = useMemo(() => new THREE.AnimationMixer(scene), [scene]);
  const current = useRef<THREE.AnimationAction | null>(null);
  const moving = useRef(false);
  const ended = useRef(onStepEnd);
  const speedRef = useRef(speed);
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => {
    ended.current = onStepEnd;
    speedRef.current = speed;
  });

  useEffect(
    () => () => {
      mixer.stopAllAction();
      mixer.uncacheRoot(scene);
    },
    [mixer, scene],
  );

  useEffect(() => {
    const step = steps[index];
    let timer: ReturnType<typeof setTimeout> | undefined;
    const prev = current.current;
    if (!step) {
      // Sequence finished: ease back to rest.
      prev?.fadeOut(FADE_S);
      current.current = null;
      moving.current = true;
      invalidate();
      timer = setTimeout(() => (moving.current = false), FADE_S * 1000 + 50);
      return () => clearTimeout(timer);
    }
    if (step.kind === "text") {
      prev?.fadeOut(FADE_S);
      current.current = null;
      moving.current = true;
      invalidate();
      timer = setTimeout(() => ended.current(index), TEXT_STEP_MS / speedRef.current);
      return () => clearTimeout(timer);
    }
    const clip = gltf.animations.find((a) => a.name === step.clip);
    if (!clip) {
      timer = setTimeout(() => ended.current(index), 0); // registry said yes but the model lacks it: skip honestly
      return () => clearTimeout(timer);
    }
    const action = mixer.clipAction(clip);
    action.reset();
    action.setLoop(THREE.LoopOnce, 1);
    action.clampWhenFinished = true;
    if (prev && prev !== action) action.crossFadeFrom(prev, FADE_S, false);
    action.play();
    current.current = action;
    moving.current = true;
    stats.clipsStarted.push(step.clip);
    invalidate();
    const onFinished = (e: { action: THREE.AnimationAction }) => {
      if (e.action !== action) return;
      moving.current = false;
      timer = setTimeout(() => ended.current(index), GAP_MS / speedRef.current);
    };
    mixer.addEventListener("finished", onFinished);
    return () => {
      mixer.removeEventListener("finished", onFinished);
      clearTimeout(timer);
    };
    // `round` restarts the same index on replay. Speed is applied live in useFrame.
  }, [steps, index, round, gltf, mixer, invalidate]);

  useFrame((state, delta) => {
    // Real-time playback even when frames come slowly (the cap only avoids a jump after a stalled tab).
    mixer.update(Math.min(delta, 0.25) * speedRef.current);
    if (moving.current) state.invalidate();
  });

  return <primitive object={scene} />;
}

function ContextCounter() {
  const gl = useThree((s) => s.gl);
  useEffect(() => {
    stats.canvases++;
    return () => {
      stats.disposed++;
      gl.dispose();
    };
  }, [gl]);
  return null;
}

/** The 3D scene: upper-body framing (the model's origin is the middle of the shoulders, y up, facing +z). */
export function SaathiLiveCanvas(props: PlayerProps & { className?: string }) {
  const { className = "", ...player } = props;
  return (
    <Canvas
      className={className}
      frameloop="demand"
      dpr={[1, 1.75]}
      gl={{ antialias: true, alpha: true, powerPreference: "low-power" }}
      camera={{ fov: 24, position: [0, 0.03, 2.25], near: 0.1, far: 10 }}
      onCreated={({ camera }) => camera.lookAt(0, 0.03, 0)}
    >
      <ContextCounter />
      <hemisphereLight args={["#ffffff", "#c7d3f2", 1.6]} />
      <directionalLight position={[-1.2, 1.5, 2.4]} intensity={2.4} />
      <directionalLight position={[1.6, 0.4, 1.8]} intensity={0.9} color="#e8eeff" />
      <directionalLight position={[0.6, 1.2, -1.5]} intensity={1.1} color="#fff1e0" />
      <Rig {...player} />
    </Canvas>
  );
}
