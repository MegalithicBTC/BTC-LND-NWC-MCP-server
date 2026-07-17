/**
 * Configuration: env-driven settings and the backend factory.
 *
 * `Settings` is a plain object so the setup GUI can build backends from
 * form values and the server can build them from process.env with the
 * same code path.
 */
import { readFileSync } from "node:fs";
import type { LightningBackend } from "./types.js";
import { NwcBackend } from "./backends/nwc.js";
import { LndBackend } from "./backends/lnd.js";

export interface Settings {
  backend: "nwc" | "lnd";
  nwcConnectionString?: string;
  lndRestUrl?: string;
  lndMacaroonHex?: string;
  lndMacaroonPath?: string;
  lndTlsCertPath?: string;
  lndSkipCertVerify?: boolean;
  maxSendSats: number;
  dailyBudgetSats: number;
  maxFeePercent: number;
  defaultInvoiceExpiry: number;
}

export type Config = Settings;

const num = (name: string, fallback: number): number => {
  const raw = process.env[name];
  if (raw == null || raw.trim() === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) {
    throw new Error(`${name} must be a non-negative number, got "${raw}"`);
  }
  return n;
};

export function loadConfig(): Settings {
  const backend = (process.env.LN_BACKEND ?? "nwc").toLowerCase();
  if (backend !== "nwc" && backend !== "lnd") {
    throw new Error(`LN_BACKEND must be "nwc" or "lnd", got "${backend}"`);
  }
  return {
    backend,
    nwcConnectionString: process.env.NWC_CONNECTION_STRING || undefined,
    lndRestUrl: process.env.LND_REST_URL || undefined,
    lndMacaroonHex: process.env.LND_MACAROON_HEX || undefined,
    lndMacaroonPath: process.env.LND_MACAROON_PATH || undefined,
    lndTlsCertPath: process.env.LND_TLS_CERT_PATH || undefined,
    lndSkipCertVerify:
      (process.env.LND_SKIP_CERT_VERIFY ?? "").toLowerCase() === "true",
    maxSendSats: num("MAX_SEND_SATS", 10_000),
    dailyBudgetSats: num("DAILY_BUDGET_SATS", 50_000),
    maxFeePercent: num("MAX_FEE_PERCENT", 1),
    defaultInvoiceExpiry: num("DEFAULT_INVOICE_EXPIRY", 3600),
  };
}

export function createBackend(settings: Settings): LightningBackend {
  switch (settings.backend) {
    case "nwc": {
      if (!settings.nwcConnectionString) {
        throw new Error(
          "The NWC backend requires NWC_CONNECTION_STRING " +
            "(a nostr+walletconnect:// URL from your wallet)",
        );
      }
      return new NwcBackend(settings.nwcConnectionString);
    }
    case "lnd": {
      let macaroonHex = settings.lndMacaroonHex ?? "";
      if (!macaroonHex && settings.lndMacaroonPath) {
        macaroonHex = readFileSync(settings.lndMacaroonPath).toString("hex");
      }
      if (!settings.lndRestUrl || !macaroonHex) {
        throw new Error(
          "The LND backend requires LND_REST_URL and LND_MACAROON_HEX " +
            "(or LND_MACAROON_PATH)",
        );
      }
      return new LndBackend({
        restUrl: settings.lndRestUrl,
        macaroonHex,
        tlsCertPath: settings.lndTlsCertPath || undefined,
        skipCertVerify: settings.lndSkipCertVerify ?? false,
      });
    }
  }
}
