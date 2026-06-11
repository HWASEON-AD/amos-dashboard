import type { Metadata } from 'next'
import './globals.css'
import Nav from '@/components/Nav'

export const metadata: Metadata = {
  title: 'AMOS 대시보드',
  description: '아모스 블로그 노출현황 + 캡처 통합 대시보드',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body className="bg-gray-50 min-h-screen">
        <Nav />
        <main>{children}</main>
      </body>
    </html>
  )
}
