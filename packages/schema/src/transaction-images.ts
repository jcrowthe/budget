import { z } from "@hono/zod-openapi";
import { dataEnvelope } from "./common/envelope";

export const IMAGE_CONTENT_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/avif",
  "image/gif",
  "image/svg+xml",
] as const;
export type ImageContentType = (typeof IMAGE_CONTENT_TYPES)[number];

/** The largest image: 10 MiB. */
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

/** The `accept` attribute of the file chooser. */
export const IMAGE_ACCEPT = IMAGE_CONTENT_TYPES.join(",");

export const TransactionImage = z
  .object({
    transaction_id: z.string(),
    content_type: z.enum(IMAGE_CONTENT_TYPES),
    byte_size: z.number().int(),
    file_name: z.string().nullable(),
    created_at: z.string(),
  })
  .openapi("TransactionImage");
export type TransactionImage = z.infer<typeof TransactionImage>;

export const TransactionImageResponse = dataEnvelope(TransactionImage).openapi(
  "TransactionImageResponse",
);

export const DeleteTransactionImageResponse = dataEnvelope(
  z.object({ transaction_id: z.string(), deleted: z.literal(true) }),
).openapi("DeleteTransactionImageResponse");

const startsWith = (b: Uint8Array, at: number, text: string) =>
  b.length >= at + text.length && [...text].every((c, i) => b[at + i] === c.charCodeAt(0));

/** SVG: text whose first element is `<svg`, after an optional BOM, XML prolog, comments and doctype. */
function isSvg(bytes: Uint8Array): boolean {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
      bytes.subarray(0, 4096),
    );
  } catch {
    return false;
  }
  let rest = text.replace(/^﻿/, "");
  for (;;) {
    rest = rest.trimStart();
    const skip = /^(<\?[\s\S]*?\?>|<!--[\s\S]*?-->|<!DOCTYPE[^>[]*(\[[\s\S]*?\])?\s*>)/i.exec(rest);
    if (!skip) break;
    rest = rest.slice(skip[0].length);
  }
  return /^<svg[\s>/]/i.test(rest);
}

/** The type the bytes really are (magic numbers; SVG by its first element), or null for anything else. */
export function sniffImageType(bytes: Uint8Array): ImageContentType | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
    return "image/jpeg";
  if (
    bytes.length >= 8 &&
    [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((v, i) => bytes[i] === v)
  )
    return "image/png";
  if (startsWith(bytes, 0, "GIF87a") || startsWith(bytes, 0, "GIF89a")) return "image/gif";
  if (startsWith(bytes, 0, "RIFF") && startsWith(bytes, 8, "WEBP")) return "image/webp";
  if (
    startsWith(bytes, 4, "ftyp") &&
    (startsWith(bytes, 8, "avif") || startsWith(bytes, 8, "avis"))
  )
    return "image/avif";
  if (isSvg(bytes)) return "image/svg+xml";
  return null;
}
