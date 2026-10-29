// Saathi, the drawn signer: an SVG character posed by one frame of landmark motion (lib/signs/anim.ts).
// The body, arms and hands follow the recorded signer's skeleton; the face only carries head position and
// tilt, brows, eyes and mouth (expressions are part of ISL). Palms are drawn lighter than the back of the
// hand so the viewer can tell which way each hand faces.

import type { AnimFrame } from "@/lib/signs/anim";
import { palmFacing } from "@/lib/signs/palm";

export const SAATHI = {
  ink: "#1b1d2e",
  skin: "#b97a52",
  skinDark: "#8f5a3a",
  palm: "#e6b08c",
  hair: "#2a1d17",
  top: "#1e40af",
  shade: "#1a3690",
  cuff: "#ffffff",
  lips: "#7e2f38",
  gold: "#e2b04a",
};

/** Square view of the signing space, in motion-file units. */
export const SAATHI_VIEWBOX = "-140 -160 280 280";

const OUT = 1.3; // outline width
const FINGERS = [
  [1, 2, 3, 4],
  [5, 6, 7, 8],
  [9, 10, 11, 12],
  [13, 14, 15, 16],
  [17, 18, 19, 20],
];
// Sketch geometry (saathi2 concept) is drawn at "sketch scale" and mapped onto the data.
const SKETCH_SHOULDER_W = 192; // distance between the sleeve tops in the sketch
const SKETCH_HEAD = 110; // forehead to chin in the sketch
const HEAD_SCALE = 1.15; // slightly larger than life, so the face (brows, mouth) reads at small sizes

type P = [number, number];

/** How hands are drawn (tuned so MediaPipe can track Saathi's hands; see scripts/saathi-eval.mjs). */
export interface HandStyle {
  finger: number; // finger width
  thumb: number;
  outline: number; // outline width each side
  outlineColor: string;
  scale: number; // hand size about the wrist
  forearmOutline: string; // outline colour of the bare forearm
}
// Bare skin (hands, forearms) has a thin skin-tone outline, not the black ink of the rest of the drawing:
// MediaPipe found black-outlined hands in 4% of frames and these in 47% (ml/reports/saathi_eval.json).
export const DEFAULT_HAND: HandStyle = { finger: 4.4, thumb: 5, outline: 0.6, outlineColor: "#8f5a3a", scale: 1, forearmOutline: "#8f5a3a" };

function Cap({ a, b, w, fill, outline = SAATHI.ink }: { a: P; b: P; w: number; fill: string; outline?: string }) {
  return (
    <>
      <line x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} stroke={outline} strokeWidth={w + OUT * 2} strokeLinecap="round" />
      <line x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} stroke={fill} strokeWidth={w} strokeLinecap="round" />
    </>
  );
}

function Chain({ pts, w, fill, hs }: { pts: P[]; w: number; fill: string; hs: HandStyle }) {
  const d = pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join("");
  return (
    <>
      {hs.outline > 0 && <path d={d} fill="none" stroke={hs.outlineColor} strokeWidth={w + hs.outline * 2} strokeLinecap="round" strokeLinejoin="round" />}
      <path d={d} fill="none" stroke={fill} strokeWidth={w} strokeLinecap="round" strokeLinejoin="round" />
    </>
  );
}

const pt = (arr: number[], i: number): P => [arr[i * 2], arr[i * 2 + 1]];
const lerp = (a: P, b: P, t: number): P => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

function Hand({ hand: raw, side, hs }: { hand: number[]; side: "L" | "R"; hs: HandStyle }) {
  const hand = hs.scale === 1 ? raw : raw.map((v, i) => raw[i % 2] + (v - raw[i % 2]) * hs.scale);
  const front = palmFacing(hand, side);
  const fill = front ? SAATHI.palm : SAATHI.skin;
  const palm = [0, 1, 5, 9, 13, 17].map((i) => pt(hand, i));
  const d = palm.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join("") + "Z";
  const palmShape = (
    <>
      {hs.outline > 0 && <path d={d} fill={fill} stroke={hs.outlineColor} strokeWidth={4 + hs.outline * 2} strokeLinejoin="round" />}
      <path d={d} fill={fill} stroke={fill} strokeWidth={4} strokeLinejoin="round" />
    </>
  );
  // Palm towards the viewer: bent fingers come forward, so draw them over the palm; from the back they fold away.
  const fingers = FINGERS.map((chain, k) => (
    <Chain key={k} pts={(k === 0 ? [lerp(pt(hand, 0), pt(hand, 1), 0.6), ...chain.slice(1).map((i) => pt(hand, i))] : chain.map((i) => pt(hand, i)))} w={k === 0 ? hs.thumb : hs.finger} fill={fill} hs={hs} />
  ));
  return front ? (
    <g>
      {palmShape}
      {fingers}
    </g>
  ) : (
    <g>
      {fingers}
      {palmShape}
    </g>
  );
}

/** A relaxed closed hand along the forearm, for frames where the hand was not tracked. */
function RestHand({ elbow, wrist }: { elbow: P; wrist: P }) {
  const dx = wrist[0] - elbow[0];
  const dy = wrist[1] - elbow[1];
  const len = Math.hypot(dx, dy) || 1;
  const c: P = [wrist[0] + (dx / len) * 9, wrist[1] + (dy / len) * 9];
  const angle = (Math.atan2(dy, dx) * 180) / Math.PI - 90;
  return <ellipse cx={c[0]} cy={c[1]} rx={7.5} ry={10.5} transform={`rotate(${angle.toFixed(1)} ${c[0].toFixed(1)} ${c[1].toFixed(1)})`} fill={SAATHI.skin} stroke={SAATHI.skinDark} strokeWidth={0.6} />;
}

function Arm({ frame, side, hs }: { frame: AnimFrame; side: "L" | "R"; hs: HandStyle }) {
  const o = side === "L" ? 0 : 6;
  const [s, e, w] = [pt(frame.a, o / 2), pt(frame.a, o / 2 + 1), pt(frame.a, o / 2 + 2)];
  const hand = side === "L" ? frame.l : frame.r;
  const cuffEnd = lerp(e, w, 0.24);
  return (
    <g>
      <Cap a={s} b={e} w={16} fill={SAATHI.top} />
      <Cap a={cuffEnd} b={w} w={10.5} fill={SAATHI.skin} outline={hs.forearmOutline} />
      <Cap a={e} b={cuffEnd} w={14} fill={SAATHI.cuff} />
      {hand ? <Hand hand={hand} side={side} hs={hs} /> : <RestHand elbow={e} wrist={w} />}
    </g>
  );
}

/** Head in sketch coordinates (centre between forehead and chin at 0,3). */
function Head({ f }: { f: number[] }) {
  const [, , , , mouthOpen, mouthWide, browL, browR, eyeOpen] = f;
  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
  // Brow values are changes in brow height (as % of face size) from this signer's neutral.
  const bL = -clamp((browL / 100) * SKETCH_HEAD, -6, 10);
  const bR = -clamp((browR / 100) * SKETCH_HEAD, -6, 10);
  const blink = eyeOpen < 45;
  const open = clamp(((mouthOpen - 3) / 100) * SKETCH_HEAD, 0, 16);
  const half = clamp(((mouthWide / 100) * SKETCH_HEAD) / 2 - 8, 9, 20);
  const { ink, skin, skinDark, hair, lips, gold } = SAATHI;
  return (
    <g>
      <ellipse cx={0} cy={-6} rx={56} ry={60} fill={hair} />
      <ellipse cx={-49} cy={4} rx={8} ry={12} fill={skin} stroke={ink} strokeWidth={2.6} />
      <ellipse cx={49} cy={4} rx={8} ry={12} fill={skin} stroke={ink} strokeWidth={2.6} />
      <circle cx={-50} cy={16} r={3} fill={gold} />
      <circle cx={50} cy={16} r={3} fill={gold} />
      <path d="M-46 -6 Q-48 40 0 58 Q48 40 46 -6 Q40 -50 0 -52 Q-40 -50 -46 -6 Z" fill={skin} stroke={ink} strokeWidth={3} />
      <path d="M-50 -2 Q-52 -62 0 -64 Q52 -62 50 -2 Q40 -42 2 -46 Q-38 -42 -50 -2 Z" fill={hair} />
      <path d="M0 -63 L2 -46" stroke="#4a3427" strokeWidth={2} />
      {/* Brows: viewer's left is the signer's right. */}
      <path d={`M-30 ${-14 + bR} Q-20 ${-22 + bR} -9 ${-16 + bR}`} stroke={hair} strokeWidth={5} fill="none" strokeLinecap="round" />
      <path d={`M9 ${-16 + bL} Q20 ${-22 + bL} 30 ${-14 + bL}`} stroke={hair} strokeWidth={5} fill="none" strokeLinecap="round" />
      {[-19, 19].map((ex) =>
        blink ? (
          <path key={ex} d={`M${ex - 7} 3 Q${ex} 7 ${ex + 7} 3`} stroke={ink} strokeWidth={2.6} fill="none" strokeLinecap="round" />
        ) : (
          <g key={ex}>
            <ellipse cx={ex} cy={2} rx={6} ry={7.5} fill={ink} />
            <circle cx={ex + 2} cy={-1} r={2} fill="#fff" />
            <path d={`M${ex - 8} -5 Q${ex} -10 ${ex + 8} -5`} stroke={ink} strokeWidth={2.4} fill="none" strokeLinecap="round" />
          </g>
        ),
      )}
      <path d="M-2 8 q-4 12 3 14" stroke={skinDark} strokeWidth={2.4} fill="none" strokeLinecap="round" />
      {open > 2.5 ? (
        <path d={`M${-half} 34 Q0 ${30 - open * 0.15} ${half} 34 Q0 ${34 + open * 1.3} ${-half} 34 Z`} fill="#4a1d24" stroke={lips} strokeWidth={3.5} strokeLinejoin="round" />
      ) : (
        <path d={`M${-half} 33 Q0 44 ${half} 33`} stroke={lips} strokeWidth={4.5} fill="none" strokeLinecap="round" />
      )}
    </g>
  );
}

function Braid() {
  return (
    <g>
      {[0, 1, 2, 3].map((k) => (
        <ellipse key={k} cx={-46 - k * 9} cy={34 + k * 22} rx={13} ry={15} fill={SAATHI.hair} stroke={SAATHI.ink} strokeWidth={2.2} />
      ))}
    </g>
  );
}

export function SaathiFigure({ frame, hands = DEFAULT_HAND }: { frame: AnimFrame; hands?: HandStyle }) {
  const sL = pt(frame.a, 0);
  const sR = pt(frame.a, 3);
  const mid = lerp(sL, sR, 0.5);
  const sw = Math.hypot(sL[0] - sR[0], sL[1] - sR[1]) || 100;
  // sR is on screen left; the torso is drawn left-to-right, so the tilt is measured from sR to sL.
  const tilt = (Math.atan2(sL[1] - sR[1], sL[0] - sR[0]) * 180) / Math.PI;
  const k = sw / SKETCH_SHOULDER_W;
  const torso = `translate(${mid[0].toFixed(1)} ${mid[1].toFixed(1)}) rotate(${tilt.toFixed(1)}) scale(${k.toFixed(3)})`;
  const [hx, hy, size, roll] = frame.f;
  const head = `translate(${hx} ${hy}) rotate(${-roll}) scale(${((size / SKETCH_HEAD) * HEAD_SCALE).toFixed(3)}) translate(0 -3)`;
  const neckTop: P = [hx, hy + size * 0.3];
  const far = frame.n === "L" ? "R" : "L";
  const { top, shade, cuff, skin } = SAATHI;
  return (
    <g>
      <g transform={head}>
        <Braid />
      </g>
      <g transform={torso}>
        {/* Kurta with darker side panels; the chest stays plain because signs are made in front of it. */}
        <path d="M-122 700 Q-130 -4 -78 -40 L78 -40 Q130 -4 122 700 Z" fill={top} stroke={SAATHI.ink} strokeWidth={3} />
        <path d="M96 10 Q112 90 108 700" stroke={shade} strokeWidth={16} fill="none" />
        <path d="M-96 10 Q-112 90 -108 700" stroke={shade} strokeWidth={16} fill="none" />
      </g>
      <Cap a={[mid[0], mid[1] - 14]} b={neckTop} w={18} fill={skin} />
      <g transform={torso}>
        <path d="M-30 -40 Q0 -18 30 -40" fill="none" stroke={cuff} strokeWidth={5} />
        <path d="M0 -28 L0 0" stroke={cuff} strokeWidth={4} strokeLinecap="round" />
      </g>
      <g transform={head}>
        <Head f={frame.f} />
      </g>
      <Arm frame={frame} side={far} hs={hands} />
      <Arm frame={frame} side={frame.n} hs={hands} />
    </g>
  );
}
