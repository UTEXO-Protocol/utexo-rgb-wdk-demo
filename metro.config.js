// Learn more https://docs.expo.dev/guides/customizing-metro
const { getDefaultConfig } = require('expo/metro-config')

const config = getDefaultConfig(__dirname)

// The worklet bundle lives under `.wdk-bundle/wdk-worklet.bundle.js`.
// Metro's default `blockList` ignores dotfile folders — explicitly allow
// watching it so `import bundle from './.wdk-bundle/wdk-worklet.bundle.js'`
// resolves. The file itself is a normal `.js` that does
// `module.exports = "<~6 MB string>"`, which Metro parses fine.
const path = require('path')
config.watchFolders = [
  ...(config.watchFolders ?? []),
  path.resolve(__dirname, '.wdk-bundle')
]

module.exports = config
