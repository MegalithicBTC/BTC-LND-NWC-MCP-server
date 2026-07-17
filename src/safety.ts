/**
 * Spending guards for agent-driven payments.
 *
 * Two independent limits:
 *  - per-payment cap  (MAX_SEND_SATS): no single payment may exceed it;
 *    0 disables outgoing payments entirely.
 *  - rolling 24h budget (DAILY_BUDGET_SATS): total spend over the last
 *    24 hours may not exceed it; 0 disables the budget check.
 *
 * The budget ledger is kept in memory: it resets when the server
 * restarts. It is a guard-rail against runaway agents within a session,
 * not an accounting system — set conservative wallet-side permissions
 * (NWC budgets, restricted macaroons) as the real line of defense.
 */

export class SpendingLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SpendingLimitError";
  }
}

interface LedgerEntry {
  amountSats: number;
  timestamp: number; // ms
}

const DAY_MS = 24 * 60 * 60 * 1000;

export class SpendingGuard {
  private ledger: LedgerEntry[] = [];

  constructor(
    private readonly maxSendSats: number,
    private readonly dailyBudgetSats: number,
  ) {}

  /** Total sats spent in the trailing 24 hours. */
  spentLast24h(now = Date.now()): number {
    this.ledger = this.ledger.filter((e) => now - e.timestamp < DAY_MS);
    return this.ledger.reduce((sum, e) => sum + e.amountSats, 0);
  }

  /**
   * Throws SpendingLimitError if a payment of `amountSats` is not allowed.
   * `amountSats` should INCLUDE the maximum routing fee, so fees can never
   * push spending past the budget.
   */
  check(amountSats: number): void {
    if (this.maxSendSats === 0) {
      throw new SpendingLimitError(
        "Outgoing payments are disabled (MAX_SEND_SATS=0).",
      );
    }
    if (amountSats > this.maxSendSats) {
      throw new SpendingLimitError(
        `Payment of ${amountSats} sats (incl. max fee) exceeds the ` +
          `per-payment limit of ${this.maxSendSats} sats (MAX_SEND_SATS).`,
      );
    }
    if (this.dailyBudgetSats > 0) {
      const spent = this.spentLast24h();
      if (spent + amountSats > this.dailyBudgetSats) {
        throw new SpendingLimitError(
          `Payment of ${amountSats} sats (incl. max fee) would exceed the ` +
            `rolling 24h budget of ${this.dailyBudgetSats} sats ` +
            `(already spent: ${spent} sats).`,
        );
      }
    }
  }

  /**
   * Atomically check and reserve budget BEFORE attempting a payment, so
   * two payments racing each other can never both slip under the budget
   * (check-then-record without a reservation would allow that, since the
   * payment itself is awaited between the two).
   *
   * On success call `commit(actualSats)` with the real amount+fee; on
   * failure call `release()` to return the reserved budget.
   */
  reserve(amountSats: number): {
    commit: (actualSats: number) => void;
    release: () => void;
  } {
    this.check(amountSats);
    const entry: LedgerEntry = { amountSats, timestamp: Date.now() };
    this.ledger.push(entry);
    return {
      commit: (actualSats: number) => {
        entry.amountSats = actualSats;
      },
      release: () => {
        const i = this.ledger.indexOf(entry);
        if (i >= 0) this.ledger.splice(i, 1);
      },
    };
  }

  /** Record a successful payment against the budget. */
  record(amountSats: number): void {
    this.ledger.push({ amountSats, timestamp: Date.now() });
  }
}
