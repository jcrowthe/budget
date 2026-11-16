import type { APIRequestContext } from "@playwright/test";
import { authHeaders, testName } from "./auth";

const pad = (n: number) => String(n).padStart(2, "0");
/** The first day of the month `offset` months from the current local month. */
export const monthIso = (offset = 0) => {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() + offset);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-01`;
};

export type Cat = { id: string; name: string; assigned: number; available: number };
export type MonthRead = {
  ready_to_assign: number;
  rta_breakdown: Record<string, number>;
  groups: { name: string; assigned: number; available: number; categories: Cat[] }[];
};

export class Plan {
  id = "";
  constructor(private request: APIRequestContext) {}
  async create(label: string) {
    const res = await this.request.post("/api/v1/budgets", {
      headers: await authHeaders(),
      data: { name: testName(label) },
    });
    this.id = (await res.json()).data.budget.id;
  }
  async remove() {
    await this.request.delete(`/api/v1/budgets/${this.id}`, { headers: await authHeaders() });
  }
  /** An inflow to Ready to Assign, in dollars. */
  async inflow(dollars: number) {
    await this.request.post(`/api/v1/budgets/${this.id}/accounts`, {
      headers: await authHeaders(),
      data: { name: "ZZ-TEST Checking", type: "checking", balance: dollars * 1000 },
    });
  }
  async month(offset = 0): Promise<MonthRead> {
    const res = await this.request.get(`/api/v1/budgets/${this.id}/months/${monthIso(offset)}`, {
      headers: await authHeaders(),
    });
    return (await res.json()).data;
  }
  async cat(name: string, offset = 0): Promise<Cat> {
    const c = (await this.month(offset)).groups
      .flatMap((g) => g.categories)
      .find((x) => x.name === name);
    if (!c) throw new Error(`no category ${name}`);
    return c;
  }
  /** Sets a category's Assigned (dollars) in the month `offset` from now. */
  async assign(name: string, dollars: number, offset = 0) {
    const c = await this.cat(name);
    await this.request.patch(
      `/api/v1/budgets/${this.id}/months/${monthIso(offset)}/categories/${c.id}`,
      { headers: await authHeaders(), data: { assigned: dollars * 1000 } },
    );
  }
}
