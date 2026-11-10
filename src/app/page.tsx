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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
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
  Zap,
  Filter,
  ChevronDown,
  Clock,
  Loader2,
  AlertCircle,
  CheckCircle2,
  XCircle,
  Package,
} from 'lucide-react';
import { toast } from 'sonner';

interface Order {
  id: string;
  order_no: string;
  platform: string;
  order_type: string;
  status: string;
  decode_status: string;
  product_name: string;
  product_image: string;
  spec: string;
  merchant_code: string | null;
  quantity: number;
  price: string;
  receiver_name: string;
  receiver_phone: string;
  receiver_address: string;
  receiver_country: string;
  pay_time: string;
  delivery_deadline: string;
  tracking_no: string | null;
  logistics_company: string | null;
  store_name: string | null;
  factory_id: string | null;
  df_status: number | null;
}

interface OrdersResponse {
  list: Order[];
  total: number;
  page: number;
  pageSize: number;
  statusCounts: Record<string, number>;
}

const STATUS_TABS = [
  { key: 'all', label: '全部' },
  { key: 'pending', label: '待整理' },
  { key: 'decoding', label: '解码中' },
  { key: 'decoded', label: '待推送' },
  { key: 'pushed', label: '已推送' },
  { key: 'production', label: '生产中' },
  { key: 'shipped', label: '已发货' },
];

const statusConfig: Record<string, { label: string; className: string }> = {
  pending: { label: '待整理', className: 'bg-gray-100 text-gray-700' },
  decoding: { label: '解码中', className: 'bg-yellow-100 text-yellow-700' },
  decoded: { label: '待推送', className: 'bg-blue-100 text-blue-700' },
  pushed: { label: '已推送', className: 'bg-green-100 text-green-700' },
  production: { label: '生产中', className: 'bg-purple-100 text-purple-700' },
  shipped: { label: '已发货', className: 'bg-emerald-100 text-emerald-700' },
};

const decodeStatusConfig: Record<string, { label: string; icon: typeof AlertCircle; className: string }> = {
  pending: { label: '待解码', icon: Clock, className: 'text-gray-500' },
  success: { label: '解码成功', icon: CheckCircle2, className: 'text-green-600' },
  fail: { label: '解码失败', icon: XCircle, className: 'text-red-600' },
};

const platformNames: Record<string, string> = {
  temu: 'Temu',
  shein: 'Shein',
  aliexpress: '速卖通',
  tiktok: 'TikTok',
  alibaba: '1688',
  wish: 'Wish',
  lazada: 'Lazada',
  shopee: 'Shopee',
  amazon: 'Amazon',
};

export default function OrdersPage() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [pageSize] = useState(20);
  const [activeStatus, setActiveStatus] = useState('all');
  const [statusCounts, setStatusCounts] = useState<Record<string, number>>({});
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [keyword, setKeyword] = useState('');
  const [platform, setPlatform] = useState('all');
  const [showFilters, setShowFilters] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const fetchOrders = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize),
        status: activeStatus,
      });
      if (keyword) params.set('keyword', keyword);
      if (platform && platform !== 'all') params.set('platform', platform);

      const data = await apiRequest<OrdersResponse>(`/api/orders?${params.toString()}`);
      setOrders(data.list);
      setTotal(data.total);
      setStatusCounts(data.statusCounts || {});
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : '加载订单失败';
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, activeStatus, keyword, platform]);

  useEffect(() => {
    fetchOrders();
  }, [fetchOrders]);

  const totalPages = Math.ceil(total / pageSize);

  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      setSelectedIds(orders.map((o) => o.id));
    } else {
      setSelectedIds([]);
    }
  };

  const handleSelectOne = (id: string, checked: boolean) => {
    if (checked) {
      setSelectedIds((prev) => [...prev, id]);
    } else {
      setSelectedIds((prev) => prev.filter((i) => i !== id));
    }
  };

  const handleBatchDecode = async () => {
    if (selectedIds.length === 0) {
      toast.warning('请先选择订单');
      return;
    }
    setActionLoading('decode');
    try {
      const result = await apiRequest<{ success: boolean; message: string; successCount: number; failCount: number }>(
        '/api/orders/batch-decode',
        {
          method: 'POST',
          body: JSON.stringify({ order_ids: selectedIds }),
        }
      );
      toast.success(result.message);
      fetchOrders();
      setSelectedIds([]);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : '批量解码失败';
      toast.error(message);
    } finally {
      setActionLoading(null);
    }
  };

  const handleBatchPush = async () => {
    if (selectedIds.length === 0) {
      toast.warning('请先选择订单');
      return;
    }
    setActionLoading('push');
    try {
      const result = await apiRequest<{ success: boolean; message: string; balance: string }>(
        '/api/orders/batch-push',
        {
          method: 'POST',
          body: JSON.stringify({ order_ids: selectedIds }),
        }
      );
      toast.success(result.message);
      window.dispatchEvent(new Event('balance-updated'));
      fetchOrders();
      setSelectedIds([]);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : '批量推单失败';
      toast.error(message);
    } finally {
      setActionLoading(null);
    }
  };

  const totalSelected = selectedIds.length;

  return (
    <AppLayout>
      <div className="p-4 lg:p-6">
        {/* 页面标题 */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-bold text-gray-900">我的订单</h1>
            <p className="text-sm text-gray-500 mt-1">共 {total} 条订单</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={fetchOrders} disabled={loading}>
              <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
              同步刷新
            </Button>
          </div>
        </div>

        {/* 筛选栏 */}
        <div className="bg-white rounded-lg border border-gray-200 mb-4">
          <div className="p-4 border-b border-gray-100">
            <div className="flex flex-wrap gap-3 items-center">
              <div className="relative flex-1 min-w-[200px] max-w-md">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <Input
                  placeholder="搜索订单号、收件人、商品名称..."
                  className="pl-10"
                  value={keyword}
                  onChange={(e) => setKeyword(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && (setPage(1), fetchOrders())}
                />
              </div>
              <Select value={platform} onValueChange={setPlatform}>
                <SelectTrigger className="w-[140px]">
                  <SelectValue placeholder="选择平台" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">全部平台</SelectItem>
                  <SelectItem value="temu">Temu</SelectItem>
                  <SelectItem value="shein">Shein</SelectItem>
                  <SelectItem value="aliexpress">速卖通</SelectItem>
                </SelectContent>
              </Select>
              <Button variant="outline" onClick={() => setShowFilters(!showFilters)}>
                <Filter className="w-4 h-4 mr-2" />
                筛选
                <ChevronDown className="w-4 h-4 ml-2" />
              </Button>
              <Button variant="outline" onClick={fetchOrders}>
                <RefreshCw className="w-4 h-4 mr-2" />
                刷新
              </Button>
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
        {total > 0 && (
          <div className="bg-white rounded-lg border border-gray-200 mb-4 p-3 flex flex-wrap gap-2 items-center">
            <span className="text-sm text-gray-600">
              已选 <span className="font-medium text-blue-600">{totalSelected}</span> 单
            </span>
            <div className="h-5 w-px bg-gray-200" />
            <Button
              size="sm"
              variant="outline"
              onClick={handleBatchDecode}
              disabled={totalSelected === 0 || actionLoading !== null}
            >
              {actionLoading === 'decode' ? (
                <Loader2 className="w-4 h-4 mr-1 animate-spin" />
              ) : (
                <Zap className="w-4 h-4 mr-1" />
              )}
              智能解码
            </Button>
            <Button
              size="sm"
              onClick={handleBatchPush}
              disabled={totalSelected === 0 || actionLoading !== null}
            >
              {actionLoading === 'push' ? (
                <Loader2 className="w-4 h-4 mr-1 animate-spin" />
              ) : (
                <Play className="w-4 h-4 mr-1" />
              )}
              订单推送
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
                订单由系统自动从方果平台同步，请确认店铺已在后台分配给您
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
                          checked={selectedIds.length === orders.length && orders.length > 0}
                          onCheckedChange={handleSelectAll}
                          aria-label="全选"
                        />
                      </TableHead>
                      <TableHead className="w-10">序号</TableHead>
                      <TableHead>订单信息</TableHead>
                      <TableHead>店铺 / 工厂</TableHead>
                      <TableHead>订单状态</TableHead>
                      <TableHead>付款时间</TableHead>
                      <TableHead>收件人信息</TableHead>
                      <TableHead className="text-right">数量/金额</TableHead>
                      <TableHead>发货信息</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {orders.map((order, index) => {
                      const decodeInfo = decodeStatusConfig[order.decode_status] || decodeStatusConfig.pending;
                      const DecodeIcon = decodeInfo.icon;
                      const statusInfo = statusConfig[order.status] || statusConfig.pending;

                      return (
                        <TableRow key={order.id}>
                          <TableCell>
                            <Checkbox
                              checked={selectedIds.includes(order.id)}
                              onCheckedChange={(checked) => handleSelectOne(order.id, !!checked)}
                              aria-label="选择"
                            />
                          </TableCell>
                          <TableCell className="text-gray-500 text-sm">
                            {(page - 1) * pageSize + index + 1}
                          </TableCell>
                          <TableCell>
                            <div className="flex gap-3 max-w-sm">
                              <img
                                src={order.product_image}
                                alt=""
                                className="w-14 h-14 rounded object-cover flex-shrink-0"
                              />
                              <div className="min-w-0">
                                <div className="flex items-center gap-2 mb-1">
                                  <Badge variant="outline" className="text-xs font-normal">
                                    {platformNames[order.platform] || order.platform}
                                  </Badge>
                                  {order.order_type && (
                                    <Badge className="text-xs font-normal bg-yellow-50 text-yellow-700 border-yellow-200">
                                      {order.order_type}
                                    </Badge>
                                  )}
                                </div>
                                <p className="text-sm font-medium text-gray-900 truncate">
                                  {order.product_name}
                                </p>
                                <p className="text-xs text-gray-500 truncate mt-0.5">
                                  {order.spec}
                                </p>
                                <div className="flex items-center gap-1 mt-1">
                                  <DecodeIcon className={`w-3 h-3 ${decodeInfo.className}`} />
                                  <span className={`text-xs ${decodeInfo.className}`}>
                                    {decodeInfo.label}
                                  </span>
                                  {order.merchant_code && (
                                    <span className="text-xs text-gray-400 ml-2">
                                      编码：{order.merchant_code}
                                    </span>
                                  )}
                                </div>
                              </div>
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="space-y-1">
                              <div className="text-sm text-gray-700 truncate max-w-[160px]" title={order.store_name || ''}>
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
                          <TableCell className="text-sm">
                            <div className="text-gray-900 font-medium">{order.receiver_name}</div>
                            <div className="text-gray-500 text-xs truncate max-w-[180px]">
                              {order.receiver_phone}
                            </div>
                            <div className="text-gray-400 text-xs truncate max-w-[180px]">
                              {order.receiver_country}
                            </div>
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="text-sm text-gray-900">x{order.quantity}</div>
                            <div className="text-sm text-blue-600 font-medium">¥{order.price}</div>
                          </TableCell>
                          <TableCell className="text-sm text-gray-600">
                            {order.tracking_no ? (
                              <div>
                                <div>{order.logistics_company}</div>
                                <div className="text-xs text-gray-400">{order.tracking_no}</div>
                              </div>
                            ) : (
                              <span className="text-gray-400">待发货</span>
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
