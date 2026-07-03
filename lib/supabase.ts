import { createClient } from '@supabase/supabase-js'

// 빌드(page data 수집) 시점에 env가 비어 있어도 createClient가 throw하지 않도록 폴백을 둔다.
// 실제 런타임(Production)에서는 Vercel 환경변수가 주입되어 정상 동작한다.
const url = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co'
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder-anon-key'
const service = process.env.SUPABASE_SERVICE_KEY || 'placeholder-service-key'

export const supabase = createClient(url, anon)
export const supabaseAdmin = createClient(url, service)
