/** Mean of `rows` equal-length vectors packed in `flat`, L2-normalised (same as ml/tools/personal_study.py). */
export function meanEmbedding(flat: Float32Array, rows: number): Float32Array {
  const d = flat.length / rows;
  const out = new Float32Array(d);
  for (let r = 0; r < rows; r++) for (let i = 0; i < d; i++) out[i] += flat[r * d + i] / rows;
  let norm = 0;
  for (let i = 0; i < d; i++) norm += out[i] * out[i];
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < d; i++) out[i] /= norm;
  return out;
}
