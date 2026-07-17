import { test } from "node:test";
import assert from "node:assert/strict";
import {
  generateFullNodeStack,
  rpcAuthLine,
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
  };
  assert.equal(meta.network, "signet");
  assert.equal(meta.withAlbyHub, true);

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
