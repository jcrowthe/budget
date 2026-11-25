import { describe, expect, it } from "vitest";
import { type Json, q } from "./bulk-helpers";
import { accountOf, activity, balanceOf, mortgageWorld, TODAY, update } from "./loan-update-world";
import { summary } from "./loan-world";
import { setOf, undo } from "./undo-helpers";

// EXF-543, contract AC3: undo restores the pre-update state.
describe("undo of a loan balance update", () => {
  it("restores the lines, the balance, the edited row, the rate and last_reconciled_at", async () => {
    const w = await mortgageWorld({ edited: true });
    const res = await update(w.bid, w.loan.id, {
      balance: -199500000,
      interest_rate: "6.3",
      keep_rate: true,
      today: TODAY,
    });
    expect(res.status).toBe(200);
    expect((await accountOf(w.bid, w.loan.id)).interest_rate).toBe("6.3");
    const u = await undo(w.bid, setOf(res));
    expect(u.status).toBe(200);
    const a = await activity(w.bid, w.loan.id);
    expect(a.interest).toMatchObject({ amount: -1050000, state: "edited" });
    expect(a.escrow).toMatchObject({ amount: -300000, state: "estimated" });
    expect(a.ending_balance).toBe(-199850000);
    expect(await balanceOf(w.bid, w.loan.id)).toBe(-199850000);
    const acct = await accountOf(w.bid, w.loan.id);
    expect(acct.last_reconciled_at).toBeNull();
    expect(acct.interest_rate).toBe("6");
    expect((await summary(w.bid, w.loan.id)).balance_updated_at).toBeNull();
    expect(a.other.find((o: Json) => o.label === "Balance adjustment")).toBeUndefined();
    const edited = await q("select deleted_at from transactions where id = ?", w.editedId);
    expect(edited[0]?.deleted_at).toBeNull();
    // The system payees stay, and the next update works.
    expect(
      await q("select id from payees where budget_id = ? and system = 'loan_escrow'", w.bid),
    ).toHaveLength(1);
    const again = await update(w.bid, w.loan.id, { balance: -199500000, today: TODAY });
    expect(again.status).toBe(200);
    expect((await activity(w.bid, w.loan.id)).interest?.state).toBe("reconciled");
  });
});
