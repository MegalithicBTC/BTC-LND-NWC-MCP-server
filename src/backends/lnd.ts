/**
 * LND backend over the REST API (v0.18+).
 *
 * Auth is a hex-encoded macaroon sent in the Grpc-Metadata-macaroon header.
 * LND ships with a self-signed TLS certificate, so we support either
 * pinning `tls.cert` (recommended) or skipping verification explicitly.
 */
import { readFileSync } from "node:fs";
import { Agent, fetch as undiciFetch } from "undici";
import type {
  Balance,
  CreatedInvoice,
  InvoiceStatus,
  LightningBackend,
  PaymentResult,
  Transaction,
} from "../types.js";
import { BackendError } from "../types.js";

export interface LndOptions {
  restUrl: string;
  macaroonHex: string;
  tlsCertPath?: string;
  skipCertVerify?: boolean;
}

const b64ToHex = (b64: string): string =>
  Buffer.from(b64, "base64").toString("hex");

export class LndBackend implements LightningBackend {
  readonly name = "lnd";
  private baseUrl: string;
  private macaroon: string;
  private dispatcher?: Agent;

  constructor(opts: LndOptions) {
    if (!/^[0-9a-fA-F]+$/.test(opts.macaroonHex)) {
      throw new BackendError(
        "LND_MACAROON_HEX must be the macaroon encoded as hex " +
          "(e.g. `xxd -ps -u -c 1000 admin.macaroon`)",
        this.name,
      );
    }
    this.baseUrl = opts.restUrl.replace(/\/+$/, "");
    this.macaroon = opts.macaroonHex;

    if (opts.tlsCertPath) {
      this.dispatcher = new Agent({
        connect: { ca: readFileSync(opts.tlsCertPath) },
      });
    } else if (opts.skipCertVerify) {
      this.dispatcher = new Agent({
        connect: { rejectUnauthorized: false },
      });
    }
  }

  private async request<T>(
    method: "GET" | "POST" | "DELETE",
    path: string,
    body?: unknown,
  ): Promise<T> {
    let res;
    try {
      res = await undiciFetch(`${this.baseUrl}${path}`, {
        method,
        headers: {
          "Grpc-Metadata-macaroon": this.macaroon,
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        dispatcher: this.dispatcher,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new BackendError(
        `cannot reach LND REST API at ${this.baseUrl}: ${msg}`,
        this.name,
      );
    }
    const text = await res.text();
    if (!res.ok) {
      let detail = text;
      try {
        detail = (JSON.parse(text) as { message?: string }).message ?? text;
      } catch {
        /* keep raw text */
      }
      throw new BackendError(`HTTP ${res.status}: ${detail}`, this.name);
    }
    return JSON.parse(text) as T;
  }

  async getBalance(): Promise<Balance> {
    const res = await this.request<{ local_balance?: { sat?: string } }>(
      "GET",
      "/v1/balance/channels",
    );
    return { balanceSats: Number(res.local_balance?.sat ?? 0) };
  }

  async createInvoice(opts: {
    amountSats: number;
    description?: string;
    expirySeconds?: number;
  }): Promise<CreatedInvoice> {
    const res = await this.request<{
      payment_request: string;
      r_hash: string;
    }>("POST", "/v1/invoices", {
      value: String(opts.amountSats),
      memo: opts.description ?? "",
      expiry: String(opts.expirySeconds ?? 3600),
    });
    return {
      bolt11: res.payment_request,
      paymentHash: b64ToHex(res.r_hash),
      amountSats: opts.amountSats,
      description: opts.description ?? "",
      expiresAt:
        Math.floor(Date.now() / 1000) + (opts.expirySeconds ?? 3600),
    };
  }

  async payInvoice(opts: {
    bolt11: string;
    amountSats?: number;
    maxFeeSats?: number;
  }): Promise<PaymentResult> {
    // Uses the router v2 synchronous-ish endpoint: it streams JSON lines;
    // the final line contains the terminal payment state.
    const body: Record<string, unknown> = {
      payment_request: opts.bolt11,
      timeout_seconds: 60,
      fee_limit_sat: String(opts.maxFeeSats ?? 10),
    };
    if (opts.amountSats) body.amt = String(opts.amountSats);

    let res;
    try {
      res = await undiciFetch(`${this.baseUrl}/v2/router/send`, {
        method: "POST",
        headers: {
          "Grpc-Metadata-macaroon": this.macaroon,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        dispatcher: this.dispatcher,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new BackendError(
        `cannot reach LND REST API at ${this.baseUrl}: ${msg}`,
        this.name,
      );
    }
    const text = await res.text();
    if (!res.ok) {
      throw new BackendError(`HTTP ${res.status}: ${text}`, this.name);
    }
    // Each line is {"result": {...payment}} — take the last parseable one.
    interface LndPayment {
      status: string;
      payment_hash: string;
      payment_preimage: string;
      value_sat: string;
      fee_sat: string;
      failure_reason?: string;
    }
    let last: LndPayment | undefined;
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const parsed = JSON.parse(trimmed) as {
          result?: LndPayment;
          error?: { message?: string };
        };
        if (parsed.error) {
          throw new BackendError(
            parsed.error.message ?? "payment stream error",
            this.name,
          );
        }
        if (parsed.result) last = parsed.result;
      } catch (err) {
        if (err instanceof BackendError) throw err;
        /* skip malformed line */
      }
    }
    if (!last) {
      throw new BackendError("empty payment response from LND", this.name);
    }
    if (last.status !== "SUCCEEDED") {
      throw new BackendError(
        `payment ${last.status}${
          last.failure_reason ? `: ${last.failure_reason}` : ""
        }`,
        this.name,
      );
    }
    return {
      preimage: last.payment_preimage,
      paymentHash: last.payment_hash,
      amountSats: Number(last.value_sat),
      feeSats: Number(last.fee_sat),
    };
  }

  async lookupInvoice(opts: { paymentHash: string }): Promise<InvoiceStatus> {
    const res = await this.request<{
      settled: boolean;
      value: string;
      amt_paid_sat: string;
      settle_date: string;
      memo: string;
      r_hash: string;
    }>("GET", `/v1/invoice/${opts.paymentHash}`);
    return {
      paymentHash: opts.paymentHash,
      settled: res.settled,
      amountSats: Number(res.value),
      amountPaidSats: res.settled ? Number(res.amt_paid_sat) : undefined,
      settledAt: res.settled ? Number(res.settle_date) : undefined,
      description: res.memo || undefined,
    };
  }

  async listTransactions(opts: { limit?: number }): Promise<Transaction[]> {
    const limit = opts.limit ?? 20;
    const [invoices, payments] = await Promise.all([
      this.request<{
        invoices?: {
          r_hash: string;
          settled: boolean;
          amt_paid_sat: string;
          value: string;
          memo: string;
          settle_date: string;
          creation_date: string;
        }[];
      }>(
        "GET",
        `/v1/invoices?num_max_invoices=${limit}&reversed=true`,
      ),
      this.request<{
        payments?: {
          payment_hash: string;
          status: string;
          value_sat: string;
          fee_sat: string;
          creation_date: string;
        }[];
      }>(
        "GET",
        `/v1/payments?max_payments=${limit}&reversed=true`,
      ),
    ]);

    const txs: Transaction[] = [];
    for (const inv of invoices.invoices ?? []) {
      txs.push({
        type: "incoming",
        paymentHash: b64ToHex(inv.r_hash),
        amountSats: Number(inv.settled ? inv.amt_paid_sat : inv.value),
        description: inv.memo || undefined,
        settled: inv.settled,
        timestamp: Number(inv.settled ? inv.settle_date : inv.creation_date),
      });
    }
    for (const pay of payments.payments ?? []) {
      txs.push({
        type: "outgoing",
        paymentHash: pay.payment_hash,
        amountSats: Number(pay.value_sat),
        feeSats: Number(pay.fee_sat),
        settled: pay.status === "SUCCEEDED",
        timestamp: Number(pay.creation_date),
      });
    }
    txs.sort((a, b) => b.timestamp - a.timestamp);
    return txs.slice(0, limit);
  }

  async close(): Promise<void> {
    await this.dispatcher?.close();
  }
}
