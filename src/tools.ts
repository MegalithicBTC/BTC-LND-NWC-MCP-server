/**
 * MCP tool registrations.
 *
 * Every tool returns a JSON payload in a text content block so agents can
 * parse results reliably. Errors are returned as isError results with a
 * human-readable message instead of crashing the server.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Config } from "./config.js";
import type { LightningBackend } from "./types.js";
import { SpendingGuard } from "./safety.js";
import { decodeBolt11 } from "./bolt11.js";
import { resolveLightningAddress } from "./lnaddress.js";

const ok = (payload: unknown) => ({
  content: [
    { type: "text" as const, text: JSON.stringify(payload, null, 2) },
  ],
});

const fail = (err: unknown) => ({
  content: [
    {
      type: "text" as const,
      text: `Error: ${err instanceof Error ? err.message : String(err)}`,
    },
  ],
  isError: true,
});

export function registerTools(
  server: McpServer,
  backend: LightningBackend,
  config: Config,
): void {
  const guard = new SpendingGuard(config.maxSendSats, config.dailyBudgetSats);

  const maxFeeFor = (amountSats: number): number =>
    Math.max(1, Math.ceil((amountSats * config.maxFeePercent) / 100));

  server.registerTool(
    "get_balance",
    {
      title: "Get wallet balance",
      description:
        "Get the current spendable Lightning wallet balance in satoshis, " +
        "plus the remaining spending budget for this session.",
      inputSchema: {},
    },
    async () => {
      try {
        const balance = await backend.getBalance();
        return ok({
          ...balance,
          backend: backend.name,
          limits: {
            maxSendSats: config.maxSendSats,
            dailyBudgetSats: config.dailyBudgetSats || null,
            spentLast24hSats: guard.spentLast24h(),
          },
        });
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "create_invoice",
    {
      title: "Create Lightning invoice",
      description:
        "Create a BOLT11 Lightning invoice to RECEIVE bitcoin. Returns the " +
        "invoice string to give to the payer and a payment_hash to check " +
        "the payment status later with lookup_invoice.",
      inputSchema: {
        amount_sats: z
          .number()
          .int()
          .positive()
          .describe("Amount to request, in satoshis"),
        description: z
          .string()
          .max(639)
          .optional()
          .describe("Short memo shown to the payer"),
        expiry_seconds: z
          .number()
          .int()
          .positive()
          .max(31536000)
          .optional()
          .describe("Invoice validity in seconds (default 3600)"),
      },
    },
    async ({ amount_sats, description, expiry_seconds }) => {
      try {
        const invoice = await backend.createInvoice({
          amountSats: amount_sats,
          description,
          expirySeconds: expiry_seconds ?? config.defaultInvoiceExpiry,
        });
        return ok(invoice);
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "pay_invoice",
    {
      title: "Pay Lightning invoice",
      description:
        "Pay a BOLT11 Lightning invoice (SENDS real bitcoin — subject to " +
        "the configured per-payment and daily spending limits). For " +
        "zero-amount invoices you must pass amount_sats. Returns the " +
        "payment preimage as proof of payment.",
      inputSchema: {
        bolt11: z
          .string()
          .min(20)
          .describe("The BOLT11 invoice string (starts with lnbc/lntbs...)"),
        amount_sats: z
          .number()
          .int()
          .positive()
          .optional()
          .describe(
            "Amount in sats — required only for zero-amount invoices",
          ),
      },
    },
    async ({ bolt11, amount_sats }) => {
      try {
        const decoded = decodeBolt11(bolt11);
        if (decoded.expired) {
          return fail(new Error("This invoice has expired."));
        }
        const amount = decoded.amountSats ?? amount_sats;
        if (amount == null) {
          return fail(
            new Error(
              "This is a zero-amount invoice: pass amount_sats explicitly.",
            ),
          );
        }
        if (
          decoded.amountSats != null &&
          amount_sats != null &&
          amount_sats !== decoded.amountSats
        ) {
          return fail(
            new Error(
              `Invoice amount is ${decoded.amountSats} sats but ` +
                `amount_sats=${amount_sats} was passed. Omit amount_sats ` +
                "for invoices that already specify an amount.",
            ),
          );
        }
        const maxFee = maxFeeFor(amount);
        const reservation = guard.reserve(amount + maxFee);
        let result;
        try {
          result = await backend.payInvoice({
            bolt11,
            amountSats: decoded.amountSats == null ? amount : undefined,
            maxFeeSats: maxFee,
          });
        } catch (err) {
          reservation.release();
          throw err;
        }
        reservation.commit(amount + result.feeSats);
        return ok(result);
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "pay_lightning_address",
    {
      title: "Pay a Lightning address",
      description:
        "Send bitcoin to a Lightning address like user@getalby.com " +
        "(SENDS real bitcoin — subject to the configured spending limits). " +
        "Resolves the address via LNURL-pay, fetches an invoice for the " +
        "amount, verifies it, and pays it.",
      inputSchema: {
        address: z
          .string()
          .describe("Lightning address, e.g. satoshi@walletofsatoshi.com"),
        amount_sats: z
          .number()
          .int()
          .positive()
          .describe("Amount to send, in satoshis"),
        comment: z
          .string()
          .max(255)
          .optional()
          .describe("Optional comment for the recipient (if supported)"),
      },
    },
    async ({ address, amount_sats, comment }) => {
      try {
        const maxFee = maxFeeFor(amount_sats);
        const reservation = guard.reserve(amount_sats + maxFee);
        let result;
        try {
          const resolved = await resolveLightningAddress(
            address,
            amount_sats,
            comment,
          );
          // Never trust the remote server blindly: verify the invoice
          // actually asks for the amount we intend to send.
          const decoded = decodeBolt11(resolved.bolt11);
          if (decoded.amountSats !== amount_sats) {
            throw new Error(
              `Refusing to pay: ${address} returned an invoice for ` +
                `${decoded.amountSats ?? "an unspecified amount of"} sats ` +
                `instead of the requested ${amount_sats} sats.`,
            );
          }
          result = await backend.payInvoice({
            bolt11: resolved.bolt11,
            maxFeeSats: maxFee,
          });
          reservation.commit(amount_sats + result.feeSats);
          return ok({ ...result, address, description: resolved.description });
        } catch (err) {
          reservation.release();
          throw err;
        }
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "decode_invoice",
    {
      title: "Decode Lightning invoice",
      description:
        "Decode a BOLT11 invoice locally (no payment is made). Use this " +
        "to inspect amount, description, expiry and destination before " +
        "deciding to pay.",
      inputSchema: {
        bolt11: z.string().min(20).describe("The BOLT11 invoice string"),
      },
    },
    async ({ bolt11 }) => {
      try {
        return ok(decodeBolt11(bolt11));
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "lookup_invoice",
    {
      title: "Check invoice status",
      description:
        "Check whether an invoice created earlier has been paid, using its " +
        "payment_hash (returned by create_invoice).",
      inputSchema: {
        payment_hash: z
          .string()
          .regex(/^[0-9a-fA-F]{64}$/)
          .describe("Hex-encoded payment hash of the invoice"),
      },
    },
    async ({ payment_hash }) => {
      try {
        return ok(await backend.lookupInvoice({ paymentHash: payment_hash }));
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "list_transactions",
    {
      title: "List recent transactions",
      description:
        "List recent incoming and outgoing Lightning transactions, newest " +
        "first.",
      inputSchema: {
        limit: z
          .number()
          .int()
          .positive()
          .max(100)
          .optional()
          .describe("Maximum number of transactions to return (default 20)"),
      },
    },
    async ({ limit }) => {
      try {
        return ok(await backend.listTransactions({ limit }));
      } catch (err) {
        return fail(err);
      }
    },
  );
}
