export type MediaError = "denied" | "not_found" | "in_use" | "other";

export function mediaErrorKind(err: unknown): MediaError {
  const name = err instanceof DOMException ? err.name : "";
  if (name === "NotAllowedError") return "denied";
  if (name === "NotFoundError" || name === "OverconstrainedError") return "not_found";
  if (name === "NotReadableError") return "in_use";
  return "other";
}

export const MEDIA_ERROR_TEXT: Record<MediaError, string> = {
  denied:
    "Camera and microphone are blocked. Click the camera icon in the address bar, choose Allow, then reload. You can also join without them.",
  not_found: "No camera or microphone found. You can still join, see the other person and use chat and pictures.",
  in_use: "Your camera is being used by another app or tab. Close it, then reload this page.",
  other: "Your camera or microphone couldn't start. Reload the page and try again — Chrome or Edge work best.",
};

/** Camera + microphone tuned for signing: smooth motion matters more than resolution. */
export async function getLocalMedia(): Promise<MediaStream> {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30 } },
    audio: { echoCancellation: true, noiseSuppression: true },
  });
  for (const track of stream.getVideoTracks()) track.contentHint = "motion";
  return stream;
}

/**
 * Dev-only stand-in for a webcam (open a meeting with ?fake=1): an animated test pattern plus a quiet
 * tone, so calls can be tested where no camera is available (e.g. automated browsers).
 */
export function getFakeMedia(label: string): MediaStream {
  const canvas = document.createElement("canvas");
  canvas.width = 640;
  canvas.height = 480;
  const ctx = canvas.getContext("2d")!;
  const start = performance.now();
  const hue = [...label].reduce((h, c) => h + c.charCodeAt(0), 0) % 360;
  const draw = () => {
    const t = (performance.now() - start) / 1000;
    ctx.fillStyle = `hsl(${hue} 40% 20%)`;
    ctx.fillRect(0, 0, 640, 480);
    ctx.fillStyle = `hsl(${hue} 80% 60%)`;
    ctx.beginPath();
    ctx.arc(320 + Math.sin(t * 2) * 200, 240 + Math.cos(t * 3) * 120, 40, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "white";
    ctx.font = "28px sans-serif";
    ctx.fillText(`TEST CAMERA · ${label}`, 24, 44);
    ctx.fillText(t.toFixed(1) + " s", 24, 456);
  };
  draw();
  const timer = setInterval(draw, 1000 / 30);
  const video = canvas.captureStream(30);
  video.getVideoTracks()[0].addEventListener("ended", () => clearInterval(timer));

  const audioCtx = new AudioContext();
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  gain.gain.value = 0.02;
  osc.frequency.value = 440;
  const dest = audioCtx.createMediaStreamDestination();
  osc.connect(gain).connect(dest);
  osc.start();

  return new MediaStream([...video.getVideoTracks(), ...dest.stream.getAudioTracks()]);
}

/**
 * Dev-only: a looping video file as the "camera" (open a meeting with ?fakevideo=<sign>/<file>, using an
 * INCLUDE clip served by the backend). Lets the whole sign pipeline be tested end to end in a real call.
 */
export async function getVideoFileMedia(url: string): Promise<MediaStream> {
  const video = document.createElement("video");
  video.crossOrigin = "anonymous"; // captureStream() refuses cross-origin video without CORS
  video.muted = true;
  video.loop = true;
  video.playsInline = true;
  video.src = url;
  await video.play();
  const capture = (video as HTMLVideoElement & { captureStream(): MediaStream }).captureStream();
  const tracks = capture.getVideoTracks();
  tracks.forEach((t) => {
    t.contentHint = "motion";
    t.addEventListener("ended", () => video.pause());
  });
  return new MediaStream(tracks);
}

export function stopMedia(stream: MediaStream | null) {
  stream?.getTracks().forEach((t) => t.stop());
}

/** Camera only (no microphone): for practising signs outside a call. Same tuning as calls. */
export async function getCameraOnly(): Promise<MediaStream> {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30 } },
    audio: false,
  });
  for (const track of stream.getVideoTracks()) track.contentHint = "motion";
  return stream;
}
