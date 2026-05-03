// app/api/conversations/[id]/route.js
import { supabaseAdmin } from '@/lib/supabase';

export const runtime = 'nodejs';

// ── GET /api/conversations/:id ───────────────────────────────
// Returns the conversation record + all its messages + referenced products.
export async function GET(req, { params }) {
  // Next.js 15: params is a Promise — must be awaited before accessing properties.
  const { id } = await params;

  if (!id) {
    return Response.json({ error: 'id is required' }, { status: 400 });
  }

  try {
    // Fetch conversation and messages in parallel
    const [convRes, msgsRes] = await Promise.all([
      supabaseAdmin
        .from('conversations')
        .select('id, title, session_id, created_at')
        .eq('id', id)
        .single(),
      supabaseAdmin
        .from('messages')
        .select('id, role, content, metadata, created_at')
        .eq('conversation_id', id)
        .order('created_at', { ascending: true }),
    ]);

    if (convRes.error || !convRes.data) {
      return Response.json({ error: 'Conversation not found' }, { status: 404 });
    }

    const msgs = msgsRes.data ?? [];

    // Collect unique product IDs referenced in assistant message metadata
    const productIds = new Set();
    for (const m of msgs) {
      if (Array.isArray(m.metadata?.product_ids)) {
        m.metadata.product_ids.forEach((pid) => productIds.add(pid));
      }
    }

    // Fetch products only if there are any to fetch
    let products = [];
    if (productIds.size > 0) {
      const { data: prodData, error: prodErr } = await supabaseAdmin
        .from('products')
        .select('*')
        .in('id', Array.from(productIds));

      if (!prodErr) products = prodData ?? [];
    }

    return Response.json({
      conversation: convRes.data,
      messages: msgs,
      products,
    });
  } catch (err) {
    console.error('[GET /api/conversations/:id] Unexpected error:', err);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// ── DELETE /api/conversations/:id ───────────────────────────
export async function DELETE(req, { params }) {
  const { id } = await params;

  if (!id) {
    return Response.json({ error: 'id is required' }, { status: 400 });
  }

  try {
    const { error } = await supabaseAdmin
      .from('conversations')
      .delete()
      .eq('id', id);

    if (error) {
      console.error('[DELETE /api/conversations/:id] Supabase error:', error);
      return Response.json({ error: 'Failed to delete conversation' }, { status: 500 });
    }

    return Response.json({ success: true });
  } catch (err) {
    console.error('[DELETE /api/conversations/:id] Unexpected error:', err);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// ── PATCH /api/conversations/:id ─────────────────────────────
// Renames a conversation.
export async function PATCH(req, { params }) {
  const { id } = await params;

  if (!id) {
    return Response.json({ error: 'id is required' }, { status: 400 });
  }

  let title;
  try {
    const body = await req.json();
    title = body?.title;
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (!title || typeof title !== 'string' || !title.trim()) {
    return Response.json({ error: 'title is required and must be a non-empty string' }, { status: 400 });
  }

  try {
    const { data, error } = await supabaseAdmin
      .from('conversations')
      .update({ title: title.trim() })
      .eq('id', id)
      .select('id, title')
      .single();

    if (error) {
      console.error('[PATCH /api/conversations/:id] Supabase error:', error);
      return Response.json({ error: 'Failed to update conversation' }, { status: 500 });
    }

    return Response.json({ conversation: data });
  } catch (err) {
    console.error('[PATCH /api/conversations/:id] Unexpected error:', err);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
}
