// Landmark frame format shared by the recorder, the training pipeline (ml/) and live inference.
// Changing anything here (or the MediaPipe models) changes the data: bump EXTRACTOR_VERSION and re-record.

export const EXTRACTOR_VERSION = "mp-tasks-1.0.1|hand-f16-v1|pose-lite-f16-v1|face-f16-v1|roi-crop-1|schema-1";

export const HAND_POINTS = 21;
export const POSE_POINTS = 33;

// Curated face subset (MediaPipe face mesh indices): lips, eyebrows, eyes, nose, forehead, chin.
// Enough for mouth shapes and eyebrow movement (non-manual markers) without 478 points per frame.
export const FACE_SUBSET = [
  // lips outer
  61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291, 409, 270, 269, 267, 0, 37, 39, 40, 185,
  // lips inner
  78, 95, 88, 178, 87, 14, 317, 402, 318, 324, 308, 415, 310, 311, 312, 13, 82, 81, 80, 191,
  // left eyebrow
  276, 283, 282, 295, 285, 300, 293, 334, 296, 336,
  // right eyebrow
  46, 53, 52, 65, 55, 70, 63, 105, 66, 107,
  // eyes (corners + lids)
  33, 133, 159, 145, 362, 263, 386, 374,
  // nose tip, nose bridge, forehead, chin
  1, 4, 10, 152,
] as const;

// Pose landmark indices for the signer's wrists (person's own left/right, not screen side).
export const POSE_LEFT_WRIST = 15;
export const POSE_RIGHT_WRIST = 16;

/**
 * One video frame of landmarks. Coordinates are MediaPipe-normalised image coords of the
 * UNMIRRORED camera image. Flat arrays:
 *   leftHand / rightHand: [x, y, z] * 21       (person's own left/right hand)
 *   pose:                 [x, y, z, visibility] * 33
 *   face:                 [x, y, z] * FACE_SUBSET.length
 * null = not detected in this frame.
 */
export interface LandmarkFrame {
  t: number; // ms since recording/stream start
  leftHand: number[] | null;
  rightHand: number[] | null;
  pose: number[] | null;
  face: number[] | null;
}
