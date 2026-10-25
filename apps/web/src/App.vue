<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useQuery, useQueryClient } from "@tanstack/vue-query";
import {
  NConfigProvider,
  NModal,
  NInput,
  NInputNumber,
  NSelect,
  NDropdown,
  NCheckbox,
  NButton,
  NDatePicker,
  NTag,
  NSpin,
} from "naive-ui";
import {
  Plus,
  ShoppingBag,
  Ticket,
  Settings2,
  History,
  Download,
  Copy,
  Trash2,
  X,
  Check,
  ChevronDown,
  ArrowRight,
  Sparkles,
  RotateCcw,
  Save,
  KeyRound,
  LogOut,
  Search,
  CircleHelp,
  SlidersHorizontal,
  ExternalLink,
  Upload,
  Package,
  Pencil,
  ReceiptText,
} from "lucide-vue-next";
import {
  ENGINE_VERSION,
  examplePlan,
  emptyPlan,
  yuan,
  cents,
  ruleDefaults,
  subsidyPresets,
  type Plan,
  type Line,
  type Rule,
  type Result,
  type SearchResult,
} from "@kousou/core";
import { planSchema } from "@kousou/contracts";
import { api } from "./api";
const theme = {
  common: {
    primaryColor: "#14775d",
    primaryColorHover: "#0d654e",
    primaryColorPressed: "#0b5643",
    borderRadius: "6px",
    fontFamily:
      'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif',
  },
};
const route = useRoute(),
  router = useRouter(),
  queryClient = useQueryClient();
const ready = ref(false),
  checking = ref(true),
  authBusy = ref(false),
  error = ref(""),
  notice = ref(""),
  recovery = ref(""),
  recoveryInput = ref("");
const plan = ref<Plan>(emptyPlan()),
  planId = ref(""),
  revision = ref(0),
  loaded = ref(false),
  loading = ref(false),
  saveState = ref("已保存"),
  dirty = ref(false),
  conflict = ref(false),
  result = ref<Result | null>(null),
  calcError = ref(""),
  activeTab = ref("goods");
const modal = ref(""),
  editLine = ref<any>(null),
  editRule = ref<any>(null),
  lineIsNew = ref(false),
  ruleIsNew = ref(false),
  filter = ref("all"),
  query = ref("");
watch(() => editRule.value?.stage, (stage) => {
  if (!editRule.value) return;
  if (stage === "shipping") {
    Object.assign(editRule.value, { kind: "fixed", lineIds: [], minQuantity: 1, basis: "current" });
  } else if (stage === "shop" && !["original", "after_item"].includes(editRule.value.basis)) {
    editRule.value.basis = "after_item";
  }
});
const snapshots = ref<any[]>([]),
  searchResult = ref<SearchResult | null>(null),
  searching = ref(false),
  searchBasis = ref(""),
  traceLine = ref("");
let worker: Worker;
let requestId = 0,
  calcId = 0,
  searchId = 0,
  saveTimer: ReturnType<typeof setTimeout> | undefined,
  loadEpoch = 0;
let savePromise: Promise<boolean> | null = null;
let version = 0;
const plansQuery = useQuery({
  queryKey: ["plans"],
  queryFn: () => api<any[]>("/plans"),
  enabled: ready,
});
const shops = computed(() => [...new Set(plan.value.lines.map((l) => l.shop))]);
const groups = computed(() =>
  shops.value
    .map((shop) => ({
      shop,
      lines: plan.value.lines.filter(
        (l) =>
          l.shop === shop && (!query.value || l.name.includes(query.value)),
      ),
    }))
    .filter((g) => g.lines.length),
);
const money = (s: string | undefined) => yuan(s || "0");
const selectedCount = computed(() =>
  plan.value.lines
    .filter((l) => l.selected)
    .reduce((n, l) => n + l.quantity, 0),
);
const planOptions = computed(
  () =>
    plansQuery.data.value?.map((p) => ({ label: p.title, value: p.id })) || [],
);
const statusMap = computed(
  () => new Map(result.value?.statuses.map((s) => [s.id, s]) || []),
);
const filteredRules = computed(() =>
  plan.value.rules.filter(
    (r) =>
      filter.value === "all" ||
      (filter.value === "applied"
        ? statusMap.value.get(r.id)?.code === "APPLIED"
        : statusMap.value.get(r.id)?.code !== "APPLIED"),
  ),
);
const hasUnknown = computed(() => result.value?.certainty === "incomplete");
const snapshotResult = computed(() =>
  traceLine.value
    ? result.value?.trace.filter((t) => t.allocations[traceLine.value])
    : result.value?.trace || [],
);
function toast(s: string) {
  notice.value = s;
  setTimeout(() => {
    if (notice.value === s) notice.value = "";
  }, 4000);
}
function workerStart() {
  worker = new Worker(new URL("./workers/pricing.worker.ts", import.meta.url), {
    type: "module",
  });
  worker.onmessage = ({ data }) => {
    if (data.kind === "calculate" && data.id === calcId) {
      if (data.error) {
        calcError.value = data.error;
        result.value = null;
      } else {
        result.value = data.result;
        calcError.value = "";
      }
    }
    if (data.kind === "optimize" && data.id === searchId) {
      searching.value = false;
      if (data.error) error.value = data.error;
      else if (searchBasis.value === JSON.stringify(plan.value)) {
        searchResult.value = data.result;
        modal.value = "search";
      }
    }
  };
}
function calculateNow() {
  if (!loaded.value) return;
  calcId = ++requestId;
  worker.postMessage({
    kind: "calculate",
    id: calcId,
    plan: JSON.parse(JSON.stringify(plan.value)),
  });
}
function cancelSearch() {
  if (searching.value) {
    worker.terminate();
    workerStart();
    searching.value = false;
    searchId = ++requestId;
    calculateNow();
  }
}
watch(
  plan,
  () => {
    if (!loaded.value) return;
    version++;
    dirty.value = true;
    saveState.value = "未保存";
    searchResult.value = null;
    cancelSearch();
    calculateNow();
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => void persist(), 650);
  },
  { deep: true },
);
async function persist(): Promise<boolean> {
  if (savePromise) {
    await savePromise;
    return dirty.value && !conflict.value ? persist() : !dirty.value;
  }
  if (!dirty.value || !planId.value) return true;
  if (conflict.value) return false;
  const current = JSON.parse(JSON.stringify(plan.value));
  const capturedVersion = version,
    id = planId.value,
    rev = revision.value;
  const validation = planSchema.safeParse(current);
  if (!validation.success) {
    saveState.value = "填写不完整";
    return false;
  }
  saveState.value = "保存中";
  savePromise = (async () => {
    try {
      const row = await api(`/plans/${id}`, "PUT", {
        expectedRevision: rev,
        document: current,
      });
      if (id === planId.value) {
        revision.value = row.revision;
        if (version === capturedVersion) {
          dirty.value = false;
          saveState.value = "已保存";
        } else saveState.value = "未保存";
      }
      void queryClient.invalidateQueries({ queryKey: ["plans"] });
      return true;
    } catch (e: any) {
      if (e.status === 409) conflict.value = true;
      saveState.value = e.status === 409 ? "版本冲突" : "保存失败";
      error.value = e.message;
      return false;
    } finally {
      savePromise = null;
    }
  })();
  const saved = await savePromise;
  return saved && dirty.value && !conflict.value
    ? persist()
    : saved && !dirty.value;
}
async function load(id: string, discard = false) {
  if (loading.value) return;
  if (!discard && dirty.value && !(await persist())) return;
  const epoch = ++loadEpoch;
  loading.value = true;
  loaded.value = false;
  clearTimeout(saveTimer);
  cancelSearch();
  try {
    const row = await api(`/plans/${id}`);
    if (epoch !== loadEpoch) return;
    plan.value = row.document;
    planId.value = id;
    revision.value = row.revision;
    dirty.value = false;
    conflict.value = false;
    saveState.value = "已保存";
    result.value = null;
    searchResult.value = null;
    await router.replace({ path: "/", query: { plan: id } });
    await new Promise((resolve) => setTimeout(resolve, 0));
    loaded.value = true;
    calculateNow();
  } catch (e: any) {
    error.value = e.message;
    loaded.value = !!planId.value;
  } finally {
    loading.value = false;
  }
}
async function choose(id: string) {
  await load(id);
}
async function create(example = false, copy = false) {
  if (dirty.value && !copy && !(await persist())) return;
  try {
    const row = await api(
      "/plans",
      "POST",
      copy
        ? {
            document: {
              ...JSON.parse(JSON.stringify(plan.value)),
              title: plan.value.title + " · 副本",
            },
          }
        : { example },
    );
    dirty.value = false;
    await queryClient.invalidateQueries({ queryKey: ["plans"] });
    await load(row.id, true);
    modal.value = "";
  } catch (e: any) {
    error.value = e.message;
  }
}
async function initialize() {
  const session = await api("/session");
  if (session.engineVersion !== ENGINE_VERSION)
    throw new Error("页面版本已过期，请先刷新");
  ready.value = true;
  const rows = await api<any[]>("/plans");
  if (rows.length)
    await load(
      typeof route.query.plan === "string" ? route.query.plan : rows[0].id,
      true,
    );
  else modal.value = "welcome";
}
async function start(recover = false) {
  authBusy.value = true;
  error.value = "";
  try {
    const r = await api(
      recover ? "/sessions/recover" : "/workspaces",
      "POST",
      recover ? { key: recoveryInput.value } : {},
    );
    if (r.recoveryKey) recovery.value = r.recoveryKey;
    await initialize();
  } catch (e: any) {
    error.value = e.message;
  } finally {
    authBusy.value = false;
  }
}
async function snapshot() {
  try {
    if (!(await persist())) return;
    await api(`/plans/${planId.value}/snapshots`, "POST", {
      expectedRevision: revision.value,
      requestId: crypto.randomUUID(),
    });
    toast("快照已由服务端重新计算并保存");
  } catch (e: any) {
    error.value = e.message;
  }
}
async function history() {
  try {
    snapshots.value = await api(`/plans/${planId.value}/snapshots`);
    modal.value = "history";
  } catch (e: any) {
    error.value = e.message;
  }
}
async function duplicate() {
  await create(false, true);
}
async function removePlan() {
  try {
    await api(`/plans/${planId.value}`, "DELETE", {
      expectedRevision: revision.value,
    });
    loaded.value = false;
    dirty.value = false;
    planId.value = "";
    modal.value = "";
    const rows = await api<any[]>("/plans");
    await queryClient.invalidateQueries({ queryKey: ["plans"] });
    if (rows.length) await load(rows[0].id, true);
    else modal.value = "welcome";
  } catch (e: any) {
    error.value = e.message;
  }
}
function openLine(line?: Line) {
  lineIsNew.value = !line;
  editLine.value = line
    ? {
        ...line,
        priceInput: money(line.price),
        offInput: money(line.directOff),
      }
    : {
        id: crypto.randomUUID(),
        name: "",
        shop: shops.value[0] || "",
        spec: "",
        priceInput: "",
        offInput: "0",
        quantity: 1,
        maxQuantity: 1,
        selected: true,
        role: "required",
        eligibility: "unknown",
      };
  modal.value = "line";
  const subsidy = line?.governmentSubsidy;
  editLine.value.governmentSubsidy = subsidy
    ? { ...subsidy }
    : { enabled: false, category: "appliance", mode: "percent", rateBps: 1500, amount: "0" };
  editLine.value.subsidyRate = editLine.value.governmentSubsidy.rateBps / 100;
  editLine.value.subsidyAmount = money(editLine.value.governmentSubsidy.amount);
}
function changeSubsidyCategory(category: string) {
  editLine.value.governmentSubsidy.category = category;
  editLine.value.subsidyRate = (subsidyPresets.find((p) => p.value === category)?.rateBps || 0) / 100;
}
function storeLine() {
  try {
    const l = editLine.value;
    const value = {
      id: l.id,
      name: l.name.trim(),
      shop: l.shop.trim(),
      spec: l.spec,
      price: cents(l.priceInput),
      directOff: cents(l.offInput || "0"),
      quantity: l.quantity,
      maxQuantity: l.maxQuantity,
      selected: l.selected,
      role: l.role,
      eligibility: l.eligibility,
      governmentSubsidy: {
        ...l.governmentSubsidy,
        rateBps: Number(cents(String(l.subsidyRate ?? 0))),
        amount: cents(l.subsidyAmount || "0"),
      },
    } as Line;
    const next = structuredClone(JSON.parse(JSON.stringify(plan.value)));
    const idx = next.lines.findIndex((x: Line) => x.id === l.id);
    if (idx < 0) next.lines.push(value);
    else next.lines[idx] = value;
    if (!next.shipping.some((s: any) => s.shop === value.shop))
      next.shipping.push({
        id: crypto.randomUUID(),
        shop: value.shop,
        fee: "0",
        freeOver: "0",
        known: false,
      });
    planSchema.parse(next);
    plan.value = next;
    modal.value = "";
  } catch (e: any) {
    error.value = e.issues?.[0]?.message || e.message;
  }
}
function removeLine(id: string) {
  plan.value.rules.forEach((r) => {
    if (r.lineIds.includes(id)) {
      r.lineIds = r.lineIds.filter((x) => x !== id);
      if (!r.lineIds.length) r.enabled = false;
    }
  });
  plan.value.lines = plan.value.lines.filter((l) => l.id !== id);
}
function openRule(rule?: Rule) {
  ruleIsNew.value = !rule;
  editRule.value = {
    ...(rule
      ? JSON.parse(JSON.stringify(rule))
      : {
          ...ruleDefaults,
          id: crypto.randomUUID(),
          name: "",
          shop: shops.value[0] || "",
        }),
    thresholdInput: money(rule?.threshold),
    amountInput: money(rule?.amount),
    capInput: money(rule?.cap),
    rateInput: (rule?.rateBps ?? 9000) / 1000,
  };
  modal.value = "rule";
}
function storeRule() {
  try {
    const r = editRule.value;
    const value: Rule = {
      id: r.id,
      name: r.name.trim(),
      stage: r.stage,
      kind: r.kind,
      shop: r.stage === "platform" ? "" : r.shop,
      lineIds: r.lineIds,
      threshold: cents(r.thresholdInput),
      amount: cents(r.amountInput),
      cap: cents(r.capInput),
      rateBps: Math.round(r.rateInput * 1000),
      minQuantity: r.minQuantity,
      basis: r.stage === "shipping" ? "current" : r.basis,
      exclusiveGroup: r.exclusiveGroup,
      enabled: r.enabled,
      claimed: r.claimed,
      verified: r.verified,
      startsAt: r.startsAt,
      endsAt: r.endsAt,
      sourceUrl: r.sourceUrl,
    };
    const next = JSON.parse(JSON.stringify(plan.value));
    const idx = next.rules.findIndex((x: Rule) => x.id === r.id);
    if (idx < 0) next.rules.push(value);
    else next.rules[idx] = value;
    planSchema.parse(next);
    plan.value = next;
    modal.value = "";
  } catch (e: any) {
    error.value = e.issues?.[0]?.message || e.message;
  }
}
function setShipping(shop: string, field: "fee" | "freeOver", value: string) {
  try {
    plan.value.shipping.find((s) => s.shop === shop)![field] = cents(
      value || "0",
    );
  } catch (e: any) {
    error.value = e.message;
  }
}
function setAmount(field: "assetDeduction" | "adjustment", value: string) {
  try {
    plan.value[field] =
      value.startsWith("-") && field === "adjustment"
        ? "-" + cents(value.slice(1))
        : cents(value || "0");
  } catch (e: any) {
    error.value = e.message;
  }
}
function search() {
  if (!plan.value.lines.some((l) => l.role === "required")) {
    error.value = "请至少保留一件必买商品";
    return;
  }
  if (hasUnknown.value) {
    error.value = "请先确认商品资格和各店运费";
    return;
  }
  searching.value = true;
  searchBasis.value = JSON.stringify(plan.value);
  searchId = ++requestId;
  worker.postMessage({
    kind: "optimize",
    id: searchId,
    plan: JSON.parse(JSON.stringify(plan.value)),
  });
}
function applyCandidate(p: Plan) {
  plan.value = JSON.parse(JSON.stringify(p));
  modal.value = "";
  toast("已应用凑单方案");
}
async function exportData() {
  try {
    if (!(await persist())) return;
    const data = await api("/export");
    download(JSON.stringify(data, null, 2), "kousou-export.json");
  } catch (e: any) {
    error.value = e.message;
  }
}
function download(text: string, name: string) {
  const url = URL.createObjectURL(
    new Blob([text], { type: "application/json" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}
async function importData(e: Event) {
  const input = e.target as HTMLInputElement;
  try {
    const file = input.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) throw new Error("文件不得超过2MB");
    const data = JSON.parse(await file.text());
    if (
      data.format !== "kousou" ||
      data.version !== 1 ||
      !Array.isArray(data.plans) ||
      data.plans.length > 30
    )
      throw new Error("不支持的导出格式");
    const documents = data.plans.map((p: any) => planSchema.parse(p));
    if (!(await persist())) return;
    let first = "";
    for (const document of documents) {
      const row = await api("/plans", "POST", { document });
      first ||= row.id;
    }
    await queryClient.invalidateQueries({ queryKey: ["plans"] });
    if (first) await load(first, true);
    toast(`已导入${documents.length}个方案`);
  } catch (e: any) {
    error.value = e.message;
  } finally {
    input.value = "";
  }
}
async function copyKey() {
  try {
    await navigator.clipboard.writeText(recovery.value);
    toast("恢复密钥已复制");
  } catch {
    toast("请选中密钥手动复制");
  }
}
async function rotateKey() {
  try {
    const data = await api("/workspace-keys/rotate", "POST", {});
    recovery.value = data.recoveryKey;
    modal.value = "settings";
    toast("密钥已轮换，其他设备已退出");
  } catch (e: any) {
    error.value = e.message;
  }
}
async function logout() {
  if (!(await persist())) return;
  await api("/sessions/logout", "POST", {});
  location.href = "/";
}
function beforeUnload(e: BeforeUnloadEvent) {
  if (dirty.value) {
    e.preventDefault();
    e.returnValue = "";
  }
}
onMounted(async () => {
  workerStart();
  window.addEventListener("beforeunload", beforeUnload);
  try {
    await initialize();
  } catch (e: any) {
    if (e.status !== 401) error.value = e.message;
  } finally {
    checking.value = false;
  }
});
onBeforeUnmount(() => {
  worker.terminate();
  clearTimeout(saveTimer);
  window.removeEventListener("beforeunload", beforeUnload);
});
</script>

<template>
  <n-config-provider :theme-overrides="theme">
    <div class="toast" v-if="notice"><Check :size="16" />{{ notice }}</div>
    <div class="error-banner" v-if="error" role="alert">
      <span>{{ error }}</span
      ><button class="icon-btn" aria-label="关闭错误" @click="error = ''">
        <X :size="16" />
      </button>
    </div>
    <div v-if="checking" class="initial-loading"><n-spin size="large" /></div>
    <div v-else-if="!ready" class="auth-page">
      <div class="auth-brand">
        <ShoppingBag :size="30" /> Kousou<span>凑单工作台</span>
      </div>
      <section class="auth-form">
        <span class="eyebrow">个人工作区</span>
        <h1>把每一笔优惠算清楚。</h1>
        <p>淘宝 / 天猫 · 多店铺结算</p>
        <n-button
          type="primary"
          size="large"
          block
          :loading="authBusy"
          @click="start(false)"
          >创建我的工作区 <ArrowRight :size="17"
        /></n-button>
        <div class="auth-divider">已有恢复密钥</div>
        <n-input
          v-model:value="recoveryInput"
          type="password"
          show-password-on="click"
          placeholder="输入工作区恢复密钥"
          aria-label="恢复密钥"
        /><n-button
          block
          :loading="authBusy"
          :disabled="!recoveryInput"
          @click="start(true)"
          >恢复工作区</n-button
        >
      </section>
    </div>
    <div v-else class="app-shell">
      <header class="topbar">
        <a class="brand" href="/" @click.prevent
          ><span class="brand-mark"><ShoppingBag :size="21" /></span>Kousou<span
            class="brand-caption"
            >凑单工作台</span
          ></a
        >
        <div class="top-right">
          <span class="platform-pill">淘宝 / 天猫</span
          ><button
            class="icon-btn"
            title="工作区设置"
            aria-label="工作区设置"
            @click="modal = 'settings'"
          >
            <Settings2 :size="18" />
          </button>
        </div>
      </header>
      <div v-if="recovery" class="key-banner">
        <KeyRound :size="17" /><span
          >请妥善保管恢复密钥，换设备时需要使用。</span
        ><button @click="modal = 'settings'">查看密钥</button
        ><button class="icon-btn" title="收起提醒" @click="recovery = ''">
          <X :size="15" />
        </button>
      </div>
      <div class="workspace-header">
        <div class="workspace-identity">
          <div class="title-row">
            <h1>{{ planId ? plan.title : "我的凑单方案" }}</h1>
            <n-dropdown
              v-if="planOptions.length"
              trigger="click"
              :options="planOptions.map((p) => ({ label: p.label, key: p.value }))"
              @select="choose"
            >
              <button class="icon-btn" title="切换方案" aria-label="切换方案">
                <ChevronDown :size="18" />
              </button>
            </n-dropdown>
          </div>
          <div v-if="planId" class="plan-meta">
            <span class="context-account" :title="plan.account">{{ plan.account }}</span>
            <span>{{ shops.length }} 家店铺 · 已选 {{ selectedCount }} 件</span>
            <span
              class="save-indicator"
              :class="{ bad: conflict || saveState === '保存失败' }"
              role="status"
              ><span />{{ saveState }}</span
            >
          </div>
        </div>
        <div class="workspace-actions">
          <template v-if="planId">
            <button class="icon-btn" title="结算设置" aria-label="结算设置" @click="modal = 'context'">
              <SlidersHorizontal :size="17" />
            </button>
            <button class="icon-btn" title="历史快照" aria-label="历史快照" @click="history">
              <History :size="17" />
            </button>
            <button class="icon-btn" title="复制方案" aria-label="复制方案" @click="duplicate">
              <Copy :size="16" />
            </button>
          </template>
          <n-button @click="modal = 'new'"
            ><template #icon><Plus :size="16" /></template>新建方案</n-button
          >
        </div>
      </div>
      <div v-if="conflict" class="conflict-banner">
        其他页面已修改这个方案。<n-button
          size="small"
          @click="load(planId, true)"
          >放弃本页改动并重载</n-button
        ><n-button size="small" @click="duplicate">另存本页副本</n-button>
      </div>
      <template v-if="planId">
        <nav class="mobile-tabs">
          <button
            v-for="t in [
              { id: 'goods', name: '商品' },
              { id: 'checkout', name: '结算' },
              { id: 'coupons', name: '优惠券' },
            ]"
            :class="{ active: activeTab === t.id }"
            @click="activeTab = t.id"
          >
            {{ t.name }}
          </button>
        </nav>
        <main class="workspace-grid">
          <section
            class="goods-panel"
            :class="{ 'mobile-active': activeTab === 'goods' }"
          >
            <div class="panel-heading">
              <h2>
                商品清单 <span>{{ plan.lines.length }}</span>
              </h2>
              <button class="text-btn" @click="openLine()">
                <Plus :size="16" />添加商品
              </button>
            </div>
            <div class="search-field">
              <Search :size="16" /><input
                v-model="query"
                placeholder="搜索商品"
                aria-label="搜索商品"
              />
            </div>
            <div v-if="!plan.lines.length" class="empty-state">
              <Package :size="36" />
              <h3>还没有商品</h3>
              <n-button @click="openLine()">添加第一件商品</n-button>
            </div>
            <section v-for="g in groups" :key="g.shop" class="shop-section">
              <div class="shop-heading">
                <n-checkbox
                  :checked="g.lines.every((l) => l.selected)"
                  :indeterminate="
                    g.lines.some((l) => l.selected) &&
                    !g.lines.every((l) => l.selected)
                  "
                  @update:checked="
                    (v) => g.lines.forEach((l) => (l.selected = v))
                  "
                  :aria-label="'选择' + g.shop"
                /><ShoppingBag :size="15" /><strong>{{ g.shop }}</strong
                ><span>{{ g.lines.length }} 款</span>
              </div>
              <article
                v-for="l in g.lines"
                :key="l.id"
                class="product-row"
                :class="{ unselected: !l.selected }"
              >
                <n-checkbox
                  v-model:checked="l.selected"
                  :aria-label="'选择' + l.name"
                />
                <div
                  class="product-art"
                  :class="'art-' + (plan.lines.indexOf(l) % 4)"
                >
                  <img
                    v-if="['a1', 'a2', 'b1'].includes(l.id)"
                    :src="
                      '/products/' +
                      ({ a1: 'shirt', a2: 'pants', b1: 'bag' } as any)[l.id] +
                      '.jpg'
                    "
                    alt="示例商品配图"
                  /><Package v-else :size="30" class="muted" />
                </div>
                <div class="product-body">
                  <div class="product-top">
                    <button class="product-name" @click="openLine(l)">
                      {{ l.name }}</button
                    ><button
                      class="icon-btn tiny"
                      :aria-label="'删除' + l.name"
                      title="删除商品"
                      @click="removeLine(l.id)"
                    >
                      <X :size="14" />
                    </button>
                  </div>
                  <div class="product-spec">{{ l.spec || "未填写规格" }}</div>
                  <div class="product-tags">
                    <span class="role-tag" :class="l.role">{{
                      { required: "必买", optional: "可选", filler: "凑单" }[
                        l.role
                      ]
                    }}</span
                    ><span
                      v-if="l.eligibility === 'unknown'"
                      class="unknown-tag"
                      >资格待确认</span
                    ><span v-if="BigInt(l.directOff) > 0n" class="discount-tag"
                      >单件直降 ¥{{ money(l.directOff) }}</span
                    >
                    <span v-if="l.governmentSubsidy?.enabled" class="discount-tag">手动国补</span>
                  </div>
                  <div class="product-bottom">
                    <span class="product-price">¥{{ money(l.price) }}</span
                    ><n-input-number
                      v-model:value="l.quantity"
                      :min="1"
                      :max="99"
                      size="small"
                      :aria-label="l.name + '数量'"
                      class="quantity"
                    />
                  </div>
                  <button
                    v-if="result?.lines.some((x) => x.id === l.id)"
                    class="line-price"
                    @click="
                      traceLine = l.id;
                      modal = 'trace';
                    "
                  >
                    预计商品实付 ¥{{
                      money(result?.lines.find((x) => x.id === l.id)?.payable)
                    }}
                    <ChevronDown :size="12" />
                  </button>
                </div>
              </article>
              <div class="shop-shipping">
                <span>运费</span
                ><span
                  v-if="plan.shipping.find((s) => s.shop === g.shop)?.known"
                  >¥{{
                    money(plan.shipping.find((s) => s.shop === g.shop)?.fee)
                  }}</span
                ><span v-else class="muted">待确认</span
                ><button class="text-btn" @click="modal = 'shipping'">
                  修改
                </button>
              </div>
            </section>
            <button class="add-line" @click="openLine()">
              <Plus :size="17" />添加商品
            </button>
          </section>
          <section
            class="checkout-panel"
            :class="{ 'mobile-active': activeTab === 'checkout' }"
          >
            <div class="panel-heading">
              <h2>结算明细</h2>
              <ReceiptText :size="18" class="muted" />
            </div>
            <div v-if="calcError" class="inline-warning">{{ calcError }}</div>
            <template v-if="result"
              ><div class="total-block">
                <span>{{
                  hasUnknown ? "已知部分现金应付" : "预计现金应付"
                }}</span>
                <div class="total">
                  <small>¥</small>{{ money(result.cash) }}
                </div>
                <div class="saving-label">
                  商品优惠 ¥{{
                    money(
                      (
                        BigInt(result.itemDiscount) +
                        BigInt(result.promotionDiscount) +
                        BigInt(result.governmentSubsidy || "0")
                      ).toString(),
                    )
                  }}
                </div>
              </div>
              <div class="amount-list">
                <div>
                  <span>商品原价</span><b>¥{{ money(result.original) }}</b>
                </div>
                <div>
                  <span>单品直降</span
                  ><b class="green">− ¥{{ money(result.itemDiscount) }}</b>
                </div>
                <div>
                  <span>店铺 / 平台优惠</span
                  ><b class="green">− ¥{{ money(result.promotionDiscount) }}</b>
                </div>
                <div v-if="BigInt(result.governmentSubsidy || '0') > 0n">
                  <span>国补（手动模拟）</span>
                  <b class="green">− ¥{{ money(result.governmentSubsidy) }}</b>
                </div>
                <div class="subtotal">
                  <span>商品应付</span><b>¥{{ money(result.goods) }}</b>
                </div>
                <div>
                  <button class="inline-link" @click="modal = 'shipping'">
                    运费实付 <Pencil :size="12" /></button
                  ><b>¥{{ money(result.shipping) }}</b>
                </div>
                <div>
                  <button class="inline-link" @click="modal = 'assets'">
                    账户资产抵扣 <Pencil :size="12" /></button
                  ><b>− ¥{{ money(result.assets) }}</b>
                </div>
                <div v-if="BigInt(result.adjustment) !== 0n">
                  <span>人工校准</span><b>¥{{ money(result.adjustment) }}</b>
                </div>
              </div>
              <div class="breakdown-heading">
                已应用优惠 <span>{{ result.trace.length }}</span>
              </div>
              <div v-if="!result.trace.length" class="muted small">
                暂无可应用优惠
              </div>
              <div class="applied-rule" v-for="t in result.trace" :key="t.id">
                <span class="check-dot"><Check :size="11" /></span
                ><span>{{ t.name }}</span
                ><b>−¥{{ money(t.amount) }}</b>
              </div>
              <button
                class="all-trace"
                @click="
                  traceLine = '';
                  modal = 'trace';
                "
              >
                查看计算过程 <ArrowRight :size="14" />
              </button>
              <div class="estimate-note">
                <CircleHelp :size="15" /><span>{{
                  hasUnknown
                    ? "部分资格或运费未确认，当前金额不完整。"
                    : "模拟金额，实际以平台提交订单页为准。"
                }}</span>
              </div>
              <button
                class="optimize-btn"
                @click="searching ? cancelSearch() : search()"
              >
                <Sparkles :size="17" />{{
                  searching ? "停止搜索" : "寻找更省的凑单方案"
                }}<ArrowRight v-if="!searching" :size="16" />
              </button>
              <div class="checkout-actions">
                <n-button @click="snapshot" :disabled="conflict || !!calcError"
                  ><template #icon><Save :size="15" /></template
                  >保存快照</n-button
                ><n-button @click="modal = 'adjustment'">人工校准</n-button>
              </div>
              <details class="assumptions" v-if="result.warnings.length">
                <summary>
                  计算假设与待核实项 ({{ result.warnings.length }})
                </summary>
                <p v-for="w in result.warnings">{{ w }}</p>
              </details>
            </template>
          </section>
          <section
            class="coupons-panel"
            :class="{ 'mobile-active': activeTab === 'coupons' }"
          >
            <div class="panel-heading">
              <h2>
                优惠券 <span>{{ plan.rules.length }}</span>
              </h2>
              <button
                class="icon-btn"
                title="添加优惠"
                aria-label="添加优惠"
                @click="openRule()"
              >
                <Plus :size="19" />
              </button>
            </div>
            <div class="filter-tabs">
              <button
                v-for="f in [
                  { id: 'all', name: '全部' },
                  { id: 'applied', name: '已生效' },
                  { id: 'other', name: '未生效' },
                ]"
                :class="{ active: filter === f.id }"
                @click="filter = f.id"
              >
                {{ f.name }}
              </button>
            </div>
            <div v-if="!filteredRules.length" class="empty-state compact">
              <Ticket :size="30" />
              <p>暂无优惠券</p>
            </div>
            <article
              v-for="r in filteredRules"
              :key="r.id"
              class="coupon"
              :class="{
                applied: statusMap.get(r.id)?.code === 'APPLIED',
                disabled: !r.enabled,
              }"
            >
              <div class="coupon-head">
                <span class="coupon-kind">{{
                  {
                    shop: "店铺优惠",
                    platform: "跨店 / 平台",
                    shipping: "运费优惠",
                  }[r.stage]
                }}</span
                ><n-checkbox
                  v-model:checked="r.enabled"
                  :aria-label="'启用' + r.name"
                />
              </div>
              <button class="coupon-edit" @click="openRule(r)">
                <div class="coupon-value">
                  <template v-if="r.kind === 'percent'"
                    >{{ r.rateBps / 1000 }}<small>折</small></template
                  ><template v-else
                    ><small>¥</small>{{ money(r.amount)
                    }}<span v-if="r.kind === 'every_full'">每满</span></template
                  >
                </div>
                <div class="coupon-condition">
                  {{
                    BigInt(r.threshold) > 0n
                      ? "满 ¥" + money(r.threshold) + " 可用"
                      : "无金额门槛"
                  }}<span v-if="r.minQuantity > 1">
                    · 满{{ r.minQuantity }}件</span
                  >
                </div>
                <h3>{{ r.name }}</h3>
                <p>
                  {{ r.shop || "跨店指定商品" }} ·
                  {{
                    r.lineIds.length
                      ? r.lineIds.length + "款商品"
                      : "所选范围全部商品"
                  }}
                </p>
              </button>
              <div class="coupon-footer">
                <span
                  :class="{ green: statusMap.get(r.id)?.code === 'APPLIED' }"
                  >{{ statusMap.get(r.id)?.detail || "计算中"
                  }}<template
                    v-if="BigInt(statusMap.get(r.id)?.gap || '0') > 0n"
                  >
                    · 差¥{{ money(statusMap.get(r.id)?.gap) }}</template
                  ></span
                ><button
                  class="icon-btn tiny"
                  :aria-label="'编辑' + r.name"
                  @click="openRule(r)"
                >
                  <Pencil :size="13" />
                </button>
              </div>
            </article>
            <button class="add-coupon" @click="openRule()">
              <Plus :size="16" />录入优惠券
            </button>
            <div class="source-footnote">
              <span class="tiny-dot" />规则与来源可在券详情核对
            </div>
          </section>
        </main>
        <footer class="page-footer">
          <span>Kousou · 私有工作区</span
          ><span>金额口径：人民币 / 分 · 引擎 {{ ENGINE_VERSION }}</span
          ><button class="text-btn danger" @click="modal = 'delete'">
            删除方案
          </button>
        </footer>
      </template>
    </div>

    <n-modal
      :show="!!modal"
      @update:show="
        (v) => {
          if (!v) modal = '';
        }
      "
      :mask-closable="modal !== 'welcome'"
      preset="card"
      :title="
        (
          {
            welcome: '开始一个凑单方案',
            new: '新建方案',
            line: lineIsNew ? '添加商品' : '编辑商品',
            rule: ruleIsNew ? '录入优惠券' : '编辑优惠券',
            shipping: '运费设置',
            assets: '账户资产抵扣',
            adjustment: '人工校准',
            context: '结算设置',
            settings: '工作区设置',
            'rotate-confirm': '确认轮换恢复密钥',
            history: '历史快照',
            trace: '计算过程',
            search: '凑单搜索结果',
            delete: '删除方案',
          } as any
        )[modal]
      "
      class="editor-modal"
      :style="{
        width: modal === 'search' ? '720px' : '570px',
        maxWidth: 'calc(100vw - 24px)',
      }"
    >
      <template v-if="modal === 'welcome' || modal === 'new'"
        ><div class="choice-grid">
          <button @click="create(false)">
            <Plus :size="26" /><strong>空白方案</strong
            ><span>录入自己的商品和优惠</span></button
          ><button @click="create(true)">
            <ShoppingBag :size="26" /><strong>载入验收示例</strong
            ><span>两家店铺 · 四款商品 · ¥413</span>
          </button>
        </div>
        <p class="muted small">示例使用自定义规则，不代表淘宝当期活动。</p>
        <div v-if="recovery" class="key-box">
          <label>工作区恢复密钥</label><code>{{ recovery }}</code
          ><n-button size="small" @click="copyKey">复制密钥</n-button>
        </div></template
      >
      <form
        v-if="modal === 'line' && editLine"
        @submit.prevent="storeLine"
        class="form-grid"
      >
        <label class="full"
          >商品名称<n-input
            v-model:value="editLine.name"
            placeholder="例如：棉质短袖 T 恤"
            aria-label="商品名称" /></label
        ><label
          >店铺<n-input
            v-model:value="editLine.shop"
            placeholder="店铺名称"
            aria-label="店铺名称" /></label
        ><label
          >规格<n-input
            v-model:value="editLine.spec"
            placeholder="颜色 / 尺码 / 包装"
            aria-label="规格" /></label
        ><label
          >单价（元）<n-input
            v-model:value="editLine.priceInput"
            placeholder="0.00"
            aria-label="商品单价" /></label
        ><label
          >未包含在单价中的单件直降<n-input
            v-model:value="editLine.offInput"
            aria-label="单件直降" /></label
        ><label
          >购买数量<n-input-number
            v-model:value="editLine.quantity"
            :min="1"
            :max="99" /></label
        ><label
          >商品角色<n-select
            v-model:value="editLine.role"
            :options="[
              { label: '必买', value: 'required' },
              { label: '可选', value: 'optional' },
              { label: '仅凑单', value: 'filler' },
            ]" /></label
        ><label
          >搜索最多件数<n-input-number
            v-model:value="editLine.maxQuantity"
            :min="1"
            :max="3" /></label
        ><label
          >活动资格<n-select
            v-model:value="editLine.eligibility"
            :options="[
              { label: '待确认', value: 'unknown' },
              { label: '已确认', value: 'confirmed' },
            ]"
        /></label>
        <div class="full subsidy-heading">
          <n-checkbox v-model:checked="editLine.governmentSubsidy.enabled" aria-label="适用国补">
            适用国补（手动）
          </n-checkbox>
        </div>
        <template v-if="editLine.governmentSubsidy.enabled">
          <label>国补分类<n-select
            :value="editLine.governmentSubsidy.category"
            :options="[...subsidyPresets]"
            aria-label="国补分类"
            @update:value="changeSubsidyCategory"
          /></label>
          <label>国补方式<n-select
            v-model:value="editLine.governmentSubsidy.mode"
            :options="[{ label: '按比例', value: 'percent' }, { label: '固定金额（每件）', value: 'fixed' }]"
            aria-label="国补方式"
          /></label>
          <label v-if="editLine.governmentSubsidy.mode === 'percent'">补贴比例（%）<n-input-number
            v-model:value="editLine.subsidyRate" :min="0" :max="100" :precision="2" aria-label="国补比例"
          /></label>
          <label v-else>每件补贴金额（元）<n-input
            v-model:value="editLine.subsidyAmount" aria-label="国补金额"
          /></label>
        </template>
        <div class="form-actions full">
          <n-button @click="modal = ''">取消</n-button
          ><n-button type="primary" attr-type="submit">保存商品</n-button>
        </div>
      </form>
      <form
        v-if="modal === 'rule' && editRule"
        @submit.prevent="storeRule"
        class="form-grid"
      >
        <label class="full"
          >优惠名称<n-input
            v-model:value="editRule.name"
            aria-label="优惠名称" /></label
        ><label
          >优惠层级<n-select
            v-model:value="editRule.stage"
            :options="[
              { label: '店铺优惠', value: 'shop' },
              { label: '跨店 / 平台优惠', value: 'platform' },
              { label: '运费券', value: 'shipping' },
            ]" /></label
        ><label v-if="editRule.stage !== 'shipping'"
          >计算方式<n-select
            v-model:value="editRule.kind"
            :options="[
              { label: '满减 / 直接减', value: 'fixed' },
              { label: '每满减', value: 'every_full' },
              { label: '折扣', value: 'percent' },
            ]" /></label
        ><label v-if="editRule.stage !== 'platform'"
          >店铺<n-select
            v-model:value="editRule.shop"
            :options="shops.map((s) => ({ label: s, value: s }))" /></label
        ><label
          >金额门槛（元）<n-input
            v-model:value="editRule.thresholdInput"
            aria-label="优惠门槛" /></label
        ><label v-if="editRule.kind !== 'percent'"
          >减免金额（元）<n-input
            v-model:value="editRule.amountInput"
            aria-label="减免金额" /></label
        ><label v-else
          >折扣（9 即九折）<n-input-number
            v-model:value="editRule.rateInput"
            :min="0"
            :max="10"
            :step="0.1" /></label
        ><label v-if="editRule.stage !== 'shipping'"
          >最低件数<n-input-number
            v-model:value="editRule.minQuantity"
            :min="1"
            :max="999" /></label
        ><label v-if="editRule.stage !== 'shipping'" class="full"
          >限定商品（不选即当前范围全部商品）<n-select
            v-model:value="editRule.lineIds"
            multiple
            :options="
              plan.lines
                .filter(
                  (l) =>
                    editRule.stage === 'platform' || l.shop === editRule.shop,
                )
                .map((l) => ({ label: l.name, value: l.id }))
            " /></label
        ><label v-if="editRule.stage !== 'shipping'"
          >门槛基数<n-select
            v-model:value="editRule.basis"
            :options="[
              { label: '商品原价', value: 'original' },
              { label: '单品直降后', value: 'after_item' },
              ...(editRule.stage === 'platform'
                ? [
                    { label: '店铺优惠后', value: 'after_shop' },
                    { label: '当前剩余应付', value: 'current' },
                  ]
                : []),
            ]" /></label
        ><label
          >封顶（0为不设封顶）<n-input
            v-model:value="editRule.capInput" /></label
        ><label v-if="editRule.stage === 'platform'" class="full"
          >互斥组（相同组只选一张，留空允许叠加）<n-input
            v-model:value="editRule.exclusiveGroup" /></label
        ><label class="full"
          >规则来源链接<n-input
            v-model:value="editRule.sourceUrl"
            placeholder="https://…" /></label
        ><label
          >开始时间<n-date-picker
            type="datetime"
            :value="editRule.startsAt ? Date.parse(editRule.startsAt) : null"
            @update:value="
              (v) => (editRule.startsAt = v ? new Date(v).toISOString() : '')
            "
            clearable /></label
        ><label
          >结束时间（不包含该时点）<n-date-picker
            type="datetime"
            :value="editRule.endsAt ? Date.parse(editRule.endsAt) : null"
            @update:value="
              (v) => (editRule.endsAt = v ? new Date(v).toISOString() : '')
            "
            clearable
        /></label>
        <div class="full checkbox-row">
          <n-checkbox v-model:checked="editRule.claimed">已领取</n-checkbox
          ><n-checkbox v-model:checked="editRule.verified"
            >已核实范围、门槛与叠加条件</n-checkbox
          >
        </div>
        <div class="form-actions full">
          <n-button
            v-if="!ruleIsNew"
            type="error"
            ghost
            @click="
              plan.rules = plan.rules.filter((r) => r.id !== editRule.id);
              modal = '';
            "
            >删除</n-button
          ><n-button @click="modal = ''">取消</n-button
          ><n-button type="primary" attr-type="submit">保存优惠</n-button>
        </div>
      </form>
      <template v-if="modal === 'shipping'"
        ><div v-for="shop in shops" class="shipping-editor">
          <h3>{{ shop }}</h3>
          <div class="form-grid">
            <label
              >基础运费（元）<n-input
                :value="money(plan.shipping.find((s) => s.shop === shop)?.fee)"
                @change="(v) => setShipping(shop, 'fee', v)" /></label
            ><label
              >折后包邮门槛（0为不设置）<n-input
                :value="
                  money(plan.shipping.find((s) => s.shop === shop)?.freeOver)
                "
                @change="(v) => setShipping(shop, 'freeOver', v)" /></label
            ><n-checkbox
              :checked="plan.shipping.find((s) => s.shop === shop)?.known"
              @update:checked="
                (v) => {
                  plan.shipping.find((s) => s.shop === shop)!.known = v;
                }
              "
              >已确认该店运费</n-checkbox
            >
          </div>
        </div>
        <p class="muted small">
          当前每店一个运费组；包邮门槛按商品促销后应付计算。
        </p></template
      >
      <template v-if="modal === 'assets'"
        ><label class="field"
          >本次预计可抵扣额度（元）<n-input
            :value="money(plan.assetDeduction)"
            @change="(v) => setAmount('assetDeduction', v)"
        /></label>
        <p class="muted">
          仅模拟本次抵扣，不扣除真实账户资产。请按平台结算页确认额度与适用范围。
        </p></template
      >
      <template v-if="modal === 'adjustment'"
        ><label class="field"
          >校准原因<n-input
            v-model:value="plan.adjustmentReason"
            placeholder="例如：真实结算页运费差异" /></label
        ><label class="field"
          >现金调整（元，可填负数）<n-input
            :value="money(plan.adjustment)"
            @change="(v) => setAmount('adjustment', v)"
        /></label>
        <p class="muted">原计算结果保留，校准金额单独列账。</p>
        <n-button
          @click="
            plan.adjustment = '0';
            plan.adjustmentReason = '';
          "
          >清除校准</n-button
        ></template
      >
      <template v-if="modal === 'context'"
        ><label class="field"
          >方案名称<n-input v-model:value="plan.title" /></label
        ><label class="field"
          >逻辑账号<n-input v-model:value="plan.account" /></label
        ><label class="field"
          >计算策略<n-select
            v-model:value="plan.policy"
            :options="[
              {
                label: '淘宝 2026 店铺互斥（其他条件手动确认）',
                value: 'taobao_2026',
              },
              { label: '自定义模拟', value: 'custom' },
            ]"
        /></label>
        <p class="muted small">
          当前两种策略均按每店一个优惠择优；平台券依据录入的互斥组计算。服饰品类券特殊基数尚未支持。
        </p>
        <label class="field"
          >结算时点<n-date-picker
            type="datetime"
            :value="Date.parse(plan.valuationTime)"
            @update:value="
              (v) => {
                if (v) plan.valuationTime = new Date(v).toISOString();
              }
            " /></label
        ><n-button
          size="small"
          @click="plan.valuationTime = new Date().toISOString()"
          >更新为当前时间</n-button
        ><label class="field"
          >备注<n-input type="textarea" v-model:value="plan.notes" /></label
      ></template>
      <template v-if="modal === 'settings'"
        ><div v-if="recovery" class="key-box">
          <label>恢复密钥（仅本次展示）</label><code>{{ recovery }}</code
          ><n-button size="small" @click="copyKey">复制密钥</n-button>
        </div>
        <p v-else class="muted">已有密钥不再回显。轮换会撤销其他设备会话。</p>
        <div class="settings-actions">
          <n-button @click="modal = 'rotate-confirm'">轮换恢复密钥</n-button
          ><n-button @click="exportData">导出全部方案</n-button
          ><label class="file-button"
            >导入方案 JSON<input
              type="file"
              accept="application/json"
              @change="importData" /></label
          ><n-button @click="logout">退出工作区</n-button>
        </div></template
      >
      <template v-if="modal === 'rotate-confirm'"
        ><p>旧恢复密钥将失效，其他设备会退出。请保存新密钥。</p>
        <n-button type="primary" @click="rotateKey"
          >确认轮换</n-button
        ></template
      >
      <template v-if="modal === 'history'"
        ><div v-if="!snapshots.length" class="empty-state">
          <History :size="30" />
          <p>还没有快照</p>
        </div>
        <article v-for="s in snapshots" class="history-row">
          <div>
            <strong>修订 {{ s.revision }}</strong
            ><small>{{ new Date(s.created_at).toLocaleString("zh-CN") }}</small>
          </div>
          <b>¥{{ money(s.result.cash) }}</b
          ><button
            class="icon-btn"
            title="下载计算快照"
            @click="
              download(JSON.stringify(s, null, 2), 'kousou-snapshot.json')
            "
          >
            <Download :size="17" />
          </button></article
      ></template>
      <template v-if="modal === 'trace'"
        ><div v-if="traceLine" class="trace-title">
          {{ plan.lines.find((l) => l.id === traceLine)?.name }}
        </div>
        <div v-for="t in snapshotResult" class="trace-entry">
          <strong
            >{{ t.name }}
            <span class="green">− ¥{{ money(t.amount) }}</span></strong
          >
          <p>{{ t.stage === 'government_subsidy' ? '补贴计算基数' : '参与门槛金额' }} ¥{{ money(t.basis) }}</p>
          <div v-for="(amount, id) in t.allocations">
            <span>{{
              plan.lines.find((l) => l.id === id)?.name || "运费组"
            }}</span
            ><b>− ¥{{ money(amount) }}</b>
          </div>
        </div>
        <p v-if="!snapshotResult?.length" class="muted">
          没有券优惠分摊；单品直降已在商品行独立扣除。
        </p></template
      >
      <template v-if="modal === 'search' && searchResult"
        ><p class="muted">
          检查 {{ searchResult.visited }} 个组合 ·
          {{
            searchResult.status === "exhaustive"
              ? "已遍历本次有限候选域"
              : "达到搜索限制，未证最优"
          }}
          · 必买基线 ¥{{ money(searchResult.baseline.cash) }}
        </p>
        <article v-for="(candidate, i) in searchResult.plans" class="candidate">
          <div>
            <span class="candidate-rank">{{ i + 1 }}</span
            ><strong>¥{{ money(candidate.result.cash) }}</strong
            ><span class="green"
              >较基线
              {{
                BigInt(candidate.result.cash) <=
                BigInt(searchResult.baseline.cash)
                  ? "少付"
                  : "多付"
              }}
              ¥{{
                money(
                  (BigInt(candidate.result.cash) >
                  BigInt(searchResult.baseline.cash)
                    ? BigInt(candidate.result.cash) -
                      BigInt(searchResult.baseline.cash)
                    : BigInt(searchResult.baseline.cash) -
                      BigInt(candidate.result.cash)
                  ).toString(),
                )
              }}</span
            >
          </div>
          <p>
            {{
              candidate.plan.lines
                .filter((l) => l.selected)
                .map((l) => l.name + " × " + l.quantity)
                .join(" / ")
            }}
          </p>
          <n-button
            size="small"
            type="primary"
            @click="applyCandidate(candidate.plan)"
            >应用方案</n-button
          >
        </article>
        <p v-if="!searchResult.plans.length">
          没有完整且可行的候选方案。
        </p></template
      >
      <template v-if="modal === 'delete'"
        ><p>删除后，该方案及其历史快照将被移除。</p>
        <n-button type="error" @click="removePlan"
          >确认删除方案</n-button
        ></template
      >
    </n-modal>
  </n-config-provider>
</template>
