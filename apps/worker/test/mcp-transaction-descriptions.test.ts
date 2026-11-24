import { describe, expect, it } from "vitest";
import { mcpRpc } from "./surface";

async function descriptions() {
  await mcpRpc(
    "initialize",
    { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } },
    1,
  );
  const list = await mcpRpc("tools/list", {}, 2);
  const tools = (list.body.result?.tools ?? []) as unknown as {
    name: string;
    description: string;
  }[];
  return (name: string) => tools.find((t) => t.name === name)?.description ?? "";
}

describe("transaction tool descriptions name import_payee_name (EXF-885)", () => {
  it("all five name it", async () => {
    const d = await descriptions();
    for (const n of [
      "list_transactions",
      "get_transaction",
      "create_transaction",
      "update_transaction",
      "bulk_update_transactions",
    ])
      expect(d(n), n).toContain("import_payee_name");
  });

  it("list and get say what it is", async () => {
    const d = await descriptions();
    for (const n of ["list_transactions", "get_transaction"])
      expect(d(n)).toContain(
        "the name the bank import matched, as received; null when no import gave the row",
      );
  });

  it("update_transaction says a payee change writes the renaming rule", async () => {
    const t = (await descriptions())("update_transaction");
    expect(t).toContain("renaming rule");
    expect(t).toContain("`is <import_payee_name>` on the new payee");
    expect(t).toContain("every other payee's `is` rule for that name is removed");
    expect(t).toContain(
      "Setting the payee back to the payee named import_payee_name removes those rules",
    );
  });

  it("bulk_update_transactions says its ops write no renaming rule", async () => {
    expect((await descriptions())("bulk_update_transactions")).toContain(
      "none of these ops writes a renaming rule",
    );
  });
});
