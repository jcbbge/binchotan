/**
 * Message Service
 *
 * Business logic for storing messages and assembling context.
 */

import { sql } from "../config.ts";
import { getOrCreateMainBranch } from "./branches.ts";

const DEFAULT_CONTEXT_LIMIT = 20;

export async function appendMessage(data: {
  branchId?: string;
  parentId?: string;
  role: "user" | "assistant";
  content: string;
}): Promise<{ messageId: string; context: Array<{ role: string; content: string }> }> {
  const { role, content } = data;

  // Resolve branch — auto-create "main" if none specified
  let branchId = data.branchId;
  if (!branchId) {
    const main = await getOrCreateMainBranch();
    branchId = main.id;
  }

  // Resolve parent — use branch head if not specified
  let parentId = data.parentId;
  if (!parentId) {
    const [branch] = await sql`
      SELECT head_id FROM charcoal.branches WHERE id = ${branchId}
    `;
    if (!branch) throw new Error(`Branch ${branchId} not found`);
    parentId = branch.head_id;
  }

  // Insert the message
  const [message] = await sql`
    INSERT INTO charcoal.messages (branch_id, parent_id, role, content)
    VALUES (${branchId}, ${parentId}, ${role}, ${content})
    RETURNING id
  `;

  // Update branch head
  await sql`
    UPDATE charcoal.branches
    SET head_id = ${message.id}
    WHERE id = ${branchId}
  `;

  // Assemble context: walk parent_id chain for last N messages
  const context = await getContext(message.id, DEFAULT_CONTEXT_LIMIT);

  return {
    messageId: message.id,
    context,
  };
}

/**
 * Walk the parent_id chain backwards from a message, collecting up to `limit` messages,
 * then return them in chronological order.
 */
export async function getContext(
  messageId: string,
  limit: number = DEFAULT_CONTEXT_LIMIT,
): Promise<Array<{ role: string; content: string }>> {
  // Recursive CTE to walk the parent chain
  const rows = await sql`
    WITH RECURSIVE chain AS (
      SELECT id, parent_id, role, content, created_at, 1 AS depth
      FROM charcoal.messages
      WHERE id = ${messageId}

      UNION ALL

      SELECT m.id, m.parent_id, m.role, m.content, m.created_at, c.depth + 1
      FROM charcoal.messages m
      JOIN chain c ON m.id = c.parent_id
      WHERE c.depth < ${limit}
    )
    SELECT role, content
    FROM chain
    ORDER BY depth DESC
  `;

  return rows.map((r: any) => ({ role: r.role, content: r.content }));
}
