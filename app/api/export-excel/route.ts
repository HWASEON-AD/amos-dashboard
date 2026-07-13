import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { combinedViews, splitList } from '@/lib/combined-views'
import { fetchAllRows } from '@/lib/fetch-all'
import * as XLSX from 'xlsx'

export const maxDuration = 60  // 외부 fetch(총 클릭수) 다수
export const dynamic = 'force-dynamic'

const HWASEON_URL_BASE = 'https://hwaseon-url.com'
const HWASEON_URL_ADMIN_KEY = process.env.HWASEON_URL_ADMIN_KEY

// hwaseon_url에서 shortCode 추출 (admin page의 getCode와 동일 로직)
function shortCode(url: string | null): string | null {
  if (!url) return null
  try { return new URL(url).pathname.split('/').filter(Boolean)[0] || null } catch { return null }
}

// shortCode별 총 클릭수 조회 (실패/없음 = null → 합산에서 제외)
async function fetchClicks(code: string): Promise<number | null> {
  try {
    const r = await fetch(`${HWASEON_URL_BASE}/api/stats/${code}`, {
      headers: { 'x-admin-key': HWASEON_URL_ADMIN_KEY || '' },
      cache: 'no-store',
    })
    if (!r.ok) return null
    const j = await r.json()
    return typeof j?.totalVisits === 'number' ? j.totalVisits : null
  } catch {
    return null
  }
}

function dateRange(start: string, end: string): string[] {
  const dates: string[] = []
  const cur = new Date(start)
  const last = new Date(end)
  while (cur <= last) {
    dates.push(cur.toISOString().slice(0, 10))
    cur.setDate(cur.getDate() + 1)
  }
  return dates
}

// 기본 = 전체 데이터. start/end 쿼리를 주면 그 기간의 날짜 컬럼만 뽑는다.
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const today = new Date().toISOString().slice(0, 10)
  const start = searchParams.get('start')
  const end = searchParams.get('end') || today

  const { data: posts } = await supabaseAdmin
    .from('amos_posts')
    .select('*')
    .order('brand')
    .order('product')
    .order('keyword')

  // ⚠️ 1000행 제한 → 페이지네이션 필수. 기간 지정이 없으면 전체 노출기록을 읽는다.
  const exposures = await fetchAllRows<{ post_id: string; date: string }>(() => {
    const q = supabaseAdmin.from('amos_daily_exposure').select('post_id, date').lte('date', end)
    return start ? q.gte('date', start) : q
  })

  // post_id → Set<date>
  const expMap: Record<string, Set<string>> = {}
  for (const e of exposures) {
    if (!expMap[e.post_id]) expMap[e.post_id] = new Set()
    expMap[e.post_id].add(e.date)
  }

  // 날짜 컬럼: DB에 실제로 있는 날짜 + (기간 지정 시) 그 기간 전체를 빈칸으로 채워 연속되게
  const dbDates = Array.from(new Set(exposures.map(e => e.date)))
  const allDates = Array.from(
    new Set(start ? [...dateRange(start, end), ...dbDates] : dbDates),
  ).sort()

  // 총 노출일: 기간 필터와 무관하게 전체 기간 기준 post_id별 노출일 수
  const allExp = await fetchAllRows<{ post_id: string }>(() =>
    supabaseAdmin.from('amos_daily_exposure').select('post_id'),
  )
  const totalExpMap: Record<string, number> = {}
  for (const e of allExp) {
    totalExpMap[e.post_id] = (totalExpMap[e.post_id] || 0) + 1
  }

  // 총 클릭수: 현재 + 과거 제품링크URL의 단축코드를 모두 합산 (관리자 화면과 동일)
  const clickMap: Record<string, number | ''> = {}
  await Promise.all(
    (posts || []).map(async p => {
      const codes = Array.from(new Set(
        [p.hwaseon_url, ...splitList(p.past_hwaseon_urls)]
          .map(shortCode)
          .filter((c): c is string => !!c),
      ))
      if (!codes.length) { clickMap[p.id] = ''; return }
      const live = (await Promise.all(codes.map(fetchClicks))).filter((v): v is number => v !== null)
      clickMap[p.id] = live.reduce((a, b) => a + b, 0)
    }),
  )

  // 단일 시트: 관리자 패널에 보이는 모든 컬럼 + 지난 URL + 조회수 내역 + 날짜별 노출
  const headers = [
    '브랜드', '제품', '구분', '구분2', '키워드', '상태', '진행', '검색량', '노출탭',
    '발행URL', '이미지호스팅URL', '제품링크URL',
    '지난 발행URL', '지난 이미지호스팅URL', '지난 제품링크URL',
    '총노출일', '카페조회수', '이미지조회수', '과거보존조회수', '총조회수', '총클릭수',
    ...allDates,
  ]
  const dataRows = (posts || []).map(p => {
    const row: (string | number)[] = [
      p.brand || '아모스',
      p.product || '',
      p.category || '',
      p.category2 || '',
      p.keyword,
      p.status || '',
      p.progress || '작업중',
      p.search_volume ?? '',       // 검색량 (search-volume이 캐시한 값)
      p.tab_type || '',
      p.blog_url || '',
      p.image_host_url || '',
      p.hwaseon_url || '',
      p.past_urls || '',
      p.past_image_host_urls || '',
      p.past_hwaseon_urls || '',
      totalExpMap[p.id] || 0,      // 총노출일 (전체 기간)
      p.cafe_views ?? 0,
      p.image_views ?? 0,
      p.views_base ?? 0,
      combinedViews(p),            // 총조회수 (카페+이미지+과거보존 누적)
      clickMap[p.id] ?? '',        // 총클릭수
    ]
    for (const d of allDates) {
      row.push(expMap[p.id]?.has(d) ? '노출' : '')
    }
    return row
  })

  const wb = XLSX.utils.book_new()
  const ws = XLSX.utils.aoa_to_sheet([headers, ...dataRows])
  ws['!cols'] = [
    { wch: 8 }, { wch: 18 }, { wch: 10 }, { wch: 10 }, { wch: 28 }, { wch: 8 }, { wch: 9 }, { wch: 9 }, { wch: 12 },
    { wch: 45 }, { wch: 40 }, { wch: 35 },
    { wch: 45 }, { wch: 40 }, { wch: 35 },
    { wch: 9 }, { wch: 10 }, { wch: 10 }, { wch: 12 }, { wch: 10 }, { wch: 10 },
    ...allDates.map(() => ({ wch: 11 })),
  ]
  XLSX.utils.book_append_sheet(wb, ws, '노출현황')

  const buf = XLSX.write(wb, { type: 'base64', bookType: 'xlsx' }) as string
  const binary = Buffer.from(buf, 'base64')

  return new NextResponse(binary, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="amos_data_${end}.xlsx"`,
    },
  })
}
