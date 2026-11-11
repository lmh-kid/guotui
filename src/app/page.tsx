'use client';

import { useState, useEffect, useCallback } from 'react';
import AppLayout from '@/components/app-layout';
import { apiRequest } from '@/lib/api-request';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationNext,
  PaginationPrevious,
} from '@/components/ui/pagination';
import {
  Search,
  RefreshCw,
  Play,
  Loader2,
  AlertCircle,
  Package,
  CalendarDays,
  Send,
} from 'lucide-react';
import { toast } from 'sonner';

interface Order {
  order_no: string;
  platform: string;
  platform_desc: string;
  order_type_desc: string | null;
  status: string;
  df_status: number;
  product_name: string;
  product_image: string | null;
  spec: string | null;
  merchant_code: string | null;
  quantity: number;
  price: string;
  pay_time: string | null;
  deliver_time: string | null;
  tracking_no: string | null;
  logistics_company: string | null;
  store_name: string;
  factory_id: string | null;
  buyer_remark: string;
}

interface Billing {
  balance: number;
  blocked: boolean;
  todayPushed: number;
  todayUnsettled: number;
  unsettledAmount: number;
  availableQuota: number;
}

interface OrdersResponse {
  list: Order[];
  total: number;
  page: number;
  pageSize: number;
  statusCounts: Record<string, number>;
  billing: Billing;
  noShop: boolean;
  days: number;
}

const STATUS_TABS = [
  { key: 'all', label: '全部' },
  { key: 'pending', label: '待整理' },
  { key: 'decoded', label: '待推送' },
  { key: 'pushed', label: '已推送' },
  { key: 'production', label: '生产中' },
  { key: 'shipped', label: '已发货' },
];

const statusConfig: Record<string, { label: string; className: string }> = {
  pending: { label: '待整理', className: 'bg-gray-100 text-gray-700' },
  decoded: { label: '待推送', className: 'bg-blue-100 text-blue-700' },
  pushed: { label: '已推送', className: 'bg-green-100 text-green-700' },
  production: { label: '生产中', className: 'bg-purple-100 text-purple-700' },
  shipped: { label: '已发货', className: 'bg-emerald-100 text-emerald-700' },
};

const platformNames: Record<string, string> = {
  temu: 'Temu',
  shein: 'Shein',
  aliexpress: '速卖通',
  tiktok: 'TikTok',
  alibaba: '1688',
};

const DAYS_OPTIONS = [
  { value: 1, label: '今天' },
  { value: 3, label: '近3天' },
  { value: 7, label: '近7天' },
];

export default function OrdersPage() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [pageSize] = useState(20);
  const [activeStatus, setActiveStatus] = useState('all');
  const [statusCounts, setStatusCounts] = useState<Record<string, number>>({});
  const [selectedNos, setSelectedNos] = useState<string[]>([]);
  const [keyword, setKeyword] = useState('');
  const [days, setDays] = useState(1);
  const [billing, setBilling] = useState<Billing | null>(null);
  const [noShop, setNoShop] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const fetchOrders = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize),
        status: activeStatus,
        days: String(days),
      });
      if (keyword) params.set('keyword', keyword);

      const data = await apiRequest<OrdersResponse>(`/api/orders?${params.toString()}`);
      setOrders(data.list);
      setTotal(data.total);
      setStatusCounts(data.statusCounts || {});
      setBilling(data.billing || null);
      setNoShop(!!data.noShop);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : '加载订单失败';
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, activeStatus, keyword, days]);

  useEffect(() => {
    fetchOrders();
  }, [fetchOrders]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      setSelectedNos(orders.filter((o) => o.df_status === 1).map((o) => o.order_no));
    } else {
      setSelectedNos([]);
    }
  };

  const handleSelectOne = (orderNo: string, checked: boolean) => {
    if (checked) {
      setSelectedNos((prev) => [...prev, orderNo]);
    } else {
      setSelectedNos((prev) => prev.filter((i) => i !== orderNo));
    }
  };

  const handlePush = async (orderNos: string[]) => {
    if (orderNos.length === 0) {
      toast.warning('请先选择订单');
      return;
    }
    setActionLoading('push');
    try {
      const result = await apiRequest<{ success: boolean; message: string }>(
        '/api/orders/batch-push',
        {
          method: 'POST',
          body: JSON.stringify({ order_nos: orderNos }),
        }
      );
      toast.success(result.message);
      window.dispatchEvent(new Event('balance-updated'));
      setSelectedNos([]);
      fetchOrders();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : '推单失败';
      toast.error(message);
    } finally {
      setActionLoading(null);
    }
  };

  const pushableCount = orders.filter((o) => o.df_status === 1).length;

  return (
    <AppLayout>
      <div className="p-4 lg:p-6">
        {/* 页面标题 */}
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-xl font-bold text-gray-900">我的订单</h1>
            <p className="text-sm text-gray-500 mt-1">
              共 {total} 条订单 · 数据实时来自方果平台，仅支持查询近 7 天
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={fetchOrders} disabled={loading}>
              <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
              刷新
            </Button>
          </div>
        </div>

        {/* 计费状态栏 */}
        {billing && (
          <div className={`rounded-lg border mb-4 p-4 flex flex-wrap gap-x-8 gap-y-2 items-center text-sm ${
            billing.blocked
              ? 'bg-red-50 border-red-200'
              : 'bg-white border-gray-200'
          }`}>
            {billing.blocked ? (
              <div className="flex items-center gap-2 text-red-600 font-medium">
                <AlertCircle className="w-4 h-4" />
                余额 ¥{billing.balance.toFixed(2)}（欠费）——已禁止推单，请联系管理员补调
              </div>
            ) : (
              <>
                <div>
                  <span className="text-gray-500">余额 </span>
                  <span className="font-semibold text-gray-900">¥{billing.balance.toFixed(2)}</span>
                </div>
                <div>
                  <span className="text-gray-500">今日已推 </span>
                  <span className="font-semibold text-gray-900">{billing.todayPushed} 单</span>
                </div>
                <div>
                  <span className="text-gray-500">待结算 </span>
                  <span className="font-semibold text-amber-600">¥{billing.unsettledAmount.toFixed(2)}</span>
                  <span className="text-gray-400 text-xs">（次日自动结算）</span>
                </div>
                <div>
                  <span className="text-gray-500">今日还可推 </span>
                  <span className={`font-semibold ${billing.availableQuota > 0 ? 'text-blue-600' : 'text-red-500'}`}>
                    {billing.availableQuota} 单
                  </span>
                </div>
                <div className="text-gray-400 text-xs">推单 ¥0.50/单，按日结算</div>
              </>
            )}
          </div>
        )}

        {/* 未分配店铺提示 */}
        {noShop && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 mb-4 flex items-start gap-2 text-sm text-amber-700">
            <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
            <div>您的账号暂未分配店铺，订单将无法展示。请联系管理员在后台「平台对接」中为您分配店铺。</div>
          </div>
        )}

        {/* 筛选栏 */}
        <div className="bg-white rounded-lg border border-gray-200 mb-4">
          <div className="p-4 border-b border-gray-100">
            <div className="flex flex-wrap gap-3 items-center">
              <div className="relative flex-1 min-w-[220px] max-w-md">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <Input
                  placeholder="搜索订单号、商品名称、店铺、商户编码..."
                  className="pl-10"
                  value={keyword}
                  onChange={(e) => setKeyword(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      setPage(1);
                      fetchOrders();
                    }
                  }}
                />
              </div>
              <div className="flex items-center gap-1 border border-gray-200 rounded-md p-1">
                <CalendarDays className="w-4 h-4 text-gray-400 ml-1.5" />
                {DAYS_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => {
                      setDays(opt.value);
                      setPage(1);
                    }}
                    className={`px-3 py-1 text-sm rounded transition-colors ${
                      days === opt.value
                        ? 'bg-blue-600 text-white'
                        : 'text-gray-600 hover:bg-gray-100'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* 状态 Tabs */}
          <div className="flex overflow-x-auto border-b border-gray-100">
            {STATUS_TABS.map((tab) => {
              const count = statusCounts[tab.key] || 0;
              const isActive = activeStatus === tab.key;
              return (
                <button
                  key={tab.key}
                  onClick={() => {
                    setActiveStatus(tab.key);
                    setPage(1);
                  }}
                  className={`
                    px-4 py-3 text-sm font-medium whitespace-nowrap
                    border-b-2 -mb-px transition-colors
                    ${isActive
                      ? 'border-blue-600 text-blue-600'
                      : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                    }
                  `}
                >
                  {tab.label}
                  {count > 0 && (
                    <span className={`ml-1.5 px-1.5 py-0.5 text-xs rounded-full ${
                      isActive ? 'bg-blue-100 text-blue-600' : 'bg-gray-100 text-gray-600'
                    }`}>
                      {count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* 批量操作栏 */}
        {total > 0 && !noShop && (
          <div className="bg-white rounded-lg border border-gray-200 mb-4 p-3 flex flex-wrap gap-2 items-center">
            <span className="text-sm text-gray-600">
              已选 <span className="font-medium text-blue-600">{selectedNos.length}</span> 单
            </span>
            <div className="h-5 w-px bg-gray-200" />
            <span className="text-xs text-gray-400">本页可推送 {pushableCount} 单（仅「待推送」状态）</span>
            <Button
              size="sm"
              onClick={() => handlePush(selectedNos)}
              disabled={selectedNos.length === 0 || actionLoading !== null || !!billing?.blocked}
            >
              {actionLoading === 'push' ? (
                <Loader2 className="w-4 h-4 mr-1 animate-spin" />
              ) : (
                <Send className="w-4 h-4 mr-1" />
              )}
              批量推送
            </Button>
          </div>
        )}

        {/* 订单列表 */}
        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
          {loading ? (
            <div className="py-20 flex justify-center">
              <Loader2 className="animate-spin h-8 w-8 text-blue-600" />
            </div>
          ) : orders.length === 0 ? (
            <div className="py-20 text-center">
              <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <Package className="w-8 h-8 text-gray-400" />
              </div>
              <p className="text-gray-500 mb-2">暂无订单数据</p>
              <p className="text-xs text-gray-400">
                {noShop
                  ? '请联系管理员分配店铺后再查询'
                  : '订单实时来自方果平台，可尝试切换「近3天 / 近7天」查看'}
              </p>
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-12">
                        <Checkbox
                          checked={pushableCount > 0 && selectedNos.length === pushableCount}
                          onCheckedChange={handleSelectAll}
                          disabled={pushableCount === 0}
                          aria-label="全选可推送订单"
                        />
                      </TableHead>
                      <TableHead className="w-10">序号</TableHead>
                      <TableHead>订单信息</TableHead>
                      <TableHead>店铺 / 工厂</TableHead>
                      <TableHead>订单状态</TableHead>
                      <TableHead>付款时间</TableHead>
                      <TableHead className="text-right">数量/金额</TableHead>
                      <TableHead>物流信息</TableHead>
                      <TableHead>操作</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {orders.map((order, index) => {
                      const statusInfo = statusConfig[order.status] || statusConfig.pending;
                      const canPush =
                        order.df_status === 1 &&
                        !billing?.blocked &&
                        (billing?.availableQuota ?? 0) > 0;

                      return (
                        <TableRow key={order.order_no}>
                          <TableCell>
                            <Checkbox
                              checked={selectedNos.includes(order.order_no)}
                              onCheckedChange={(checked) => handleSelectOne(order.order_no, !!checked)}
                              disabled={order.df_status !== 1}
                              aria-label="选择"
                            />
                          </TableCell>
                          <TableCell className="text-gray-500 text-sm">
                            {(page - 1) * pageSize + index + 1}
                          </TableCell>
                          <TableCell>
                            <div className="flex gap-3 max-w-sm">
                              {order.product_image && (
                                <img
                                  src={order.product_image}
                                  alt=""
                                  className="w-14 h-14 rounded object-cover flex-shrink-0"
                                />
                              )}
                              <div className="min-w-0">
                                <div className="flex items-center gap-2 mb-1 flex-wrap">
                                  <Badge variant="outline" className="text-xs font-normal">
                                    {platformNames[order.platform] || order.platform_desc || order.platform}
                                  </Badge>
                                  <span className="text-xs text-gray-400 font-mono">{order.order_no}</span>
                                </div>
                                <p className="text-sm font-medium text-gray-900 truncate" title={order.product_name}>
                                  {order.product_name}
                                </p>
                                {order.spec && (
                                  <p className="text-xs text-gray-500 truncate mt-0.5">{order.spec}</p>
                                )}
                                {order.merchant_code && (
                                  <p className="text-xs text-gray-500 mt-1">
                                    商户编码：<span className="font-mono text-gray-700">{order.merchant_code}</span>
                                  </p>
                                )}
                              </div>
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="space-y-1">
                              <div className="text-sm text-gray-700 truncate max-w-[150px]" title={order.store_name}>
                                {order.store_name || <span className="text-gray-400">-</span>}
                              </div>
                              <div className="text-xs text-gray-400">
                                {order.factory_id ? (
                                  <span>工厂 #{order.factory_id}</span>
                                ) : (
                                  <span>待定</span>
                                )}
                              </div>
                            </div>
                          </TableCell>
                          <TableCell>
                            <Badge className={statusInfo.className}>{statusInfo.label}</Badge>
                          </TableCell>
                          <TableCell className="text-sm text-gray-600">
                            {order.pay_time ? new Date(order.pay_time).toLocaleString('zh-CN', {
                              month: '2-digit',
                              day: '2-digit',
                              hour: '2-digit',
                              minute: '2-digit',
                            }) : '-'}
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="text-sm text-gray-900">x{order.quantity}</div>
                            <div className="text-sm text-blue-600 font-medium">¥{order.price}</div>
                          </TableCell>
                          <TableCell className="text-sm text-gray-600">
                            {order.tracking_no ? (
                              <div>
                                <div>{order.logistics_company}</div>
                                <div className="text-xs text-gray-400 font-mono">{order.tracking_no}</div>
                              </div>
                            ) : (
                              <span className="text-gray-400">待发货</span>
                            )}
                          </TableCell>
                          <TableCell>
                            {order.df_status === 1 ? (
                              <Button
                                size="sm"
                                onClick={() => handlePush([order.order_no])}
                                disabled={actionLoading !== null || !!billing?.blocked || (billing?.availableQuota ?? 0) < 1}
                              >
                                {actionLoading === 'push' ? (
                                  <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                                ) : (
                                  <Play className="w-4 h-4 mr-1" />
                                )}
                                推送
                              </Button>
                            ) : (
                              <span className="text-xs text-gray-400">-</span>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>

              {/* 分页 */}
              {totalPages > 1 && (
                <div className="p-4 border-t border-gray-100">
                  <Pagination>
                    <PaginationContent>
                      <PaginationItem>
                        <PaginationPrevious
                          onClick={() => setPage((p) => Math.max(1, p - 1))}
                          className={page === 1 ? 'pointer-events-none opacity-50' : 'cursor-pointer'}
                        />
                      </PaginationItem>
                      <PaginationItem>
                        <span className="px-4 py-2 text-sm text-gray-600">
                          第 {page} / {totalPages} 页
                        </span>
                      </PaginationItem>
                      <PaginationItem>
                        <PaginationNext
                          onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                          className={page === totalPages ? 'pointer-events-none opacity-50' : 'cursor-pointer'}
                        />
                      </PaginationItem>
                    </PaginationContent>
                  </Pagination>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </AppLayout>
  );
}
