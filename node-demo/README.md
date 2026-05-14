# utexo-rgb-wdk-node-demo

Node-side counterpart to the RN demo. Exercises `@tetherto/wdk` + `@utexo/wdk-rgb-lightning` + `@utexo/rgb-lightning-node-nodejs` against the same regtest stack (bitcoind / electrs / rgb-proxy) the RN app uses.

## Setup

```sh
npm install              # pulls the napi binding from GH Releases via postinstall
node cli.mjs init        # generates BIP-39 mnemonic into .data/mnemonic
node cli.mjs unlock      # brings the in-process LDK node online
```

Set the regtest stack endpoints via env (defaults match the RN demo):

```sh
export BITCOIND_USER=user
export BITCOIND_PASS=password
export BITCOIND_HOST=127.0.0.1
export BITCOIND_PORT=18443
export INDEXER_URL=127.0.0.1:50001
export PROXY_ENDPOINT=rpc://192.168.0.11:3001/json-rpc
```

(or pass `WDK_MNEMONIC=...` to skip the on-disk mnemonic file).

## Subcommands

| Command | What |
|---|---|
| `init` | generate & store a BIP-39 mnemonic |
| `unlock` | bring LDK online with the bitcoind / indexer / proxy creds |
| `address` | get an on-chain BTC address |
| `info` / `netinfo` | node info / LN network view |
| `balance` | on-chain BTC balance (vanilla + colored) |
| `peers` / `channels` | current peers / channels |
| `connect <pubkey@host:port>` | open a peer connection |
| `open <peer_pubkey> <cap_sat>` | open a BTC channel |
| `invoice <amt_msat>` | create a BOLT11 invoice |
| `pay <bolt11>` | pay a BOLT11 invoice |

Each subcommand reopens the node and unlocks before running. To run a sequence of operations interactively, prefer adding the workflow to the script over a shell loop — initialisation is not cheap.

## Architecture

```
cli.mjs
  └─ @tetherto/wdk-wallet                       (WalletManager base)
      └─ @utexo/wdk-rgb-lightning               (this repo's sibling)
          └─ NodeRgbLightningBinding (picked by conditional export `node`)
              └─ @utexo/rgb-lightning-node-nodejs   (napi-rs addon)
                  └─ librlncffi.a               (C-FFI static lib; same one the bare addon links)
```

The wallet manager / wallet account code is identical to the RN demo path; only the `Binding` choice differs (`Node…` vs `Bare…`).

## Status

First-cut harness — initial validation of the Node path. Some convenience layers (refresh, asset receive surface, force-close) are still routed through `account._binding.node` directly; once `WalletAccountRgbLightning` exposes those methods the CLI will use the higher-level WDK surface.
