import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

export async function POST(req: NextRequest) {
  const body = await req.json()
  const { exposures } = body as {
    exposures: { keyword: string; product: string; brand: string; date: string; is_exposed: boolean }[]
  }

  if (!exposures?.length) return NextResponse.json({ count: 0 })

  const { data: posts } = await supabaseAdmin
    .from('amos_posts')
    .select('id, keyword, product, brand')

  const postMap = new Map<string, string>()
  for (const p of posts || []) {
    const key = `${p.keyword}|||${p.product ?? ''}|||${p.brand ?? '아모스'}`
    postMap.set(key, p.id)
  }

  const records: { post_id: string; date: string; is_exposed: boolean }[] = []
  for (const e of exposures) {
    const key = `${e.keyword}|||${e.product ?? ''}|||${e.brand ?? '아모스'}`
    const postId = postMap.get(key)
    if (!postId) continue
    records.push({ post_id: postId, date: e.date, is_exposed: e.is_exposed })
  }

  if (!records.length) return NextResponse.json({ count: 0, note: '매칭된 키워드 없음' })

  const { error } = await supabaseAdmin
    .from('amos_daily_exposure')
    .upsert(records, { onConflict: 'post_id,date' })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ count: records.length })
}
