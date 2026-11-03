FROM python:3.12-slim
# slim already carries ca-certificates and tzdata; only the standard library is used.
ENV TZ=Europe/Stockholm \
    PYTHONUNBUFFERED=1 \
    OUT_DIR=/app/data \
    PORT=8080 \
    INTERVALL_MIN=30

WORKDIR /app
COPY flexmassage_tider.py server.py mall.html VERSION ./
COPY ds ./ds
# CI passes APP_VERSION (0.<minor>.<run number>); a local build falls back to the
# VERSION file. The build time is written next to it for /api/version.
ARG APP_VERSION=
RUN if [ -n "$APP_VERSION" ]; then echo "$APP_VERSION" > VERSION; fi \
    && date -u +%Y-%m-%dT%H:%MZ > BUILT
# Non-root: the app writes only /app/data (no volume; recreated at every start).
RUN useradd --system --uid 10001 --user-group --no-create-home appuser \
    && mkdir -p /app/data && chown appuser:appuser /app/data
USER appuser

EXPOSE 8080
# /healthz checks that /app/data is writable (503 otherwise). slim has no wget.
HEALTHCHECK --interval=60s --timeout=5s --start-period=10s \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8080/healthz', timeout=4)" || exit 1
CMD ["python", "server.py"]
