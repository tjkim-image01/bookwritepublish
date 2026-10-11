#!/usr/bin/env bash
# 그림책 서재 로컬 서버 — web 폴더 전체를 연다 (GitHub Pages 와 같은 구조)
#   http://localhost:8710/      버전 안내
#   http://localhost:8710/v1/   PC·태블릿 (펼침면)
#   http://localhost:8710/v2/   모바일 대응 (세로 화면은 한 쪽씩)
# 사용: web/bin/start.sh [포트]   (기본 8710)
set -euo pipefail
WEB="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${1:-${PORT:-8710}}"
PID_FILE="$WEB/bin/.server.pid"
LOG_FILE="$WEB/bin/server.log"

if [[ -f "$PID_FILE" ]] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
  echo "이미 실행 중 (pid $(cat "$PID_FILE")) → http://localhost:$(cat "$WEB/bin/.server.port" 2>/dev/null || echo "$PORT")/"
  exit 0
fi
if lsof -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "포트 $PORT 를 다른 프로그램이 쓰고 있습니다. 다른 포트로: web/bin/start.sh 8711" >&2
  exit 1
fi
nohup python3 "$WEB/bin/serve.py" "$PORT" "$WEB" >"$LOG_FILE" 2>&1 &
echo $! >"$PID_FILE"
echo "$PORT" >"$WEB/bin/.server.port"
for _ in $(seq 1 20); do curl -sf "http://127.0.0.1:$PORT/" >/dev/null 2>&1 && break; sleep 0.2; done
echo "시작됨 (pid $(cat "$PID_FILE")) → http://localhost:$PORT/  (v1: /v1/  v2: /v2/)"
