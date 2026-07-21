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
import {
  L402TokenStore,
  buildL402Header,
  parseL402Challenge,
  verifyPreimage,
} from "./l402.js";

/** Max characters of a response body returned to the agent. */
const L402_MAX_BODY_CHARS = 100_000;

/** Only https URLs are allowed, plus http for local development hosts. */
function validateL402Url(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`"${raw}" is not a valid URL`);
  }
  const host = url.hostname.toLowerCase();
  const isLocal =
    host === "localhost" || host === "127.0.0.1" || host === "[::1]";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && isLocal)) {
    throw new Error(
      "l402_fetch only supports https:// URLs " +
        "(http:// is allowed for localhost only)",
    );
  }
  return url;
}

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

  // ── L402 (Lightning HTTP 402) ──────────────────────────────────────
  const l402Tokens = new L402TokenStore();

  const fetchL402 = async (
    url: URL,
    method: string,
    headers: Record<string, string>,
    body: string | undefined,
    authorization?: string,
  ) =>
    fetch(url, {
      method,
      headers: {
        ...headers,
        ...(authorization ? { Authorization: authorization } : {}),
      },
      body,
      redirect: "manual",
      signal: AbortSignal.timeout(30_000),
    });

  const readBody = async (res: Response) => {
    const text = await res.text();
    return {
      body: text.slice(0, L402_MAX_BODY_CHARS),
      bodyTruncated: text.length > L402_MAX_BODY_CHARS,
      contentType: res.headers.get("content-type") ?? undefined,
    };
  };

  server.registerTool(
    "l402_fetch",
    {
      title: "Fetch an L402-protected resource",
      description:
        "Fetch a URL that may be behind an L402/LSAT Lightning paywall " +
        "(HTTP 402). Without max_sats this NEVER pays: it returns either " +
        "the resource or the price quote (amount, description, invoice) " +
        "from the 402 challenge. To authorize payment, call it again with " +
        "max_sats set to the maximum you accept to pay — the invoice is " +
        "then paid over Lightning (subject to the configured spending " +
        "limits), the preimage is verified, and the request is retried " +
        "with the L402 token. Tokens are cached per origin and reused " +
        "automatically, so already-paid resources are not paid twice.",
      inputSchema: {
        url: z.string().describe("The https URL to fetch"),
        method: z
          .enum(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"])
          .optional()
          .describe("HTTP method (default GET)"),
        headers: z
          .record(z.string())
          .optional()
          .describe("Extra request headers (Authorization is managed)"),
        body: z
          .string()
          .optional()
          .describe("Request body for POST/PUT/PATCH"),
        max_sats: z
          .number()
          .int()
          .positive()
          .optional()
          .describe(
            "Maximum sats you authorize paying for this resource. " +
              "Omit to get a price quote without paying.",
          ),
      },
    },
    async ({ url: rawUrl, method, headers, body, max_sats }) => {
      try {
        const url = validateL402Url(rawUrl);
        const origin = url.origin;
        const verb = method ?? "GET";
        const extraHeaders = Object.fromEntries(
          Object.entries(headers ?? {}).filter(
            ([k]) => !["authorization", "host"].includes(k.toLowerCase()),
          ),
        );

        // 1. First attempt, reusing a cached token when we have one.
        const cachedAuth = l402Tokens.authHeaderFor(origin);
        let res = await fetchL402(url, verb, extraHeaders, body, cachedAuth);

        if (res.status !== 402) {
          return ok({
            url: url.toString(),
            status: res.status,
            usedCachedToken: Boolean(cachedAuth),
            location: res.headers.get("location") ?? undefined,
            ...(await readBody(res)),
          });
        }

        // 2. Got a 402 — any cached token is no longer accepted.
        if (cachedAuth) l402Tokens.delete(origin);

        const wwwAuth = res.headers.get("www-authenticate") ?? "";
        const challenge = parseL402Challenge(wwwAuth);
        if (!challenge) {
          return ok({
            url: url.toString(),
            status: 402,
            note:
              "The server returned 402 without a parseable L402/LSAT " +
              "challenge in WWW-Authenticate.",
            wwwAuthenticate: wwwAuth || undefined,
            ...(await readBody(res)),
          });
        }

        const decoded = decodeBolt11(challenge.invoice);
        if (decoded.expired) {
          return fail(
            new Error("The invoice in the L402 challenge has expired."),
          );
        }
        if (decoded.amountSats == null || decoded.amountSats <= 0) {
          return fail(
            new Error(
              "Refusing L402 challenge: the invoice does not specify a " +
                "concrete amount.",
            ),
          );
        }
        const amount = decoded.amountSats;

        // 3. No spending authorization → return the quote, pay nothing.
        if (max_sats == null) {
          return ok({
            url: url.toString(),
            status: 402,
            paymentRequired: true,
            amountSats: amount,
            description: decoded.description || undefined,
            paymentHash: decoded.paymentHash,
            invoice: challenge.invoice,
            scheme: challenge.scheme,
            note:
              `This resource costs ${amount} sats. Call l402_fetch again ` +
              "with max_sats >= amountSats to pay and retrieve it.",
          });
        }
        if (amount > max_sats) {
          return fail(
            new Error(
              `The server asks for ${amount} sats but max_sats=${max_sats}. ` +
                "Not paying.",
            ),
          );
        }

        // 4. Pay the invoice through the configured Lightning backend,
        //    under the same spending guard as every other payment.
        const maxFee = maxFeeFor(amount);
        const reservation = guard.reserve(amount + maxFee);
        let payment;
        try {
          payment = await backend.payInvoice({
            bolt11: challenge.invoice,
            maxFeeSats: maxFee,
          });
        } catch (err) {
          reservation.release();
          throw err;
        }
        reservation.commit(amount + payment.feeSats);

        if (!verifyPreimage(payment.preimage, decoded.paymentHash)) {
          return fail(
            new Error(
              "Payment succeeded but the preimage does not match the " +
                "invoice payment hash — cannot build a valid L402 token. " +
                `preimage=${payment.preimage}`,
            ),
          );
        }

        // 5. Cache the token and retry the request.
        l402Tokens.set({
          origin,
          scheme: challenge.scheme,
          macaroon: challenge.macaroon,
          preimage: payment.preimage,
          amountSats: amount,
          acquiredAt: Math.floor(Date.now() / 1000),
        });
        const authHeader = buildL402Header(challenge, payment.preimage);
        res = await fetchL402(url, verb, extraHeaders, body, authHeader);

        return ok({
          url: url.toString(),
          status: res.status,
          paid: {
            amountSats: amount,
            feeSats: payment.feeSats,
            preimage: payment.preimage,
            paymentHash: decoded.paymentHash,
          },
          tokenCachedFor: origin,
          location: res.headers.get("location") ?? undefined,
          ...(await readBody(res)),
        });
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "l402_tokens",
    {
      title: "List cached L402 tokens",
      description:
        "List the L402 tokens acquired in this session (origin, amount " +
        "paid, when). Pass forget_origin to drop a token and force a new " +
        "402 challenge on the next fetch. No payment is made.",
      inputSchema: {
        forget_origin: z
          .string()
          .optional()
          .describe(
            'Origin to remove from the cache, e.g. "https://api.example.com"',
          ),
      },
    },
    async ({ forget_origin }) => {
      try {
        let forgotten: string | undefined;
        if (forget_origin) {
          const origin = new URL(forget_origin).origin;
          forgotten = l402Tokens.delete(origin) ? origin : undefined;
        }
        return ok({
          tokens: l402Tokens
            .list()
            .map(({ origin, scheme, amountSats, acquiredAt }) => ({
              origin,
              scheme,
              amountSats,
              acquiredAt,
            })),
          ...(forget_origin ? { forgotten: forgotten ?? null } : {}),
        });
      } catch (err) {
        return fail(err);
      }
    },
  );
}
