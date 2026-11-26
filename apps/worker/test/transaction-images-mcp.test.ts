import { describe, expect, it } from "vitest";
import { account, get, type Json, plan, q, tool as rpc, tx } from "./bulk-helpers";
import { getImage, JPEG, objects, PNG, toBase64 } from "./transaction-images-helpers";

const tool = async (name: string, args: unknown): Promise<Json> => (await rpc(name, args)).result;

async function seed() {
  const b = await plan();
  const a = await account(b, "checking", 0);
  return { b, t: (await tx(b, { account_id: a, date: "2026-11-10", amount: -5000 })).id as string };
}

describe("transaction images: MCP (EXF-536)", () => {
  it("attaches and deletes with the mcp actor", async () => {
    const { b, t } = await seed();
    const r = await tool("attach_transaction_image", {
      budget_id: b,
      transaction_id: t,
      content_base64: toBase64(PNG),
      content_type: "image/png",
    });
    expect(r.isError).toBeFalsy();
    expect(r.structuredContent.image).toMatchObject({
      transaction_id: t,
      content_type: "image/png",
      byte_size: PNG.length,
    });
    expect((await get(b, t)).has_image).toBe(true);
    expect((await getImage(b, t)).status).toBe(200);
    const d = await tool("delete_transaction_image", { budget_id: b, transaction_id: t });
    expect(d.structuredContent).toEqual({ transaction_id: t, deleted: true });
    expect((await get(b, t)).has_image).toBe(false);
    const rows = await q(
      "select actor, action from change_log where entity_type = 'transaction_image' and entity_id = ? order by created_at",
      t,
    );
    expect(rows.map((x) => x.action)).toEqual(["create", "delete"]);
    expect(rows.every((x) => String(x.actor).startsWith("mcp:"))).toBe(true);
  });

  it("rejects a bad content_type, mismatched bytes, bad base64 and a too-large file", async () => {
    const { b, t } = await seed();
    const base = { budget_id: b, transaction_id: t };
    const bad = [
      { content_base64: toBase64(PNG), content_type: "application/pdf" },
      { content_base64: toBase64(JPEG), content_type: "image/png" },
      { content_base64: "***not base64***", content_type: "image/png" },
      { content_base64: toBase64(new Uint8Array(10 * 1024 * 1024 + 1)), content_type: "image/png" },
    ];
    for (const args of bad) {
      const body = await rpc("attach_transaction_image", { ...base, ...args });
      // a schema failure is a JSON-RPC error; a service refusal is a tool result with isError
      expect(body.error !== undefined || body.result?.isError === true).toBe(true);
    }
    expect((await get(b, t)).has_image).toBe(false);
    expect(await objects(b)).toHaveLength(0);
  });
});
