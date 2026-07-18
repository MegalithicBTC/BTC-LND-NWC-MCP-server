#!/usr/bin/env node
/**
 * CLI variant of the full-node stack generator — for people who don't
 * want the GUI:
 *
 *   npm run fullnode -- --network signet --prune 20000 --no-alby --alias "my node"
 *   npm run fullnode -- --datadir E:/bitcoin-data   # store the blockchain elsewhere
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { generateFullNodeStack } from "./fullnode.js";
import { packageRoot } from "../env.js";

const args = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

const stack = generateFullNodeStack({
  network: flag("network") ?? "mainnet",
  pruneMb: Number(flag("prune") ?? 80_000),
  withAlbyHub: !args.includes("--no-alby"),
  alias: flag("alias") ?? "btc-mcp-srv node",
  dataDir: flag("datadir") ?? "",
});

const dir = join(packageRoot, "fullnode");
for (const file of stack.files) {
  const abs = join(dir, file.relPath);
  const existed = existsSync(abs);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, file.content, { mode: file.mode ?? 0o644 });
  console.log(`${existed ? "regenerated" : "created"}  ${abs}`);
}

console.log("\nNext steps:");
for (const c of stack.commands) console.log(`  ${c}`);
console.log("\nNotes:");
for (const n of stack.notes) console.log(`  - ${n}`);
