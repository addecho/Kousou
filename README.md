# Kousou

淘宝 / 天猫单平台凑单工作台。当前交付为可运行验证版：Vue + Fastify 同源应用、真实 PostgreSQL、共享整数定价内核。

手动国补（引擎0.2.0）：编辑商品可勾选适用，按分类预填比例，支持改比例或每件固定补贴金额。家电15%仅是模拟预设，其他分类需自行填写；不验证官方资格或封顶。按店铺/平台优惠后商品金额计算，不改变券或包邮门槛，账户资产随后抵扣。已含国补的录入价格不要再次勾选。详见 [国补设计](code/research/government-subsidy-model.md)。

## 启动

需要 Node 24、pnpm 11.25.0、Docker Compose v2.24.4+。

```sh
pnpm install --frozen-lockfile
pnpm run setup
pnpm build
pnpm start
```

浏览器打开 `http://localhost:3000`。`setup` 是项目脚本，必须使用 `pnpm run setup`，不要误用 pnpm 自身的 `pnpm setup` 命令。

首次 setup 会生成未纳入 Git 的 `.env`，随机数据库密码及会话 pepper 不会输出。已有 `.env` 不覆盖。数据库监听本机 55432，数据存于 Compose 命名卷。启动脚本幂等，迁移单独运行，可用 `pnpm db:migrate` 重试。若端口占用，在 `.env` 调整应用 PORT；数据库端口须同步修改 compose 和 DATABASE_URL。

受限云机器默认用户缓存目录不可写时，安装命令使用：

```sh
XDG_DATA_HOME=/workspace/.local/share XDG_CACHE_HOME=/workspace/.cache XDG_STATE_HOME=/workspace/.local/state pnpm install --frozen-lockfile
```

`localhost` 指运行服务的那台机器。若代码运行在远端云环境，需要该平台提供端口转发，或者部署到自己的服务器；本项目不会自动生成公网地址。若通过 HTTPS 代理访问，在 `.env` 设置实际 `PUBLIC_ORIGIN=https://你的域名` 和 `COOKIE_SECURE=true`，重启服务。不要把云容器内部地址当作本机可访问地址。

## 如何验证

1. 创建工作区，保存恢复密钥；它仅展示一次。不要将密钥放在截图或日志中。
2. 选择“载入验收示例”，看到商品应付410元、运费13元、资产抵扣10元、现金413元。
3. 点击商品修改价格、数量，编辑优惠的门槛、范围、互斥组和核实状态；查看优惠拒绝原因及分摊。
4. 等到“已保存”后刷新，方案保持；保存快照，再打开历史查看服务端重新核算的金额。
5. 将一件商品角色改为可选/凑单，点击寻找凑单方案，可取消并应用结果。
6. 新浏览器输入恢复密钥，打开同一工作区。两个页面修改同一修订会提示冲突；可以重新加载或另存副本。

商品图片为示例配图，来自 Unsplash，文件已下载到 `apps/web/public/products`，不需要页面加载时访问图片站。其照片不构成真实SKU识别或报价证据；用户新录入商品默认使用商品图标。

## 已实现

- 工作区创建/密钥恢复/轮换/退出；HttpOnly会话、来源校验、限流、服务端租户过滤。
- 单账号一次结算、多店商品、商品角色、手动优惠录入、资格未知状态。
- 单件直降、店铺互斥择优、满减/每满/折扣封顶、指定商品范围、平台互斥组、逐行分摊。
- 每店运费、折后包邮门槛、固定金额运费券、手填资产额度、独立人工校准。
- 浏览器Worker试算及有界凑单搜索；同一内核服务端复核、持久快照、方案JSON导入导出。
- 自动保存、revision冲突处理、路由隔离、手机标签布局。

## 明确限制

这是首个可验证版本，不代表已完成计划中全部功能，也不保证平台结算一致。

- 淘宝公告“子订单”的所有业务拆分尚未取得完整证据。本版按每店一个优惠判定组模拟，同店最多选一个店铺优惠；自定义策略也使用该限制。
- 服饰品类券“只扣单品宝”的特殊基数尚未实现；不能用通用“单品直降后”代替。复杂分包、预售、国补、跨境税费不支持。
- 平台规则组合按录入顺序执行，同一非空互斥组只用一张；不同组或空组允许叠加，须用户核实。最多8张平台券、20款商品，不支持自定义执行图。
- 运费券仅固定减免、每店择优一张；资产额度按手填值抵扣，不验证真实资产的使用限制。
- 商品资格、券的领取状态、账号别名、价格与结算时点均由用户录入；没有连接商城。结算时点固定保存，可在设置中更新为当前时间。
- 优化搜索最多3秒以内目标预算、8000组合，设备和单次定价成本影响实际耗时；仅枚举已录入可选商品0至3件，必买数量保持。取消/关页会停止搜索，不后台继续。
- 截图上传/OCR、独立商品库/券库、独立真实观察值记录、设备列表及服务端版本升级草稿迁移尚未实现。
- 方案草稿用数据库JSONB聚合，定义在 `packages/contracts`，不是每个领域对象对应一张表。当前迁移包含工作区、会话、方案及快照。

已核实公开规则及原始证据见 [规则登记](code/research/platform-rules-2026-10-22.md)。

## 验证命令

```sh
pnpm typecheck
pnpm test
pnpm build
# 保持 pnpm start 运行后：
pnpm test:e2e
```

浏览器测试默认使用 `/usr/bin/chromium`。其他机器设置 `CHROMIUM_PATH` 指向已安装Chromium。E2E创建独立测试工作区，不删除用户数据；截图在忽略目录 `test-results`。

## 容器部署

完成 `.env` 初始化后：

```sh
docker compose -f compose.yaml -f compose.app.yaml up -d --build --wait
```

该模式数据库不映射宿主端口，应用只监听宿主127.0.0.1:3000，迁移先于应用启动。不要与上述原生Node方式同时占用3000。公网部署需自行配置HTTPS反向代理并设置PUBLIC_ORIGIN、COOKIE_SECURE；本次未申请域名或发布公网服务。

在带会话代理CA的托管环境构建时，先保留代理设置并传CA：

```sh
docker build --secret id=proxy_ca,src="$CODEX_PROXY_CERT" -t kousou:local .
docker compose -f compose.yaml -f compose.app.yaml up -d --no-build --wait
```

## 备份与恢复

数据库备份可能包含购物信息，放在仓库外并控制权限：

```sh
docker compose exec -T db pg_dump -U kousou -d kousou -Fc > /安全目录/kousou.dump
```

恢复先到一个新数据库验证，勿覆盖在用库：

```sh
docker compose exec -T db createdb -U kousou kousou_restore
docker compose exec -T db pg_restore -U kousou -d kousou_restore --exit-on-error < /安全目录/kousou.dump
```

`.env` 中 SESSION_PEPPER 需独立备份；更换会使既有恢复密钥摘要无法校验。不要提交 `.env`、数据库dump或恢复密钥。不要用 `docker compose down -v` 作为常规重启，它会删除数据卷。

## 开发文件

- `packages/core`：整数金额、资格/互斥、分摊、搜索。
- `packages/contracts`：唯一方案输入校验。
- `apps/server`：API、会话、Drizzle查询及SQL迁移。
- `apps/web`：Vue工作台及Web Worker。
- `code/architecture.md`：目标架构，未实现项以本README为准。
