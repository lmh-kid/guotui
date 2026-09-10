'use client';

import AppLayout from '@/components/app-layout';
import { Package, Construction } from 'lucide-react';

export default function ProductsPage() {
  return (
    <AppLayout>
      <div className="p-4 lg:p-6">
        <div className="mb-6">
          <h1 className="text-xl font-bold text-gray-900">商品管理</h1>
          <p className="text-sm text-gray-500 mt-1">管理您的商品和商家编码</p>
        </div>

        <div className="bg-white rounded-lg border border-gray-200 p-12 text-center">
          <div className="w-20 h-20 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <Construction className="w-10 h-10 text-gray-400" />
          </div>
          <h2 className="text-lg font-medium text-gray-900 mb-2">功能开发中</h2>
          <p className="text-gray-500 max-w-md mx-auto">
            商品管理模块即将上线，您将可以在这里管理商品编码、智能解码规则、批量设置商家编码等。
          </p>
        </div>
      </div>
    </AppLayout>
  );
}
