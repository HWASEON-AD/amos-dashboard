'use client'

import { useEffect, useState, useRef, useCallback } from 'react'
import Link from 'next/link'
import * as XLSX from 'xlsx'

interface Keyword {
  id: string
  keyword: string
  product: string | null
  blog_url: string | null
  hwaseon_url: string | null
  tab: string | null
  status: string
}

const TABS = ['블로그', '뷰', '인플루언서', '카페', '지식iN', '쇼핑', '이미지', '동영상']

// 엑셀 복붙: Tab-separated 값 파싱
// 컬럼 순서: 제품 | 키워드 | 노출탭 | 발행URL | 제품링크URL (hwaseon-url)
function parsePasteData(raw: string) {
  return raw
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => {
      const cols = line.split('\t')
      return {
        product: cols[0]?.trim() || '',
        keyword: cols[1]?.trim() || cols[0]?.trim() || '',
        tab: cols[2]?.trim() || '',
        blog_url: cols[3]?.trim() || '',
        hwaseon_url: cols[4]?.trim() || '',
      }
    })
    .filter(r => r.keyword)
}

// xlsx 파일 파싱
function parseXlsx(buffer: ArrayBuffer) {
  const wb = XLSX.read(buffer, { type: 'array' })
  const ws = wb.Sheets[wb.SheetNames[0]]
  const rows: string[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' })

  const headerRow = rows.findIndex(r =>
    r.some(c => typeof c === 'string' && ['키워드', '검색어', 'keyword'].some(h => c.includes(h)))
  )
  const dataRows = headerRow >= 0 ? rows.slice(headerRow + 1) : rows.slice(1)
  const headers = headerRow >= 0
    ? rows[headerRow].map(c => String(c).trim().toLowerCase())
    : ['product', 'keyword', 'tab', 'blog_url', 'hwaseon_url']

  const ci = {
    product: headers.findIndex(h => ['제품', 'product', '상품'].some(k => h.includes(k))),
    keyword: headers.findIndex(h => ['키워드', '검색어', 'keyword'].some(k => h.includes(k))),
    tab: headers.findIndex(h => ['탭', 'tab', '노출탭'].some(k => h.includes(k))),
    blog_url: headers.findIndex(h => ['발행', 'blog', 'url'].some(k => h.includes(k)) && !h.includes('hwaseon') && !h.includes('제품')),
    hwaseon_url: headers.findIndex(h => ['hwaseon', '단축', 'short', '제품링크'].some(k => h.includes(k))),
  }

  return dataRows
    .filter(r => r.some(c => c !== ''))
    .map(r => ({
      product: String(r[ci.product >= 0 ? ci.product : 0] ?? '').trim(),
      keyword: String(r[ci.keyword >= 0 ? ci.keyword : 1] ?? '').trim(),
      tab: String(r[ci.tab >= 0 ? ci.tab : 2] ?? '').trim(),
      blog_url: String(r[ci.blog_url >= 0 ? ci.blog_url : 3] ?? '').trim(),
      hwaseon_url: String(r[ci.hwaseon_url >= 0 ? ci.hwaseon_url : 4] ?? '').trim(),
    }))
    .filter(r => r.keyword)
}

const SQL_SCHEMA = `-- Supabase SQL Editor에서 실행
CREATE TABLE IF NOT EXISTS amos_posts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  keyword TEXT NOT NULL UNIQUE,
  product TEXT,
  blog_url TEXT,
  hwaseon_url TEXT,
  tab TEXT,
  status TEXT DEFAULT '미노출',
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS amos_daily_exposure (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  post_id UUID REFERENCES amos_posts(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  is_exposed BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(post_id, date)
);

-- 기존 테이블에 컬럼 추가 (이미 있으면 무시)
ALTER TABLE amos_posts ADD COLUMN IF NOT EXISTS product TEXT;
ALTER TABLE amos_posts ADD COLUMN IF NOT EXISTS hwaseon_url TEXT;`

export default function AdminPage() {
  const [keywords, setKeywords] = useState<Keyword[]>([])
  const [loading, setLoading] = useState(true)
  const [editId, setEditId] = useState<string | null>(null)
  const [editData, setEditData] = useState({ keyword: '', product: '', blog_url: '', hwaseon_url: '', tab: '' })
  const [newRow, setNewRow] = useState({ keyword: '', product: '', blog_url: '', hwaseon_url: '', tab: '' })
  const [pasteText, setPasteText] = useState('')
  const [pasteMode, setPasteMode] = useState(false)
  const [importing, setImporting] = useState(false)
  const [importResult, setImportResult] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const res = await fetch('/api/keywords')
    const data = await res.json()
    setKeywords(data || [])
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  async function addKeyword() {
    if (!newRow.keyword.trim()) return alert('키워드를 입력하세요')
    await fetch('/api/keywords', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newRow),
    })
    setNewRow({ keyword: '', product: '', blog_url: '', hwaseon_url: '', tab: '' })
    load()
  }

  async function saveEdit(id: string) {
    await fetch(`/api/keywords/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(editData),
    })
    setEditId(null)
    load()
  }

  async function deleteKeyword(id: string, kw: string) {
    if (!confirm(`"${kw}" 삭제하시겠습니까?`)) return
    await fetch(`/api/keywords/${id}`, { method: 'DELETE' })
    load()
  }

  async function importRows(rows: { keyword: string; product: string; tab: string; blog_url: string; hwaseon_url: string }[]) {
    if (rows.length === 0) return alert('파싱된 데이터가 없습니다')
    setImporting(true)
    setImportResult(null)
    const res = await fetch('/api/keywords/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rows }),
    })
    const d = await res.json()
    setImporting(false)
    setImportResult(res.ok ? `${d.inserted}개 저장 완료` : `오류: ${d.error}`)
    if (res.ok) { setPasteText(''); load() }
  }

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const buffer = await file.arrayBuffer()
    const rows = parseXlsx(buffer)
    importRows(rows)
    if (fileRef.current) fileRef.current.value = ''
  }

  function startEdit(k: Keyword) {
    setEditId(k.id)
    setEditData({
      keyword: k.keyword,
      product: k.product || '',
      blog_url: k.blog_url || '',
      hwaseon_url: k.hwaseon_url || '',
      tab: k.tab || '',
    })
  }

  const pastePreview = parsePasteData(pasteText)

  return (
    <div className="max-w-7xl mx-auto px-4 py-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">어드민 · 키워드 관리</h1>
        <Link href="/" className="text-sm text-blue-600 hover:underline">← 대시보드</Link>
      </div>

      {/* 엑셀 가져오기 */}
      <div className="bg-white border border-gray-200 rounded-xl p-5 mb-6 shadow-sm">
        <h2 className="font-semibold text-gray-800 mb-1">엑셀 가져오기</h2>
        <p className="text-xs text-gray-500 mb-3">
          <strong>컬럼 순서:</strong> 제품 | 키워드 | 노출탭 | 발행URL | 제품링크URL &nbsp;&nbsp;
          (헤더 자동 인식 · 키워드 중복 시 업데이트)
        </p>

        <div className="flex gap-2 mb-4">
          <button
            onClick={() => { setPasteMode(false); setImportResult(null) }}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${!pasteMode ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
          >
            파일 업로드 (.xlsx / .csv)
          </button>
          <button
            onClick={() => { setPasteMode(true); setImportResult(null) }}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${pasteMode ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
          >
            복붙 (Ctrl+C → Ctrl+V)
          </button>
        </div>

        {!pasteMode ? (
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            onChange={handleFileUpload}
            className="text-sm text-gray-600 file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
          />
        ) : (
          <div>
            <textarea
              value={pasteText}
              onChange={e => setPasteText(e.target.value)}
              placeholder={"엑셀에서 셀 범위 선택 후 Ctrl+C → 여기 클릭 후 Ctrl+V\n\n[예시 — 탭으로 구분]\n헤어오일\t아모스 헤어오일 블로그\t블로그\thttps://blog.naver.com/...\thttps://hwaseon-url.com/abc\n모로칸오일\t모로칸오일 후기\t뷰\t\t"}
              className="w-full border border-gray-300 rounded-lg p-3 text-sm font-mono h-36 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-y"
            />
            <div className="flex items-center gap-3 mt-2">
              <button
                onClick={() => importRows(pastePreview)}
                disabled={importing || pastePreview.length === 0}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 disabled:opacity-40 transition-colors"
              >
                {importing ? '저장 중...' : `가져오기 (${pastePreview.length}행)`}
              </button>
            </div>
          </div>
        )}

        {importResult && (
          <p className={`text-sm mt-3 font-medium ${importResult.includes('오류') ? 'text-red-600' : 'text-green-600'}`}>
            {importResult}
          </p>
        )}
      </div>

      {/* 새 키워드 직접 추가 */}
      <div className="bg-white border border-gray-200 rounded-xl p-5 mb-6 shadow-sm">
        <h2 className="font-semibold text-gray-800 mb-3">키워드 직접 추가</h2>
        <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
          <input
            value={newRow.product}
            onChange={e => setNewRow(p => ({ ...p, product: e.target.value }))}
            placeholder="제품명"
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <input
            value={newRow.keyword}
            onChange={e => setNewRow(p => ({ ...p, keyword: e.target.value }))}
            placeholder="키워드 *"
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <select
            value={newRow.tab}
            onChange={e => setNewRow(p => ({ ...p, tab: e.target.value }))}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">노출탭</option>
            {TABS.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
          <input
            value={newRow.blog_url}
            onChange={e => setNewRow(p => ({ ...p, blog_url: e.target.value }))}
            placeholder="발행URL"
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <input
            value={newRow.hwaseon_url}
            onChange={e => setNewRow(p => ({ ...p, hwaseon_url: e.target.value }))}
            placeholder="제품링크URL (hwaseon-url)"
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button
            onClick={addKeyword}
            className="bg-green-600 text-white rounded-lg px-4 py-2 text-sm hover:bg-green-700 transition-colors"
          >
            추가
          </button>
        </div>
      </div>

      {/* 키워드 목록 */}
      {loading ? (
        <div className="text-center py-12 text-gray-400">로딩 중...</div>
      ) : (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-x-auto">
          <div className="px-4 py-3 bg-gray-50 text-sm font-medium text-gray-500 border-b border-gray-100">
            총 {keywords.length}개 키워드
          </div>
          <table className="w-full text-sm min-w-[900px]">
            <thead className="bg-gray-50 text-gray-600">
              <tr>
                <th className="text-left px-3 py-2 font-medium">상태</th>
                <th className="text-left px-3 py-2 font-medium">제품</th>
                <th className="text-left px-3 py-2 font-medium">키워드</th>
                <th className="text-left px-3 py-2 font-medium">노출탭</th>
                <th className="text-left px-3 py-2 font-medium">발행URL</th>
                <th className="text-left px-3 py-2 font-medium">제품링크URL</th>
                <th className="text-center px-3 py-2 font-medium">액션</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {keywords.map(k => (
                <tr key={k.id} className="hover:bg-gray-50">
                  {editId === k.id ? (
                    <>
                      <td className="px-3 py-2">
                        <span className={`px-2 py-0.5 text-xs rounded-full ${k.status === '노출중' ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-500'}`}>
                          {k.status}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        <input value={editData.product} onChange={e => setEditData(p => ({ ...p, product: e.target.value }))}
                          className="border border-blue-400 rounded px-2 py-1 w-full text-sm" placeholder="제품명" />
                      </td>
                      <td className="px-3 py-2">
                        <input value={editData.keyword} onChange={e => setEditData(p => ({ ...p, keyword: e.target.value }))}
                          className="border border-blue-400 rounded px-2 py-1 w-full text-sm" />
                      </td>
                      <td className="px-3 py-2">
                        <select value={editData.tab} onChange={e => setEditData(p => ({ ...p, tab: e.target.value }))}
                          className="border border-blue-400 rounded px-2 py-1 text-sm">
                          <option value="">-</option>
                          {TABS.map(t => <option key={t} value={t}>{t}</option>)}
                        </select>
                      </td>
                      <td className="px-3 py-2">
                        <input value={editData.blog_url} onChange={e => setEditData(p => ({ ...p, blog_url: e.target.value }))}
                          placeholder="발행URL" className="border border-blue-400 rounded px-2 py-1 w-full text-sm" />
                      </td>
                      <td className="px-3 py-2">
                        <input value={editData.hwaseon_url} onChange={e => setEditData(p => ({ ...p, hwaseon_url: e.target.value }))}
                          placeholder="hwaseon-url" className="border border-blue-400 rounded px-2 py-1 w-full text-sm" />
                      </td>
                      <td className="px-3 py-2 text-center">
                        <div className="flex gap-1 justify-center">
                          <button onClick={() => saveEdit(k.id)} className="px-3 py-1 bg-blue-600 text-white rounded text-xs hover:bg-blue-700">저장</button>
                          <button onClick={() => setEditId(null)} className="px-3 py-1 bg-gray-200 text-gray-600 rounded text-xs hover:bg-gray-300">취소</button>
                        </div>
                      </td>
                    </>
                  ) : (
                    <>
                      <td className="px-3 py-3">
                        <span className={`px-2 py-0.5 text-xs rounded-full font-semibold ${k.status === '노출중' ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-500'}`}>
                          {k.status}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-gray-700">{k.product || '-'}</td>
                      <td className="px-3 py-3 font-medium text-gray-900">{k.keyword}</td>
                      <td className="px-3 py-3 text-gray-500">{k.tab || '-'}</td>
                      <td className="px-3 py-3 max-w-[150px]">
                        {k.blog_url
                          ? <a href={k.blog_url} target="_blank" rel="noreferrer" className="text-blue-500 hover:underline text-xs truncate block">{k.blog_url}</a>
                          : <span className="text-gray-300 text-xs">-</span>}
                      </td>
                      <td className="px-3 py-3 max-w-[150px]">
                        {k.hwaseon_url
                          ? <a href={k.hwaseon_url} target="_blank" rel="noreferrer" className="text-purple-500 hover:underline text-xs truncate block">{k.hwaseon_url}</a>
                          : <span className="text-gray-300 text-xs">-</span>}
                      </td>
                      <td className="px-3 py-3 text-center">
                        <div className="flex gap-1 justify-center">
                          <button onClick={() => startEdit(k)} className="px-3 py-1 bg-gray-100 text-gray-700 rounded text-xs hover:bg-gray-200">수정</button>
                          <button onClick={() => deleteKeyword(k.id, k.keyword)} className="px-3 py-1 bg-red-50 text-red-600 rounded text-xs hover:bg-red-100">삭제</button>
                        </div>
                      </td>
                    </>
                  )}
                </tr>
              ))}
              {keywords.length === 0 && (
                <tr>
                  <td colSpan={7} className="text-center py-8 text-gray-400">
                    등록된 키워드가 없습니다. 위에서 추가하거나 엑셀을 가져오세요.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* SQL 안내 */}
      <div className="mt-6 bg-yellow-50 border border-yellow-200 rounded-xl p-4 text-sm text-yellow-800">
        <strong>Supabase SQL 에디터에서 실행:</strong>
        <a href="https://supabase.com/dashboard/project/kepzsboxjulzygehmzpf/sql/new"
          target="_blank" rel="noreferrer" className="ml-2 text-blue-600 hover:underline text-xs">
          SQL Editor 열기
        </a>
        <pre className="mt-2 bg-white border border-yellow-200 rounded p-3 text-xs overflow-x-auto whitespace-pre">
          {SQL_SCHEMA}
        </pre>
      </div>
    </div>
  )
}
