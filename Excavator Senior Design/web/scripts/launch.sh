#!/usr/bin/env bash
# One-click launcher: builds + starts the telemetry server, waits for it to
# come up, then opens the dashboard in the default browser.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WEB_DIR="$(dirname "$SCRIPT_DIR")"
URL="http://localhost:8080"

cd "$WEB_DIR"

cleanup() {
  if [[ -n "${SERVER_PID:-}" ]] && kill -0 "$SERVER_PID" 2>/dev/null; then
    kill "$SERVER_PID" 2>/dev/null
    wait "$SERVER_PID" 2>/dev/null
  fi
}
trap cleanup EXIT INT TERM

npm run build
node dist/server.js &
SERVER_PID=$!

echo "Waiting for $URL ..."
for _ in $(seq 1 30); do
  if curl -s -o /dev/null "$URL"; then
    xdg-open "$URL" >/dev/null 2>&1 &
    break
  fi
  sleep 0.5
done

wait "$SERVER_PID"
