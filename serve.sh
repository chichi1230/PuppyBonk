#!/usr/bin/env bash
# 若 ./serve.sh 报 permission denied：先 chmod +x serve.sh，或改用：bash serve.sh
# 必须在 Puppy Bonk 项目根目录提供页面，否则会 404
cd "$(dirname "$0")"
PORT="${PORT:-8080}"
echo "Open: http://127.0.0.1:${PORT}/index.html"
exec python3 -m http.server "$PORT"
