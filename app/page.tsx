'use client'
import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts'

interface Exposure { date: string; is_exposed: boolean }
interface Post {
  id: string; keyword: string; product: string | null
  blog_url: string | null; hwaseon_url: string | null
  tab_type: string | null; status: string; brand: string | null
  amos_daily_exposure: Exposure[]
}
interface Capture {
  id: string; batch_id: string; keyword: string; product: string | null
  tab_type: string | null; is_exposed: boolean; image_url: string; created_at: string
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
  // 선택 상태: 제품 선택 vs 키워드 선택 분리
  const [selectedProduct, setSelectedProduct] = useState<string | null>(null)
  const [selectedPost, setSelectedPost] = useState<Post | null>(null)
  const [openBrands, setOpenBrands] = useState<Set<string>>(new Set(['아모스', '아윤체']))
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

  // 3-level: 브랜드 > product > keyword
  const brandProductMap: Record<string, Record<string, Post[]>> = {}
  for (const p of posts) {
    const brand = p.brand || '아모스'
    const product = p.product || '(미분류)'
    if (!brandProductMap[brand]) brandProductMap[brand] = {}
    if (!brandProductMap[brand][product]) brandProductMap[brand][product] = []
    brandProductMap[brand][product].push(p)
  }
  const brandList = Object.keys(brandProductMap).sort()
  // 히트맵용 product별 posts 매핑
  const productMap: Record<string, Post[]> = {}
  for (const p of posts) {
    const key = p.product || '(미분류)'
    if (!productMap[key]) productMap[key] = []
    productMap[key].push(p)
  }

  // 히트맵에 표시할 포스트 결정
  // - 키워드 선택: 해당 키워드만
  // - 제품 선택: 해당 제품 전체
  // - 아무것도 없으면: 노출중만
  const exposedPosts = posts.filter(p => p.status === '노출중')
  const heatmapPosts = selectedPost
    ? [selectedPost]
    : selectedProduct
      ? (productMap[selectedProduct] || [])
      : exposedPosts

  const exposedCount = exposedPosts.length
  const avgDays = posts.length === 0 ? 0 :
    Math.round(posts.reduce((a, p) => a + (p.amos_daily_exposure || []).filter(e => e.is_exposed).length, 0) / posts.length)
  const totalClicks = Object.values(clicks).reduce((a, b) => a + b, 0)

  function inRange(e: Exposure) { return e.is_exposed && e.date >= range.start && e.date <= range.end }

  // 선택된 키워드 도표 데이터 (일별 노출 bar chart)
  const chartData = selectedPost ? days.map(d => {
    const exposed = (selectedPost.amos_daily_exposure || []).some(e => e.date === d && e.is_exposed)
    return { date: d.slice(5), exposed: exposed ? 1 : 0 }
  }) : []

  // 제품 클릭 핸들러
  function handleProductClick(product: string, brand: string) {
    const key = `${brand}/${product}`
    const next = new Set(openProducts)
    if (next.has(key)) { next.delete(key) } else { next.add(key) }
    setOpenProducts(next)
    setSelectedProduct(prev => prev === product ? null : product)
    setSelectedPost(null)
  }

  // 키워드 클릭 핸들러 (사이드바 또는 히트맵 행)
  function handleKeywordClick(p: Post) {
    if (selectedPost?.id === p.id) {
      setSelectedPost(null)
    } else {
      setSelectedPost(p)
      setSelectedProduct(p.product)
    }
  }

  const batches = Array.from(new Set(captures.map(c => c.batch_id))).sort((a, b) => b.localeCompare(a))
  const activeBatch = capBatch || batches[0] || ''
  const filteredCaps = captures.filter(c => c.batch_id === activeBatch)

  const heatmapLabel = selectedPost
    ? selectedPost.keyword
    : selectedProduct
      ? selectedProduct
      : '노출중'

  return (
    <div className="flex h-screen flex-col">
      {/* 헤더 */}
      <header className="flex items-center justify-between border-b border-gray-200 bg-white px-4 py-3">
        <h1 className="text-base font-bold text-gray-800">AMOS 블로그 노출 현황 대시보드</h1>
        <Link href="/admin" className="rounded border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-100">관리자</Link>
      </header>

      {/* 탭 바 */}
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
                  {/* Brand level - 동적 브랜드 */}
                  {brandList.map(brand => {
                    const isBrandOpen = openBrands.has(brand)
                    const brandProducts = Object.keys(brandProductMap[brand]).sort()
                    const brandCount = brandProducts.reduce((a, p) => a + brandProductMap[brand][p].length, 0)
                    return (
                      <div key={brand}>
                        <button
                          onClick={() => {
                            const next = new Set(openBrands)
                            if (next.has(brand)) { next.delete(brand) } else { next.add(brand) }
                            setOpenBrands(next)
                          }}
                          className="flex w-full items-center gap-1 px-2 py-1.5 font-bold text-gray-800 hover:bg-gray-100">
                          <span className="text-gray-500 text-[11px]">{isBrandOpen ? '▼' : '▶'}</span>
                          <span>{brand}</span>
                          <span className="ml-auto text-gray-400 text-xs font-normal">{brandCount}</span>
                        </button>
                        {isBrandOpen && brandProducts.map(product => {
                          const isOpen = openProducts.has(`${brand}/${product}`)
                          const isSelected = selectedProduct === product
                          const productPosts = brandProductMap[brand][product]
                          return (
                            <div key={product}>
                              <button
                                onClick={() => handleProductClick(product, brand)}
                                className={`flex w-full items-center gap-1 pl-4 pr-2 py-1.5 hover:bg-gray-50 ${isSelected ? 'bg-blue-50' : ''}`}>
                                <span className="text-gray-400 text-[10px]">{isOpen ? '▼' : '▶'}</span>
                                <span className={`truncate text-xs font-medium ${isSelected ? 'text-blue-700' : 'text-gray-700'}`}>{product}</span>
                                <span className="ml-auto text-gray-300 text-[10px]">{productPosts.length}</span>
                              </button>
                              {isOpen && productPosts.map(p => (
                                <button key={p.id}
                                  onClick={() => handleKeywordClick(p)}
                                  className={`flex w-full items-center gap-1.5 pl-7 pr-2 py-1.5 text-xs transition-colors ${selectedPost?.id === p.id ? 'bg-blue-50 text-blue-700' : 'text-gray-600 hover:bg-gray-50'}`}>
                                  <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${p.status === '노출중' ? 'bg-green-500' : p.status === '종료' ? 'bg-red-300' : 'bg-gray-300'}`} />
                                  <span className="truncate">{p.keyword}</span>
                                </button>
                              ))}
                            </div>
                          )
                        })}
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
                데일리 노출 현황 ({heatmapLabel})
              </h2>
              {loading ? (
                <div className="text-sm text-gray-400 py-2">로딩 중...</div>
              ) : (
                <div className="overflow-x-auto">
                  <div className="inline-block min-w-full">
                    {/* 날짜 헤더 */}
                    <div className="flex gap-0.5 mb-1">
                      <div className="w-36 flex-shrink-0" />
                      {days.map(d => (
                        <div key={d} className="w-5 flex-shrink-0 text-center text-gray-400" style={{ fontSize: '9px' }}>
                          {d.slice(8)}
                        </div>
                      ))}
                    </div>
                    {/* 키워드 행 - 클릭 시 도표 표시 */}
                    {heatmapPosts.map(p => {
                      const expSet = new Set((p.amos_daily_exposure || []).filter(e => inRange(e)).map(e => e.date))
                      const isSelected = selectedPost?.id === p.id
                      return (
                        <div key={p.id}
                          onClick={() => handleKeywordClick(p)}
                          className={`flex items-center gap-0.5 mb-0.5 cursor-pointer rounded-sm ${isSelected ? 'bg-blue-50' : 'hover:bg-gray-50'}`}>
                          <div className={`w-36 flex-shrink-0 text-xs truncate pr-2 ${isSelected ? 'text-blue-700 font-medium' : 'text-gray-600'}`}>{p.keyword}</div>
                          {days.map(d => (
                            <div key={d} title={`${p.keyword} ${d}`}
                              className={`w-5 h-4 rounded-sm flex-shrink-0 ${expSet.has(d) ? 'bg-green-500' : 'bg-gray-100'}`} />
                          ))}
                        </div>
                      )
                    })}
                    {heatmapPosts.length === 0 && exposedPosts.length === 0 && posts.length > 0 && (
                      <div className="text-sm text-gray-400 py-2">노출중인 키워드가 없습니다.</div>
                    )}
                    {posts.length === 0 && (
                      <div className="text-sm text-gray-400 py-2">데이터가 없습니다. 관리자 페이지에서 Excel을 임포트하세요.</div>
                    )}
                  </div>
                </div>
              )}
              {!loading && (
                <div className="flex gap-3 mt-2 text-xs text-gray-400">
                  <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-green-500 inline-block" /> 노출</span>
                  <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-gray-100 border border-gray-200 inline-block" /> 미노출</span>
                  <span className="text-gray-300">· 행 클릭 시 상세 도표</span>
                </div>
              )}
            </div>

            {/* 키워드 선택 시 도표 */}
            {!selectedPost ? (
              <div className="text-sm text-gray-400 text-center py-4">
                좌측에서 키워드를 선택하면 방문자수 차트가 표시됩니다.
              </div>
            ) : (
              <div className="bg-white rounded-xl border border-gray-200 p-4">
                {/* 키워드 정보 */}
                <div className="flex items-center gap-3 mb-4">
                  <h3 className="font-semibold text-gray-800 text-base">{selectedPost.keyword}</h3>
                  <span className={`px-2 py-0.5 text-xs rounded-full font-semibold ${selectedPost.status === '노출중' ? 'bg-green-100 text-green-700' : selectedPost.status === '종료' ? 'bg-red-50 text-red-500' : 'bg-gray-100 text-gray-500'}`}>
                    {selectedPost.status}
                  </span>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm mb-5">
                  <div><span className="text-gray-400 text-xs block">제품</span>{selectedPost.product || '-'}</div>
                  <div><span className="text-gray-400 text-xs block">노출탭</span>{selectedPost.tab_type || '-'}</div>
                  <div><span className="text-gray-400 text-xs block">노출일수</span>{(selectedPost.amos_daily_exposure || []).filter(e => e.is_exposed).length}일</div>
                  <div><span className="text-gray-400 text-xs block">총 클릭수</span>{clicks[selectedPost.id] != null ? clicks[selectedPost.id].toLocaleString() : '-'}</div>
                </div>

                {/* 일별 노출 도표 */}
                <h4 className="text-xs font-semibold text-gray-500 mb-2">일별 노출 현황</h4>
                <ResponsiveContainer width="100%" height={120}>
                  <BarChart data={chartData} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                    <XAxis dataKey="date" tick={{ fontSize: 9 }} interval={Math.floor(chartData.length / 10)} />
                    <YAxis hide domain={[0, 1]} />
                    <Tooltip
                      formatter={(v) => [v === 1 ? '노출' : '미노출', '']}
                      labelFormatter={(l) => `날짜: ${l}`}
                    />
                    <Bar dataKey="exposed" radius={[2, 2, 0, 0]}>
                      {chartData.map((entry, i) => (
                        <Cell key={i} fill={entry.exposed ? '#22c55e' : '#e5e7eb'} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>

                {/* URL 링크 */}
                <div className="flex gap-3 flex-wrap mt-3">
                  {selectedPost.blog_url && (
                    <a href={selectedPost.blog_url} target="_blank" rel="noreferrer" className="text-blue-500 text-xs hover:underline truncate">
                      발행 URL: {selectedPost.blog_url}
                    </a>
                  )}
                  {selectedPost.hwaseon_url && (
                    <a href={selectedPost.hwaseon_url} target="_blank" rel="noreferrer" className="text-purple-500 text-xs hover:underline truncate">
                      제품링크: {selectedPost.hwaseon_url}
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
                    {c.tab_type && (
                      <span className={`mt-1 inline-block text-xs px-1.5 py-0.5 rounded ${c.is_exposed ? 'bg-green-100 text-green-700' : 'bg-orange-50 text-orange-600'}`}>{c.tab_type}</span>
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
