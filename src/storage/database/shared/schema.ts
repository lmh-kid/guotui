import {
  pgTable,
  serial,
  text,
  varchar,
  timestamp,
  boolean,
  integer,
  numeric,
  jsonb,
  index,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// 系统健康检查表 - 保留
export const healthCheck = pgTable("health_check", {
  id: serial().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).defaultNow(),
});

// 系统配置表（存方果 API KEY 等，仅管理员服务端读写，不开放 RLS）
export const systemConfigs = pgTable("system_configs", {
  key: varchar("key", { length: 64 }).primaryKey(),
  value: text("value"),
  remark: varchar("remark", { length: 255 }),
  updated_at: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

// 用户余额表
export const userBalances = pgTable(
  "user_balances",
  {
    id: varchar("id", { length: 36 })
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    user_id: uuid("user_id").notNull().unique(),
    balance: numeric("balance", { precision: 12, scale: 2 })
      .notNull()
      .default("0.00"),
    frozen_balance: numeric("frozen_balance", { precision: 12, scale: 2 })
      .notNull()
      .default("0.00"),
    total_recharge: numeric("total_recharge", { precision: 12, scale: 2 })
      .notNull()
      .default("0.00"),
    total_consume: numeric("total_consume", { precision: 12, scale: 2 })
      .notNull()
      .default("0.00"),
    created_at: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [index("user_balances_user_id_idx").on(table.user_id)]
);

// 钱包流水记录表
export const walletTransactions = pgTable(
  "wallet_transactions",
  {
    id: varchar("id", { length: 36 })
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    user_id: uuid("user_id").notNull(),
    type: varchar("type", { length: 20 }).notNull(), // recharge:充值 consume:消费 refund:退款
    amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
    balance_after: numeric("balance_after", { precision: 12, scale: 2 }).notNull(),
    order_id: varchar("order_id", { length: 64 }), // 关联订单号
    description: varchar("description", { length: 255 }),
    created_at: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("wallet_transactions_user_id_idx").on(table.user_id),
    index("wallet_transactions_type_idx").on(table.type),
    index("wallet_transactions_created_at_idx").on(table.created_at),
  ]
);

// 店铺表
export const shops = pgTable(
  "shops",
  {
    id: varchar("id", { length: 36 })
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    user_id: uuid("user_id").notNull(),
    platform: varchar("platform", { length: 32 }).notNull(), // temu, shein, aliexpress等
    shop_name: varchar("shop_name", { length: 128 }).notNull(),
    shop_id: varchar("shop_id", { length: 64 }),
    fangguo_shop_id: varchar("fangguo_shop_id", { length: 64 }), // 方果店铺ID
    platform_code: integer("platform_code"), // 方果平台枚举编码
    brand_name: varchar("brand_name", { length: 64 }), // 平台名称（Temu全托管等）
    status: varchar("status", { length: 20 }).notNull().default("active"),
    auth_data: jsonb("auth_data"),
    created_at: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("shops_user_id_idx").on(table.user_id),
    index("shops_platform_idx").on(table.platform),
  ]
);

// 商品编码表
export const products = pgTable(
  "products",
  {
    id: varchar("id", { length: 36 })
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    user_id: uuid("user_id").notNull(),
    shop_id: varchar("shop_id", { length: 36 }).references(() => shops.id),
    spu_id: varchar("spu_id", { length: 64 }),
    sku_id: varchar("sku_id", { length: 64 }),
    product_name: varchar("product_name", { length: 255 }).notNull(),
    merchant_code: varchar("merchant_code", { length: 128 }), // 商家编码
    category: varchar("category", { length: 64 }),
    image_url: varchar("image_url", { length: 512 }),
    spec_data: jsonb("spec_data"),
    created_at: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("products_user_id_idx").on(table.user_id),
    index("products_shop_id_idx").on(table.shop_id),
    index("products_merchant_code_idx").on(table.merchant_code),
  ]
);

// 推单记录表（订单不落库架构下唯一的推单凭据，日结算账依据）
// UNIQUE(user_id, order_no) 保证同一订单不重复计费
export const pushRecords = pgTable(
  "push_records",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    user_id: uuid("user_id").notNull(),
    order_no: varchar("order_no", { length: 64 }).notNull(), // 方果平台订单号 tid
    push_date: varchar("push_date", { length: 10 }).notNull(), // 推单日期 YYYY-MM-DD（本地时区）
    fee_applied: boolean("fee_applied").notNull().default(false), // 是否已日结算扣费
    settled_at: timestamp("settled_at", { withTimezone: true }),
    created_at: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("push_records_user_date_idx").on(
      table.user_id,
      table.push_date,
      table.fee_applied
    ),
  ]
);

// 订单表（历史遗留：新架构订单不落库、实时透传方果 API，本表已停用，仅保留历史数据）
export const orders = pgTable(
  "orders",
  {
    id: varchar("id", { length: 36 })
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    user_id: uuid("user_id").notNull(),
    shop_id: varchar("shop_id", { length: 36 }).references(() => shops.id),
    platform: varchar("platform", { length: 32 }).notNull(),
    order_no: varchar("order_no", { length: 64 }).notNull(),
    sys_tid: varchar("sys_tid", { length: 64 }), // 方果系统单号
    df_status: integer("df_status"), // 方果原始状态码 0待整理 1待推送 2已反审 3工厂待审 4生产中 5已打包
    store_name: varchar("store_name", { length: 128 }), // 店铺名
    factory_id: varchar("factory_id", { length: 64 }), // 工厂ID
    last_sync_at: timestamp("last_sync_at", { withTimezone: true }), // 最后同步时间
    order_type: varchar("order_type", { length: 32 }), // Y2订单, 正常订单
    status: varchar("status", { length: 32 }).notNull().default("pending"), // 待整理, 待推送, 已反审, 生产中, 已发货等
    decode_status: varchar("decode_status", { length: 20 }).default("pending"), // 解码状态: pending解码中, success成功, fail失败
    product_name: varchar("product_name", { length: 255 }),
    product_image: varchar("product_image", { length: 512 }),
    spec: varchar("spec", { length: 255 }), // 规格描述
    merchant_code: varchar("merchant_code", { length: 128 }), // 商家编码
    quantity: integer("quantity").notNull().default(1),
    price: numeric("price", { precision: 12, scale: 2 }).default("0.00"),
    receiver_name: varchar("receiver_name", { length: 64 }),
    receiver_phone: varchar("receiver_phone", { length: 32 }),
    receiver_address: text("receiver_address"),
    receiver_country: varchar("receiver_country", { length: 64 }),
    tracking_no: varchar("tracking_no", { length: 64 }), // 运单号
    logistics_company: varchar("logistics_company", { length: 64 }),
    pay_time: timestamp("pay_time", { withTimezone: true }),
    deliver_time: timestamp("deliver_time", { withTimezone: true }), // 发货时间
    delivery_deadline: timestamp("delivery_deadline", { withTimezone: true }),
    remark: text("remark"),
    order_data: jsonb("order_data"), // 原始订单数据
    created_at: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("orders_user_id_idx").on(table.user_id),
    index("orders_shop_id_idx").on(table.shop_id),
    index("orders_status_idx").on(table.status),
    index("orders_order_no_idx").on(table.order_no),
    index("orders_created_at_idx").on(table.created_at),
    index("orders_decode_status_idx").on(table.decode_status),
    index("orders_sys_tid_idx").on(table.sys_tid),
  ]
);
