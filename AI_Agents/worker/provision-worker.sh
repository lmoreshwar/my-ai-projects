#!/usr/bin/env bash
# ------------------------------------------------------------------------------
# B.L.A.S.T. remote worker — ONE-TIME provisioning for a fresh Ubuntu VM
# (tested for Oracle Cloud "Always Free" Ampere ARM / any Ubuntu 22.04 host).
#
# Installs, ONCE: Node 20, the framework repo + browsers, the global
# @playwright/cli bin, the engine repo, and a systemd service that keeps the
# worker running and restarts it on reboot. After this, every job just RUNS —
# nothing is reinstalled per job.
#
# Usage (on the VM, as a sudo-capable user):
#   export FRAMEWORK_REPO="https://github.com/<you>/<framework>.git"
#   export ENGINE_REPO="https://github.com/lmoreshwar/my-ai-projects.git"
#   bash provision-worker.sh
#
# Secrets (LLM key, WORKER_TOKEN) are NOT baked in here — you add them to
# ~/blast/engine/AI_Agents/worker/.env after this script finishes (see output).
# ------------------------------------------------------------------------------
set -euo pipefail

FRAMEWORK_REPO="${FRAMEWORK_REPO:-}"
ENGINE_REPO="${ENGINE_REPO:-https://github.com/lmoreshwar/my-ai-projects.git}"
BASE_DIR="${BASE_DIR:-$HOME/blast}"
FRAMEWORK_DIR="$BASE_DIR/framework"
ENGINE_DIR="$BASE_DIR/engine"
WORKER_DIR="$ENGINE_DIR/AI_Agents"

log() { echo -e "\n\033[1;36m[provision]\033[0m $*"; }

if [ -z "$FRAMEWORK_REPO" ]; then
  echo "ERROR: set FRAMEWORK_REPO to your framework git URL before running." >&2
  exit 1
fi

log "1/8 System packages + build deps"
sudo apt-get update -y
sudo apt-get install -y curl git ca-certificates gnupg

log "2/8 Node.js 20 (NodeSource)"
if ! command -v node >/dev/null 2>&1 || [ "$(node -v | cut -c2-3)" -lt 20 ]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi
node -v && npm -v

log "3/8 Clone / update the framework repo -> $FRAMEWORK_DIR"
mkdir -p "$BASE_DIR"
if [ -d "$FRAMEWORK_DIR/.git" ]; then
  git -C "$FRAMEWORK_DIR" pull --ff-only
else
  git clone "$FRAMEWORK_REPO" "$FRAMEWORK_DIR"
fi

log "4/8 Clone / update the engine repo -> $ENGINE_DIR"
if [ -d "$ENGINE_DIR/.git" ]; then
  git -C "$ENGINE_DIR" pull --ff-only
else
  git clone "$ENGINE_REPO" "$ENGINE_DIR"
fi

log "5/8 Install framework deps + Playwright Chromium (with OS deps)"
( cd "$FRAMEWORK_DIR" && npm ci && npx playwright install --with-deps chromium )

log "6/8 Install engine deps + the global @playwright/cli bin"
( cd "$WORKER_DIR" && npm ci )
sudo npm install -g @playwright/cli
playwright-cli --version || true

log "7/8 Write worker .env scaffold (you must fill the secrets)"
ENV_FILE="$WORKER_DIR/worker/.env"
if [ ! -f "$ENV_FILE" ]; then
  cat > "$ENV_FILE" <<EOF
# ---- B.L.A.S.T. worker config (fill these in; keep this file private) ----
WORKER_PORT=8090
# Shared secret your B.L.A.S.T. API sends as: Authorization: Bearer <token>
# Generate one with:  openssl rand -hex 32
WORKER_TOKEN=

# Where the framework lives (the crawler + tests use this)
FRAMEWORK_PATH=$FRAMEWORK_DIR

# Turn on @playwright/cli locator evidence
EXPLORE_EVIDENCE=cli

# LLM — match what you use locally (example: groq)
LLM_PLATFORM=groq
LLM_MODEL=llama-3.3-70b-versatile
GROQ_API_KEY=
EOF
  echo "Wrote $ENV_FILE"
else
  echo "$ENV_FILE already exists — leaving it untouched."
fi

log "8/8 systemd service (auto-start + restart on reboot)"
SERVICE=/etc/systemd/system/blast-worker.service
sudo bash -c "cat > $SERVICE" <<EOF
[Unit]
Description=B.L.A.S.T. remote worker
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$USER
WorkingDirectory=$WORKER_DIR
EnvironmentFile=$WORKER_DIR/worker/.env
ExecStart=$(command -v node) $WORKER_DIR/worker/worker.js
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable blast-worker

echo
echo "=============================================================="
echo " DONE. Next steps:"
echo "  1) Edit secrets:   nano $ENV_FILE"
echo "        - set WORKER_TOKEN   (openssl rand -hex 32)"
echo "        - set GROQ_API_KEY   (or your LLM key)"
echo "  2) Start it:       sudo systemctl start blast-worker"
echo "  3) Check health:   curl http://localhost:8090/health"
echo "  4) Open port 8090 in the Oracle Security List + ufw (see chat)."
echo "=============================================================="
