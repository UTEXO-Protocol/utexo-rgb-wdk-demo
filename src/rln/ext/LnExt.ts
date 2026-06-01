// Typed surface for the RGB Lightning extension proxy.
//
// Every method on `WalletAccountRgbLightning` (in the worklet) is
// reachable through `useAccount<LnExt>().extension()` — the proxy
// forwards `ext.<name>(...args)` to the same-named method via HRPC.
//
// This file documents the full surface (52 methods) so the UI gets
// IntelliSense and the autonomous TestRunner stays type-checked.
// Response shapes mirror RLN's openapi.yaml — `?` on fields RLN may
// omit depending on state.

export type LnExt = {
  // ─────────────────────── Lifecycle ───────────────────────
  unlock: (req: UnlockRequest) => Promise<{ ok: true }>
  getBootstrap: () => Promise<{
    node_id?: string
    account_xpub_vanilla?: string
    account_xpub_colored?: string
    master_fingerprint?: string
  }>
  shutdown: () => Promise<{ ok: true }>

  // ─────────────────────── VSS recovery ───────────────────────
  /**
   * Forcibly take over a stale VSS ownership fence after the previous
   * node died holding it. Authenticates with the wallet password.
   * Throws Rln(FailedVssInit) if VSS isn't configured. Pointing two
   * live nodes at the same VSS store corrupts state — only call this
   * when you're certain the previous owner is gone.
   */
  clearVssFence: (password: string) => Promise<{ ok: true }>

  // ─────────────────────── APay + LSP ───────────────────────
  /**
   * Receiver-side async-payments registration with an LSP. Returns
   * the upstream AsyncOrderNewResponse (PR #51 — host_node_id,
   * request_id, order_id, status, accepted_through_index,
   * next_index_expected, unused_hashes, refill_batch_size,
   * first_hash_index).
   */
  apayNew: (hostNodeId: string) => Promise<{
    request_id?: string
    host_node_id?: string
    protocol_version?: string
    order_id?: string | number
    status?: string
    accepted_through_index?: number
    next_index_expected?: number
    unused_hashes?: number
    refill_batch_size?: number
    first_hash_index?: number
  }>

  /**
   * One-shot LSP bootstrap. connectPeer + wait-listPeers-visible +
   * optional apayNew. See WalletAccountRgbLightning.bootstrapLsp for
   * the full semantics.
   */
  bootstrapLsp: (opts: {
    peerPubkeyAndAddr: string
    hostNodeId?: string
    waitForPeerMs?: number
    pollIntervalMs?: number
  }) => Promise<{
    connect: unknown
    peerVisible: boolean
    apay?: {
      request_id?: string
      order_id?: string | number
      status?: string
      accepted_through_index?: number
      [k: string]: unknown
    }
  }>

  /** Pay a Lightning Address (LUD-06) via the wallet's own RLN node. */
  payLightningAddress: (
    addr: string,
    amountMsat: number | bigint | string,
    opts?: Record<string, unknown>
  ) => Promise<{
    invoice: string
    sendResult: unknown
    discovery: Record<string, unknown>
    callbackUrl: string
  }>

  /**
   * Ask the LSP to fulfil an RGB deposit by paying a BOLT11 invoice
   * the caller supplies; LSP returns an RGB invoice the sender then
   * pays. Caller monitors completion via its own RLN node.
   */
  requestLspRgbDeposit: (args: {
    lsp: string
    lnInvoice?: string
    lnInvoiceRequest?: Record<string, unknown>
    rgb: Record<string, unknown>
    lspOpts?: Record<string, unknown>
  }) => Promise<{ lnInvoice: string, rgbInvoice: string, mappingId: number }>

  /**
   * Pay an RGB invoice via the LSP-mediated bridge: LSP issues a
   * BOLT11 for the caller to pay; once paid, LSP runs sendrgb to
   * the RGB invoice's recipient.
   */
  payRgbViaLsp: (args: {
    lsp: string
    rgbInvoice: string
    ln: Record<string, unknown>
    lspOpts?: Record<string, unknown>
  }) => Promise<{ lnInvoice: string, rgbInvoice: string, mappingId: number, sendResult: unknown }>

  // ─────────────────────── Node info / network ───────────────────────
  getNodeInfo: () => Promise<{
    pubkey?: string
    num_peers?: number
    num_channels?: number
    num_usable_channels?: number
    block_height?: number
    network?: string
  }>
  getNetworkInfo: () => Promise<{ network?: string; height?: number }>
  sync: () => Promise<{ ok: true }>
  checkIndexerUrl: (url: string) => Promise<unknown>
  checkProxyEndpoint: (endpoint: string) => Promise<unknown>

  // ─────────────────────── BTC + UTXOs ───────────────────────
  getAddress: () => Promise<{ address: string } | string>
  getBalance: (skipSync?: boolean) => Promise<string>
  getBalanceDetails: (skipSync?: boolean) => Promise<{
    vanilla?: { settled?: number; future?: number; spendable?: number }
    colored?: { settled?: number; future?: number; spendable?: number }
  }>
  getTransactions: (skipSync?: boolean) => Promise<{
    transactions?: Array<Record<string, unknown>>
  } | Array<Record<string, unknown>>>
  listUnspents: (skipSync?: boolean) => Promise<{
    unspents?: Array<Record<string, unknown>>
  } | Array<Record<string, unknown>>>
  sendTransaction: (req: SendBtcRequest) => Promise<{ txid?: string }>
  createUtxos: (req: CreateUtxosRequest) => Promise<{ ok: true }>
  estimateFee: (blocks: number) => Promise<{ fee_rate?: number }>

  // ─────────────────────── Peers / channels ───────────────────────
  connectPeer: (peerPubkeyAndAddr: string) => Promise<{ ok: true }>
  disconnectPeer: (req: { peer_pubkey: string }) => Promise<{ ok: true }>
  listPeers: () => Promise<{ peers?: Array<{ pubkey?: string; address?: string }> }>
  openChannel: (req: OpenChannelRequest) => Promise<{
    temporary_channel_id?: string
    channel_id?: string
  }>
  closeChannel: (req: CloseChannelRequest) => Promise<{ ok: true }>
  listChannels: () => Promise<Array<ChannelInfo>>
  getChannelId: (temporaryChannelIdHex: string) => Promise<{ channel_id?: string }>

  // ─────────────────────── BOLT11 invoices ───────────────────────
  createInvoice: (req: LnInvoiceRequest) => Promise<{
    invoice?: string
    payment_hash?: string
    expiry?: number
  }>
  decodeInvoice: (invoice: string) => Promise<unknown>
  getInvoiceStatus: (invoice: string) => Promise<{ status?: string }>
  cancelHodlInvoice: (req: { payment_hash: string }) => Promise<{ ok: true }>
  claimHodlInvoice: (req: { payment_image: string }) => Promise<unknown>

  // ─────────────────────── Payments ───────────────────────
  sendPayment: (req: SendPaymentRequest) => Promise<{ payment_hash?: string; status?: string }>
  keysend: (req: KeysendRequest) => Promise<{ payment_hash?: string; status?: string }>
  listPayments: () => Promise<{ payments?: unknown[] } | unknown[]>
  /**
   * Look up a payment by hash + type. The accepted variant strings
   * match the SDK uniffi `PaymentType` enum exactly:
   *   - 'Outbound'         — payment we sent (was `sent` in old HTTP API)
   *   - 'InboundAutoClaim' — invoice we issued + auto-claimed (was `received`)
   *   - 'InboundHodl'      — invoice we issued in hodl mode
   * The old lowercase strings (`sent`/`received`/`swap`) are rejected
   * at the SDK layer with `unknown variant ...` — do NOT use them.
   */
  getPayment: (paymentHashHex: string, paymentType: 'Outbound' | 'InboundAutoClaim' | 'InboundHodl') => Promise<unknown>

  // ─────────────────────── RGB assets ───────────────────────
  issueAssetNia: (req: IssueAssetNiaRequest) => Promise<AssetSummary>
  issueAssetUda: (req: IssueAssetUdaRequest) => Promise<AssetSummary>
  issueAssetCfa: (req: IssueAssetCfaRequest) => Promise<AssetSummary>
  issueAssetIfa: (req: IssueAssetIfaRequest) => Promise<AssetSummary>
  listAssets: (filterAssetSchemas?: string[]) => Promise<AssetsResponse>
  getAssetBalance: (assetId: string) => Promise<{
    settled?: number; future?: number; spendable?: number
    offchain_outbound?: number; offchain_inbound?: number
  }>
  getAssetMetadata: (assetId: string) => Promise<unknown>

  // ─────────────────────── RGB invoices / transfers ───────────────────────
  createRgbInvoice: (req: RgbInvoiceRequest) => Promise<{
    recipient_id?: string
    invoice?: string
    expiration_timestamp?: number
  }>
  decodeRgbInvoice: (invoice: string) => Promise<unknown>
  sendRgbAsset: (req: SendRgbRequest) => Promise<{ txid?: string }>
  refreshTransfers: (req: { asset_id?: string; skip_sync?: boolean }) => Promise<{ ok: true }>
  failTransfers: (req: { batch_transfer_idx?: number; no_asset_only?: boolean; skip_sync?: boolean }) => Promise<unknown>
  inflate: (req: InflateRequest) => Promise<unknown>
  listTransfers: (assetId?: string) => Promise<unknown>

  // ─────────────────────── Asset media ───────────────────────
  getAssetMedia: (digest: string) => Promise<{ bytes_hex?: string; mime?: string }>
  postAssetMedia: (req: { file_path: string }) => Promise<{ digest?: string }>

  // ─────────────────────── Sign / onion / diagnostics ───────────────────────
  sign: (message: string) => Promise<{ signed_message?: string }>
  sendOnionMessage: (req: { node_ids: string[]; tlv_type: number; data: string }) => Promise<{ ok: true }>

  // ─────────────────────── IWalletAccount stubs (generic surface) ───────────────────────
  transfer: (opts: TransferOptions) => Promise<{ hash: string; fee: string }>
  quoteTransfer: (opts: TransferOptions) => Promise<{ fee: string }>
  quoteSendTransaction: (tx: { to: string; value: number | string }) => Promise<{ fee: string }>
  getTransactionReceipt: (hash: string) => Promise<unknown | null>
  getKeyPair: () => Promise<{ publicKey: string; privateKey: null }>
  toReadOnlyAccount: () => Promise<unknown>
  verify: (message: string, signature: string) => Promise<boolean>
  signTransaction: (tx: unknown) => Promise<unknown>
}

// ── Request / response shapes (subset of openapi.yaml) ────────────────

export interface UnlockRequest {
  bitcoind_rpc_username: string
  bitcoind_rpc_password: string
  bitcoind_rpc_host: string
  bitcoind_rpc_port: number
  indexer_url: string
  proxy_endpoint: string
  announce_addresses?: string[]
  announce_alias?: string
}

export interface SendBtcRequest {
  amount: number
  address: string
  fee_rate: number
  skip_sync: boolean
}

export interface CreateUtxosRequest {
  up_to?: boolean
  num?: number
  size?: number
  fee_rate: number
  skip_sync?: boolean
}

export interface OpenChannelRequest {
  peer_pubkey_and_opt_addr: string
  capacity_sat: number
  push_msat?: number
  asset_amount?: number
  asset_id?: string
  public?: boolean
  with_anchors?: boolean
  fee_base_msat?: number
  fee_proportional_millionths?: number
  temporary_channel_id?: string
}

export interface CloseChannelRequest {
  channel_id: string
  peer_pubkey: string
  force: boolean
}

export interface ChannelInfo {
  channel_id?: string
  peer_pubkey?: string
  asset_id?: string | null
  asset_local_amount?: number
  asset_remote_amount?: number
  capacity_sat?: number
  local_balance_msat?: number
  local_balance_sat?: number
  counterparty?: string
  ready?: boolean
  public?: boolean
  is_usable?: boolean
}

export interface LnInvoiceRequest {
  amt_msat?: number | null
  expiry_sec: number
  asset_id?: string | null
  asset_amount?: number | null
  hodl_invoice?: boolean
  hodl_invoice_payment_hash?: string | null
}

export interface SendPaymentRequest {
  invoice: string
  amt_msat?: number | null
  asset_id?: string | null
}

export interface KeysendRequest {
  dest_pubkey: string
  amt_msat: number
  asset_id?: string | null
  asset_amount?: number | null
}

export interface IssueAssetNiaRequest {
  amounts: number[]
  ticker: string
  name: string
  precision: number
}
export interface IssueAssetUdaRequest {
  ticker: string
  name: string
  details?: string | null
  media_file_path?: string | null
  attachments_file_paths?: string[]
}
export interface IssueAssetCfaRequest {
  amounts: number[]
  name: string
  details?: string | null
  precision: number
  media_file_path?: string | null
}
export interface IssueAssetIfaRequest {
  amounts: number[]
  inflation_amounts: number[]
  ticker: string
  name: string
  precision: number
}

export interface AssetSummary {
  asset_id?: string
  ticker?: string
  name?: string
  precision?: number
  schema?: string
}

export interface AssetsResponse {
  nia?: AssetSummary[]
  cfa?: AssetSummary[]
  ifa?: AssetSummary[]
  uda?: AssetSummary[]
}

export interface RgbInvoiceRequest {
  min_confirmations: number
  asset_id?: string | null
  amount?: number | null
  duration_seconds?: number | null
}

export interface SendRgbRequest {
  asset_id?: string
  amount?: number
  recipient_id: string
  donation?: boolean
  fee_rate?: number
  min_confirmations?: number
  transport_endpoints?: string[]
  skip_sync?: boolean
}

export interface InflateRequest {
  asset_id: string
  amount: number
}

export interface TransferOptions {
  token: string
  recipient: string
  amount: number | string
  feeRate?: number
}
