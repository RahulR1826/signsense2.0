# SignSense 2.0 --- Complete Project Specification

## 1. Project Overview

**Project Name:** SignSense 2.0

**Project Type:** AI/ML-powered real-time accessibility communication
platform

**Primary Goal:**

Build a web-based video communication platform that enables people who
communicate using Indian Sign Language (ISL) to communicate naturally
with people who do not understand sign language.

SignSense 2.0 provides **bidirectional communication**:

1.  **Sign Language → Text**
2.  **Text → Sign Representation**
3.  Both users can be sign-language users and communicate with each
    other.
4.  All communication happens inside a real-time video call.

The first version should be a fully working web application. The
architecture must be modular so that the ML model can be improved
independently without rewriting the video-call system.

------------------------------------------------------------------------

# 2. Core Product Concept

Normal communication:

``` text
Person A speaks
        ↓
Person B hears
```

SignSense:

``` text
Person A signs
        ↓
Computer Vision + ML
        ↓
ISL Recognition
        ↓
Text
        ↓
Person B reads
```

Reverse communication:

``` text
Person B types text
        ↓
NLP / Sign Mapping
        ↓
ISL Sign Sequence
        ↓
Sign Images / Video Clips / Animation
        ↓
Person A understands
```

If both users know sign language:

``` text
Person A Camera
      ↓
Sign Recognition
      ↓
Text / Sign Representation
      ↓
Person B

Person B Camera
      ↓
Sign Recognition
      ↓
Text / Sign Representation
      ↓
Person A
```

------------------------------------------------------------------------

# 3. Product Vision

SignSense 2.0 should feel like a real video communication product rather
than an ML demonstration.

The final web application should provide:

-   Account creation / login
-   User communication preference
-   Meeting creation
-   Meeting code
-   Join meeting
-   Real-time video call
-   Camera controls
-   Microphone controls
-   Participant management
-   Real-time sign recognition
-   Sign-to-text translation
-   Text-to-sign communication
-   Sign-language user mode
-   Non-signer mode
-   Both-signer mode
-   Translation overlays
-   Sign confidence indicators
-   Sign playback
-   Accessible UI

------------------------------------------------------------------------

# 4. Target Users

## User Type A --- Sign-language user

A user who primarily communicates using Indian Sign Language.

Capabilities:

-   Video call
-   Sign to communicate
-   See detected sign text from the other participant
-   Read text sent by another participant
-   View text as ISL sign representation

## User Type B --- Non-signer

A user who does not know sign language.

Capabilities:

-   Video call
-   Speak normally
-   Type text
-   Read translated sign-language text
-   View incoming text as ISL sign representation

## User Type C --- Sign-language user ↔ Sign-language user

Both participants use sign language.

Capabilities:

-   Both cameras perform sign recognition
-   Each user's signs are converted into text for the other participant
-   Both users can communicate through the same pipeline

------------------------------------------------------------------------

# 5. User Onboarding

Before joining a meeting, ask the user's communication preference.

Example:

``` text
How do you communicate?

[ I use Sign Language ]
[ I don't use Sign Language ]
[ Both ]
```

If the user selects sign language:

``` text
Preferred Sign Language

[ Indian Sign Language ]
```

Communication options:

``` text
[x] Sign → Text
[x] Text → Sign
```

Store the preference in the user's profile.

This preference is used to configure the call UI.

------------------------------------------------------------------------

# 6. Complete Application Workflow

## Stage 1 --- Landing Page

User opens SignSense.

Show:

-   Product name
-   Short explanation
-   Accessibility purpose
-   Create meeting
-   Join meeting
-   Login / signup

Example:

``` text
SignSense

Communication without barriers.

Real-time video communication with
AI-powered Indian Sign Language assistance.

[ Create Meeting ]
[ Join Meeting ]
```

------------------------------------------------------------------------

# 7. Authentication

Users should be able to:

-   Sign up
-   Login
-   Logout
-   Maintain communication preferences

Authentication can initially use:

-   Email + password
-   Secure session/JWT

Do not over-engineer authentication in the first phase.

------------------------------------------------------------------------

# 8. Meeting Creation

A logged-in user selects:

``` text
Create Meeting
```

Backend creates a unique meeting code.

Example:

``` text
SS-7F4K2
```

Meeting state:

``` text
meeting_id
creator_id
created_at
status
```

The creator receives:

``` text
Meeting created

Code:
SS-7F4K2

[ Copy Code ]
[ Join Meeting ]
```

------------------------------------------------------------------------

# 9. Joining a Meeting

A participant enters:

``` text
Meeting Code:
[ SS-7F4K2 ]

[ Join ]
```

Backend verifies that the meeting exists.

Then request:

-   Camera permission
-   Microphone permission

Show a pre-join screen.

------------------------------------------------------------------------

# 10. Pre-Join Screen

Example:

``` text
Your camera

┌────────────────────────┐
│                        │
│       CAMERA           │
│                        │
└────────────────────────┘

Camera: ON
Microphone: ON

Communication mode:
Sign Language

[ Join Meeting ]
```

Allow users to change:

-   Camera
-   Microphone
-   Communication mode

------------------------------------------------------------------------

# 11. Video Call Interface

The main interface should feel similar to Google Meet/Zoom but be
purpose-built for SignSense.

Example:

``` text
┌─────────────────────────────────────────────────────┐
│ SignSense       Meeting: SS-7F4K2                   │
├────────────────────────┬────────────────────────────┤
│                        │                            │
│       USER A           │          USER B            │
│                        │                            │
│      [ CAMERA ]        │        [ CAMERA ]          │
│                        │                            │
│      Signing...        │        Speaking...         │
│                        │                            │
├────────────────────────┴────────────────────────────┤
│                                                    │
│ SIGN TRANSLATION                                   │
│                                                    │
│ "I NEED HELP"                                      │
│                                                    │
│ Confidence: 94%                                   │
│                                                    │
├────────────────────────────────────────────────────┤
│ [Camera] [Mic] [Sign Mode] [Chat] [Settings]      │
│                                     [Leave]        │
└────────────────────────────────────────────────────┘
```

------------------------------------------------------------------------

# 12. Video Communication Architecture

Use **WebRTC** for real-time media.

Do NOT send the entire video stream through the backend.

Architecture:

``` text
Browser A
   │
   │ WebRTC
   │
   ├───────────────┐
   │               │
   ▼               ▼
Browser B       Signaling Server
```

WebRTC handles:

-   Video
-   Audio
-   Peer connection
-   Data channels

Backend handles:

-   Meeting creation
-   Authentication
-   Signaling
-   Participant state
-   Translation events
-   User preferences

------------------------------------------------------------------------

# 13. Signaling

Use WebSocket for signaling.

Example:

``` text
User A
  ↓
WebSocket
  ↓
Signaling Server
  ↓
User B
```

Signaling messages:

``` json
{
  "type": "offer"
}
```

``` json
{
  "type": "answer"
}
```

``` json
{
  "type": "ice-candidate"
}
```

Do not confuse signaling with media transport.

------------------------------------------------------------------------

# 14. WebRTC DataChannel

Use a WebRTC DataChannel for low-latency application messages.

This can carry:

-   Sign translation
-   Text messages
-   Sign metadata
-   Confidence scores
-   Typing state
-   UI events

Example:

``` json
{
  "type": "sign_translation",
  "gloss": ["I", "NEED", "HELP"],
  "text": "I need help.",
  "confidence": 0.94,
  "timestamp": 1780000000
}
```

------------------------------------------------------------------------

# 15. Critical ML Architecture

The sign recognition model should preferably run **locally in the user's
browser/device**.

Do NOT build:

``` text
Camera
 ↓
Upload video to server
 ↓
Server ML
 ↓
Text
```

Preferred:

``` text
Camera
 ↓
Browser
 ↓
Landmark extraction
 ↓
Local ML inference
 ↓
Sign
 ↓
Text
 ↓
WebRTC DataChannel
 ↓
Other participant
```

Benefits:

-   Lower latency
-   Better privacy
-   Less bandwidth
-   Better scalability
-   No unnecessary video upload
-   Works closer to real-time

------------------------------------------------------------------------

# 16. Sign Recognition Pipeline

Initial architecture:

``` text
Webcam
   ↓
Video Frames
   ↓
MediaPipe
   ↓
Hand + Pose Landmarks
   ↓
Feature Normalization
   ↓
Temporal Buffer
   ↓
Temporal ML Model
   ↓
ISL Sign / Gloss
   ↓
Sentence Reconstruction
   ↓
Final Text
```

------------------------------------------------------------------------

# 17. Computer Vision Layer

Use:

-   MediaPipe
-   OpenCV

Primary goal:

Extract:

-   Left hand landmarks
-   Right hand landmarks
-   Body pose landmarks
-   Optional face landmarks

Example:

``` text
Frame
 ↓
MediaPipe Holistic
 ↓
Left Hand: 21 landmarks
Right Hand: 21 landmarks
Pose: 33 landmarks
```

Convert landmarks to normalized numerical features.

Avoid depending on raw RGB frames initially.

------------------------------------------------------------------------

# 18. Why Landmark-Based ML

Instead of:

``` text
Raw video
 ↓
Large neural network
```

use:

``` text
Video
 ↓
Landmarks
 ↓
Compact feature sequence
 ↓
Temporal model
```

Advantages:

-   Smaller model
-   Faster inference
-   Easier training
-   Easier browser deployment
-   Better privacy
-   Less GPU dependency

------------------------------------------------------------------------

# 19. ML Model Strategy

Do not start with a huge model.

Build progressively.

## Baseline

Use:

-   LSTM
-   GRU

Purpose:

-   Validate dataset
-   Validate preprocessing
-   Establish baseline accuracy

## Final primary model

Use:

**Temporal Transformer**

Input:

``` text
T × F
```

Where:

-   T = number of frames
-   F = landmark feature dimension

Output:

``` text
Sign class / gloss sequence
```

Potential architecture:

``` text
Landmark Sequence
       ↓
Feature Projection
       ↓
Positional Encoding
       ↓
Temporal Transformer
       ↓
Classification Head
       ↓
ISL Gloss
```

------------------------------------------------------------------------

# 20. Continuous Sign Recognition

This is the most important ML upgrade.

Do not only support:

``` text
One gesture → One word
```

The final system should work toward:

``` text
Continuous signing
       ↓
Temporal model
       ↓
HELLO
MY
NAME
IS
RAHUL
```

Then:

``` text
ISL Gloss
 ↓
Sentence Reconstruction
 ↓
"My name is Rahul."
```

------------------------------------------------------------------------

# 21. Controlled Vocabulary Strategy

Do not attempt unrestricted ISL immediately.

Start with:

### Phase A

30--50 signs.

### Phase B

100 signs.

### Phase C

200--250 signs.

### Phase D

Continuous sentence recognition.

The vocabulary should prioritize useful communication:

-   Hello
-   Thank you
-   Yes
-   No
-   Help
-   Water
-   Food
-   Where
-   What
-   Why
-   Who
-   Need
-   Want
-   Come
-   Go
-   Stop
-   Emergency
-   Hospital
-   Home
-   Name
-   Family
-   Doctor
-   Police
-   Sorry
-   Please

The exact vocabulary should be finalized after dataset availability is
verified.

------------------------------------------------------------------------

# 22. ISL vs English

Do NOT assume:

``` text
English word → identical ISL sign
```

Sign languages have their own grammar and structure.

Architecture should distinguish:

``` text
Video
 ↓
ISL Recognition
 ↓
ISL Gloss
 ↓
Natural Language Reconstruction
```

and reverse:

``` text
Natural Language
 ↓
ISL Gloss / Sign Sequence
 ↓
Sign Representation
```

This distinction is important for technical correctness.

------------------------------------------------------------------------

# 23. Sentence Reconstruction

Example:

``` text
Detected Gloss:

I NEED HELP
```

NLP layer:

``` text
ISL Gloss
 ↓
Sentence Reconstruction
 ↓
"I need help."
```

The NLP layer should not invent information.

It should only normalize/reconstruct the recognized signs.

------------------------------------------------------------------------

# 24. Sign-to-Text Display

The receiving user should see:

``` text
Rahul is signing...

"I NEED HELP"

Confidence: 94%
```

For low-confidence predictions:

``` text
Possible translation:

"I NEED HELP"

Confidence: 61%

[ Correct ]
[ Ignore ]
```

Do not silently present low-confidence predictions as fact.

------------------------------------------------------------------------

# 25. Text-to-Sign Architecture

Reverse pipeline:

``` text
User Text
    ↓
Text Normalization
    ↓
NLP / ISL Gloss Mapping
    ↓
Sign Sequence
    ↓
Sign Renderer
```

Example:

``` text
"I need help."

↓

I + NEED + HELP

↓

I.mp4
NEED.mp4
HELP.mp4
```

------------------------------------------------------------------------

# 26. Text-to-Sign Implementation Levels

## Level 1 --- Static sign images

``` text
Text
 ↓
Gloss
 ↓
Sign images
```

Easy and reliable.

## Level 2 --- Pre-recorded sign clips

``` text
Text
 ↓
Gloss
 ↓
Sign video clips
 ↓
Sequential playback
```

Recommended first production implementation.

## Level 3 --- Animated avatar

``` text
Text
 ↓
ISL Gloss
 ↓
Pose Sequence
 ↓
3D Avatar
 ↓
Animated signing
```

This is a future advanced feature.

Do not make the avatar a dependency for the first working release.

------------------------------------------------------------------------

# 27. Sign Library

Create a structured sign library.

Example:

``` text
sign-library/
├── hello/
│   ├── image.png
│   ├── video.mp4
│   └── metadata.json
├── help/
│   ├── image.png
│   ├── video.mp4
│   └── metadata.json
├── water/
│   ├── image.png
│   ├── video.mp4
│   └── metadata.json
```

Metadata:

``` json
{
  "gloss": "HELP",
  "language": "ISL",
  "category": "emergency",
  "image": "help/image.png",
  "video": "help/video.mp4"
}
```

------------------------------------------------------------------------

# 28. Both Users Signing

If both users select sign-language mode:

``` text
User A Camera
      ↓
Local Sign ML
      ↓
Text A
      ↓
WebRTC DataChannel
      ↓
User B

User B Camera
      ↓
Local Sign ML
      ↓
Text B
      ↓
WebRTC DataChannel
      ↓
User A
```

Each participant independently runs their own recognition pipeline.

------------------------------------------------------------------------

# 29. Communication Modes

The UI should support:

### Mode 1 --- Signer → Non-signer

``` text
Sign → Text
```

### Mode 2 --- Non-signer → Signer

``` text
Text → Sign
```

### Mode 3 --- Signer ↔ Signer

``` text
Sign → Text
Sign → Text
```

### Mode 4 --- Hybrid

One participant can use:

-   Speech
-   Text
-   Sign

The other can use:

-   Sign
-   Text

------------------------------------------------------------------------

# 30. Frontend Tech Stack

Recommended:

``` text
Next.js
TypeScript
React
Tailwind CSS
shadcn/ui
WebRTC APIs
WebSocket
MediaDevices API
```

Optional:

``` text
Zustand
React Query / TanStack Query
```

Do not add libraries without a clear requirement.

------------------------------------------------------------------------

# 31. Backend Tech Stack

Recommended:

``` text
Python
FastAPI
WebSocket
PostgreSQL
SQLAlchemy
Pydantic
JWT authentication
```

Optional:

``` text
Redis
```

Redis should only be introduced if real-time state/scaling requires it.

------------------------------------------------------------------------

# 32. ML Tech Stack

``` text
Python
PyTorch
MediaPipe
OpenCV
NumPy
scikit-learn
Pandas
```

For deployment:

``` text
ONNX
ONNX Runtime Web
```

Potentially:

``` text
TensorFlow.js
```

But choose **one browser inference route**, not both, unless there is a
concrete reason.

------------------------------------------------------------------------

# 33. Data and Model Tools

Recommended:

``` text
Jupyter
Python
Git
GitHub
Weights & Biases or MLflow
```

Use experiment tracking for:

-   Dataset version
-   Model version
-   Accuracy
-   F1
-   Confusion matrix
-   Training parameters
-   Inference latency

------------------------------------------------------------------------

# 34. Database

Use PostgreSQL.

Possible tables:

``` text
users
meetings
participants
communication_preferences
translation_events
sign_dictionary
```

Do not store raw video by default.

------------------------------------------------------------------------

# 35. Suggested Database Schema

## users

``` text
id
name
email
password_hash
created_at
```

## communication_preferences

``` text
id
user_id
uses_sign_language
preferred_sign_language
sign_to_text_enabled
text_to_sign_enabled
```

## meetings

``` text
id
meeting_code
host_id
created_at
status
```

## participants

``` text
id
meeting_id
user_id
joined_at
left_at
```

## translation_events

``` text
id
meeting_id
sender_id
type
gloss
text
confidence
timestamp
```

Translation events can be retained only if there is a clear
product/privacy reason.

------------------------------------------------------------------------

# 36. Project Folder Structure

Recommended:

``` text
signsense/
│
├── frontend/
│   ├── app/
│   ├── components/
│   ├── hooks/
│   ├── lib/
│   ├── services/
│   ├── store/
│   └── types/
│
├── backend/
│   ├── app/
│   │   ├── api/
│   │   ├── models/
│   │   ├── schemas/
│   │   ├── services/
│   │   ├── websocket/
│   │   └── core/
│   └── tests/
│
├── ml/
│   ├── datasets/
│   ├── preprocessing/
│   ├── features/
│   ├── models/
│   ├── training/
│   ├── evaluation/
│   ├── inference/
│   └── export/
│
├── sign-library/
│   ├── images/
│   ├── videos/
│   └── metadata/
│
├── docs/
│
├── scripts/
│
├── docker-compose.yml
├── README.md
└── .gitignore
```

------------------------------------------------------------------------

# 37. Development Phases

## Phase 0 --- Research and Feasibility

Before writing application code:

1.  Verify available ISL datasets.
2.  Verify licensing/usage permissions.
3.  Determine whether vocabulary is sufficient.
4.  Test MediaPipe landmark extraction.
5.  Train a small baseline model.
6.  Measure recognition accuracy.
7.  Measure inference latency.
8.  Decide browser inference strategy.

**Do not skip this phase.**

------------------------------------------------------------------------

# 38. Phase 1 --- Video Calling Foundation

Build:

-   Landing page
-   Authentication
-   Create meeting
-   Join meeting
-   Meeting code
-   Camera
-   Microphone
-   WebRTC
-   WebSocket signaling
-   Participant UI
-   Leave meeting

Acceptance criteria:

-   Two browsers can join the same meeting.
-   Both users can see each other.
-   Both users can hear each other.
-   Camera and microphone can be toggled.
-   Meeting code works reliably.

------------------------------------------------------------------------

# 39. Phase 2 --- Text Communication

Add:

-   Chat
-   WebRTC DataChannel
-   Real-time text messages
-   Translation overlay component

Acceptance criteria:

``` text
User A types:
"Hello"

User B receives:
"Hello"
```

with low latency.

------------------------------------------------------------------------

# 40. Phase 3 --- Sign Recognition Prototype

Build:

``` text
Camera
 ↓
MediaPipe
 ↓
Landmarks
 ↓
Temporal buffer
 ↓
Baseline model
 ↓
Sign prediction
```

Start with 10--20 signs.

Acceptance criteria:

-   Model runs live.
-   Prediction appears on screen.
-   Confidence is shown.
-   False predictions are not continuously emitted.
-   Prediction latency is acceptable.

------------------------------------------------------------------------

# 41. Phase 4 --- Sign ML Improvement

Expand vocabulary.

Target:

``` text
50 → 100 → 200+
```

Implement:

-   Temporal Transformer
-   Confidence threshold
-   Prediction smoothing
-   Sequence segmentation
-   Debouncing
-   Unknown class
-   Sign transition handling

Acceptance criteria:

-   Stable predictions.
-   No repeated output every frame.
-   Reasonable real-time latency.
-   Proper handling of "unknown/no sign".

------------------------------------------------------------------------

# 42. Phase 5 --- Integrate Sign Recognition into Video Call

When User A signs:

``` text
Camera
 ↓
Local ML
 ↓
Sign
 ↓
Text
 ↓
DataChannel
 ↓
User B
```

User B sees:

``` text
Rahul is signing:

"I NEED HELP"
```

Acceptance criteria:

-   Translation appears in real time.
-   Sender camera remains smooth.
-   Receiver sees translation.
-   Raw video is not uploaded for recognition.
-   Sign recognition can be toggled on/off.

------------------------------------------------------------------------

# 43. Phase 6 --- Text-to-Sign

Start with:

``` text
Text
 ↓
Gloss lookup
 ↓
Sign image
```

Then upgrade:

``` text
Text
 ↓
Gloss
 ↓
Sign clips
 ↓
Sequential playback
```

Acceptance criteria:

-   Common phrases produce correct sign sequences.
-   Unknown words are handled gracefully.
-   Sign playback is synchronized and understandable.

------------------------------------------------------------------------

# 44. Phase 7 --- Both-Signer Mode

Test:

``` text
User A signs
       ↓
User B sees text

User B signs
       ↓
User A sees text
```

Acceptance criteria:

-   Both users can independently activate recognition.
-   Translations are attributed to the correct participant.
-   Simultaneous recognition does not break the call.

------------------------------------------------------------------------

# 45. Phase 8 --- Continuous Sentence Recognition

Upgrade from isolated signs:

``` text
HELLO
```

to:

``` text
HELLO MY NAME IS RAHUL
```

Pipeline:

``` text
Continuous video
 ↓
Sign segmentation
 ↓
Temporal model
 ↓
Gloss sequence
 ↓
Sentence reconstruction
```

This is one of the main research/ML components of SignSense 2.0.

------------------------------------------------------------------------

# 46. Phase 9 --- Advanced Sign Generation

Optional advanced phase:

``` text
Text
 ↓
ISL Gloss
 ↓
Pose sequence
 ↓
3D Avatar
 ↓
Animated signing
```

Only implement after the sign-video system is stable.

------------------------------------------------------------------------

# 47. ML Evaluation

Do not evaluate only with accuracy.

Measure:

### Classification

-   Accuracy
-   Precision
-   Recall
-   F1-score
-   Confusion matrix

### Continuous recognition

-   Word Error Rate
-   Sequence accuracy
-   Sign segmentation accuracy

### Real-time system

-   Inference latency
-   End-to-end translation latency
-   FPS
-   CPU usage
-   Memory usage

### Communication

-   Translation delivery latency
-   WebRTC latency
-   Packet loss handling

------------------------------------------------------------------------

# 48. Target Real-Time Performance

Initial targets:

``` text
Camera processing:
20–30 FPS

Landmark extraction:
< 50 ms/frame where possible

ML inference:
< 100 ms per prediction window where possible

Translation delivery:
< 300–500 ms target

Video:
Smooth real-time playback
```

These are engineering targets, not guaranteed numbers.

Benchmark on real hardware.

------------------------------------------------------------------------

# 49. Important ML Challenges

## Challenge 1 --- Dataset

The most important issue.

Need:

-   Enough ISL signs
-   Multiple people
-   Different lighting
-   Different backgrounds
-   Different camera angles
-   Left/right hand variation
-   Different signing speeds

## Challenge 2 --- Continuous signing

Isolated sign recognition is much easier than continuous recognition.

## Challenge 3 --- Facial/body information

Some signs depend on:

-   Hand
-   Pose
-   Face
-   Head movement

Therefore the system should not assume that hand landmarks alone are
always sufficient.

## Challenge 4 --- User variation

The same sign may look different across people.

## Challenge 5 --- Real-time inference

The model must be small enough for practical browser execution.

## Challenge 6 --- Sign-language grammar

Do not treat ISL as English with hand gestures.

## Challenge 7 --- Text-to-sign coverage

Not every arbitrary sentence will have a simple one-to-one word mapping.

------------------------------------------------------------------------

# 50. Privacy Requirements

SignSense handles camera and potentially sensitive communication.

Principles:

-   Prefer local ML inference.
-   Do not upload raw camera frames for sign recognition.
-   Do not store video recordings by default.
-   Do not store translation content unless necessary.
-   Clearly request camera/microphone permissions.
-   Use HTTPS/WSS in production.
-   Secure authentication.
-   Validate all WebSocket messages.
-   Sanitize user-generated text.

------------------------------------------------------------------------

# 51. Deployment Architecture

Initial development:

``` text
Browser
   ↓
Next.js
   ↓
FastAPI
   ↓
PostgreSQL
```

ML:

``` text
Browser
 ↓
ONNX Runtime Web
 ↓
Local inference
```

Production:

``` text
                    Internet
                       │
              ┌────────┴────────┐
              │                 │
          Frontend          Backend
          Next.js           FastAPI
              │                 │
              │             PostgreSQL
              │
              └──── WebRTC ────┘
```

For larger deployments, introduce a proper TURN server for WebRTC
connectivity.

------------------------------------------------------------------------

# 52. TURN/STUN

WebRTC will not always connect peer-to-peer directly.

Use:

-   STUN server
-   TURN server

For development, a public STUN server can be used.

For production, deploy/manage a TURN service such as coturn.

Architecture:

``` text
Browser A
    │
    ├── Direct WebRTC ── Browser B
    │
    └── TURN fallback ── Browser B
```

------------------------------------------------------------------------

# 53. Security

Implement:

-   Password hashing
-   JWT/session security
-   HTTPS
-   WSS
-   Meeting authorization
-   Meeting code validation
-   Rate limiting
-   Input validation
-   Secure CORS
-   Environment variables for secrets

Never hard-code:

-   Database credentials
-   JWT secrets
-   TURN credentials
-   API keys

------------------------------------------------------------------------

# 54. What NOT to Build First

Do not start with:

-   3D avatar
-   Full unrestricted ISL translation
-   Huge transformer trained from scratch
-   Cloud video processing
-   Mobile apps
-   Complex social features
-   Recording
-   Payments
-   AI chatbot

First make:

``` text
Video call
+
Sign → Text
+
Text → Sign clips
+
Both users signing
```

fully reliable.

------------------------------------------------------------------------

# 55. Definition of "Fully Working"

The project is considered a successful first production version only
when:

### Video

-   Two users can create/join a meeting.
-   Camera works.
-   Microphone works.
-   Participants can see/hear each other.
-   Call can be left cleanly.

### Sign → Text

-   Sign-language user enables sign recognition.
-   Camera landmarks are extracted locally.
-   ML recognizes supported signs.
-   Text is generated.
-   Text reaches the other participant.
-   Receiver sees the translation in real time.

### Text → Sign

-   Receiver enters text.
-   Text is converted to supported ISL gloss/sign sequence.
-   Corresponding sign image/video is shown.
-   Signer can understand the generated representation.

### Signer ↔ Signer

-   Both users can enable sign recognition.
-   Both can receive translated text.

### Reliability

-   Unknown gestures do not generate random words.
-   Low confidence predictions are handled safely.
-   Network interruptions do not crash the application.
-   Camera permission denial is handled.
-   Model loading failure is handled.

------------------------------------------------------------------------

# 56. Recommended Initial Scope

The first complete release should target:

``` text
Web application
+
2-person video call
+
Authentication
+
Meeting code
+
WebRTC
+
ISL recognition
+
50–100 supported signs
+
Real-time sign → text
+
Text → sign video/image
+
Both-signer communication
+
Local ML inference
```

After that:

``` text
Continuous sentence recognition
+
200+ vocabulary
+
Better ISL grammar handling
+
Animated avatar
+
Mobile deployment
```

------------------------------------------------------------------------

# 57. Claude Development Rules

When using Claude to build this project:

1.  Do not generate the entire project in one step.
2.  Work phase-by-phase.
3.  Keep frontend, backend, and ML modules separated.
4.  Do not replace working components unnecessarily.
5.  Do not introduce a new dependency without explaining why it is
    needed.
6.  Do not hard-code credentials.
7.  Write tests for important backend functionality.
8.  Validate WebRTC independently before adding ML.
9.  Validate the ML model independently before integrating it into
    WebRTC.
10. Do not claim the ML system works without actually testing it.
11. Preserve existing working functionality when adding features.
12. Prefer simple reliable implementations over unnecessary complexity.
13. Keep the system modular.
14. Document major architecture decisions.
15. Never silently substitute ASL for ISL.
16. Verify dataset licensing before using datasets.
17. Never treat a low-confidence ML prediction as certain.
18. Make all ML components replaceable.

------------------------------------------------------------------------

# 58. Claude's Required Development Workflow

For every phase:

``` text
1. Understand current repository
2. Inspect existing code
3. Identify dependencies
4. Explain implementation plan
5. Implement small feature set
6. Run tests
7. Run/build the application
8. Fix errors
9. Verify functionality
10. Document changes
11. Only then move to next phase
```

Claude should not rewrite large parts of the application without a clear
reason.

------------------------------------------------------------------------

# 59. Final System Architecture

``` text
                         SIGN SENSE 2.0
                               │
                ┌──────────────┴──────────────┐
                │                             │
             FRONTEND                      BACKEND
             Next.js                       FastAPI
                │                             │
        ┌───────┼────────┐             ┌──────┼──────┐
        │       │        │             │      │      │
      WebRTC   ML      Text          Auth  Meeting  WS
        │       │        │             │      │      │
        │       │        │             └──────┼──────┘
        │       │        │                    │
        │       │        │                PostgreSQL
        │       │        │
        │       ▼        ▼
        │   Local ML   Sign Engine
        │       │        │
        │       ▼        ▼
        │   ISL Text   ISL Gloss
        │       │        │
        └───────┴────────┘
                │
         WebRTC DataChannel
                │
                ▼
          Other Participant
```

------------------------------------------------------------------------

# 60. Final Product Flow

``` text
USER OPENS SIGNSENSE
        ↓
LOGIN / SIGNUP
        ↓
SELECT COMMUNICATION MODE
        ↓
CREATE OR JOIN MEETING
        ↓
PRE-JOIN CAMERA SCREEN
        ↓
JOIN VIDEO CALL
        ↓
┌─────────────────────────────────────────────┐
│                                             │
│              REAL-TIME CALL                 │
│                                             │
│    User A                         User B    │
│                                             │
│    Camera                         Camera    │
│       │                              │      │
│       ▼                              ▼      │
│    Sign ML                         Sign ML  │
│       │                              │      │
│       ▼                              ▼      │
│     Text A                         Text B   │
│       │                              │      │
│       └────────── DataChannel ──────┘      │
│                                             │
│             TEXT ↔ SIGN                    │
│                                             │
└─────────────────────────────────────────────┘
        ↓
REAL-TIME ACCESSIBLE COMMUNICATION
```

------------------------------------------------------------------------

# 61. Success Criteria

SignSense 2.0 should ultimately demonstrate this complete scenario:

1.  User A creates a meeting.
2.  User B joins using the meeting code.
3.  Both users enter a real-time video call.
4.  User A identifies as an ISL user.
5.  User B identifies as a non-signer.
6.  User A signs a supported phrase.
7.  User A's browser extracts landmarks.
8.  The local ML model recognizes the sign sequence.
9.  The system generates text.
10. The translation is sent through the WebRTC DataChannel.
11. User B sees the translated text.
12. User B types a response.
13. SignSense converts the text into an ISL sign sequence.
14. The corresponding sign image/video is shown to User A.
15. User A understands the response.
16. If User B also enables sign recognition, both users can sign and
    receive translated text.
17. The entire process works inside the same video call.

------------------------------------------------------------------------

# 62. Long-Term Research Extensions

Once the core product is stable:

-   Continuous ISL recognition
-   Large vocabulary recognition
-   ISL grammar modeling
-   Facial expression recognition
-   Non-manual sign detection
-   Sign segmentation
-   Personalized sign recognition
-   On-device model quantization
-   ONNX/WebGPU inference
-   Mobile deployment
-   3D signing avatar
-   Pose-to-avatar generation
-   Sign-language translation models
-   Offline communication mode
-   Multi-party meetings
-   Accessibility analytics
-   Emergency communication mode

------------------------------------------------------------------------

# 63. Final Technical Principle

The project should be treated as three connected systems:

``` text
SYSTEM 1
Real-Time Communication
        ↓
WebRTC + WebSocket

SYSTEM 2
Sign Language Intelligence
        ↓
Computer Vision + Temporal ML + NLP

SYSTEM 3
Sign Generation
        ↓
NLP + ISL Gloss + Sign Media / Animation
```

Keep these systems modular.

The core product must work even if the ML model is replaced later.

The ML model must work independently of the video-call system.

The sign-generation engine must work independently of both.

This modular architecture is the foundation of SignSense 2.0.
