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
│   │   │   ├── demo/seed/       # 生成模拟演示数据 POST
│   │   │   └── supabase-config/ # Supabase 配置注入
│   │   ├── login/               # 登录/注册页
│   │   ├── wallet/              # 钱包页
│   │   ├── products/            # 商品管理页
│   │   ├── page.tsx             # 首页（订单管理）
│   │   └── layout.tsx           # 根布局
│   ├── components/
│   │   ├── ui/                  # shadcn/ui 组件库
│   │   ├── app-layout.tsx       # 应用侧边栏布局
│   │   └── auth-provider-wrapper.tsx  # AuthProvider 客户端包装
│   ├── lib/
│   │   ├── auth-provider.tsx    # 认证上下文（登录态/用户信息）
│   │   ├── auth-utils.ts        # 服务端认证工具函数
│   │   ├── api-request.ts       # 前端 API 请求封装（自动带 x-session）
│   │   ├── supabase-browser.ts  # 浏览器端 Supabase 客户端
│   │   ├── supabase-config-inject.tsx  # Supabase 配置注入组件
│   │   └── utils.ts             # 通用工具（cn 等）
│   └── storage/database/
│       ├── supabase-client.ts   # 服务端 Supabase 客户端
│       └── shared/schema.ts     # Drizzle Schema 定义
├── DESIGN.md                    # 设计规范
├── package.json
└── tsconfig.json
```

## 核心数据模型（Supabase Tables）

| 表名 | 说明 | 关键字段 |
|------|------|----------|
| `user_balances` | 用户余额（RLS隔离） | user_id, balance, frozen_balance, total_recharge, total_consume |
| `wallet_transactions` | 钱包流水 | user_id, type(recharge/consume/refund), amount, description, order_id |
| `shops` | 用户店铺 | user_id, platform, shop_name, shop_url, status |
| `products` | 商品库 | user_id, platform_product_id, product_name, merchant_code, spec |
| `orders` | 订单表 | user_id, order_no, platform, status, decode_status, merchant_code, price, receiver_*, logistics_* |

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

### 计费规则（在 push/decode 接口中扣费）
- 推单扣费：0.50 元/单
- 解码扣费：0.10 元/单（当前未启用自动扣费，仅推单扣费）

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
| GET | /api/supabase-config | 获取 Supabase 配置 | 否 |

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
