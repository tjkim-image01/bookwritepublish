#!/usr/bin/env bash
# 그림책 서재 로컬 서버 중지
set -uo pipefail
WEB="$(cd "$(dirname "$0")/.." && pwd)"
PID_FILE="$WEB/bin/.server.pid"
if [[ ! -f "$PID_FILE" ]]; then echo "실행 중인 서버가 없습니다."; exit 0; fi
PID="$(cat "$PID_FILE")"
if kill -0 "$PID" 2>/dev/null; then
  kill "$PID"
  for _ in $(seq 1 20); do kill -0 "$PID" 2>/dev/null || break; sleep 0.1; done
  kill -0 "$PID" 2>/dev/null && kill -9 "$PID"
  echo "중지됨 (pid $PID)"
else
  echo "이미 종료된 서버 (pid $PID) — 기록만 정리합니다."
fi
rm -f "$PID_FILE" "$WEB/bin/.server.port"
