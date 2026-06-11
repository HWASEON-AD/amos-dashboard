import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

export async function GET() {
  const { data, error } = await supabaseAdmin
    .from('amos_posts')
    .select('*, amos_daily_exposure(date, is_exposed, created_at)')
    .order('keyword')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  const { keyword, blog_url, hwaseon_url, tab } = body

  if (!keyword) return NextResponse.json({ error: '키워드 필수' }, { status: 400 })

  const { data, error } = await supabaseAdmin
    .from('amos_posts')
    .insert({ keyword, blog_url: blog_url || null, hwaseon_url: hwaseon_url || null, tab: tab || null, status: '미노출' })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
