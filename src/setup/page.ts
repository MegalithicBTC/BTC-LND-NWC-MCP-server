/**
 * The setup wizard — a single self-contained HTML page (no external
 * assets) that walks through EVERY step of the installation and can
 * execute them: prerequisites, stack generation, docker lifecycle, LND
 * wallet creation/unlock, sync monitoring, backend configuration, MCP
 * client config, and funding.
 *
 * Served by src/setup/server.ts on localhost only.
 */
export const SETUP_PAGE = /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>btc-mcp-srv · Setup wizard</title>
<link rel="icon" href="data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>⚡</text></svg>">
<style>
  :root {
    --bg: #0d1117; --panel: #161b22; --panel2: #1c2129; --border: #2d333b;
    --text: #e6edf3; --muted: #8b949e; --accent: #f7b32b; --accent2: #ff9500;
    --ok: #3fb950; --err: #f85149; --radius: 12px;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    background: var(--bg); color: var(--text); min-height: 100vh;
    font-family: -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    display: flex; justify-content: center; padding: 32px 16px;
  }
  .wrap { width: 100%; max-width: 900px; }
  header { text-align: center; margin-bottom: 22px; }
  header h1 { font-size: 28px; letter-spacing: -0.5px; }
  header h1 .bolt { color: var(--accent); }
  header p { color: var(--muted); margin-top: 6px; font-size: 14px; }
  header a { color: var(--accent); text-decoration: none; }
  nav {
    display: flex; flex-wrap: wrap; gap: 8px; justify-content: center;
    margin-bottom: 24px;
  }
  nav a {
    font-size: 12px; color: var(--muted); text-decoration: none;
    border: 1px solid var(--border); border-radius: 999px; padding: 6px 12px;
    background: var(--panel);
  }
  nav a:hover { color: var(--accent); border-color: var(--accent); }
  .card {
    background: var(--panel); border: 1px solid var(--border);
    border-radius: var(--radius); padding: 22px; margin-bottom: 18px;
  }
  .card h2 {
    font-size: 15px; text-transform: uppercase; letter-spacing: 1px;
    color: var(--muted); margin-bottom: 4px;
  }
  .card .sub { font-size: 13px; color: var(--muted); margin-bottom: 14px; line-height: 1.55; }
  .card .sub b { color: var(--text); }
  .card .sub a { color: var(--accent); }
  .seg { display: flex; gap: 10px; }
  .seg button {
    flex: 1; padding: 14px; border-radius: 10px; cursor: pointer;
    border: 1px solid var(--border); background: var(--panel2);
    color: var(--text); font-size: 15px; font-weight: 600; transition: .15s;
  }
  .seg button.active {
    border-color: var(--accent); background: rgba(247,179,43,.1);
    color: var(--accent);
  }
  .seg button small { display: block; font-weight: 400; color: var(--muted); margin-top: 4px; font-size: 12px; }
  .seg button.active small { color: rgba(247,179,43,.8); }
  label { display: block; font-size: 13px; color: var(--muted); margin: 14px 0 6px; }
  input[type=text], input[type=password], input[type=number], select {
    width: 100%; padding: 10px 12px; border-radius: 8px; font-size: 14px;
    border: 1px solid var(--border); background: var(--panel2); color: var(--text);
    font-family: ui-monospace, "Cascadia Code", Consolas, monospace;
  }
  input:focus, select:focus { outline: none; border-color: var(--accent); }
  .row { display: grid; grid-template-columns: 1fr 1fr; gap: 0 16px; }
  @media (max-width: 640px) { .row { grid-template-columns: 1fr; } }
  .check { display: flex; align-items: center; gap: 8px; margin-top: 14px; font-size: 13px; color: var(--muted); cursor: pointer; }
  .check input { accent-color: var(--accent); width: 15px; height: 15px; }
  .hint { font-size: 12px; color: var(--muted); margin-top: 5px; line-height: 1.5; }
  .hint code, .sub code { color: var(--accent); background: var(--panel2); padding: 1px 5px; border-radius: 4px; }
  .actions { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 14px; }
  .btn {
    padding: 11px 20px; border-radius: 9px; border: none; cursor: pointer;
    font-size: 14px; font-weight: 700; transition: .15s;
  }
  .btn-primary { background: linear-gradient(135deg, var(--accent), var(--accent2)); color: #1a1a1a; }
  .btn-primary:hover { filter: brightness(1.1); }
  .btn-ghost { background: var(--panel2); color: var(--text); border: 1px solid var(--border); }
  .btn-ghost:hover { border-color: var(--accent); color: var(--accent); }
  .btn:disabled { opacity: .5; cursor: wait; }
  .stat { margin-top: 14px; padding: 12px 14px; border-radius: 8px; font-size: 14px; display: none; white-space: pre-wrap; word-break: break-word; line-height: 1.5; }
  .stat.ok { display: block; background: rgba(63,185,80,.1); border: 1px solid rgba(63,185,80,.4); color: var(--ok); }
  .stat.err { display: block; background: rgba(248,81,73,.1); border: 1px solid rgba(248,81,73,.4); color: var(--err); }
  .stat.busy { display: block; background: rgba(247,179,43,.08); border: 1px solid rgba(247,179,43,.35); color: var(--accent); }
  pre {
    background: #0a0d12; border: 1px solid var(--border); border-radius: 8px;
    padding: 14px; font-size: 12.5px; overflow-x: auto; line-height: 1.55;
    font-family: ui-monospace, "Cascadia Code", Consolas, monospace; color: #c9d1d9;
  }
  .jsonbar { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; flex-wrap: wrap; gap: 8px; }
  .pill { font-size: 12px; color: var(--muted); }
  footer { text-align: center; color: var(--muted); font-size: 12.5px; margin-top: 10px; line-height: 1.7; }
  footer a { color: var(--accent); text-decoration: none; }
  .hidden { display: none !important; }
  ul.checks { list-style: none; margin-top: 10px; }
  ul.checks li { padding: 7px 0; font-size: 14px; border-bottom: 1px solid var(--border); display: flex; gap: 10px; align-items: baseline; }
  ul.checks li:last-child { border-bottom: none; }
  .dot { font-size: 15px; }
  .dot.ok { color: var(--ok); } .dot.err { color: var(--err); } .dot.wait { color: var(--muted); }
  .seedbox {
    display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px;
    background: #0a0d12; border: 1px dashed var(--accent); border-radius: 8px;
    padding: 14px; margin-top: 12px; font-family: ui-monospace, Consolas, monospace;
    font-size: 13px;
  }
  .seedbox span { color: var(--muted); }
  .progressbar { height: 10px; background: var(--panel2); border-radius: 999px; overflow: hidden; margin-top: 12px; border: 1px solid var(--border); }
  .progressbar div { height: 100%; width: 0%; background: linear-gradient(90deg, var(--accent), var(--accent2)); transition: width .5s; }
  table.cont { width: 100%; margin-top: 12px; border-collapse: collapse; font-size: 13px; }
  table.cont td, table.cont th { padding: 7px 8px; border-bottom: 1px solid var(--border); text-align: left; }
  table.cont th { color: var(--muted); font-weight: 600; }
</style>
</head>
<body>
<div class="wrap">
  <header>
    <h1><span class="bolt">⚡</span> btc-mcp-srv setup wizard</h1>
    <p>From zero to an AI-operated Lightning wallet — every step in one place ·
       sponsored by <a href="https://lightphon.com" target="_blank" rel="noopener">LIGHTPHON.com</a></p>
  </header>

  <nav>
    <a href="#s1">1 Prerequisites</a><a href="#s2">2 Generate</a>
    <a href="#s3">3 Start node</a><a href="#s4">4 LND wallet</a>
    <a href="#s5">5 Sync</a><a href="#s6">6 Connect wallet</a>
    <a href="#s7">7 MCP client</a><a href="#s8">8 Fund it</a>
  </nav>

  <!-- ─── STEP 1 ──────────────────────────────────────────────── -->
  <div class="card" id="s1">
    <h2>Step 1 · Prerequisites</h2>
    <div class="sub">Running a full node needs <b>Docker Desktop</b>
      (<a href="https://www.docker.com/products/docker-desktop/" target="_blank" rel="noopener">download</a>).
      If you only want to connect an existing wallet (NWC or a remote LND),
      you can skip straight to <a href="#s6">step 6</a>.</div>
    <ul class="checks" id="prereqList"><li><span class="dot wait">●</span> Checking…</li></ul>
    <div class="actions"><button class="btn btn-ghost" onclick="checkPrereqs()">↻ Re-check</button></div>
  </div>

  <!-- ─── STEP 2 ──────────────────────────────────────────────── -->
  <div class="card" id="s2">
    <h2>Step 2 · Generate the node stack</h2>
    <div class="sub">Creates <code>fullnode/</code> with Bitcoin Core + LND
      (+ optional Alby Hub for NWC), pre-wired with fresh credentials.
      New to this? Pick <b>signet</b> — it syncs in minutes with valueless test coins.</div>
    <div class="row">
      <div>
        <label for="fnNetwork">Network</label>
        <select id="fnNetwork">
          <option value="mainnet">mainnet (real bitcoin)</option>
          <option value="testnet4">testnet4 (test coins)</option>
          <option value="signet" selected>signet (test coins)</option>
        </select>
      </div>
      <div>
        <label for="fnPrune">Prune (MB) — 0 = full archival node</label>
        <input type="number" id="fnPrune" min="0" value="80000">
        <div class="hint">80000 ≈ 80 GB kept. Full mainnet ≈ 750+ GB. Min 550.</div>
      </div>
      <div>
        <label for="fnAlias">Node alias (public)</label>
        <input type="text" id="fnAlias" value="btc-mcp-srv node" maxlength="32">
      </div>
      <div>
        <label>&nbsp;</label>
        <label class="check" style="margin-top:10px"><input type="checkbox" id="fnAlby" checked>
          Include Alby Hub (recommended — gives you NWC)</label>
      </div>
    </div>
    <label for="fnDataDir">Bitcoin Core data folder (blockchain storage)</label>
    <input type="text" id="fnDataDir" placeholder="./bitcoin  (default — inside fullnode/)">
    <div class="hint">Where Bitcoin Core keeps the blockchain (tens to hundreds of GB). Leave empty for the
      default <code>fullnode/bitcoin/</code>, or point it at another drive — e.g. <code>E:/bitcoin-data</code>
      or <code>/mnt/ssd/bitcoin</code>. Create the folder first. You can change this later and regenerate
      the stack; stop the node and move the existing data there before restarting.</div>
    <div class="actions">
      <button class="btn btn-primary" id="btnFn" onclick="genFullnode()">🧱 Generate stack files</button>
    </div>
    <div id="fnStatus" class="stat"></div>
  </div>

  <!-- ─── STEP 3 ──────────────────────────────────────────────── -->
  <div class="card" id="s3">
    <h2>Step 3 · Start the node</h2>
    <div class="sub">Starts the Docker containers. The first start downloads
      the images (~1 GB) and begins the blockchain sync.</div>
    <div class="actions">
      <button class="btn btn-primary" onclick="compose('up', this)">▶ Start stack</button>
      <button class="btn btn-ghost" onclick="compose('down', this)">■ Stop stack</button>
      <button class="btn btn-ghost" onclick="refreshContainers(this)">↻ Container status</button>
    </div>
    <div id="composeStatus" class="stat"></div>
    <div id="contBox"></div>
    <div class="jsonbar" style="margin-top:14px">
      <span class="pill">Logs:</span>
      <span style="display:flex;gap:8px;align-items:center">
        <select id="logSvc" style="width:auto;padding:7px 10px">
          <option value="bitcoind">bitcoind</option>
          <option value="lnd">lnd</option>
          <option value="albyhub">albyhub</option>
        </select>
        <button class="btn btn-ghost" style="padding:8px 14px" onclick="showLogs(this)">Show</button>
      </span>
    </div>
    <pre id="logsOut" class="hidden"></pre>
  </div>

  <!-- ─── STEP 4 ──────────────────────────────────────────────── -->
  <div class="card" id="s4">
    <h2>Step 4 · LND wallet</h2>
    <div class="sub">First run only: generate a seed, choose a password,
      create the wallet. After every restart of the stack, <b>unlock</b> it here.</div>
    <div class="actions">
      <button class="btn btn-ghost" onclick="walletStatus(this)">↻ Wallet status</button>
      <button class="btn btn-primary" onclick="genSeed(this)">1 · Generate seed</button>
    </div>
    <div id="seedBox" class="hidden">
      <div class="seedbox" id="seedWords"></div>
      <div class="hint" style="color:var(--err);margin-top:8px">⚠ Write these 24 words on paper, in order.
        They are the ONLY backup of the wallet. Anyone with them can take the funds.</div>
      <div class="row">
        <div>
          <label for="wPass">Wallet password (min 8 chars)</label>
          <input type="password" id="wPass" autocomplete="new-password">
        </div>
        <div>
          <label for="wPass2">Repeat password</label>
          <input type="password" id="wPass2" autocomplete="new-password">
        </div>
      </div>
      <div class="actions">
        <button class="btn btn-primary" onclick="initWallet(this)">2 · Create wallet</button>
      </div>
    </div>
    <div class="row" style="margin-top:6px">
      <div>
        <label for="uPass">Unlock password (after a restart)</label>
        <input type="password" id="uPass" autocomplete="current-password">
      </div>
      <div>
        <label>&nbsp;</label>
        <div class="actions" style="margin-top:0">
          <button class="btn btn-ghost" onclick="unlockWallet(this)">🔓 Unlock wallet</button>
        </div>
      </div>
    </div>
    <div id="walletStatusBox" class="stat"></div>
  </div>

  <!-- ─── STEP 5 ──────────────────────────────────────────────── -->
  <div class="card" id="s5">
    <h2>Step 5 · Wait for sync</h2>
    <div class="sub">LND becomes operational once Bitcoin Core is fully synced.
      Signet takes minutes; mainnet can take hours to days.</div>
    <div class="actions">
      <button class="btn btn-ghost" onclick="refreshSync(this)">↻ Refresh</button>
      <label class="check" style="margin-top:0"><input type="checkbox" id="autoSync" onchange="toggleAutoSync()"> Auto-refresh every 15s</label>
    </div>
    <div class="progressbar"><div id="syncBar"></div></div>
    <div id="syncStatus" class="stat"></div>
  </div>

  <!-- ─── STEP 6 ──────────────────────────────────────────────── -->
  <div class="card" id="s6">
    <h2>Step 6 · Connect the wallet backend</h2>
    <div class="sub">This is what the MCP server will actually use.
      <b>NWC</b>: with Alby Hub from this stack, open
      <a href="http://localhost:8029" target="_blank" rel="noopener">localhost:8029</a>
      once synced, create a connection (set a budget!) and paste the string here.
      NWC also works with hosted wallets (Alby, coinos…) if you skipped the full node.
      <b>LND</b>: click “Use this node” to auto-fill from the stack.</div>
    <div class="seg">
      <button id="segNwc" onclick="setBackend('nwc')">Nostr Wallet Connect
        <small>Alby Hub (this node or hosted), coinos…</small></button>
      <button id="segLnd" onclick="setBackend('lnd')">LND (REST)
        <small>This stack's LND or any LND node</small></button>
    </div>

    <div id="paneNwc">
      <label for="nwc">NWC connection string</label>
      <input type="password" id="nwc" placeholder="nostr+walletconnect://…" autocomplete="off">
      <label class="check"><input type="checkbox" onchange="nwc.type=this.checked?'text':'password'"> Show</label>
    </div>

    <div id="paneLnd" class="hidden">
      <div class="actions" style="margin-top:4px">
        <button class="btn btn-ghost" onclick="useThisNode(this)">⚙ Use this node (auto-fill)</button>
      </div>
      <label for="lndUrl">REST URL</label>
      <input type="text" id="lndUrl" placeholder="https://127.0.0.1:8080" autocomplete="off">
      <label for="lndMac">Macaroon (hex)</label>
      <input type="password" id="lndMac" placeholder="0201036c6e64…" autocomplete="off">
      <label class="check"><input type="checkbox" onchange="lndMac.type=this.checked?'text':'password'"> Show</label>
      <label for="lndCert">TLS certificate path <span style="opacity:.7">(recommended)</span></label>
      <input type="text" id="lndCert" placeholder="/path/to/tls.cert">
      <label class="check"><input type="checkbox" id="lndSkip"> Skip TLS verification (localhost only!)</label>
    </div>

    <h2 style="margin-top:22px">Spending limits</h2>
    <div class="row">
      <div>
        <label for="maxSend">Max per payment (sats)</label>
        <input type="number" id="maxSend" min="0" value="10000">
        <div class="hint">0 = receive-only</div>
      </div>
      <div>
        <label for="daily">Rolling 24h budget (sats)</label>
        <input type="number" id="daily" min="0" value="50000">
        <div class="hint">0 = no daily budget</div>
      </div>
      <div>
        <label for="fee">Max routing fee (%)</label>
        <input type="number" id="fee" min="0" step="0.1" value="1">
      </div>
      <div>
        <label for="expiry">Default invoice expiry (s)</label>
        <input type="number" id="expiry" min="60" value="3600">
      </div>
    </div>
    <div class="actions">
      <button class="btn btn-primary" id="btnTest" onclick="testConn()">⚡ Test connection</button>
      <button class="btn btn-ghost" id="btnSave" onclick="save()">💾 Save configuration (.env)</button>
    </div>
    <div id="status" class="stat"></div>
  </div>

  <!-- ─── STEP 7 ──────────────────────────────────────────────── -->
  <div class="card" id="s7">
    <h2>Step 7 · Add to your MCP client</h2>
    <div class="sub">Paste this into <code>claude_desktop_config.json</code>
      under <b>mcpServers</b> (or the equivalent for your MCP client), then
      restart the client. Your agents get all 7 Lightning tools.</div>
    <div class="jsonbar">
      <span class="pill"></span>
      <span>
        <label class="check" style="display:inline-flex;margin:0 14px 0 0">
          <input type="checkbox" id="embedEnv" onchange="renderJson()"> Embed credentials in JSON
        </label>
        <button class="btn btn-ghost" style="padding:8px 14px" onclick="copyJson()">Copy</button>
      </span>
    </div>
    <pre id="json"></pre>
  </div>

  <!-- ─── STEP 8 ──────────────────────────────────────────────── -->
  <div class="card" id="s8">
    <h2>Step 8 · Fund the node &amp; open a channel</h2>
    <div class="sub">To actually send/receive over Lightning your node needs
      funds and at least one channel. Get an on-chain address below, send sats
      to it (on <b>signet</b> use a faucet like
      <a href="https://signetfaucet.com" target="_blank" rel="noopener">signetfaucet.com</a>),
      wait for confirmation, then open a channel to a well-connected node:<br>
      <code>docker compose exec lnd lncli --network=signet connect &lt;pubkey&gt;@&lt;host&gt;:9735</code><br>
      <code>docker compose exec lnd lncli --network=signet openchannel --node_key &lt;pubkey&gt; --local_amt 100000</code></div>
    <div class="actions">
      <button class="btn btn-primary" onclick="newAddress(this)">₿ Get on-chain deposit address</button>
    </div>
    <div id="addrStatus" class="stat"></div>
  </div>

  <footer>
    btc-mcp-srv · MIT licensed · this wizard runs only on localhost ·
    <a href="https://lightphon.com" target="_blank" rel="noopener">LIGHTPHON.com</a>
  </footer>
</div>

<script>
const SERVER_PATH = "__SERVER_PATH__"; // injected by the setup server
let backend = 'nwc';
let autoSyncTimer = null;
let metaPrefilled = false; // fill step 2 from an existing stack.json only once
const $ = (id) => document.getElementById(id);

async function api(path, body) {
  const res = await fetch(path, {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.json();
}

function setStat(id, kind, msg) {
  const el = $(id);
  el.className = 'stat ' + kind;
  el.textContent = msg;
}

function busy(btn, on) { if (btn) btn.disabled = on; }

/* ── Step 1: prerequisites ─────────────────────────────────── */
async function checkPrereqs() {
  const list = $('prereqList');
  list.innerHTML = '<li><span class="dot wait">●</span> Checking…</li>';
  try {
    const r = await api('/api/node/prereqs');
    // If a stack was already generated, reflect its settings in step 2 so the
    // data folder (and network/Alby choice) can be reviewed and changed.
    if (!metaPrefilled && r.stack && r.stack.meta) {
      metaPrefilled = true;
      const m = r.stack.meta;
      if (m.network) $('fnNetwork').value = m.network;
      $('fnAlby').checked = m.withAlbyHub !== false;
      if (m.dataDir && m.dataDir !== './bitcoin') $('fnDataDir').value = m.dataDir;
    }
    const li = [];
    const item = (ok, text) => '<li><span class="dot ' + (ok ? 'ok' : 'err') +
      '">●</span> ' + text + '</li>';
    li.push(item(true, 'Node.js ' + r.node));
    li.push(item(r.docker.running, r.docker.running
      ? 'Docker engine running (v' + r.docker.version + ')'
      : (r.docker.error || 'Docker not available')));
    li.push(item(r.compose.installed, r.compose.installed
      ? 'Docker Compose v' + r.compose.version
      : 'Docker Compose not found'));
    li.push(item(r.stack.generated, r.stack.generated
      ? 'Stack generated (' + (r.stack.meta ? r.stack.meta.network : '?') +
        (r.stack.meta && r.stack.meta.withAlbyHub ? ' + Alby Hub' : '') +
        (r.stack.meta && r.stack.meta.dataDir && r.stack.meta.dataDir !== './bitcoin'
          ? ', data → ' + r.stack.meta.dataDir : '') + ') — see step 3'
      : 'Stack not generated yet — do step 2'));
    list.innerHTML = li.join('');
  } catch (e) {
    list.innerHTML = '<li><span class="dot err">●</span> ' + e.message + '</li>';
  }
}

/* ── Step 2: generate stack ────────────────────────────────── */
async function genFullnode() {
  busy($('btnFn'), true);
  setStat('fnStatus', 'busy', 'Generating stack files…');
  try {
    const r = await api('/api/fullnode', {
      network: $('fnNetwork').value,
      pruneMb: Number($('fnPrune').value || 0),
      withAlbyHub: $('fnAlby').checked,
      alias: $('fnAlias').value,
      dataDir: $('fnDataDir').value,
    });
    if (r.ok) {
      setStat('fnStatus', 'ok', '✓ Stack written to ' + r.dir +
        (r.overwritten.length ? '\\n(regenerated: ' + r.overwritten.join(', ') +
          ' — restart the stack in step 3)' : '') +
        '\\nNow continue with step 3.');
      checkPrereqs();
    } else {
      setStat('fnStatus', 'err', '✗ ' + r.error);
    }
  } catch (e) {
    setStat('fnStatus', 'err', '✗ ' + e.message);
  } finally {
    busy($('btnFn'), false);
  }
}

/* ── Step 3: docker lifecycle ──────────────────────────────── */
async function compose(action, btn) {
  busy(btn, true);
  setStat('composeStatus', 'busy',
    action === 'up' ? 'Starting containers (first time downloads ~1 GB of images)…'
                    : 'Stopping containers…');
  try {
    const r = await api('/api/node/compose', { action });
    if (r.ok) {
      setStat('composeStatus', 'ok', '✓ ' + (action === 'up'
        ? 'Stack started. Continue with step 4 (first run) or check sync in step 5.'
        : 'Stack stopped.'));
      refreshContainers();
    } else {
      setStat('composeStatus', 'err', '✗ ' + r.error);
    }
  } catch (e) {
    setStat('composeStatus', 'err', '✗ ' + e.message);
  } finally {
    busy(btn, false);
  }
}

async function refreshContainers(btn) {
  busy(btn, true);
  try {
    const r = await api('/api/node/compose', { action: 'ps' });
    const box = $('contBox');
    if (!r.ok) { box.innerHTML = ''; setStat('composeStatus', 'err', '✗ ' + r.error); return; }
    const rows = (r.containers || []).map((c) =>
      '<tr><td>' + (c.Service || c.Name || '?') + '</td><td>' +
      (c.State || '?') + '</td><td>' + (c.Status || '') + '</td></tr>').join('');
    box.innerHTML = rows
      ? '<table class="cont"><tr><th>Service</th><th>State</th><th>Status</th></tr>' + rows + '</table>'
      : '<div class="hint" style="margin-top:10px">No containers running.</div>';
  } catch (e) {
    setStat('composeStatus', 'err', '✗ ' + e.message);
  } finally {
    busy(btn, false);
  }
}

async function showLogs(btn) {
  busy(btn, true);
  try {
    const r = await api('/api/node/compose', { action: 'logs', service: $('logSvc').value });
    const out = $('logsOut');
    out.classList.remove('hidden');
    out.textContent = r.ok ? (r.output || '(no output)') : ('Error: ' + r.error);
  } finally {
    busy(btn, false);
  }
}

/* ── Step 4: LND wallet ────────────────────────────────────── */
async function walletStatus(btn) {
  busy(btn, true);
  setStat('walletStatusBox', 'busy', 'Checking wallet…');
  try {
    const r = await api('/api/node/lnd', { action: 'getinfo' });
    if (r.ok) {
      const i = r.result;
      setStat('walletStatusBox', 'ok',
        '✓ Wallet is up — alias "' + i.alias + '", pubkey ' +
        String(i.identity_pubkey).slice(0, 20) + '…\\n' +
        'synced_to_chain: ' + i.synced_to_chain +
        ' · block ' + i.block_height + ' · channels: ' + i.num_active_channels);
    } else {
      setStat('walletStatusBox', 'err',
        '✗ ' + r.error + '\\nIf the wallet exists but is locked, unlock it below. ' +
        'If it does not exist yet, generate a seed and create it.');
    }
  } catch (e) {
    setStat('walletStatusBox', 'err', '✗ ' + e.message);
  } finally {
    busy(btn, false);
  }
}

let currentSeed = null;
async function genSeed(btn) {
  busy(btn, true);
  setStat('walletStatusBox', 'busy', 'Requesting a new seed from LND…');
  try {
    const r = await api('/api/node/lnd', { action: 'genseed' });
    if (r.ok) {
      currentSeed = r.result.seed;
      $('seedWords').innerHTML = currentSeed
        .map((w, i) => '<div><span>' + (i + 1) + '.</span> ' + w + '</div>').join('');
      $('seedBox').classList.remove('hidden');
      setStat('walletStatusBox', 'ok',
        '✓ Seed generated. Write it down, set a password, then create the wallet.');
    } else {
      setStat('walletStatusBox', 'err', '✗ ' + r.error +
        '\\nIs the stack running (step 3)? If a wallet already exists, just unlock it.');
    }
  } catch (e) {
    setStat('walletStatusBox', 'err', '✗ ' + e.message);
  } finally {
    busy(btn, false);
  }
}

async function initWallet(btn) {
  if (!currentSeed) { setStat('walletStatusBox', 'err', '✗ Generate a seed first.'); return; }
  const p1 = $('wPass').value, p2 = $('wPass2').value;
  if (p1.length < 8) { setStat('walletStatusBox', 'err', '✗ Password must be at least 8 characters.'); return; }
  if (p1 !== p2) { setStat('walletStatusBox', 'err', '✗ Passwords do not match.'); return; }
  busy(btn, true);
  setStat('walletStatusBox', 'busy', 'Creating wallet…');
  try {
    const r = await api('/api/node/lnd', { action: 'init', password: p1, seed: currentSeed });
    if (r.ok) {
      currentSeed = null;
      $('seedBox').classList.add('hidden');
      $('wPass').value = ''; $('wPass2').value = '';
      setStat('walletStatusBox', 'ok',
        '✓ Wallet created and unlocked. LND is now syncing — check step 5. ' +
        'Keep the 24 words safe!');
    } else {
      setStat('walletStatusBox', 'err', '✗ ' + r.error);
    }
  } catch (e) {
    setStat('walletStatusBox', 'err', '✗ ' + e.message);
  } finally {
    busy(btn, false);
  }
}

async function unlockWallet(btn) {
  busy(btn, true);
  setStat('walletStatusBox', 'busy', 'Unlocking…');
  try {
    const r = await api('/api/node/lnd', { action: 'unlock', password: $('uPass').value });
    if (r.ok) {
      $('uPass').value = '';
      setStat('walletStatusBox', 'ok', '✓ Wallet unlocked.');
    } else {
      setStat('walletStatusBox', 'err', '✗ ' + r.error);
    }
  } catch (e) {
    setStat('walletStatusBox', 'err', '✗ ' + e.message);
  } finally {
    busy(btn, false);
  }
}

/* ── Step 5: sync monitor ──────────────────────────────────── */
async function refreshSync(btn) {
  busy(btn, true);
  try {
    const b = await api('/api/node/bitcoind');
    let msg = '';
    if (b.ok) {
      const pct = Math.min(100, b.progress * 100);
      $('syncBar').style.width = pct.toFixed(2) + '%';
      msg += 'Bitcoin Core (' + b.chain + '): ' + pct.toFixed(2) + '% — block ' +
        b.blocks + ' / ' + b.headers;
    } else {
      $('syncBar').style.width = '0%';
      msg += 'Bitcoin Core: ' + b.error;
    }
    const l = await api('/api/node/lnd', { action: 'getinfo' });
    if (l.ok) {
      msg += '\\nLND: synced_to_chain=' + l.result.synced_to_chain +
        ' · synced_to_graph=' + l.result.synced_to_graph;
      setStat('syncStatus', l.result.synced_to_chain && b.ok && b.progress > 0.999 ? 'ok' : 'busy', msg);
    } else {
      msg += '\\nLND: ' + l.error;
      setStat('syncStatus', 'busy', msg);
    }
  } catch (e) {
    setStat('syncStatus', 'err', '✗ ' + e.message);
  } finally {
    busy(btn, false);
  }
}

function toggleAutoSync() {
  if ($('autoSync').checked) {
    refreshSync();
    autoSyncTimer = setInterval(refreshSync, 15000);
  } else if (autoSyncTimer) {
    clearInterval(autoSyncTimer);
    autoSyncTimer = null;
  }
}

/* ── Step 6: backend config ────────────────────────────────── */
function setBackend(b) {
  backend = b;
  $('segNwc').classList.toggle('active', b === 'nwc');
  $('segLnd').classList.toggle('active', b === 'lnd');
  $('paneNwc').classList.toggle('hidden', b !== 'nwc');
  $('paneLnd').classList.toggle('hidden', b !== 'lnd');
  renderJson();
}

async function useThisNode(btn) {
  busy(btn, true);
  try {
    const r = await api('/api/node/lndcreds');
    if (r.ok && r.macaroonHex) {
      $('lndUrl').value = r.restUrl;
      $('lndMac').value = r.macaroonHex;
      $('lndCert').value = r.tlsCertPath;
      $('lndSkip').checked = false;
      renderJson();
      setStat('status', 'ok', '✓ Filled in from this stack\\'s LND. Now test the connection.');
    } else {
      setStat('status', 'err',
        '✗ Macaroon not found — is the stack running and the wallet created (steps 3–4)?');
    }
  } catch (e) {
    setStat('status', 'err', '✗ ' + e.message);
  } finally {
    busy(btn, false);
  }
}

function collect() {
  return {
    backend,
    nwcConnectionString: $('nwc').value.trim(),
    lndRestUrl: $('lndUrl').value.trim(),
    lndMacaroonHex: $('lndMac').value.trim(),
    lndTlsCertPath: $('lndCert').value.trim(),
    lndSkipCertVerify: $('lndSkip').checked,
    maxSendSats: Number($('maxSend').value || 0),
    dailyBudgetSats: Number($('daily').value || 0),
    maxFeePercent: Number($('fee').value || 0),
    defaultInvoiceExpiry: Number($('expiry').value || 3600),
  };
}

async function testConn() {
  busy($('btnTest'), true);
  setStat('status', 'busy', 'Connecting to your wallet…');
  try {
    const r = await api('/api/test', collect());
    if (r.ok) {
      setStat('status', 'ok', '✓ Connected via ' + r.backend + ' — balance: ' +
        r.balanceSats.toLocaleString() + ' sats');
    } else {
      setStat('status', 'err', '✗ ' + r.error);
    }
  } catch (e) {
    setStat('status', 'err', '✗ ' + e.message);
  } finally {
    busy($('btnTest'), false);
  }
}

async function save() {
  busy($('btnSave'), true);
  try {
    const r = await api('/api/save', collect());
    if (r.ok) {
      setStat('status', 'ok', '✓ Saved to ' + r.path +
        '\\nContinue with step 7, then restart your MCP client.');
    } else {
      setStat('status', 'err', '✗ ' + r.error);
    }
  } catch (e) {
    setStat('status', 'err', '✗ ' + e.message);
  } finally {
    busy($('btnSave'), false);
  }
}

/* ── Step 7: MCP client JSON ───────────────────────────────── */
function renderJson() {
  const s = collect();
  const env = {};
  if ($('embedEnv').checked) {
    env.LN_BACKEND = s.backend;
    if (s.backend === 'nwc') {
      env.NWC_CONNECTION_STRING = s.nwcConnectionString || '<your NWC string>';
    } else {
      env.LND_REST_URL = s.lndRestUrl || 'https://127.0.0.1:8080';
      env.LND_MACAROON_HEX = s.lndMacaroonHex || '<hex macaroon>';
      if (s.lndTlsCertPath) env.LND_TLS_CERT_PATH = s.lndTlsCertPath;
      if (s.lndSkipCertVerify) env.LND_SKIP_CERT_VERIFY = 'true';
    }
    env.MAX_SEND_SATS = String(s.maxSendSats);
    env.DAILY_BUDGET_SATS = String(s.dailyBudgetSats);
    env.MAX_FEE_PERCENT = String(s.maxFeePercent);
  }
  const entry = {
    'bitcoin-lightning': {
      command: 'node',
      args: [SERVER_PATH],
      ...(Object.keys(env).length ? { env } : {}),
    },
  };
  $('json').textContent = JSON.stringify({ mcpServers: entry }, null, 2);
}

function copyJson() {
  navigator.clipboard.writeText($('json').textContent)
    .then(() => setStat('status', 'ok', '✓ JSON copied to clipboard'));
}

/* ── Step 8: funding ───────────────────────────────────────── */
async function newAddress(btn) {
  busy(btn, true);
  setStat('addrStatus', 'busy', 'Requesting address…');
  try {
    const r = await api('/api/node/lnd', { action: 'newaddress' });
    if (r.ok) {
      setStat('addrStatus', 'ok', '✓ Send funds to this on-chain address:\\n' +
        r.result.address);
    } else {
      setStat('addrStatus', 'err', '✗ ' + r.error);
    }
  } catch (e) {
    setStat('addrStatus', 'err', '✗ ' + e.message);
  } finally {
    busy(btn, false);
  }
}

/* ── init ──────────────────────────────────────────────────── */
async function init() {
  checkPrereqs();
  try {
    const cfg = await api('/api/config');
    if (cfg.backend) {
      $('nwc').value = cfg.nwcConnectionString || '';
      $('lndUrl').value = cfg.lndRestUrl || '';
      $('lndMac').value = cfg.lndMacaroonHex || '';
      $('lndCert').value = cfg.lndTlsCertPath || '';
      $('lndSkip').checked = !!cfg.lndSkipCertVerify;
      $('maxSend').value = cfg.maxSendSats;
      $('daily').value = cfg.dailyBudgetSats;
      $('fee').value = cfg.maxFeePercent;
      $('expiry').value = cfg.defaultInvoiceExpiry;
      setBackend(cfg.backend);
      return;
    }
  } catch (e) { /* defaults */ }
  setBackend('nwc');
}
document.querySelectorAll('input, select').forEach((el) =>
  el.addEventListener('input', renderJson));
init();
</script>
</body>
</html>`;
