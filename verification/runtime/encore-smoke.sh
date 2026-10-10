#!/usr/bin/env bash
set -euo pipefail
exec python3 "$(dirname "$0")/encore_smoke.py" "$@"
