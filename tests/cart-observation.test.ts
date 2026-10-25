import { describe, expect, it } from "vitest";
import { cartObservation as o } from "./fixtures/taobao-cart-observation";

const sum = (values: readonly string[]) => values.reduce((n, v) => n + BigInt(v), 0n);

// These check evidence consistency, not calculate() or general Taobao semantics.
describe("Taobao screenshot evidence reconciliation", () => {
  it("reconciles original prices and displayed item payables", () => {
    expect(sum(o.items.map((i) => i.original))).toBe(BigInt(o.threeSelected.original));
    expect(sum(o.items.map((i) => i.displayedPayable))).toBe(BigInt(o.threeSelected.payable));
  });

  it("reconciles each discount category without counting parent totals twice", () => {
    expect(sum(Object.values(o.threeSelected.shopBreakdown))).toBe(BigInt(o.threeSelected.shopDiscount));
    expect(sum(Object.values(o.threeSelected.platformBreakdown))).toBe(BigInt(o.threeSelected.platformDiscount));
    expect(sum([o.threeSelected.shopDiscount, o.threeSelected.platformDiscount])).toBe(BigInt(o.threeSelected.totalDiscount));
    expect(BigInt(o.threeSelected.original) - BigInt(o.threeSelected.totalDiscount)).toBe(BigInt(o.threeSelected.payable));
  });

  it("infers the same eligible subtotal from all three coupon gaps", () => {
    const inferred = o.applianceCoupons.map((c) => BigInt(c.threshold) - BigInt(c.displayedGap));
    expect(inferred).toEqual([212645n, 212645n, 212645n]);
    expect(inferred[0]).toBe(BigInt(o.items[2].displayedPayable) + BigInt(o.threeSelected.platformBreakdown.redPacket));
    expect(inferred[0]).not.toBe(BigInt(o.threeSelected.payable));
  });

  it("keeps the shipping eligibility subtotal distinct from displayed payable", () => {
    const inferred = BigInt(o.supermarket.freeShippingThreshold) - BigInt(o.supermarket.displayedGap);
    expect(inferred).toBe(3970n);
    expect(inferred).not.toBe(BigInt(o.items[0].displayedPayable));
    expect(inferred).not.toBe(BigInt(o.items[0].original) - BigInt(o.threeSelected.shopBreakdown.direct));
  });

  it("records a cart delta without treating it as the fourth item's standalone price", () => {
    const payableDelta = BigInt(o.fourSelected.payable) - BigInt(o.threeSelected.payable);
    const discountDelta = BigInt(o.fourSelected.totalDiscount) - BigInt(o.threeSelected.totalDiscount);
    expect(payableDelta).toBe(33285n);
    expect(discountDelta).toBe(8515n);
    // Conditional implied original-price delta; item identity and promotion changes are unknown.
    expect(payableDelta + discountDelta).toBe(41800n);
  });

  it("reconciles the subsidy preview only under an explicit unverified hypothesis", () => {
    const subsidy = o.governmentSubsidy;
    const washer = o.items.find((i) => i.id === subsidy.lineId)!;
    const basis = BigInt(washer.displayedPayable);
    const hypotheticalDiscount = (basis * BigInt(subsidy.candidate.rateBps) + 5000n) / 10000n;
    expect(hypotheticalDiscount).toBe(29647n);
    expect(basis - hypotheticalDiscount).toBe(BigInt(subsidy.previewPayable));
    expect(subsidy.ruleStatus).toBe("unverified");
    expect(subsidy.approximate).toBe(true);
    expect(subsidy.includedInCartTotal).toBe(false);
  });

  it("keeps the hypothetical subsidy scenario separate from the observed cart", () => {
    const washer = o.items.find((i) => i.id === o.governmentSubsidy.lineId)!;
    const previewDelta = BigInt(washer.displayedPayable) - BigInt(o.governmentSubsidy.previewPayable);
    // This assumes all other discounts remain unchanged; it is not an observed checkout total.
    const hypotheticalTotal = BigInt(o.threeSelected.payable) - previewDelta;
    expect(hypotheticalTotal).toBe(176655n);
    expect(sum(o.items.map((i) => i.displayedPayable))).toBe(206302n);
    expect(hypotheticalTotal).not.toBe(BigInt(o.threeSelected.payable));
  });
});
