import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  allocate,
  calculate,
  examplePlan,
  emptyPlan,
  ruleDefaults,
  optimize,
  cents,
  yuan,
} from "../packages/core/src/index";
import { planSchema } from "../packages/contracts/src/index";
describe("integer pricing", () => {
  it("multi-shop fixture is 410 goods / 413 cash", () => {
    const r = calculate(examplePlan());
    expect(r.goods).toBe("41000");
    expect(r.shipping).toBe("1300");
    expect(r.cash).toBe("41300");
    expect(r.trace.length).toBe(3);
  });
  it("Taobao announced shop exclusivity selects 180, not 170", () => {
    const p = examplePlan();
    p.policy = "taobao_2026";
    p.lines = [{ ...p.lines[0], price: "10000", quantity: 2, directOff: "0" }];
    p.shipping = [{ ...p.shipping[0], fee: "0" }];
    p.assetDeduction = "0";
    p.rules = [
      {
        ...ruleDefaults,
        id: "a",
        name: "九折",
        stage: "shop",
        shop: p.lines[0].shop,
        verified: true,
        kind: "percent",
        minQuantity: 2,
        rateBps: 9000,
      },
      {
        ...ruleDefaults,
        id: "b",
        name: "200减10",
        stage: "shop",
        shop: p.lines[0].shop,
        verified: true,
        threshold: "20000",
        amount: "1000",
      },
    ];
    expect(calculate(p).cash).toBe("18000");
  });
  it("unknown eligibility cannot contribute to a coupon threshold", () => {
    const p = examplePlan();
    p.lines[0].eligibility = "unknown";
    const r = calculate(p);
    expect(r.statuses.find((s) => s.id === "shop30")?.code).toBe(
      "THRESHOLD_NOT_MET",
    );
    expect(r.certainty).toBe("incomplete");
  });
  it("unverified and expired rules are not applied", () => {
    const p = examplePlan();
    p.rules[0].verified = false;
    p.rules[1].endsAt = "2020-01-01T00:00:00.000Z";
    const r = calculate(p);
    expect(r.statuses[0].code).toBe("UNVERIFIED");
    expect(r.statuses[1].code).toBe("EXPIRED");
  });
  it("threshold basis is independent of remaining payable", () => {
    const p = examplePlan();
    p.rules[1].threshold = "46000";
    p.rules[1].basis = "after_item";
    expect(calculate(p).goods).toBe("41000");
    p.rules[1].basis = "after_shop";
    expect(calculate(p).goods).toBe("45000");
  });
  it("scope excludes other shops even when they reach threshold", () => {
    const p = examplePlan();
    p.rules[0].threshold = "40000";
    expect(calculate(p).statuses[0].code).toBe("THRESHOLD_NOT_MET");
  });
  it("does not greedily select platform coupons", () => {
    const p = examplePlan();
    p.rules = p.rules.filter((r) => r.stage === "shop");
    p.rules.push(
      {
        ...ruleDefaults,
        id: "small",
        name: "small",
        stage: "platform",
        verified: true,
        amount: "1000",
      },
      {
        ...ruleDefaults,
        id: "large",
        name: "large",
        stage: "platform",
        verified: true,
        amount: "5000",
      },
    );
    expect(calculate(p).statuses.find((s) => s.id === "large")?.code).toBe(
      "APPLIED",
    );
  });
  it("allocations conserve cents and never exceed capacities", () =>
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 0, max: 100000 }), {
          minLength: 1,
          maxLength: 20,
        }),
        fc.integer({ min: 0, max: 2000000 }),
        (xs, n) => {
          const w = Object.fromEntries(
            xs.map((v, i) => [String(i), BigInt(v)]),
          );
          const a = allocate(BigInt(n), w);
          expect(Object.values(a).reduce((x, y) => x + y, 0n)).toBe(
            BigInt(
              Math.min(
                n,
                xs.reduce((x, y) => x + y, 0),
              ),
            ),
          );
          for (const [k, v] of Object.entries(a)) {
            expect(v >= 0n && v <= w[k]).toBe(true);
          }
        },
      ),
      { numRuns: 500 },
    ));
  it("tie allocation is stable under order changes", () => {
    expect(allocate(1n, { b: 1n, a: 1n, c: 1n })).toEqual({
      a: 1n,
      b: 0n,
      c: 0n,
    });
  });
  it("calculation does not mutate input and is repeatable", () => {
    const p = examplePlan(),
      before = JSON.stringify(p);
    expect(calculate(p)).toEqual(calculate(p));
    expect(JSON.stringify(p)).toBe(before);
  });
  it("zero shipping is different from unknown shipping", () => {
    const p = examplePlan();
    p.shipping[0].known = false;
    expect(calculate(p).certainty).toBe("incomplete");
  });
  it("asset deductions and negative adjustment are capped", () => {
    const p = examplePlan();
    p.assetDeduction = "99999999";
    p.adjustment = "-100";
    p.adjustmentReason = "test";
    expect(calculate(p).cash).toBe("0");
  });
  it("schema rejects zero every-full divisor and excess platform search complexity", () => {
    const p = examplePlan();
    p.rules[0].kind = "every_full";
    p.rules[0].threshold = "0";
    expect(planSchema.safeParse(p).success).toBe(false);
    const q = examplePlan();
    q.rules = Array.from({ length: 9 }, (_, i) => ({
      ...q.rules[1],
      id: String(i),
    }));
    expect(planSchema.safeParse(q).success).toBe(false);
  });
  it("decimal conversion remains exact", () => {
    expect(cents("0.01")).toBe("1");
    expect(yuan("123456789")).toBe("1234567.89");
    expect(() => cents("1.001")).toThrow();
  });
  it("optimizer keeps required goods, exposes added cost and matches tiny exhaustive domain", () => {
    const p = examplePlan();
    p.rules = [];
    p.assetDeduction = "0";
    p.lines = p.lines.slice(0, 2);
    p.lines[0].directOff = "0";
    p.lines[0].price = "28000";
    p.lines[1].role = "filler";
    p.lines[1].price = "3000";
    p.lines[1].maxQuantity = 1;
    p.shipping = [{ ...p.shipping[0], fee: "0" }];
    p.rules = [
      {
        ...ruleDefaults,
        id: "r",
        name: "300-20",
        stage: "shop",
        shop: p.lines[0].shop,
        threshold: "30000",
        amount: "2000",
        verified: true,
      },
    ];
    const search = optimize(p);
    expect(search.status).toBe("exhaustive");
    expect(search.visited).toBe(2);
    expect(search.plans.map((c) => c.result.cash)).toEqual(["28000", "29000"]);
    expect(search.plans.every((c) => c.plan.lines[0].selected)).toBe(true);
  });
  it("node-limited optimizer does not claim a proof", () => {
    const p = examplePlan();
    p.lines[1].role = "optional";
    expect(optimize(p, 1000, 1).status).toBe("best_found");
  });
});
