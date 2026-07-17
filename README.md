# ⚡ btc-mcp-srv

**An MCP server that lets AI agents send and receive Bitcoin over the Lightning Network.**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node.js >= 20](https://img.shields.io/badge/node-%3E%3D20-brightgreen)](https://nodejs.org)
[![MCP](https://img.shields.io/badge/protocol-MCP-blueviolet)](https://modelcontextprotocol.io)

> Sponsored by **[LIGHTPHON.com](https://lightphon.com)** ⚡

`btc-mcp-srv` is a [Model Context Protocol](https://modelcontextprotocol.io) server that gives any MCP-capable AI agent (Claude Desktop, Claude Code, Cursor, and others) a Lightning wallet it can operate safely: create invoices, pay invoices and Lightning addresses, check balances and transaction history — all guarded by configurable spending limits.

## Features

- **Two backends, one interface** — connect via **NWC (Nostr Wallet Connect)** to almost any modern wallet (Alby Hub, coinos, Primal, LNbits, …) or directly to your own **LND node** over REST. Adding more backends is a single file.
- **Spending guard-rails built for agents** — a per-payment cap (`MAX_SEND_SATS`), a rolling 24-hour budget (`DAILY_BUDGET_SATS`), and a routing-fee ceiling (`MAX_FEE_PERCENT`). Set `MAX_SEND_SATS=0` for a receive-only wallet.
- **Trust, but verify** — invoices are decoded locally before paying; expired invoices are rejected; Lightning-address invoices are checked against the requested amount so a malicious LNURL server can't inflate the charge.
- **Agent-friendly output** — every tool returns structured JSON, and errors come back as readable tool errors instead of crashing the server.
- **Graphical setup wizard** — `npm run setup` opens a local web GUI to configure the backend, test the wallet connection, and generate your MCP client config. No hand-editing of env files required.
- **Your own full node, optional** — one click (or `npm run fullnode`) generates a Docker Compose stack running **Bitcoin Core + LND + Alby Hub (NWC)** on the same device, pre-wired together, so your agents can transact through a node you fully control. See [`fullnode/README.md`](fullnode/README.md).

## Tools

| Tool | What it does | Moves money? |
|---|---|---|
| `get_balance` | Wallet balance + remaining session budget | No |
| `create_invoice` | Create a BOLT11 invoice to receive sats | No |
| `decode_invoice` | Decode a BOLT11 invoice locally before paying | No |
| `lookup_invoice` | Check if an invoice was paid (by payment hash) | No |
| `list_transactions` | Recent incoming/outgoing payments | No |
| `pay_invoice` | Pay a BOLT11 invoice | **Yes** |
| `pay_lightning_address` | Pay `user@domain` via LNURL-pay | **Yes** |

## Quick start

```bash
git clone https://github.com/lightphon/BTC-LND-NWC-MCP-server.git
cd BTC-LND-NWC-MCP-server
npm install
npm run setup
```

`npm run setup` builds the project and opens the **setup wizard** in your browser (localhost only) — an 8-step GUI that covers, and can execute, the entire installation:

1. **Prerequisites** — checks Node, Docker engine, Docker Compose live,
2. **Generate** — creates the full-node stack (network, pruning, Alby Hub),
3. **Start the node** — start/stop the containers, container status, log viewer,
4. **LND wallet** — generate the 24-word seed, create and unlock the wallet (via LND's REST API, no terminal needed),
5. **Sync** — live progress bar for Bitcoin Core + LND sync state,
6. **Connect the wallet** — NWC or LND (one click auto-fills the stack's own credentials), spending limits, connection test, save to `.env`,
7. **MCP client** — ready-made `claude_desktop_config.json` snippet to copy,
8. **Fund it** — get a deposit address and channel-opening guidance.

Only connecting an existing wallet? Steps 6–7 are all you need.

Prefer doing it by hand? Configure via environment variables:

### Option A — NWC (recommended)

Get a connection string from your wallet (in Alby Hub: *Connections → Add connection*; set a wallet-side budget while you're there). Then add to your MCP client config, e.g. `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "bitcoin-lightning": {
      "command": "node",
      "args": ["/absolute/path/to/btc-mcp-srv/dist/index.js"],
      "env": {
        "LN_BACKEND": "nwc",
        "NWC_CONNECTION_STRING": "nostr+walletconnect://...",
        "MAX_SEND_SATS": "10000",
        "DAILY_BUDGET_SATS": "50000"
      }
    }
  }
}
```

### Option B — LND (REST)

```json
{
  "mcpServers": {
    "bitcoin-lightning": {
      "command": "node",
      "args": ["/absolute/path/to/btc-mcp-srv/dist/index.js"],
      "env": {
        "LN_BACKEND": "lnd",
        "LND_REST_URL": "https://127.0.0.1:8080",
        "LND_MACAROON_HEX": "<hex of your macaroon>",
        "LND_TLS_CERT_PATH": "/path/to/tls.cert",
        "MAX_SEND_SATS": "10000",
        "DAILY_BUDGET_SATS": "50000"
      }
    }
  }
}
```

Hex-encode a macaroon with:

```bash
xxd -ps -u -c 1000 ~/.lnd/data/chain/bitcoin/mainnet/admin.macaroon
```

For least privilege, bake a restricted macaroon instead of using `admin.macaroon`:

```bash
lncli bakemacaroon invoices:read invoices:write offchain:read offchain:write info:read
```

Restart your MCP client and ask the agent something like: *"Create an invoice for 1000 sats for a coffee"* or *"Pay this invoice: lnbc…"*.

## Run your own full node (optional)

Don't want to depend on a hosted wallet or someone else's node? The setup
GUI (section *5 · Your own full node*) — or `npm run fullnode` — generates a
Docker Compose stack in [`fullnode/`](fullnode/README.md) that runs on the
same device:

- **Bitcoin Core** (archival or pruned, mainnet/testnet4/signet),
- **LND**, wired to that bitcoind via ZMQ + RPC with generated credentials,
- optionally **Alby Hub**, which exposes the node over **Nostr Wallet
  Connect** — so the NWC backend of this server (and any other NWC app)
  can use your own node.

Full walkthrough in [`fullnode/README.md`](fullnode/README.md).

## Configuration reference

| Variable | Default | Description |
|---|---|---|
| `LN_BACKEND` | `nwc` | `nwc` or `lnd` |
| `NWC_CONNECTION_STRING` | — | `nostr+walletconnect://…` URL (NWC backend) |
| `LND_REST_URL` | — | LND REST base URL (LND backend) |
| `LND_MACAROON_HEX` | — | Hex-encoded macaroon |
| `LND_MACAROON_PATH` | — | Alternative: path to a macaroon file |
| `LND_TLS_CERT_PATH` | — | Path to LND's `tls.cert` (recommended) |
| `LND_SKIP_CERT_VERIFY` | `false` | Skip TLS verification (self-signed certs; avoid on untrusted networks) |
| `MAX_SEND_SATS` | `10000` | Max sats per single payment; `0` disables sending |
| `DAILY_BUDGET_SATS` | `50000` | Rolling 24h spend budget; `0` disables the budget |
| `MAX_FEE_PERCENT` | `1` | Max routing fee as % of the amount |
| `DEFAULT_INVOICE_EXPIRY` | `3600` | Default expiry (seconds) for created invoices |

A commented `.env.example` is included for local development.

## Security model

This server hands an AI agent the keys to real money. Layer your defenses:

1. **Wallet-side limits first.** NWC connections support wallet-enforced budgets and permissions — set them. On LND, bake a macaroon with only the permissions you need.
2. **Server-side limits second.** `MAX_SEND_SATS` and `DAILY_BUDGET_SATS` are enforced in this process, before any payment reaches the backend. The daily ledger is in-memory and resets on restart — treat it as a guard-rail, not accounting.
3. **Use a dedicated wallet.** Fund it only with what you're willing to let an agent spend. Don't connect your main stack.
4. **Secrets stay in env.** The connection string / macaroon never crosses the MCP channel, and `.env` is git-ignored.
5. **Treat wallet data as untrusted input.** Invoice descriptions, LNURL metadata and transaction memos are attacker-controlled text that flows back to the AI agent — a malicious payee could embed instructions in them (prompt injection). The spending limits are the backstop for exactly this class of attack; keep them tight.
6. **Hardened by design.** The setup GUI binds to 127.0.0.1, validates the `Host` header (DNS-rebinding protection) and blocks cross-site requests; LNURL-pay callbacks must be HTTPS on a public hostname (SSRF guard); spending-budget reservations are atomic, include the maximum routing fee, and are released on failed payments.

Known limitations: the 24h ledger lives in memory (restarting the server resets it — wallet-side budgets don't have this gap), and `LND_SKIP_CERT_VERIFY=true` disables TLS verification and should only ever be used on localhost.

## Development

```bash
npm install
npm run typecheck   # strict TS, no emit
npm run build       # compile to dist/
npm test            # build + unit tests (node:test)
npm run setup       # build + launch the setup GUI
npm run dev         # recompile on change
```

Project layout:

```
src/
├── index.ts          # entry point (stdio transport)
├── config.ts         # settings + backend factory
├── env.ts            # zero-dependency .env loader
├── tools.ts          # MCP tool definitions
├── safety.ts         # spending guard (per-payment cap + 24h budget)
├── bolt11.ts         # local BOLT11 decoding
├── lnaddress.ts      # Lightning address (LUD-16) resolution
├── types.ts          # LightningBackend interface + domain types
├── backends/
│   ├── nwc.ts        # Nostr Wallet Connect driver
│   └── lnd.ts        # LND REST driver
├── setup/
│   ├── server.ts     # setup GUI HTTP server (localhost only)
│   └── page.ts       # the single-file setup GUI
└── test/             # unit tests (node --test)
```

CI runs typecheck, build, and the test suite on Node 20 and 22 for every push and pull request (`.github/workflows/ci.yml`).

To add a backend (Core Lightning, LNbits, Phoenixd, …): implement `LightningBackend` from `src/types.ts` in a new file under `src/backends/`, then register it in `src/config.ts`.

## Contributing

Issues and PRs are welcome. Keep PRs focused, keep `npm run typecheck` clean, and never commit credentials or real connection strings.

## Sponsor

This project is proudly sponsored by **[LIGHTPHON.com](https://lightphon.com)** — bringing Lightning payments to everyone.

## License

[MIT](LICENSE) © 2026 LIGHTPHON.com and contributors
