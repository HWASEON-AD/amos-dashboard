'use client'
import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'

interface Exposure { date: string; is_exposed: boolean }
interface Post {
  id: string; keyword: string; product: string | null
  blog_url: string | null; hwaseon_url: string | null
  tab: string | null; status: string
  amos_daily_exposure: Exposure[]
}
interface Capture {
  id: string; batch_id: string; keyword: string; product: string | null
  tab: string | null; is_exposed: boolean; image_url: string; created_at: string
}

function getCode(url: string | null) {
  if (!url) return null
  try { return new URL(url).pathname.split('/').filter(Boolean)[0] || null } catch { return null }
}

function toStr(d: Date) { return d.toISOString().slice(0, 10) }

function calcRange(mode: string): { start: string; end: string } {
  const today = new Date()
  const end = toStr(today)
  if (mode === '7d') { const s = new Date(today); s.setDate(s.getDate() - 6); return { start: toStr(s), end } }
  if (mode === '30d') { const s = new Date(today); s.setDate(s.getDate() - 29); return { start: toStr(s), end } }
  if (mode === '90d') { const s = new Date(today); s.setDate(s.getDate() - 89); return { start: toStr(s), end } }
  return { start: '2020-01-01', end }
}

function daysIn(start: string, end: string): string[] {
  const days: string[] = []; const cur = new Date(start); const endD = new Date(end)
  while (cur <= endD) { days.push(toStr(cur)); cur.setDate(cur.getDate() + 1) }
  return days
}

function batchLabel(id: string) {
  const [date, slot] = id.split('_')
  const m: Record<string, string> = { morning: '오전', afternoon: '오후', evening: '저녁' }
  return `${date?.slice(0,4)}-${date?.slice(4,6)}-${date?.slice(6,8)} ${m[slot] || slot || ''}`
}

export default function Home() {
  const [activeTab, setActiveTab] = useState<'exposure' | 'captures'>('exposure')
  const [posts, setPosts] = useState<Post[]>([])
  const [captures, setCaptures] = useState<Capture[]>([])
  const [loading, setLoading] = useState(true)
  const [capLoading, setCapLoading] = useState(false)
  const [selected, setSelected] = useState<Post | null>(null)
  // 3-level sidebar: brand always open, products closed by default
  const [brandOpen, setBrandOpen] = useState(true)
  const [openProducts, setOpenProducts] = useState<Set<string>>(new Set())
  const [rangeMode, setRangeMode] = useState('30d')
  const [customStart, setCustomStart] = useState(toStr(new Date(Date.now() - 29 * 86400000)))
  const [customEnd, setCustomEnd] = useState(toStr(new Date()))
  const [clicks, setClicks] = useState<Record<string, number>>({})
  const [capBatch, setCapBatch] = useState('')
  const [capPreview, setCapPreview] = useState<string | null>(null)

  const range = rangeMode === 'custom' ? { start: customStart, end: customEnd } : calcRange(rangeMode)
  const days = daysIn(range.start, range.end)

  const load = useCallback(async () => {
    setLoading(true)
    const r = await fetch('/api/keywords')
    const data = await r.json()
    const list: Post[] = Array.isArray(data) ? data : []
    setPosts(list)
    setLoading(false)
    const codes = list.map(p => ({ id: p.id, code: getCode(p.hwaseon_url) })).filter((x): x is { id: string; code: string } => !!x.code)
    const map: Record<string, number> = {}
    await Promise.all(codes.map(async ({ id, code }) => {
      try { const res = await fetch(`/api/clicks?code=${code}`); const d = await res.json(); map[id] = d.totalVisits ?? 0 } catch { map[id] = 0 }
    }))
    setClicks(map)
  }, [])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (activeTab !== 'captures' || captures.length > 0) return
    setCapLoading(true)
    fetch('/api/ayunche-captures').then(r => r.json()).then(d => {
      const list = Array.isArray(d) ? d : []
      setCaptures(list)
      if (list.length > 0) setCapBatch(list.sort((a: Capture, b: Capture) => b.batch_id.localeCompare(a.batch_id))[0].batch_id)
    }).finally(() => setCapLoading(false))
  }, [activeTab, captures.length])

  // 3-level: 아모스 > product > keyword
  const productMap: Record<string, Post[]> = {}
  for (const p of posts) {
    const key = p.product || '(미분류)'
    if (!productMap[key]) productMap[key] = []
    productMap[key].push(p)
  }
  const products = Object.keys(productMap).sort()

  const exposedCount = posts.filter(p => p.status === '노출중').length
  const avgDays = posts.length === 0 ? 0 :
    Math.round(posts.reduce((a, p) => a + (p.amos_daily_exposure || []).filter(e => e.is_exposed).length, 0) / posts.length)
  const totalClicks = Object.values(clicks).reduce((a, b) => a + b, 0)

  function inRange(e: Exposure) { return e.is_exposed && e.date >= range.start && e.date <= range.end }

  const batches = Array.from(new Set(captures.map(c => c.batch_id))).sort((a, b) => b.localeCompare(a))
  const activeBatch = capBatch || batches[0] || ''
  const filteredCaps = captures.filter(c => c.batch_id === activeBatch)

  return (
    <div className="flex h-screen flex-col">
      {/* 헤더 - 원본 CSS 클래스 */}
      <header className="flex items-center justify-between border-b border-gray-200 bg-white px-4 py-3">
        <h1 className="text-base font-bold text-gray-800">AMOS 블로그 노출 현황 대시보드</h1>
        <Link href="/admin" className="rounded border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-100">관리자</Link>
      </header>

      {/* 탭 바 - 원본 CSS 클래스 */}
      <div className="bg-white border-b border-gray-200 px-2 flex">
        {([['exposure','노출현황'],['captures','캡처']] as const).map(([t, l]) => (
          <button key={t} onClick={() => setActiveTab(t)}
            className={activeTab === t
              ? 'px-4 py-2.5 text-sm font-medium border-b-2 border-blue-600 text-blue-600'
              : 'px-4 py-2.5 text-sm font-medium text-gray-500 hover:text-gray-700'}>
            {l}
          </button>
        ))}
      </div>

      {activeTab === 'exposure' ? (
        <div className="flex flex-1 overflow-hidden">
          {/* 사이드바 - 3레벨: 아모스 > 제품 > 키워드 */}
          <aside className="w-52 bg-white border-r border-gray-200 flex flex-col flex-shrink-0">
            <div className="overflow-y-auto text-sm flex-1">
              {loading ? (
                <div className="px-3 py-3 text-gray-400">불러오는 중...</div>
              ) : (
                <>
                  {/* Brand level - 아모스 */}
                  <button
                    onClick={() => setBrandOpen(o => !o)}
                    className="flex w-full items-center gap-1 px-2 py-1.5 font-bold text-gray-800 hover:bg-gray-100">
                    <span className="text-gray-500 text-[11px]">{brandOpen ? '▼' : '▶'}</span>
                    <span>아모스</span>
                    <span className="ml-auto text-gray-400 text-xs font-normal">{posts.length}</span>
                  </button>
                  {brandOpen && products.map(product => {
                    const isOpen = openProducts.has(product)
                    return (
                      <div key={product}>
                        {/* Product level */}
                        <button
                          onClick={() => {
                            const next = new Set(openProducts)
                            if (next.has(product)) { next.delete(product) } else { next.add(product) }
                            setOpenProducts(next)
                          }}
                          className="flex w-full items-center gap-1 pl-4 pr-2 py-1.5 text-gray-700 hover:bg-gray-50">
                          <span className="text-gray-400 text-[10px]">{isOpen ? '▼' : '▶'}</span>
                          <span className="truncate text-xs font-medium">{product}</span>
                          <span className="ml-auto text-gray-300 text-[10px]">{productMap[product].length}</span>
                        </button>
                        {/* Keyword level */}
                        {isOpen && productMap[product].map(p => (
                          <button key={p.id}
                            onClick={() => setSelected(selected?.id === p.id ? null : p)}
                            className={`flex w-full items-center gap-1.5 pl-7 pr-2 py-1.5 text-xs transition-colors ${selected?.id === p.id ? 'bg-blue-50 text-blue-700' : 'text-gray-600 hover:bg-gray-50'}`}>
                            <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${p.status === '노출중' ? 'bg-green-500' : p.status === '종료' ? 'bg-red-300' : 'bg-gray-300'}`} />
                            <span className="truncate">{p.keyword}</span>
                          </button>
                        ))}
                      </div>
                    )
                  })}
                  {posts.length === 0 && (
                    <div className="px-3 py-4 text-xs text-gray-400">데이터가 없습니다. 관리자 페이지에서 Excel을 임포트하세요.</div>
                  )}
                </>
              )}
            </div>
          </aside>

          {/* 메인 영역 */}
          <main className="flex-1 overflow-y-auto p-5 min-w-0 bg-gray-50">
            {/* 날짜 컨트롤 */}
            <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
              <div className="flex items-center gap-2 flex-wrap">
                <div className="flex items-center gap-1">
                  <input type="date" value={range.start}
                    onChange={e => { setRangeMode('custom'); setCustomStart(e.target.value) }}
                    className="border border-gray-300 rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400" />
                  <span className="text-gray-400 text-sm">~</span>
                  <input type="date" value={range.end}
                    onChange={e => { setRangeMode('custom'); setCustomEnd(e.target.value) }}
                    className="border border-gray-300 rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400" />
                </div>
                <div className="flex gap-1">
                  {[['7d','최근 7일'],['30d','최근 30일'],['90d','최근 90일'],['all','전체']].map(([m,l]) => (
                    <button key={m} onClick={() => setRangeMode(m)}
                      className={`px-2.5 py-1 text-xs rounded transition-colors ${rangeMode === m ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
                      {l}
                    </button>
                  ))}
                </div>
              </div>
              <a href={`/api/export-excel?start=${range.start}&end=${range.end}`}
                className="px-3 py-1.5 text-xs bg-green-600 text-white rounded hover:bg-green-700 transition-colors">
                Excel 다운로드
              </a>
            </div>

            {/* KPI */}
            <div className="grid grid-cols-4 gap-3 mb-5">
              {[
                { label: '전체 키워드', val: `${posts.length}개`, cls: 'bg-blue-50 text-blue-700' },
                { label: '노출중 키워드', val: `${exposedCount}개`, cls: 'bg-green-50 text-green-700' },
                { label: '평균 노출일수', val: `${avgDays}일`, cls: 'bg-yellow-50 text-yellow-700' },
                { label: '총 방문자수', val: totalClicks > 0 ? totalClicks.toLocaleString() : '-', cls: 'bg-purple-50 text-purple-700' },
              ].map(c => (
                <div key={c.label} className={`rounded-lg p-3 ${c.cls}`}>
                  <div className="text-xs opacity-70 mb-1">{c.label}</div>
                  <div className="text-xl font-bold">{c.val}</div>
                </div>
              ))}
            </div>

            {/* 히트맵 */}
            <div className="bg-white rounded-xl border border-gray-200 p-4 mb-4">
              <h2 className="text-sm font-semibold text-gray-700 mb-3">
                데일리 노출 현황 {selected ? `(${selected.keyword})` : '(전체)'}
              </h2>
              {loading ? (
                <div className="text-sm text-gray-400 py-2">노출 데이터 로딩 중...</div>
              ) : (
                <div className="overflow-x-auto">
                  <div className="inline-block min-w-full">
                    <div className="flex gap-0.5 mb-1">
                      <div className="w-36 flex-shrink-0" />
                      {days.map(d => (
                        <div key={d} className="w-5 flex-shrink-0 text-center text-gray-400" style={{ fontSize: '9px' }}>
                          {d.slice(8)}
                        </div>
                      ))}
                    </div>
                    {(selected ? [selected] : posts).map(p => {
                      const expSet = new Set((p.amos_daily_exposure || []).filter(e => inRange(e)).map(e => e.date))
                      return (
                        <div key={p.id} className="flex items-center gap-0.5 mb-0.5">
                          <div className="w-36 flex-shrink-0 text-xs text-gray-600 truncate pr-2">{p.keyword}</div>
                          {days.map(d => (
                            <div key={d} title={`${p.keyword} ${d}`}
                              className={`w-5 h-4 rounded-sm flex-shrink-0 ${expSet.has(d) ? 'bg-green-500' : 'bg-gray-100'}`} />
                          ))}
                        </div>
                      )
                    })}
                    {posts.length === 0 && <div className="text-sm text-gray-400">데이터가 없습니다. 관리자 페이지에서 Excel을 임포트하세요.</div>}
                  </div>
                </div>
              )}
              {!loading && (
                <div className="flex gap-3 mt-2 text-xs text-gray-400">
                  <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-green-500 inline-block" /> 노출</span>
                  <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-gray-100 border border-gray-200 inline-block" /> 미노출</span>
                </div>
              )}
            </div>

            {/* 선택 키워드 상세 */}
            {!selected ? (
              <div className="text-sm text-gray-400 text-center py-4">
                좌측에서 키워드를 선택하면 방문자수 차트가 표시됩니다.
              </div>
            ) : (
              <div className="bg-white rounded-xl border border-gray-200 p-4">
                <div className="flex items-center gap-3 mb-3">
                  <h3 className="font-semibold text-gray-800 text-base">{selected.keyword}</h3>
                  <span className={`px-2 py-0.5 text-xs rounded-full font-semibold ${selected.status === '노출중' ? 'bg-green-100 text-green-700' : selected.status === '종료' ? 'bg-red-50 text-red-500' : 'bg-gray-100 text-gray-500'}`}>
                    {selected.status}
                  </span>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm mb-3">
                  <div><span className="text-gray-400 text-xs block">제품</span>{selected.product || '-'}</div>
                  <div><span className="text-gray-400 text-xs block">노출탭</span>{selected.tab || '-'}</div>
                  <div><span className="text-gray-400 text-xs block">노출일수</span>{(selected.amos_daily_exposure || []).filter(e => e.is_exposed).length}일</div>
                  <div><span className="text-gray-400 text-xs block">총 클릭수</span>{clicks[selected.id] != null ? clicks[selected.id].toLocaleString() : '-'}</div>
                </div>
                <div className="flex gap-3 flex-wrap">
                  {selected.blog_url && (
                    <a href={selected.blog_url} target="_blank" rel="noreferrer" className="text-blue-500 text-xs hover:underline truncate">
                      발행 URL: {selected.blog_url}
                    </a>
                  )}
                  {selected.hwaseon_url && (
                    <a href={selected.hwaseon_url} target="_blank" rel="noreferrer" className="text-purple-500 text-xs hover:underline truncate">
                      제품링크: {selected.hwaseon_url}
                    </a>
                  )}
                </div>
              </div>
            )}
          </main>
        </div>
      ) : (
        /* 캡처 탭 */
        <div className="flex-1 overflow-y-auto p-5 bg-gray-50">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-bold text-gray-900">아윤채 캡처</h2>
            <select value={activeBatch} onChange={e => setCapBatch(e.target.value)}
              className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none">
              {batches.map(b => <option key={b} value={b}>{batchLabel(b)}</option>)}
            </select>
          </div>
          {capLoading ? (
            <div className="text-center py-20 text-gray-400">로딩 중...</div>
          ) : filteredCaps.length === 0 ? (
            <div className="text-center py-20 text-gray-400">캡처 데이터 없음</div>
          ) : (
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-7 gap-3">
              {filteredCaps.map(c => (
                <div key={c.id} onClick={() => setCapPreview(c.image_url)}
                  className="bg-white rounded-xl border border-gray-200 overflow-hidden cursor-pointer hover:shadow-md transition-shadow">
                  <img src={c.image_url} alt={c.keyword} className="w-full aspect-[9/16] object-cover" loading="lazy" />
                  <div className="p-2">
                    <div className="text-xs font-medium text-gray-800 truncate">{c.keyword}</div>
                    {c.product && <div className="text-xs text-gray-500 truncate">{c.product}</div>}
                    {c.tab && (
                      <span className={`mt-1 inline-block text-xs px-1.5 py-0.5 rounded ${c.is_exposed ? 'bg-green-100 text-green-700' : 'bg-orange-50 text-orange-600'}`}>{c.tab}</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
          {capPreview && (
            <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center" onClick={() => setCapPreview(null)}>
              <img src={capPreview} alt="preview" className="max-h-[90vh] max-w-[90vw] rounded-xl object-contain" />
            </div>
          )}
        </div>
      )}
    </div>
  )
}
