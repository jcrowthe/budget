import { ErrorBody } from "@budget/schema/common/envelope";
import {
  AccountViewSettingsResponse,
  AccountViewSettingsUpdate,
  AllAccountsViewSettingsResponse,
  AllAccountsViewSettingsUpdate,
} from "@budget/schema/view-settings";
import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import type { AppEnv } from "../env";
import { apiError } from "../middleware/errors";
import {
  getAccountViewSettings,
  getAllAccountsViewSettings,
  updateAccountViewSettings,
  updateAllAccountsViewSettings,
} from "../services/view-settings";

const tags = ["View settings"];
const json = <T extends z.ZodType>(schema: T, description: string) => ({
  description,
  content: { "application/json": { schema } },
});
const param = (name: string) =>
  z
    .string()
    .min(1)
    .openapi({ param: { name, in: "path" } });
const errors = {
  403: json(ErrorBody, "Forbidden"),
  404: json(ErrorBody, "Plan or account not found"),
  422: json(ErrorBody, "Invalid request"),
};
const accountParams = z.object({ budget_id: param("budget_id"), account_id: param("account_id") });
const planParams = z.object({ budget_id: param("budget_id") });
const ACCOUNT_PATH = "/budgets/{budget_id}/accounts/{account_id}/view_settings";
const ALL_PATH = "/budgets/{budget_id}/view_settings/all_accounts";

const app = new OpenAPIHono<AppEnv>({
  defaultHook: (result, c) => {
    if (!result.success) {
      return apiError(
        c,
        422,
        "unprocessable_entity",
        result.error.issues.map((i) => i.message).join("; "),
      );
    }
  },
});

export default app
  .openapi(
    createRoute({
      method: "get",
      path: ACCOUNT_PATH,
      tags,
      request: { params: accountParams },
      responses: {
        200: json(AccountViewSettingsResponse, "The account's register view settings"),
        ...errors,
      },
    }),
    async (c) => {
      const { budget_id, account_id } = c.req.valid("param");
      const view_settings = await getAccountViewSettings(c.env, budget_id, account_id);
      return c.json({ data: { view_settings } }, 200);
    },
  )
  .openapi(
    createRoute({
      method: "put",
      path: ACCOUNT_PATH,
      tags,
      request: {
        params: accountParams,
        body: {
          content: { "application/json": { schema: AccountViewSettingsUpdate } },
          required: true,
        },
      },
      responses: {
        200: json(AccountViewSettingsResponse, "The merged settings"),
        ...errors,
      },
    }),
    async (c) => {
      const { budget_id, account_id } = c.req.valid("param");
      const view_settings = await updateAccountViewSettings(
        c.env,
        c.get("identity").actor,
        budget_id,
        account_id,
        c.req.valid("json"),
      );
      return c.json({ data: { view_settings } }, 200);
    },
  )
  .openapi(
    createRoute({
      method: "get",
      path: ALL_PATH,
      tags,
      request: { params: planParams },
      responses: {
        200: json(AllAccountsViewSettingsResponse, "The All Accounts register view settings"),
        ...errors,
      },
    }),
    async (c) => {
      const { budget_id } = c.req.valid("param");
      const view_settings = await getAllAccountsViewSettings(c.env, budget_id);
      return c.json({ data: { view_settings } }, 200);
    },
  )
  .openapi(
    createRoute({
      method: "put",
      path: ALL_PATH,
      tags,
      request: {
        params: planParams,
        body: {
          content: { "application/json": { schema: AllAccountsViewSettingsUpdate } },
          required: true,
        },
      },
      responses: {
        200: json(AllAccountsViewSettingsResponse, "The merged settings"),
        ...errors,
      },
    }),
    async (c) => {
      const { budget_id } = c.req.valid("param");
      const view_settings = await updateAllAccountsViewSettings(
        c.env,
        c.get("identity").actor,
        budget_id,
        c.req.valid("json"),
      );
      return c.json({ data: { view_settings } }, 200);
    },
  );
