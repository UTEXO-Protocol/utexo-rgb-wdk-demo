# utexo-rgb-wdk-demo

Minimal Expo + TypeScript demo showing how to consume
[`@utexo/wdk-wallet-rgb`](https://github.com/UTEXO-Protocol/wdk-wallet-rgb)
under Tether's new **agnostic `pear-wrk-wdk` + `wdk-worklet-bundler`**
architecture.

The entire RGB integration surface here is:

```js
// wdk.config.js
module.exports = {
  networks: {
    rgb:     { package: '@utexo/wdk-wallet-rgb' },
    bitcoin: { package: '@tetherto/wdk-wallet-btc' }
  }
}
```

```tsx
// App.tsx (excerpt)
<WdkAppProvider bundle={{ bundle }} wdkConfigs={{ networks: { rgb: { ... }, bitcoin: { ... } } }}>
  <AppShell />
</WdkAppProvider>
```

```tsx
// src/RgbScreen.tsx (excerpt)
const rgb = useAccount<RgbExt>({ network: 'rgb', accountIndex: 0 })
const ext = rgb.extension()

await ext.issueAssetNia({ ticker: 'TST', name: 'TST', precision: 0, amounts: ['1000'] })
await ext.receiveAsset({ witness: false, amount: 100 })
await ext.createUtxos({ upTo: true, num: 5, size: 2000, feeRate: 2 })
await rgb.send({ to: invoice, asset: rgbAsset, amount: '100' })
```

No chain-specific HRPC handlers exist in `pear-wrk-wdk` — every call goes
through the generic `callMethod` dispatcher and lands on
`WalletAccountRgb.<methodName>` inside the worklet.

## Packages in use

| Package                             | Version                              |
| ----------------------------------- | ------------------------------------ |
| `@tetherto/wdk`                     | `^1.0.0-beta.7`                      |
| `@tetherto/wdk-wallet`              | `^1.0.0-beta.7`                      |
| `@tetherto/pear-wrk-wdk`            | `1.0.0-beta.8` (agnostic)            |
| `@tetherto/wdk-worklet-bundler`     | `^1.0.0-beta.3` (dev)                |
| `@tetherto/wdk-react-native-core`   | `^1.0.0-beta.8`                      |
| `@tetherto/wdk-secret-manager`      | `^1.0.0-beta.3`                      |
| `@tetherto/wdk-wallet-btc`          | `^1.0.0-beta.8`                      |
| `@utexo/wdk-wallet-rgb`             | `github:Jainakin/wdk-wallet-rgb#80995f9` |

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
cross-platform worklet plus iOS `.framework` and Android `.so` native addons
for `@utexo/rgb-lib-bare` and every other bare native dep.

### 3. Configure `.env`

Copy `.env.example` → `.env`. For the regtest Docker stack
(`rgb-lib-nodejs/rgb-lib/tests/docker-compose.yml`):

```
# iOS simulator — host maps to `localhost`
EXPO_PUBLIC_RGB_NETWORK=regtest
EXPO_PUBLIC_RGB_INDEXER_URL=tcp://localhost:50001
EXPO_PUBLIC_RGB_TRANSPORT_ENDPOINT=rpc://localhost:3000/json-rpc

# Android emulator — host is `10.0.2.2`
# EXPO_PUBLIC_RGB_INDEXER_URL=tcp://10.0.2.2:50001
# EXPO_PUBLIC_RGB_TRANSPORT_ENDPOINT=rpc://10.0.2.2:3000/json-rpc
```

The `dataDir` for rgb-lib's SQLite state is **not** an env var — it's
computed in `App.tsx` from `expo-file-system`'s `Paths.document.uri`.
That resolves per platform:

- iOS: `file:///.../Documents/` (app sandbox, persistent)
- Android: `file:///data/user/0/<pkg>/files/` (app-private, persistent)

The `file://` prefix is stripped before handing to rgb-lib. If you need
to relocate the wallet store, edit `RGB_DATA_DIR` in `App.tsx`.

Bring the regtest stack up once:

```bash
cd ../rgb-lib-nodejs/rgb-lib/tests && docker compose up -d
```

Mine a block when needed:

```bash
docker exec tests-bitcoind-1 bitcoin-cli -regtest \
  -rpcuser=user -rpcpassword=default_password \
  -rpcwallet=miner -generate 1
```

### 4. Run on device / simulator

```bash
# iOS simulator (note the LANG workaround for CocoaPods)
LANG=en_US.UTF-8 npx expo run:ios

# Android emulator (requires android/local.properties with sdk.dir=…)
echo "sdk.dir=$HOME/Library/Android/sdk" > android/local.properties
npx expo run:android
```

First launch:

1. WDK worklet starts (loads `.wdk-bundle/wdk-worklet.bundle.js`)
2. Tap **"Create new wallet"** — a fresh BIP-39 seed is generated,
   displayed once for backup, and stored behind the platform keychain.
3. Drop some regtest BTC at the displayed address, then
   **refreshWallet** → **createUtxos** → **issueAssetNia** → **receiveAsset**.

## What this app does NOT demonstrate

Deliberately out of scope to keep the wiring minimal:

- UI polish, navigation, forms, persistence of transfer history.
- Production error handling (user-visible toasts, retry policies).
- Backup/restore flows beyond mnemonic display.
- Biometric unlock prompts (the provider does this for real wallets; the
  demo uses a single hard-coded wallet id, `rgb-demo-wallet`).

Everything here is the thinnest possible wrapper around
[`@tetherto/wdk-react-native-core`](https://www.npmjs.com/package/@tetherto/wdk-react-native-core)'s
hooks so you can see exactly where each RGB call is made.

## Layout

```
utexo-rgb-wdk-demo/
├── wdk.config.js                  declares `rgb` + `bitcoin` packages for the bundler
├── .wdk-bundle/
│   └── wdk-worklet.bundle.js      generated by `wdk-worklet-bundler generate`
├── metro.config.js                teaches Metro to watch `.wdk-bundle/`
├── App.tsx                        <WdkAppProvider> root + network configs
├── src/
│   ├── WalletGate.tsx             NO_WALLET / LOCKED / READY routing
│   └── RgbScreen.tsx              full RGB method surface via `useAccount().extension()`
├── ios/                           generated by `expo prebuild`
└── android/                       generated by `expo prebuild`
```

## References

- [`wdk-wallet-rgb/ARCHITECTURE.md`](https://github.com/UTEXO-Protocol/wdk-wallet-rgb/blob/main/ARCHITECTURE.md) — full method surface
- [`utexo-rgb-wdk/NEW_ARCHITECTURE.md`](https://github.com/Jainakin/utexo-rgb-wdk/blob/main/NEW_ARCHITECTURE.md) — consumption guide
- [`@tetherto/wdk-react-native-core` README](https://github.com/tetherto/wdk-react-native-core#readme) — provider + hooks
- [`@tetherto/wdk-worklet-bundler`](https://github.com/tetherto/wdk-worklet-bundler) — bundle generator
