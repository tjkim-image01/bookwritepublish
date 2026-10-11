#!/usr/bin/env bash
# web/v3 보기 — 공용 서버(web/bin/start.sh)를 켜고 이 버전 주소를 알려 준다
HERE="$(cd "$(dirname "$0")/../.." && pwd)"
"$HERE/bin/start.sh" "$@" && echo "→ http://localhost:$(cat "$HERE/bin/.server.port" 2>/dev/null || echo 8710)/v3/"
