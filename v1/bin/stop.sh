#!/usr/bin/env bash
# 공용 서버 중지 (v1·v2 함께 꺼짐)
exec "$(cd "$(dirname "$0")/../.." && pwd)/bin/stop.sh"
