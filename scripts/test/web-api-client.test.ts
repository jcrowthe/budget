import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, apiFetch } from "../../apps/web/src/api/client";

// zod is not resolvable from scripts/, so a parse-only stand-in plays the schema.
const schema = { parse: (x: unknown) => x } as never;

function stub(status: number, headers: Record<string, string> = {}) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ data: 1 }), { status, headers })),
  );
}
afterEach(() => vi.unstubAllGlobals());

describe("apiFetch onChangeSet", () => {
  it("calls it with the header value on a 2xx write", async () => {
    stub(200, { "Budget-Change-Set": "abc" });
    const seen = vi.fn();
    await apiFetch("/api/v1/x", { method: "POST", body: {}, schema, onChangeSet: seen });
    expect(seen).toHaveBeenCalledOnce();
    expect(seen).toHaveBeenCalledWith("abc");
  });

  it("does not call it on a 4xx", async () => {
    stub(422, { "Budget-Change-Set": "abc" });
    const seen = vi.fn();
    await expect(
      apiFetch("/api/v1/x", { method: "POST", body: {}, schema, onChangeSet: seen }),
    ).rejects.toBeInstanceOf(ApiError);
    expect(seen).not.toHaveBeenCalled();
  });

  it("does not call it when the header is missing", async () => {
    stub(200);
    const seen = vi.fn();
    await apiFetch("/api/v1/x", { method: "POST", body: {}, schema, onChangeSet: seen });
    expect(seen).not.toHaveBeenCalled();
  });

  it("still resolves for a caller that passes none", async () => {
    stub(200, { "Budget-Change-Set": "abc" });
    await expect(apiFetch("/api/v1/x", { method: "PATCH", schema })).resolves.toEqual({ data: 1 });
  });
});
