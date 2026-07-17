/**
 * Local BOLT11 decoding — no network, no backend needed.
 */
import { decode } from "light-bolt11-decoder";

export interface DecodedInvoice {
  paymentHash: string;
  /** Amount in sats; null for zero-amount ("any amount") invoices. */
  amountSats: number | null;
  description: string;
  /** Unix timestamp (seconds) when the invoice was created. */
  createdAt: number;
  /** Unix timestamp (seconds) when the invoice expires. */
  expiresAt: number;
  expired: boolean;
  network: string;
}

type Section = { name: string; value?: unknown; letters?: string };

export function decodeBolt11(bolt11: string): DecodedInvoice {
  const decoded = decode(bolt11.trim()) as {
    sections: Section[];
    expiry?: number;
  };
  const section = (name: string): Section | undefined =>
    decoded.sections.find((s) => s.name === name);

  const msats = section("amount")?.value;
  const timestamp = Number(section("timestamp")?.value ?? 0);
  const expiry = Number(section("expiry")?.value ?? decoded.expiry ?? 3600);
  const expiresAt = timestamp + expiry;

  return {
    paymentHash: String(section("payment_hash")?.value ?? ""),
    amountSats: msats != null ? Math.floor(Number(msats) / 1000) : null,
    description: String(section("description")?.value ?? ""),
    createdAt: timestamp,
    expiresAt,
    expired: Date.now() / 1000 > expiresAt,
    network:
      (section("coin_network")?.value as { bech32?: string } | undefined)
        ?.bech32 ?? "bc",
  };
}
