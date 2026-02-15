/**
 * Configuration Module
 *
 * Environment, database, and external providers - all in one place.
 */

import { SQL } from "bun";

// ============================================================================
// Environment
// ============================================================================

export type AppConfig = {
  nodeEnv: string;
  port: number;
  databaseUrl: string;
  ollamaUrl: string;
  ollamaModel: string;
};

const DEFAULTS = {
  NODE_ENV: "development",
  PORT: "7200",
  DATABASE_URL: "postgresql://anima:anima_dev_password@localhost:7101/anima",
  OLLAMA_URL: "http://localhost:7102",
  OLLAMA_MODEL: "nomic-embed-text",
} as const;

export function getConfig(): AppConfig {
  return {
    nodeEnv: Bun.env.NODE_ENV || DEFAULTS.NODE_ENV,
    port: Number(Bun.env.PORT || DEFAULTS.PORT),
    databaseUrl: Bun.env.DATABASE_URL || DEFAULTS.DATABASE_URL,
    ollamaUrl: Bun.env.OLLAMA_URL || DEFAULTS.OLLAMA_URL,
    ollamaModel: Bun.env.OLLAMA_MODEL || DEFAULTS.OLLAMA_MODEL,
  };
}

export function displayConfig(): void {
  const config = getConfig();
  console.log("🔧 Configuration:");
  console.log(`   Environment: ${config.nodeEnv}`);
  console.log(`   Port: ${config.port}`);
  console.log(`   Ollama URL: ${config.ollamaUrl}`);
  console.log(`   Ollama Model: ${config.ollamaModel}`);
  console.log("");
}

// ============================================================================
// Database
// ============================================================================

const config = getConfig();

export const sql = new SQL({
  url: config.databaseUrl,
  max: 20,
  idleTimeout: 30,
});

export async function testConnection(): Promise<boolean> {
  try {
    const [{ now }] = await sql`SELECT NOW() as now`;
    console.log("✅ Database connected:", now);
    return true;
  } catch (error) {
    console.error("❌ Database connection failed:", (error as Error).message);
    throw error;
  }
}

export async function gracefulShutdown(): Promise<void> {
  await sql.close();
}
