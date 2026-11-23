import { getSupabaseAdminClient } from "@/storage/database/supabase-client";
import { PUSH_FEE } from "@/lib/billing";
import {
  fetchBindFactoryIds,
  fetchTransactionLines,
  type FangguoTransactionLine,
} from "@/lib/fangguo";

/**
 * 日结结算模块（定时任务，每天 00:00 Asia/Shanghai 触发）
 *
 * 费用口径（用户每账期应付 = 材运费 + 推单服务费）:
 * - 材运费 = 材料费（预扣即扣款）+ 运费等实扣流水：
 *   推单时「扣费·订单推送」预扣（prehold）即从方果账户真实扣款，发货时
 *   「预扣转实扣」（charge）只是确认状态（实测 204/206 单条数金额 1:1 相等，
 *   不二次扣款）。按订单 tid 聚合取「预扣总额 vs 实扣总额」绝对值较大者入账——
 *   未发货计预扣（推单当天即扣，无敞口）、已转实扣计实扣，避免双计 / 漏计
 * - 退费冲抵 = 「退费」流水无条件冲抵（预扣已入账，取消推送必须退回，净 0）
 * - 推单服务费 = 0.5 × 当日全部推送订单数（含方果后台直推，按「扣费·订单推送」
 *   预扣流水去重 tid 统计；当天流水未同步时由 push_records 兜底合并）
 * - 账期按 transactionTime 的上海自然日归属（方果账单口径：订单 10 号出、
 *   运费 12 号才出但仍记 10 号账上）
 *
 * 结算模型（日清日结 + 迟到补账）:
 * - 每天 00:00 结算昨日账期：材运费（当时已知部分）+ 0.5×推单数，真实扣余额
 * - 材运费滞后 1-3 天出且记在订单日：后续同步发现已结算账期有新流水时，
 *   重算该账期全量应付，与已扣总额比对，差额写「补扣」（consume）或
 *   「补退」（refund）流水并调整余额——账单始终对齐方果
 * - 封账：同步窗口 7 天，账期 D 的流水最晚 D+7 可拉到；7 天后的迟到流水
 *   丢弃，账单不再变
 * - 充值类流水（运营方在方果充值）排除
 *
 * 幂等: fangguo_transactions.id upsert + 日结流水前缀汇总比对（主结算+补扣/补退）
 *      + per-user 锁 + 余额乐观锁
 */

/** 上海时区日期字符串 YYYY-MM-DD */
export function shanghaiDateStr(ms: number): string {
  return new Date(ms + 8 * 3600_000).toISOString().slice(0, 10);
}

function dateAddDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** 流水分类：charge(实扣)/refund(退费)/prehold(预扣)/exclude(充值)/unknown */
export function classifyLine(line: FangguoTransactionLine): string {
  const feeType = line.feeType ?? "";
  const feeName = line.feeNameType ?? "";
  if (feeType === "充值" || feeType === "RECHARGE" || feeName.includes("充值")) {
    return "exclude";
  }
  if (feeType === "预扣转实扣" || feeType === "PRE_TO_ACTUAL") return "charge";
  if (feeType === "退费" || feeType === "预扣退费" || feeType === "REFUND" || feeType === "PRE_REFUND") {
    return "refund";
  }
  if (feeType === "扣费" || feeType === "ACTUAL_DEDUCTION" || feeType === "PRE_DEDUCTION") {
    // 扣费·订单推送 = 推单时预扣材料费（真实扣款，发货后转实扣确认，不二次扣）；
    // 其余扣费（运费·打包发货等）为实扣
    if (line.businessNode === "订单推送" || line.businessNode === "PUSH_ORDER") {
      return "prehold";
    }
    return "charge";
  }
  return "unknown";
}

export interface SettlementSummary {
  syncedLines: number; // 方果侧拉到的流水数
  newLines: number; // 新入库数
  unassigned: number; // 店铺未匹配用户的流水数（不入账，待管理员分配）
  unknown: number; // 未知类型流水数（保守跳过，不入账）
  settledUsers: number; // 本次结算的用户数
  settledAmount: number; // 本次结算总金额（负=扣费）
  skippedUsers: number; // 幂等跳过数
  errors: string[];
}

/** 全局执行锁（定时任务与手动触发互斥） */
function getRunLock(): { locked: boolean } {
  const g = globalThis as { __settlementRunning?: boolean };
  if (g.__settlementRunning) return { locked: true };
  g.__settlementRunning = true;
  return { locked: false };
}

function releaseRunLock(): void {
  (globalThis as { __settlementRunning?: boolean }).__settlementRunning = false;
}

// ============ 流水同步 ============

const SYNC_WINDOWS_DAYS = 7; // 同步最近 7 天流水（封账线：账期 D 的流水最晚 D+7 当天可拉到，之后丢弃）

/** 同步方果资金流水入库（upsert 幂等，按流水 id） */
export async function syncTransactionLines(): Promise<{
  syncedLines: number;
  newLines: number;
  unassigned: number;
  unknown: number;
  errors: string[];
}> {
  const supabase = await getSupabaseAdminClient();
  const errors: string[] = [];
  const now = Date.now();
  const windowStart = now - SYNC_WINDOWS_DAYS * 86400_000;

  // 工厂列表
  let factoryIds: number[] = [];
  try {
    factoryIds = await fetchBindFactoryIds();
  } catch (e) {
    errors.push(`拉取工厂列表失败: ${e instanceof Error ? e.message : e}`);
  }
  if (factoryIds.length === 0) {
    return { syncedLines: 0, newLines: 0, unassigned: 0, unknown: 0, errors };
  }

  // 店铺名 → 用户映射（全量 active shops）
  const { data: shops } = await supabase
    .from("shops")
    .select("user_id, shop_name")
    .eq("status", "active");
  const shopOwner = new Map<string, string>();
  for (const s of shops ?? []) {
    if (s.shop_name) shopOwner.set(s.shop_name, s.user_id);
  }

  let syncedLines = 0;
  let newLines = 0;
  let unassigned = 0;
  let unknown = 0;

  for (const factoryId of factoryIds) {
    let pageNo = 1;
    for (;;) {
      let page: { list: FangguoTransactionLine[]; total: number };
      try {
        page = await fetchTransactionLines({
          factoryId,
          transactionStartTime: windowStart,
          transactionEndTime: now,
          pageNo,
          pageSize: 100,
        });
      } catch (e) {
        errors.push(`工厂 ${factoryId} 第 ${pageNo} 页拉取失败: ${e instanceof Error ? e.message : e}`);
        break;
      }
      const list = page?.list ?? [];
      if (list.length === 0) break;
      syncedLines += list.length;

      const rows = list.map((line) => {
        const kind = classifyLine(line);
        if (kind === "unknown") unknown += 1;
        const owner = line.storeName ? shopOwner.get(line.storeName) : undefined;
        if (line.storeName && !owner) unassigned += 1;
        return {
          id: String(line.id),
          user_id: owner ?? null,
          tid: line.tid ?? null,
          fee_type: line.feeType,
          fee_name_type: line.feeNameType,
          business_node: line.businessNode,
          kind,
          unit_price: line.unitPrice != null ? String(line.unitPrice) : null,
          quantity: line.quantity ?? null,
          processed_amount: String(line.processedAmount ?? 0),
          store_name: line.storeName ?? null,
          push_time: line.pushTime ? new Date(line.pushTime).toISOString() : null,
          transaction_time: new Date(line.transactionTime).toISOString(),
          settle_date: shanghaiDateStr(line.transactionTime),
        };
      });

      // upsert（非 ignoreDuplicates）：重复 id 会更新传入列，
      // 使「先入库未归属、后分配店铺」的流水在下次同步时自动补填 user_id（补账）；
      // settled 标记不在传入列中，不受覆盖影响
      const { error: upsertErr } = await supabase
        .from("fangguo_transactions")
        .upsert(rows, { onConflict: "id" });
      if (upsertErr) {
        errors.push(`流水入库失败: ${upsertErr.message}`);
      } else {
        newLines += rows.length;
      }

      if (pageNo * 100 >= (page?.total ?? 0)) break;
      pageNo += 1;
    }
  }

  return { syncedLines, newLines, unassigned, unknown, errors };
}

// ============ 日结结算 ============

/**
 * 结算起始日（system_configs key=settlement_start_date，YYYY-MM-DD）
 * settle_date < 起始日的账期不追溯材运费（首次上线保护）；
 * 未配置时不过滤（全部结算）。仅过滤材运费，push_records 服务费照常结算。
 */
export async function getSettlementStartDate(): Promise<string | null> {
  const supabase = await getSupabaseAdminClient();
  const { data } = await supabase
    .from("system_configs")
    .select("value")
    .eq("key", "settlement_start_date")
    .maybeSingle();
  return (data?.value as string) || null;
}

/** 上海本地时间字符串 YYYY-MM-DD HH:mm:ss（与资金明细展示同口径） */
export function shTimeLocal(t?: string | null): string {
  if (!t) return "";
  const d = new Date(t);
  if (Number.isNaN(d.getTime())) return "";
  const s = new Date(d.getTime() + 8 * 3600_000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${s.getUTCFullYear()}-${p(s.getUTCMonth() + 1)}-${p(s.getUTCDate())} ${p(s.getUTCHours())}:${p(s.getUTCMinutes())}:${p(s.getUTCSeconds())}`;
}

const round2 = (x: number) => Math.round(x * 100) / 100;

/** 账本行（资金明细与日结共用同一套口径，保证「明细合计 = 当天扣款」） */
export interface LedgerRow {
  order_no: string;
  date: string; // 归属日（推送日；无预扣时回退最近流水日）
  time: string; // 展示时间：推送时刻（上海本地时间）
  store_name: string | null;
  materialGross: number; // max(预扣材料, 实扣材料)
  materialRefund: number;
  freightGross: number; // 运费等非材料实扣
  freightRefund: number;
  pushFee: number; // 0.5 或 0
}

/**
 * 构建某用户的「订单账本」——资金明细展示与日结扣款共用，杜绝两侧口径漂移
 *
 * 归属规则：
 * - 材料费 = max(预扣总额, 实扣总额)（同一笔钱的两个阶段，不双计），材料退费冲抵
 * - 运费等非材料实扣与其退费跟随该订单，一并记入订单归属日
 * - 归属日 = 该单最早一笔预扣（订单推送）的 settle_date；推送日早于结算起始日
 *   或预扣缺失时回退到最近流水日
 * - 服务费 0.5：仅推送日在结算窗口内的订单计 1 单（不跨日补收）
 * - 结算起始日之前的订单不追账
 */
export async function buildUserLedger(
  userId: string,
  startDate: string | null
): Promise<LedgerRow[]> {
  const supabase = await getSupabaseAdminClient();
  type Line = {
    tid: string | null;
    kind: string;
    fee_name_type: string | null;
    processed_amount: string | number;
    settle_date: string | null;
    transaction_time: string | null;
    store_name: string | null;
  };
  const PAGE = 1000;
  const lines: Line[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("fangguo_transactions")
      .select("tid, kind, fee_name_type, processed_amount, settle_date, transaction_time, store_name")
      .eq("user_id", userId)
      .order("transaction_time", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`读取流水失败: ${error.message}`);
    const batch = (data ?? []) as Line[];
    lines.push(...batch);
    if (batch.length < PAGE) break;
  }

  interface Acc {
    lastTime: string;
    store: string | null;
    preMat: number;
    chargeMat: number;
    refundMat: number;
    freight: number;
    refundFrt: number;
    pushDate: string;
    pushTime: string;
  }
  const accMap = new Map<string, Acc>();
  for (const l of lines) {
    const tid = l.tid ? String(l.tid) : "";
    if (!tid) continue; // 充值等无订单流水不进账本
    const abs = Math.abs(parseFloat(String(l.processed_amount)));
    const isMat = String(l.fee_name_type ?? "").includes("材料");
    const t = shTimeLocal(l.transaction_time);
    const sd = String(l.settle_date ?? "").slice(0, 10);
    let a = accMap.get(tid);
    if (!a) {
      a = {
        lastTime: t, store: l.store_name ?? null,
        preMat: 0, chargeMat: 0, refundMat: 0, freight: 0, refundFrt: 0,
        pushDate: "", pushTime: "",
      };
      accMap.set(tid, a);
    }
    if (!a.store && l.store_name) a.store = l.store_name;
    if (t && (!a.lastTime || t > a.lastTime)) a.lastTime = t;
    if (l.kind === "prehold") {
      if (isMat) a.preMat += abs;
      if (sd && (!a.pushDate || sd < a.pushDate || (sd === a.pushDate && t && (!a.pushTime || t < a.pushTime)))) {
        a.pushDate = sd;
        a.pushTime = t;
      }
    } else if (l.kind === "charge") {
      if (isMat) a.chargeMat += abs;
      else a.freight += abs;
    } else if (l.kind === "refund") {
      if (isMat) a.refundMat += abs;
      else a.refundFrt += abs;
    }
  }

  const rows: LedgerRow[] = [];
  for (const [tid, a] of accMap) {
    const hasPre = !!a.pushDate;
    const usePushDay = hasPre && (!startDate || a.pushDate >= startDate);
    const date = usePushDay ? a.pushDate : a.lastTime.slice(0, 10);
    if (!date) continue;
    if (startDate && date < startDate) continue; // 结算起始日之前不追账
    rows.push({
      order_no: tid,
      date,
      time: usePushDay ? a.pushTime || a.lastTime : a.lastTime,
      store_name: a.store,
      materialGross: round2(Math.max(a.preMat, a.chargeMat)),
      materialRefund: round2(a.refundMat),
      freightGross: round2(a.freight),
      freightRefund: round2(a.refundFrt),
      pushFee: usePushDay || !hasPre ? PUSH_FEE : 0,
    });
  }
  rows.sort((x, y) => (x.time < y.time ? 1 : x.time > y.time ? -1 : 0));
  return rows;
}

interface DaySettleResult {
  user: string;
  date: string;
  amount: number; // 本次实际发生的金额变动（负=补扣/首扣，正=补退）
  skipped: boolean;
}

/** per-user 结算锁（进程内防并发） */
const userLocks = new Map<string, Promise<unknown>>();

async function withUserLock<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  const existing = userLocks.get(userId);
  if (existing) {
    await existing.catch(() => {});
  }
  const task = fn();
  userLocks.set(userId, task);
  try {
    return await task;
  } finally {
    userLocks.delete(userId);
  }
}

/**
 * 日结入口：同步流水 + 结算所有账期 ≤ 今天的未结算数据
 * 00:00 定时跑 = 结算昨天（日清日结）；手动触发 = 含今天（迟到数据由补账机制兜底）
 */
export async function runDailySettlement(): Promise<SettlementSummary> {
  const { locked } = getRunLock();
  if (locked) {
    return {
      syncedLines: 0, newLines: 0, unassigned: 0, unknown: 0,
      settledUsers: 0, settledAmount: 0, skippedUsers: 0,
      errors: ["日结任务正在执行中，请稍后再试"],
    };
  }

  try {
    const sync = await syncTransactionLines();
    const settle = await settleDueDays();
    return {
      syncedLines: sync.syncedLines,
      newLines: sync.newLines,
      unassigned: sync.unassigned,
      unknown: sync.unknown,
      errors: [...sync.errors, ...settle.errors],
      settledUsers: settle.settledUsers,
      settledAmount: settle.settledAmount,
      skippedUsers: settle.skippedUsers,
    };
  } finally {
    releaseRunLock();
  }
}

/**
 * 结算所有账期 ≤ 今天的未结算数据（日清日结）
 * 已结算账期后续来了迟到流水（材运费滞后 1-3 天出且记在订单日）时，
 * 由 settleUserDay 重算全量应付、按差额补扣/补退
 */
export async function settleDueDays(): Promise<{
  settledUsers: number;
  settledAmount: number;
  skippedUsers: number;
  errors: string[];
}> {
  const supabase = await getSupabaseAdminClient();
  const today = shanghaiDateStr(Date.now());
  // 00:00 定时跑时 today 已是新的一天 → 实际结算昨天；
  // 手动触发在白天 → 连今天一起结算，当天后续推单/迟到流水走补账
  const settleCutoff = today;

  const startDate = await getSettlementStartDate();

  // 1. 待结算流水（已归属用户；结算起始日之前的历史流水标记跳过不追账）
  let linesQuery = supabase
    .from("fangguo_transactions")
    .select("id, user_id, tid, kind, processed_amount, settle_date, store_name, fee_name_type, business_node")
    .eq("settled", false)
    .not("user_id", "is", null)
    .lte("settle_date", settleCutoff)
    .order("settle_date", { ascending: true });

  if (startDate) {
    // 起始日之前的流水：先标记 settled（不追账），再从结算集中排除。
    // 注意：必须用谓词整体更新（.eq+.not+.lt），不能 .in(id 列表)——
    // 历史积压可达数百条，id 列表会撑爆 PostgREST URL 长度限制导致静默失败
    const { count: staleCount, error: countErr } = await supabase
      .from("fangguo_transactions")
      .select("id", { count: "exact", head: true })
      .eq("settled", false)
      .not("user_id", "is", null)
      .lt("settle_date", startDate);
    if (countErr) {
      return {
        settledUsers: 0, settledAmount: 0, skippedUsers: 0,
        errors: [`查询起始日之前未结算流水失败: ${countErr.message}`],
      };
    }
    if ((staleCount ?? 0) > 0) {
      const { error: markErr } = await supabase
        .from("fangguo_transactions")
        .update({ settled: true, updated_at: new Date().toISOString() })
        .eq("settled", false)
        .not("user_id", "is", null)
        .lt("settle_date", startDate);
      if (markErr) {
        console.error(`[settlement] mark stale lines failed: ${markErr.message}`);
        return {
          settledUsers: 0, settledAmount: 0, skippedUsers: 0,
          errors: [`标记起始日之前流水失败: ${markErr.message}`],
        };
      }
      console.log(`[settlement] skipped ${staleCount} lines before settlement_start_date=${startDate}`);
    }
    linesQuery = linesQuery.gte("settle_date", startDate);
  }

  const { data: lines, error: linesErr } = await linesQuery;
  if (linesErr) {
    return { settledUsers: 0, settledAmount: 0, skippedUsers: 0, errors: [linesErr.message] };
  }

  // 2. 待结算推单（按用户×日期；服务费部分不受 settlement_start_date 限制）
  const { data: pushes, error: pushErr } = await supabase
    .from("push_records")
    .select("id, user_id, push_date")
    .eq("fee_applied", false)
    .lte("push_date", settleCutoff);
  if (pushErr) {
    return { settledUsers: 0, settledAmount: 0, skippedUsers: 0, errors: [pushErr.message] };
  }

  // 3. 合并为 (user, date) 组
  const groups = new Map<string, {
    user: string; date: string;
    lineIds: string[];
    pushIds: string[];
  }>();
  const groupKey = (u: string, d: string) => `${u}|${d}`;
  const errors: string[] = [];

  for (const line of lines ?? []) {
    const key = groupKey(line.user_id, line.settle_date);
    let g = groups.get(key);
    if (!g) {
      g = { user: line.user_id, date: line.settle_date, lineIds: [], pushIds: [] };
      groups.set(key, g);
    }
    g.lineIds.push(line.id);
  }
  for (const p of pushes ?? []) {
    const key = groupKey(p.user_id, p.push_date);
    let g = groups.get(key);
    if (!g) {
      g = { user: p.user_id, date: p.push_date, lineIds: [], pushIds: [] };
      groups.set(key, g);
    }
    g.pushIds.push(p.id);
  }

  // 3.1 近 7 天窗口重算（含已结算账期）
  // 结算口径 = 订单归属日（推送日）：跨日单（21 号推、22 号发货）的运费归到推送日账期，
  // 因此新流水可能落在「已结算」的其它日期上。每天把窗口内涉及的用户×归属日全部重算，
  // 与已扣总额比对后补扣/补退——账目始终等于资金明细合计。
  const windowStart = dateAddDays(today, -6);
  const ledgers = new Map<string, LedgerRow[]>();
  {
    const { data: recent, error: recentErr } = await supabase
      .from("fangguo_transactions")
      .select("user_id")
      .gte("settle_date", windowStart)
      .not("user_id", "is", null)
      .limit(5000);
    if (recentErr) errors.push(`查询近 7 天流水失败: ${recentErr.message}`);
    const recentUsers = new Set<string>();
    for (const r of recent ?? []) {
      if (r.user_id) recentUsers.add(r.user_id as string);
    }
    for (const uid of recentUsers) {
      let ledger: LedgerRow[];
      try {
        ledger = await buildUserLedger(uid, startDate);
      } catch (e) {
        errors.push(`用户 ${uid} 账本构建失败: ${e instanceof Error ? e.message : e}`);
        continue;
      }
      ledgers.set(uid, ledger);
      for (const row of ledger) {
        if (row.date < windowStart || row.date > settleCutoff) continue;
        const key = groupKey(uid, row.date);
        if (!groups.has(key)) {
          groups.set(key, { user: uid, date: row.date, lineIds: [], pushIds: [] });
        }
      }
    }
  }

  if (groups.size === 0) {
    return { settledUsers: 0, settledAmount: 0, skippedUsers: 0, errors };
  }

  // 4. 逐组结算
  let settledUsers = 0;
  let settledAmount = 0;
  let skippedUsers = 0;

  for (const g of groups.values()) {
    try {
      const ledger = ledgers.get(g.user);
      const result = await withUserLock(g.user, () => settleUserDay(g, startDate, ledger));
      if (result.skipped) {
        skippedUsers += 1;
      } else {
        settledUsers += 1;
        settledAmount += result.amount;
      }
    } catch (e) {
      errors.push(`用户 ${g.user} ${g.date} 结算失败: ${e instanceof Error ? e.message : e}`);
    }
  }

  return { settledUsers, settledAmount, skippedUsers, errors };
}

/**
 * 结算单个用户单天的账（日清日结 + 迟到补账）
 *
 * 每次执行都重算该账期的「全量应付」（含已结算流水与推单，防止迟到数据漏算），
 * 再与已写入的日结流水（主结算 + 补扣/补退，统一「日结 {date}」前缀汇总）比对：
 * - 差额 ≈ 0 → 仅补标记
 * - 差额 < 0（新费用超出已扣）→ 写补扣 consume，余额再扣
 * - 差额 > 0（退费超出已扣）→ 写补退 refund，余额回补
 * 无任何已存在流水时即首次结算，写主结算流水「日结 {date}：推单 X 单 ¥Y + 材运费 ¥Z」
 */
async function settleUserDay(
  g: { user: string; date: string; lineIds: string[]; pushIds: string[] },
  startDate: string | null,
  ledgerIn?: LedgerRow[]
): Promise<{ amount: number; skipped: boolean }> {
  const supabase = await getSupabaseAdminClient();

  // 该账期全量数据（含已结算，用于重算应付）
  const { data: dayLines, error: lErr } = await supabase
    .from("fangguo_transactions")
    .select("id, tid, kind, processed_amount, settled, fee_name_type")
    .eq("user_id", g.user)
    .eq("settle_date", g.date);
  if (lErr) throw new Error(`读取账期流水失败: ${lErr.message}`);

  const { data: dayPushes, error: pErr } = await supabase
    .from("push_records")
    .select("id, fee_applied, order_no")
    .eq("user_id", g.user)
    .eq("push_date", g.date);
  if (pErr) throw new Error(`读取推单记录失败: ${pErr.message}`);

  // 已写入的日结流水（主结算 + 补扣/补退）
  const { data: existingTx, error: tErr } = await supabase
    .from("wallet_transactions")
    .select("id, amount, description")
    .eq("user_id", g.user)
    .like("description", `日结 ${g.date}%`);
  if (tErr) throw new Error(`读取日结流水失败: ${tErr.message}`);

  // ---- 重算全量应付：统一走 buildUserLedger（与「资金明细」同源）----
  // 归属口径 = 订单归属日（推送日）：
  //   材料费 max(预扣, 实扣) − 材料退费 + 运费等实扣 − 运费退费 + 0.5 服务费
  // 全部记入该订单的推送日账期。因此「某天扣款 ≡ 该天资金明细合计」，
  // 跨日单（21 号推、22 号发货）的运费、退费一律回推送日，不另立账期。
  const ledger = ledgerIn ?? (await buildUserLedger(g.user, startDate));
  let due = 0; // 正数：用户应付
  let pushCount = 0;
  const ledgerTids = new Set<string>();
  for (const row of ledger) {
    if (row.date !== g.date) continue;
    ledgerTids.add(row.order_no);
    due += row.materialGross - row.materialRefund + row.freightGross - row.freightRefund;
    if (row.pushFee > 0) {
      due += row.pushFee;
      pushCount += 1;
    }
  }
  // 流水尚未同步时的系统推单兜底（push_records 有、流水还没有）
  for (const p of dayPushes ?? []) {
    if (p.order_no && !ledgerTids.has(p.order_no)) {
      due += PUSH_FEE;
      pushCount += 1;
    }
  }
  const pushFee = round2(pushCount * PUSH_FEE); // 正数（展示用）
  const materialFreight = -round2(due - pushFee); // 材运费（负，展示用）
  const refundTotal = 0; // 退费已各自冲抵进材料/运费净额
  const totalDue = -round2(due); // 负 = 应付

  // ---- 与已扣总额比对 ----
  const already = parseFloat(
    (existingTx ?? []).reduce((s, t) => s + parseFloat(t.amount as string), 0).toFixed(2)
  );
  const delta = parseFloat((totalDue - already).toFixed(2));
  const hasExisting = (existingTx ?? []).length > 0;
  const hasUnsettled =
    (dayLines ?? []).some((l) => !l.settled) || (dayPushes ?? []).some((p) => !p.fee_applied);

  if (Math.abs(delta) < 0.005) {
    // 账已平：仅补标记
    if (hasUnsettled) await markSettled(g);
    return { amount: 0, skipped: true };
  }

  // ---- 余额变更（delta 负=扣费，正=回补），乐观锁 3 次重试 ----
  let newBalance = 0;
  let updated = false;
  for (let attempt = 0; attempt < 3 && !updated; attempt++) {
    const { data: bal, error: readErr } = await supabase
      .from("user_balances")
      .select("balance, total_consume")
      .eq("user_id", g.user)
      .single();
    if (readErr || !bal) {
      throw new Error(`读取余额失败: ${readErr?.message ?? "无记录"}`);
    }
    const current = parseFloat(bal.balance as string);
    newBalance = parseFloat((current + delta).toFixed(2));
    // total_consume 累计消费绝对值（仅扣费方向），补退不回退累计值
    const consumeDelta = delta < 0 ? Math.abs(delta) : 0;
    const newTotalConsume = (parseFloat(bal.total_consume as string) + consumeDelta).toFixed(2);

    const { data: upd, error: updErr } = await supabase
      .from("user_balances")
      .update({
        balance: newBalance.toFixed(2),
        total_consume: newTotalConsume,
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", g.user)
      .eq("balance", bal.balance)
      .select("balance")
      .single();
    if (updErr) throw new Error(`更新余额失败: ${updErr.message}`);
    if (upd) updated = true;
  }
  if (!updated) throw new Error("乐观锁重试耗尽");

  // ---- 写流水 ----
  let desc: string;
  let type: string;
  if (!hasExisting) {
    const parts: string[] = [];
    if (pushCount > 0) parts.push(`推单 ${pushCount} 单 ¥${pushFee.toFixed(2)}`);
    const mat = parseFloat((materialFreight + refundTotal).toFixed(2));
    if (mat !== 0) parts.push(`材运费 ¥${Math.abs(mat).toFixed(2)}`);
    desc = `日结 ${g.date}：${parts.join(" + ")}`;
    type = delta < 0 ? "consume" : "refund";
  } else if (delta < 0) {
    desc = `日结 ${g.date} 补扣：¥${Math.abs(delta).toFixed(2)}`;
    type = "consume";
  } else {
    desc = `日结 ${g.date} 补退：¥${delta.toFixed(2)}`;
    type = "refund";
  }
  const { error: txErr } = await supabase.from("wallet_transactions").insert({
    user_id: g.user,
    type,
    amount: delta.toFixed(2),
    balance_after: newBalance.toFixed(2),
    description: desc.slice(0, 255),
  });
  if (txErr) throw new Error(`写流水失败: ${txErr.message}`);

  await markSettled(g);
  return { amount: delta, skipped: false };
}

/** 标记一组数据已结算（谓词式：该用户该账期全部未结算记录） */
async function markSettled(g: { user: string; date: string }): Promise<void> {
  const supabase = await getSupabaseAdminClient();
  const now = new Date().toISOString();

  const { error: markErr } = await supabase
    .from("fangguo_transactions")
    .update({ settled: true, updated_at: now })
    .eq("user_id", g.user)
    .eq("settle_date", g.date)
    .eq("settled", false);
  if (markErr) throw new Error(`标记流水 settled 失败: ${markErr.message}`);

  const { error: feeErr } = await supabase
    .from("push_records")
    .update({ fee_applied: true, settled_at: now })
    .eq("user_id", g.user)
    .eq("push_date", g.date)
    .eq("fee_applied", false);
  if (feeErr) throw new Error(`标记推单计费失败: ${feeErr.message}`);
}
