/**
 * Message Routes
 *
 * REST endpoints for message append and context retrieval.
 */

import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { appendMessage, toggleAnchor } from "../services/messages.ts";
import { assembleLens } from "../services/lens.ts";

const contextQuerySchema = z.object({
  branchId: z.string().uuid(),
  messageId: z.string().uuid().optional(),
});

const appendMessageSchema = z.object({
  branchId: z.string().uuid().optional(),
  parentId: z.string().uuid().optional(),
  role: z.enum(["user", "assistant"]),
  content: z.string().min(1).max(100000),
});

const toggleAnchorSchema = z.object({
  isAnchor: z.boolean(),
});

const messages = new Hono();

// POST /api/messages — append a message and return context
messages.post(
  "/",
  zValidator("json", appendMessageSchema, (result, c) => {
    if (!result.success) {
      return c.json({ success: false, error: { code: "VALIDATION_ERROR", message: "Request validation failed" } }, 400);
    }
  }),
  async (c) => {
    try {
      const data = c.req.valid("json");
      const result = await appendMessage(data);
      return c.json({ success: true, data: result }, 201);
    } catch (error) {
      console.error("Error appending message:", error);
      return c.json(
        { success: false, error: { code: "MESSAGE_APPEND_ERROR", message: (error as Error).message } },
        500,
      );
    }
  },
);

// PATCH /api/messages/:id — toggle anchor status on a message
messages.patch(
  "/:id",
  zValidator("json", toggleAnchorSchema, (result, c) => {
    if (!result.success) {
      return c.json({ success: false, error: { code: "VALIDATION_ERROR", message: "isAnchor (boolean) is required" } }, 400);
    }
  }),
  async (c) => {
    try {
      const id = c.req.param("id");
      const { isAnchor } = c.req.valid("json");
      const result = await toggleAnchor(id, isAnchor);
      return c.json({ success: true, data: result });
    } catch (error) {
      console.error("Error toggling anchor:", error);
      return c.json(
        { success: false, error: { code: "ANCHOR_TOGGLE_ERROR", message: (error as Error).message } },
        500,
      );
    }
  },
);

// GET /api/context — standalone context retrieval
const context = new Hono();

context.get(
  "/",
  zValidator("query", contextQuerySchema, (result, c) => {
    if (!result.success) {
      return c.json({ success: false, error: { code: "VALIDATION_ERROR", message: "branchId is required and must be a valid UUID" } }, 400);
    }
  }),
  async (c) => {
    try {
      const { branchId, messageId } = c.req.valid("query");
      const contextMessages = await assembleLens(branchId, messageId);
      return c.json({ success: true, data: { branchId, messageId: messageId ?? null, context: contextMessages } });
    } catch (error) {
      console.error("Error getting context:", error);
      return c.json(
        { success: false, error: { code: "CONTEXT_ERROR", message: (error as Error).message } },
        500,
      );
    }
  },
);

export { context as contextRoutes };
export default messages;
