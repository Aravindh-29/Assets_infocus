#!/usr/bin/env bash
# Convenience launcher; the installer and its safeguards live in scripts/.
set -euo pipefail
PROJECT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
exec bash "$PROJECT_DIR/scripts/install.sh" "$@"
