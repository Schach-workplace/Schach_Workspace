#!/usr/bin/env bash
set -euo pipefail
project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if ! command -v go >/dev/null 2>&1; then
  printf '%s\n' 'Install Go 1.26+ from https://go.dev/dl/ and a C compiler, then run this script again.' >&2
  exit 1
fi
if [ ! -f "$project_dir/frontend/dist/index.html" ]; then
  (cd "$project_dir/frontend" && npm ci && npm run build)
fi
mkdir -p "$project_dir/data"
chmod 700 "$project_dir/data"
printf '%s\n' 'Starting the shared local demo at http://127.0.0.1:8080' 'Sign in: founder@schach.demo / SchachDemo!2026' 'All sample data is fictional. Press Ctrl+C to stop.'
cd "$project_dir/backend"
exec go run ./cmd/server --demo --addr 127.0.0.1:8080 --db "$project_dir/data/schach-demo.db" --frontend "$project_dir/frontend/dist"
