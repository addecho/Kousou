import { z } from "zod";
import type { Plan } from "@kousou/core";
const money = z.string().regex(/^\d{1,10}$/);
const signed = z.string().regex(/^-?\d{1,10}$/);
const id = z.string().min(1).max(100);
const date = z.union([z.literal(""), z.string().datetime()]);
export const planSchema: z.ZodType<Plan> = z
  .object({
    schemaVersion: z.literal(1),
    title: z.string().min(1).max(120),
    platform: z.literal("taobao"),
    account: z.string().min(1).max(100),
    policy: z.enum(["taobao_2026", "custom"]),
    valuationTime: z.string().datetime(),
    lines: z
      .array(
        z.object({
          id,
          shop: z.string().min(1).max(100),
          name: z.string().min(1).max(200),
          spec: z.string().max(200),
          price: money,
          quantity: z.number().int().min(1).max(99),
          directOff: money,
          selected: z.boolean(),
          role: z.enum(["required", "optional", "filler"]),
          eligibility: z.enum(["confirmed", "unknown"]),
          maxQuantity: z.number().int().min(1).max(3),
          governmentSubsidy: z.object({
            enabled: z.boolean(),
            category: z.enum(["appliance", "digital", "other"]),
            mode: z.enum(["percent", "fixed"]),
            rateBps: z.number().int().min(0).max(10000),
            amount: money,
          }).strict().optional(),
        }),
      )
      .max(20),
    rules: z
      .array(
        z.object({
          id,
          name: z.string().min(1).max(150),
          stage: z.enum(["shop", "platform", "shipping"]),
          kind: z.enum(["fixed", "every_full", "percent"]),
          shop: z.string().max(100),
          lineIds: z.array(id).max(20),
          threshold: money,
          amount: money,
          rateBps: z.number().int().min(0).max(10000),
          cap: money,
          minQuantity: z.number().int().min(1).max(999),
          basis: z.enum(["original", "after_item", "after_shop", "current"]),
          exclusiveGroup: z.string().max(100),
          enabled: z.boolean(),
          claimed: z.boolean(),
          verified: z.boolean(),
          startsAt: date,
          endsAt: date,
          sourceUrl: z
            .string()
            .max(1000)
            .refine((s) => !s || /^https?:\/\//.test(s), "来源须为HTTP(S)链接"),
        }),
      )
      .max(20),
    shipping: z
      .array(
        z.object({
          id,
          shop: z.string().min(1).max(100),
          fee: money,
          freeOver: money,
          known: z.boolean(),
        }),
      )
      .max(20),
    assetDeduction: money,
    adjustment: signed,
    adjustmentReason: z.string().max(500),
    notes: z.string().max(3000),
  })
  .superRefine((p, ctx) => {
    const fail = (message: string) =>
      ctx.addIssue({ code: z.ZodIssueCode.custom, message });
    if (
      new Set(p.lines.map((l) => l.id)).size !== p.lines.length ||
      new Set(p.rules.map((r) => r.id)).size !== p.rules.length
    )
      fail("商品或优惠ID重复");
    if (
      new Set(p.shipping.map((s) => s.shop)).size !== p.shipping.length ||
      new Set(p.shipping.map((s) => s.id)).size !== p.shipping.length
    )
      fail("运费组重复");
    if (p.rules.filter((r) => r.stage === "platform").length > 8)
      fail("首版最多8张平台优惠");
    for (const l of p.lines)
      if (BigInt(l.directOff) > BigInt(l.price)) fail("单品直降不能超过单价");
    for (const r of p.rules) {
      if (r.kind === "every_full" && BigInt(r.threshold) === 0n)
        fail("每满优惠门槛须大于0");
      if (r.stage !== "platform" && !r.shop) fail("店铺与运费优惠必须指定店铺");
      if (r.stage === "shipping" && r.kind !== "fixed")
        fail("首版运费券仅支持固定减免");
      if (r.stage === "shipping" && (r.lineIds.length || r.minQuantity !== 1))
        fail("首版运费券只按店铺运费使用，不支持商品范围或件数门槛");
      if (r.stage === "shop" && !["original", "after_item"].includes(r.basis))
        fail("店铺优惠须使用原价或单品优惠后基数");
      if (r.startsAt && r.endsAt && r.startsAt >= r.endsAt)
        fail("有效期结束须晚于开始");
      if (r.lineIds.some((id) => !p.lines.some((l) => l.id === id)))
        fail("优惠引用了不存在的商品");
    }
    if (BigInt(p.adjustment) !== 0n && !p.adjustmentReason.trim())
      fail("人工校准须填写原因");
  });
export const saveSchema = z.object({
  expectedRevision: z.number().int().positive(),
  document: planSchema,
});
