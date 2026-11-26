import {
  IMAGE_CONTENT_TYPES,
  type ImageContentType,
  MAX_IMAGE_BYTES,
  sniffImageType,
  type TransactionImage,
} from "@budget/schema/transaction-images";
import { sql } from "drizzle-orm";
import { getDb } from "../db/client";
import type { Env } from "../env";
import { changeLogInsertIf } from "../history/change-log";
import { Conflict, describeError, NotFound } from "../middleware/errors";
import * as repo from "../repositories/transaction-images";

/** A rule of the image upload failed; the route answers `status` with `code` and this message. */
export class ImageRefused extends Error {
  constructor(
    public status: 413 | 415 | 422,
    public code: string,
    detail: string,
  ) {
    super(detail);
    this.name = "ImageRefused";
  }
}

export const imageToApi = (row: repo.ImageRow): TransactionImage => ({
  transaction_id: row.transactionId,
  content_type: row.contentType as ImageContentType,
  byte_size: row.byteSize,
  file_name: row.fileName,
  created_at: row.createdAt,
});

const HEX = "0123456789abcdef";
const randomHex = () =>
  Array.from(
    crypto.getRandomValues(new Uint8Array(16)),
    (b) => HEX.charAt(b >> 4) + HEX.charAt(b & 15),
  ).join("");

/** The key is scoped by plan and transaction and ends in 128 random bits, so it cannot be guessed. */
const keyFor = (budgetId: string, transactionId: string) =>
  ["transaction-images", budgetId, transactionId, randomHex()].join("/");

/** Checks the declared type, the size and the bytes; throws ImageRefused. */
export function checkImage(bytes: Uint8Array, contentType: string): ImageContentType {
  if (!(IMAGE_CONTENT_TYPES as readonly string[]).includes(contentType)) {
    throw new ImageRefused(
      415,
      "unsupported_media_type",
      `Send one of: ${IMAGE_CONTENT_TYPES.join(", ")}`,
    );
  }
  if (bytes.length > MAX_IMAGE_BYTES) {
    throw new ImageRefused(413, "file_too_large", "The image is larger than 10 MB");
  }
  if (bytes.length === 0) {
    throw new ImageRefused(422, "unprocessable_entity", "The image is empty");
  }
  if (sniffImageType(bytes) !== contentType) {
    throw new ImageRefused(415, "unsupported_media_type", `The file is not a ${contentType} image`);
  }
  return contentType as ImageContentType;
}

/** Read batch of a write: the plan, the live transaction, its live image and the rows to sweep. */
async function readState(env: Env, budgetId: string, transactionId: string) {
  const db = getDb(env);
  const [plan, tx, image, sweep] = await db.batch(repo.readForWrite(db, budgetId, transactionId));
  if (!plan.length) throw new NotFound("Plan");
  if (!tx.length) throw new NotFound("Transaction");
  return { db, current: image[0], sweep };
}

/** Deletes the objects of the rows to sweep; returns the ids whose object is gone. */
async function sweepObjects(env: Env, sweep: { id: string; r2Key: string }[]) {
  if (!sweep.length) return [];
  try {
    await env.FILES.delete(sweep.map((s) => s.r2Key));
    return sweep.map((s) => s.id);
  } catch (e) {
    console.error(`transaction image sweep failed: ${describeError(e)}`);
    return [];
  }
}

async function removeObject(env: Env, key: string) {
  try {
    await env.FILES.delete(key);
  } catch (e) {
    // The row stays soft-deleted with object_deleted_at null: the next image write of the plan retries it.
    console.error(`transaction image object delete failed: ${describeError(e)}`);
  }
}

export async function attachTransactionImage(
  env: Env,
  actor: string,
  input: {
    budgetId: string;
    transactionId: string;
    bytes: Uint8Array;
    contentType: string;
    fileName: string | null;
  },
): Promise<TransactionImage> {
  const { budgetId, transactionId } = input;
  const contentType = checkImage(input.bytes, input.contentType);
  const { db, current, sweep } = await readState(env, budgetId, transactionId);
  const swept = await sweepObjects(env, sweep);
  const now = new Date().toISOString();
  const row = {
    id: crypto.randomUUID(),
    budgetId,
    transactionId,
    r2Key: keyFor(budgetId, transactionId),
    contentType,
    byteSize: input.bytes.length,
    fileName: input.fileName,
    createdAt: now,
  };
  // The object lands first, so a live row never points at a missing object.
  await env.FILES.put(row.r2Key, input.bytes, { httpMetadata: { contentType } });
  const guard = repo.liveTransactionGuard(budgetId, transactionId);
  const after = imageToApi({ ...row, deletedAt: null, objectDeletedAt: null });
  let results: Awaited<ReturnType<typeof db.batch>>;
  try {
    const list = [
      ...(swept.length ? [repo.markObjectsDeletedStmt(db, JSON.stringify(swept), now)] : []),
      ...(current ? [repo.softDeleteIfStmt(db, current.id, now, guard)] : []),
      changeLogInsertIf(
        db,
        {
          budgetId,
          actor,
          action: current ? "update" : "create",
          entityType: "transaction_image",
          entityId: transactionId,
          before: current ? imageToApi(current) : null,
          after,
        },
        guard,
      ),
      repo.insertIfStmt(db, row, guard),
    ] as const;
    results = await db.batch(list as unknown as Parameters<typeof db.batch>[0]);
  } catch (e) {
    await removeObject(env, row.r2Key);
    if (String(e instanceof Error ? `${e.message} ${e.cause}` : e).includes("UNIQUE"))
      throw new Conflict("Transaction image");
    throw e;
  }
  if (((results[results.length - 1] as { meta: { changes: number } }).meta.changes ?? 0) === 0) {
    await removeObject(env, row.r2Key);
    throw new NotFound("Transaction");
  }
  if (current) await removeObject(env, current.r2Key);
  return after;
}

export async function deleteTransactionImage(
  env: Env,
  actor: string,
  input: { budgetId: string; transactionId: string },
): Promise<{ transaction_id: string; deleted: true }> {
  const { budgetId, transactionId } = input;
  const { db, current, sweep } = await readState(env, budgetId, transactionId);
  if (!current) throw new NotFound("Image");
  const swept = await sweepObjects(env, sweep);
  const now = new Date().toISOString();
  const guard = repo.liveTransactionGuard(budgetId, transactionId);
  const results = await db.batch([
    ...(swept.length ? [repo.markObjectsDeletedStmt(db, JSON.stringify(swept), now)] : []),
    changeLogInsertIf(
      db,
      {
        budgetId,
        actor,
        action: "delete",
        entityType: "transaction_image",
        entityId: transactionId,
        before: imageToApi(current),
        after: null,
      },
      sql`(select 1 where exists ${repo.liveImageGuard(current.id)} and exists ${guard})`,
    ),
    repo.softDeleteIfStmt(db, current.id, now, guard),
  ] as unknown as Parameters<typeof db.batch>[0]);
  if ((results[results.length - 1] as { meta: { changes: number } }).meta.changes === 0)
    throw new NotFound("Image");
  await removeObject(env, current.r2Key);
  return { transaction_id: transactionId, deleted: true };
}

export interface ImageStream {
  body: ReadableStream;
  contentType: string;
  size: number;
  etag: string;
  fileName: string | null;
}

/** The image to stream, "not_modified" when `ifNoneMatch` names its current ETag. */
export async function getTransactionImage(
  env: Env,
  input: { budgetId: string; transactionId: string; ifNoneMatch?: string | null },
): Promise<ImageStream | "not_modified"> {
  const row = await repo.findLive(getDb(env), input.budgetId, input.transactionId);
  if (!row) throw new NotFound("Image");
  const tag = input.ifNoneMatch?.trim().replace(/^W\//, "").replace(/^"|"$/g, "");
  const obj = await env.FILES.get(
    row.r2Key,
    tag ? { onlyIf: { etagDoesNotMatch: tag } } : undefined,
  );
  if (!obj) throw new NotFound("Image");
  if (!("body" in obj)) return "not_modified";
  return {
    body: obj.body,
    contentType: row.contentType,
    size: row.byteSize,
    etag: obj.httpEtag,
    fileName: row.fileName,
  };
}
