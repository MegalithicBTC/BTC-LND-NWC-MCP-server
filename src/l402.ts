/**
 * L402 (formerly LSAT) — Lightning HTTP 402 payment protocol, client side.
 *
 * Flow:
 *   1. Client requests a paid resource and receives HTTP 402 with a
 *      `WWW-Authenticate: L402 macaroon="...", invoice="lnbc..."` header.
 *   2. Client pays the BOLT11 invoice over Lightning and obtains the
 *      payment preimage (proof of payment).
 *   3. Client retries the request with
 *      `Authorization: L402 <macaroon>:<preimage-hex>` and gets the
 *      resource.
 *
 * Everything here is backend-agnostic: paying the invoice goes through the
 * regular LightningBackend interface, so L402 works identically over a
 * direct LND connection or any NWC wallet. No extra dependencies.
 *
 * Spec: https://github.com/lightninglabs/L402
 */
import { createHash } from "node:crypto";

export interface L402Challenge {
  /** Auth scheme announced by the server: "L402" or legacy "LSAT". */
  scheme: string;
  /** Base64-encoded macaroon from the challenge. */
  macaroon: string;
  /** BOLT11 invoice to pay. */
  invoice: string;
}

/**
 * Parse a WWW-Authenticate header into an L402 challenge.
 *
 * Accepts both the modern `L402` scheme and the legacy `LSAT` scheme,
 * with quoted or unquoted parameter values, in any order. Returns null
 * if the header does not contain an L402/LSAT challenge (e.g. Basic,
 * Bearer, or a malformed challenge).
 */
export function parseL402Challenge(header: string): L402Challenge | null {
  const match = /(?:^|,)\s*(L402|LSAT)\s+([^]*)/i.exec(header);
  if (!match) return null;
  const scheme = match[1].toUpperCase();
  const params = match[2];

  const values: Record<string, string> = {};
  const paramRe = /([a-zA-Z0-9_]+)\s*=\s*(?:"([^"]*)"|([^",\s]+))/g;
  for (let m = paramRe.exec(params); m; m = paramRe.exec(params)) {
    values[m[1].toLowerCase()] = m[2] ?? m[3];
  }

  const macaroon = values.macaroon ?? values.token;
  const invoice = values.invoice;
  if (!macaroon || !invoice) return null;
  return { scheme, macaroon, invoice };
}

/**
 * Build the Authorization header value for a paid challenge:
 * `L402 <macaroon>:<preimage-hex>` (or `LSAT ...` for legacy servers).
 */
export function buildL402Header(
  challenge: Pick<L402Challenge, "scheme" | "macaroon">,
  preimageHex: string,
): string {
  return `${challenge.scheme} ${challenge.macaroon}:${preimageHex}`;
}

/**
 * Verify that a payment preimage matches an invoice's payment hash
 * (payment_hash = sha256(preimage)). This proves the payment we made is
 * actually the one the server asked for.
 */
export function verifyPreimage(
  preimageHex: string,
  paymentHashHex: string,
): boolean {
  if (!/^[0-9a-fA-F]{64}$/.test(preimageHex)) return false;
  const hash = createHash("sha256")
    .update(Buffer.from(preimageHex, "hex"))
    .digest("hex");
  return hash === paymentHashHex.toLowerCase();
}

export interface L402Token {
  /** Origin the token is valid for, e.g. "https://api.example.com". */
  origin: string;
  scheme: string;
  macaroon: string;
  preimage: string;
  /** What we paid for this token, in sats (excluding fees). */
  amountSats: number;
  /** Unix timestamp (seconds) when the token was acquired. */
  acquiredAt: number;
}

/**
 * In-memory cache of paid L402 tokens, keyed by origin, so repeat
 * requests to the same API reuse the token instead of paying again.
 * Tokens are dropped when the server rejects them with a fresh 402.
 * The cache resets when the server restarts.
 */
export class L402TokenStore {
  private tokens = new Map<string, L402Token>();

  get(origin: string): L402Token | undefined {
    return this.tokens.get(origin);
  }

  set(token: L402Token): void {
    this.tokens.set(token.origin, token);
  }

  delete(origin: string): boolean {
    return this.tokens.delete(origin);
  }

  list(): L402Token[] {
    return [...this.tokens.values()];
  }

  /** Authorization header value for a cached token, if any. */
  authHeaderFor(origin: string): string | undefined {
    const t = this.tokens.get(origin);
    return t ? buildL402Header(t, t.preimage) : undefined;
  }
}
