'use client';

import { useState, useEffect, useCallback } from 'react';
import { apiRequest } from '@/lib/api-request';
import { Button } from '@/components/ui/button';
import { Wallet, ArrowDownCircle, ArrowUpCircle, Clock, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

interface Transaction {
  id: string;
  type: string;
  amount: string;
  balance_after: string;
  description: string;
  order_id: string | null;
  created_at: string;
}

interface TransactionsResponse {
  list: Transaction[];
  total: number;
  page: number;
  pageSize: number;
}

const TYPE_FILTERS = [
  { key: 'all', label: '全部' },
  { key: 'recharge', label: '充值' },
  { key: 'consume', label: '消费' },
];

/** 钱包账单流水（wallet_transactions 入库记录：充值 / 日结扣款 / 管理员调账） */
export default function TransactionsTab() {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [pageSize] = useState(20);

  const fetchTransactions = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize),
        type: filter,
      });
      const data = await apiRequest<TransactionsResponse>(
        `/api/wallet/transactions?${params.toString()}`
      );
      setTransactions(data.list);
      setTotal(data.total);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : '加载流水失败';
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, filter]);

  useEffect(() => {
    fetchTransactions();
  }, [fetchTransactions]);

  const totalPages = Math.ceil(total / pageSize);

  return (
    <div>
      {/* 类型筛选 */}
      <div className="flex items-center gap-1 border border-gray-200 rounded-md p-1 mb-4 w-fit">
        {TYPE_FILTERS.map((opt) => (
          <button
            key={opt.key}
            onClick={() => {
              setFilter(opt.key);
              setPage(1);
            }}
            className={`px-3 py-1 text-sm rounded transition-colors ${
              filter === opt.key ? 'bg-blue-600 text-white' : 'text-gray-600 hover:bg-gray-100'
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="py-16 flex justify-center">
          <Loader2 className="animate-spin h-8 w-8 text-blue-600" />
        </div>
      ) : transactions.length === 0 ? (
        <div className="py-16 text-center">
          <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <Wallet className="w-8 h-8 text-gray-400" />
          </div>
          <p className="text-gray-500">暂无账单记录</p>
        </div>
      ) : (
        <>
          <div className="space-y-3">
            {transactions.map((tx) => {
              const isRecharge = tx.type === 'recharge';
              const isPositive = isRecharge || tx.type === 'refund';
              const Icon = isPositive ? ArrowDownCircle : ArrowUpCircle;

              return (
                <div
                  key={tx.id}
                  className="flex items-center justify-between p-3 hover:bg-gray-50 rounded-lg transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <div
                      className={`w-10 h-10 rounded-full flex items-center justify-center ${
                        isPositive
                          ? 'bg-green-100 text-green-600'
                          : 'bg-red-100 text-red-600'
                      }`}
                    >
                      <Icon className="w-5 h-5" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-gray-900">
                        {tx.description || (isRecharge ? '账户充值' : '消费扣款')}
                      </p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <Clock className="w-3 h-3 text-gray-400" />
                        <span className="text-xs text-gray-400">
                          {new Date(tx.created_at).toLocaleString('zh-CN')}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="text-right">
                    <p
                      className={`text-sm font-semibold ${
                        isPositive ? 'text-green-600' : 'text-red-600'
                      }`}
                    >
                      {isPositive ? '+' : ''}{tx.amount}
                    </p>
                    <p className="text-xs text-gray-400 mt-0.5">
                      余额：¥{tx.balance_after}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>

          {/* 分页 */}
          {totalPages > 1 && (
            <div className="flex justify-center items-center gap-4 mt-6 pt-4 border-t border-gray-100">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
              >
                上一页
              </Button>
              <span className="text-sm text-gray-500">
                第 {page} / {totalPages} 页
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
              >
                下一页
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
