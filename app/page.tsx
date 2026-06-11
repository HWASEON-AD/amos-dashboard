'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'

interface DailyExposure {
  date: string
  is_exposed: boolean
  created_at: string
}

interface Keyword {
  id: string
  keyword: string
  blog_url: string | null
  hwaseon_url: string | null
  tab: string | null
  status: string
  updated_at: string
  amos_daily_exposure: DailyExposure[]
}

function getShortCode(hwaseonUrl: string | null): string | null {
  if (!hwaseonUrl) return null
  try {
    const u = new URL(hwaseonUrl)
    return u.pathname.replace('/', '').split('/')[0] || null
  } catch {
    return null
  }
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`px-2 py-0.5 text-xs rounded-full font-semibold ${
      status === '노출중' ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-500'
    }`}>
      {status}
    </span>
  )
}

export default function Home() {
  const [keywords, setKeywords] = useState<Keyword[]>([])
  const [clicks, setClicks] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')

  const fetchKeywords = useCallback(async () => {
    setLoading(true)
    const res = await fetch('/api/keywords')
    const data = await res.json()
    setKeywords(data || [])
    setLoading(false)

    const codes = (data || [])
      .map((k: Keyword) => ({ id: k.id, code: getShortCode(k.hwaseon_url) }))
      .filter((x: { id: string; code: string | null }) => x.code)

    const clickMap: Record<string, number> = {}
    await Promise.all(
      codes.map(async ({ id, code }: { id: string; code: string }) => {
        try {
          const r = await fetch(`/api/clicks?code=${code}`)
          const d = await r.json()
          clickMap[id] = d.totalVisits ?? 0
        } catch { clickMap[id] = 0 }
      })
    )
    setClicks(clickMap)
  }, [])

  useEffect(() => { fetchKeywords() }, [fetchKeywords])

  const filtered = keywords.filter(k =>
    k.keyword.toLowerCase().includes(search.toLowerCase()) ||
    (k.tab || '').toLowerCase().includes(search.toLowerCase())
  )

  const exposed = keywords.filter(k => k.status === '노출중').length

  return (
    <div className="max-w-6xl mx-auto px-4 py-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">AMOS 노출 대시보드</h1>
          <p className="text-sm text-gray-500 mt-1">
            총 {keywords.length}개 키워드 · 노출중 {exposed}개
          </p>
        </div>
        <Link
          href="/admin"
          className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-blue-700 transition-colors"
        >
          어드민 관리
        </Link>
      </div>

      <input
        type="text"
        placeholder="키워드 또는 탭으로 검색..."
        value={search}
        onChange={e => setSearch(e.target.value)}
        className="w-full border border-gray-300 rounded-lg px-4 py-2 mb-4 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <StatCard label="전체 키워드" value={keywords.length} color="blue" />
        <StatCard label="노출중" value={exposed} color="green" />
        <StatCard label="미노출" value={keywords.length - exposed} color="gray" />
        <StatCard label="총 클릭수" value={Object.values(clicks).reduce((a, b) => a + b, 0)} color="purple" />
      </div>

      {loading ? (
        <div className="text-center py-12 text-gray-400">로딩 중...</div>
      ) : (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-600">
              <tr>
                <th className="text-left px-4 py-3 font-medium">키워드</th>
                <th className="text-left px-4 py-3 font-medium">노출탭</th>
                <th className="text-left px-4 py-3 font-medium">상태</th>
                <th className="text-left px-4 py-3 font-medium">마지막 노출일</th>
                <th className="text-right px-4 py-3 font-medium">클릭수</th>
                <th className="text-left px-4 py-3 font-medium">링크</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.map(k => {
                const exposures = k.amos_daily_exposure || []
                const lastExposed = exposures
                  .filter(e => e.is_exposed)
                  .sort((a, b) => b.date.localeCompare(a.date))[0]
                const shortCode = getShortCode(k.hwaseon_url)

                return (
                  <tr key={k.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium text-gray-900">{k.keyword}</td>
                    <td className="px-4 py-3 text-gray-500">{k.tab || '-'}</td>
                    <td className="px-4 py-3"><StatusBadge status={k.status} /></td>
                    <td className="px-4 py-3 text-gray-500">{lastExposed ? lastExposed.date : '-'}</td>
                    <td className="px-4 py-3 text-right">
                      {shortCode && clicks[k.id] !== undefined ? (
                        <span className="font-semibold text-purple-700">{clicks[k.id].toLocaleString()}</span>
                      ) : <span className="text-gray-300">-</span>}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-2">
                        {k.blog_url && (
                          <a href={k.blog_url} target="_blank" rel="noreferrer"
                            className="text-blue-500 hover:underline text-xs">블로그</a>
                        )}
                        {k.hwaseon_url && (
                          <a href={k.hwaseon_url} target="_blank" rel="noreferrer"
                            className="text-purple-500 hover:underline text-xs">단축URL</a>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={6} className="text-center py-8 text-gray-400">
                    {search ? '검색 결과 없음' : '등록된 키워드가 없습니다'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function StatCard({ label, value, color }: { label: string; value: number; color: string }) {
  const colors: Record<string, string> = {
    blue: 'bg-blue-50 text-blue-700',
    green: 'bg-green-50 text-green-700',
    gray: 'bg-gray-50 text-gray-600',
    purple: 'bg-purple-50 text-purple-700',
  }
  return (
    <div className={`rounded-xl p-4 ${colors[color] || colors.gray}`}>
      <div className="text-2xl font-bold">{value.toLocaleString()}</div>
      <div className="text-xs mt-1 opacity-70">{label}</div>
    </div>
  )
}
