export const ENGINE_VERSION = "0.2.0";
export const subsidyPresets = [
  { value: "appliance", label: "家电（模拟预设15%）", rateBps: 1500 },
  { value: "digital", label: "数码（自定比例）", rateBps: 0 },
  { value: "other", label: "其他（自定比例）", rateBps: 0 },
] as const;
export type GovernmentSubsidy = {
  enabled: boolean;
  category: "appliance" | "digital" | "other";
  mode: "percent" | "fixed";
  rateBps: number;
  amount: string;
};
export type Line = {
  id: string;
  shop: string;
  name: string;
  spec: string;
  price: string;
  quantity: number;
  directOff: string;
  selected: boolean;
  role: "required" | "optional" | "filler";
  eligibility: "confirmed" | "unknown";
  maxQuantity: number;
  governmentSubsidy?: GovernmentSubsidy;
};
export type Rule = {
  id: string;
  name: string;
  stage: "shop" | "platform" | "shipping";
  kind: "fixed" | "every_full" | "percent";
  shop: string;
  lineIds: string[];
  threshold: string;
  amount: string;
  rateBps: number;
  cap: string;
  minQuantity: number;
  basis: "original" | "after_item" | "after_shop" | "current";
  exclusiveGroup: string;
  enabled: boolean;
  claimed: boolean;
  verified: boolean;
  startsAt: string;
  endsAt: string;
  sourceUrl: string;
};
export type Shipping = {
  id: string;
  shop: string;
  fee: string;
  freeOver: string;
  known: boolean;
};
export type Plan = {
  schemaVersion: 1;
  title: string;
  platform: "taobao";
  account: string;
  policy: "taobao_2026" | "custom";
  valuationTime: string;
  lines: Line[];
  rules: Rule[];
  shipping: Shipping[];
  assetDeduction: string;
  adjustment: string;
  adjustmentReason: string;
  notes: string;
};
export type Trace = {
  id: string;
  name: string;
  stage: string;
  amount: string;
  allocations: Record<string, string>;
  basis: string;
};
export type RuleStatus = {
  id: string;
  code: string;
  detail: string;
  gap: string;
};
export type Result = {
  engineVersion: string;
  original: string;
  itemDiscount: string;
  promotionDiscount: string;
  governmentSubsidy: string;
  goods: string;
  shipping: string;
  shippingDiscount: string;
  assets: string;
  adjustment: string;
  cash: string;
  lines: { id: string; original: string; payable: string }[];
  trace: Trace[];
  statuses: RuleStatus[];
  warnings: string[];
  certainty: "confirmed_inputs" | "assumption_based" | "incomplete";
};
const min = (a: bigint, b: bigint) => (a < b ? a : b);
const sum = (xs: bigint[]) => xs.reduce((a, b) => a + b, 0n);
function manualSubsidyAmount(line: Line, basis: bigint): bigint {
  const subsidy = line.governmentSubsidy;
  if (!subsidy?.enabled) return 0n;
  const requested = subsidy.mode === "percent"
    ? (basis * BigInt(subsidy.rateBps) + 5000n) / 10000n
    : BigInt(subsidy.amount) * BigInt(line.quantity);
  return min(basis, requested);
}
export function cents(value: string): string {
  if (!/^\d+(\.\d{0,2})?$/.test(value)) throw new Error("金额最多保留两位小数");
  const [a, b = ""] = value.split(".");
  return (BigInt(a) * 100n + BigInt(b.padEnd(2, "0"))).toString();
}
export function yuan(value: string): string {
  const n = BigInt(value);
  const a = n < 0n ? -n : n;
  return `${n < 0n ? "-" : ""}${a / 100n}.${(a % 100n).toString().padStart(2, "0")}`;
}
export function allocate(
  amount: bigint,
  weights: Record<string, bigint>,
): Record<string, bigint> {
  const entries = Object.entries(weights)
    .filter(([, v]) => v > 0n)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const total = sum(entries.map(([, v]) => v));
  const used = min(amount, total);
  if (!total || !used) return {};
  const rows = entries.map(([id, w]) => ({
    id,
    amount: (used * w) / total,
    remainder: (used * w) % total,
  }));
  let rest = used - sum(rows.map((r) => r.amount));
  for (const row of [...rows].sort((a, b) =>
    a.remainder === b.remainder
      ? a.id < b.id
        ? -1
        : 1
      : a.remainder > b.remainder
        ? -1
        : 1,
  )) {
    if (!rest) break;
    row.amount++;
    rest--;
  }
  return Object.fromEntries(rows.map((r) => [r.id, r.amount]));
}
type State = { amounts: Record<string, bigint>; trace: Trace[]; used: Rule[] };
export function calculate(plan: Plan): Result {
  const lines = plan.lines.filter((l) => l.selected && l.quantity > 0);
  const original = Object.fromEntries(
    lines.map((l) => [l.id, BigInt(l.price) * BigInt(l.quantity)]),
  );
  const item = Object.fromEntries(
    lines.map((l) => [
      l.id,
      (BigInt(l.price) - min(BigInt(l.price), BigInt(l.directOff))) *
        BigInt(l.quantity),
    ]),
  );
  const warnings: string[] = [];
  if (lines.some((l) => l.eligibility === "unknown"))
    warnings.push("部分商品的活动资格待核实，相关优惠未自动应用");
  if (plan.policy === "custom")
    warnings.push("自定义模拟策略，不代表平台通用叠加规则");
  else if (plan.rules.some((r) => r.stage === "shop" && r.enabled))
    warnings.push("店铺优惠按每店一个判定组择优，复杂子订单拆分尚未支持");
  const now = Date.parse(plan.valuationTime);
  const status = new Map<string, RuleStatus>();
  const active = plan.rules.filter((r) => {
    let code = "";
    if (!r.enabled) code = "DISABLED";
    else if (!r.claimed) code = "UNCLAIMED";
    else if (!r.verified) code = "UNVERIFIED";
    else if (r.startsAt && now < Date.parse(r.startsAt)) code = "NOT_STARTED";
    else if (r.endsAt && now >= Date.parse(r.endsAt)) code = "EXPIRED";
    if (code)
      status.set(r.id, { id: r.id, code, detail: reason(code), gap: "0" });
    return !code;
  });
  const scoped = (r: Rule) =>
    lines.filter(
      (l) =>
        (!r.shop || l.shop === r.shop) &&
        (!r.lineIds.length || r.lineIds.includes(l.id)) &&
        l.eligibility === "confirmed",
    );
  let shopAmounts = { ...item };
  function inspect(
    r: Rule,
    state: State,
  ): {
    amount: bigint;
    basis: bigint;
    weights: Record<string, bigint>;
    code: string;
    gap: bigint;
  } {
    const ls = scoped(r);
    const source =
      r.basis === "original"
        ? original
        : r.basis === "after_item"
          ? item
          : r.basis === "after_shop"
            ? shopAmounts
            : state.amounts;
    const basis = sum(ls.map((l) => source[l.id] || 0n));
    const threshold = BigInt(r.threshold);
    const weights = Object.fromEntries(
      ls.map((l) => [l.id, state.amounts[l.id] || 0n]),
    );
    if (!ls.length)
      return { amount: 0n, basis, weights, code: "SCOPE_MISMATCH", gap: 0n };
    if (
      basis < threshold ||
      sum(ls.map((l) => BigInt(l.quantity))) < BigInt(r.minQuantity)
    )
      return {
        amount: 0n,
        basis,
        weights,
        code: "THRESHOLD_NOT_MET",
        gap: threshold > basis ? threshold - basis : 0n,
      };
    const available = sum(Object.values(weights));
    let amount =
      r.kind === "percent"
        ? (available * BigInt(10000 - r.rateBps) + 5000n) / 10000n
        : r.kind === "every_full"
          ? (basis / threshold) * BigInt(r.amount)
          : BigInt(r.amount);
    if (BigInt(r.cap)) amount = min(amount, BigInt(r.cap));
    return {
      amount: min(amount, available),
      basis,
      weights,
      code: amount > 0n ? "AVAILABLE" : "NO_BENEFIT",
      gap: 0n,
    };
  }
  function apply(r: Rule, state: State): State | null {
    const v = inspect(r, state);
    if (!v.amount) return null;
    const allocations = allocate(v.amount, v.weights);
    const amounts = { ...state.amounts };
    for (const [id, a] of Object.entries(allocations)) amounts[id] -= a;
    return {
      amounts,
      used: [...state.used, r],
      trace: [
        ...state.trace,
        {
          id: r.id,
          name: r.name,
          stage: r.stage,
          amount: v.amount.toString(),
          basis: v.basis.toString(),
          allocations: Object.fromEntries(
            Object.entries(allocations).map(([k, v]) => [k, v.toString()]),
          ),
        },
      ],
    };
  }
  let state: State = { amounts: { ...item }, trace: [], used: [] };
  const shopRules = active.filter((r) => r.stage === "shop");
  // The supported Taobao policy chooses one shop promotion per configured shop group.
  for (const shop of [...new Set(shopRules.map((r) => r.shop))].sort()) {
    const candidates = shopRules.filter((r) => r.shop === shop);
    let best = state;
    for (const r of candidates) {
      const next = apply(r, state);
      if (
        next &&
        sum(Object.values(next.amounts)) < sum(Object.values(best.amounts))
      )
        best = next;
    }
    state = best;
  }
  shopAmounts = { ...state.amounts };
  const platform = active.filter((r) => r.stage === "platform");
  let best = state;
  const afterSubsidy = (s: State) => sum(lines.map((l) =>
    s.amounts[l.id] - manualSubsidyAmount(l, s.amounts[l.id]),
  ));
  function search(i: number, s: State) {
    if (i === platform.length) {
      if (afterSubsidy(s) < afterSubsidy(best))
        best = s;
      return;
    }
    search(i + 1, s);
    const r = platform[i];
    if (
      r.exclusiveGroup &&
      s.used.some(
        (u) => u.stage === "platform" && u.exclusiveGroup === r.exclusiveGroup,
      )
    )
      return;
    const next = apply(r, s);
    if (next) search(i + 1, next);
  }
  search(0, state);
  state = best;
  for (const r of active.filter((r) => r.stage !== "shipping")) {
    const applied = state.trace.find((t) => t.id === r.id);
    const v = inspect(r, {
      ...state,
      amounts: r.stage === "shop" ? item : shopAmounts,
    });
    const code = applied
      ? "APPLIED"
      : v.code === "AVAILABLE"
        ? "CONFLICT"
        : v.code;
    status.set(r.id, {
      id: r.id,
      code,
      detail: reason(code),
      gap: v.gap.toString(),
    });
  }
  let shippingBefore = 0n,
    shippingAfter = 0n;
  const selectedShops = new Set(lines.map((l) => l.shop));
  for (const shop of selectedShops) {
    const group = plan.shipping.find((g) => g.shop === shop);
    if (!group || !group.known) {
      warnings.push(`${shop}的运费待确认`);
      continue;
    }
    const shopGoods = sum(
      lines.filter((l) => l.shop === shop).map((l) => state.amounts[l.id]),
    );
    const fee =
      BigInt(group.freeOver) > 0n && shopGoods >= BigInt(group.freeOver)
        ? 0n
        : BigInt(group.fee);
    shippingBefore += fee;
    let discount = 0n;
    let chosen: Rule | undefined;
    for (const r of active.filter(
      (r) => r.stage === "shipping" && r.shop === shop,
    )) {
      const potential = min(
        fee,
        BigInt(r.cap) > 0n
          ? min(BigInt(r.amount), BigInt(r.cap))
          : BigInt(r.amount),
      );
      if (fee >= BigInt(r.threshold) && potential > discount) {
        discount = potential;
        chosen = r;
      }
    }
    shippingAfter += fee - discount;
    if (chosen && discount) {
      state.trace.push({
        id: chosen.id,
        name: chosen.name,
        stage: "shipping",
        amount: discount.toString(),
        basis: fee.toString(),
        allocations: { [group.id]: discount.toString() },
      });
    }
  }
  for (const r of active.filter((r) => r.stage === "shipping")) {
    const used = state.trace.some((t) => t.id === r.id);
    status.set(r.id, {
      id: r.id,
      code: used ? "APPLIED" : "NO_BENEFIT",
      detail: used ? "已生效" : "运费不足或未被择优选中",
      gap: "0",
    });
  }
  const goodsBeforeSubsidy = sum(Object.values(state.amounts));
  let governmentSubsidy = 0n;
  // Manual simulation: after promotions, without changing coupon or shipping thresholds.
  for (const line of lines) {
    const subsidy = line.governmentSubsidy;
    if (!subsidy?.enabled) continue;
    const basis = state.amounts[line.id];
    const amount = manualSubsidyAmount(line, basis);
    governmentSubsidy += amount;
    state.amounts[line.id] -= amount;
    if (amount > 0n) state.trace.push({
      id: `government:${line.id}`,
      name: `${line.name} · 手动国补`,
      stage: "government_subsidy",
      amount: amount.toString(),
      basis: basis.toString(),
      allocations: { [line.id]: amount.toString() },
    });
  }
  if (lines.some((l) => l.governmentSubsidy?.enabled))
    warnings.push("国补按手动设置模拟：按店铺/平台优惠后商品金额计算，不改变券及包邮门槛，先于账户资产抵扣；未核验官方资格、封顶或叠加规则");
  const goods = goodsBeforeSubsidy - governmentSubsidy;
  const assets = min(BigInt(plan.assetDeduction), goods + shippingAfter);
  const raw = goods + shippingAfter - assets;
  let adjustment = BigInt(plan.adjustment);
  if (adjustment < -raw) adjustment = -raw;
  if (adjustment) warnings.push("包含人工校准金额");
  if (assets) warnings.push("资产抵扣按手填额度模拟，请核对平台可抵范围");
  if (plan.rules.some((r) => r.enabled && !r.verified))
    warnings.push("未核实优惠已排除，不计入当前优惠");
  if (state.trace.length)
    warnings.push("优惠按已确认的录入条件模拟；逐行分摊采用内部最大余数法");
  const incomplete =
    lines.some((l) => l.eligibility === "unknown") ||
    [...selectedShops].some(
      (s) => !plan.shipping.find((g) => g.shop === s)?.known,
    );
  return {
    engineVersion: ENGINE_VERSION,
    original: sum(Object.values(original)).toString(),
    itemDiscount: (
      sum(Object.values(original)) - sum(Object.values(item))
    ).toString(),
    promotionDiscount: (sum(Object.values(item)) - goodsBeforeSubsidy).toString(),
    governmentSubsidy: governmentSubsidy.toString(),
    goods: goods.toString(),
    shipping: shippingAfter.toString(),
    shippingDiscount: (shippingBefore - shippingAfter).toString(),
    assets: assets.toString(),
    adjustment: adjustment.toString(),
    cash: (raw + adjustment).toString(),
    lines: lines.map((l) => ({
      id: l.id,
      original: original[l.id].toString(),
      payable: state.amounts[l.id].toString(),
    })),
    trace: state.trace,
    statuses: plan.rules.map((r) => status.get(r.id)!),
    warnings: [...new Set(warnings)],
    certainty: incomplete
      ? "incomplete"
      : warnings.length
        ? "assumption_based"
        : "confirmed_inputs",
  };
}
function reason(code: string) {
  return (
    (
      {
        DISABLED: "本次已停用",
        UNCLAIMED: "尚未领取",
        UNVERIFIED: "规则待核实",
        NOT_STARTED: "尚未开始",
        EXPIRED: "已过期",
        SCOPE_MISMATCH: "没有已确认资格的适用商品",
        THRESHOLD_NOT_MET: "未满足金额或件数门槛",
        NO_BENEFIT: "无可抵扣金额",
        CONFLICT: "互斥或另一组合优惠更大",
        APPLIED: "已生效",
      } as Record<string, string>
    )[code] || code
  );
}
export const ruleDefaults: Omit<Rule, "id" | "name"> = {
  stage: "shop",
  kind: "fixed",
  shop: "",
  lineIds: [],
  threshold: "0",
  amount: "0",
  rateBps: 9000,
  cap: "0",
  minQuantity: 1,
  basis: "after_item",
  exclusiveGroup: "platform_coupon",
  enabled: true,
  claimed: true,
  verified: false,
  startsAt: "",
  endsAt: "",
  sourceUrl: "",
};
export function examplePlan(): Plan {
  const line = (
    id: string,
    shop: string,
    name: string,
    price: string,
  ): Line => ({
    id,
    shop,
    name,
    price,
    spec: "标准规格",
    quantity: 1,
    directOff: "0",
    selected: true,
    role: "required",
    eligibility: "confirmed",
    maxQuantity: 1,
  });
  return {
    schemaVersion: 1,
    title: "多店凑单 · 示例",
    platform: "taobao",
    account: "我的淘宝账号",
    policy: "custom",
    valuationTime: new Date().toISOString(),
    lines: [
      {
        ...line("a1", "青禾生活", "棉质短袖 T 恤", "18000"),
        directOff: "2000",
      },
      line("a2", "青禾生活", "宽松休闲长裤", "12000"),
      line("b1", "日常好物", "帆布通勤包", "11000"),
      line("b2", "日常好物", "轻量折叠伞", "9000"),
    ],
    rules: [
      {
        ...ruleDefaults,
        id: "shop30",
        name: "青禾 · 满250减30",
        shop: "青禾生活",
        threshold: "25000",
        amount: "3000",
        verified: true,
      },
      {
        ...ruleDefaults,
        id: "platform40",
        name: "跨店 · 满400减40",
        stage: "platform",
        basis: "after_shop",
        threshold: "40000",
        amount: "4000",
        verified: true,
      },
      {
        ...ruleDefaults,
        id: "ship5",
        name: "青禾 · 运费减5",
        stage: "shipping",
        shop: "青禾生活",
        amount: "500",
        verified: true,
      },
    ],
    shipping: [
      { id: "sa", shop: "青禾生活", fee: "800", freeOver: "0", known: true },
      { id: "sb", shop: "日常好物", fee: "1000", freeOver: "0", known: true },
    ],
    assetDeduction: "1000",
    adjustment: "0",
    adjustmentReason: "",
    notes:
      "自定义验收示例：商品410 + 运费13 - 红包10 = 413。不是淘宝通用活动规则。",
  };
}
export function emptyPlan(): Plan {
  return {
    ...examplePlan(),
    title: "新的凑单方案",
    policy: "taobao_2026",
    lines: [],
    rules: [],
    shipping: [],
    assetDeduction: "0",
    notes: "",
  };
}
export type SearchResult = {
  plans: { plan: Plan; result: Result }[];
  baseline: Result;
  visited: number;
  status: "exhaustive" | "best_found";
};
export function optimize(
  plan: Plan,
  maxMs = 2500,
  maxNodes = 8000,
): SearchResult {
  const start = performance.now();
  const baselinePlan = structuredClone(plan);
  baselinePlan.lines = baselinePlan.lines.map((l) => ({
    ...l,
    selected: l.role === "required",
  }));
  const baseline = calculate(baselinePlan);
  const candidates: { plan: Plan; result: Result }[] = [];
  let visited = 0,
    stopped = false;
  const work = structuredClone(plan);
  function visit(i: number) {
    if (visited >= maxNodes || performance.now() - start > maxMs) {
      stopped = true;
      return;
    }
    if (i === work.lines.length) {
      visited++;
      const result = calculate(work);
      if (result.certainty === "incomplete") return;
      candidates.push({ plan: structuredClone(work), result });
      candidates.sort((a, b) =>
        BigInt(a.result.cash) < BigInt(b.result.cash)
          ? -1
          : BigInt(a.result.cash) > BigInt(b.result.cash)
            ? 1
            : 0,
      );
      if (candidates.length > 5) candidates.pop();
      return;
    }
    const l = work.lines[i];
    if (l.role === "required") {
      l.selected = true;
      visit(i + 1);
      return;
    }
    for (let q = 0; q <= Math.min(l.maxQuantity, 3); q++) {
      l.selected = q > 0;
      l.quantity = q || 1;
      visit(i + 1);
      if (stopped) break;
    }
  }
  visit(0);
  return {
    plans: candidates,
    baseline,
    visited,
    status: stopped ? "best_found" : "exhaustive",
  };
}
