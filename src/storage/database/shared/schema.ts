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

export const fangguoTransactions = pgTable("fangguo_transactions", {
	id: varchar("id", { length: 32 }).primaryKey(),
	userId: varchar("user_id", { length: 255 }),
	tid: varchar("tid", { length: 64 }),
	feeType: varchar("fee_type", { length: 32 }).notNull(),
	feeNameType: varchar("fee_name_type", { length: 32 }).notNull(),
	businessNode: varchar("business_node", { length: 64 }).notNull(),
	kind: varchar("kind", { length: 16 }).notNull(),
	unitPrice: numeric("unit_price", { precision: 12, scale: 4 }),
	quantity: integer("quantity"),
	processedAmount: numeric("processed_amount", { precision: 12, scale: 4 }).notNull(),
	storeName: varchar("store_name", { length: 128 }),
	pushTime: timestamp("push_time", { withTimezone: true, mode: 'string' }),
	transactionTime: timestamp("transaction_time", { withTimezone: true, mode: 'string' }).notNull(),
	settleDate: date("settle_date", { mode: 'string' }).notNull(),
	settled: boolean("settled").default(false).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("fangguo_transactions_tid_idx").using("btree", table.tid.asc().nullsLast().op("text_ops")),
	index("fangguo_transactions_user_settle_idx").using("btree", table.userId.asc().nullsLast().op("text_ops"), table.settleDate.asc().nullsLast().op("date_ops")),
	index("fangguo_transactions_settled_date_idx").using("btree", table.settled.asc().nullsLast().op("bool_ops"), table.settleDate.asc().nullsLast().op("date_ops")),
]);

export const userImages = pgTable("user_images", {
	id: uuid().primaryKey().default(gen_random_uuid()).notNull(),
	userId: uuid("user_id").notNull(),
	account: varchar({ length: 64 }),
	fileName: varchar("file_name", { length: 255 }).notNull(),
	category: varchar({ length: 64 }).default('').notNull(),
	remoteDir: varchar("remote_dir", { length: 512 }).notNull(),
	remotePath: varchar("remote_path", { length: 768 }).notNull(),
	size: numeric("size", { precision: 20, scale: 0 }).default('0').notNull(),
	mime: varchar({ length: 128 }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("user_images_user_created_idx").using("btree", table.userId.asc().nullsLast().op("uuid_ops"), table.createdAt.desc().nullsFirst()),
	unique("user_images_remote_path_key").on(table.remotePath),
]);
