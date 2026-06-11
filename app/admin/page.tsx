'use client'
import { useEffect, useState, useRef, useCallback } from 'react'
import * as XLSX from 'xlsx'

interface Exposure { date: string; is_exposed: boolean }
interface Keyword {
  id: string; keyword: string; product: string | null
  blog_url: string | null; hwaseon_url: string | null
  tab: string | null; status: string
  amos_daily_exposure: Exposure[]
}

const STATUSES = ['미노출', '노출중', '종료', '진행X']

function getCode(url: string | null) {
  if (!url) return null
  try { return new URL(url).pathname.split('/').filter(Boolean)[0] || null } catch { return null }
}

function parsePaste(raw: string) {
  return raw.split('\n').map(l => l.trim()).filter(Boolean).map(l => {
    const c = l.split('\t')
    return { product: c[0]?.trim() || '', keyword: c[1]?.trim() || c[0]?.trim() || '', tab: c[2]?.trim() || '', blog_url: c[3]?.trim() || '', hwaseon_url: c[4]?.trim() || '' }
  }).filter(r => r.keyword)
}

function parseXlsx(buf: ArrayBuffer) {
  const wb = XLSX.read(buf, { type: 'array' })
  const ws = wb.Sheets[wb.SheetNames[0]]
  const rows: string[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' })
  const hi = rows.findIndex(r => r.some(c => ['키워드', '검색어'].includes(String(c).trim())))
  const dataRows = hi >= 0 ? rows.slice(hi + 1) : rows.slice(1)
  const headers = (hi >= 0 ? rows[hi] : ['제품', '키워드', '탭', '발행URL', '단축URL']).map(c => String(c).toLowerCase())
  const ci = {
    product: headers.findIndex(h => ['제품', 'product', '상품'].some(k => h.includes(k))),
    keyword: headers.findIndex(h => ['키워드', '검색어', 'keyword'].some(k => h.includes(k))),
    tab: headers.findIndex(h => ['탭', 'tab', '노출'].some(k => h.includes(k))),
    blog_url: headers.findIndex(h => ['발행', 'blog'].some(k => h.includes(k)) && !h.includes('hwaseon') && !h.includes('제품')),
    hwaseon_url: headers.findIndex(h => ['hwaseon', '단축', '제품링크'].some(k => h.includes(k))),
  }
  return dataRows.filter(r => r.some(c => c !== '')).map(r => ({
    product: String(r[ci.product >= 0 ? ci.product : 0] ?? '').trim(),
    keyword: String(r[ci.keyword >= 0 ? ci.keyword : 1] ?? '').trim(),
    tab: String(r[ci.tab >= 0 ? ci.tab : 2] ?? '').trim(),
    blog_url: String(r[ci.blog_url >= 0 ? ci.blog_url : 3] ?? '').trim(),
    hwaseon_url: String(r[ci.hwaseon_url >= 0 ? ci.hwaseon_url : 4] ?? '').trim(),
  })).filter(r => r.keyword)
}

export default function AdminPage() {
  const [rows, setRows] = useState<Keyword[]>([])
  const [loading, setLoading] = useState(true)
  const [editId, setEditId] = useState<string | null>(null)
  const [edit, setEdit] = useState({ keyword: '', product: '', blog_url: '', hwaseon_url: '', tab: '', status: '' })
  const [newRow, setNew] = useState({ keyword: '', product: '', blog_url: '', hwaseon_url: '', tab: '' })
  const [pasteText, setPaste] = useState('')
  const [pasteMode, setPasteMode] = useState(false)
  const [showImport, setShowImport] = useState(false)
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null)
  const [importing, setImporting] = useState(false)
  const [clicks, setClicks] = useState<Record<string, number>>({})
  const [urlFilter, setUrlFilter] = useState('전체')
  const [productFilter, setProductFilter] = useState('제품 전체')
  const fileRef = useRef<HTMLInputElement>(null)

  const flash = (text: string, ok: boolean) => { setMsg({ text, ok }); setTimeout(() => setMsg(null), 3000) }

  const load = useCallback(async () => {
    setLoading(true)
    const r = await fetch('/api/keywords')
    const d = await r.json()
    const list: Keyword[] = Array.isArray(d) ? d : []
    setRows(list)
    setLoading(false)
    // 클릭수 조회
    const codes = list.map(p => ({ id: p.id, code: getCode(p.hwaseon_url) })).filter((x): x is { id: string; code: string } => !!x.code)
    const map: Record<string, number> = {}
    await Promise.all(codes.map(async ({ id, code }) => {
      try { const res = await fetch(`/api/clicks?code=${code}`); const j = await res.json(); map[id] = j.totalVisits ?? 0 } catch { map[id] = 0 }
    }))
    setClicks(map)
  }, [])

  useEffect(() => { load() }, [load])

  async function save(id: string) {
    const r = await fetch(`/api/keywords/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(edit) })
    if (r.ok) { setEditId(null); load() } else flash('저장 실패', false)
  }

  async function del(id: string, kw: string) {
    if (!confirm(`"${kw}" 삭제?`)) return
    await fetch(`/api/keywords/${id}`, { method: 'DELETE' })
    load()
  }

  async function add() {
    if (!newRow.keyword.trim()) return flash('키워드 필수', false)
    const r = await fetch('/api/keywords', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(newRow) })
    if (r.ok) { setNew({ keyword: '', product: '', blog_url: '', hwaseon_url: '', tab: '' }); load() } else flash('추가 실패', false)
  }

  async function importRows(data: { keyword: string; product: string; tab: string; blog_url: string; hwaseon_url: string }[]) {
    if (!data.length) return flash('파싱된 데이터 없음', false)
    setImporting(true)
    const r = await fetch('/api/keywords/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rows: data }) })
    const d = await r.json()
    setImporting(false)
    if (r.ok) { flash(`${d.inserted}개 저장 완료`, true); setPaste(''); setShowImport(false); load() }
    else flash(`오류: ${d.error}`, false)
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; if (!file) return
    importRows(parseXlsx(await file.arrayBuffer()))
    if (fileRef.current) fileRef.current.value = ''
  }

  const pastePreview = parsePaste(pasteText)

  const products = Array.from(new Set(rows.map(r => r.product).filter(Boolean) as string[])).sort()

  const filtered = rows.filter(r => {
    if (urlFilter === 'URL 없음' && r.blog_url) return false
    if (urlFilter === 'URL 있음' && !r.blog_url) return false
    if (productFilter !== '제품 전체' && r.product !== productFilter) return false
    return true
  })

  return (
    <div className="min-h-screen bg-gray-50">
      {/* 헤더 */}
      <header className="bg-white border-b border-gray-200 px-6 py-3 flex items-center justify-between shadow-sm">
        <h1 className="text-base font-bold text-gray-900">관리자 패널</h1>
        <div className="flex items-center gap-2">
          <button onClick={() => setShowImport(s => !s)}
            className={`px-3 py-1.5 text-sm rounded transition-colors ${showImport ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}>
            Excel 임포트
          </button>
          <a href="/" className="px-3 py-1.5 text-sm bg-gray-100 text-gray-700 rounded hover:bg-gray-200 transition-colors">대시보드</a>
        </div>
      </header>

      {/* 알림 */}
      {msg && (
        <div className={`fixed top-14 right-4 z-50 px-4 py-2 rounded-lg text-sm font-medium shadow-lg ${msg.ok ? 'bg-green-600 text-white' : 'bg-red-600 text-white'}`}>
          {msg.text}
        </div>
      )}

      <div className="max-w-screen-xl mx-auto px-4 py-5 space-y-5">

        {/* Excel 임포트 패널 */}
        {showImport && (
          <div className="bg-white border border-gray-200 rounded-xl p-5">
            <div className="flex items-center gap-2 mb-3">
              <h2 className="font-semibold text-gray-800">Excel 파일 임포트</h2>
              <span className="text-xs text-gray-400">컬럼 순서: 제품 | 키워드 | 노출탭 | 발행URL | 제품링크URL</span>
            </div>
            <div className="flex gap-2 mb-4">
              <button onClick={() => setPasteMode(false)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium ${!pasteMode ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
                파일 업로드
              </button>
              <button onClick={() => setPasteMode(true)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium ${pasteMode ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
                복붙 (Ctrl+V)
              </button>
            </div>
            {!pasteMode ? (
              <div className="flex items-center gap-3">
                <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" onChange={handleFile}
                  className="text-sm text-gray-600 file:mr-3 file:py-1.5 file:px-4 file:rounded-lg file:border-0 file:text-sm file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100" />
                {importing && <span className="text-sm text-gray-400">저장 중...</span>}
              </div>
            ) : (
              <div>
                <textarea value={pasteText} onChange={e => setPaste(e.target.value)}
                  placeholder={"엑셀에서 복사(Ctrl+C) 후 여기 붙여넣기(Ctrl+V)\n예: 헤어오일\t아모스 헤어오일\t블로그\thttps://blog.naver.com/...\thttps://hwaseon-url.com/abc"}
                  className="w-full border border-gray-300 rounded-lg p-3 text-sm font-mono h-32 resize-y focus:outline-none focus:ring-2 focus:ring-blue-400" />
                <div className="flex items-center gap-3 mt-2">
                  <button onClick={() => importRows(pastePreview)} disabled={importing || !pastePreview.length}
                    className="px-4 py-1.5 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 disabled:opacity-40">
                    {importing ? '저장 중...' : `가져오기 (${pastePreview.length}행)`}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* 키워드 관리 */}
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          {/* 필터 헤더 */}
          <div className="px-4 py-3 bg-gray-50 border-b border-gray-200 flex items-center justify-between flex-wrap gap-2">
            <span className="text-sm font-semibold text-gray-700">키워드 관리</span>
            <div className="flex items-center gap-2">
              <select value={urlFilter} onChange={e => setUrlFilter(e.target.value)}
                className="border border-gray-200 rounded px-2 py-1 text-xs focus:outline-none">
                {['전체', 'URL 없음', 'URL 있음'].map(o => <option key={o} value={o}>{o}</option>)}
              </select>
              <select value={productFilter} onChange={e => setProductFilter(e.target.value)}
                className="border border-gray-200 rounded px-2 py-1 text-xs focus:outline-none">
                <option value="제품 전체">제품 전체</option>
                {products.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
              <span className="text-xs text-gray-400">{filtered.length}건</span>
            </div>
          </div>

          {loading ? (
            <div className="text-center py-16 text-gray-400">로딩 중...</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[1100px]">
                <thead className="bg-gray-50 text-gray-500 text-xs border-b border-gray-100">
                  <tr>
                    <th className="text-left px-3 py-2 w-8">#</th>
                    <th className="text-left px-3 py-2">상태</th>
                    <th className="text-left px-3 py-2">제품</th>
                    <th className="text-left px-3 py-2">키워드</th>
                    <th className="text-left px-3 py-2">노출탭</th>
                    <th className="text-left px-3 py-2">발행URL</th>
                    <th className="text-left px-3 py-2">제품링크URL</th>
                    <th className="text-right px-3 py-2">총 노출일</th>
                    <th className="text-right px-3 py-2">총 클릭수</th>
                    <th className="px-3 py-2 w-20" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {filtered.map((row, i) => {
                    const exposureDays = (row.amos_daily_exposure || []).filter(e => e.is_exposed).length
                    return (
                      <tr key={row.id} className="hover:bg-gray-50">
                        {editId === row.id ? (
                          <>
                            <td className="px-3 py-1.5 text-gray-400 text-xs">{i + 1}</td>
                            <td className="px-2 py-1.5">
                              <select value={edit.status} onChange={e => setEdit(p => ({ ...p, status: e.target.value }))}
                                className="border border-blue-400 rounded px-2 py-1 text-xs w-full">
                                {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                              </select>
                            </td>
                            {(['product', 'keyword'] as const).map(f => (
                              <td key={f} className="px-2 py-1.5">
                                <input value={edit[f]} onChange={e => setEdit(p => ({ ...p, [f]: e.target.value }))}
                                  className="border border-blue-400 rounded px-2 py-1 text-xs w-full min-w-[80px]" />
                              </td>
                            ))}
                            <td className="px-2 py-1.5">
                              <input value={edit.tab} onChange={e => setEdit(p => ({ ...p, tab: e.target.value }))}
                                className="border border-blue-400 rounded px-2 py-1 text-xs w-full min-w-[60px]" />
                            </td>
                            {(['blog_url', 'hwaseon_url'] as const).map(f => (
                              <td key={f} className="px-2 py-1.5">
                                <input value={edit[f]} onChange={e => setEdit(p => ({ ...p, [f]: e.target.value }))}
                                  className="border border-blue-400 rounded px-2 py-1 text-xs w-full min-w-[100px]" />
                              </td>
                            ))}
                            <td className="px-3 py-1.5 text-gray-400 text-xs text-right">-</td>
                            <td className="px-3 py-1.5 text-gray-400 text-xs text-right">-</td>
                            <td className="px-2 py-1.5">
                              <div className="flex gap-1">
                                <button onClick={() => save(row.id)} className="px-2 py-1 bg-blue-600 text-white rounded text-xs hover:bg-blue-700">저장</button>
                                <button onClick={() => setEditId(null)} className="px-2 py-1 bg-gray-200 rounded text-xs hover:bg-gray-300">취소</button>
                              </div>
                            </td>
                          </>
                        ) : (
                          <>
                            <td className="px-3 py-3 text-gray-400 text-xs">{i + 1}</td>
                            <td className="px-3 py-3">
                              <span className={`px-2 py-0.5 text-xs rounded-full font-semibold ${row.status === '노출중' ? 'bg-green-100 text-green-700' : row.status === '종료' ? 'bg-red-50 text-red-500' : 'bg-gray-100 text-gray-500'}`}>
                                {row.status || '-'}
                              </span>
                            </td>
                            <td className="px-3 py-3 text-gray-600 text-xs max-w-[120px] truncate">{row.product || '-'}</td>
                            <td className="px-3 py-3 font-medium text-gray-900">{row.keyword}</td>
                            <td className="px-3 py-3 text-gray-500 text-xs">{row.tab || '-'}</td>
                            <td className="px-3 py-3 max-w-[160px]">
                              {row.blog_url
                                ? <a href={row.blog_url} target="_blank" rel="noreferrer" className="text-blue-500 text-xs hover:underline truncate block max-w-[150px]">{row.blog_url}</a>
                                : <span className="text-gray-300 text-xs">-</span>}
                            </td>
                            <td className="px-3 py-3 max-w-[150px]">
                              {row.hwaseon_url
                                ? <a href={row.hwaseon_url} target="_blank" rel="noreferrer" className="text-purple-500 text-xs hover:underline truncate block max-w-[140px]">{row.hwaseon_url}</a>
                                : <span className="text-gray-300 text-xs">-</span>}
                            </td>
                            <td className="px-3 py-3 text-right text-xs text-gray-600">{exposureDays > 0 ? `${exposureDays}일` : '-'}</td>
                            <td className="px-3 py-3 text-right">
                              {getCode(row.hwaseon_url) && clicks[row.id] != null
                                ? <span className="text-xs font-semibold text-purple-700">{clicks[row.id].toLocaleString()}</span>
                                : <span className="text-gray-300 text-xs">-</span>}
                            </td>
                            <td className="px-3 py-3">
                              <div className="flex gap-1">
                                <button onClick={() => { setEditId(row.id); setEdit({ keyword: row.keyword, product: row.product || '', blog_url: row.blog_url || '', hwaseon_url: row.hwaseon_url || '', tab: row.tab || '', status: row.status }) }}
                                  className="px-2 py-1 bg-gray-100 text-gray-700 rounded text-xs hover:bg-gray-200">수정</button>
                                <button onClick={() => del(row.id, row.keyword)}
                                  className="px-2 py-1 bg-red-50 text-red-500 rounded text-xs hover:bg-red-100">×</button>
                              </div>
                            </td>
                          </>
                        )}
                      </tr>
                    )
                  })}
                  {/* 새 행 추가 */}
                  <tr className="bg-gray-50">
                    <td className="px-3 py-2 text-gray-400 text-xs">+</td>
                    <td />
                    {([['product', '제품명'], ['keyword', '키워드 (필수)']] as [string, string][]).map(([k, ph]) => (
                      <td key={k} className="px-2 py-2">
                        <input value={(newRow as Record<string, string>)[k]} onChange={e => setNew(p => ({ ...p, [k]: e.target.value }))}
                          placeholder={ph}
                          className="border border-gray-300 rounded px-2 py-1 text-xs w-full focus:outline-none focus:ring-1 focus:ring-blue-400" />
                      </td>
                    ))}
                    <td className="px-2 py-2">
                      <input value={newRow.tab} onChange={e => setNew(p => ({ ...p, tab: e.target.value }))}
                        placeholder="노출탭"
                        className="border border-gray-300 rounded px-2 py-1 text-xs w-full focus:outline-none focus:ring-1 focus:ring-blue-400" />
                    </td>
                    {([['blog_url', '발행URL'], ['hwaseon_url', '제품링크URL']] as [string, string][]).map(([k, ph]) => (
                      <td key={k} className="px-2 py-2">
                        <input value={(newRow as Record<string, string>)[k]} onChange={e => setNew(p => ({ ...p, [k]: e.target.value }))}
                          placeholder={ph}
                          className="border border-gray-300 rounded px-2 py-1 text-xs w-full focus:outline-none focus:ring-1 focus:ring-blue-400" />
                      </td>
                    ))}
                    <td colSpan={2} />
                    <td className="px-2 py-2">
                      <button onClick={add} className="px-3 py-1 bg-green-600 text-white rounded text-xs hover:bg-green-700">추가</button>
                    </td>
                  </tr>
                  {filtered.length === 0 && rows.length > 0 && (
                    <tr><td colSpan={10} className="text-center py-8 text-gray-400 text-sm">필터 결과 없음</td></tr>
                  )}
                  {rows.length === 0 && (
                    <tr><td colSpan={10} className="text-center py-10 text-gray-400">데이터 없음</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
