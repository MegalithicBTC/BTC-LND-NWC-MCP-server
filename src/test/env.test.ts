import { test } from "node:test";
import assert from "node:assert/strict";
import { parseEnv } from "../env.js";

test("parses key=value pairs", () => {
  const parsed = parseEnv("A=1\nB=hello world\n");
  assert.deepEqual(parsed, { A: "1", B: "hello world" });
});

test("ignores comments and blank lines", () => {
  const parsed = parseEnv("# comment\n\nA=1\n  # indented comment\n");
  assert.deepEqual(parsed, { A: "1" });
});

test("strips surrounding quotes", () => {
  const parsed = parseEnv(`A="quoted"\nB='single'\n`);
  assert.deepEqual(parsed, { A: "quoted", B: "single" });
});

test("keeps = characters inside values", () => {
  const parsed = parseEnv("URL=nostr+walletconnect://abc?relay=wss://r.io&secret=s\n");
  assert.equal(parsed.URL, "nostr+walletconnect://abc?relay=wss://r.io&secret=s");
});

test("handles CRLF line endings (Windows)", () => {
  const parsed = parseEnv("A=1\r\nB=2\r\n");
  assert.deepEqual(parsed, { A: "1", B: "2" });
});
