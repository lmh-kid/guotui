# 果推 - 智能订单推单系统 AGENTS.md

## 项目概览

一套类似方果 ERP 的多用户订单推单系统，支持多平台（Temu/Shein/速卖通等）订单统一管理、一键推单到工厂，**按单计费（日结）独立余额**。

### 核心架构原则（重要）
- **订单不落库**：订单数据在用户查询时实时从方果 API 拉取（透传），本地不存任何订单信息
- **本地仅持久化**：用户信息（user_balances）、钱包流水（wallet_transactions）、推单计费记录（push_records）、方果资金流水（fangguo_transactions）、店铺分配（shops）、系统配置（system_configs）
- **计费模式：日结（定时任务，真实扣余额）**：用户应付 = 方果材运费（材料费含推单预扣——预扣即真实扣款，发货转实扣不二次扣，按订单取较大者）+ 0.5×当日全部推送订单数。每天 00:00（Asia/Shanghai）定时结算昨日账期（`src/lib/daily-settlement.ts`，server.ts 注册 node-cron）并真实扣除余额；材运费滞后 1-3 天出账，后续日结自动补扣/补退（重算补差）；系统推单时不扣费（仅记录 push_records）；负余额禁止推单
- **订单查询窗口**：仅支持近 1/3/7 天（方果 tidList 接口限制）

### 版本技术栈
- **Framework**: Next.js 16 (App Router)
- **Core**: React 19
- **Language**: TypeScript 5
- **UI 组件**: shadcn/ui (基于 Radix UI)
- **Styling**: Tailwind CSS 4
- **数据库**: Supabase (PostgreSQL)
- **认证**: 自建账号密码（auth_accounts/auth_sessions + scrypt，Supabase Auth 已废弃）

## 目录结构

```
├── public/                     # 静态资源
├── src/
│   ├── app/
│   │   ├── api/                # 后端 API 路由
│   │   │   ├── balance/        # 余额查询 GET
│   │   │   ├── wallet/
│   │   │   │   ├── recharge/         # 充值 POST
│   │   │   │   └── transactions/     # 流水列表 GET
│   │   │   ├── orders/         # 订单相关（实时透传）
│   │   │   │   ├── route.ts            # 列表 GET（实时拉方果+店铺过滤+内存分页）
│   │   │   │   ├── [id]/
│   │   │   │   │   └── push/route.ts   # 单条推单 POST（id=方果tid）
│   │   │   │   └── batch-push/route.ts # 批量推单 POST
│   │   │   ├── auth/             # 自建认证
│   │   │   │   ├── login/route.ts    # 登录 POST（account/password → token）
│   │   │   │   ├── logout/route.ts   # 登出 POST
│   │   │   │   └── me/route.ts       # 当前用户 GET
│   │   │   ├── admin/           # 后台管理（需管理员权限）
│   │   │   │   ├── check/route.ts          # 检查管理员权限 GET
│   │   │   │   ├── users/route.ts          # 用户列表 GET / 创建用户 POST / 删除用户 DELETE
│   │   │   │   ├── adjust-balance/route.ts # 调整用户余额 POST（入参 userId）
│   │   │   │   ├── transactions/route.ts   # 全局流水 GET
│   │   │   │   ├── push-records/route.ts   # 推单日账单聚合 GET（用户×日期）
│   │   │   │   └── fangguo/                # 方果平台对接（KEY配置/店铺分配）
│   │   │   └── supabase-config/ # Supabase 配置注入
│   │   ├── login/               # 登录页（无注册，账号由管理员创建）
│   │   ├── admin/               # 后台管理页（用户管理：创建/删除/调余额/调整店铺分配；流水/日结账单（材运费+0.5，含手动触发日结）/平台对接）
│   │   ├── wallet/              # 钱包页
│   │   ├── page.tsx             # 首页（订单管理：实时透传+计费状态栏）
│   │   └── layout.tsx           # 根布局
│   ├── components/
│   │   ├── ui/                  # shadcn/ui 组件库
│   │   ├── app-layout.tsx       # 应用侧边栏布局（余额随 balance-updated 事件刷新）
│   │   └── auth-provider-wrapper.tsx  # AuthProvider 客户端包装
│   ├── lib/
│   │   ├── auth-provider.tsx    # 认证上下文（登录态/用户信息）
│   │   ├── auth-utils.ts        # 服务端认证工具（getCurrentUser 查 auth_sessions）
│   │   ├── password.ts          # scrypt 密码哈希/校验
│   │   ├── account.ts           # 账号名校验/清洗（isValidAccountName/normalizeAsciiInput）
│   │   ├── api-request.ts       # 前端 API 请求封装（自动带 x-session）
│   │   ├── fangguo.ts           # 方果 API 客户端（店铺/订单详情/推单/状态映射）
│   │   ├── fangguo-live.ts      # 订单实时透传（tidList分页→detail并发8→60s全局缓存→店铺过滤）
│   │   ├── push-billing.ts      # 日结计费（惰性结算settleUser/配额getPushBillingStats/幂等recordPushes）
│   │   ├── billing.ts           # PUSH_FEE=0.5 常量（旧扣费函数已停用）
│   │   ├── supabase-browser.ts  # 浏览器端 Supabase 客户端（已无引用，仅保留）
│   │   ├── supabase-config-inject.tsx  # Supabase 配置注入组件
│   │   └── utils.ts             # 通用工具（cn 等）
│   ├── server.ts                # 自定义启动（next + node-cron 每天 00:00 日结定时任务）
│   └── storage/database/
│       ├── supabase-client.ts   # 服务端 Supabase 客户端（含 getSupabaseAdminClient）
│       └── shared/schema.ts     # Drizzle Schema 定义
├── DESIGN.md                    # 设计规范
├── package.json
└── tsconfig.json
```

## 核心数据模型（Supabase Tables）

| 表名 | 说明 | 关键字段 |
|------|------|----------|
| `auth_accounts` | 自建认证账号 | user_id(PK), account(UNIQUE), password_hash(scrypt) |
| `auth_sessions` | 登录会话 | token(PK), user_id, expires_at(7天) |
| `user_balances` | 用户余额 | user_id, balance, frozen_balance, total_recharge, total_consume, is_admin |
| `wallet_transactions` | 钱包流水 | user_id, type(recharge/consume/refund), amount, description, balance_after |
| `push_records` | 推单计费记录（日结依据） | user_id, order_no, push_date, fee_applied, settled_at；UNIQUE(user_id, order_no) |
| `fangguo_transactions` | 方果资金流水镜像（日结材运费依据） | id(PK=方果流水id), user_id(店铺名映射), tid, kind(charge/refund/prehold/exclude/unknown), processed_amount, settle_date, settled；upsert 幂等 |
| `shops` | 用户店铺（方果店铺分配） | user_id, platform, shop_name, fangguo_shop_id, platform_code, brand_name, status |
| `system_configs` | 系统配置（无RLS，仅service role） | key(fangguo_api_key), value |
| `user_images` | 图片名称映射（图片本体在群晖 NAS，**不缓存图片**） | user_id, account, file_name, category, remote_dir, remote_path(UNIQUE), size, mime |

**已删除表**：`orders`、`products`（历史遗留表，订单实时透传架构下无引用；其对 shops 的外键曾导致店铺取消分配与删除用户失败，已于数据库中 DROP）

### 订单状态枚举（status，实时计算不落库）
- `pending` - 待整理（dfStatus 0/2）
- `decoded` - 待推送（dfStatus 1，**唯一可推送状态**）
- `pushed` - 已推送（dfStatus 3）
- `production` - 生产中（dfStatus 4/5）
- `shipped` - 已发货（deliverTime 有值）
- `voided` - 已作废（outerOrderStatusDesc 含「交易关闭」即平台侧取消/退款；注意此类单 dfStatus 可能仍为 1，推送前后端双重拦截 `isVoidedOrder`；未知 dfStatus 也保守归入此类禁止推送）

订单页默认 Tab 为「待整理」（pending）。

### 计费规则（日结 = 材运费 + 0.5 服务费，日清日结+迟到补账）
用户应付 = 方果材运费（含推单预扣）+ 0.50 元/单（`src/lib/billing.ts` PUSH_FEE）

- **费用数据源**：方果资金流水接口 `/shop/transaction-line/page`（`fangguo.ts` fetchTransactionLines，商家端一次只能查一个工厂）。流水 kind 分类（daily-settlement.ts classifyLine）：
  - charge（实扣·入账）：预扣转实扣（材料费，打包发货/一键打包节点）+ 扣费·非订单推送（运费等）
  - prehold（预扣·**入账**）：扣费·订单推送 = 推单时材料费**真实扣款**（实测 prehold 与「预扣转实扣」条数金额 1:1 相等，204/206 单，发货转实扣只是状态确认不二次扣）；材料费按订单 tid 聚合取「预扣总额 vs 实扣总额」绝对值较大者入账（未发货计预扣、已转实扣计实扣、仅实扣无预扣时计实扣），避免双计/漏计
  - refund（退费·**无条件入账**）：feeType=退费/预扣退费，预扣已入账故退费必须冲抵（推送即取消的单：预扣 -X + 退费 +X = 0，净 0）
  - exclude（排除）：充值类（运营方在方果充值）
  - unknown（未知类型）：保守跳过不入账，管理员账单可见
- **推单时**：系统不即时扣费，仅插入 push_records（fee_applied=false，UNIQUE 幂等防重复计费）；方果侧推单即真实扣材料费（prehold），由当天日结统一扣系统余额
- **推单服务费口径（三处统一：settleUserDay / 钱包每日扣款 / 管理端日结账单）**：按**当天（上海自然日 0:00-23:59:59，=方果 settle_date 账期）全部推送订单**计（含方果后台直推）——用方果「扣费·订单推送」prehold 预扣流水去重 tid 统计（每单一条，重推/取消重推去重算 1 单）；当天流水未同步时由 push_records.order_no 兜底合并（`pushedTids = new Set<string>()`，`pushCount = pushedTids.size`）。push_records 仍记录系统推单（UNIQUE 幂等）+ 参与结算标记，但不再单独作为计费依据；资金明细页 0.5 服务费只计入「行日期 = 该单首次推送日（最早 prehold settle_date）」的行，单日视图与日结完全对齐；**资金明细行口径（fangguo-lines）**：行的 `time` 取**推单时刻**（最早一笔 prehold 的 transaction_time，上海本地时间，与方果后台显示一致，非发货转实扣时刻），整行费用（材料 max(预扣,实扣) + 运费 + 0.5）归属**推送日**（最早 prehold settle_date；推送日早于 settlement_start_date 或预扣缺失时回退扣费日），归属日不在查询窗口内的行不展示——昨日推送、今日发货的单只出现在昨日列表，不重复进出当天列表
- **服务费不跨日补收**：订单推送日与发货日跨账期时（如 11-18 推、11-19 发货），服务费只在**推送日账期**收取，扣费账期不补收（实测 11-19 = 当天推送 15 单 × 0.5 = 7.50，不含 18 号推的 2 单）；推送日早于 settlement_start_date 的单服务费不收（不追账）
- **材料费跨账期去重（重要）**：同一订单 prehold（推送日账期）与 charge（发货日账期）跨账期时，材料费已在推送日账期按 max(预扣,实扣) 入账，实扣账期只补差额（实扣 > 预扣时，`priorPaidByTid` 查更早账期 prehold 总额）。推送日早于 startDate（不追账）的订单在实扣账期收全额，否则该单材料费永远收不到。避免同一单材料费双扣
- **定时日结（日清日结）**：每天 00:00（Asia/Shanghai，server.ts node-cron）执行 `runDailySettlement()`：
  1. 同步最近 7 天流水 upsert 进 fangguo_transactions（id 幂等，容忍补录/补跑；settled 标记不在 upsert 列，不被覆盖）
  2. 结算所有账期 ≤ 今天（settleCutoff=today，0 点跑即昨日账期）的未结算数据，**真实扣余额**：每用户每账期 = Σ材料费（按订单 tid 取 max(预扣, 实扣)）+ Σ运费等实扣 + Σ退费 + 0.5×当日推单数，写一条 consume 流水（描述「日结 YYYY-MM-DD：推单 X 单 ¥Y + 材运费 ¥Z」），乐观锁扣余额（3 次重试，**允许负余额**），total_consume 累加绝对值
  3. **迟到补账（重算补差 recompute-and-reconcile）**：材运费滞后 1-3 天出且记在订单日账上，后续日结发现已结算账期有新流水时，重算该账期全量应付（materialFreight 负 + refundTotal 正 − 0.5×推单数），与已有「日结 {date}%」前缀流水总和比对：差额 < 0 写「日结 {date} 补扣：¥X」（consume，再扣余额）；> 0 写「日结 {date} 补退：¥X」（refund，回补余额）；≈0 仅补标记。账单始终对齐方果
  4. 幂等保障：重算补差天然幂等（每次对齐全量）+ 全局锁 getRunLock（定时/手动互斥）+ per-user 锁 withUserLock + 余额乐观锁（.eq(balance, 旧值) 条件更新）
  5. 未归属流水（storeName 未匹配 shops）不入账，管理端告警可见；店铺分配后下次同步自动补填 user_id 补账
  6. 结算起始日保护：settle_date < system_configs.settlement_start_date 的流水不追账，谓词整体标记 settled=true 跳过（**禁止 .in(id 列表) 更新**——历史积压数百条会撑爆 PostgREST URL 长度限制静默失败；同类更新必须谓词过滤并检查返回 error）
- **账期归属**：按 transactionTime 的上海自然日（=方果账单记账日：订单 10 号出、运费 12 号才出仍记 10 号账上；实测 85% 差 0 天、15% 差 1 天）；管理端「方果每日对账」表按此口径全量分日汇总，可直接与方果后台账单核对
- **负余额拦截**：balance < 0 时 `blocked=true`，推单接口返回 403，直到管理员补调
- **配额预检**：availableQuota = floor(balance / 0.5) - 今日未结算单数（仅约束 0.5 服务费；材运费按日结事后扣，靠负余额拦截兜底）
- **注意**：0 点结算时当天流水尚未出全（运费多在打包发货时出账），日结金额是「当时已知部分」；0 点后新出的流水由迟到补账机制在下次日结自动补扣——管理后台「手动结算」按钮可即时触发，钱包「每日扣款记录」按前缀汇总展示主结算+补扣/补退合计

## 方果平台对接（实时透传架构）

**架构**：运营方统一方果账号（API KEY 存 `system_configs` 表 key=`fangguo_api_key`，仅管理员可配）。订单不落库，用户查询时实时拉取并按店铺过滤展示；用户推单时系统代理调方果 API，工厂由方果按订单自动路由（订单自带 factoryId，只读展示）。

**核心模块**：
- `src/lib/fangguo.ts` - 方果 API 客户端（Bearer 认证，`{code,data,msg}` 协议，code=0 成功）
- `src/lib/fangguo-live.ts` - 实时订单透传：
  - `fetchLiveOrders(days)`：tidList 分页拉取（pageSize 100，上限 500 单）→ detail 并发拉取（批次 8，Promise.allSettled 容错）→ 按 pay_time 倒序
  - 60 秒全局缓存（globalThis.__fgLiveCache，多用户共享，缓存 key=days:startOfToday）
  - `filterByShops(orders, shopNames)`：按 shops 表店铺名精确匹配 store_name
- `src/lib/push-billing.ts` - 推单计费模块（getPushBillingStats 配额 / recordPushes 幂等记录 / getUserShopNames）
- `src/lib/daily-settlement.ts` - 日结核心（syncTransactionLines 流水同步7天窗口 / settleDueDays 日清日结+迟到补账 / settleUserDay 重算补差 / classifyLine 流水分类 / runDailySettlement 入口，与手动触发共用全局锁）

**修改商家编码**（待整理/待推送订单，`/order/saveProduct`）：
- `src/lib/fangguo.ts` 内封装：`getMaterialColors(factoryId)`（材质→颜色级联）、`getMerchantCodeOptions()`（型号/图号聚合）、`saveProduct()`
- 型号/图号数据源：`warehouse/shop/goods/page` 商品库分页聚合（时间窗 ≤7 天，多窗口扫描），**6 小时全局缓存**（globalThis.__fgOptionsCache）；首次访问惰性加载，订单列表接口触发预热，`optionsReady` 标识是否就绪
- 官方 `basic/models/v1` 接口探测 30+ 参数组合均报「缺少商家或工厂id」不可用（文档无参数示例），故型号选项改用商品库聚合替代
- 型号与材质联动：聚合时同步构建「材质→型号」映射（`FactoryCodeOptions.modelsByMaterial`），弹窗选材质后型号下拉仅显示该材质出现过的型号；材质无商品库数据时回退全量；切换材质时若当前型号不在新材质候选中则清空重选
- 保存后调 `refreshLiveOrder(tid)` 刷新实时缓存使改动即时生效
- 前端：`src/components/merchant-code-dialog.tsx`（960px 弹窗，按 SKU 行编辑材质/颜色/型号/图号，材质→颜色/型号双重级联，全部为可搜索下拉 `combo-select.tsx`）；仅 pending/decoded 状态显示入口

**方果状态映射**（dfStatus: 0待整理 1待推送 2已反审 3工厂待审 4生产中 5已打包；deliverTime 有值→shipped）：
- 0/2 → status=pending；1 → decoded；3 → pushed；4/5 → production
- 推单校验：仅 df_status=1 可推，推送成功后置 df_status=3 并记录 push_records

**平台码**：25=Temu全托管，125/225/325/525=Temu半托管分区 → `temu`；其他按 platformDesc 文本匹配

**店铺过滤规则**：detail 仅含 storeName（无 shopId），按 shops 表 shop_name 精确匹配；用户无店铺时返回 noShop=true（前端提示联系管理员分配）

**已移除**：订单落库定时同步（fangguo-sync.ts）、订单落库、解码（batch-decode/[id]/decode）、商品管理、模拟数据（demo/seed）；遗留表 orders/products 已从数据库删除。现行定时任务仅一个：日结结算（node-cron，见 src/lib/daily-settlement.ts）

## 鉴权方式（自建账号密码认证）

**前后端统一使用 `x-session` header**

- **认证体系**：完全自建，不依赖 Supabase Auth（auth.users 已清空废弃）
  - `auth_accounts` 表：账号（account 唯一）+ scrypt 密码哈希（`src/lib/password.ts`：hashPassword/verifyPassword，格式 `scrypt$<salt>$<hash>`）
  - `auth_sessions` 表：登录会话（token 主键，7 天过期，过期访问即失效清理）
- **登录流程**：`POST /api/auth/login`（account+password）→ 校验密码 → 生成 64 位随机 token 写入 auth_sessions → 返回 `{token, user}`；前端存 localStorage
- **前端**：`api-request.ts` 自动从 `useAuth()` 获取 token 并注入 `x-session` header
- **后端**：各 API route 通过 `getCurrentUser(token)`（`src/lib/auth-utils.ts`）查 auth_sessions 验证，返回 `{id, account}`
- **数据访问**：业务表查询统一走 `getSupabaseAdminClient()`（service role）+ 显式 `.eq('user_id', user.id)` 过滤，不依赖 RLS

## API 接口清单

| 方法 | 路径 | 功能 | 鉴权 |
|------|------|------|------|
| POST | /api/auth/login | 登录（account/password → token） | 否 |
| POST | /api/auth/logout | 登出（删除会话） | 是 |
| GET | /api/auth/me | 当前用户信息 | 是 |
| GET | /api/balance | 查询余额（触发惰性日结算） | 是 |
| GET | /api/wallet/transactions | 钱包流水列表 | 是 |
| POST | /api/wallet/recharge | 模拟充值 | 是 |
| GET | /api/orders | 订单列表（实时透传；参数 page/pageSize/status/keyword/days=1\|3\|7） | 是 |
| POST | /api/orders/[id]/push | 单条推单（id=方果tid；校验归属/df状态/配额） | 是 |
| GET | /api/orders/[id]/merchant-code | 改码弹窗数据（订单SKU行 + 材质/颜色/型号/图号选项） | 是 |
| POST | /api/orders/[id]/merchant-code | 保存商家编码（body: {items:[{id,materialCode,colorCode,modelCode,pictureCode}]}） | 是 |
| POST | /api/orders/batch-push | 批量推单（body: {order_nos: string[]}） | 是 |
| GET | /api/admin/check | 检查是否管理员 | 是 |
| GET | /api/admin/users | 用户列表（含余额） | 管理员 |
| POST | /api/admin/users | 创建用户（账号/密码/初始余额） | 管理员 |
| DELETE | /api/admin/users | 删除用户（body: {userId}；防护自身与管理员；级联清理 auth_sessions/auth_accounts/shops/wallet_transactions/push_records/user_balances，任一清理失败即中止返回500） | 管理员 |
| POST | /api/admin/adjust-balance | 调整用户余额（body: {userId, amount, description}，正充负扣） | 管理员 |
| GET | /api/admin/transactions | 全局流水记录 | 管理员 |
| GET | /api/admin/push-records | 推单日账单（days 1-31，用户×日期聚合+汇总） | 管理员 |
| POST | /api/admin/settlement/run | 手动触发日结（同步流水+结算，与定时任务等价互斥） | 管理员 |
| GET | /api/admin/settlement/records | 日结账单（days 1-31，用户×账期：推单数/推单费/材运费/退费/合计/结算状态） | 管理员 |
| GET | /api/admin/fangguo/config | 方果 API KEY 配置（脱敏） | 管理员 |
| POST | /api/admin/fangguo/config | 保存/验证方果 API KEY | 管理员 |
| GET | /api/admin/fangguo/shops | 方果店铺列表（含分配状态） | 管理员 |
| POST | /api/admin/fangguo/assign | 店铺分配/取消分配 | 管理员 |
| GET | /api/supabase-config | 获取 Supabase 配置 | 否 |
| GET | /api/images | 图片列表（实时读群晖；参数 category；返回 dirExists/categories/files） | 是 |
| POST | /api/images/mkdir | 创建用户 NAS 目录（body: {category?}） | 是 |
| GET | /api/images/check | 批量查重名（参数 category/names） | 是 |
| POST | /api/images/upload | 上传图片（body=原始二进制，参数 category/name/overwrite） | 是 |
| GET | /api/images/preview | 图片预览代理（参数 path/thumb，仅本人目录） | 是 |

### /api/orders 响应格式
```json
{
  "list": [...LiveOrder],
  "total": 104, "page": 1, "pageSize": 20,
  "statusCounts": {"all": 104, "shipped": 103, "pending": 1},
  "billing": {"balance": 60, "blocked": false, "todayPushed": 0, "todayUnsettled": 0, "unsettledAmount": 0, "availableQuota": 100},
  "noShop": false, "days": 7
}
```

### LiveOrder 关键字段
order_no（=tid，前端行主键）、sys_tid、platform、platform_desc、order_type_desc、status、decode_status、df_status、product_name、product_image、spec、merchant_code、quantity、price、pay_time、deliver_time、tracking_no、logistics_company、store_name、factory_id、buyer_remark、shop_remark（**无收件人字段**：方果 detail 接口不返回 receiver，Temu 全托管不提供）

## 账号体系（自建账号密码）

- **纯账号登录**：用户使用账号名（如 `admin`、`test`）+ 密码登录，无邮箱概念，无邮箱映射（旧 `@guotui.local` 映射已废弃）
- **登录页**：仅账号+密码输入框
- **无自助注册**：新用户由管理员在 `/admin` 后台创建（账号+密码+初始余额）
- **管理员标记**：`user_balances.is_admin = true`（通过 SQL 设置）
- **创建用户**：账号名校验（`src/lib/account.ts` isValidAccountName：字母开头，仅字母/数字/`._-`，2-32 位）+ 密码至少 6 位；输入自动做全角转半角清洗（normalizeAsciiInput）
- **预置账号**：`admin`/`admin@123`（管理员）、`test`/`test123`（普通用户，已分配 4 个店铺）；seller001@example.com 及相关 Supabase Auth 账号已全部清理
- **会话**：token 存 localStorage（key `guotui_token`），7 天有效期，过期自动 401 踢回登录页

## 开发命令

- `pnpm install` - 安装依赖
- `pnpm run dev` - 启动开发环境
- `pnpm run build` - 构建生产版本
- `pnpm run start` - 启动生产环境
- `pnpm lint` - 代码检查
- `pnpm ts-check` - TypeScript 类型检查

## 数据库变更流程

1. 修改 `src/storage/database/shared/schema.ts` 中的 Drizzle schema
2. 运行 `npx coze-coding-ai db generate-models` 重新生成模型
3. 运行 `npx coze-coding-ai db upgrade` 执行数据库迁移

## 关键注意事项

1. **Hydration 安全**：所有使用登录态的组件必须配合 `useAuth()` + `isLoading` 判断，避免 SSR 与客户端不一致
2. **RLS 策略**：业务查询统一走 service role client + 显式 user_id 过滤（自建认证后不再依赖 RLS 做隔离，但存量策略保留）
3. **日结幂等性**：三重保障——fee_applied 标记 + per-user Promise 锁（防并发结算）+ 余额条件更新（乐观锁）
4. **x-session 约定**：前后端鉴权 header key 固定为 `x-session`，value 为自建会话 token（auth_sessions.token，64位随机串）
5. **分页格式**：列表接口统一返回 `{ list, total, page, pageSize, ...extra }` 格式
6. **订单无持久化**：任何订单相关逻辑（状态/筛选/统计）均基于方果 API 实时数据 + 内存计算，重启即失效（缓存仅 60 秒）
7. **测试副作用**：验证过程中产生过小额充值/调账流水属正常测试数据（seller001@example.com 为历史演示账号，店铺已转给 test，密码未知）

## 图片管理模块（群晖 NAS 直传）

**架构**：`/images` 页面 → Next.js API（服务端持群晖凭据）→ 群晖 File Station API（`https://15.nat0.cn:23233/webapi/entry.cgi`）。图片本体只存 NAS，**服务端不落盘、不缓存**；`user_images` 仅记录名称映射。

- **凭据**：`src/lib/synology.ts` 内常量（子账号 九因科技，非管理员账号），**不可下发前端**
- **接口版本**：`SYNO.API.Auth` 用 **v3 + session=FileStation**（拿到的 SID 才能调 FileStation；v7 的 SID 调 FileStation 返回 401，仅作兜底）；`SYNO.FileStation.List` v2；`SYNO.FileStation.Upload` v2（multipart：path/create_parents/overwrite/file）；`SYNO.FileStation.CreateFolder` v2；预览用 `SYNO.FileStation.Thumb`，失败回退 `Download`
- **SID 缓存**：globalThis 缓存 20 分钟，错误码 119/106/107/**401** 自动重登重试一次
- **目录规则**：管理员根目录 = 给定的 `/数码印花图片/28-九因科技`；普通用户 = `/数码印花图片/28-九因科技/{账号}`；分类 = 再下一层 `{分类}`（`resolveUserDir`）
- **目录不自动创建**：列表接口返回 `dirExists`，前端展示「创建根目录」按钮调 `/api/images/mkdir`
- **判重**：上传前 `/api/images/check` 批量查同名（群晖 `overwrite=false` 会静默 `blSkip`，必须前置查）；重名弹窗三选一（跳过/改名/覆盖）
- **限制**：单张 200MB（`MAX_UPLOAD_BYTES`）、后端并发 3（`UPLOAD_CONCURRENCY` 信号量）；≤32MB 走内存直发，更大走流式 + 字节数校验
- **权限**：所有登录用户可用；不提供删除功能（NAS 子账号权限受限）

## 部署（Docker + 阿里云镜像仓库）

产物形态：Next.js SSR + 自定义 server（`dist/server.js` 内含 node-cron 日结任务），**不是静态站**，镜像必须内置 Node 运行时。

- `Dockerfile`：多阶段（builder：pnpm install → `next build --webpack` → `tsup` 打包 server；runner：pnpm 只装生产依赖 + 复制 `.next/dist/public`），`CMD node dist/server.js`，监听 5000
- `assets/deploy.ps1`：本地 push → 构建机拉指定 commit 并 `docker build` → `push-image.sh` 推仓库 → 目标机 `pull-image.sh` → 重建容器 → 健康检查（`/api/auth/me` 期望 401）失败自动回滚上一镜像
- 运行时必需环境变量（写入目标机 `/root/release/guotui/.env.production`）：`COZE_SUPABASE_URL`、`COZE_SUPABASE_ANON_KEY`、`COZE_SUPABASE_SERVICE_ROLE_KEY`、`COZE_PROJECT_DOMAIN_DEFAULT`、`COZE_PROJECT_ENV=PROD`、`PORT`、`TZ=Asia/Shanghai`
- 容器参数：`--restart unless-stopped --log-driver json-file --log-opt max-size=10m --log-opt max-file=3`（日志量小，靠 docker 轮转即可，无需应用层清理）
- **只能单实例**：日结定时任务在进程内，多副本会重复结算
