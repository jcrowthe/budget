import {
  IMAGE_CONTENT_TYPES,
  MAX_IMAGE_BYTES,
  type TransactionImage,
} from "@budget/schema/transaction-images";
import { z } from "zod";
import {
  attachTransactionImage,
  deleteTransactionImage,
  ImageRefused,
} from "../../services/transaction-images";
import { Id, timestamps } from "../tool-text";
import type { McpToolDef } from "../types";

function fromBase64(text: string): Uint8Array {
  // 4 base64 characters carry 3 bytes: refuse an oversize text before decoding it.
  if (text.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4 + 4) {
    throw new Error("file_too_large: The image is larger than 10 MB");
  }
  try {
    const bin = atob(text);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    throw new Error("content_base64 is not valid base64");
  }
}

/** A refused upload is a tool error carrying the code and the message. */
const toolError = (e: unknown): Error =>
  e instanceof ImageRefused
    ? new Error(`${e.code}: ${e.message}`)
    : e instanceof Error
      ? e
      : new Error(String(e));

export const tools: McpToolDef[] = [
  {
    name: "attach_transaction_image",
    description: `Attach one image (a receipt) to a transaction, replacing any image already attached. The bytes are sent as content_base64 with their content_type (${IMAGE_CONTENT_TYPES.join(", ")}); at most 10 MB, and the bytes must really be that type. Not undoable. Returns { image: { transaction_id, content_type, byte_size, file_name, created_at } }. Transactions report has_image. ${timestamps(["created_at"])}`,
    inputSchema: z.object({
      budget_id: Id,
      transaction_id: Id,
      content_base64: z.string().min(1).describe("The image's bytes, base64"),
      content_type: z.enum(IMAGE_CONTENT_TYPES).describe("The image's type"),
    }),
    run: async (
      input: {
        budget_id: string;
        transaction_id: string;
        content_base64: string;
        content_type: string;
      },
      { env, actor },
    ) => {
      try {
        const image: TransactionImage = await attachTransactionImage(env, actor, {
          budgetId: input.budget_id,
          transactionId: input.transaction_id,
          bytes: fromBase64(input.content_base64),
          contentType: input.content_type,
          fileName: null,
        });
        return { image };
      } catch (e) {
        throw toolError(e);
      }
    },
  },
  {
    name: "delete_transaction_image",
    description:
      "Delete a transaction's image. Not undoable. Returns { transaction_id, deleted: true }; an error when the transaction has no image.",
    inputSchema: z.object({ budget_id: Id, transaction_id: Id }),
    run: async (input: { budget_id: string; transaction_id: string }, { env, actor }) =>
      deleteTransactionImage(env, actor, {
        budgetId: input.budget_id,
        transactionId: input.transaction_id,
      }),
  },
];
