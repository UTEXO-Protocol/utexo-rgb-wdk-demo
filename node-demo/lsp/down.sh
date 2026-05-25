#!/usr/bin/env bash
# Tears down the utexo-lsp container brought up by ./up.sh. Leaves the
# cached LSP checkout under .data/lsp-src/ intact.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
docker compose -f "$HERE/compose.yaml" down -v
echo "[utexo-lsp] down"
