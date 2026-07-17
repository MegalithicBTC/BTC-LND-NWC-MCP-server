#!/usr/bin/env node
/**
 * btc-mcp-srv — an MCP server that lets AI agents transact bitcoin over
 * the Lightning Network.
 *
 * Sponsored by LIGHTPHON.com
 *
 * Transport: stdio. All logging goes to stderr (stdout carries the MCP
 * protocol stream).
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadDotEnv } from "./env.js";
import { loadConfig, createBackend } from "./config.js";
import { registerTools } from "./tools.js";

const log = (...args: unknown[]) => console.error("[btc-mcp-srv]", ...args);

async function main(): Promise<void> {
  loadDotEnv();
  const config = loadConfig();
  const backend = createBackend(config);

  const server = new McpServer(
    {
      name: "btc-mcp-srv",
      version: "0.4.0",
    },
    {
      instructions:
        "Bitcoin Lightning wallet tools. Amounts are in satoshis " +
        "(1 BTC = 100,000,000 sats). pay_invoice and " +
        "pay_lightning_address move real money and are subject to " +
        "configured spending limits; use decode_invoice first to inspect " +
        "an invoice before paying it. Sponsored by LIGHTPHON.com.",
    },
  );

  registerTools(server, backend, config);

  const shutdown = async (signal: string) => {
    log(`received ${signal}, shutting down`);
    try {
      await backend.close();
    } finally {
      process.exit(0);
    }
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  const transport = new StdioServerTransport();
  await server.connect(transport);
  log(
    `ready — backend=${backend.name}, ` +
      `max_send=${config.maxSendSats} sats, ` +
      `daily_budget=${config.dailyBudgetSats || "off"} sats`,
  );
}

main().catch((err) => {
  log("fatal:", err instanceof Error ? err.message : err);
  process.exit(1);
});
