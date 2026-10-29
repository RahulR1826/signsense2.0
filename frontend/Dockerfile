# SignSense web app (Next.js). Build context: repository root (needs ../sign-library).
FROM node:24-alpine AS build
WORKDIR /app/frontend

COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

COPY frontend/ .
COPY sign-library/ /app/sign-library/
# MediaPipe + ONNX Runtime WASM, landmark models (downloaded from Google's model storage), sign clips.
RUN npm run setup:runtime

# Leave empty to let the browser use <page host>:8000 (works for localhost and LAN demos); set it to the
# public API origin (https://api.example.com) for a real deployment.
ARG NEXT_PUBLIC_API_URL=
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
RUN npm run build

FROM node:24-alpine
WORKDIR /app/frontend
ENV NODE_ENV=production
COPY --from=build --chown=node:node /app/frontend ./
USER node
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=5 \
  CMD wget -qO /dev/null http://127.0.0.1:3000/ || exit 1
# Run Next directly (not via npm) so it receives SIGTERM and shuts down cleanly.
CMD ["node_modules/.bin/next", "start", "-p", "3000"]
