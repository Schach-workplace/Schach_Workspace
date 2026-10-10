#!/usr/bin/env bash
set -euo pipefail
root=$(cd "$(dirname "$0")/../.." && pwd)
: "${TEST_DATABASE_URL:?Use an owned PostgreSQL instance, never the user app database}"
result=${1:-"$root/verification/runtime/data-read-performance.json"}
result=$(realpath -m "$result")
cd "$root/backend"
READ_LOAD_OUTPUT="$result" go test ./platform -run '^TestReadEfficiencyLoadFixture$' -count=1 -v
