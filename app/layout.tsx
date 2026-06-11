import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'AMOS 노출 대시보드',
  description: '아모스 블로그 키워드 노출 모니터링',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body className="bg-gray-50 min-h-screen">{children}</body>
    </html>
  )
}
