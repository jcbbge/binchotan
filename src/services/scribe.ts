/**
 * Scribe — Background Worker
 *
 * Processes new messages asynchronously:
 * 1. Generate and store embeddings
 * 2. Detect topic shifts (cosine similarity vs recent context)
 *
 * Uses Postgres LISTEN/NOTIFY as the PRIMARY mechanism for real-time
 * processing. The migration 002_scribe_notify.sql creates a trigger:
 *   AFTER INSERT ON charcoal.messages → pg_notify('charcoal_new_message', NEW.id::text)
 *
 * A 30s polling loop runs as FALLBACK to catch anything missed during
 * reconnection windows.
 */

import { sql, getConfig } from "../config.ts";
import { generateEmbedding, storeEmbedding } from "./embeddings.ts";
import postgres from "postgres";

const POLL_INTERVAL_MS = 30_000;
const TOPIC_SHIFT_THRESHOLD = Number(
  Bun.env.TOPIC_SHIFT_THRESHOLD || "0.3",
);

/**
 * Cosine similarity between two vectors.
 */
function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom === 0 ? 0 : dot / denom;
}

/**
 * Process a single message: generate embedding, store it, detect topic shifts.
 */
async function processMessage(messageId: string): Promise<void> {
  const [msg] = await sql`
    SELECT id, branch_id, content FROM charcoal.messages WHERE id = ${messageId}
  `;
  if (!msg) {
    console.log(`[scribe] Message ${messageId} not found, skipping`);
    return;
  }

  // Check if embedding already exists
  const [existing] = await sql`
    SELECT message_id FROM charcoal.embeddings WHERE message_id = ${messageId}
  `;
  if (existing) return;

  // Generate and store embedding
  const embedding = await generateEmbedding(msg.content);
  await storeEmbedding(messageId, embedding);
  console.log(`[scribe] Embedded message ${messageId}`);

  // Topic shift detection
  await detectTopicShift(msg.branch_id, messageId, embedding);
}

/**
 * Compare the new embedding against the average of the last 5 message embeddings
 * in the same branch. If similarity < threshold, log a topic shift.
 */
async function detectTopicShift(
  branchId: string,
  messageId: string,
  newEmbedding: number[],
): Promise<void> {
  const recentRows = await sql`
    SELECT e.embedding::text AS embedding_text
    FROM charcoal.embeddings e
    JOIN charcoal.messages m ON m.id = e.message_id
    WHERE m.branch_id = ${branchId}
      AND e.message_id != ${messageId}
    ORDER BY m.created_at DESC
    LIMIT 5
  `;

  if (recentRows.length === 0) return;

  // Parse vectors and compute average
  const vectors: number[][] = recentRows.map((r: any) => {
    const raw = r.embedding_text.replace(/[\[\]]/g, "");
    return raw.split(",").map(Number);
  });

  const dim = vectors[0].length;
  const avg = new Array(dim).fill(0);
  for (const vec of vectors) {
    for (let i = 0; i < dim; i++) {
      avg[i] += vec[i];
    }
  }
  for (let i = 0; i < dim; i++) {
    avg[i] /= vectors.length;
  }

  const similarity = cosineSimilarity(newEmbedding, avg);
  if (similarity < TOPIC_SHIFT_THRESHOLD) {
    console.log(
      `[scribe] Topic shift detected in branch ${branchId} at message ${messageId} (similarity: ${similarity.toFixed(3)})`,
    );
  }
}

/**
 * Poll for messages that don't have embeddings yet.
 */
async function pollUnprocessed(): Promise<void> {
  const rows = await sql`
    SELECT m.id
    FROM charcoal.messages m
    LEFT JOIN charcoal.embeddings e ON e.message_id = m.id
    WHERE e.message_id IS NULL
    ORDER BY m.created_at ASC
    LIMIT 50
  `;

  if (rows.length > 0) {
    console.log(`[scribe] Polling found ${rows.length} unprocessed message(s)`);
  }

  for (const row of rows) {
    try {
      await processMessage(row.id);
    } catch (err) {
      console.error(`[scribe] Failed to process message ${row.id}:`, (err as Error).message);
    }
  }
}

/**
 * Start the LISTEN/NOTIFY listener on a dedicated postgres connection.
 * Reconnects automatically if the connection drops.
 */
async function startListener(): Promise<void> {
  const config = getConfig();
  const listenSql = postgres(config.databaseUrl, {
    max: 1,
    idle_timeout: 0,
    max_lifetime: null,
    connection: {
      application_name: "binchotan_scribe_listen",
    },
  });

  // postgres.js .listen() handles reconnection automatically —
  // if the connection drops, it re-subscribes on reconnect.
  try {
    await listenSql.listen("charcoal_new_message", async (messageId: string) => {
      console.log(`[scribe] NOTIFY received for message ${messageId}`);
      try {
        await processMessage(messageId);
      } catch (err) {
        console.error(`[scribe] Failed to process notified message ${messageId}:`, (err as Error).message);
      }
    });
    console.log("[scribe] Listening on charcoal_new_message");
  } catch (err) {
    console.error("[scribe] LISTEN connection failed:", (err as Error).message);
    console.log("[scribe] Retrying LISTEN in 5s...");
    await new Promise((r) => setTimeout(r, 5_000));
    return startListener();
  }
}

/**
 * Start the Scribe background worker.
 *
 * PRIMARY: Postgres LISTEN/NOTIFY for real-time message processing.
 * FALLBACK: Polls every 30s for messages missing embeddings.
 */
export function startScribe(): void {
  console.log("[scribe] Background worker started");
  console.log(`[scribe] Topic shift threshold: ${TOPIC_SHIFT_THRESHOLD}`);
  console.log(`[scribe] Poll interval: ${POLL_INTERVAL_MS / 1000}s (fallback)`);

  // PRIMARY: Start LISTEN/NOTIFY listener
  startListener().catch((err) => {
    console.error("[scribe] Failed to start listener:", (err as Error).message);
    console.log("[scribe] Falling back to polling only");
  });

  // FALLBACK: Polling loop
  setInterval(async () => {
    try {
      await pollUnprocessed();
    } catch (err) {
      console.error("[scribe] Poll cycle error:", (err as Error).message);
    }
  }, POLL_INTERVAL_MS);

  // Initial poll after a short delay (let server finish starting)
  setTimeout(async () => {
    try {
      await pollUnprocessed();
    } catch (err) {
      console.error("[scribe] Initial poll error:", (err as Error).message);
    }
  }, 2_000);
}
