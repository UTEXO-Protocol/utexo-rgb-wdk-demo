# Node test runner

Pure-Node port of the autonomous E2E suite that the React Native app
exercises via the Bare worklet. Same test cases, same daemon C-FFI —
no simulator, no Metro, no rebuild loop.

## Why this exists

The RN suite runs against a Bare-worklet-hosted `rgb-lightning-node`
addon (`@utexo/rgb-lightning-node-bare`). The same daemon binary is
available to Node via `@utexo/rgb-lightning-node-nodejs` (napi-rs over
the identical C-FFI). The Node path lets us:

- iterate on the daemon and test cases without rebuilding native code
- hand Roman a copy-pasteable `npm test` reproduction for any
  daemon-level finding
- run the suite on CI without a simulator

## Run

```bash
cd node-demo
npm install
npm run test:e2e
```

Reads `.data/mnemonic` (creates one on first run). Connects to:

| Service | Default | Override |
|---|---|---|
| bitcoind RPC | `127.0.0.1:18443` user/password | `BITCOIND_HOST` `BITCOIND_PORT` `BITCOIND_USER` `BITCOIND_PASS` |
| Peer RLN HTTP | `http://127.0.0.1:3002` | `PEER_BASE_URL` |
| Peer LN advertised | `127.0.0.1:9735` | `PEER_HOST_FOR_LN` `PEER_LN_PORT` |
| Indexer | `tcp://127.0.0.1:50001` | `INDEXER_URL` |
| RGB proxy | `rpc://127.0.0.1:3001/json-rpc` | `PROXY_ENDPOINT` |

Run a subset:
```bash
E2E_CATEGORY=btc,channels npm run test:e2e
```

Reports land in `.data/reports/<sessionId>.json`. Exit code is non-zero
if any case genuinely failed (expected-fail and skip don't count).

## What's shared vs ported

These files are copied verbatim from `src/rln/testing/` and shouldn't
drift — keep edits in the canonical location and re-copy if needed:

- `testCases.ts` — the 54 cases
- `TestRunner.ts` — driver
- `PeerClient.ts` — HTTP client to the counterparty daemon
- `ChainController.ts` — bitcoind JSON-RPC

Two imports differ from the RN tree:
- `state/LogStore` → `./logger` (Node console logger + session id)
- `expo-file-system` + `react-native` → `./platform-shim` (Node fs + a
  `Platform.OS = 'node'` const)

Node-specific:
- `LnExtNodeAdapter.ts` — Proxy that re-shapes the wdk-rgb-lightning
  account into the LnExt interface the test cases consume (mostly
  pass-through — the account already implements the surface)
- `run.ts` — entry point: wallet setup → unlock → adapter → runner
- `logger.ts`, `platform-shim.ts` — see above

## Known gaps in the napi binding

A handful of test cases fail with `this._node.<method> is not a function`
because the napi addon is a partial subset of the C-FFI surface. Each
failure pinpoints exactly which method needs adding. As of the first run:

- `checkIndexerUrl`, `checkProxyEndpoint` — diagnostic helpers
- `listTransactions`, `decodeRgbInvoice`, `failTransfers`, `estimateFee`
- `getInvoiceStatus`, `getPayment`, `getChannelId`, `getAssetMetadata`
- `inflate`, `issueAssetIfa` (latter is expected-fail in external-signer
  mode anyway — same on RN side)
- `signMessage`, `quoteTransfer`, `quoteSendTransaction`,
  `getTransactionReceipt`, `toReadOnlyAccount`

These are all already on `SdkNode` in the daemon's C-FFI — adding a
napi wrapper for each is mechanical (one line in
`rgb-lightning-node-nodejs/src/...`). Suite is still useful in this
state because the core daemon behaviors (channels, invoices, payments,
asset transfer, close) all map cleanly.

## Caveats

- The Node and RN runners share state directories conceptually but not
  literally — Node uses `node-demo/.data/rln/`, iOS uses the simulator
  data container. Wipe via `rm -rf node-demo/.data` for a fresh run.
- Concurrent runs against the same data dir clobber each other (same as
  the RN side). One `npm run test:e2e` at a time.
