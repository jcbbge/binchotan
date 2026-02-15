/**
 * Message Routes
 *
 * REST endpoints for message append and context retrieval.
 */

import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { appendMessage } from "../services/messages.ts";

const appendMessageSchema = z.object({
  branchId: z.string().uuid().optional(),
  parentId: z.string().uuid().optional(),
  role: z.enum(["user", "assistant"]),
  content: z.string().min(1).max(100000),
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

export default messages;
