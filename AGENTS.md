# 果推 - 智能订单推单系统 AGENTS.md

## 项目概览

一套类似方果 ERP 的多用户订单推单系统，支持多平台（Temu/Shein/速卖通等）订单统一管理、一键推单到工厂，**按单计费（日结）独立余额**。

### 核心架构原则（重要）
- **订单不落库**：订单数据在用户查询时实时从方果 API 拉取（透传），本地不存任何订单信息
- **本地仅持久化**：用户信息（user_balances）、钱包流水（wallet_transactions）、推单计费记录（push_records）、店铺分配（shops）、系统配置（system_configs）
- **计费模式：日结**：推单成功时仅记录 push_records（fee_applied=false），次日用户任意请求触发惰性结算，汇总扣费（乐观锁，允许负余额），负余额用户次日禁止推单
- **订单查询窗口**：仅支持近 1/3/7 天（方果 tidList 接口限制）

### 版本技术栈
- **Framework**: Next.js 16 (App Router)
- **Core**: React 19
- **Language**: TypeScript 5
- **UI 组件**: shadcn/ui (基于 Radix UI)
- **Styling**: Tailwind CSS 4
- **数据库**: Supabase (PostgreSQL)
- **认证**: Supabase Auth (邮箱登录)

## 目录结构

```
├── public/                     # 静态资源
├── src/
│   ├── app/
│   │   ├── api/                # 后端 API 路由
│   │   │   ├── balance/        # 余额查询 GET（触发惰性日结算）
│   │   │   ├── wallet/
│   │   │   │   ├── recharge/         # 充值 POST
│   │   │   │   └── transactions/     # 流水列表 GET
│   │   │   ├── orders/         # 订单相关（实时透传）
│   │   │   │   ├── route.ts            # 列表 GET（实时拉方果+店铺过滤+内存分页）
│   │   │   │   ├── [id]/
│   │   │   │   │   └── push/route.ts   # 单条推单 POST（id=方果tid）
│   │   │   │   └── batch-push/route.ts # 批量推单 POST
│   │   │   ├── admin/           # 后台管理（需管理员权限）
│   │   │   │   ├── check/route.ts          # 检查管理员权限 GET
│   │   │   │   ├── users/route.ts          # 用户列表 GET / 创建用户 POST / 删除用户 DELETE
│   │   │   │   ├── adjust-balance/route.ts # 调整用户余额 POST（入参 userId）
│   │   │   │   ├── transactions/route.ts   # 全局流水 GET
│   │   │   │   ├── push-records/route.ts   # 推单日账单聚合 GET（用户×日期）
│   │   │   │   └── fangguo/                # 方果平台对接（KEY配置/店铺分配）
│   │   │   └── supabase-config/ # Supabase 配置注入
│   │   ├── login/               # 登录页（无注册，账号由管理员创建）
│   │   ├── admin/               # 后台管理页（用户管理：创建/删除/调余额/调整店铺分配；流水/推单记录/平台对接）
│   │   ├── wallet/              # 钱包页
│   │   ├── page.tsx             # 首页（订单管理：实时透传+计费状态栏）
│   │   └── layout.tsx           # 根布局
│   ├── components/
│   │   ├── ui/                  # shadcn/ui 组件库
│   │   ├── app-layout.tsx       # 应用侧边栏布局（余额随 balance-updated 事件刷新）
│   │   └── auth-provider-wrapper.tsx  # AuthProvider 客户端包装
│   ├── lib/
│   │   ├── auth-provider.tsx    # 认证上下文（登录态/用户信息）
│   │   ├── auth-utils.ts        # 服务端认证工具函数
│   │   ├── api-request.ts       # 前端 API 请求封装（自动带 x-session）
│   │   ├── fangguo.ts           # 方果 API 客户端（店铺/订单详情/推单/状态映射）
│   │   ├── fangguo-live.ts      # 订单实时透传（tidList分页→detail并发8→60s全局缓存→店铺过滤）
│   │   ├── push-billing.ts      # 日结计费（惰性结算settleUser/配额getPushBillingStats/幂等recordPushes）
│   │   ├── billing.ts           # PUSH_FEE=0.5 常量（旧扣费函数已停用）
│   │   ├── supabase-browser.ts  # 浏览器端 Supabase 客户端
│   │   ├── supabase-config-inject.tsx  # Supabase 配置注入组件
│   │   └── utils.ts             # 通用工具（cn 等）
│   ├── server.ts                # 自定义启动（next 仅启动服务，无定时同步）
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
| `user_balances` | 用户余额（RLS隔离） | user_id, balance, frozen_balance, total_recharge, total_consume, is_admin |
| `wallet_transactions` | 钱包流水 | user_id, type(recharge/consume/refund), amount, description, balance_after |
| `push_records` | 推单计费记录（日结依据） | user_id, order_no, push_date, fee_applied, settled_at；UNIQUE(user_id, order_no) |
| `shops` | 用户店铺（方果店铺分配） | user_id, platform, shop_name, fangguo_shop_id, platform_code, brand_name, status |
| `system_configs` | 系统配置（无RLS，仅service role） | key(fangguo_api_key), value |
| `orders` | **已废弃**（历史遗留，新架构订单不落库） | - |
| `products` | **已废弃**（商品页已删除） | - |

### 订单状态枚举（status，实时计算不落库）
- `pending` - 待整理（dfStatus 0/2）
- `decoded` - 待推送（dfStatus 1，**唯一可推送状态**）
- `pushed` - 已推送（dfStatus 3）
- `production` - 生产中（dfStatus 4/5）
- `shipped` - 已发货（deliverTime 有值）

### 计费规则（日结模式）
- 单价：0.50 元/单（`src/lib/billing.ts` PUSH_FEE）
- **推单时**：不立即扣费，仅插入 push_records（fee_applied=false，UNIQUE 幂等防重复计费）
- **次日惰性结算**：用户任意请求（orders/balance 等）触发 `settleUser`，按日期汇总昨日及更早的未结算记录，乐观锁扣余额（3次重试，**允许负余额**），每天写一条 consume 流水（描述含日期/单数/单价）
- **负余额拦截**：balance < 0 时 `blocked=true`，推单接口返回 403，直到管理员补调
- **配额预检**：availableQuota = floor(balance / 0.5) - 今日未结算单数，推单前校验

## 方果平台对接（实时透传架构）

**架构**：运营方统一方果账号（API KEY 存 `system_configs` 表 key=`fangguo_api_key`，仅管理员可配）。订单不落库，用户查询时实时拉取并按店铺过滤展示；用户推单时系统代理调方果 API，工厂由方果按订单自动路由（订单自带 factoryId，只读展示）。

**核心模块**：
- `src/lib/fangguo.ts` - 方果 API 客户端（Bearer 认证，`{code,data,msg}` 协议，code=0 成功）
- `src/lib/fangguo-live.ts` - 实时订单透传：
  - `fetchLiveOrders(days)`：tidList 分页拉取（pageSize 100，上限 500 单）→ detail 并发拉取（批次 8，Promise.allSettled 容错）→ 按 pay_time 倒序
  - 60 秒全局缓存（globalThis.__fgLiveCache，多用户共享，缓存 key=days:startOfToday）
  - `filterByShops(orders, shopNames)`：按 shops 表店铺名精确匹配 store_name
- `src/lib/push-billing.ts` - 日结计费模块（settleUser / getPushBillingStats / recordPushes）

**方果状态映射**（dfStatus: 0待整理 1待推送 2已反审 3工厂待审 4生产中 5已打包；deliverTime 有值→shipped）：
- 0/2 → status=pending；1 → decoded；3 → pushed；4/5 → production
- 推单校验：仅 df_status=1 可推，推送成功后置 df_status=3 并记录 push_records

**平台码**：25=Temu全托管，125/225/325/525=Temu半托管分区 → `temu`；其他按 platformDesc 文本匹配

**店铺过滤规则**：detail 仅含 storeName（无 shopId），按 shops 表 shop_name 精确匹配；用户无店铺时返回 noShop=true（前端提示联系管理员分配）

**已移除**：定时同步调度器（fangguo-sync.ts）、订单落库、解码（batch-decode/[id]/decode）、商品管理、模拟数据（demo/seed）

## 鉴权方式

**前后端统一使用 `x-session` header**

- 前端：`api-request.ts` 中自动从 `useAuth()` 获取 session 并注入 header
- 后端：各 API route 通过 `getCurrentUser(token)` 验证 token
- RLS：业务表启用行级安全，用户只能访问自己的数据

## API 接口清单

| 方法 | 路径 | 功能 | 鉴权 |
|------|------|------|------|
| GET | /api/balance | 查询余额（触发惰性日结算） | 是 |
| GET | /api/wallet/transactions | 钱包流水列表 | 是 |
| POST | /api/wallet/recharge | 模拟充值 | 是 |
| GET | /api/orders | 订单列表（实时透传；参数 page/pageSize/status/keyword/days=1\|3\|7） | 是 |
| POST | /api/orders/[id]/push | 单条推单（id=方果tid；校验归属/df状态/配额） | 是 |
| POST | /api/orders/batch-push | 批量推单（body: {order_nos: string[]}） | 是 |
| GET | /api/admin/check | 检查是否管理员 | 是 |
| GET | /api/admin/users | 用户列表（含余额） | 管理员 |
| POST | /api/admin/users | 创建用户（账号/密码/初始余额） | 管理员 |
| DELETE | /api/admin/users | 删除用户（body: {userId}；防护自身与管理员；级联清理 shops/wallet_transactions/push_records/user_balances + auth 账号，任一清理失败即中止返回500） | 管理员 |
| POST | /api/admin/adjust-balance | 调整用户余额（body: {userId, amount, description}，正充负扣） | 管理员 |
| GET | /api/admin/transactions | 全局流水记录 | 管理员 |
| GET | /api/admin/push-records | 推单日账单（days 1-31，用户×日期聚合+汇总） | 管理员 |
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

## 账号体系（账号名登录，非邮箱）

- **账号映射**：用户使用账号名（如 `admin`、`test`）登录，底层 Supabase Auth 走邮箱协议，内部映射为 `账号名@guotui.local`（`src/lib/account.ts`：accountToEmail / displayAccountName / isValidAccountName）
- **登录页**：仅账号+密码输入框；输入含 `@` 时按完整邮箱处理（历史邮箱账号兼容）
- **无自助注册**：新用户由管理员在 `/admin` 后台创建（填账号名，后端自动映射内部邮箱）
- **管理员标记**：`user_balances.is_admin = true`（通过 SQL 设置）
- **创建用户**：`email_confirm=true` 创建后立即可登录；账号名校验：字母开头，仅字母/数字/`._-`，2-32 位
- **展示规则**：`@guotui.local` 域邮箱显示为纯账号名，历史邮箱原样显示
- **预置账号**：`admin`/`admin@123`（管理员）、`test`/`test123`（普通用户，已分配原 seller001 的 3 个店铺，余额 50）
- **管理员 API**：使用 `COZE_SUPABASE_SERVICE_ROLE_KEY` 绕过 RLS，普通用户接口走 RLS 隔离

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
2. **RLS 策略**：所有用户私有数据已启用 RLS，新增表时务必同步配置策略
3. **日结幂等性**：三重保障——fee_applied 标记 + per-user Promise 锁（防并发结算）+ 余额条件更新（乐观锁）
4. **x-session 约定**：前后端鉴权 header key 固定为 `x-session`，value 为 supabase access_token
5. **分页格式**：列表接口统一返回 `{ list, total, page, pageSize, ...extra }` 格式
6. **订单无持久化**：任何订单相关逻辑（状态/筛选/统计）均基于方果 API 实时数据 + 内存计算，重启即失效（缓存仅 60 秒）
7. **测试副作用**：验证过程中产生过小额充值/调账流水属正常测试数据（seller001@example.com 为历史演示账号，店铺已转给 test，密码未知）
