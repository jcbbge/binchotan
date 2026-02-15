/**
 * Lens Service
 *
 * Context assembly algorithm that combines recency-based messages
 * with anchored (pinned) messages, applies token budgets, and
 * returns a chronologically sorted context window.
 */

import { sql } from "../config.ts";
import { findSimilar } from "./embeddings.ts";

export type LensConfig = {
  recencyLimit: number;
  maxTokens: number;
  includeAnchors: boolean;
  semanticLimit: number;
};

export const DEFAULT_LENS_CONFIG: LensConfig = {
  recencyLimit: 20,
  maxTokens: 4096,
  includeAnchors: true,
  semanticLimit: 5,
};

type LensMessage = {
  id: string;
  role: string;
  content: string;
  createdAt: string;
  isAnchor: boolean;
};

/**
 * Estimate token count from content string.
 * Rough heuristic: ~4 characters per token.
 */
function estimateTokens(content: string): number {
  return Math.ceil(content.length / 4);
}

/**
 * Assemble a lens (context window) for a branch.
 *
 * Algorithm:
 * 1. Walk parent_id backward from messageId (or branch head) for recencyLimit messages
 * 2. Collect ALL anchored messages in the full ancestry chain
 * 3. Merge recency + anchors, deduplicate by id, sort by created_at ASC
 * 4. Apply token budget: trim oldest non-anchor messages first
 */
export async function assembleLens(
  branchId: string,
  messageId?: string,
  config?: Partial<LensConfig>,
): Promise<Array<{ role: string; content: string }>> {
  const cfg = { ...DEFAULT_LENS_CONFIG, ...config };

  // Resolve starting message — use branch head if not specified
  let startId = messageId;
  if (!startId) {
    const [branch] = await sql`
      SELECT head_id FROM charcoal.branches WHERE id = ${branchId}
    `;
    if (!branch) throw new Error(`Branch ${branchId} not found`);
    if (!branch.head_id) return []; // empty branch
    startId = branch.head_id;
  }

  // Walk the full ancestry chain, collecting recency window + all anchors
  // The CTE walks the entire parent_id chain without limit.
  // We tag each row with its depth so we can identify the recency window.
  const rows: any[] = await sql`
    WITH RECURSIVE chain AS (
      SELECT id, parent_id, role, content, created_at, is_anchor, 1 AS depth
      FROM charcoal.messages
      WHERE id = ${startId}

      UNION ALL

      SELECT m.id, m.parent_id, m.role, m.content, m.created_at, m.is_anchor, c.depth + 1
      FROM charcoal.messages m
      JOIN chain c ON m.id = c.parent_id
    )
    SELECT id, role, content, created_at, is_anchor, depth
    FROM chain
    WHERE depth <= ${cfg.recencyLimit}
       OR (is_anchor = true AND ${cfg.includeAnchors})
    ORDER BY created_at ASC
  `;

  // Deduplicate (anchors within recency window appear once already, but be safe)
  const seen = new Set<string>();
  const messages: LensMessage[] = [];
  for (const row of rows) {
    if (!seen.has(row.id)) {
      seen.add(row.id);
      messages.push({
        id: row.id,
        role: row.role,
        content: row.content,
        createdAt: row.created_at,
        isAnchor: row.is_anchor,
      });
    }
  }

  // Semantic retrieval: if the latest message has an embedding, find similar messages
  // not already in the context set and merge them in.
  if (cfg.semanticLimit > 0 && startId) {
    try {
      const [embRow] = await sql`
        SELECT embedding FROM charcoal.embeddings WHERE message_id = ${startId}
      `;
      if (embRow?.embedding) {
        const embedding = typeof embRow.embedding === "string"
          ? JSON.parse(embRow.embedding)
          : embRow.embedding;
        const excludeIds = Array.from(seen);
        const similar = await findSimilar(embedding, cfg.semanticLimit, excludeIds);

        if (similar.length > 0) {
          const similarIds = similar.map((s) => s.messageId);
          const semanticRows: any[] = await sql`
            SELECT id, role, content, created_at, is_anchor
            FROM charcoal.messages
            WHERE id = ANY(${similarIds}::uuid[])
            ORDER BY created_at ASC
          `;
          for (const row of semanticRows) {
            if (!seen.has(row.id)) {
              seen.add(row.id);
              messages.push({
                id: row.id,
                role: row.role,
                content: row.content,
                createdAt: row.created_at,
                isAnchor: row.is_anchor,
              });
            }
          }
          // Re-sort chronologically after adding semantic results
          messages.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
        }
      }
    } catch (err) {
      // Graceful degradation: semantic retrieval failure doesn't break the lens
      console.error("Semantic retrieval failed (non-blocking):", (err as Error).message);
    }
  }

  // Apply token budget — trim oldest non-anchor messages first
  let totalTokens = messages.reduce((sum, m) => sum + estimateTokens(m.content), 0);

  if (totalTokens > cfg.maxTokens) {
    // Build list of non-anchor messages sorted oldest first (already sorted by created_at ASC)
    const nonAnchorIndices: number[] = [];
    for (let i = 0; i < messages.length; i++) {
      if (!messages[i].isAnchor) {
        nonAnchorIndices.push(i);
      }
    }

    // Remove oldest non-anchor messages until within budget
    const toRemove = new Set<number>();
    for (const idx of nonAnchorIndices) {
      if (totalTokens <= cfg.maxTokens) break;
      totalTokens -= estimateTokens(messages[idx].content);
      toRemove.add(idx);
    }

    const trimmed = messages.filter((_, i) => !toRemove.has(i));
    return trimmed.map((m) => ({ role: m.role, content: m.content }));
  }

  return messages.map((m) => ({ role: m.role, content: m.content }));
}
