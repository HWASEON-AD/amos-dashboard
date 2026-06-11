'use client'

import { useEffect, useState, useRef, useCallback } from 'react'
import Link from 'next/link'
import * as XLSX from 'xlsx'

interface Keyword {
  id: string
  keyword: string
  blog_url: string | null
  hwaseon_url: string | null
  tab: string | null
  status: string
}

const TABS = ['블로그', '뷰', '인플루언서', '카페', '지식iN', '쇼핑', '이미지', '동영상']

// 엑셀 복붙: Tab-separated 값 파싱
// 지원 컬럼 순서: 키워드 | 노출탭 | 블로그URL | hwaseon-url (4컬럼)
// 또는: 키워드 | 노출탭 (2컬럼)
// 또는: 키워드만 (1컬럼)
function parsePasteData(raw: string) {
  return raw
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => {
      const cols = line.split('\t')
      return {
        keyword: cols[0]?.trim() || '',
        tab: cols[1]?.trim() || '',
        blog_url: cols[2]?.trim() || '',
        hwaseon_url: cols[3]?.trim() || '',
      }
    })
    .filter(r => r.keyword)
}

// xlsx 파일 파싱
function parseXlsx(buffer: ArrayBuffer) {
  const wb = XLSX.read(buffer, { type: 'array' })
  const ws = wb.Sheets[wb.SheetNames[0]]
  const rows: string[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' })

  // 헤더 행 감지
  const headerRow = rows.findIndex(r =>
    r.some(c => typeof c === 'string' && ['키워드', '검색어', 'keyword'].some(h => c.includes(h)))
  )
  const dataRows = headerRow >= 0 ? rows.slice(headerRow + 1) : rows
  const headers = headerRow >= 0 ? rows[headerRow].map(c => String(c).trim().toLowerCase()) : []

  const colIdx = {
    keyword: headers.findIndex(h => ['키워드', '검색어', 'keyword'].some(k => h.includes(k))),
    tab: headers.findIndex(h => ['탭', 'tab', '노출탭'].some(k => h.includes(k))),
    blog_url: headers.findIndex(h => ['blog', 'url', 'link', '블로그'].some(k => h.includes(k))),
    hwaseon_url: headers.findIndex(h => ['hwaseon', '단축', 'short'].some(k => h.includes(k))),
  }

  return dataRows
    .filter(r => r.some(c => c !== ''))
    .map(r => ({
      keyword: String(r[colIdx.keyword >= 0 ? colIdx.keyword : 0] ?? '').trim(),
      tab: String(r[colIdx.tab >= 0 ? colIdx.tab : 1] ?? '').trim(),
      blog_url: String(r[colIdx.blog_url >= 0 ? colIdx.blog_url : 2] ?? '').trim(),
      hwaseon_url: String(r[colIdx.hwaseon_url >= 0 ? colIdx.hwaseon_url : 3] ?? '').trim(),
    }))
    .filter(r => r.keyword)
}

export default function AdminPage() {
  const [keywords, setKeywords] = useState<Keyword[]>([])
  const [loading, setLoading] = useState(true)
  const [editId, setEditId] = useState<string | null>(null)
  const [editData, setEditData] = useState({ keyword: '', blog_url: '', hwaseon_url: '', tab: '' })
  const [newRow, setNewRow] = useState({ keyword: '', blog_url: '', hwaseon_url: '', tab: '' })
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
    setNewRow({ keyword: '', blog_url: '', hwaseon_url: '', tab: '' })
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

  async function importRows(rows: { keyword: string; tab: string; blog_url: string; hwaseon_url: string }[]) {
    if (rows.length === 0) return alert('파싱된 데이터가 없습니다')
    setImporting(true)
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

  function handlePasteImport() {
    const rows = parsePasteData(pasteText)
    importRows(rows)
  }

  function startEdit(k: Keyword) {
    setEditId(k.id)
    setEditData({
      keyword: k.keyword,
      blog_url: k.blog_url || '',
      hwaseon_url: k.hwaseon_url || '',
      tab: k.tab || '',
    })
  }

  return (
    <div className="max-w-6xl mx-auto px-4 py-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">어드민 · 키워드 관리</h1>
        <Link href="/" className="text-sm text-blue-600 hover:underline">← 대시보드</Link>
      </div>

      {/* 엑셀 가져오기 섹션 */}
      <div className="bg-white border border-gray-200 rounded-xl p-5 mb-6 shadow-sm">
        <h2 className="font-semibold text-gray-800 mb-3">엑셀 가져오기</h2>
        <p className="text-xs text-gray-500 mb-3">
          <strong>엑셀 열 순서:</strong> 키워드 | 노출탭 | 블로그URL | hwaseon-url (탭 구분, 헤더 자동 인식)
        </p>

        <div className="flex gap-3 mb-3">
          <button
            onClick={() => { setPasteMode(false); setImportResult(null) }}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${!pasteMode ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
          >
            파일 업로드 (.xlsx)
          </button>
          <button
            onClick={() => { setPasteMode(true); setImportResult(null) }}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${pasteMode ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
          >
            복붙 (Ctrl+C → Ctrl+V)
          </button>
        </div>

        {!pasteMode ? (
          <div className="flex items-center gap-3">
            <input
              ref={fileRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              onChange={handleFileUpload}
              className="text-sm text-gray-600 file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
            />
          </div>
        ) : (
          <div>
            <textarea
              value={pasteText}
              onChange={e => setPasteText(e.target.value)}
              placeholder={"엑셀에서 셀 선택 후 Ctrl+C → 여기서 Ctrl+V\n\n예시:\n헤어오일\t블로그\thttps://blog.naver.com/...\thttps://hwaseon-url.com/abc\n모로칸오일\t뷰\t\t"}
              className="w-full border border-gray-300 rounded-lg p-3 text-sm font-mono h-36 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-y"
            />
            <div className="flex items-center gap-3 mt-2">
              <button
                onClick={handlePasteImport}
                disabled={importing || !pasteText.trim()}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 disabled:opacity-40 transition-colors"
              >
                {importing ? '저장 중...' : '가져오기'}
              </button>
              <span className="text-xs text-gray-400">
                {parsePasteData(pasteText).length}행 감지됨
              </span>
            </div>
          </div>
        )}

        {importing && (
          <p className="text-sm text-blue-600 mt-2">저장 중...</p>
        )}
        {importResult && (
          <p className={`text-sm mt-2 font-medium ${importResult.includes('오류') ? 'text-red-600' : 'text-green-600'}`}>
            {importResult}
          </p>
        )}
      </div>

      {/* 새 키워드 추가 */}
      <div className="bg-white border border-gray-200 rounded-xl p-5 mb-6 shadow-sm">
        <h2 className="font-semibold text-gray-800 mb-3">키워드 직접 추가</h2>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
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
            <option value="">노출탭 선택</option>
            {TABS.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
          <input
            value={newRow.blog_url}
            onChange={e => setNewRow(p => ({ ...p, blog_url: e.target.value }))}
            placeholder="블로그 URL"
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <input
            value={newRow.hwaseon_url}
            onChange={e => setNewRow(p => ({ ...p, hwaseon_url: e.target.value }))}
            placeholder="hwaseon-url (단축URL)"
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
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <div className="px-4 py-3 bg-gray-50 text-sm font-medium text-gray-500">
            총 {keywords.length}개 키워드
          </div>
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-t border-gray-100 text-gray-600">
              <tr>
                <th className="text-left px-4 py-2 font-medium">키워드</th>
                <th className="text-left px-4 py-2 font-medium">탭</th>
                <th className="text-left px-4 py-2 font-medium">상태</th>
                <th className="text-left px-4 py-2 font-medium">블로그 URL</th>
                <th className="text-left px-4 py-2 font-medium">hwaseon-url</th>
                <th className="text-center px-4 py-2 font-medium">액션</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {keywords.map(k => (
                <tr key={k.id} className="hover:bg-gray-50">
                  {editId === k.id ? (
                    <>
                      <td className="px-3 py-2">
                        <input
                          value={editData.keyword}
                          onChange={e => setEditData(p => ({ ...p, keyword: e.target.value }))}
                          className="border border-blue-400 rounded px-2 py-1 w-full text-sm"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <select
                          value={editData.tab}
                          onChange={e => setEditData(p => ({ ...p, tab: e.target.value }))}
                          className="border border-blue-400 rounded px-2 py-1 text-sm"
                        >
                          <option value="">-</option>
                          {TABS.map(t => <option key={t} value={t}>{t}</option>)}
                        </select>
                      </td>
                      <td className="px-3 py-2">
                        <span className={`px-2 py-0.5 text-xs rounded-full ${k.status === '노출중' ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-500'}`}>
                          {k.status}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        <input
                          value={editData.blog_url}
                          onChange={e => setEditData(p => ({ ...p, blog_url: e.target.value }))}
                          placeholder="https://blog.naver.com/..."
                          className="border border-blue-400 rounded px-2 py-1 w-full text-sm"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <input
                          value={editData.hwaseon_url}
                          onChange={e => setEditData(p => ({ ...p, hwaseon_url: e.target.value }))}
                          placeholder="https://hwaseon-url.com/..."
                          className="border border-blue-400 rounded px-2 py-1 w-full text-sm"
                        />
                      </td>
                      <td className="px-3 py-2 text-center">
                        <div className="flex gap-1 justify-center">
                          <button onClick={() => saveEdit(k.id)}
                            className="px-3 py-1 bg-blue-600 text-white rounded text-xs hover:bg-blue-700">저장</button>
                          <button onClick={() => setEditId(null)}
                            className="px-3 py-1 bg-gray-200 text-gray-600 rounded text-xs hover:bg-gray-300">취소</button>
                        </div>
                      </td>
                    </>
                  ) : (
                    <>
                      <td className="px-4 py-3 font-medium text-gray-900">{k.keyword}</td>
                      <td className="px-4 py-3 text-gray-500">{k.tab || '-'}</td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 text-xs rounded-full ${k.status === '노출중' ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-500'}`}>
                          {k.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 max-w-[180px] truncate">
                        {k.blog_url ? (
                          <a href={k.blog_url} target="_blank" rel="noreferrer"
                            className="text-blue-500 hover:underline text-xs truncate block">{k.blog_url}</a>
                        ) : <span className="text-gray-300 text-xs">미입력</span>}
                      </td>
                      <td className="px-4 py-3 max-w-[160px] truncate">
                        {k.hwaseon_url ? (
                          <a href={k.hwaseon_url} target="_blank" rel="noreferrer"
                            className="text-purple-500 hover:underline text-xs truncate block">{k.hwaseon_url}</a>
                        ) : <span className="text-gray-300 text-xs">미입력</span>}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <div className="flex gap-1 justify-center">
                          <button onClick={() => startEdit(k)}
                            className="px-3 py-1 bg-gray-100 text-gray-700 rounded text-xs hover:bg-gray-200">수정</button>
                          <button onClick={() => deleteKeyword(k.id, k.keyword)}
                            className="px-3 py-1 bg-red-50 text-red-600 rounded text-xs hover:bg-red-100">삭제</button>
                        </div>
                      </td>
                    </>
                  )}
                </tr>
              ))}
              {keywords.length === 0 && (
                <tr>
                  <td colSpan={6} className="text-center py-8 text-gray-400">
                    등록된 키워드가 없습니다. 위에서 추가하거나 엑셀을 가져오세요.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Supabase SQL 안내 */}
      <div className="mt-6 bg-yellow-50 border border-yellow-200 rounded-xl p-4 text-sm text-yellow-800">
        <strong>Supabase 테이블 없을 때:</strong> SQL 에디터에서 아래 실행
        <pre className="mt-2 bg-white border border-yellow-200 rounded p-3 text-xs overflow-x-auto whitespace-pre">
{`CREATE TABLE IF NOT EXISTS amos_posts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  keyword TEXT NOT NULL UNIQUE,
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
);`}
        </pre>
      </div>
    </div>
  )
}
