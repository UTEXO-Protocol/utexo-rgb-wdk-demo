// Declares which WDK wallet packages should be compiled into the worklet
// bundle. `@tetherto/wdk-worklet-bundler` reads this and emits
// `.wdk-bundle/wdk-worklet.bundle.js` — a single multi-platform bundle
// containing each chain plus the iOS `.framework` and Android `.so`
// native addons (including `@utexo/rgb-lib-bare`'s and
// `@utexo/rgb-lightning-node-bare`'s prebuilds).
module.exports = {
  networks: {
    rgb:             { package: '@utexo/wdk-wallet-rgb' },
    bitcoin:         { package: '@tetherto/wdk-wallet-btc' },
    'rgb-lightning': { package: '@utexo/wdk-rgb-lightning' }
  }
}
