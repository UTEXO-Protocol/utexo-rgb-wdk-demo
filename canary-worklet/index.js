/**
 * Canary 2 worklet — runs the rgb-lightning-node-bare smoke test
 * inside a bare worklet on iOS. RN side spawns a Worklet, listens for
 * IPC, and renders the result.
 */

const fs = require('bare-fs')
const os = require('bare-os')
const path = require('bare-path')
const { IPC } = BareKit

const { uniffiHealthcheck, uniffiIsInitialized, SdkNode } = require('@utexo/rgb-lightning-node-bare')

function send (level, msg) {
  const line = `[${level}] ${msg}\n`
  IPC.write(Buffer.from(line))
}

async function main () {
  send('info', '=== Canary 2 (iOS simulator, bare worklet) ===')

  // Step 1: extern "C" boundary
  try {
    const hc = uniffiHealthcheck()
    send('info', `healthcheck: ${hc}`)
    if (hc !== 'rgb_lightning_node_uniffi_ready') throw new Error('unexpected healthcheck')
  } catch (e) {
    send('fail', `healthcheck threw: ${e.message}`)
    return
  }

  try {
    const init = uniffiIsInitialized()
    send('info', `isInitialized: ${init}`)
  } catch (e) {
    send('fail', `isInitialized threw: ${e.message}`)
    return
  }

  // Step 2: SdkNode lifecycle (LDK + tokio boot)
  const dataDir = path.join(os.tmpdir(), `rln-canary2-${Date.now()}`)
  try {
    fs.mkdirSync(dataDir, { recursive: true })
  } catch (e) {
    send('fail', `mkdir ${dataDir} failed: ${e.message}`)
    return
  }
  send('info', `dataDir: ${dataDir}`)

  let node
  try {
    node = SdkNode.create({
      storage_dir_path: dataDir,
      daemon_listening_port: 0,
      ldk_peer_listening_port: 0,
      network: 'regtest',
      max_media_upload_size_mb: 5,
      enable_virtual_channels_v0: false
    })
    send('info', '✓ SdkNode created')
  } catch (e) {
    send('fail', `SdkNode.create threw: ${e.message}`)
    return
  }

  try {
    node.shutdown()
    send('info', '✓ SdkNode shutdown clean')
  } catch (e) {
    send('fail', `shutdown threw: ${e.message}`)
    return
  }

  send('pass', '✅ Canary 2 PASSED — bare ↔ C-FFI ↔ tokio ↔ LDK boot OK on iOS sim')
}

IPC.on('data', (data) => {
  const cmd = data.toString().trim()
  if (cmd === 'run') {
    main().catch((e) => send('fail', `unexpected: ${e.message}`))
  }
})

send('ready', 'worklet up')
