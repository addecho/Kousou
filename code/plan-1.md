# Kousou V1 开发总计划（plan-1）

**日期**：2026-10-22　**状态**：经公开资料调研的实施方案，尚未完成软件开发　**仓库**：addecho/Kousou  
**优先级**：计算准确与可解释 > 手动录入体验 > 多店铺结算 > 凑单优化 > 识图导入。

## 1. 决策与边界

- 产品：不登录淘宝/京东的独立自托管凑单工作台。手动录商品、券规则，模拟真实的**一个账号一次结算包含多个店铺、多种 SKU**的情况。预测不保证等于真实平台结算价，实际以平台提交订单页为准。
- 数据库：**PostgreSQL 18.6 稳定版**，使用 postgres.js + Drizzle；不使用 SQLite/better-sqlite3。19 于 2026-10-15 发布 RC1，官方计划 2026-11-19 GA，现不宜使用 RC 上线。[PG 官方支持表](https://www.postgresql.org/support/versioning/)；[19 RC 公告](https://www.postgresql.org/about/news/postgresql-19-rc-1-released-3409/)。
- 代码：Vue 3 + TypeScript + Vite + Pinia + Naive UI；Fastify + Zod；TypeScript 纯函数定价引擎；Vitest + Playwright；pnpm monorepo；Docker Compose + Caddy。
- 一笔 CheckoutBatch 固定**一个平台账号**；可跨同账号下多个店铺聚合符合资格的商品。跨平台、跨账号可以分组管理与比较方案，但**不能虚构为同一笔结算**，不能共享账号券。
- V1 商品**手动录入优先**，保留链接、图片、SKU、类目/活动资格；单张优惠券截图上传及核对界面属于 V1 规划，OCRProvider 可插拔，未配置供应商时回退手动录入；批量多图 OCR 放 V1.1/V2。
- 不抓取真实平台购物车，不自动下单，不保管电商账户密码/Cookie，不尝试规避反爬；国补/定金预售/跨境税费/先用后返等复杂场景 V1 可记录但不宣称全自动精准计算。

## 2. 网络调研与必须覆盖的真实规则

### 2.1 淘宝/天猫

淘宝开放平台 2026-02-05 公告说明，计划于 **2026-03-10** 升级：同一店铺**子订单**里的店铺优惠券、店铺多件优惠与第三方店铺满减满折，改为**互斥择优**。示例：2 件各 ¥100，同时有“满两件九折”和“满 200 减 10”，选择九折后实付 ¥180，不能把两优惠同时叠成 ¥170。公告说明具体以平台后续通知为准。[官方公告](https://open.alitrip.com/support/announcementDetail.htm?id=25828&source=search)。

淘宝服饰行业平台品类券活动协议表明，**指定活动**的品类券可以在跨店合并支付中汇总符合范围的商品；门槛可以按去除特定单品优惠后的商品额判断，并与指定平台购物券互斥。**不可推广为一切平台券的通用永久规则**。[活动协议](https://terms.alicdn.com/legal-agreement/terms/b_end_product_protocol/20250508185535922/20250508185535922.html)。

2026 天猫双11官方立减以单品层级发生，不应被当作又一张“满减券”；其与其他优惠的具体组合仍需按活动规则解释。[招商规则相关报道](https://finance.sina.com.cn/tech/roll/2026-09-25/doc-iniszmmx4463810.shtml)。2026-10-15 阿里巴巴公布 88VIP 可选择不同额度消费券，提示要支持按账号/活动变体存储券。[阿里巴巴官网](https://www.alibabagroup.com/zh-CN/document-2047546975867371520)。

### 2.2 京东

[京东现行优惠券帮助规则](https://help.jd.com/user/issue/169-1077.html)区分**全品类东券、限品类东券、店铺东券**；同一商品上的普通店铺东券、限品类东券、全品类东券通常只能用一张（PLUS 等特殊券存在例外）；适用商品范围**不重叠**时，可以在一次订单里使用不同券。券门槛和可用资格取决于券对应商品集合及特定基数；部分存在渠道、地区限制。商品只要在同一个购物车中**不代表都能参加同一张券**。

另有[京东优惠券历史页面](https://help.jd.com/user/issue/169-4234.html)明确标注“2021 年 12 月 4 日前生效”。**不能把这个旧页面的京券叠加规则当 2026 当前默认规则**。京东也有[具体业务优惠例外](https://help.jd.com/user/issue/34-4546.html)，所以规则应按活动策略集可配置。

### 2.3 调研证据分级

A：官方现行帮助页/公告；B：特定活动合同或官方活动资料；C：经验说法、第三方攻略或 AI/OCR 结果。每张券保留 sourceUrl、observedAt、effectiveAt、verifiedByUser、assumptions。冲突时可由用户录入真实结算页面观察值及人工修正；**不把猜测显示成官方保证价格**。规则预设要版本化（平台/活动/生效日），不可硬编码固定的全部平台叠加顺序。

## 3. 业务层级与优惠分类

### 3.1 三层业务结构 + 运费与资产

    Workspace
      ├─ PlatformAccount：淘宝A / 京东B 等逻辑账户
      │   ├─ Shop
      │   │   └─ Offer（商品某规格 SKU、单价、类目/活动资格）
      │   └─ CouponAsset（该账号所持有/可领取的券）
      └─ CheckoutPlan
          └─ CheckoutBatch（同平台同账号的一次合并支付）
              ├─ ShopSuborder A：A1、A2
              ├─ ShopSuborder B：B1、B2
              ├─ EligibleGroups：跨店指定商品聚合
              ├─ ShippingGroups：运费按店铺/包裹配置
              └─ AppliedPromotions + Assets + Payment

核心要求：**SKU、店铺子订单、支付批次三个对象必须独立建模**；“券只对 A1/A2/B2 有效”不能降级为“这张券对整个购物车有效”。

### 3.2 券和优惠要按维度分类，而不只是单一 type

| 维度 | 枚举/典型值 | 作用 |
|---|---|---|
| issuer 发起方 | platform/shop/brand/payment/government/user_asset | 谁发放 |
| scopeLevel 范围 | item/shop_suborder/category_across_shops/checkout_batch/shipping_group/payment | 折哪一层 |
| benefit 利益 | fixed_off/percent_off/threshold_off/every_full/tiered/quantity_discount/shipping_off/asset_deduction | 怎么减 |
| thresholdBasis 门槛基数 | list_price/activity_price/after_item/after_shop/stage_payable/scoped_original/shipping_fee | 凭什么判断满 |
| eligibility 资格 | 账号、店铺、指定 SKU、排除 SKU、类目、活动标签、会员/首单、渠道、地区、有效期 | 哪些商品能用 |
| stacking 叠加 | exclusiveGroup、conflictIds、perLineMax、perSuborderMax、perBatchMax、nonOverlapAllowed | 是否冲突 |
| assetStatus 持有状态 | claimed/unclaimed/expired/used/unknown | 账号是否真有这张券 |

### 3.3 面向用户的快捷券分类

1. **商品级**：官方立减、商品直降、指定 SKU 券（折扣可能已包含在商品显示价，需用户确认避免双重扣减）。
2. **店铺级**：店铺满减券、店铺满件折、满 N 件优惠；同子单关系由淘宝 2026 或自定义策略决定。
3. **跨店/平台级**：跨店满减、品类券、平台消费券、88VIP/PLUS 特权；**适用商品列表、聚合方式、门槛基数分别定义**。
4. **消费者资产**：红包、京豆、购物金/余额、券包资产。必须区分“商品价格优惠”和“抵扣现金应付”，避免重复统计节省金额。
5. **运费级**：包邮门槛、运费券，独立于商品金额，按运费组折抵。
6. **支付级**：支付渠道优惠、银行卡优惠，支付渠道与金额门槛单独判断。
7. **特殊/信息级**：国补、以旧换新、预售定金、后返券/返豆。V1 作为独立人工规则/信息提示处理；“之后返还”不得直接降低本次现金应付。

“京东 APP 专享”是**使用渠道限制**，不等于全平台通用券；“店铺券”可能只作用于店内部分 SKU；“跨店可汇总门槛”与“跨店都可获得优惠”亦非同义。

## 4. 规则表达、计算与分摊

### 4.1 PromotionRule JSONB Schema v1（示例非真实平台政策）

~~~json
{
  "schemaVersion": 1,
  "ruleId": "example-crossshop",
  "name": "跨店满400减40（示例）",
  "platform": "taobao",
  "issuer": "platform",
  "scopeLevel": "checkout_batch",
  "scope": {
    "accountId": "account-a",
    "eligibleOfferIds": ["A1", "A2", "B1", "B2"],
    "excludedOfferIds": [],
    "shopIds": [],
    "categoryIds": [],
    "allowCrossShopAggregation": true
  },
  "trigger": {
    "kind": "threshold",
    "thresholdCents": "40000",
    "thresholdBasis": "after_shop",
    "repeatMode": "once"
  },
  "benefit": {
    "kind": "fixed_off",
    "amountCents": "4000",
    "discountBase": "eligible_stage_payable",
    "rounding": "cent_half_up",
    "allocation": "largest_remainder"
  },
  "stacking": {
    "exclusiveGroup": "example-platform-coupon",
    "conflictRuleIds": [],
    "maxPerEligibleLine": 1,
    "maxPerBatch": 1,
    "nonOverlappingLinesCanCoexist": false
  },
  "execution": {
    "stage": "platform_promotions",
    "afterStages": ["item_promotions", "shop_promotions"],
    "priority": 10
  },
  "validity": {"startsAt": null, "endsAt": null},
  "evidence": {"sourceType": "manual", "verified": false}
}
~~~

- thresholdBasis（门槛依据）和 discountBase（抵扣基数）**分别可设**；满与每满、单次与循环、多档、每件取整/整单取整均不能混为一种。
- 没有资格信息时返回 unknown，禁止默认所有商品参与。
- 依赖/阶段以可校验的有向无环策略表示；互斥在**同 SKU / 同店子订单 / 同结算批次**分别判定；自动择优需考虑有无重叠商品。
- PromotionRule（规则定义）与 CouponAsset（账户持有实例）分开，避免不同账号的券混用。同一规则可被多个账号持有但每个实例有效期、可用次数不同。
- 用户人工强制套用未核实组合须记录 override、warning 和来源，不能篡改官方模板。

### 4.2 计算引擎执行顺序

1. 建立包含平台、账号、地区、渠道、日期、会员资格的 checkoutContext；将多店商品形成 ShopSuborder。
2. 建立原价、活动价以及可能**已包含**的商品直降，排除重复计算。
3. 计算商品优惠后可抵扣金额，对同店活动/券做资格检查、门槛判断、互斥或择优。
4. 按每张跨店券的 scoped eligible lines 聚合合法商品金额；对单品/店铺优惠的先后依据**该券指定 thresholdBasis**，不是无条件套固定顺序。
5. 构建合法可叠优惠组合，按规则依赖、券优先顺序与互斥关系计算；同商品重叠受 perLineMax 约束。
6. 将每笔优惠只分摊给其合法受益商品。固定优惠金额按整数权重进行“比例 + 最大余数法”分配；同余按稳定 lineId 决定，保持守恒与确定性。
7. 独立计算运费、运费券；随后独立处理红包/积分/购物金与支付优惠；返现仅供参考不直接减应付。
8. 返回每 SKU 原价→各阶段折扣→折后价、每店子单、跨店优惠、运费及资产账本、最终**预计现金应付**与详细 trace。
9. 对券未应用给出具体 code，如 WRONG_ACCOUNT、EXPIRED、THRESHOLD_NOT_MET、SCOPE_MISMATCH、CONFLICT_SAME_LINE、CONFLICT_SUBORDER、UNKNOWN_ELIGIBILITY。
10. 对来源不充分的规则输出 simulated_with_assumptions/incomplete_eligibility，不得声称“精确符合平台”。

**金额协议**：数据库 BIGINT 存整数分；API JSON 使用十进制字符串；百分比用整数基点或 Decimal 进行精算后量化到分；分摊之和=优惠总额，任一 SKU 的实付不得小于 0，同一输入结果必须可复现。

### 4.3 多店同单模拟验收例

示例约束：A 店 A1=¥180、A2=¥120；B 店 B1=¥110、B2=¥90，全部适用跨店券；A1 商品直降 ¥20；A 店券满 ¥250 减 ¥30，覆盖 A1/A2；跨店券满 ¥400 减 ¥40，门槛按**店铺优惠后**商品价，允许与 A 店券叠加；运费 A=8/B=10，A 运费券减 5；红包抵扣 10。

应得：
- 原始商品合计 500；
- 商品直降 20 → 480；
- A 店参与额 280，满足店铺券减 30 → 商品总额 450；
- 跨店有效额 450 满足平台券再减 40 → 商品应付 **410**；
- 运费 18 减运费券 5 → 运费实付 13；
- 红包资产抵 10 → **现金应付 413**。

这个例子是自定义策略的测试 fixture，绝不可贴标签说是淘宝或京东当季的通用真实叠加顺序。UI 必须分别显示“价格促销 90 / 运费减免 5 / 账户资产抵扣 10”，并能追踪每张券分摊到哪些行。

### 4.4 淘宝与京东专项测试

- 淘宝：同店 2×100，满 2 件 9 折 vs 满 200 减 10 → **180**，不是 170；其他平台优惠可否继续用由活动模板独立决定。
- 京东：同一 SKU 可用店铺东券和品类东券时，普通情形不得同时折该 SKU（有明确活动例外才可人工切换）；互不重叠的 A/B SKU 可分别应用不同券。
- 跨店门槛不能将“不参与该平台活动”的其他商品凑入；店铺券不应拿另一家店总价判断门槛。
- 同券满减“每满”和“满一次”、多档阶梯、运费排除、账号切换、过期、会员限制、截图未确认，均有独立 fixtures。
- 计算引擎为纯函数，所有优化结果统一调用该引擎复核，不能再实现另一个简单减法引擎。

## 5. 舒适的券录入与管理

### 5.1 右侧券中心

顶部按“本次可用 / 全部 / 过期”筛选；按 **商品券、店铺券、跨店/平台券、红包与会员、运费与支付**折叠分组。每张券卡展示：
- 大字面额（如 **满400减40**）、作用范围（A 店 / 跨店已标记的 4 件 SKU）、有效期与账号；
- 即时状态 **已生效 / 还差 ¥X / 与某券冲突 / 适用商品不足 / 未领取 / 已过期 / 待确认**；
- 点击查看“这张券具体累计了哪几件商品、为什么另外商品没资格、应用到谁身上”；
- 一键“本次选择/禁用”，高级编辑可在抽屉打开，避免让用户盯着 JSON。

### 5.2 两层录入表单

**快捷模式（主路径，尽量 4 步完成）**：
1. 类型按钮：商品直降 / 店铺券 / 跨店券 / 会员券 / 红包 / 运费券；
2. 优惠描述：满 X 减 Y、X 折封顶 Y、每满 X 减 Y、无门槛减 X；
3. 作用范围：当前商品、当前店铺全部、店内选定 SKU、指定类目、跨店指定 SKU，右侧同步预览已匹配的商品；
4. 是否已领和有效期，保存后立即显示试算结果。

**高级模式（有歧义才展开）**：thresholdBasis、叠加互斥、每行/子单/批次可用次数、每满、会员/地区/渠道、商品排除清单、计算与分摊舍入、证据/备注、活动规则版本。提供最近券复制、本店券复制、模板库；自然语言解析“满300减40，仅A店衣服”可以生成**待确认**表单，但绝不自行推断叠加资格。

### 5.3 一张截图识别的 V1 工作流

1. “从图片录券”单次上传一张 PNG/JPEG/WebP（例如上限 8MB，限制像素维度）；先预览；
2. OCRProvider 接口输出候选券字段、原始识别文本、置信度（若有）、文本/图像证据区域；没有配置 provider 时显示“当前需要手工填写”，不伪装自动完成；
3. 左图右表（窄屏上下排列）逐字段核对：券名、满减数值、期限、店铺、适用范围；尤其是**叠加、门槛口径、券是否领取**默认待人工核实；
4. 点击“确认导入”后才入库、生效。识别出多个候选时逐项确认，不静默创建；
5. 上传图片放私有附件卷，随机存储路径、账号隔离、鉴权读取、可删除；若用外部视觉 API，明确提示会上传截图，配置限流和成本上限；
6. V1.1/V2 通过 import_batch + import_item 扩展多张图片队列、去重、合并冲突字段；不破坏单图接口。

## 6. 人工介入机制（必须是基础功能）

分三个层次：
- **规则级**：编辑券的资格、门槛基数、顺序、互斥及取整；生成版本，影响新模拟；
- **方案级**：仅本次强制选择/禁用券、修改某 SKU 参与资格、锁定其他券；不污染全局；
- **观察级**：手填真实购物平台结算页中的总额或券/商品的实际折扣（可附图片），展示“预测 vs 观察”的差额与疑因，允许人工差额补偿，**独立记账并标注**。

中栏每件商品均可点“为何算成这个价”，看原价、单品、店铺、平台、运费与资产抵扣的分项；右券卡显示被拒原因；可一键还原到自动策略。手工强制违反规则时，清楚标为“人工校准模拟”，不能作为精确平台价格输出。snapshot 同时保留 input、engineVersion、rulesetVersion、result、overrides、observedAt。

## 7. 数据模型（PostgreSQL + Drizzle）

| 表 | 主字段 | 职责 |
|---|---|---|
| workspaces | id UUID、name、timestamps | 匿名工作区 |
| workspace_keys | workspace_id、secret_hash、revoked_at | 密钥恢复，不存明文 |
| sessions | workspace_id、token_hash、expires_at、revoked_at | 设备会话 |
| platform_accounts | workspace_id、platform、alias、settings_jsonb | 多平台多逻辑账号 |
| shops | workspace_id、account_id、name | 店铺 |
| products | workspace_id、name、note、image_url、source_url | 商品主档 |
| product_offers | workspace_id、product_id、shop_id、account_id、sku、spec、unit_price_cents BIGINT | 具体 SKU 报价 |
| offer_eligibility | workspace_id、offer_id、category、activity_tag、rules_jsonb | 商品活动资格 |
| cart_drafts/cart_items | workspace_id、account_id、offer_id、qty、role、selected、revision | 候选与购物车 |
| promotion_rules | workspace_id、account_id、scope_level、kind、rule_jsonb、schema_version、revision | 优惠规则 |
| coupon_assets | workspace_id、account_id、rule_id、claim_status、uses_left、expires_at | 券持有实例 |
| ruleset_profiles | workspace_id、platform、key、version、effective_from、config_jsonb、source_jsonb | 平台/活动策略 |
| checkout_plans/plan_items | workspace_id、account_id、offer_id、qty、locked_price_cents、revision | 保存方案 |
| checkout_suborders | workspace_id、plan_id、shop_id、shipping_group_id | 每店子单 |
| plan_overrides | workspace_id、plan_id、kind、target_id、payload_jsonb、reason | 人工修正 |
| calculation_snapshots | workspace_id、plan_id、input_jsonb、result_jsonb、engine_version、ruleset_version | 历史复现 |
| observed_checkouts | workspace_id、plan_id、observed_jsonb、attachment_id | 官方预览对照 |
| attachments/import_jobs | workspace_id、owner_id、mime、bytes、storage_key、status、ocr_jsonb | 单图识别与来源 |

要求：业务表均明确 tenant/workspace 归属；跨表同租户复合 FK 或后端事务验证；Zod schema + Drizzle migration；JSONB 数据版本化但常用过滤字段单独建索引；审计及快照保留输入拷贝；offer 改价不重写历史快照。存款余额/券模拟消耗不能因保存方案就视为实际使用。必要索引以 workspace/account/shop/status/date 为主。

## 8. 匿名 Key 与安全

- 服务端生成至少 **128 位 CSPRNG** 恢复秘钥，例如 26 个 Crockford Base32 字符（分组易抄；可另加校验位）；仅首次展示明文，服务端保存带 pepper 的 HMAC-SHA256 索引摘要，禁止明文库/日志；
- 会话基于随机令牌摘要存储，浏览器用 **Secure、HttpOnly、SameSite=Lax** Cookie 持久化设备会话；不默认将恢复 Key 明文放 localStorage 或 URL；
- 换设备输入 Key 恢复；支持轮换 Key、撤销设备、退出；丢失 Key 且无已登录会话不提供伪装“找回”；
- 租户过滤不得靠前端传 workspaceId；Origin/CSRF 保护、同源 CORS、限速防枚举、上传鉴权、文件体积限制、日志脱敏；
- 公开 GitHub 不提交数据库、真实 .env、用户截图或密钥。多平台逻辑账号只是分组，不存真实商城登录凭证。

## 9. API 与计算优化

主要端点（均 /api/v1 前缀）：
- POST /workspaces；POST /sessions/recover；GET /session；POST /sessions/logout；POST /workspace-keys/rotate；
- GET/POST/PATCH/DELETE /accounts、/shops、/products、/offers、/carts、/promotions、/coupon-assets、/plans；
- POST /pricing/calculate；POST /optimization/run；POST /promotions/parse-text；POST /promotions/preview；
- POST /attachments；POST /imports/coupon-image；POST /imports/:id/confirm；
- POST /plans/:id/overrides；POST /plans/:id/observations；POST /plans/:id/snapshots；GET /export；
- GET /health/live、GET /health/ready。

规则引擎必须是可独立测试的**纯函数**：calculate(context, lines, promotionRules, couponAssets, shipping, overrides, ruleset) → immutable trace。资格判断、互斥判断、金额计算、优惠分摊拆成单独模块。

优化器从“必买/可选/仅凑单”候选搜索最佳方案，指标：最低现金实付、相对仅买必买商品的净节省、最少额外购买成本、预算内最大优惠；返回 5 个差异明显方案。输入上限可设 20 种候选 SKU、每种最多 3 件、计算默认超时 3 秒。**不要因上限 20 而承诺穷举完**；用剪枝/缓存/候选上界，超时只能标为 best_found_not_proven，并显示限制。优化器使用**同一个 pricing-engine** 最终复核。

## 10. UI 布局与主要流程

桌面三栏：左约 40% 商品/店铺列表；中约 34% 结算解释与方案比较；右约 26% 券中心。窄屏改商品/结算/券中心三标签。顶部固定平台账号、方案、同步状态和 Key/导出设置。

**左栏**：经典淘宝购物车视图，按店铺折叠、店铺全选、多 SKU/规格、图片/链接、数量调整、商品角色、活动资格标签、筛选。  
**中栏**：总金额、商品折扣、店铺券、跨店券、运费、红包/资产、现金实付；分店与逐商品 trace，差额提示，优化候选、手动覆写和方案保存。  
**右栏**：按层级分组券卡、可用/差门槛/冲突/过期/待核实状态、快速新增；点击券显示适用 SKU 与未生效原因；高级编辑抽屉和图片录券抽屉。

草稿变更 debounce 自动保存，显示同步中/保存成功/失败/冲突；使用 revision 乐观锁，网络错误不可假装“已保存”；并发请求按版本防旧数据覆盖新数据。

## 11. 部署与运维（PG18 特别注意）

- 三个服务：web/Caddy、api/Fastify、db/PostgreSQL **postgres:18.6-bookworm**。PostgreSQL **不发布 5432 到公网**；Caddy HTTPS 对外。
- PostgreSQL 18 官方 Docker **PGDATA=/var/lib/postgresql/18/docker**；Volume 必须挂到 **/var/lib/postgresql**，不能照抄 PG17 的 /var/lib/postgresql/data。参见 [官方镜像文档](https://hub.docker.com/_/postgres)。
- Compose db healthcheck 用 pg_isready；api 等待 db ready 后执行迁移再开放 readiness；配置 DB_URL 和 SESSION_PEPPER 的 env.example，不提交真实密码。
- 初期无 Redis/队列；OCR 需异步时先在 API 内采用受限任务状态/有超时的轻量实现；必要时再加任务队列。
- 每日 pg_dump 自定义格式备份，备份与主数据卷分离，例行 pg_restore 恢复演练；升级数据库 major 版需 pg_upgrade 或 dump/restore，**不能仅修改镜像 tag**。
- 挂载用户上传图像独立卷，日志脱敏、可删除、按期限清理。提供 JSON 导出/导入，包含方案与规则版本，不包含服务端恢复 Key。
- 研发环境 Docker Compose 一条命令启动；生产配置密码/域名/HTTPS。README 列明备份、迁移、恢复、故障排查。

## 12. 代码目录建议

    apps/web/src/components/{cart,checkout,coupons,imports}
    apps/web/src/{pages,stores,styles}
    apps/api/src/{routes,services,repositories,middleware}
    packages/shared             # Zod contracts、金额协议
    packages/pricing-engine     # pure calculation / eligibility / stacking / allocator
    packages/optimizer          # 组合搜索与排序
    packages/db                 # Drizzle schema + migrations
    tests/{fixtures,integration,e2e}
    code/plan-1.md
    compose.yaml
    Dockerfile
    docker/Caddyfile
    .env.example
    .gitignore
    README.md

## 13. 开发里程碑（按顺序）

**P0 底座**：pnpm workspace、Vue/Fastify、PostgreSQL 18.6、Drizzle 迁移、Caddy、compose、lint/typecheck/test/CI，克隆后可启动；重启后 DB 数据不丢；无 SQLite 依赖。

**P1 匿名空间**：生成/恢复/轮换 Key、session、账号/店铺、租户隔离；两设备互通，错 Key 被限流，不同工作区不可越权。

**P2 商品 + 多店结算**：手动商品报价、规格/数量、勾选和角色、子订单、运费组、草稿自动保存；支持同一平台账号两店至少四个商品。

**P3 优惠定价引擎（阻塞核心）**：规则 JSON、资格判断、互斥、按阶段应用、门槛基数、比例分摊、trace、正式 fixtures；**在没有 UI 时就能通过全套数值测试**。

**P4 舒适券录入和展示**：快捷模板、适用 SKU 多选、高级设置、券差额/冲突提示、按行优惠明细、多店结算说明；非技术用户不用填 JSON 也能完成录券。

**P5 人工校准、保存与历史**：方案强制用/禁用券、观测值差异、历史快照和规则修订；任何手动差额单列且可还原。

**P6 优化器**：凑单搜索、约束、排序、5 个差异方案、非最优提醒、与引擎同源复核。

**P7 单图与发布**：上传一张券图、OCR provider 可选、逐字段人工核对、确认导入；全链路 E2E、备份恢复演练、移动端适配、部署文档。

Codex 每个阶段要求：提交变更清单和测试结果，不得以静态 Mock 前端代替可运行服务；若环境无法跑 DB、OCR 或浏览器测试，明确声明未验证部分，不谎报通过。

## 14. 最低测试矩阵与发布门槛

1. 淘宝 2026 同店券与多件优惠互斥：2×100 九折 vs 200-10 → 180；
2. 京东同 SKU 普通店铺东券/品类东券不能直接双用；特殊券例外须显式配置；
3. 京东不同适用商品的不重叠券可同时应用；
4. 跨 A/B 两店 SKU，只有 eligible 商品参与平台门槛；
5. 店铺券只聚合自身店铺适用品；
6. 满减“满一次/每满”、阶梯、百分比封顶、运费和资产扣减都按独立作用域；
7. 4.3 的多店示例商品应付 410、现金应付 413；
8. 0.01 元边界、百分比分摊不能丢失或多出一分钱；折后价不能负；
9. 无效/过期/未领/错账号/未核验资格均返回正确 reason code；
10. 手动覆盖后自动结果仍可追溯；规则改版后历史快照不被重算覆盖；
11. 两工作区数据隔离、恶意 workspaceId/offerId 越权阻断；
12. 设备 A 创建 → B 凭 Key 恢复 → 改券 → A 能同步；Key 可轮换撤销；
13. 只保存方案不得自动扣减已持券次数；实际已下单单独人工记录；
14. 组合搜索 3 秒超时报告“当前较优、未证最优”，不输出虚假最优；
15. OCR 未配置可手工录券；配置后单图结果不经人工确认不得持久化；
16. Docker 重建 app 容器、恢复 PG 备份、数据库迁移失败处理均验收。

**最终交付门槛**：实际数据库 + 可用的三栏操作 + 多店券计算/逐商品解释 + 人工介入 + 数据持久化 + 自动测试 + 备份与部署说明；无法判断真实平台条件时清楚提示“不确定”，而非返回无依据的精准到手价。

## 15. Codex 接续指令

请阅读此文件并以此作为 Kousou V1 的产品/架构基线。**直接实施 P0，然后依次完成 P1–P7**，每阶段提交清晰 commit，并报告实现清单、测试、风险与下一阶段依赖。禁止将优惠计算简化成“总价依次减券”；先实现能解释按 SKU/店铺/跨店资格及互斥的 engine，再优化页面视觉。若需调整规则预设或发现平台新公告，保留来源、适用时间并同步更新本文。

---

**调研日期：2026-10-22**。规则为该日可核查材料的归纳，不保证覆盖全部活动，平台实际结算页始终为最终参照。来源见第 2 节及第 11 节，避免将旧京券规则或第三方口令攻略误当现行官方规则。
