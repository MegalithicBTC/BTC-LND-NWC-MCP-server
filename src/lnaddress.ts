/**
 * Lightning Address (LUD-16) resolution.
 *
 * user@domain.com → https://domain.com/.well-known/lnurlp/user
 * → LNURL-pay callback → BOLT11 invoice for the requested amount.
 */

export interface LnAddressInvoice {
  bolt11: string;
  /** Metadata description from the LNURL-pay endpoint. */
  description: string;
  minSendableSats: number;
  maxSendableSats: number;
}

const ADDRESS_RE = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i;

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    throw new Error(`${url} responded HTTP ${res.status}`);
  }
  return (await res.json()) as T;
}

export async function resolveLightningAddress(
  address: string,
  amountSats: number,
  comment?: string,
): Promise<LnAddressInvoice> {
  const trimmed = address.trim();
  if (!ADDRESS_RE.test(trimmed)) {
    throw new Error(
      `"${address}" is not a valid Lightning address (expected user@domain)`,
    );
  }
  const [user, domain] = trimmed.split("@");

  interface PayParams {
    tag?: string;
    callback?: string;
    minSendable?: number; // msats
    maxSendable?: number; // msats
    metadata?: string;
    commentAllowed?: number;
    reason?: string;
    status?: string;
  }
  const params = await getJson<PayParams>(
    `https://${domain}/.well-known/lnurlp/${encodeURIComponent(user)}`,
  );
  if (params.status === "ERROR") {
    throw new Error(`LNURL error from ${domain}: ${params.reason}`);
  }
  if (params.tag !== "payRequest" || !params.callback) {
    throw new Error(`${domain} did not return a valid LNURL-pay response`);
  }

  const amountMsat = amountSats * 1000;
  const minSendable = params.minSendable ?? 1000;
  const maxSendable = params.maxSendable ?? Number.MAX_SAFE_INTEGER;
  if (amountMsat < minSendable || amountMsat > maxSendable) {
    throw new Error(
      `${trimmed} accepts between ${Math.ceil(minSendable / 1000)} and ` +
        `${Math.floor(maxSendable / 1000)} sats; requested ${amountSats}`,
    );
  }

  const cb = new URL(params.callback);
  // SSRF guard: the callback comes from a remote server — never follow it
  // onto plain HTTP, IP literals, or local names.
  if (cb.protocol !== "https:") {
    throw new Error(
      `refusing non-HTTPS LNURL callback from ${domain}: ${cb.protocol}//`,
    );
  }
  const cbHost = cb.hostname.toLowerCase();
  if (
    cbHost === "localhost" ||
    cbHost.endsWith(".local") ||
    cbHost.endsWith(".internal") ||
    cbHost.startsWith("[") || // IPv6 literal
    /^(\d{1,3}\.){3}\d{1,3}$/.test(cbHost) // IPv4 literal
  ) {
    throw new Error(
      `refusing suspicious LNURL callback host from ${domain}: ${cbHost}`,
    );
  }
  cb.searchParams.set("amount", String(amountMsat));
  if (comment && (params.commentAllowed ?? 0) >= comment.length) {
    cb.searchParams.set("comment", comment);
  }

  interface CallbackRes {
    pr?: string;
    status?: string;
    reason?: string;
  }
  const invoiceRes = await getJson<CallbackRes>(cb.toString());
  if (invoiceRes.status === "ERROR" || !invoiceRes.pr) {
    throw new Error(
      `LNURL callback error from ${domain}: ${
        invoiceRes.reason ?? "no invoice returned"
      }`,
    );
  }

  let description = "";
  try {
    const meta = JSON.parse(params.metadata ?? "[]") as [string, string][];
    description =
      meta.find(([k]) => k === "text/plain")?.[1] ?? "";
  } catch {
    /* metadata is best-effort */
  }

  return {
    bolt11: invoiceRes.pr,
    description,
    minSendableSats: Math.ceil(minSendable / 1000),
    maxSendableSats: Math.floor(maxSendable / 1000),
  };
}
