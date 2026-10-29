# SignSense API (FastAPI). Build context: repository root (needs ml/vocabulary.json).
FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app/backend

COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/ .
COPY ml/vocabulary.json /app/ml/vocabulary.json

# Production defaults; override with environment variables.
ENV ENABLE_DEV_TOOLS=false

# Don't run as root.
RUN useradd --system --uid 10001 signsense && chown -R signsense /app
USER signsense

EXPOSE 8000
HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=5 \
  CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/api/health/db', timeout=2).status == 200 else 1)"
# Apply migrations (idempotent), then serve. `exec` makes uvicorn PID 1 so it receives SIGTERM from
# `docker stop` and shuts down gracefully (closing WebSockets) instead of being killed after 10 s.
CMD ["sh", "-c", "alembic upgrade head && exec uvicorn app.main:app --host 0.0.0.0 --port 8000 --proxy-headers --timeout-graceful-shutdown 10"]
