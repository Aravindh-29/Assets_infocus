#!/usr/bin/env bash
# INFOCUS Asset Management: create the missing database and apply versioned schema.
# Usage: bash scripts/setup-db.sh [--env-file backend/.env] [--dry-run]
set -euo pipefail
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
command -v node >/dev/null 2>&1 || { printf '%s\n' 'Node.js 22.12+ or 24 is required.' >&2; exit 1; }
exec node "$SCRIPT_DIR/setup-db.mjs" "$@"
