// Which side of a tracked hand faces the viewer (used to tint Saathi's palms). No imports: unit-tested in Node.

/**
 * True when the palm of a hand (21 points, person's own left/right) faces the viewer, from the winding of the
 * wrist, index and little-finger knuckles. Seen from the front, a left palm has the index knuckle on the
 * viewer's left of the little-finger knuckle (fingers up); a right palm the reverse.
 */
export function palmFacing(hand: number[], side: "L" | "R"): boolean {
  const [wx, wy, ix, iy, px, py] = [hand[0], hand[1], hand[10], hand[11], hand[34], hand[35]];
  const cross = (ix - wx) * (py - wy) - (iy - wy) * (px - wx);
  return side === "L" ? cross > 0 : cross < 0;
}
