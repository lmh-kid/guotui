import type { Metadata } from 'next';
import './globals.css';
import AuthProvider from '@/components/auth-provider-wrapper';
import { Toaster } from '@/components/ui/sonner';

export const metadata: Metadata = {
  title: {
    default: '果推 - 智能订单推单系统',
    template: '%s | 果推',
  },
  description:
    '多平台订单统一管理，智能解码，一键推单，按单计费',
  keywords: [
    '订单管理',
    'Temu',
    'Shein',
    '推单系统',
    'POD',
    '一件代发',
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body className={`antialiased bg-gray-50`}>
        <AuthProvider>
          {children}
          <Toaster />
        </AuthProvider>
      </body>
    </html>
  );
}
