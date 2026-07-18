/**
 * Node operations used by the setup wizard: Docker lifecycle for the
 * fullnode/ stack and LND wallet management over its REST API.
 *
 * Every action is a fixed, whitelisted operation — nothing here ever
 * executes user-supplied strings. All of it is reachable only through
 * the localhost-bound setup server.
 */
import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Agent, fetch as undiciFetch } from "undici";
import { packageRoot } from "../env.js";
import type { FullNodeNetwork } from "./fullnode.js";

export const fullnodeDir = join(packageRoot, "fullnode");
const metaPath = join(fullnodeDir, "stack.json");

export interface StackMeta {
  network: FullNodeNetwork;
  withAlbyHub: boolean;
  /** Bitcoin Core data directory (host path). Absent in stacks generated
   *  before this option existed — treat as the default ./bitcoin. */
  dataDir?: string;
  generatedAt: string;
}

export function readStackMeta(): StackMeta | null {
  try {
    return JSON.parse(readFileSync(metaPath, "utf8")) as StackMeta;
  } catch {
    return null;
  }
}

interface ExecResult {
  ok: boolean;
  stdout: string;
  stderr: string;
}

function run(
  cmd: string,
  args: string[],
  opts: { cwd?: string; timeoutMs?: number } = {},
): Promise<ExecResult> {
  return new Promise((resolve) => {
    execFile(
      cmd,
      args,
      {
        cwd: opts.cwd ?? fullnodeDir,
        timeout: opts.timeoutMs ?? 120_000,
        windowsHide: true,
        maxBuffer: 4 * 1024 * 1024,
      },
      (err, stdout, stderr) => {
        resolve({
          ok: !err,
          stdout: String(stdout ?? ""),
          stderr: err && !stderr ? String(err.message) : String(stderr ?? ""),
        });
      },
    );
  });
}

// ── Prerequisites ────────────────────────────────────────────────────

export async function checkPrereqs(): Promise<{
  node: string;
  docker: { installed: boolean; running: boolean; version?: string; error?: string };
  compose: { installed: boolean; version?: string };
  stack: { generated: boolean; meta: StackMeta | null };
}> {
  const docker = await run("docker", ["version", "--format", "{{.Server.Version}}"], {
    timeoutMs: 15_000,
  });
  const dockerClient = await run("docker", ["--version"], { timeoutMs: 15_000 });
  const compose = await run("docker", ["compose", "version", "--short"], {
    timeoutMs: 15_000,
  });
  return {
    node: process.version,
    docker: {
      installed: dockerClient.ok,
      running: docker.ok,
      version: docker.ok ? docker.stdout.trim() : undefined,
      error: docker.ok
        ? undefined
        : dockerClient.ok
          ? "Docker is installed but the engine is not running — start Docker Desktop."
          : "Docker was not found — install Docker Desktop.",
    },
    compose: {
      installed: compose.ok,
      version: compose.ok ? compose.stdout.trim() : undefined,
    },
    stack: {
      generated: existsSync(join(fullnodeDir, "docker-compose.yml")),
      meta: readStackMeta(),
    },
  };
}

// ── Docker compose lifecycle ─────────────────────────────────────────

const COMPOSE_SERVICES = new Set(["bitcoind", "lnd", "albyhub"]);

export async function composeAction(
  action: "up" | "down" | "ps" | "logs",
  service?: string,
): Promise<ExecResult & { containers?: unknown[] }> {
  if (!existsSync(join(fullnodeDir, "docker-compose.yml"))) {
    return {
      ok: false,
      stdout: "",
      stderr: "No stack generated yet — run step 2 first.",
    };
  }
  switch (action) {
    case "up":
      return run("docker", ["compose", "up", "-d"], { timeoutMs: 300_000 });
    case "down":
      return run("docker", ["compose", "down"], { timeoutMs: 120_000 });
    case "ps": {
      const res = await run("docker", ["compose", "ps", "--format", "json"]);
      if (!res.ok) return res;
      const containers = res.stdout
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean)
        .flatMap((line) => {
          try {
            const parsed = JSON.parse(line) as unknown;
            return Array.isArray(parsed) ? parsed : [parsed];
          } catch {
            return [];
          }
        });
      return { ...res, containers };
    }
    case "logs": {
      const svc = service && COMPOSE_SERVICES.has(service) ? service : "bitcoind";
      return run("docker", [
        "compose",
        "logs",
        "--no-color",
        "--tail",
        "80",
        svc,
      ]);
    }
  }
}

// ── bitcoind sync info (via bitcoin-cli inside the container) ────────

export async function bitcoindInfo(): Promise<
  | { ok: true; blocks: number; headers: number; progress: number; chain: string }
  | { ok: false; error: string }
> {
  const res = await run("docker", [
    "compose",
    "exec",
    "-T",
    "bitcoind",
    "bitcoin-cli",
    "getblockchaininfo",
  ]);
  if (!res.ok) {
    return { ok: false, error: res.stderr.trim() || "bitcoind not reachable yet" };
  }
  try {
    const info = JSON.parse(res.stdout) as {
      blocks: number;
      headers: number;
      verificationprogress: number;
      chain: string;
    };
    return {
      ok: true,
      blocks: info.blocks,
      headers: info.headers,
      progress: info.verificationprogress,
      chain: info.chain,
    };
  } catch {
    return { ok: false, error: "could not parse bitcoin-cli output" };
  }
}

// ── LND wallet management over REST ──────────────────────────────────

const LND_REST = "https://127.0.0.1:8080";

function lndAgent(): Agent {
  const certPath = join(fullnodeDir, "lnd", "tls.cert");
  if (existsSync(certPath)) {
    return new Agent({ connect: { ca: readFileSync(certPath) } });
  }
  // The cert appears only after LND's first start; it's our own localhost
  // service, so fall back to skipping verification for the wizard only.
  return new Agent({ connect: { rejectUnauthorized: false } });
}

function macaroonHex(): string | null {
  const meta = readStackMeta();
  const network = meta?.network ?? "mainnet";
  const p = join(
    fullnodeDir,
    "lnd",
    "data",
    "chain",
    "bitcoin",
    network,
    "admin.macaroon",
  );
  return existsSync(p) ? readFileSync(p).toString("hex") : null;
}

async function lndRest<T>(
  method: "GET" | "POST",
  path: string,
  body?: unknown,
  withMacaroon = false,
): Promise<T> {
  const headers: Record<string, string> = {};
  if (withMacaroon) {
    const mac = macaroonHex();
    if (!mac) {
      throw new Error(
        "admin.macaroon not found yet — create the wallet first (and wait a few seconds).",
      );
    }
    headers["Grpc-Metadata-macaroon"] = mac;
  }
  if (body) headers["Content-Type"] = "application/json";
  const agent = lndAgent();
  try {
    const res = await undiciFetch(`${LND_REST}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      dispatcher: agent,
      signal: AbortSignal.timeout(30_000),
    });
    const text = await res.text();
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = { message: text };
    }
    if (!res.ok) {
      const msg =
        (parsed as { message?: string }).message ?? `HTTP ${res.status}`;
      throw new Error(msg);
    }
    return parsed as T;
  } finally {
    await agent.close().catch(() => undefined);
  }
}

export async function lndAction(
  action: string,
  params: { password?: string; seed?: string[] },
): Promise<unknown> {
  switch (action) {
    case "genseed": {
      const res = await lndRest<{ cipher_seed_mnemonic: string[] }>(
        "GET",
        "/v1/genseed",
      );
      return { seed: res.cipher_seed_mnemonic };
    }
    case "init": {
      if (!params.password || params.password.length < 8) {
        throw new Error("Wallet password must be at least 8 characters.");
      }
      if (!Array.isArray(params.seed) || params.seed.length !== 24) {
        throw new Error("A 24-word seed from genseed is required.");
      }
      await lndRest("POST", "/v1/initwallet", {
        wallet_password: Buffer.from(params.password, "utf8").toString("base64"),
        cipher_seed_mnemonic: params.seed,
      });
      return { initialized: true };
    }
    case "unlock": {
      if (!params.password) throw new Error("Wallet password required.");
      await lndRest("POST", "/v1/unlockwallet", {
        wallet_password: Buffer.from(params.password, "utf8").toString("base64"),
      });
      return { unlocked: true };
    }
    case "getinfo": {
      return await lndRest<unknown>("GET", "/v1/getinfo", undefined, true);
    }
    case "newaddress": {
      return await lndRest<unknown>("GET", "/v1/newaddress?type=1", undefined, true);
    }
    default:
      throw new Error(`unknown LND action: ${action}`);
  }
}

/** Credentials to point the MCP server's LND backend at this node. */
export function lndCredentials(): {
  restUrl: string;
  macaroonHex: string | null;
  tlsCertPath: string;
} {
  return {
    restUrl: LND_REST,
    macaroonHex: macaroonHex(),
    tlsCertPath: join(fullnodeDir, "lnd", "tls.cert"),
  };
}
