/**
 * Shared domain types for btc-mcp-srv.
 *
 * All amounts are expressed in satoshis (sats) unless the field name
 * explicitly says otherwise. 1 BTC = 100,000,000 sats.
 */

export interface Balance {
  /** Confirmed spendable Lightning balance, in sats. */
  balanceSats: number;
}

export interface CreatedInvoice {
  /** BOLT11 payment request string. */
  bolt11: string;
  /** Hex-encoded payment hash — use it to look the invoice up later. */
  paymentHash: string;
  /** Amount requested, in sats. */
  amountSats: number;
  /** Invoice description / memo. */
  description: string;
  /** Unix timestamp (seconds) when the invoice expires. */
  expiresAt: number;
}

export interface InvoiceStatus {
  paymentHash: string;
  /** true once the invoice has been settled. */
  settled: boolean;
  /** Amount of the invoice in sats (0 for zero-amount invoices). */
  amountSats: number;
  /** Amount actually paid in sats, if settled. */
  amountPaidSats?: number;
  /** Unix timestamp (seconds) of settlement, if settled. */
  settledAt?: number;
  description?: string;
}

export interface PaymentResult {
  /** Hex-encoded payment preimage — cryptographic proof of payment. */
  preimage: string;
  paymentHash: string;
  /** Amount sent, in sats (excluding fees). */
  amountSats: number;
  /** Routing fees paid, in sats. */
  feeSats: number;
}

export interface Transaction {
  type: "incoming" | "outgoing";
  paymentHash: string;
  amountSats: number;
  feeSats?: number;
  description?: string;
  settled: boolean;
  /** Unix timestamp (seconds). */
  timestamp: number;
}

/**
 * Common interface every Lightning backend driver implements.
 * Add a new file in src/backends/ and wire it up in config.ts to
 * support another node/wallet implementation.
 */
export interface LightningBackend {
  /** Human-readable backend name, e.g. "nwc" or "lnd". */
  readonly name: string;

  getBalance(): Promise<Balance>;

  createInvoice(opts: {
    amountSats: number;
    description?: string;
    expirySeconds?: number;
  }): Promise<CreatedInvoice>;

  /**
   * Pay a BOLT11 invoice.
   * @param amountSats amount override, required for zero-amount invoices.
   */
  payInvoice(opts: {
    bolt11: string;
    amountSats?: number;
    maxFeeSats?: number;
  }): Promise<PaymentResult>;

  lookupInvoice(opts: { paymentHash: string }): Promise<InvoiceStatus>;

  listTransactions(opts: { limit?: number }): Promise<Transaction[]>;

  /** Free any sockets/handles so the process can exit cleanly. */
  close(): Promise<void>;
}

export class BackendError extends Error {
  constructor(message: string, public readonly backend: string) {
    super(`[${backend}] ${message}`);
    this.name = "BackendError";
  }
}
