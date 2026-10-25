// Screenshot transcription, not an executable promotion preset.
// IDs refer to images in upload order; capture date and shipping are unknown.
export const cartObservation = {
  source: "user-screenshots-8-images",
  kind: "cart-preview",
  items: [
    { id: "juice", original: "5990", displayedPayable: "3670" },
    { id: "socks", original: "5900", displayedPayable: "4987" },
    { id: "washer", original: "302000", displayedPayable: "197645" },
  ],
  threeSelected: {
    original: "313890",
    shopDiscount: "84125",
    shopBreakdown: { official: "46190", direct: "2000", limitedSubsidy: "35935" },
    platformDiscount: "23463",
    platformBreakdown: { vip: "200", coins: "8163", redPacket: "15000", firstOrder: "100" },
    totalDiscount: "107588",
    payable: "206302",
  },
  fourSelected: { payable: "239587", totalDiscount: "116103" },
  applianceCoupons: [
    { threshold: "300000", discount: "30000", displayedGap: "87355" },
    { threshold: "500000", discount: "50000", displayedGap: "287355" },
    { threshold: "800000", discount: "80000", displayedGap: "587355" },
  ],
  supermarket: { freeShippingThreshold: "8800", displayedGap: "4830", weightLimitKg: 21 },
  governmentSubsidy: {
    sourceImages: [1, 2],
    lineId: "washer",
    previewPayable: "167998",
    approximate: true,
    includedInCartTotal: false,
    ruleStatus: "unverified",
    candidate: {
      rateBps: 1500,
      basis: "displayed-item-payable",
      rounding: "half-up-discount-to-cent",
    },
  },
} as const;
