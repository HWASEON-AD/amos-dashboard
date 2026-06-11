import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

export async function POST(req: NextRequest) {
  const body = await req.json()
  const { rows } = body as {
    rows: { keyword: string; product?: string; tab?: string; blog_url?: string; hwaseon_url?: string }[]
  }

  if (!rows || rows.length === 0) {
    return NextResponse.json({ error: '데이터 없음' }, { status: 400 })
  }

  const inserts = rows
    .filter(r => r.keyword?.trim())
    .map(r => ({
      keyword: r.keyword.trim(),
      product: r.product?.trim() || null,
      tab: r.tab?.trim() || null,
      blog_url: r.blog_url?.trim() || null,
      hwaseon_url: r.hwaseon_url?.trim() || null,
      status: '미노출',
    }))

  const { data, error } = await supabaseAdmin
    .from('amos_posts')
    .upsert(inserts, { onConflict: 'keyword' })
    .select()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ inserted: data?.length ?? 0 })
}
