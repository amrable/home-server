#!/usr/bin/env bash
# Run the receipt-upload backend locally (no Docker/Tailscale needed).
# Usage: ./dev.sh   (optionally: PORT=9000 LLM_PROVIDER=openrouter ./dev.sh)
#
# Providers (LLM_PROVIDER=google | openrouter):
#   google:    GEMINI_API_KEY, GEMINI_MODEL (default gemini-2.5-flash)
#   openrouter: OPENROUTER_API_KEY, OPENROUTER_MODEL (default google/gemini-2.5-flash)

set -euo pipefail

cd "$(dirname "$0")"

PORT="${PORT:-9999}"
LLM_PROVIDER="${LLM_PROVIDER:-google}"

# Keys to pull from the repo root .env if present, otherwise from env.
ENV_KEYS=(GEMINI_API_KEY GEMINI_MODEL OPENROUTER_API_KEY OPENROUTER_MODEL)

if [[ -f "../../.env" ]]; then
  for key in "${ENV_KEYS[@]}"; do
    if [[ -z "${!key:-}" ]]; then
      val="$(grep -E "^${key}=" "../../.env" | head -1 | cut -d= -f2- | tr -d '"')"
      [[ -n "$val" ]] && export "$key"="$val"
    fi
  done
fi

if [[ "$LLM_PROVIDER" == "openrouter" && -z "${OPENROUTER_API_KEY:-}" ]]; then
  read -rsp "OPENROUTER_API_KEY not found — paste it: " OPENROUTER_API_KEY
  echo
  export OPENROUTER_API_KEY
elif [[ -z "${GEMINI_API_KEY:-}" ]]; then
  read -rsp "GEMINI_API_KEY not found — paste it: " GEMINI_API_KEY
  echo
  export GEMINI_API_KEY
fi

mkdir -p data

exec env \
  PORT="$PORT" \
  DATA_DIR="$(pwd)/data" \
  INDEX_HTML="$(pwd)/index.html" \
  LLM_PROVIDER="$LLM_PROVIDER" \
  GEMINI_API_KEY="${GEMINI_API_KEY:-}" \
  GEMINI_MODEL="${GEMINI_MODEL:-gemini-2.5-flash}" \
  OPENROUTER_API_KEY="${OPENROUTER_API_KEY:-}" \
  OPENROUTER_MODEL="${OPENROUTER_MODEL:-google/gemini-2.5-flash}" \
  python3 server.py
