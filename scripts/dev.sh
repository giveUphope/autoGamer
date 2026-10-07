#!/usr/bin/env bash
# Copyright 2026 Google LLC
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

# One-command development stack: FastAPI backend (:8000) + Vite dev server
# (:5180, hot reload) with linked teardown — Ctrl+C stops both, and if one
# side dies the other is torn down too. Production does not need this: the
# packaged launcher (`make start` / start.bat / `uv run python -m artemis ui`)
# builds and serves the compiled frontend by itself.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

FRONTEND_DIR="apps/showcase_ui_v2"
BACKEND_PORT="${BACKEND_PORT:-8000}"
FRONTEND_PORT="${FRONTEND_PORT:-5180}"
BACKEND_URL="http://127.0.0.1:${BACKEND_PORT}"
BACKEND_LOG="scratch/dev-backend.log"

command -v uv >/dev/null 2>&1 || { echo "✗ uv not found. Install: https://docs.astral.sh/uv/"; exit 1; }
command -v npm >/dev/null 2>&1 || { echo "✗ npm not found. Install Node.js >= 20.19."; exit 1; }

BACKEND_PID=""
FRONTEND_PID=""
# Windows teardown: bash's $! is an msys PID, but npm/vite/python are native
# win32 processes that never appear in msys `ps`, and a plain kill only
# terminates the wrapper -- children keep the ports occupied as orphans.
# Instead of translating PID spaces, record the win32 PIDs that actually
# LISTEN on our ports (netstat -ano) once the stack is up, and taskkill those
# trees on the way out. POSIX keeps the plain-kill path (npm/uv forward
# signals to their children).
FRONTEND_LISTEN_PID=""
BACKEND_LISTEN_PID=""
listen_pid() {
  # 端口暂无监听者时 grep 返回非零——set -e 下命令替换失败会杀死脚本
  # （EXIT trap 随即误杀已就绪的后端），因此这里恒返回成功。
  netstat -ano 2>/dev/null | grep ":$1 " | grep LISTENING | awk '{print $NF}' | head -1
  return 0
}
kill_tree() {
  local pid="$1"
  if [ -z "$pid" ]; then
    return 0
  fi
  case "$(uname -s)" in
    MINGW*|MSYS*|CYGWIN*)
      taskkill //PID "$pid" //T //F >/dev/null 2>&1 || true
      ;;
    *)
      kill "$pid" 2>/dev/null || true
      ;;
  esac
}
cleanup() {
  kill_tree "$FRONTEND_LISTEN_PID"
  kill_tree "$BACKEND_LISTEN_PID"
}
trap cleanup EXIT INT TERM

mkdir -p scratch

# Frontend dependencies (first run only)
if [ ! -d "$FRONTEND_DIR/node_modules" ]; then
  echo "📦 Installing frontend dependencies (first run)…"
  npm --prefix "$FRONTEND_DIR" install --no-audit --no-fund
fi

# Backend: reuse an already-running instance when present
reuse_backend=false
if curl -sf -m 2 "$BACKEND_URL/api/status" >/dev/null 2>&1; then
  reuse_backend=true
  echo "♻️  Backend already running at $BACKEND_URL — reusing it."
else
  echo "🚀 Starting backend (FastAPI) on port $BACKEND_PORT… (log: $BACKEND_LOG)"
  uv run python -m apps.admin_console.server >"$BACKEND_LOG" 2>&1 &
  BACKEND_PID=$!
  for _ in $(seq 1 60); do
    if curl -sf -m 2 "$BACKEND_URL/api/status" >/dev/null 2>&1; then
      break
    fi
    if ! kill -0 "$BACKEND_PID" 2>/dev/null; then
      echo "✗ Backend exited during startup — tail of $BACKEND_LOG:"
      tail -20 "$BACKEND_LOG" || true
      exit 1
    fi
    sleep 0.5
  done
  if ! curl -sf -m 2 "$BACKEND_URL/api/status" >/dev/null 2>&1; then
    echo "✗ Backend not ready after 30s — tail of $BACKEND_LOG:"
    tail -20 "$BACKEND_LOG" || true
    exit 1
  fi
  echo "   ✓ Backend ready at $BACKEND_URL"
  BACKEND_LISTEN_PID="$(listen_pid "$BACKEND_PORT")"
fi

echo "🎨 Starting frontend (Vite dev, hot reload) on port $FRONTEND_PORT…"
npm --prefix "$FRONTEND_DIR" run dev -- --host 127.0.0.1 --port "$FRONTEND_PORT" --strictPort &
FRONTEND_PID=$!

for _ in $(seq 1 20); do
  FRONTEND_LISTEN_PID="$(listen_pid "$FRONTEND_PORT")"
  if [ -n "$FRONTEND_LISTEN_PID" ]; then
    break
  fi
  sleep 0.5
done
echo ""
echo "──────────────────────────────────────────────────────"
echo "  Development stack is up:"
echo "    • Frontend (hot reload): http://127.0.0.1:${FRONTEND_PORT}"
echo "    • Backend API:           ${BACKEND_URL}  (log: ${BACKEND_LOG})"
echo "    • Stop everything:       Ctrl+C"
echo "──────────────────────────────────────────────────────"
echo ""

# Tear down both sides as soon as either exits (Ctrl+C lands here too).
wait -n "$BACKEND_PID" "$FRONTEND_PID" 2>/dev/null || true
echo ""
echo "⚠ A dev process exited — shutting the stack down."
