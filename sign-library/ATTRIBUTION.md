# Sign library attribution

Saathi's sign motions in `anim/` are derived from the **INCLUDE** dataset:

> Advaith Sridhar, Rohith Gandhi Ganesan, Pratyush Kumar, Mitesh Khapra.
> *INCLUDE: A Large Scale Dataset for Indian Sign Language Recognition.* ACM Multimedia 2020.
> https://zenodo.org/records/4010759 — licensed under **CC BY 4.0** (https://creativecommons.org/licenses/by/4.0/).

The signs were performed by Deaf students of St. Louis School for the Deaf, Adyar, Chennai.

**Changes made:**
- `anim/`: body, hand and face landmarks extracted from one clip per sign (MediaPipe), trimmed to the sign,
  gap-filled, smoothed and converted to body-relative coordinates. The face is reduced to a few controls
  (head position and tilt, brows, eyes, mouth); no image of the signer is kept. Saathi, a drawn character,
  performs the motion. Built by `ml/tools/build_sign_animations.py`; each file records its source clip.
- `anim3d/`, `saathi3d/`: the same motion with depth, performed by a 3D Saathi rendered in Blender
  (`ml/blender/saathi3d.py`, `ml/tools/render_saathi3d.py`). No image of the signers is used.
- `videos/`, `posters/` (trimmed, cropped, re-encoded clips; `ml/tools/build_sign_library.py`): kept for
  development only. **They are not served by the website**, because the signers did not consent to
  appearing on it.
