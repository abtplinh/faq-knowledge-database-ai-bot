// app/api/conversations/route.js
import { supabaseAdmin } from '@/lib/supabase';

export const runtime = 'nodejs';

// GET /api/conversations?sessionId=xxx  → list conversations for session
export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const sessionId = searchParams.get('sessionId');

  if (!sessionId) {
    return Response.json({ error: 'sessionId required' }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from('conversations')
    .select('id, title, created_at, updated_at')
    .eq('session_id', sessionId)
    .order('updated_at', { ascending: false })
    .limit(30);

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ conversations: data });
}

// POST /api/conversations  → create new conversation
export async function POST(req) {
  const body = await req.json().catch(() => ({}));
  const { sessionId, title = 'Cuộc trò chuyện mới' } = body;

  if (!sessionId) {
    return Response.json({ error: 'sessionId required' }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from('conversations')
    .insert({ session_id: sessionId, title })
    .select('id, title, created_at')
    .single();

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ conversation: data });
}
