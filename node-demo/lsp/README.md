# Local LSP for node-demo

Spins up `utexo-lsp` (Go HTTP service) pointed at the regtest peer RLN
the rest of the demo already runs at `127.0.0.1:3002`. Lets the LSP
test cases (`t109`–`t112`) exercise the wallet → LSP HTTP integration
end-to-end on a single machine.

## Quick start

```bash
# From repo root:
./node-demo/lsp/up.sh
LSP_BASE_URL=http://127.0.0.1:8080 npm run --prefix node-demo test:e2e
./node-demo/lsp/down.sh
```

`up.sh` clones `UTEXO-Protocol/utexo-lsp` to `node-demo/.data/lsp-src/`
on first run, builds a local Docker image using the cgo-enabled
override `./Dockerfile` (upstream's Dockerfile builds with
`CGO_ENABLED=0` which breaks `go-sqlite3` at runtime), then `compose
up -d`. It blocks until `GET /health` returns 200.

## Required env when running the bridge cases

The LSP gates `/onchain_send` and `/lightning_receive` behind a
hard-coded `SUPPORTED_ASSET_IDS` allowlist (`api.go
ensureAssetSupported`). t111/t112 currently rely on the operator
pre-populating that list — set it before bringing the LSP up:

```bash
LSP_SUPPORTED_ASSET_IDS='rgb:Vd...,rgb:Xy...' ./node-demo/lsp/up.sh
```

If the allowlist is empty, `t109` (probe) and `t110` (get_info) still
pass; t111/t112 cleanly skip via the dependsOn chain.

## Overrides

| Env var | Default | Purpose |
|---|---|---|
| `LSP_REPO_URL` | `https://github.com/UTEXO-Protocol/utexo-lsp.git` | Where to clone the LSP source from. |
| `LSP_REPO_REF` | `main` | Branch/tag/SHA to clone. |
| `LSP_REPO_PATH` | `node-demo/.data/lsp-src` | Path to an existing checkout (skips the clone). |
| `LSP_SUPPORTED_ASSET_IDS` | (empty) | Comma-separated allowlist propagated to the LSP. |

## Why a separate compose

The `rgb-lightning-node/compose.yaml` brings up bitcoind / electrs /
proxy; the peer RLN is run from `regtest.sh` outside compose. Our
LSP compose runs in its own project namespace (`lsp_*`) so the two
stacks don't share volume names or networks. Both reach each other
via `host.docker.internal`.

## Known sharp edges

- Upstream LSP Dockerfile builds `CGO_ENABLED=0`; `go-sqlite3` then
  refuses to run. We override with a cgo-enabled Dockerfile here.
  Worth a one-line PR upstream.
- The LSP has no runtime API to update `SUPPORTED_ASSET_IDS`; the
  allowlist must be set before container start. Adding `POST
  /admin/supported_assets` would unblock dynamic asset injection from
  the test runner.
- t111/t112 prove the wire format and round-trip semantics but do NOT
  exercise the LSP's cron-driven settlement (which takes minutes and
  needs an end-to-end RGB transfer). Settlement is tested separately
  in iteration 2 once we have the dynamic-allowlist endpoint.
