import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveLightningAddress } from "../lnaddress.js";

test("rejects malformed lightning addresses without network calls", async () => {
  for (const bad of [
    "not-an-address",
    "user@",
    "@domain.com",
    "user@domain",
    "user domain.com",
    "",
  ]) {
    await assert.rejects(
      () => resolveLightningAddress(bad, 1000),
      /not a valid Lightning address/,
      `expected "${bad}" to be rejected`,
    );
  }
});

const mockLnurlFetch = (callback: string): typeof fetch =>
  (async () =>
    new Response(
      JSON.stringify({
        tag: "payRequest",
        callback,
        minSendable: 1000,
        maxSendable: 100_000_000,
        metadata: JSON.stringify([["text/plain", "test"]]),
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    )) as typeof fetch;

test("refuses non-HTTPS and private-host LNURL callbacks (SSRF guard)", async (t) => {
  const original = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = original;
  });
  for (const [cb, re] of [
    ["http://evil.example.com/pay", /non-HTTPS/],
    ["https://127.0.0.1/pay", /suspicious/],
    ["https://localhost/pay", /suspicious/],
    ["https://router.local/pay", /suspicious/],
    ["https://[::1]/pay", /suspicious/],
  ] as const) {
    globalThis.fetch = mockLnurlFetch(cb);
    await assert.rejects(
      () => resolveLightningAddress("user@example.com", 1000),
      re,
      `expected callback "${cb}" to be rejected`,
    );
  }
});
