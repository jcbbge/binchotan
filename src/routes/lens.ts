/**
 * Lens Routes
 *
 * REST endpoints for lens configuration (per-branch or global default).
 */

import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { sql } from "../config.ts";

const lensConfigQuerySchema = z.object({
  branchId: z.string().uuid().optional(),
});

const lensConfigUpdateSchema = z.object({
  branchId: z.string().uuid().optional(),
  recencyLimit: z.number().int().min(1).max(1000).optional(),
  maxTokens: z.number().int().min(256).max(128000).optional(),
  includeAnchors: z.boolean().optional(),
  semanticLimit: z.number().int().min(0).max(100).optional(),
});

const lens = new Hono();

// GET /api/lens?branchId= — get lens config (branch-specific if exists, else global default)
lens.get(
  "/",
  zValidator("query", lensConfigQuerySchema, (result, c) => {
    if (!result.success) {
      return c.json(
        { success: false, error: { code: "VALIDATION_ERROR", message: "branchId must be a valid UUID" } },
        400,
      );
    }
  }),
  async (c) => {
    try {
      const { branchId } = c.req.valid("query");

      let row;
      if (branchId) {
        // Try branch-specific first
        [row] = await sql`
          SELECT id, branch_id, recency_limit, max_tokens, include_anchors, semantic_limit, created_at, updated_at
          FROM charcoal.lens_config
          WHERE branch_id = ${branchId}
        `;
      }

      // Fall back to global default
      if (!row) {
        [row] = await sql`
          SELECT id, branch_id, recency_limit, max_tokens, include_anchors, semantic_limit, created_at, updated_at
          FROM charcoal.lens_config
          WHERE branch_id IS NULL
        `;
      }

      if (!row) {
        return c.json({
          success: true,
          data: {
            branchId: branchId ?? null,
            recencyLimit: 20,
            maxTokens: 4096,
            includeAnchors: true,
            semanticLimit: 5,
            source: "hardcoded",
          },
        });
      }

      return c.json({
        success: true,
        data: {
          id: row.id,
          branchId: row.branch_id ?? null,
          recencyLimit: row.recency_limit,
          maxTokens: row.max_tokens,
          includeAnchors: row.include_anchors,
          semanticLimit: row.semantic_limit,
          source: row.branch_id ? "branch" : "global",
          createdAt: row.created_at,
          updatedAt: row.updated_at,
        },
      });
    } catch (error) {
      console.error("Error getting lens config:", error);
      return c.json(
        { success: false, error: { code: "LENS_CONFIG_ERROR", message: (error as Error).message } },
        500,
      );
    }
  },
);

// PUT /api/lens — upsert lens config
lens.put(
  "/",
  zValidator("json", lensConfigUpdateSchema, (result, c) => {
    if (!result.success) {
      return c.json(
        { success: false, error: { code: "VALIDATION_ERROR", message: "Request validation failed" } },
        400,
      );
    }
  }),
  async (c) => {
    try {
      const { branchId, recencyLimit, maxTokens, includeAnchors, semanticLimit } = c.req.valid("json");

      // Upsert: insert or update on branch_id conflict
      const [row] = await sql`
        INSERT INTO charcoal.lens_config (branch_id, recency_limit, max_tokens, include_anchors, semantic_limit)
        VALUES (
          ${branchId ?? null},
          ${recencyLimit ?? 20},
          ${maxTokens ?? 4096},
          ${includeAnchors ?? true},
          ${semanticLimit ?? 5}
        )
        ON CONFLICT ON CONSTRAINT uq_lens_config_branch
        DO UPDATE SET
          recency_limit = COALESCE(${recencyLimit ?? null}, charcoal.lens_config.recency_limit),
          max_tokens = COALESCE(${maxTokens ?? null}, charcoal.lens_config.max_tokens),
          include_anchors = COALESCE(${includeAnchors ?? null}, charcoal.lens_config.include_anchors),
          semantic_limit = COALESCE(${semanticLimit ?? null}, charcoal.lens_config.semantic_limit),
          updated_at = NOW()
        RETURNING id, branch_id, recency_limit, max_tokens, include_anchors, semantic_limit, created_at, updated_at
      `;

      return c.json({
        success: true,
        data: {
          id: row.id,
          branchId: row.branch_id ?? null,
          recencyLimit: row.recency_limit,
          maxTokens: row.max_tokens,
          includeAnchors: row.include_anchors,
          semanticLimit: row.semantic_limit,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
        },
      });
    } catch (error) {
      console.error("Error updating lens config:", error);
      return c.json(
        { success: false, error: { code: "LENS_CONFIG_ERROR", message: (error as Error).message } },
        500,
      );
    }
  },
);

export default lens;
