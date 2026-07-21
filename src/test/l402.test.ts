import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import {
  L402TokenStore,
  buildL402Header,
  parseL402Challenge,
  verifyPreimage,
} from "../l402.js";

const MAC = "AgEEbHNhdAJCAADPT7hM";
const INV = "lnbc10n1p3xyzabc";

test("parses a quoted L402 challenge", () => {
  const c = parseL402Challenge(`L402 macaroon="${MAC}", invoice="${INV}"`);
  assert.ok(c);
  assert.equal(c.scheme, "L402");
  assert.equal(c.macaroon, MAC);
  assert.equal(c.invoice, INV);
});

test("parses a legacy LSAT challenge", () => {
  const c = parseL402Challenge(`LSAT macaroon="${MAC}", invoice="${INV}"`);
  assert.ok(c);
  assert.equal(c.scheme, "LSAT");
});

test("parses unquoted parameter values in any order", () => {
  const c = parseL402Challenge(`L402 invoice=${INV}, macaroon=${MAC}`);
  assert.ok(c);
  assert.equal(c.macaroon, MAC);
  assert.equal(c.invoice, INV);
});

test("parses an L402 challenge listed after another scheme", () => {
  const c = parseL402Challenge(
    `Bearer realm="x", L402 macaroon="${MAC}", invoice="${INV}"`,
  );
  assert.ok(c);
  assert.equal(c.scheme, "L402");
});

test("returns null for non-L402 challenges", () => {
  assert.equal(parseL402Challenge('Basic realm="site"'), null);
  assert.equal(parseL402Challenge("Bearer"), null);
  assert.equal(parseL402Challenge(""), null);
});

test("returns null when macaroon or invoice is missing", () => {
  assert.equal(parseL402Challenge(`L402 macaroon="${MAC}"`), null);
  assert.equal(parseL402Challenge(`L402 invoice="${INV}"`), null);
});

test("builds the Authorization header as scheme macaroon:preimage", () => {
  const preimage = "aa".repeat(32);
  assert.equal(
    buildL402Header({ scheme: "L402", macaroon: MAC }, preimage),
    `L402 ${MAC}:${preimage}`,
  );
});

test("verifyPreimage accepts a matching preimage", () => {
  const preimage = randomBytes(32);
  const hash = createHash("sha256").update(preimage).digest("hex");
  assert.equal(verifyPreimage(preimage.toString("hex"), hash), true);
  assert.equal(
    verifyPreimage(preimage.toString("hex"), hash.toUpperCase()),
    true,
  );
});

test("verifyPreimage rejects a wrong or malformed preimage", () => {
  const hash = createHash("sha256").update(randomBytes(32)).digest("hex");
  assert.equal(verifyPreimage("bb".repeat(32), hash), false);
  assert.equal(verifyPreimage("not-hex", hash), false);
  assert.equal(verifyPreimage("aa".repeat(31), hash), false);
});

test("token store caches, lists and forgets tokens per origin", () => {
  const store = new L402TokenStore();
  const token = {
    origin: "https://api.example.com",
    scheme: "L402",
    macaroon: MAC,
    preimage: "cc".repeat(32),
    amountSats: 21,
    acquiredAt: 1_700_000_000,
  };
  store.set(token);
  assert.equal(store.get(token.origin)?.amountSats, 21);
  assert.equal(
    store.authHeaderFor(token.origin),
    `L402 ${MAC}:${"cc".repeat(32)}`,
  );
  assert.equal(store.list().length, 1);
  assert.equal(store.authHeaderFor("https://other.example.com"), undefined);
  assert.equal(store.delete(token.origin), true);
  assert.equal(store.delete(token.origin), false);
  assert.equal(store.list().length, 0);
});
