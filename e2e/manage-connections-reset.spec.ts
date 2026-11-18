import { expect, test } from "./fixtures";
import {
  dialogNamed,
  oneAccountBank,
  openDetail,
  posts,
  setup,
} from "./support/manage-connections-seed";
import { stubPlaidLink } from "./support/plaid-stub";
import { realClick } from "./support/real-click";

const OK = {
  success: {
    public_token: "public-test-token",
    institution: { name: "ZZ Bank", institution_id: "ins_test_1" },
  },
};
const idx = (reqs: { method: string; url: string }[], method: string, tail: RegExp) =>
  reqs.findIndex((r) => r.method === method && tail.test(new URL(r.url).pathname));

test("11 Reset: confirm, token, sign-in, reset, one sync; then Reset is disabled for 24 hours", async ({
  page,
  request,
}) => {
  await stubPlaidLink(page, OK);
  const { stub } = await setup(page, request, (z) => [z.connection]);
  const detail = await openDetail(page, "ZZ Bank");
  await realClick(page, detail.getByRole("button", { name: "Reset", exact: true }));
  const confirm = dialogNamed(page, "Reset Bank Connection");
  await expect(confirm).toContainText("After a reset, Reset is not available for 24 hours.");
  await realClick(page, confirm.getByRole("button", { name: "Reset", exact: true }));
  await expect.poll(() => posts(stub.requests, "POST", /\/[^/]+\/reset$/).length).toBe(1);
  await expect
    .poll(() => posts(stub.requests, "POST", /\/bank-connections\/[^/]+\/sync$/).length)
    .toBeGreaterThanOrEqual(1);
  const tokenAt = idx(stub.requests, "POST", /\/bank-connections\/[^/]+\/link-token$/);
  const resetAt = idx(stub.requests, "POST", /\/reset$/);
  const syncAt = stub.requests.findIndex(
    (r, i) =>
      i > resetAt &&
      r.method === "POST" &&
      /\/bank-connections\/[^/]+\/sync$/.test(new URL(r.url).pathname),
  );
  expect(tokenAt).toBeGreaterThan(-1);
  expect(tokenAt).toBeLessThan(resetAt);
  expect(resetAt).toBeLessThan(syncAt);
  expect(posts(stub.requests, "POST", /\/bank-connections\/[^/]+\/link-token$/)).toHaveLength(1);
  expect(
    await page.evaluate(
      () => (window as unknown as { __plaidConfig: { token: string } }).__plaidConfig.token,
    ),
  ).toBe("link-update-test");
  const reset = dialogNamed(page, "ZZ Bank").getByRole("button", { name: "Reset", exact: true });
  await expect(reset).toBeDisabled();
  await expect(reset).toHaveAttribute(
    "title",
    /^Reset is available again on .+ at .+\. A bank connection can be reset once every 24 hours\.$/,
  );
  await expect(dialogNamed(page, "ZZ Bank").locator(".mc-reset-note")).toHaveText(
    (await reset.getAttribute("title")) as string,
  );
  expect(posts(stub.requests, "POST", /\/bank-connections\/[^/]+\/sync$/)).toHaveLength(1);
});

test("11b Reset within 24 hours of a reset is disabled from the start", async ({
  page,
  request,
}) => {
  await setup(page, request, (z) => [z.connection], {
    zz: { last_reset_at: new Date(Date.now() - 3_600_000).toISOString() },
  });
  const detail = await openDetail(page, "ZZ Bank");
  const reset = detail.getByRole("button", { name: "Reset", exact: true });
  await expect(reset).toBeDisabled();
  await expect(reset).toHaveAttribute("title", /^Reset is available again on /);
});

test("11c sign-in closed: its sentence, no reset call", async ({ page, request }) => {
  await stubPlaidLink(page, { exit: { display_message: null } });
  const { stub } = await setup(page, request, (z) => [z.connection]);
  const detail = await openDetail(page, "ZZ Bank");
  await realClick(page, detail.getByRole("button", { name: "Reset", exact: true }));
  await realClick(
    page,
    dialogNamed(page, "Reset Bank Connection").getByRole("button", { name: "Reset", exact: true }),
  );
  await expect(dialogNamed(page, "ZZ Bank").getByRole("status")).toHaveText(
    "The bank sign-in was closed. Nothing was changed.",
  );
  expect(posts(stub.requests, "POST", /\/reset$/)).toHaveLength(0);
});

test("11d a 409 reset_too_soon shows the server's message", async ({ page, request }) => {
  await stubPlaidLink(page, OK);
  await setup(page, request, (z) => [z.connection], {
    updateToken: { status: 409, name: "reset_too_soon", detail: "ZZ reset too soon, try later" },
  });
  const detail = await openDetail(page, "ZZ Bank");
  await realClick(page, detail.getByRole("button", { name: "Reset", exact: true }));
  await realClick(
    page,
    dialogNamed(page, "Reset Bank Connection").getByRole("button", { name: "Reset", exact: true }),
  );
  await expect(dialogNamed(page, "ZZ Bank").getByRole("alert")).toHaveText(
    "ZZ reset too soon, try later",
  );
});

test("12 Repair: banner and Repair run the same calls; broken offers Remove; delayed has its banner", async ({
  page,
  request,
}) => {
  await stubPlaidLink(page, OK);
  const { stub } = await setup(page, request, (z) => [
    z.connection,
    oneAccountBank("ZZ Locked", "login_required", "4a5b6c"),
    oneAccountBank("ZZ Gone", "broken", "7d8e9f"),
    oneAccountBank("ZZ Late", "delayed", "1d2e3f"),
  ]);
  let detail = await openDetail(page, "ZZ Locked");
  await expect(detail.getByText("Connection Repair Needed", { exact: true }).first()).toBeVisible();
  await realClick(page, detail.getByRole("button", { name: "Repair", exact: true }));
  await expect.poll(() => posts(stub.requests, "POST", /\/reset$/).length).toBe(1);
  await expect
    .poll(() => posts(stub.requests, "POST", /\/bank-connections\/[^/]+\/sync$/).length)
    .toBeGreaterThanOrEqual(1);
  await expect(dialogNamed(page, "ZZ Locked").locator(".mc-subtitle")).toHaveText("Connected");
  expect(posts(stub.requests, "POST", /\/bank-connections\/[^/]+\/sync$/)).toHaveLength(1);
  await realClick(page, dialogNamed(page, "ZZ Locked").getByRole("button", { name: "Back" }));
  const list = dialogNamed(page, "Manage Bank Connections");
  await expect(
    list
      .locator("section", { hasText: "All Others" })
      .getByRole("button", { name: "ZZ Locked", exact: true }),
  ).toBeVisible();

  await realClick(page, list.getByRole("button", { name: "ZZ Gone", exact: true }));
  detail = dialogNamed(page, "ZZ Gone");
  await expect(
    detail.getByText(
      "This bank connection cannot be repaired. Remove it and connect the bank again.",
    ),
  ).toBeVisible();
  await expect(detail.getByRole("button", { name: "Repair" })).toHaveCount(0);
  await expect(detail.getByRole("button", { name: "Remove" }).first()).toBeVisible();
  await expect(detail.getByRole("button", { name: "Reset", exact: true })).toHaveAttribute(
    "title",
    "This bank connection cannot be reset. Remove it and connect the bank again.",
  );
  await realClick(page, detail.getByRole("button", { name: "Back" }));
  await realClick(
    page,
    dialogNamed(page, "Manage Bank Connections").getByRole("button", {
      name: "ZZ Late",
      exact: true,
    }),
  );
  await expect(
    dialogNamed(page, "ZZ Late").getByText("Imports Delayed", { exact: true }).first(),
  ).toBeVisible();
});

test("13 Remove: the confirmation, one DELETE, the list without it", async ({ page, request }) => {
  const { stub } = await setup(page, request, (z) => [z.connection]);
  const detail = await openDetail(page, "ZZ Bank");
  await realClick(page, detail.getByRole("button", { name: "Remove", exact: true }));
  const confirm = dialogNamed(page, "Remove Bank Connection");
  await expect(confirm).toContainText(
    "This will unlink every account linked to this connection. Their transactions and the accounts themselves stay.",
  );
  await realClick(page, confirm.getByRole("button", { name: "Remove", exact: true }));
  await expect
    .poll(() => posts(stub.requests, "DELETE", /\/bank-connections\/[^/]+$/).length)
    .toBe(1);
  const list = dialogNamed(page, "Manage Bank Connections");
  await expect(list.getByText("No bank connections yet.")).toBeVisible();
  await expect(list.getByRole("button", { name: "ZZ Bank", exact: true })).toHaveCount(0);
});

test("13b Remove refused (502): its message, kept", async ({ page, request }) => {
  await setup(page, request, (z) => [z.connection], {
    remove: { status: 502, name: "plaid_remove_failed", detail: "ZZ the bank would not let go" },
  });
  const detail = await openDetail(page, "ZZ Bank");
  await realClick(page, detail.getByRole("button", { name: "Remove", exact: true }));
  const confirm = dialogNamed(page, "Remove Bank Connection");
  await realClick(page, confirm.getByRole("button", { name: "Remove", exact: true }));
  await expect(confirm.getByRole("alert")).toHaveText("ZZ the bank would not let go");
  await realClick(page, confirm.getByRole("button", { name: "Cancel" }));
  await realClick(page, dialogNamed(page, "ZZ Bank").getByRole("button", { name: "Back" }));
  await expect(
    dialogNamed(page, "Manage Bank Connections").getByRole("button", {
      name: "ZZ Bank",
      exact: true,
    }),
  ).toBeVisible();
});

test("11e a Reset message stays with its connection", async ({ page, request }) => {
  await stubPlaidLink(page, { exit: { display_message: null } });
  await setup(page, request, (z) => [
    z.connection,
    oneAccountBank("ZZ Other", "connected", "aa11bb"),
  ]);
  const detail = await openDetail(page, "ZZ Bank");
  await realClick(page, detail.getByRole("button", { name: "Reset", exact: true }));
  await realClick(
    page,
    dialogNamed(page, "Reset Bank Connection").getByRole("button", { name: "Reset", exact: true }),
  );
  await expect(dialogNamed(page, "ZZ Bank").getByRole("status")).toBeVisible();
  await realClick(page, dialogNamed(page, "ZZ Bank").getByRole("button", { name: "Back" }));
  await realClick(
    page,
    dialogNamed(page, "Manage Bank Connections").getByRole("button", {
      name: "ZZ Other",
      exact: true,
    }),
  );
  await expect(dialogNamed(page, "ZZ Other")).toBeVisible();
  await expect(dialogNamed(page, "ZZ Other").getByRole("status")).toHaveCount(0);
});
