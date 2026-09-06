import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'EZReplac 邮件助手',
  description: '个人亚马逊客服邮件回复与物流处理工具',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body className="antialiased">{children}</body>
    </html>
  );
}
