import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const body = await req.json()
  const { keyword, blog_url, hwaseon_url, tab, status } = body

  const updates: Record<string, string | null> = { updated_at: new Date().toISOString() }
  if (keyword !== undefined) updates.keyword = keyword
  if (blog_url !== undefined) updates.blog_url = blog_url || null
  if (hwaseon_url !== undefined) updates.hwaseon_url = hwaseon_url || null
  if (tab !== undefined) updates.tab = tab || null
  if (status !== undefined) updates.status = status

  const { data, error } = await supabaseAdmin
    .from('amos_posts')
    .update(updates)
    .eq('id', params.id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const { error } = await supabaseAdmin
    .from('amos_posts')
    .delete()
    .eq('id', params.id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
