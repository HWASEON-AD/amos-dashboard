import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import * as XLSX from 'xlsx'

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const start = searchParams.get('start') || '2020-01-01'
  const end = searchParams.get('end') || new Date().toISOString().slice(0, 10)

  const { data: posts } = await supabaseAdmin.from('amos_posts').select('*').order('keyword')
  const { data: exposures } = await supabaseAdmin
    .from('amos_daily_exposure')
    .select('post_id, date, is_exposed')
    .gte('date', start)
    .lte('date', end)

  // ── Sheet 1: 키워드목록 ──
  const sheet1Rows = (posts || []).map(p => ({
    '브랜드': p.brand || '아모스',
    '제품': p.product || '',
    '키워드': p.keyword,
    '노출탭': p.tab || '',
    '발행URL': p.blog_url || '',
    '제품링크URL': p.hwaseon_url || '',
    '상태': p.status || '',
  }))

  // ── Sheet 2: 노출기록 (키워드 × 날짜 피벗) ──
  const allDates = Array.from(new Set((exposures || []).map(e => e.date))).sort()

  // post_id → date → is_exposed
  const expMap: Record<string, Record<string, boolean>> = {}
  for (const e of exposures || []) {
    if (!expMap[e.post_id]) expMap[e.post_id] = {}
    expMap[e.post_id][e.date] = e.is_exposed
  }

  const sheet2Headers = ['키워드', '제품', '브랜드', ...allDates]
  const sheet2Data = (posts || []).map(p => {
    const row: (string | number)[] = [p.keyword, p.product || '', p.brand || '아모스']
    for (const d of allDates) {
      const val = expMap[p.id]?.[d]
      row.push(val === true ? 1 : val === false ? 0 : '')
    }
    return row
  })

  const wb = XLSX.utils.book_new()

  const ws1 = XLSX.utils.json_to_sheet(sheet1Rows)
  ws1['!cols'] = [{ wch: 8 }, { wch: 15 }, { wch: 30 }, { wch: 10 }, { wch: 45 }, { wch: 35 }, { wch: 8 }]
  XLSX.utils.book_append_sheet(wb, ws1, '키워드목록')

  const ws2 = XLSX.utils.aoa_to_sheet([sheet2Headers, ...sheet2Data])
  ws2['!cols'] = [{ wch: 30 }, { wch: 15 }, { wch: 8 }, ...allDates.map(() => ({ wch: 12 }))]
  XLSX.utils.book_append_sheet(wb, ws2, '노출기록')

  const buf = XLSX.write(wb, { type: 'base64', bookType: 'xlsx' }) as string
  const binary = Buffer.from(buf, 'base64')

  return new NextResponse(binary, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="amos_data_${end}.xlsx"`,
    },
  })
}
