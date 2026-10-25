#!/usr/bin/env bash
# RunArgus.command — Open this file to install dependencies and launch Argus
# Double-click it from the mounted DMG or from any folder on your Mac.
#
# What it does:
#   1. Finds the project root (the folder that contains this script)
#   2. Installs npm dependencies if node_modules is missing
#   3. Runs: vite build && electron .

set -e

# ── Locate project root ───────────────────────────────────────────────────────
# When launched from Finder, $0 is the path to this script inside the DMG.
# We resolve to the absolute directory.
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT="$SCRIPT_DIR"

echo ""
echo "╔══════════════════════════════════════════╗"
echo "║          Argus — Exam Desktop App        ║"
echo "╚══════════════════════════════════════════╝"
echo ""

# ── Sanity check: Node.js must be installed ───────────────────────────────────
if ! command -v node &>/dev/null; then
  osascript -e 'display alert "Node.js not found" message "Please install Node.js 20+ from https://nodejs.org and try again." as critical'
  echo "ERROR: Node.js is not installed. Visit https://nodejs.org"
  exit 1
fi

NODE_VER=$(node -e "process.stdout.write(process.version)")
echo "✔ Node.js $NODE_VER found"

# ── Install dependencies ──────────────────────────────────────────────────────
if [ ! -d "$PROJECT/node_modules" ]; then
  echo "📦 Installing dependencies (first run — takes ~1 minute) …"
  npm install --prefix "$PROJECT"
  echo "✔ Dependencies installed"
else
  echo "✔ node_modules present — skipping install"
fi

# ── Build renderer and launch Electron ───────────────────────────────────────
echo ""
echo "🚀 Building renderer and launching Argus …"
echo ""
cd "$PROJECT"
npm start
