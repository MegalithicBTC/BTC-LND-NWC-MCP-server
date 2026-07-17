import { test } from "node:test";
import assert from "node:assert/strict";
import { SpendingGuard, SpendingLimitError } from "../safety.js";

test("allows payments within limits", () => {
  const guard = new SpendingGuard(1000, 5000);
  assert.doesNotThrow(() => guard.check(1000));
});

test("rejects payments above the per-payment cap", () => {
  const guard = new SpendingGuard(1000, 0);
  assert.throws(() => guard.check(1001), SpendingLimitError);
});

test("MAX_SEND_SATS=0 disables all outgoing payments", () => {
  const guard = new SpendingGuard(0, 0);
  assert.throws(() => guard.check(1), SpendingLimitError);
});

test("enforces the rolling 24h budget", () => {
  const guard = new SpendingGuard(1000, 2500);
  guard.check(1000);
  guard.record(1000);
  guard.check(1000);
  guard.record(1000);
  // 2000 spent, 500 left in the budget
  assert.throws(() => guard.check(1000), SpendingLimitError);
  assert.doesNotThrow(() => guard.check(500));
});

test("budget entries expire after 24h", () => {
  const guard = new SpendingGuard(1000, 1000);
  guard.record(1000);
  // simulate looking 25 hours into the future
  const future = Date.now() + 25 * 60 * 60 * 1000;
  assert.equal(guard.spentLast24h(future), 0);
});

test("reserve blocks concurrent payments from exceeding the budget", () => {
  const guard = new SpendingGuard(1000, 1500);
  const r1 = guard.reserve(1000); // first payment in flight
  // second concurrent payment must NOT also fit under the 1500 budget
  assert.throws(() => guard.reserve(1000), SpendingLimitError);
  r1.commit(900); // settled cheaper than reserved
  assert.doesNotThrow(() => guard.reserve(600)); // 900 + 600 = 1500 ok
});

test("release returns reserved budget after a failed payment", () => {
  const guard = new SpendingGuard(1000, 1000);
  const r = guard.reserve(1000);
  assert.throws(() => guard.reserve(1), SpendingLimitError);
  r.release();
  assert.doesNotThrow(() => guard.reserve(1000));
});

test("dailyBudgetSats=0 disables the budget check", () => {
  const guard = new SpendingGuard(1000, 0);
  for (let i = 0; i < 100; i++) guard.record(1000);
  assert.doesNotThrow(() => guard.check(1000));
});
