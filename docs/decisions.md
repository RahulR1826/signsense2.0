# Architecture decisions

Short log of decisions that change the original spec (`original-spec.md`). Newest last.

1. **Visual-first for Deaf users who may not read.** Sign clips / pictures are the primary output to the Deaf user; text-to-speech is the primary output to the hearing user. Text/captions are optional extras. Fingerspelling is not used as the unknown-word fallback (it requires literacy) — use pictures or a "not understood" signal instead.
2. **Speech → captions/sign added.** The non-signer usually speaks; Web Speech API first (Chrome; note: sends audio to Google), swappable for local Whisper later.
3. **Sender confirms low-confidence predictions**, not the receiver (the receiver can't know what was signed).
4. **Signer-independent evaluation is mandatory.** Train/test splits are by signer, never random.
5. **Training data is recorded in-app as landmarks** (no video), using the same browser MediaPipe build as live inference, to avoid train/serve skew.
6. **MediaPipe Tasks API** (Hand/Pose/Face landmarkers), not the legacy Holistic solution. OpenCV only for offline tooling.
7. **One browser runtime: ONNX Runtime Web**, inference in a Web Worker. No TensorFlow.js.
8. **Model choice is decided by evaluation**, starting from a GRU baseline; the Temporal Transformer is a candidate, not a requirement.
9. **Explicit sign segmentation first** (hands enter/leave a signing zone), continuous recognition is a later research track.
10. **PostgreSQL installed natively** (no Docker yet). A `docker-compose.yml` is added in M8.
11. **Async backend**: FastAPI + SQLAlchemy 2 async + asyncpg; Alembic for migrations.
12. **Landmark format v1** (`frontend/lib/landmarks/schema.ts`): per frame, person's own left/right hand (21×xyz), pose (33×xyz+visibility), 72-point face subset (lips, brows, eyes, nose). Unmirrored image coords. Hands are assigned to left/right by matching to pose wrists, not by MediaPipe's handedness label. Models pinned (hand f16 v1, pose **lite** f16 v1, face f16 v1); any change bumps `EXTRACTOR_VERSION` and means re-recording.
13. **Raw samples stored as JSON files** in `ml/data/raw/<sign>/<signer>/` (gitignored), written by the backend dataset API — not in Postgres, because the training pipeline reads files.
14. **M1 runs MediaPipe on the main thread** (requestVideoFrameCallback). Moving it to a Web Worker is deferred to M6, when it has to share the CPU with the call and the classifier; measure first.
15. **ROI crops for hands and face** (`frontend/lib/landmarks/crop.ts`, extractor `roi-crop-1`). Pose runs on the full frame; hands run on a smoothed square crop around the upper body and the face on a crop around the head, then landmarks are mapped back to full-frame coordinates. Reason: in INCLUDE's full-body 1080p videos the face was detected in 0% of frames (face ~100 px of 1920); with crops, 100%. Also helps users sitting far from their webcam. When the person already fills the frame, the full frame is used (no crop).
16. **INCLUDE import steps through every frame by seeking** (25 fps) with a fresh extractor per video, so tracking state never leaks between clips.
17. **1:1 calls, newcomer makes the WebRTC offer.** Server relays signaling only (`/ws/meetings/{code}`): Origin-checked, per-message size/rate limits, max 2 peers, participants logged (join/leave times only). ICE: Google public STUN for development; TURN (coturn, TLS on 443) is required before real users (M8).
18. **Signing-friendly video:** camera tracks get `contentHint = "motion"`, senders `degradationPreference = "maintain-framerate"`, and the other person's video is shown with `object-contain` (never cropped — cropping can cut off hands).
19. **Dev test camera:** `/m/<code>?fake=1` (non-production builds only) replaces the webcam with an animated test pattern + tone, so calls can be tested where no camera is available.
20. **Data-channel protocol** (`frontend/lib/call/messages.ts`): `hello` (name, mode, mic/cam state), `chat`, `caption` (interim/final speech-to-text), `sign` (gloss, text, confidence). Every incoming message is validated and length-limited; text is only ever rendered as text.
21. **Speech captions use the Web Speech API** (Chrome/Edge; audio goes to Google's speech service — labelled in the UI, behind the Captions toggle; on by default only for people who chose "speak"). Read-aloud uses local `speechSynthesis`. Indian languages selectable (en-IN, hi-IN, ta-IN, te-IN, bn-IN, mr-IN).
22. **In-call recognition runs on the main thread at 15 fps** (the model's sampling rate) with a timer loop on a detached video of the outgoing camera track. A Web Worker was not needed at this load; revisit if weak devices struggle.
23. **Signer confirms before sending:** ≥ 60% confidence → auto-send after a 2 s countdown (cancel / send now); below → never sent automatically, signer picks from the top 3 or dismisses.
24. **Dev video camera:** `/m/<code>?fakevideo=<sign>/<file>` (non-production) uses a looping INCLUDE clip as the camera to test the whole sign pipeline in a real call. Result 2026-10-20: 12/12 segments correct on 4 test-split clips.
25. **Sign clip library from INCLUDE** (`sign-library/`, CC BY 4.0, attribution in `sign-library/ATTRIBUTION.md` and on /signs): one train-split clip per sign, trimmed to the signing using the landmark data, cropped to the upper body, 480×480 H.264, no audio — 39 clips, 2.6 MB total. Built with `ml/tools/build_sign_library.py` (ffmpeg via `imageio-ffmpeg`). Test-split clips are never used for display.
26. **Text -> sign = word-by-word lookup** (`frontend/lib/signs/gloss.ts`): phrase-first matching, English + common Hindi / Indian-English words, function words dropped, unknown words shown as text cards (never fingerspelled). Speaker's word order, not ISL grammar — stated in the UI.
27. **Picture board** (18 AAC-style tiles: yes/no/help/pain/water/food/toilet/…) sends short messages that the other side hears read aloud; works without reading or signing.
