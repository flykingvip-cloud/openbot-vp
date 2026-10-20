# OpenBot HA Dual Controller — production sidecar image.
# Opt-in via compose profile `ha` (see deploy/production/docker-compose.prod.yml).
# Default mode=manual; Production Auto Failover remains NOT APPROVED.
FROM python:3.12-slim-bookworm

WORKDIR /app/ha

COPY requirements.txt /tmp/ha-controller-requirements.txt
RUN pip install --no-cache-dir -r /tmp/ha-controller-requirements.txt \
  && rm /tmp/ha-controller-requirements.txt

# Package imported as `controller` when PYTHONPATH=/app/ha
COPY . /app/ha/controller

ENV PYTHONPATH=/app/ha \
    HA_CONTROLLER_MODE=manual \
    HA_CONTROLLER_HEARTBEAT_INTERVAL_SEC=5 \
    HA_CONTROLLER_LOG=INFO \
    PYTHONDONTWRITEBYTECODE=1

# non-root
RUN useradd --system --uid 10001 --home /app --shell /usr/sbin/nologin openbot \
  && chown -R openbot:openbot /app
USER openbot

# Sidecar: lease heartbeat only. Manual failover remains an explicit CLI action.
CMD ["python", "-m", "controller", "heartbeat-loop"]
