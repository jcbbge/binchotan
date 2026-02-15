/**
 * Branch Routes
 *
 * REST endpoints for branch management.
 */

import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { createBranch, listBranches, getBranch } from "../services/branches.ts";

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

export default branches;
