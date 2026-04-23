// Declares which WDK wallet packages should be compiled into the worklet
// bundle. `@tetherto/wdk-worklet-bundler` reads this and emits
// `.wdk-bundle/wdk-worklet.bundle.js` — a single multi-platform bundle
// containing both chains plus the iOS `.framework` and Android `.so`
// native addons (including `@utexo/rgb-lib-bare`'s prebuilds).
module.exports = {
  networks: {
    rgb:     { package: '@utexo/wdk-wallet-rgb' },
    bitcoin: { package: '@tetherto/wdk-wallet-btc' }
  }
}
