// Backend URL. NEXT_PUBLIC_API_URL wins when set (production); otherwise the backend is assumed to run
// on port 8000 of whatever host served this page — so a phone opening https://<laptop-ip>:3000 talks to
// https://<laptop-ip>:8000 without any config change.
export const API_URL =
  process.env.NEXT_PUBLIC_API_URL ||
  (typeof window !== "undefined" ? `${window.location.protocol}//${window.location.hostname}:8000` : "http://localhost:8000");
