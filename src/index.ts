/**
 * Binchotan Server
 *
 * Application and server startup combined.
 */

import { Hono } from "hono";
import { logger } from "hono/logger";
import { cors } from "hono/cors";
import { requestId } from "hono/request-id";
import { serve } from "bun";
import { getConfig, displayConfig, testConnection, gracefulShutdown } from "./config.ts";
import branchRoutes from "./routes/branches.ts";
import messageRoutes, { contextRoutes } from "./routes/messages.ts";
import { startScribe } from "./services/scribe.ts";

const config = getConfig();

// ============================================================================
// App
// ============================================================================

const app = new Hono();

app.use("*", requestId());
app.use("*", logger());
app.use("*", cors());

app.get("/health", (c) => {
  return c.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    service: "binchotan",
    version: "0.1.0",
  });
});

app.get("/", (c) => {
  return c.json({
    name: "Binchotan",
    description: "Invisible memory layer for LLM conversations",
    version: "0.1.0",
  });
});

// ============================================================================
// API Routes
// ============================================================================

const api = new Hono();
api.route("/branches", branchRoutes);
api.route("/messages", messageRoutes);
api.route("/context", contextRoutes);
app.route("/api", api);

app.notFound((c) => {
  return c.json({ error: "Not Found", path: c.req.path }, 404);
});

app.onError((err, c) => {
  console.error("Error:", err);
  return c.json({ error: "Internal Server Error", message: (err as Error).message }, 500);
});

// ============================================================================
// Server
// ============================================================================

console.log("\n🪵 Binchotan Server");
console.log("========================\n");

displayConfig();

try {
  await testConnection();
  console.log("");
} catch (error) {
  console.error("Failed to connect to database. Exiting...\n");
  process.exit(1);
}

const server = serve({
  fetch: app.fetch,
  port: config.port,
  hostname: "0.0.0.0",
});

console.log(`🚀 Server running on http://localhost:${config.port}`);
console.log(`   Health check: http://localhost:${config.port}/health`);
console.log("\n✨ Ready to receive requests\n");

startScribe();

const shutdown = async () => {
  console.log("\n🛑 Shutting down gracefully...");
  server.stop();
  await gracefulShutdown();
  console.log("✅ Shutdown complete\n");
  process.exit(0);
};

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
