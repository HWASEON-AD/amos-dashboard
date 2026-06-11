'use client'
import { useEffect, useState, useCallback } from 'react'

interface Exposure { date: string; is_exposed: boolean }
interface Keyword {
  id: string; keyword: string; product: string | null
  blog_url: string | null; hwaseon_url: string | null
  tab: string | null; status: string
  amos_daily_exposure: Exposure[]
}

function getCode(url: string | null) {
  if (!url) return null
  try { return new URL(url).pathname.replace('/', '').split('/')[0] || null } catch { return null }
}

function Badge({ status }: { status: string }) {
  const map: Record<string, string> = {
    '노출중': 'bg-green-100 text-green-700',
    '미노출': 'bg-gray-100 text-gray-500',
    '종료': 'bg-red-50 text-red-500',
  }
  return <span className={`px-2 py-0.5 text-xs rounded-full font-semibold ${map[status] || 'bg-gray-100 text-gray-400'}`}>{status || '-'}</span>
}

// 최근 30일 히트맵
function Heatmap({ keywords }: { keywords: Keyword[] }) {
  const days = Array.from({ length: 30 }, (_, i) => {
    const d = new Date(); d.setDate(d.getDate() - (29 - i))
    return d.toISOString().slice(0, 10)
  })
  const exposedSet = new Set(
    keywords.flatMap(k => (k.amos_daily_exposure || []).filter(e => e.is_exposed).map(e => e.date))
  )
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 mb-6">
      <div className="text-sm font-semibold text-gray-700 mb-3">노출 히트맵 (최근 30일)</div>
      <div className="flex gap-1 flex-wrap">
        {days.map(d => (
          <div key={d} title={d}
            className={`w-6 h-6 rounded text-xs flex items-center justify-center ${exposedSet.has(d) ? 'bg-green-500' : 'bg-gray-100'}`} />
        ))}
      </div>
      <div className="flex gap-3 mt-2 text-xs text-gray-400">
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-green-500 inline-block" /> 노출</span>
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-gray-200 inline-block" /> 미노출</span>
      </div>
    </div>
  )
}

export default function Home() {
  const [keywords, setKeywords] = useState<Keyword[]>([])
  const [clicks, setClicks] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    const r = await fetch('/api/keywords')
    const data = await r.json()
    setKeywords(Array.isArray(data) ? data : [])
    setLoading(false)

    const codes = (Array.isArray(data) ? data : []).map((k: Keyword) => ({ id: k.id, code: getCode(k.hwaseon_url) })).filter((x): x is { id: string; code: string } => !!x.code)
    const map: Record<string, number> = {}
    await Promise.all(codes.map(async ({ id, code }) => {
      try { const r = await fetch(`/api/clicks?code=${code}`); const d = await r.json(); map[id] = d.totalVisits ?? 0 } catch { map[id] = 0 }
    }))
    setClicks(map)
  }, [])

  useEffect(() => { load() }, [load])

  const filtered = keywords.filter(k =>
    k.keyword.toLowerCase().includes(search.toLowerCase()) ||
    (k.product || '').toLowerCase().includes(search.toLowerCase())
  )
  const exposed = keywords.filter(k => k.status === '노출중').length
  const totalClicks = Object.values(clicks).reduce((a, b) => a + b, 0)

  return (
    <div className="max-w-7xl mx-auto px-4 py-6">
      {/* KPI */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        {[
          { label: '전체 키워드', val: keywords.length, color: 'bg-blue-50 text-blue-700' },
          { label: '노출중', val: exposed, color: 'bg-green-50 text-green-700' },
          { label: '미노출', val: keywords.length - exposed, color: 'bg-gray-50 text-gray-600' },
          { label: '총 클릭수', val: totalClicks, color: 'bg-purple-50 text-purple-700' },
        ].map(c => (
          <div key={c.label} className={`rounded-xl p-4 ${c.color}`}>
            <div className="text-2xl font-bold">{c.val.toLocaleString()}</div>
            <div className="text-xs mt-1 opacity-70">{c.label}</div>
          </div>
        ))}
      </div>

      <Heatmap keywords={keywords} />

      <input value={search} onChange={e => setSearch(e.target.value)}
        placeholder="제품명, 키워드 검색..."
        className="w-full border border-gray-300 rounded-lg px-4 py-2 mb-4 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />

      {loading ? (
        <div className="text-center py-16 text-gray-400">로딩 중...</div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
          <table className="w-full text-sm min-w-[860px]">
            <thead className="bg-gray-50 text-gray-500 text-xs">
              <tr>
                {['상태','제품','키워드','노출탭','발행URL','제품링크URL','마지막 노출일','클릭수'].map(h => (
                  <th key={h} className="text-left px-3 py-3 font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.map(k => {
                const last = [...(k.amos_daily_exposure || [])].filter(e => e.is_exposed).sort((a,b) => b.date.localeCompare(a.date))[0]
                const code = getCode(k.hwaseon_url)
                return (
                  <tr key={k.id} className="hover:bg-gray-50">
                    <td className="px-3 py-3"><Badge status={k.status} /></td>
                    <td className="px-3 py-3 text-gray-700 text-xs">{k.product || '-'}</td>
                    <td className="px-3 py-3 font-medium text-gray-900">{k.keyword}</td>
                    <td className="px-3 py-3 text-gray-500 text-xs">{k.tab || '-'}</td>
                    <td className="px-3 py-3 max-w-[150px]">
                      {k.blog_url ? <a href={k.blog_url} target="_blank" rel="noreferrer" className="text-blue-500 hover:underline text-xs truncate block max-w-[140px]">{k.blog_url}</a> : <span className="text-gray-300 text-xs">-</span>}
                    </td>
                    <td className="px-3 py-3 max-w-[140px]">
                      {k.hwaseon_url ? <a href={k.hwaseon_url} target="_blank" rel="noreferrer" className="text-purple-500 hover:underline text-xs truncate block max-w-[130px]">{k.hwaseon_url}</a> : <span className="text-gray-300 text-xs">-</span>}
                    </td>
                    <td className="px-3 py-3 text-gray-400 text-xs">{last?.date || '-'}</td>
                    <td className="px-3 py-3 text-right">
                      {code && clicks[k.id] != null ? <span className="font-semibold text-purple-700">{clicks[k.id].toLocaleString()}</span> : <span className="text-gray-300">-</span>}
                    </td>
                  </tr>
                )
              })}
              {filtered.length === 0 && (
                <tr><td colSpan={8} className="text-center py-10 text-gray-400">데이터 없음</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
