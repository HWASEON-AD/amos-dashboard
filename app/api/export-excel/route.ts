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

  const expMap: Record<string, string[]> = {}
  for (const e of exposures || []) {
    if (e.is_exposed) {
      if (!expMap[e.post_id]) expMap[e.post_id] = []
      expMap[e.post_id].push(e.date)
    }
  }

  const sheetRows = (posts || []).map(p => ({
    '상태': p.status || '',
    '제품': p.product || '',
    '키워드': p.keyword,
    '노출탭': p.tab || '',
    '발행URL': p.blog_url || '',
    '제품링크URL': p.hwaseon_url || '',
    '노출일수': (expMap[p.id] || []).length,
    '마지막노출': (expMap[p.id] || []).sort().at(-1) || '',
  }))

  const wb = XLSX.utils.book_new()
  const ws = XLSX.utils.json_to_sheet(sheetRows)
  XLSX.utils.book_append_sheet(wb, ws, '노출현황')
  const buf = XLSX.write(wb, { type: 'base64', bookType: 'xlsx' }) as string
  const binary = Buffer.from(buf, 'base64')

  return new NextResponse(binary, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="amos_exposure_${end}.xlsx"`,
    },
  })
}
