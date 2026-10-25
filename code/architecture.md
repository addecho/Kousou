# Kousou 架构决策

日期：2026-10-22。状态：待实施的技术基线，不代表性能与部署已验证。产品范围遵循 [plan-2.md](plan-2.md)：先跑通淘宝/天猫，其他平台以后独立开页。本文件取代旧计划中冲突的技术结构建议。

实施更新：首个可验证版本已落地，实际交付范围、运行命令和限制以 [README](../README.md) 为准。本文件继续描述目标架构，未声明所有模块已完成。

真实样本审查更新：见 [淘宝购物车逐层对账](research/taobao-cart-reconciliation.md)。三件商品总账已核对，但规则语义尚未完整确认。下一版优先补齐商品级优惠账本、按活动的商品资格、独立门槛/折扣/运费基数和版本化预设；本轮没有修改线上计价语义。

政府补贴按用户最新要求简化并实现：[国补模型](research/government-subsidy-model.md)采用商品分类预设、手动适用开关、可编辑比例或每件固定金额。无地区/资格验证依赖，默认关闭；引擎0.2.0在店铺/平台优惠后单独计算，不改变券或包邮门槛，结果标记手动模拟。完整政策核验不属于当前范围。

## 1. 结论与选型

采用模块化单体：Vue SPA + Fastify，构建后由同一个 Node 应用提供静态页面和同源 API，PostgreSQL 保存用户数据。定价和优化共享一个可在浏览器及 Node 执行的纯 TypeScript 内核。浏览器 Web Worker 承担交互试算和短时搜索，服务端重新核算用户选择的结果。

| 层 | 决定 | 理由及代价 |
|---|---|---|
| 前端 | Vue 3 + TypeScript + Vite + Vue Router + Naive UI | 表单、表格和抽屉是主体；现成组件降低交互实现成本。无需 SEO，首版不引入 SSR |
| 前端状态 | Vue composable 管页面草稿；TanStack Vue Query 管服务端数据 | 分开未保存编辑与服务端缓存；首版不再引入 Pinia 作为第三份状态源 |
| 服务端 | Fastify 模块化单体，REST + Zod | 显式请求边界便于附件、会话和快照验证；不引入微服务或通用 CRUD 框架 |
| 计算 | TypeScript + bigint；比例用整数分子/分母 | 全程整数运算并明确取整；不同时维护 Decimal 和 bigint 两套金额系统 |
| 数据库 | PostgreSQL 18 + Drizzle + postgres.js | 保留事务、租户约束和成熟备份；接受一个数据库服务的运维成本 |
| 搜索执行 | 浏览器 Web Worker | 首版约3秒、有限候选、没有离线计算需求；设备性能有差异，搜索不承诺穷尽 |
| 验证 | Vitest + fast-check + Playwright + 真实 PG 集成测试 | 示例验证、数值不变量、交互和持久化分别覆盖 |
| 部署 | app + db；对公网时加 Caddy | 前后端一起发布，单域名、单应用版本；Caddy 只承担 HTTPS/反向代理 |
| 工程 | pnpm workspace，精简为4个包 | 保留必须的复用边界，无需 Nx/Turborepo 等构建编排层 |

Node 选择实施时仍受支持的 LTS，与依赖声明一起锁定到实际验证版本；pnpm 写入 packageManager，依赖保留 lockfile。PG18.6 是本次调研的版本记录，镜像 tag/digest 要在 P0 实测后锁定，不把文档中的版本号当作安装成功。

## 2. 为什么不整体更换框架

Nuxt 能合并工程入口，但本项目没有首屏 SEO、SSR 或内容页面需求；服务端渲染会增加浏览器 Worker 与客户端状态的边界工作。Vue/Vite + Fastify 的源码分工清晰，同时仍能打包为一个应用部署。

React/Next.js 没有针对当前业务的决定性收益。Python 后端会使浏览器试算与服务端复核需要跨语言协议或两份算法；Rust/WASM 暂无性能证据支持增加构建复杂度。SQLite 对极简个人安装很合适，但当前已有恢复 Key、多设备会话和服务端持久化目标，继续 PostgreSQL 可避免之后迁移；不同时维护两种数据库。

规则系统先实现已知优惠语义，不建设通用低代码规则平台。Redis、持久任务队列、事件溯源和跨平台统一商品库都没有首版必要性。

## 3. 四个包与模块边界

```text
apps/web/src/
  features/{workspace,plans,offers,coupons,imports}/
  workers/pricing.worker.ts
  api/ routes/ styles/
apps/server/src/
  modules/{sessions,plans,offers,coupons,imports}/
  db/{schema,migrations}/
  http/ static/
packages/core/src/
  model/ money/ eligibility/ pricing/ allocation/
  policies/taobao/ optimizer/ trace/
packages/contracts/src/
  http/ schemas/ serialization/
tests/{fixtures,integration,e2e}/
code/{plan-2.md,architecture.md,research/}
```

依赖方向：core 不依赖其他工作区包；contracts 可以依赖 core 类型；web/server 都依赖 core 与 contracts，彼此不导入。类型、解析 schema 和序列化协议各有唯一维护位置，不复制模型。core 的内部模块按领域分开，但不各建一个 npm 包。

server 按功能组织路由、用例服务和查询代码。数据库结构只在 server 内使用；不为每个表生成一组通用 service/repository。需要事务的保存动作直接由用例服务协调。只有真实存在多个实现时才定义接口，例如 OCRProvider；首版不做动态平台插件加载器。

## 4. 从编辑到可信快照

```text
用户编辑 -> 页面草稿 -> Worker试算 -> 即时展示结果/不确定条件
                  -> 自动保存 -> 服务端校验 -> PG方案新修订
用户选中凑单结果 -> 应用到草稿 -> 再保存
用户保存快照 -> 服务端读取指定修订 -> 重算 -> 原子写入快照
```

即时试算可以基于未保存草稿，界面分别显示计算状态和保存状态。Worker 只接收不可变输入，不读 Cookie、数据库或网络；每次请求带 requestId、inputHash、inputRevision、engineVersion。新编辑使旧结果失效，即使旧结果后到也不能覆盖新结果。

Web Worker 内先构造可行基线，再有界搜索；时间预算与取消控制放在运行层，不进入单次纯定价函数。搜索按确定性顺序遍历并有节点上限，同输入、同搜索步数可复现；按墙钟超时得到的 best_found 不承诺跨设备相同。重任务在 Worker 中执行，必要时 terminate 重建，不冻结界面。

浏览器保存快照只提交 planId、expectedRevision 和幂等请求 ID。服务端从数据库读取方案及已固定规则版本，执行 core 重算，校验修订未改变后在同一事务中写入结果；客户端金额只作展示，不作为可信输入。两个页面竞争时返回409，不能从旧草稿生成声称最新的快照。

服务端复核也必须有输入数量、规则数量和计算复杂度上限。P1 用最大规模 fixture 测量普通定价延迟；若事件循环阻塞影响并发请求，则在发布前切换为有界 Node worker_threads 池。无论执行位置如何，服务端不执行全量凑单搜索。单次合法券组合求解超限时返回明确的计算状态，不能假装已得平台最优。

静态资源带内容指纹；HTML 使用重新验证策略。API 公布 protocolVersion/engineVersion；打开的旧页面发现与服务端不兼容时保留草稿并要求刷新，不能让新版服务端静默接收旧语义。报价变化由用户显式刷新，不自动覆盖方案已有价格。

## 5. 方案聚合与存储

减少需要逐表同步的对象，把一次结算作为编辑及并发控制的最小单位。结构化身份和可复用资产用关系表；方案内部的行、分组、规则副本和覆写用经过 schema 校验的 JSONB 文档。

| 表 | 首版用途 |
|---|---|
| workspaces、workspace_keys、sessions | 工作区、恢复凭据、设备会话 |
| platform_accounts、shops | 逻辑账号、可复用店铺 |
| offers | 手动 SKU 资料及当前报价，含观察时间与上下文 |
| coupon_assets | 账号持有实例、规则文档、有效期、次数、修订 |
| checkout_plans | workspace/account/platform、title、revision、schema_version、document JSONB |
| calculation_snapshots | 方案引用、完整输入/结果、引擎与模板版本、输入摘要、计算时间 |
| checkout_observations | 人工记录真实结算值、差额说明和附件引用 |
| attachments | 私有文件元数据、临时/已关联状态、过期时间 |

首版不建 products 主数据体系、报价历史专表、规则来源关系网、分组成员表或任务表。平台预设和证据随代码版本管理；用户自定义规则保存在券资产和方案副本中。未来需要独立查询或多人并发编辑某类对象时，再有针对性拆表。

方案 document 包含 context、lines、groups、selectedCouponCopies、assetBudgets、overrides。复制报价/规则到方案时保留 sourceId/sourceRevision，随后源商品或券被修改只提示有新版；用户确认后更新副本。这样保存方案、自动保存和历史复现不会被共享对象的后台变化破坏。

JSONB 内引用不能依靠数据库外键：所有从商品库/券库复制或刷新数据的服务端用例，必须使用 workspace 和 account 限定查询并校验归属；租户身份始终从会话取得。方案结构、金额字符串、数量和文档大小经过 Zod 及领域校验，不能任意存 JSON。账户外键等关系列仍用同租户复合外键。

更新采用 `UPDATE ... WHERE id = ? AND workspace_id = ? AND revision = ?` 的原子比较并递增修订。首版用整份方案 PUT，禁止“先查询再无条件覆盖”；每个页面对同一方案串行发送保存请求，合并等待中的最新编辑。409 时提供重新加载或另存副本，不做没有语义依据的自动合并。

把已保存 revision、未保存草稿和请求中的副本分清。Vue Query 只管理已保存服务端对象，编辑 composable 持有草稿；后台 refetch 不覆盖脏草稿。页面切回焦点时检查修订；不需要 WebSocket。每个标签页方案 ID 由路由决定。

## 6. 将规则表达控制在可测试范围

保留门槛范围、受益范围、排他作用域、分摊策略与证据，但首版不开放任意 AST、公式输入或用户自定义阶段图。规则定义使用 Zod discriminated union：fixed_off、threshold_off、every_full、percent_off、quantity_discount、shipping_off。

门槛使用有限的 BasisSpec：priceBasis 加 excludedAdjustmentKinds，例如合同商品价减 single_item_bao。每一种价格基数必须可追溯，未知即 unknown_basis。多档优惠用经过验证的档位数组表示；未知规则类型拒绝计算。模板的阶段依赖由代码配置和校验，用户只能选择支持的策略。

把工作分成 normalize -> eligibility -> legal selection -> evaluate -> allocate -> trace 六步。平台模板是数据与小范围确定性策略函数，不能夹带网络调用。先给同一批商品选合法券组合，再计算结果；不把逐券贪心当全局最优。若平台强制的局部择优与用户可选策略不同，分别建模并测试。

取整使用整数除法、余数和明确的舍入模式，不用 JS 浮点参与金额计算。JSON 中仍使用分的十进制字符串。UI 可显示中文券描述，但存储格式不得依赖自然语言解析。

## 7. 导入与后台任务的引入时机

首版券图上传后手动填写并确认即可。附件私有存储，临时附件定期清理，确认动作幂等。OCR 配置不影响主流程。

外部 OCR 初次接入可以采用受限时长的同步请求：设置超时和并发上限，失败回退人工，未知执行结果不自动重试产生费用。若供应商必须异步、任务需要断线后继续或出现批量导入，再新增持久任务表、领取租约和专用 worker；此时使用成熟 PostgreSQL 队列库并实测恢复行为，不手写一个通用调度系统。Redis 并非引入异步任务的前提。

浏览器搜索关页即停止，UI明确区分未保存草稿与已保存方案。未来只有实测移动端无法承受目标规模或确需后台持续搜索，才引入服务端搜索任务与资源配额。

## 8. 部署、验证与演进门槛

生产 app 镜像多阶段构建：Vite 静态产物加 server 运行文件，同一应用版本交付。开发使用 Vite dev server 代理 /api 到 Fastify；生产由 Fastify 提供 /api、静态文件与受控 SPA fallback，API 404 不返回 index.html。Caddy 位于外层，不需要单独前端业务容器。

单次迁移作为部署命令，不放入每个副本启动流程。启动 readiness 校验数据库和 schema 版本，liveness 不依赖数据库。POST/附件限制体积，日志只记录请求 ID、耗时、状态和版本，默认不记录用户购物清单、券图或密钥。

关键验证：核心金额属性测试；浏览器与 Node 对同输入输出相同；两个页面的自动保存与409；旧前端/新后端版本不一致；真实PG迁移、租户隔离、备份恢复；最大输入的试算延迟及内存。性能目标在 P1/P4 以设备和数据规模记录实测，不能在规划阶段声称达标。

新增平台只增加模板模块、fixture 和入口选项，数据仍固定 platform。多平台用户各开一个页面；不为此引入跨平台总订单、商品匹配服务或统一搜索调度。

实施顺序：P0四包骨架与真实PG -> P1纯引擎和官方算例 -> P2单平台录入/保存/快照闭环 -> P3交互、校准和多页一致性 -> P4浏览器凑单搜索 -> P5发布验证与可选导入。先验收可用闭环，再扩大优惠覆盖。
