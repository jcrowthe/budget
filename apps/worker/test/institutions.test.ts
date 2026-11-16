import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { deleteSecret, setSecret } from "../src/secrets";
import { json } from "./helpers";
import { createPlan, SENTINEL, seedSandboxCredentials, stubPlaid } from "./plaid-stub";
import { apiPaths } from "./surface";

type Json = Record<string, any>;
const plaidIns = (i: number, extra: Json = {}) => ({
  institution_id: `ins_${i}`,
  name: `ZZ Bank ${i}`,
  country_codes: ["US"],
  url: `www.zz${i}.example`,
  logo: i % 2 === 0 ? "AAAA" : null,
  ...extra,
});

describe("institutions", () => {
  beforeEach(async () => {
    await seedSandboxCredentials();
  });

  it("is in the API surface", async () => {
    expect(await apiPaths()).toEqual(
      expect.arrayContaining(["/api/v1/institutions", "/api/v1/institutions/popular"]),
    );
  });

  it("searches Sandbox with the credentials in headers and returns at most 10", async () => {
    const plan = await createPlan("sandbox");
    const calls = stubPlaid({
      "/institutions/search": () => ({
        body: { institutions: Array.from({ length: 12 }, (_, i) => plaidIns(i)) },
      }),
    });
    const res = await json(`/api/v1/institutions?budget_id=${plan}&query=plat`);
    expect(res.status).toBe(200);
    const list = ((await res.json()) as Json).data.institutions as Json[];
    expect(list).toHaveLength(10);
    expect(list[0]).toEqual({
      institution_id: "ins_0",
      name: "ZZ Bank 0",
      country: "United States",
      url: "www.zz0.example",
      logo: "data:image/png;base64,AAAA",
    });
    expect(list[1]?.logo).toBeNull();
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://sandbox.plaid.com/institutions/search");
    expect(calls[0]?.body).toEqual({
      query: "plat",
      products: ["transactions"],
      country_codes: ["US"],
      options: { include_optional_metadata: true },
    });
    expect(calls[0]?.headers["plaid-client-id"]).toBe(SENTINEL.clientId);
    expect(calls[0]?.headers["plaid-secret"]).toBe(SENTINEL.secret);
  });

  it("popular keeps the list order and skips an id Plaid refuses", async () => {
    const plan = await createPlan("sandbox");
    stubPlaid({
      "/institutions/get_by_id": (b) =>
        b.institution_id === "ins_109510"
          ? { status: 400, body: { error_code: "INVALID_INSTITUTION", display_message: null } }
          : { body: { institution: plaidIns(1, { institution_id: b.institution_id }) } },
    });
    const res = await json(`/api/v1/institutions/popular?budget_id=${plan}`);
    const ids = (((await res.json()) as Json).data.institutions as Json[]).map(
      (i) => i.institution_id,
    );
    expect(ids).toEqual(["ins_109508", "ins_109509", "ins_109511", "ins_109512"]);
  });

  it("answers 422 when no credentials are stored", async () => {
    await deleteSecret(env, "plaid_credentials:sandbox");
    const plan = await createPlan("sandbox");
    const calls = stubPlaid({});
    const res = await json(`/api/v1/institutions?budget_id=${plan}&query=plat`);
    expect(res.status).toBe(422);
    const body = (await res.json()) as Json;
    expect(body.error.name).toBe("bank_connections_not_set_up");
    expect(body.error.detail).toBe("Bank connections are not set up");
    expect(calls).toHaveLength(0);
  });

  it("never calls Plaid for a production plan outside the live Worker", async () => {
    await setSecret(
      env,
      "plaid_credentials:production",
      JSON.stringify({ client_id: "x", secret: "y", set_at: "2026-01-01T00:00:00.000Z" }),
    );
    const plan = await createPlan();
    const calls = stubPlaid({});
    const res = await json(`/api/v1/institutions?budget_id=${plan}&query=chase`);
    expect(res.status).toBe(422);
    expect(calls).toHaveLength(0);
    await deleteSecret(env, "plaid_credentials:production");
  });

  it("answers a Plaid failure as 502 with a generic message", async () => {
    const plan = await createPlan("sandbox");
    stubPlaid({
      "/institutions/search": () => ({
        status: 400,
        body: { error_code: "INTERNAL_SERVER_ERROR", display_message: null },
      }),
    });
    const res = await json(`/api/v1/institutions?budget_id=${plan}&query=plat`);
    expect(res.status).toBe(502);
    const body = (await res.json()) as Json;
    expect(body.error).toEqual({
      id: "502",
      name: "plaid_error",
      detail: "Something went wrong. Try again.",
    });
  });

  it("validates the query and the plan", async () => {
    const plan = await createPlan("sandbox");
    expect((await json(`/api/v1/institutions?budget_id=${plan}&query=`)).status).toBe(400);
    expect((await json(`/api/v1/institutions?budget_id=${plan}`)).status).toBe(400);
    stubPlaid({});
    const unknown = await json(`/api/v1/institutions?budget_id=${crypto.randomUUID()}&query=a`);
    expect(unknown.status).toBe(404);
  });
});
