/**
 * Minimal .env support — zero dependencies.
 *
 * Loads `<package root>/.env` (if present) into process.env without
 * overriding variables that are already set, so values passed by the MCP
 * client config always win over the file.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** Absolute path to the package root (the directory containing package.json). */
export const packageRoot = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
);

export const envFilePath = join(packageRoot, ".env");

/** Parse the content of a .env file into key/value pairs. */
export function parseEnv(content: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    // Strip optional surrounding quotes
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

/** Load .env from the package root into process.env (non-overriding). */
export function loadDotEnv(path = envFilePath): void {
  if (!existsSync(path)) return;
  const parsed = parseEnv(readFileSync(path, "utf8"));
  for (const [key, value] of Object.entries(parsed)) {
    if (process.env[key] == null || process.env[key] === "") {
      process.env[key] = value;
    }
  }
}
