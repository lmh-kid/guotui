# 果推 - 智能订单推单系统 AGENTS.md

## 项目概览

一套类似方果 ERP 的多用户订单推单系统，支持多平台（Temu/Shein/速卖通等）订单统一管理、一键推单到工厂，**按单计费（日结）独立余额**。

### 核心架构原则（重要）
- **订单不落库**：订单数据在用户查询时实时从方果 API 拉取（透传），本地不存任何订单信息
- **本地仅持久化**：用户信息（user_balances）、钱包流水（wallet_transactions）、推单计费记录（push_records）、方果资金流水（fangguo_transactions）、店铺分配（shops）、系统配置（system_configs）
- **计费模式：日结（定时任务）**：用户应付 = 方果实扣材运费 + 0.5×推单数。每天 00:00（Asia/Shanghai）定时结算账期 ≤ 昨天的费用（`src/lib/daily-settlement.ts`，server.ts 注册 node-cron），每用户每天一条 consume 流水；推单时仅记录 push_records 不扣费；负余额禁止推单
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

**已删除表**：`orders`、`products`（历史遗留表，订单实时透传架构下无引用；其对 shops 的外键曾导致店铺取消分配与删除用户失败，已于数据库中 DROP）

### 订单状态枚举（status，实时计算不落库）
- `pending` - 待整理（dfStatus 0/2）
- `decoded` - 待推送（dfStatus 1，**唯一可推送状态**）
- `pushed` - 已推送（dfStatus 3）
- `production` - 生产中（dfStatus 4/5）
- `shipped` - 已发货（deliverTime 有值）
- `voided` - 已作废（outerOrderStatusDesc 含「交易关闭」即平台侧取消/退款；注意此类单 dfStatus 可能仍为 1，推送前后端双重拦截 `isVoidedOrder`；未知 dfStatus 也保守归入此类禁止推送）

订单页默认 Tab 为「待整理」（pending）。

### 计费规则（日结 = 材运费 + 0.5 服务费，定时任务模式）
用户应付 = 方果实扣材运费 + 0.50 元/单（`src/lib/billing.ts` PUSH_FEE）

- **费用数据源**：方果资金流水接口 `/shop/transaction-line/page`（`fangguo.ts` fetchTransactionLines，商家端一次只能查一个工厂）。流水 kind 分类（daily-settlement.ts classifyLine）：
  - charge（实扣·入账）：预扣转实扣（材料费，打包发货/一键打包节点）+ 扣费·非订单推送（运费等）
  - prehold（预扣·不入账）：扣费·订单推送 = 推单时的材料费冻结
  - refund（退费·条件入账）：feeType=退费/预扣退费，**仅当该 tid 存在实扣记录才冲抵**（推送即取消的单：预扣未入账→退费也不入账，净 0）
  - exclude（排除）：充值类（运营方在方果充值）
  - unknown（未知类型）：保守跳过不入账，管理员账单可见
- **推单时**：不扣费，仅插入 push_records（fee_applied=false，UNIQUE 幂等防重复计费）
- **定时日结**：每天 00:00（Asia/Shanghai，server.ts node-cron）执行 `runDailySettlement()`：
  1. 同步最近 5 天流水 upsert 进 fangguo_transactions（id 幂等，容忍补录/补跑）
  2. 结算所有账期 ≤ 昨天 的未结算数据：每用户每天 = Σ实扣 + Σ有效退费 + 0.5×当日推单数，写一条 consume 流水（描述前缀「日结 YYYY-MM-DD」），乐观锁扣余额（3 次重试，**允许负余额**）
  3. 幂等三重保障：日结流水描述前缀检查（同用户同日已结则只补标记）+ per-user 锁 + 余额条件更新
  4. 未归属流水（storeName 未匹配 shops）不入账，管理端告警可见；店铺分配后次日自动补账
- **账期归属**：按 transactionTime 的上海自然日（材运费发货滞后出 → 顺延到扣款日账上，不回填推送日）
- **负余额拦截**：balance < 0 时 `blocked=true`，推单接口返回 403，直到管理员补调
- **配额预检**：availableQuota = floor(balance / 0.5) - 今日未结算单数（仅约束 0.5 服务费；材运费按日结事后扣，存在单日敞口，靠负余额拦截兜底）

## 方果平台对接（实时透传架构）

**架构**：运营方统一方果账号（API KEY 存 `system_configs` 表 key=`fangguo_api_key`，仅管理员可配）。订单不落库，用户查询时实时拉取并按店铺过滤展示；用户推单时系统代理调方果 API，工厂由方果按订单自动路由（订单自带 factoryId，只读展示）。

**核心模块**：
- `src/lib/fangguo.ts` - 方果 API 客户端（Bearer 认证，`{code,data,msg}` 协议，code=0 成功）
- `src/lib/fangguo-live.ts` - 实时订单透传：
  - `fetchLiveOrders(days)`：tidList 分页拉取（pageSize 100，上限 500 单）→ detail 并发拉取（批次 8，Promise.allSettled 容错）→ 按 pay_time 倒序
  - 60 秒全局缓存（globalThis.__fgLiveCache，多用户共享，缓存 key=days:startOfToday）
  - `filterByShops(orders, shopNames)`：按 shops 表店铺名精确匹配 store_name
- `src/lib/push-billing.ts` - 推单计费模块（getPushBillingStats 配额 / recordPushes 幂等记录 / getUserShopNames）
- `src/lib/daily-settlement.ts` - 日结核心（syncTransactionLines 流水同步5天窗口 / settleDueDays 定时结算 / classifyLine 流水分类 / runDailySettlement 入口，与手动触发共用全局锁）

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
