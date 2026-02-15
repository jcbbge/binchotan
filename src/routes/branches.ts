/**
 * Branch Routes
 *
 * REST endpoints for branch management.
 */

import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { createBranch, listBranches, getBranch, mergeBranch } from "../services/branches.ts";

const createBranchSchema = z.object({
  name: z.string().min(1).max(200),
  sourceBranchId: z.string().uuid().optional(),
  sourceMessageId: z.string().uuid().optional(),
});

const branches = new Hono();

// POST /api/branches — create a new branch
branches.post(
  "/",
  zValidator("json", createBranchSchema, (result, c) => {
    if (!result.success) {
      return c.json({ success: false, error: { code: "VALIDATION_ERROR", message: "Request validation failed" } }, 400);
    }
  }),
  async (c) => {
    try {
      const data = c.req.valid("json");
      const branch = await createBranch(data);
      return c.json({ success: true, data: branch }, 201);
    } catch (error) {
      console.error("Error creating branch:", error);
      return c.json(
        { success: false, error: { code: "BRANCH_CREATE_ERROR", message: (error as Error).message } },
        500,
      );
    }
  },
);

// GET /api/branches — list all branches
branches.get("/", async (c) => {
  try {
    const data = await listBranches();
    return c.json({ success: true, data });
  } catch (error) {
    console.error("Error listing branches:", error);
    return c.json(
      { success: false, error: { code: "BRANCH_LIST_ERROR", message: (error as Error).message } },
      500,
    );
  }
});

// GET /api/branches/:id — get a single branch
branches.get("/:id", async (c) => {
  try {
    const id = c.req.param("id");
    const branch = await getBranch(id);
    if (!branch) {
      return c.json({ success: false, error: { code: "NOT_FOUND", message: "Branch not found" } }, 404);
    }
    return c.json({ success: true, data: branch });
  } catch (error) {
    console.error("Error getting branch:", error);
    return c.json(
      { success: false, error: { code: "BRANCH_GET_ERROR", message: (error as Error).message } },
      500,
    );
  }
});

// POST /api/branches/:id/merge — merge a source branch into this branch
const mergeBranchSchema = z.object({
  sourceBranchId: z.string().uuid(),
  strategy: z.enum(["fast-forward"]).default("fast-forward"),
});

branches.post(
  "/:id/merge",
  zValidator("json", mergeBranchSchema, (result, c) => {
    if (!result.success) {
      return c.json({ success: false, error: { code: "VALIDATION_ERROR", message: "Request validation failed" } }, 400);
    }
  }),
  async (c) => {
    try {
      const targetBranchId = c.req.param("id");
      const { sourceBranchId, strategy } = c.req.valid("json");
      const result = await mergeBranch({ targetBranchId, sourceBranchId, strategy });
      return c.json({ success: true, data: result });
    } catch (error) {
      const err = error as Error & { code?: string };
      console.error("Error merging branch:", err);

      if (err.code === "TARGET_NOT_FOUND" || err.code === "SOURCE_NOT_FOUND") {
        return c.json({ success: false, error: { code: "NOT_FOUND", message: err.message } }, 404);
      }
      if (err.code === "SELF_MERGE" || err.code === "UNKNOWN_STRATEGY") {
        return c.json({ success: false, error: { code: err.code, message: err.message } }, 400);
      }

      return c.json(
        { success: false, error: { code: "MERGE_ERROR", message: err.message } },
        500,
      );
    }
  },
);

export default branches;
