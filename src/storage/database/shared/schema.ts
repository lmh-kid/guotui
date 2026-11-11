import { pgTable, serial, timestamp, index, pgPolicy, varchar, uuid, numeric, text, jsonb, integer, unique, boolean, date } from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"

function gen_random_uuid(): string {
  return sql`gen_random_uuid()` as unknown as string;
}



export const healthCheck = pgTable("health_check", {
	id: serial().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow(),
});

export const walletTransactions = pgTable("wallet_transactions", {
	id: varchar({ length: 36 }).default(gen_random_uuid()).primaryKey().notNull(),
	userId: uuid("user_id").notNull(),
	type: varchar({ length: 20 }).notNull(),
	amount: numeric({ precision: 12, scale:  2 }).notNull(),
	balanceAfter: numeric("balance_after", { precision: 12, scale:  2 }).notNull(),
	orderId: varchar("order_id", { length: 64 }),
	description: varchar({ length: 255 }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("wallet_transactions_created_at_idx").using("btree", table.createdAt.asc().nullsLast().op("timestamptz_ops")),
	index("wallet_transactions_type_idx").using("btree", table.type.asc().nullsLast().op("text_ops")),
	index("wallet_transactions_user_id_idx").using("btree", table.userId.asc().nullsLast().op("uuid_ops")),
	pgPolicy("wallet_transactions_用户删除自己的数据", { as: "permissive", for: "delete", to: ["public"], using: sql`(( SELECT auth.uid() AS uid) = user_id)` }),
	pgPolicy("wallet_transactions_用户插入自己的数据", { as: "permissive", for: "insert", to: ["public"] }),
	pgPolicy("wallet_transactions_用户更新自己的数据", { as: "permissive", for: "update", to: ["public"] }),
	pgPolicy("wallet_transactions_用户读取自己的数据", { as: "permissive", for: "select", to: ["public"] }),
]);

export const systemConfigs = pgTable("system_configs", {
	key: varchar({ length: 64 }).primaryKey().notNull(),
	value: text(),
	remark: varchar({ length: 255 }),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
});

export const shops = pgTable("shops", {
	id: varchar({ length: 36 }).default(gen_random_uuid()).primaryKey().notNull(),
	userId: uuid("user_id").notNull(),
	platform: varchar({ length: 32 }).notNull(),
	shopName: varchar("shop_name", { length: 128 }).notNull(),
	shopId: varchar("shop_id", { length: 64 }),
	status: varchar({ length: 20 }).default('active').notNull(),
	authData: jsonb("auth_data"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	fangguoShopId: varchar("fangguo_shop_id", { length: 64 }),
	platformCode: integer("platform_code"),
	brandName: varchar("brand_name", { length: 64 }),
}, (table) => [
	index("shops_fangguo_shop_id_idx").using("btree", table.fangguoShopId.asc().nullsLast().op("text_ops")),
	index("shops_platform_idx").using("btree", table.platform.asc().nullsLast().op("text_ops")),
	index("shops_user_id_idx").using("btree", table.userId.asc().nullsLast().op("uuid_ops")),
	pgPolicy("shops_用户删除自己的数据", { as: "permissive", for: "delete", to: ["public"], using: sql`(( SELECT auth.uid() AS uid) = user_id)` }),
	pgPolicy("shops_用户插入自己的数据", { as: "permissive", for: "insert", to: ["public"] }),
	pgPolicy("shops_用户更新自己的数据", { as: "permissive", for: "update", to: ["public"] }),
	pgPolicy("shops_用户读取自己的数据", { as: "permissive", for: "select", to: ["public"] }),
]);

export const userBalances = pgTable("user_balances", {
	id: varchar({ length: 36 }).default(gen_random_uuid()).primaryKey().notNull(),
	userId: uuid("user_id").notNull(),
	balance: numeric({ precision: 12, scale:  2 }).default('0.00').notNull(),
	frozenBalance: numeric("frozen_balance", { precision: 12, scale:  2 }).default('0.00').notNull(),
	totalRecharge: numeric("total_recharge", { precision: 12, scale:  2 }).default('0.00').notNull(),
	totalConsume: numeric("total_consume", { precision: 12, scale:  2 }).default('0.00').notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	isAdmin: boolean("is_admin").default(false).notNull(),
}, (table) => [
	index("user_balances_user_id_idx").using("btree", table.userId.asc().nullsLast().op("uuid_ops")),
	unique("user_balances_user_id_unique").on(table.userId),
	pgPolicy("user_balances_用户删除自己的数据", { as: "permissive", for: "delete", to: ["public"], using: sql`(( SELECT auth.uid() AS uid) = user_id)` }),
	pgPolicy("user_balances_用户插入自己的数据", { as: "permissive", for: "insert", to: ["public"] }),
	pgPolicy("user_balances_用户更新自己的数据", { as: "permissive", for: "update", to: ["public"] }),
	pgPolicy("user_balances_用户读取自己的数据", { as: "permissive", for: "select", to: ["public"] }),
]);

export const pushRecords = pgTable("push_records", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	userId: text("user_id").notNull(),
	orderNo: text("order_no").notNull(),
	pushDate: date("push_date").notNull(),
	feeApplied: boolean("fee_applied").default(false).notNull(),
	settledAt: timestamp("settled_at", { withTimezone: true, mode: 'string' }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("push_records_user_date_idx").using("btree", table.userId.asc().nullsLast().op("text_ops"), table.pushDate.asc().nullsLast().op("date_ops"), table.feeApplied.asc().nullsLast().op("text_ops")),
	unique("push_records_user_id_order_no_key").on(table.userId, table.orderNo),
]);

export const authAccounts = pgTable("auth_accounts", {
	userId: uuid("user_id").primaryKey().notNull(),
	account: varchar({ length: 64 }).notNull(),
	passwordHash: text("password_hash").notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("auth_accounts_account_idx").using("btree", table.account.asc().nullsLast().op("text_ops")),
	unique("auth_accounts_account_key").on(table.account),
]);

export const authSessions = pgTable("auth_sessions", {
	token: varchar({ length: 64 }).primaryKey().notNull(),
	userId: uuid("user_id").notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	lastUsedAt: timestamp("last_used_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	expiresAt: timestamp("expires_at", { withTimezone: true, mode: 'string' }).notNull(),
}, (table) => [
	index("auth_sessions_user_id_idx").using("btree", table.userId.asc().nullsLast().op("uuid_ops")),
]);
