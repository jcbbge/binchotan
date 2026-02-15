/**
 * Embedding Service
 *
 * Generates embeddings via Ollama and stores/queries them in pgvector.
 */

import { sql, getConfig } from "../config.ts";

/**
 * Generate an embedding vector for a text string using Ollama.
 */
export async function generateEmbedding(text: string): Promise<number[]> {
  const config = getConfig();
  const response = await fetch(`${config.ollamaUrl}/api/embed`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: config.ollamaModel, input: text }),
  });

  if (!response.ok) {
    throw new Error(`Ollama embedding error: ${response.status}`);
  }

  const payload = await response.json();
  if (!payload?.embeddings?.[0] || !Array.isArray(payload.embeddings[0])) {
    throw new Error("Invalid embedding response from Ollama");
  }

  return payload.embeddings[0];
}

/**
 * Store an embedding for a message in the charcoal.embeddings table.
 */
export async function storeEmbedding(
  messageId: string,
  embedding: number[],
): Promise<void> {
  const vec = `[${embedding.join(",")}]`;
  await sql`
    INSERT INTO charcoal.embeddings (message_id, embedding)
    VALUES (${messageId}, ${vec}::vector)
    ON CONFLICT (message_id) DO UPDATE SET embedding = ${vec}::vector
  `;
}

/**
 * Find messages with the most similar embeddings using pgvector cosine distance.
 */
export async function findSimilar(
  embedding: number[],
  limit: number = 5,
  excludeIds: string[] = [],
): Promise<Array<{ messageId: string; similarity: number }>> {
  const vec = `[${embedding.join(",")}]`;

  const rows =
    excludeIds.length > 0
      ? await sql`
          SELECT e.message_id, 1 - (e.embedding <=> ${vec}::vector) AS similarity
          FROM charcoal.embeddings e
          WHERE e.message_id != ALL(${excludeIds}::uuid[])
          ORDER BY e.embedding <=> ${vec}::vector
          LIMIT ${limit}
        `
      : await sql`
          SELECT e.message_id, 1 - (e.embedding <=> ${vec}::vector) AS similarity
          FROM charcoal.embeddings e
          ORDER BY e.embedding <=> ${vec}::vector
          LIMIT ${limit}
        `;

  return rows.map((r: any) => ({
    messageId: r.message_id,
    similarity: Number(r.similarity),
  }));
}
