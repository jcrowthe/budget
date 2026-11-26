import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { account, actor, get, type Json, plan, q, send, tx } from "./bulk-helpers";
import { apiPaths, listedToolNames } from "./surface";
import {
  AVIF,
  del,
  GIF,
  getImage,
  imagesUrl,
  JPEG,
  objects,
  PNG,
  put,
  SVG,
  TEXT,
  WEBP,
} from "./transaction-images-helpers";
import { undo } from "./undo-helpers";

async function seed() {
  const b = await plan();
  const a = await account(b, "checking", 0);
  const t = await tx(b, { account_id: a, date: "2026-11-10", amount: -5000 });
  return { b, a, t: t.id as string };
}
const bytesOf = async (res: Response) => new Uint8Array(await res.arrayBuffer());

describe("transaction images: REST (EXF-536)", () => {
  it("attach, read, has_image on every read, delete", async () => {
    const { b, a, t } = await seed();
    expect((await get(b, t)).has_image).toBe(false);
    const res = await put(b, t, PNG, "image/png", "r.png");
    expect(res.status).toBe(200);
    const body = (await res.json()) as Json;
    expect(body.data).toMatchObject({
      transaction_id: t,
      content_type: "image/png",
      byte_size: PNG.length,
      file_name: "r.png",
    });
    expect(JSON.stringify(body)).not.toContain("r2_key");
    const g = await getImage(b, t);
    expect(g.status).toBe(200);
    expect(g.headers.get("content-type")).toBe("image/png");
    expect(g.headers.get("x-content-type-options")).toBe("nosniff");
    expect(await bytesOf(g)).toEqual(PNG);

    expect((await get(b, t)).has_image).toBe(true);
    const acct = (await (
      await send(`/api/v1/budgets/${b}/accounts/${a}/transactions`, "GET")
    ).json()) as Json;
    expect(acct.data.transactions.find((x: Json) => x.id === t).has_image).toBe(true);
    const rb = (await (
      await send(`/api/v1/budgets/${b}/accounts/${a}/transactions?include=running_balance`, "GET")
    ).json()) as Json;
    expect(rb.data.transactions.find((x: Json) => x.id === t).has_image).toBe(true);
    const all = (await (await send(`/api/v1/budgets/${b}/transactions`, "GET")).json()) as Json;
    expect(all.data.transactions.find((x: Json) => x.id === t).has_image).toBe(true);

    const d = await del(b, t);
    expect(d.status).toBe(200);
    expect(((await d.json()) as Json).data).toEqual({ transaction_id: t, deleted: true });
    expect((await getImage(b, t)).status).toBe(404);
    expect((await get(b, t)).has_image).toBe(false);
    expect((await del(b, t)).status).toBe(404);
  });

  it("answers 304 for a matching ETag", async () => {
    const { b, t } = await seed();
    await put(b, t, PNG);
    const first = await getImage(b, t);
    const etag = first.headers.get("etag") as string;
    expect(etag).toBeTruthy();
    await first.arrayBuffer();
    expect((await getImage(b, t, { "If-None-Match": etag })).status).toBe(304);
  });

  it("accepts each of the six types", async () => {
    const { b, t } = await seed();
    for (const [bytes, type] of [
      [PNG, "image/png"],
      [JPEG, "image/jpeg"],
      [GIF, "image/gif"],
      [WEBP, "image/webp"],
      [AVIF, "image/avif"],
      [SVG, "image/svg+xml"],
    ] as const) {
      expect((await put(b, t, bytes, type)).status).toBe(200);
      const g = await getImage(b, t);
      expect(g.headers.get("content-type")).toBe(type);
      await g.arrayBuffer();
    }
  });

  it("refuses a non-image with 415 and an over-10 MB file with 413 (Acc. 6)", async () => {
    const { b, t } = await seed();
    expect((await put(b, t, TEXT, "text/plain", "a.txt")).status).toBe(415);
    expect((await put(b, t, TEXT, "image/png")).status).toBe(415);
    expect((await put(b, t, PNG, "application/pdf", "a.pdf")).status).toBe(415);
    expect((await put(b, t, JPEG, "image/png")).status).toBe(415);
    const big = new Uint8Array(10 * 1024 * 1024 + 1);
    big.set(PNG);
    const res = await put(b, t, big, "image/png");
    expect(res.status).toBe(413);
    expect(((await res.json()) as Json).error.name).toBe("file_too_large");
    expect((await put(b, t, new Uint8Array(0), "image/png")).status).toBe(422);
    expect((await get(b, t)).has_image).toBe(false);
    expect(await objects()).toHaveLength(0);
  });

  it("answers 404 for a missing, split-line, deleted or foreign transaction", async () => {
    const { b, a, t } = await seed();
    expect((await put(b, "nope", PNG)).status).toBe(404);
    const other = await seed();
    expect((await put(b, other.t, PNG)).status).toBe(404);
    const cat = (await (await send(`/api/v1/budgets/${b}/categories`, "GET")).json()) as Json;
    void cat;
    const split = await send(`/api/v1/budgets/${b}/transactions`, "POST", {
      account_id: a,
      date: "2026-11-10",
      amount: -3000,
      subtransactions: [{ amount: -1000 }, { amount: -2000 }],
    });
    if (split.status === 201) {
      const lines = ((await split.json()) as Json).data.transaction.subtransactions as Json[];
      expect((await put(b, lines[0]?.id, PNG)).status).toBe(404);
    }
    expect((await send(`/api/v1/budgets/${b}/transactions/${t}`, "DELETE")).status).toBe(200);
    expect((await put(b, t, PNG)).status).toBe(404);
    expect((await getImage(b, t)).status).toBe(404);
    const p2 = await seed();
    expect((await send(`/api/v1/budgets/${p2.b}`, "DELETE")).status).toBeLessThan(300);
    expect((await put(p2.b, p2.t, PNG)).status).toBe(404);
  });

  it("a replace soft-deletes the first row and removes its object", async () => {
    const { b, t } = await seed();
    await put(b, t, PNG);
    const [first] = await objects();
    await put(b, t, JPEG, "image/jpeg", "b.jpg");
    const rows = await q(
      "select deleted_at, content_type from transaction_images where transaction_id = ? order by created_at",
      t,
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]?.deleted_at).not.toBeNull();
    expect(rows[1]?.deleted_at).toBeNull();
    expect(await env.FILES.get(first?.key as string)).toBeNull();
    expect(await objects()).toHaveLength(1);
    const g = await getImage(b, t);
    expect(g.headers.get("content-type")).toBe("image/jpeg");
    await g.arrayBuffer();
  });

  it("a transaction delete keeps the object and undo brings the image back", async () => {
    const { b, t } = await seed();
    await put(b, t, PNG);
    const res = await send(`/api/v1/budgets/${b}/transactions/${t}`, "DELETE");
    expect(res.status).toBe(200);
    const set = res.headers.get("Budget-Change-Set") as string;
    expect(await objects()).toHaveLength(1);
    expect((await undo(b, set)).status).toBe(200);
    expect((await get(b, t)).has_image).toBe(true);
    expect((await getImage(b, t)).status).toBe(200);
  });

  it("undo of an attach is refused", async () => {
    const { b, t } = await seed();
    const res = await put(b, t, PNG);
    const r = await undo(b, res.headers.get("Budget-Change-Set") as string);
    expect(r.status).toBe(409);
    expect(r.body.error.name).toBe("undo_refused");
  });

  it("each write logs one change_log row with its actor and change set (Acc. 7)", async () => {
    const { b, t } = await seed();
    const a1 = await put(b, t, PNG);
    const a2 = await put(b, t, JPEG, "image/jpeg");
    const d = await del(b, t);
    const rows = await q(
      "select action, actor, change_set_id, before_json, after_json from change_log where entity_type = 'transaction_image' and entity_id = ? order by created_at",
      t,
    );
    expect(rows.map((r) => r.action)).toEqual(["create", "update", "delete"]);
    expect(rows.every((r) => r.actor === actor)).toBe(true);
    expect(rows.map((r) => r.change_set_id)).toEqual(
      [a1, a2, d].map((r) => r.headers.get("Budget-Change-Set")),
    );
    expect(rows.map((r) => `${r.before_json}${r.after_json}`).join("")).not.toContain(
      "transaction-images/",
    );
  });

  it("is listed in the API and tools", async () => {
    expect(await apiPaths()).toEqual(
      expect.arrayContaining(["/api/v1/budgets/{budget_id}/transactions/{transaction_id}/image"]),
    );
    expect(await listedToolNames()).toEqual(
      expect.arrayContaining(["attach_transaction_image", "delete_transaction_image"]),
    );
    expect(imagesUrl("a", "b")).toContain("/image");
  });
});
