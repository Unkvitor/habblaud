#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="$HOME/.nvm/versions/node/v24.22.0/bin:$PATH"
export HABBLAUD_PORT=4757 HABBLAUD_HOST=127.0.0.1
export HABBLAUD_DATA_DIR="$PWD/.preview-data"
export HABBLAUD_NATIVE_CODEX=1 HABBLAUD_IN_DOCKER=0
export HABBLAUD_NATIVE_GEMINI_REAL=1 HABBLAUD_NATIVE_GEMINI_DEMO=0
export HABBLAUD_AGY_BIN=/home/joo_vitor/.local/bin/agy
export HABBLAUD_WORLD=0 HABBLAUD_UPDATE_CHECK=0 HABBLAUD_TIMELINE=0 HABBLAUD_PTY=0
exec node dist/server/index.js