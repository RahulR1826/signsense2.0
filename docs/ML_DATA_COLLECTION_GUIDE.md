# ML data guide

How SignSense gets its training data. **Nothing in this file is required to run or improve the
current model:** all of today's data is downloaded and processed automatically. The last section
describes optional ways to get a better *real-world* accuracy measure later.

## 1. What the model is trained on today

| Data | Count | Source | Licence |
|---|---|---|---|
| Known signs (39 words) | 708 clips | INCLUDE, Zenodo record 4010759 | CC BY 4.0 |
| Official split lists | — | github.com/AI4Bharat/INCLUDE | MIT |
| Unknown signs (223 other INCLUDE words, 3 clips each) | 669 clips | INCLUDE (same record) | CC BY 4.0 |

All clips are real recordings of Deaf/ISL signers. The vocabulary mapping is in `ml/vocabulary.json`.
Attribution for the clips the app shows is in `sign-library/ATTRIBUTION.md`.

**Rules the pipeline follows:**
- ISL only: no ASL datasets, signs or fingerspelling.
- Augmented copies (mirroring, jitter, time-warp) are made on the fly during training only. They are
  never saved and never counted as recordings.
- Nothing is labelled by hand, and no class is filled with invented examples. The `unknown` class
  is made of real signs that aren't in the vocabulary.
- Raw video stays on this machine (`ml/data/include/videos`, git-ignored). Only landmarks (numbers)
  are used for training.

## 2. Getting and preparing data (automatic)

```bash
ml/.venv/Scripts/python -m signsense_ml.pipeline --download
```

1. **Download** (`tools/include_download.py`): fetches the vocabulary clips and, with
   `--oov-per-word N`, N clips per other word. Resumable; skips files already present.
2. **Dimensions** (`tools/include_dims.py`): records each video's size (landmarks need the aspect ratio).
3. **Landmarks** (`frontend/scripts/extract-landmarks.mjs`): headless Chrome runs the app's own
   MediaPipe extractor on every new video. It needs the dev servers (frontend :3000, backend :8000
   with `ENABLE_DEV_TOOLS=true`). It's resumable, and videos already done for the current extractor
   version are skipped.
4. **Audit** (`python -m signsense_ml.audit` → `ml/reports/dataset_audit.json`):
   - unreadable videos;
   - clips too short or with too little hand tracking (excluded automatically);
   - duplicate files and landmark sequences;
   - label mapping;
   - recording sessions shared across splits (leakage).
5. **Cache:** parsed landmarks are cached in `ml/data/cache/` (rebuilt automatically when files change).

## 3. Splits and leakage

- **Official split** (INCLUDE's own lists): used to compare with published work. It shares recording
  sessions between train and test (57 of 74 sessions), so its numbers are **optimistic**.
- **Session split** (`--protocol session`): whole recording sessions are held out (sessions are
  inferred from camera file numbers). This gives a more honest estimate.
- **Unknown words** are split by word, so test words are never seen in training.
- **Neither split is signer-independent.** INCLUDE doesn't publish signer IDs.

## 4. Optional, later: measuring accuracy on new people

The only way to get a true signer-independent number is clips from people who are **not** in
INCLUDE. If you ever choose to do this (it is not needed for anything that works today):

- **Recorder:** the in-app recorder at `/record` saves landmarks only, never video, to
  `ml/data/raw/`, tagged with a signer id. `signsense_ml.data.load_own` reads them with split `own`.
- **Use as a test set first:** keep each new signer's clips **entirely in test**
  (`split: own`), never mixed into training. This is what makes the result signer-independent.
- **Consent:** get written consent from each signer, store no faces or video, and let them delete
  their samples.
- **Labels must be honest:** a clip only gets a sign label if that sign was actually performed.
  Idle/"no sign" footage must really be idle footage, not relabelled sign clips.
- **Other ISL datasets:** check their licence before use. Some well-known sign datasets are ASL or
  have non-commercial licences, and must not be mixed in.

**Not built yet:** `evaluate.py` only scores INCLUDE test clips, so evaluating on `own` clips is a
small addition to make once such recordings exist. The audit already counts usable own recordings.
