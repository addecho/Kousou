import { describe, it, expect } from "vitest";
import { calculate, examplePlan, ruleDefaults, type GovernmentSubsidy } from "../packages/core/src/index";
import { planSchema } from "../packages/contracts/src/index";

const subsidy: GovernmentSubsidy = {
  enabled: true, category: "appliance", mode: "percent", rateBps: 1500, amount: "0",
};
function fixture() {
  const p = examplePlan();
  p.lines = [{ ...p.lines[0], price: "197645", directOff: "0", governmentSubsidy: { ...subsidy } }];
  p.rules = [];
  p.assetDeduction = "0";
  p.shipping = [{ ...p.shipping[0], fee: "0" }];
  return p;
}
describe("manual government subsidy", () => {
  it("reproduces the conditional 15% preview without double counting promotion savings", () => {
    const r = calculate(planSchema.parse(fixture()));
    expect(r.cash).toBe("167998");
    expect(r.governmentSubsidy).toBe("29647");
    expect(r.promotionDiscount).toBe("0");
    expect(r.lines[0].payable).toBe(r.goods);
    expect(r.trace[0].allocations.a1).toBe("29647");
    expect(r.certainty).toBe("assumption_based");
  });
  it("preserves old plans and supports disabling or deselecting the subsidy", () => {
    expect(calculate(examplePlan()).cash).toBe("41300");
    const p = fixture();
    p.lines[0].governmentSubsidy!.enabled = false;
    expect(calculate(p).cash).toBe("197645");
    p.lines[0].governmentSubsidy!.enabled = true;
    p.lines[0].selected = false;
    expect(calculate(p).governmentSubsidy).toBe("0");
  });
  it("applies fixed amounts per item and caps them at remaining goods payable", () => {
    const p = fixture();
    p.lines[0].quantity = 2;
    p.lines[0].governmentSubsidy = { ...subsidy, mode: "fixed", amount: "10000" };
    expect(calculate(p).governmentSubsidy).toBe("20000");
    p.lines[0].governmentSubsidy.amount = "9999999";
    expect(calculate(p).goods).toBe("0");
  });
  it("uses post-promotion goods, leaves shipping threshold unchanged and applies assets last", () => {
    const p = fixture();
    p.lines[0].price = "10000";
    p.lines[0].governmentSubsidy!.rateBps = 5000;
    p.rules = [{ ...ruleDefaults, id: "off", name: "off", stage: "platform", verified: true, amount: "1000" }];
    p.shipping[0].fee = "1000";
    p.shipping[0].freeOver = "8000";
    p.assetDeduction = "500";
    const r = calculate(p);
    expect(r.promotionDiscount).toBe("1000");
    expect(r.governmentSubsidy).toBe("4500");
    expect(r.shipping).toBe("0");
    expect(r.cash).toBe("4000");
  });
  it("validates rates, money and modes before calculation", () => {
    for (const patch of [{ rateBps: 10001 }, { rateBps: -1 }, { rateBps: 15.5 }, { amount: "-1" }, { mode: "unknown" }]) {
      const p = fixture();
      Object.assign(p.lines[0].governmentSubsidy!, patch);
      expect(planSchema.safeParse(p).success).toBe(false);
    }
  });
  it("compares platform coupon combinations after manual subsidies", () => {
    const p = fixture();
    p.lines[0].price = "10000";
    p.lines[0].governmentSubsidy!.rateBps = 10000;
    p.lines.push({ ...p.lines[0], id: "other", governmentSubsidy: undefined });
    p.rules = [
      { ...ruleDefaults, id: "large", name: "large", stage: "platform", verified: true, amount: "5000", lineIds: [p.lines[0].id] },
      { ...ruleDefaults, id: "small", name: "small", stage: "platform", verified: true, amount: "1000", lineIds: ["other"] },
    ];
    expect(calculate(p).cash).toBe("9000");
    expect(calculate(p).statuses.find((s) => s.id === "small")?.code).toBe("APPLIED");
  });
});
