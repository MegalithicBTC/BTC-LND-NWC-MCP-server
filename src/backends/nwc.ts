/**
 * NWC (Nostr Wallet Connect / NIP-47) backend.
 *
 * Works with any NWC-capable wallet: Alby Hub, coinos, Primal, Cashu.me,
 * Mutiny, LNbits (nostrclient extension), and many more. The user pastes a
 * `nostr+walletconnect://...` connection string and the agent can operate
 * the wallet within the permissions granted by that connection.
 */
import { NWCClient } from "@getalby/sdk";
import type {
  Balance,
  CreatedInvoice,
  InvoiceStatus,
  LightningBackend,
  PaymentResult,
  Transaction,
} from "../types.js";
import { BackendError } from "../types.js";

const msatToSat = (msat: number): number => Math.floor(msat / 1000);

export class NwcBackend implements LightningBackend {
  readonly name = "nwc";
  private client: NWCClient;

  constructor(connectionString: string) {
    if (!connectionString.startsWith("nostr+walletconnect://")) {
      throw new BackendError(
        "NWC_CONNECTION_STRING must start with nostr+walletconnect://",
        this.name,
      );
    }
    this.client = new NWCClient({
      nostrWalletConnectUrl: connectionString,
    });
  }

  private wrap(err: unknown): never {
    const msg = err instanceof Error ? err.message : String(err);
    throw new BackendError(msg, this.name);
  }

  async getBalance(): Promise<Balance> {
    try {
      const res = await this.client.getBalance();
      return { balanceSats: msatToSat(res.balance) };
    } catch (err) {
      this.wrap(err);
    }
  }

  async createInvoice(opts: {
    amountSats: number;
    description?: string;
    expirySeconds?: number;
  }): Promise<CreatedInvoice> {
    try {
      const res = await this.client.makeInvoice({
        amount: opts.amountSats * 1000, // msats
        description: opts.description ?? "",
        expiry: opts.expirySeconds,
      });
      return {
        bolt11: res.invoice,
        paymentHash: res.payment_hash,
        amountSats: msatToSat(res.amount),
        description: res.description ?? opts.description ?? "",
        expiresAt: res.expires_at ?? 0,
      };
    } catch (err) {
      this.wrap(err);
    }
  }

  async payInvoice(opts: {
    bolt11: string;
    amountSats?: number;
  }): Promise<PaymentResult> {
    try {
      const res = await this.client.payInvoice({
        invoice: opts.bolt11,
        ...(opts.amountSats ? { amount: opts.amountSats * 1000 } : {}),
      });
      // NIP-47 pay_invoice returns the preimage; fees_paid is optional.
      const lookup = await this.client
        .lookupInvoice({ invoice: opts.bolt11 })
        .catch(() => undefined);
      return {
        preimage: res.preimage,
        paymentHash: lookup?.payment_hash ?? "",
        amountSats: lookup ? msatToSat(lookup.amount) : opts.amountSats ?? 0,
        feeSats: res.fees_paid != null ? msatToSat(res.fees_paid) : 0,
      };
    } catch (err) {
      this.wrap(err);
    }
  }

  async lookupInvoice(opts: { paymentHash: string }): Promise<InvoiceStatus> {
    try {
      const res = await this.client.lookupInvoice({
        payment_hash: opts.paymentHash,
      });
      const settled =
        res.state === "settled" || Boolean(res.settled_at && res.settled_at > 0);
      return {
        paymentHash: res.payment_hash,
        settled,
        amountSats: msatToSat(res.amount),
        amountPaidSats: settled ? msatToSat(res.amount) : undefined,
        settledAt: res.settled_at || undefined,
        description: res.description || undefined,
      };
    } catch (err) {
      this.wrap(err);
    }
  }

  async listTransactions(opts: { limit?: number }): Promise<Transaction[]> {
    try {
      const res = await this.client.listTransactions({
        limit: opts.limit ?? 20,
      });
      return res.transactions.map(
        (tx): Transaction => ({
          type: tx.type === "incoming" ? "incoming" : "outgoing",
          paymentHash: tx.payment_hash,
          amountSats: msatToSat(tx.amount),
          feeSats: tx.fees_paid != null ? msatToSat(tx.fees_paid) : undefined,
          description: tx.description || undefined,
          settled:
            tx.state === "settled" ||
            Boolean(tx.settled_at && tx.settled_at > 0),
          timestamp: tx.settled_at || tx.created_at,
        }),
      );
    } catch (err) {
      this.wrap(err);
    }
  }

  async close(): Promise<void> {
    this.client.close();
  }
}
