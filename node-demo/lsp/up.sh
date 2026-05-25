#!/usr/bin/env bash
# Brings up utexo-lsp pointed at the peer RLN at 127.0.0.1:3002. Clones
# the LSP repo on first run; subsequent runs reuse the cached checkout.
#
# Env overrides:
#   LSP_REPO_PATH     Path to a local utexo-lsp checkout (skips clone).
#   LSP_REPO_URL      Git URL to clone (default: GitHub upstream).
#   LSP_REPO_REF      Branch/tag/SHA to check out (default: main).
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
NODE_DEMO_DIR="$(cd "$HERE/.." && pwd)"
DEFAULT_CACHE="$NODE_DEMO_DIR/.data/lsp-src"

LSP_REPO_URL="${LSP_REPO_URL:-https://github.com/UTEXO-Protocol/utexo-lsp.git}"
LSP_REPO_REF="${LSP_REPO_REF:-main}"
LSP_REPO_PATH="${LSP_REPO_PATH:-$DEFAULT_CACHE}"

if [ ! -d "$LSP_REPO_PATH/.git" ]; then
  echo "[utexo-lsp] cloning $LSP_REPO_URL → $LSP_REPO_PATH"
  git clone --depth 1 --branch "$LSP_REPO_REF" "$LSP_REPO_URL" "$LSP_REPO_PATH"
else
  echo "[utexo-lsp] reusing existing checkout at $LSP_REPO_PATH"
fi

# Stage our cgo-enabled Dockerfile into the LSP source tree so docker
# build can see it inside the context.
cp "$HERE/Dockerfile" "$LSP_REPO_PATH/Dockerfile.local"

export LSP_REPO_PATH
docker compose -f "$HERE/compose.yaml" up -d --build

echo "[utexo-lsp] up; waiting for /health on http://127.0.0.1:8080 …"
deadline=$(( $(date +%s) + 60 ))
while ! curl -sf -o /dev/null http://127.0.0.1:8080/health; do
  if [ "$(date +%s)" -ge "$deadline" ]; then
    echo "[utexo-lsp] FAIL: /health did not respond in 60s" >&2
    docker compose -f "$HERE/compose.yaml" logs --tail 60 utexo-lsp
    exit 1
  fi
  sleep 1
done
echo "[utexo-lsp] ready — http://127.0.0.1:8080"
