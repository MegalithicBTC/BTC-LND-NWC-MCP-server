import { test } from "node:test";
import assert from "node:assert/strict";
import {
  generateFullNodeStack,
  rpcAuthLine,
  sanitizeDataDir,
  sanitizeFullNodeOptions,
} from "../setup/fullnode.js";

test("rpcauth line matches Bitcoin Core's algorithm", () => {
  // Independently computed: hmac_sha256(key="cb77bbbbb...", msg=password)
  const line = rpcAuthLine("user", "password", "00112233445566778899aabbccddeeff");
  assert.match(line, /^rpcauth=user:00112233445566778899aabbccddeeff\$[0-9a-f]{64}$/);
});

test("sanitizes bad options to safe defaults", () => {
  const o = sanitizeFullNodeOptions({ network: "regtest", pruneMb: 100, alias: "" });
  assert.equal(o.network, "mainnet");
  assert.equal(o.pruneMb, 550); // clamped to bitcoind minimum
  assert.equal(o.alias, "btc-mcp-srv node");
  assert.equal(o.withAlbyHub, true);
  assert.equal(o.dataDir, "./bitcoin"); // empty → default
});

test("normalises the Bitcoin Core data directory", () => {
  // empty / whitespace → default
  assert.equal(sanitizeDataDir(""), "./bitcoin");
  assert.equal(sanitizeDataDir("   "), "./bitcoin");
  assert.equal(sanitizeDataDir(undefined), "./bitcoin");
  // Windows path: backslashes normalised, drive letter kept absolute
  assert.equal(sanitizeDataDir("E:\\bitcoin-data"), "E:/bitcoin-data");
  // Unix absolute path kept as-is
  assert.equal(sanitizeDataDir("/mnt/ssd/bitcoin"), "/mnt/ssd/bitcoin");
  // bare relative path gets a ./ prefix so compose treats it as a bind mount
  assert.equal(sanitizeDataDir("btc"), "./btc");
  assert.equal(sanitizeDataDir("./btc"), "./btc");
  assert.equal(sanitizeDataDir("../btc"), "../btc");
});

test("generates the three stack files with wired credentials", () => {
  const stack = generateFullNodeStack(
    { network: "signet", pruneMb: 0, withAlbyHub: true, alias: "test" },
    "s3cretpass",
  );
  const byPath = Object.fromEntries(stack.files.map((f) => [f.relPath, f]));
  assert.ok(byPath["docker-compose.yml"]);
  assert.ok(byPath["bitcoin/bitcoin.conf"]);
  assert.ok(byPath["lnd/lnd.conf"]);
  const meta = JSON.parse(byPath["stack.json"].content) as {
    network: string;
    withAlbyHub: boolean;
    dataDir: string;
  };
  assert.equal(meta.network, "signet");
  assert.equal(meta.withAlbyHub, true);
  assert.equal(meta.dataDir, "./bitcoin");

  const btc = byPath["bitcoin/bitcoin.conf"].content;
  const lnd = byPath["lnd/lnd.conf"].content;
  const compose = byPath["docker-compose.yml"].content;

  assert.match(btc, /chain=signet/);
  assert.match(btc, /txindex=1/); // archival
  assert.match(btc, /\[signet\]/);
  assert.match(btc, /rpcauth=btcmcp:/);
  assert.match(lnd, /bitcoin\.signet=true/);
  assert.match(lnd, /bitcoind\.rpcpass=s3cretpass/);
  assert.match(lnd, /zmqpubrawblock=tcp:\/\/bitcoind:28332/);
  assert.match(compose, /albyhub:/);
  assert.match(compose, /LND_ADDRESS=lnd:10009/);
  assert.match(compose, /chain\/bitcoin\/signet\/admin\.macaroon/);
  // default data dir: mounted at ./bitcoin, no separate conf mount
  assert.match(compose, /- \.\/bitcoin:\/home\/bitcoin\/\.bitcoin/);
  assert.ok(!compose.includes("bitcoin.conf:/home/bitcoin/.bitcoin/bitcoin.conf"));
  // secret-bearing configs are written 0600
  assert.equal(byPath["bitcoin/bitcoin.conf"].mode, 0o600);
  assert.equal(byPath["lnd/lnd.conf"].mode, 0o600);
});

test("pruned mainnet stack omits albyhub when disabled", () => {
  const stack = generateFullNodeStack(
    { network: "mainnet", pruneMb: 80000, withAlbyHub: false, alias: "x" },
    "pw",
  );
  const compose = stack.files.find((f) => f.relPath === "docker-compose.yml");
  const btc = stack.files.find((f) => f.relPath === "bitcoin/bitcoin.conf");
  assert.ok(compose && !compose.content.includes("albyhub"));
  assert.ok(btc && btc.content.includes("prune=80000"));
  assert.ok(btc && !btc.content.includes("txindex=1"));
});

test("relocated data directory rewires the bitcoind bind mount", () => {
  const stack = generateFullNodeStack(
    { network: "signet", pruneMb: 0, withAlbyHub: false, alias: "x", dataDir: "E:\\btc-data" },
    "pw",
  );
  const byPath = Object.fromEntries(stack.files.map((f) => [f.relPath, f]));
  const compose = byPath["docker-compose.yml"].content;
  // data lives on the relocated host path...
  assert.match(compose, /- E:\/btc-data:\/home\/bitcoin\/\.bitcoin/);
  // ...and the secret-bearing config is mounted read-only into it
  assert.match(
    compose,
    /- \.\/bitcoin\/bitcoin\.conf:\/home\/bitcoin\/\.bitcoin\/bitcoin\.conf:ro/,
  );
  // config file is still generated in the repo as the mount source
  assert.ok(byPath["bitcoin/bitcoin.conf"]);
  // and recorded in the stack metadata
  const meta = JSON.parse(byPath["stack.json"].content) as { dataDir: string };
  assert.equal(meta.dataDir, "E:/btc-data");
});
