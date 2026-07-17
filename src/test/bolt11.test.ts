import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeBolt11 } from "../bolt11.js";

// Official BOLT11 test vector: 2500 uBTC "1 cup coffee", 60s expiry
const COFFEE_INVOICE =
  "lnbc2500u1pvjluezpp5qqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqypqdq5" +
  "xysxxatsyp3k7enxv4jsxqzpuaztrnwngzn3kdzw5hydlzf03qdgm2hdq27cqv3agm2awhz5se9" +
  "03vruatfhq77w3ls4evs3ch9zw97j25emudupq63nyw24cg27h2rspfj9srp";

test("decodes the BOLT11 spec test vector", () => {
  const d = decodeBolt11(COFFEE_INVOICE);
  assert.equal(d.amountSats, 250_000);
  assert.equal(d.description, "1 cup coffee");
  assert.equal(
    d.paymentHash,
    "0001020304050607080900010203040506070809000102030405060708090102",
  );
  assert.equal(d.createdAt, 1496314658);
  assert.equal(d.expiresAt, 1496314658 + 60);
  assert.equal(d.expired, true); // signed in 2017
  assert.equal(d.network, "bc");
});

test("tolerates surrounding whitespace", () => {
  const d = decodeBolt11(`  ${COFFEE_INVOICE}\n`);
  assert.equal(d.amountSats, 250_000);
});

test("throws on garbage input", () => {
  assert.throws(() => decodeBolt11("lnbc-not-an-invoice"));
});
