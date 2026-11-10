# 果推 - 智能订单推单系统 AGENTS.md

## 项目概览

一套类似方果 ERP 的多用户订单推单系统，支持多平台（Temu/Shein/速卖通等）订单统一管理、智能解码、一键推单到工厂，**按单计费独立余额**。

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
│   │   │   ├── balance/        # 余额查询 GET
│   │   │   ├── wallet/
│   │   │   │   ├── recharge/         # 充值 POST
│   │   │   │   └── transactions/     # 流水列表 GET
│   │   │   ├── orders/         # 订单相关
│   │   │   │   ├── route.ts            # 列表 GET / 创建 POST
│   │   │   │   ├── [id]/
│   │   │   │   │   ├── decode/route.ts # 单条解码 POST
│   │   │   │   │   └── push/route.ts   # 单条推单 POST
│   │   │   │   ├── batch-decode/route.ts # 批量解码 POST
│   │   │   │   └── batch-push/route.ts   # 批量推单 POST
│   │   │   ├── admin/           # 后台管理（需管理员权限）
│   │   │   │   ├── check/route.ts          # 检查管理员权限 GET
│   │   │   │   ├── users/route.ts          # 用户列表 GET / 创建用户 POST
│   │   │   │   ├── adjust-balance/route.ts # 调整用户余额 POST
│   │   │   │   ├── transactions/route.ts   # 全局流水 GET
│   │   │   │   └── fangguo/                # 方果平台对接（KEY配置/店铺分配/手动同步）
│   │   │   ├── demo/seed/       # 生成模拟演示数据 POST
│   │   │   └── supabase-config/ # Supabase 配置注入
│   │   ├── login/               # 登录页（无注册，账号由管理员创建）
│   │   ├── admin/               # 后台管理页（用户管理/流水/平台对接）
│   │   ├── wallet/              # 钱包页
│   │   ├── products/            # 商品管理页
│   │   ├── page.tsx             # 首页（订单管理）
│   │   └── layout.tsx           # 根布局
│   ├── components/
│   │   ├── ui/                  # shadcn/ui 组件库
│   │   ├── app-layout.tsx       # 应用侧边栏布局（余额随 balance-updated 事件刷新）
│   │   └── auth-provider-wrapper.tsx  # AuthProvider 客户端包装
│   ├── lib/
│   │   ├── auth-provider.tsx    # 认证上下文（登录态/用户信息）
│   │   ├── auth-utils.ts        # 服务端认证工具函数
│   │   ├── api-request.ts       # 前端 API 请求封装（自动带 x-session）
│   │   ├── fangguo.ts           # 方果 API 客户端（店铺/订单/推单/状态映射）
│   │   ├── fangguo-sync.ts      # 方果订单同步服务（游标+店铺分配）
│   │   ├── billing.ts           # 推单扣费（乐观锁）
│   │   ├── supabase-browser.ts  # 浏览器端 Supabase 客户端
│   │   ├── supabase-config-inject.tsx  # Supabase 配置注入组件
│   │   └── utils.ts             # 通用工具（cn 等）
│   ├── server.ts                # 自定义启动（next + 方果自动同步调度器）
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
| `wallet_transactions` | 钱包流水 | user_id, type(recharge/consume/refund), amount, description, order_id |
| `shops` | 用户店铺（方果店铺分配） | user_id, platform, shop_name, fangguo_shop_id, platform_code, brand_name, status |
| `products` | 商品库 | user_id, platform_product_id, product_name, merchant_code, spec |
| `orders` | 订单表（order_no 唯一索引） | user_id, order_no, platform, status, decode_status, merchant_code, price, receiver_*, logistics_*, sys_tid, df_status, store_name, factory_id, last_sync_at, deliver_time |
| `system_configs` | 系统配置（无RLS，仅service role） | key(fangguo_api_key/fangguo_last_sync_time), value |

### 订单状态枚举 (status)
- `pending` - 待整理
- `decoding` - 解码中  
- `decoded` - 已解码（待推送）
- `pushed` - 已推送
- `production` - 生产中
- `shipped` - 已发货
- `refund` - 退款中
- `closed` - 已关闭

### 解码状态 (decode_status)
- `pending` - 待解码
- `decoding` - 解码中
- `success` - 解码成功
- `fail` - 解码失败

### 计费规则（在 push 接口中扣费）
- 推单扣费：0.50 元/单（`src/lib/billing.ts` chargeUser，乐观锁扣费）
- 解码不扣费（方果侧已完成解码，订单 shopMappingSku 即商户编码）

## 方果平台对接（方案B：平台统一账号）

**架构**：运营方统一方果账号（API KEY 存 `system_configs` 表 key=`fangguo_api_key`，仅管理员可配），订单由系统从方果同步并按店铺分配给用户；用户推单时系统代理调方果 API，工厂由方果按订单自动路由（订单自带 factoryId，只读展示）。

**核心模块**：
- `src/lib/fangguo.ts` - 方果 API 客户端（Bearer 认证，`{code,data,msg}` 协议，code=0 成功）
- `src/lib/fangguo-sync.ts` - 订单同步服务（tidList 时间窗拉取 → 逐单 detail → 按 storeName 匹配 shops 表分配 → 落库；游标存 `system_configs.fangguo_last_sync_time`）
- `src/lib/billing.ts` - 扣费模块（PUSH_FEE=0.5，乐观锁 3 次重试）
- `src/server.ts` - 自动同步调度器（10 分钟间隔，globalThis 防重，KEY 未配置自动跳过）

**方果状态映射**（dfStatus: 0待整理 1待推送 2已反审 3工厂待审 4生产中 5已打包；deliverTime 有值→shipped）：
- 0/2 → status=pending；1 → decoded；3 → pushed；4/5 → production
- 推单校验：仅 df_status=1 可推，推送成功后置 df_status=3 并扣费

**平台码**：25=Temu全托管，125/225/325/525=Temu半托管分区 → `temu`；其他按 platformDesc 文本匹配

**同步分配规则**：订单 detail 仅含 storeName（无 shopId），按 shops 表 shop_name 精确匹配；未匹配则计入 unassigned（管理员在后台「平台对接」Tab 分配店铺后下次同步生效）

## 鉴权方式

**前后端统一使用 `x-session` header**

- 前端：`api-request.ts` 中自动从 `useAuth()` 获取 session 并注入 header
- 后端：各 API route 通过 `getCurrentUser(token)` 验证 token
- RLS：所有业务表启用行级安全，用户只能访问自己的数据

## API 接口清单

| 方法 | 路径 | 功能 | 鉴权 |
|------|------|------|------|
| GET | /api/balance | 查询余额 | 是 |
| GET | /api/wallet/transactions | 钱包流水列表 | 是 |
| POST | /api/wallet/recharge | 模拟充值 | 是 |
| GET | /api/orders | 订单列表（支持 status/page/pageSize 过滤） | 是 |
| POST | /api/orders | 创建订单 | 是 |
| POST | /api/orders/[id]/decode | 单条订单解码 | 是 |
| POST | /api/orders/[id]/push | 单条订单推单（扣费） | 是 |
| POST | /api/orders/batch-decode | 批量解码 | 是 |
| POST | /api/orders/batch-push | 批量推单（扣费） | 是 |
| POST | /api/demo/seed | 生成模拟演示数据（赠体验金） | 是 |
| GET | /api/admin/check | 检查是否管理员 | 是 |
| GET | /api/admin/users | 用户列表（含余额） | 管理员 |
| POST | /api/admin/users | 创建用户（邮箱/密码/初始余额） | 管理员 |
| POST | /api/admin/adjust-balance | 调整用户余额（正充负扣） | 管理员 |
| GET | /api/admin/transactions | 全局流水记录 | 管理员 |
| GET | /api/admin/fangguo/config | 方果 API KEY 配置（脱敏） | 管理员 |
| POST | /api/admin/fangguo/config | 保存/验证方果 API KEY | 管理员 |
| GET | /api/admin/fangguo/shops | 方果店铺列表（含分配状态） | 管理员 |
| POST | /api/admin/fangguo/assign | 店铺分配/取消分配 | 管理员 |
| POST | /api/admin/fangguo/sync | 手动触发订单同步（days 1-7） | 管理员 |
| GET | /api/supabase-config | 获取 Supabase 配置 | 否 |

## 账号体系

- **无自助注册**：登录页仅支持登录，新用户由管理员在 `/admin` 后台创建
- **管理员标记**：`user_balances.is_admin = true`（通过 SQL 设置）
- **创建用户**：管理员在后台填写邮箱/密码/初始余额，`email_confirm=true` 创建后立即可登录
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
3. **计费原子性**：推单扣费使用事务（先扣后写订单状态），失败自动回滚
4. **x-session 约定**：前后端鉴权 header key 固定为 `x-session`，value 为 supabase access_token
5. **分页格式**：列表接口统一返回 `{ list, total, page, pageSize, ...extra }` 格式
