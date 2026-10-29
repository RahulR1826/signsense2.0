import type { NextConfig } from "next";

// Baseline security headers. A full Content-Security-Policy is not set yet: ONNX Runtime (WASM),
// MediaPipe and the separate API origin need a carefully tested policy (see docs/DEVELOPMENT_LOG.md).
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
  // Only this site may use the camera and microphone; nothing needs location.
  { key: "Permissions-Policy", value: "camera=(self), microphone=(self), geolocation=()" },
];

const nextConfig: NextConfig = {
  // The dev-only route badge sat on top of the call controls on phones; build errors still show.
  devIndicators: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
