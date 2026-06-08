# utexo-rgb-wdk-demo

Minimal Expo + TypeScript demo for the UTEXO RGB stack on top of Tether's
agnostic worklet WDK (`pear-wrk-wdk` + `wdk-worklet-bundler`). Lights up
three networks side by side:

- **`bitcoin`** — via [`@tetherto/wdk-wallet-btc`][wdk-wallet-btc] (vanilla
  on-chain BTC).
- **`rgb`** — via [`@utexo/wdk-wallet-rgb`][wdk-wallet-rgb] (on-chain RGB
  through `rgb-lib`).
- **`rgb-lightning`** — via [`@utexo/wdk-rgb-lightning`][wdk-rgb-lightning]
  (channels, BOLT11 + RGB invoices, payments, async payments, optional
  VSS backup — all through `rgb-lightning-node`).

The default screen is **RGB Lightning** — it's the main thing this demo
shows. The other two networks compile into the worklet so you can use the
same `useAccount({ network })` hook against them if you wire up your own
UI.

```js
// wdk.config.js
module.exports = {
  networks: {
    rgb:             { package: '@utexo/wdk-wallet-rgb' },
    bitcoin:         { package: '@tetherto/wdk-wallet-btc' },
    'rgb-lightning': { package: '@utexo/wdk-rgb-lightning' }
  }
}
```

```tsx
// src/RgbLightningScreen.tsx (excerpt)
const ln = useAccount<LnExt>({ network: 'rgb-lightning', accountIndex: 0 })
const ext = ln.extension()

await ext.unlock({ bitcoind_rpc_username: '…', /* … */ })
await ext.connectPeer('<pubkey>@<host>:<port>')
await ext.openChannel({ peer_pubkey_and_addr: '…', capacity_sat: 1_000_000, /* … */ })
const inv = await ext.createInvoice({ amount_msat: 5000, expiry_sec: 3600 })
await ext.sendPayment({ invoice: '<bolt11>' })
```

No chain-specific HRPC handlers live in `pear-wrk-wdk` — every call goes
through the generic `callMethod` dispatcher and lands on
`WalletAccountRgbLightning.<methodName>` (or `WalletAccountRgb`,
`WalletAccountBtc`) inside the worklet.

## Run it

### 1. Install

```bash
npm install --legacy-peer-deps
```

### 2. Generate the worklet bundle

```bash
npx wdk-worklet-bundler generate --install
```

Emits `.wdk-bundle/wdk-worklet.bundle.js` (~6 MB) containing the
cross-platform worklet plus iOS `.framework` and Android `.so` native
addons for `@utexo/rgb-lib-bare`, `@utexo/rgb-lightning-node-bare`, and
every other bare native dep.

### 3. Bring up the regtest stack

For the on-chain RGB side (bitcoind + electrs + RGB proxy), the
canonical regtest compose lives in `rgb-lib-nodejs`:

```bash
cd ../rgb-lib-nodejs/rgb-lib/tests && docker compose up -d
```

For RGB Lightning you additionally need a peer
`rgb-lightning-node` reachable on `9735` (or `9736` if you want the
default port free for the demo). See
[`rgb-lightning-node`][rgb-lightning-node]'s README for the
`regtest.sh` helper. The demo's RGB Lightning screen has a connect-peer
field that takes `<pubkey>@<host>:<port>`.

Mine a block when needed:

```bash
docker exec tests-bitcoind-1 bitcoin-cli -regtest \
  -rpcuser=user -rpcpassword=default_password \
  -rpcwallet=miner -generate 1
```

### 4. Configure `.env`

Copy `.env.example` → `.env`. The RGB Lightning side reads its config
through the screen UI (bitcoind RPC + indexer + proxy), not env vars —
only the on-chain RGB and BTC networks read env at boot:

```
# iOS simulator — host maps to `localhost`
EXPO_PUBLIC_RGB_NETWORK=regtest
EXPO_PUBLIC_RGB_INDEXER_URL=tcp://localhost:50001
EXPO_PUBLIC_RGB_TRANSPORT_ENDPOINT=rpc://localhost:3000/json-rpc

EXPO_PUBLIC_BTC_NETWORK=regtest
EXPO_PUBLIC_BTC_INDEXER_URL=tcp://localhost:50001

# Android emulator — host is `10.0.2.2`
# EXPO_PUBLIC_RGB_INDEXER_URL=tcp://10.0.2.2:50001
# EXPO_PUBLIC_RGB_TRANSPORT_ENDPOINT=rpc://10.0.2.2:3000/json-rpc
# EXPO_PUBLIC_BTC_INDEXER_URL=tcp://10.0.2.2:50001
```

`dataDir` for `rgb-lib`'s SQLite state and `rgb-lightning-node`'s LDK
state are **not** env vars — both are computed in `App.tsx` from
`expo-file-system`'s `Paths.document.uri`. That resolves per platform:

- iOS: `file:///.../Documents/`
- Android: `file:///data/user/0/<pkg>/files/`

Both survive app relaunches; `file://` is stripped before the path
reaches the bindings.

### 5. Run on device / simulator

```bash
# iOS simulator (note the LANG workaround for CocoaPods)
LANG=en_US.UTF-8 npx expo run:ios

# Android emulator (requires android/local.properties with sdk.dir=…)
echo "sdk.dir=$HOME/Library/Android/sdk" > android/local.properties
npx expo run:android
```

First launch:

1. Worklet boots and loads `.wdk-bundle/wdk-worklet.bundle.js`.
2. Tap **"Create new wallet"** — a fresh BIP-39 mnemonic is generated,
   shown once for backup, and stored behind the platform keychain.
3. The **RGB Lightning** screen opens. Fill in the bitcoind RPC + indexer
   + RGB proxy fields (defaults assume the regtest compose above), tap
   **Unlock**. Drop some regtest BTC at the displayed address, then
   **connectPeer** → **openChannel** → **createInvoice** /
   **sendPayment**.

## Canary mode

Set `EXPO_PUBLIC_RUN_CANARY=1` to bypass the WDK worklet entirely and
render `src/CanaryScreen.tsx`. The canary loads
`canary-worklet/canary.linked.bundle.js` — a tiny bundle that contains
only `@utexo/rgb-lightning-node-bare` plus a few smoke-test calls.
Useful for isolating native-addon issues from anything WDK-related.

## What this demo does NOT show

- UI polish, multi-account navigation, transfer-history persistence.
- Production error handling beyond inline error text.
- Backup/restore flows beyond on-screen mnemonic display.
- Biometric unlock (the provider supports it; demo uses a hard-coded
  `rgb-demo-wallet` id).

This is the thinnest possible wrapper around
[`@tetherto/wdk-react-native-core`][wdk-rn-core]'s hooks so you can see
exactly where each call is made.

## Layout

```
utexo-rgb-wdk-demo/
├── wdk.config.js                  declares rgb + bitcoin + rgb-lightning networks
├── .wdk-bundle/
│   └── wdk-worklet.bundle.js      generated by `wdk-worklet-bundler generate`
├── canary-worklet/
│   ├── index.js                   bare-only smoke-test worklet source
│   └── canary.linked.bundle.js    pre-bundled canary (used by CanaryScreen)
├── metro.config.js                teaches Metro to watch the bundles
├── App.tsx                        <WdkAppProvider> root + network configs + canary gate
├── src/
│   ├── WalletGate.tsx             NO_WALLET / LOCKED / READY routing
│   ├── RgbLightningScreen.tsx     default screen — full LN method surface
│   └── CanaryScreen.tsx           bare-only smoke test (EXPO_PUBLIC_RUN_CANARY=1)
├── ios/                           generated by `expo prebuild`
└── android/                       generated by `expo prebuild`
```

## References

- [`@utexo/wdk-rgb-lightning`][wdk-rgb-lightning] — LN module's README +
  per-method status markers.
- [`@utexo/wdk-wallet-rgb`][wdk-wallet-rgb] — on-chain RGB module.
- [`rgb-lightning-node`][rgb-lightning-node] — Rust daemon + regtest
  helper.
- [`@tetherto/wdk-react-native-core`][wdk-rn-core] — provider + hooks.
- [`@tetherto/wdk-worklet-bundler`][wdk-bundler] — bundle generator.

[wdk-rgb-lightning]: https://github.com/UTEXO-Protocol/wdk-rgb-lightning
[wdk-wallet-rgb]: https://github.com/UTEXO-Protocol/wdk-wallet-rgb
[wdk-wallet-btc]: https://github.com/tetherto/wdk
[rgb-lightning-node]: https://github.com/UTEXO-Protocol/rgb-lightning-node
[wdk-rn-core]: https://github.com/tetherto/wdk-react-native-core
[wdk-bundler]: https://github.com/tetherto/wdk-worklet-bundler
