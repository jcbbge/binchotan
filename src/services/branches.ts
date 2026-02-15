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
