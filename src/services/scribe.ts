/**
 * Scribe — Background Worker
 *
 * Processes new messages asynchronously:
 * 1. Generate and store embeddings
 * 2. Detect topic shifts (cosine similarity vs recent context)
 *
 * Uses polling every 30s to find unprocessed messages (messages without
 * embeddings). The migration adds a Postgres NOTIFY trigger on message
 * insert for future real-time handling once Bun SQL supports LISTEN.
 */

import { sql } from "../config.ts";
import { generateEmbedding, storeEmbedding } from "./embeddings.ts";

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
 * Start the Scribe background worker.
 *
 * Polls every 30s for messages missing embeddings. The Postgres NOTIFY
 * trigger (002_scribe_notify.sql) is in place for future real-time
 * handling once the driver supports LISTEN callbacks.
 */
export function startScribe(): void {
  console.log("[scribe] Background worker started");
  console.log(`[scribe] Topic shift threshold: ${TOPIC_SHIFT_THRESHOLD}`);
  console.log(`[scribe] Poll interval: ${POLL_INTERVAL_MS / 1000}s`);

  // Polling loop
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
