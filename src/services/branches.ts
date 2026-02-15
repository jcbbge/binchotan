/**
 * Branch Service
 *
 * Business logic for branch management.
 */

import { sql } from "../config.ts";

export async function createBranch(data: {
  name: string;
  sourceBranchId?: string;
  sourceMessageId?: string;
}): Promise<{ id: string; name: string; headId: string | null; createdAt: string }> {
  const { name, sourceBranchId, sourceMessageId } = data;

  // If forking from a source, resolve the head
  let headId: string | null = null;
  if (sourceBranchId) {
    if (sourceMessageId) {
      // Fork from a specific message
      headId = sourceMessageId;
    } else {
      // Fork from the source branch's current head
      const [source] = await sql`
        SELECT head_id FROM charcoal.branches WHERE id = ${sourceBranchId}
      `;
      if (!source) throw new Error(`Source branch ${sourceBranchId} not found`);
      headId = source.head_id;
    }
  }

  const [branch] = await sql`
    INSERT INTO charcoal.branches (name, head_id)
    VALUES (${name}, ${headId})
    RETURNING id, name, head_id, created_at
  `;

  return {
    id: branch.id,
    name: branch.name,
    headId: branch.head_id,
    createdAt: branch.created_at,
  };
}

export async function listBranches(): Promise<
  Array<{ id: string; name: string; headId: string | null; createdAt: string; updatedAt: string }>
> {
  const rows = await sql`
    SELECT id, name, head_id, created_at, updated_at
    FROM charcoal.branches
    ORDER BY created_at ASC
  `;

  return rows.map((r: any) => ({
    id: r.id,
    name: r.name,
    headId: r.head_id,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }));
}

export async function getBranch(
  id: string,
): Promise<{ id: string; name: string; headId: string | null; createdAt: string; updatedAt: string } | null> {
  const [branch] = await sql`
    SELECT id, name, head_id, created_at, updated_at
    FROM charcoal.branches
    WHERE id = ${id}
  `;

  if (!branch) return null;

  return {
    id: branch.id,
    name: branch.name,
    headId: branch.head_id,
    createdAt: branch.created_at,
    updatedAt: branch.updated_at,
  };
}

/**
 * Merge a source branch into a target branch using the specified strategy.
 * Fast-forward: copies source-only messages into the target, then creates a merge message.
 */
export async function mergeBranch(data: {
  targetBranchId: string;
  sourceBranchId: string;
  strategy: string;
}): Promise<{ mergeMessage: { id: string; role: string; content: string }; mergedCount: number }> {
  const { targetBranchId, sourceBranchId, strategy } = data;

  if (strategy !== "fast-forward") {
    throw Object.assign(new Error(`Unknown merge strategy: ${strategy}`), { code: "UNKNOWN_STRATEGY" });
  }

  if (targetBranchId === sourceBranchId) {
    throw Object.assign(new Error("Cannot merge a branch into itself"), { code: "SELF_MERGE" });
  }

  const [targetBranch] = await sql`
    SELECT id, name, head_id FROM charcoal.branches WHERE id = ${targetBranchId}
  `;
  if (!targetBranch) {
    throw Object.assign(new Error("Target branch not found"), { code: "TARGET_NOT_FOUND" });
  }

  const [sourceBranch] = await sql`
    SELECT id, name, head_id FROM charcoal.branches WHERE id = ${sourceBranchId}
  `;
  if (!sourceBranch) {
    throw Object.assign(new Error("Source branch not found"), { code: "SOURCE_NOT_FOUND" });
  }

  // Walk source branch's head backward, collecting messages that belong to the source branch.
  // Stop when we hit a message from a different branch (the fork point).
  const sourceMessages = await sql`
    WITH RECURSIVE chain AS (
      SELECT id, parent_id, branch_id, role, content, created_at, 1 AS depth
      FROM charcoal.messages
      WHERE id = ${sourceBranch.head_id}

      UNION ALL

      SELECT m.id, m.parent_id, m.branch_id, m.role, m.content, m.created_at, c.depth + 1
      FROM charcoal.messages m
      JOIN chain c ON m.id = c.parent_id
      WHERE c.branch_id = ${sourceBranchId}
    )
    SELECT id, parent_id, role, content
    FROM chain
    WHERE branch_id = ${sourceBranchId}
    ORDER BY depth DESC
  `;

  // Copy each source message into the target branch, maintaining parent chain.
  // The first copied message's parent is the target branch's current head.
  let currentParentId: string | null = targetBranch.head_id;
  const idMap = new Map<string, string>(); // old id -> new id

  for (const msg of sourceMessages) {
    const [copied] = await sql`
      INSERT INTO charcoal.messages (branch_id, parent_id, role, content)
      VALUES (${targetBranchId}, ${currentParentId}, ${msg.role}, ${msg.content})
      RETURNING id
    `;
    idMap.set(msg.id, copied.id);
    currentParentId = copied.id;
  }

  // Create synthetic merge message
  const mergeContent = `Merged branch '${sourceBranch.name}' into '${targetBranch.name}'`;
  const [mergeMsg] = await sql`
    INSERT INTO charcoal.messages (branch_id, parent_id, role, content)
    VALUES (${targetBranchId}, ${currentParentId}, 'system', ${mergeContent})
    RETURNING id, role, content
  `;

  // Update target branch head
  await sql`
    UPDATE charcoal.branches
    SET head_id = ${mergeMsg.id}
    WHERE id = ${targetBranchId}
  `;

  return {
    mergeMessage: { id: mergeMsg.id, role: mergeMsg.role, content: mergeMsg.content },
    mergedCount: sourceMessages.length,
  };
}

/**
 * Get or create the default "main" branch.
 * Used when a message is appended without specifying a branch.
 */
export async function getOrCreateMainBranch(): Promise<{ id: string; name: string; headId: string | null }> {
  const [existing] = await sql`
    SELECT id, name, head_id FROM charcoal.branches WHERE name = 'main' LIMIT 1
  `;

  if (existing) {
    return { id: existing.id, name: existing.name, headId: existing.head_id };
  }

  const [created] = await sql`
    INSERT INTO charcoal.branches (name)
    VALUES ('main')
    RETURNING id, name, head_id
  `;

  return { id: created.id, name: created.name, headId: created.head_id };
}
