FROM python:3.12-alpine

RUN apk add --no-cache ca-certificates tzdata
ENV TZ=Europe/Stockholm \
    PYTHONUNBUFFERED=1 \
    OUT_DIR=/app/data \
    PORT=8080 \
    INTERVALL_MIN=30

WORKDIR /app
COPY flexmassage_tider.py server.py mall.html ./
RUN adduser -D -u 1000 app && mkdir -p /app/data && chown app /app/data
USER app

EXPOSE 8080
HEALTHCHECK --interval=60s --timeout=5s CMD wget -qO- http://127.0.0.1:8080/healthz || exit 1
CMD ["python", "server.py"]
