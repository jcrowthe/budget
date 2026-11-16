import { expect, test } from "./fixtures";
import { authHeaders, testName } from "./support/auth";

const CLIENT_ID = process.env.PLAID_CLIENT_ID;
const SECRET = process.env.PLAID_SANDBOX_SECRET;

type Json = Record<string, any>;

// A real round trip against Plaid Sandbox, with no browser. Never prints a token or a credential.
test.skip(
  !CLIENT_ID || !SECRET,
  "Plaid Sandbox credentials are not in the environment: real round trip skipped",
);

test("real Sandbox: two connections to the same bank, search and popular", async ({ request }) => {
  const headers = await authHeaders();
  const put = await request.put("/api/v1/plaid/credentials", {
    headers,
    data: { environment: "sandbox", client_id: CLIENT_ID, secret: SECRET },
  });
  expect(put.status()).toBe(200);
  const plan = (
    await (
      await request.post("/api/v1/budgets", {
        headers,
        data: { name: testName("sandbox"), bank_environment: "sandbox" },
      })
    ).json()
  ).data.budget.id as string;

  const created: Json[] = [];
  for (let i = 0; i < 2; i++) {
    const pt = await fetch("https://sandbox.plaid.com/sandbox/public_token/create", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "PLAID-CLIENT-ID": CLIENT_ID ?? "",
        "PLAID-SECRET": SECRET ?? "",
      },
      body: JSON.stringify({ institution_id: "ins_109508", initial_products: ["transactions"] }),
    });
    expect(pt.status).toBe(200);
    const { public_token } = (await pt.json()) as { public_token: string };
    const res = await request.post("/api/v1/bank-connections", {
      headers,
      data: { budget_id: plan, public_token, institution_id: "ins_109508" },
    });
    expect(res.status()).toBe(201);
    created.push((await res.json()).data.bank_connection);
  }

  const list = (
    await (await request.get(`/api/v1/bank-connections?budget_id=${plan}`, { headers })).json()
  ).data.bank_connections as Json[];
  const mine = list.filter((c) => created.some((x) => x.id === c.id));
  expect(mine).toHaveLength(2);
  expect(new Set(mine.map((c) => c.display_id)).size).toBe(2);
  for (const c of mine) {
    expect(c).toMatchObject({ status: "connected", provider: "Plaid", environment: "sandbox" });
    expect(c.display_id).toMatch(/^[0-9a-f]{6}$/);
    expect(c.accounts.length).toBeGreaterThan(0);
    for (const a of c.accounts as Json[]) {
      expect(a.mask === null || typeof a.mask === "string").toBe(true);
      if (a.current_balance !== null) expect(Number.isInteger(a.current_balance)).toBe(true);
    }
  }
  const text = JSON.stringify(list);
  expect(text.includes("access-sandbox")).toBe(false);
  expect(text.includes("public-sandbox")).toBe(false);

  const search = await request.get(`/api/v1/institutions?budget_id=${plan}&query=plat`, {
    headers,
  });
  expect(search.status()).toBe(200);
  expect(((await search.json()).data.institutions as Json[]).length).toBeLessThanOrEqual(10);
  const popular = await request.get(`/api/v1/institutions/popular?budget_id=${plan}`, { headers });
  expect(((await popular.json()).data.institutions as Json[]).map((i) => i.institution_id)).toEqual(
    ["ins_109508", "ins_109509", "ins_109510", "ins_109511", "ins_109512"],
  );
});
