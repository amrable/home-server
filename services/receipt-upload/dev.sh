#!/usr/bin/env bash
# Run the receipt-upload backend locally (no Docker/Tailscale needed).
# Usage: ./dev.sh   (optionally: PORT=9000 ./dev.sh)

set -euo pipefail

cd "$(dirname "$0")"

PORT="${PORT:-9999}"

# Pull GEMINI_API_KEY from the repo root .env if present, otherwise from env.
if [[ -z "${GEMINI_API_KEY:-}" && -f "../../.env" ]]; then
  export GEMINI_API_KEY
  GEMINI_API_KEY="$(grep -E '^GEMINI_API_KEY=' "../../.env" | cut -d= -f2- | tr -d '"')"
fi

if [[ -z "${GEMINI_API_KEY:-}" ]]; then
  read -rsp "GEMINI_API_KEY not found — paste it: " GEMINI_API_KEY
  echo
  export GEMINI_API_KEY
fi

mkdir -p data

exec env \
  PORT="$PORT" \
  DATA_DIR="$(pwd)/data" \
  INDEX_HTML="$(pwd)/index.html" \
  GEMINI_API_KEY="$GEMINI_API_KEY" \
  python3 server.py
