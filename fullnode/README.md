# Run your own full node (Bitcoin Core + LND + NWC)

This directory hosts a Docker Compose stack that runs a **sovereign
Lightning setup on the same device** as btc-mcp-srv:

```
bitcoind  ──ZMQ/RPC──▶  lnd  ──gRPC──▶  albyhub (optional)
 full/pruned node        Lightning        Nostr Wallet Connect
                                          for btc-mcp-srv & other apps
```

Your AI agents then transact through **your own node** — no custodian,
no third-party wallet.

## Prerequisites

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) (Windows/macOS) or Docker Engine + Compose (Linux)
- Disk space: ~80 GB with the default pruning, ~750+ GB for a mainnet archival node
- Patience: the initial block download takes hours to days

## 1. Generate the stack

Run `npm run setup` in the project root and use section **5 · Your own
full node** — or from the command line:

```bash
npm run fullnode -- --network mainnet --prune 80000
# options: --network mainnet|testnet4|signet  --prune <MB, 0=archival>
#          --no-alby  --alias "my node"
#          --datadir <path>   store the blockchain elsewhere (see below)
```

This writes `docker-compose.yml`, `bitcoin/bitcoin.conf` and
`lnd/lnd.conf` here, with a fresh RPC password wiring bitcoind ↔ lnd
together. Try **signet** first if you're new to this — it syncs in
minutes and uses valueless test coins.

### Choosing where Bitcoin Core stores the blockchain

By default the chain data lives in `fullnode/bitcoin/`. Because a mainnet
node needs hundreds of GB, you can put it on another drive — the setup
GUI has a *Bitcoin Core data folder* field in **step 2**, or pass
`--datadir` on the CLI:

```bash
npm run fullnode -- --network mainnet --datadir E:/bitcoin-data   # Windows
npm run fullnode -- --network mainnet --datadir /mnt/ssd/bitcoin  # Linux/macOS
```

Create the folder first. When the data directory is relocated, the
generated `bitcoin.conf` still lives in `fullnode/bitcoin/` and is
mounted **read-only** into the container, so your RPC credentials are
never copied around.

**To change the folder later**, set the new path in step 2 (or rerun the
CLI with a new `--datadir`) and regenerate. Then stop the stack
(`docker compose down`), move the existing chain data to the new folder,
and start it again — otherwise the node re-downloads the blockchain from
scratch.

## 2. Start it

```bash
cd fullnode
docker compose up -d
docker compose logs -f bitcoind   # watch the initial sync
```

## 3. Create the LND wallet (first run only)

```bash
docker compose exec lnd lncli create          # add --network=signet etc. off mainnet
```

Choose a strong wallet password and write down the 24-word seed. After
every restart, unlock with `docker compose exec lnd lncli unlock`.
LND becomes fully operational once bitcoind finishes syncing
(`docker compose exec lnd lncli getinfo` → `"synced_to_chain": true`).

## 4. Connect btc-mcp-srv to your node

**Via NWC (if you included Alby Hub):** open <http://localhost:8029>,
finish the onboarding, create a connection (set a budget!), copy the
`nostr+walletconnect://…` string and paste it into the setup GUI's NWC
backend. Done.

**Directly via LND REST:** in the setup GUI pick the LND backend with

- REST URL: `https://127.0.0.1:8080`
- TLS cert: `<project>/fullnode/lnd/tls.cert`
- Macaroon (hex):

```bash
node -e "console.log(require('fs').readFileSync('fullnode/lnd/data/chain/bitcoin/mainnet/admin.macaroon').toString('hex'))"
```

## 5. Fund it and open a channel

Send some sats to an on-chain address (`lncli newaddress p2tr`), then
open a channel to a well-connected node, e.g.:

```bash
docker compose exec lnd lncli connect <pubkey>@<host>:9735
docker compose exec lnd lncli openchannel --node_key <pubkey> --local_amt 100000
```

After the funding transaction confirms, your agents can send and receive
over Lightning through your own node.

## Notes & troubleshooting

- The generated configs contain credentials — they are git-ignored, keep
  them private.
- RPC (8332), LND REST/gRPC (8080/10009) and Alby Hub (8029) are
  published on **127.0.0.1 only**; P2P ports 8333/9735 are public.
- `docker compose down` stops everything; data persists in `bitcoin/`,
  `lnd/`, `albyhub/`. `docker compose pull && docker compose up -d`
  upgrades the images.
- Re-running the generator regenerates configs (new RPC password) —
  restart the whole stack afterwards so both sides agree.

Sponsored by [LIGHTPHON.com](https://lightphon.com) ⚡
