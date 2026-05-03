// app/api/chat/route.js
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { streamText, convertToModelMessages } from 'ai';
import { supabaseAdmin } from '@/lib/supabase';
import { retrieveContext } from '@/lib/ragRetriever';
import { checkRateLimit } from '@/lib/rateLimiter';
import { extractUserProfile, upsertProfile } from '@/lib/profileExtractor';

export const runtime = 'nodejs';
export const maxDuration = 60;

// ── Google AI client ─────────────────────────────────────────
// gemini-1.5-flash-8b: highest free-tier quota (1500 req/day, 1M tokens/min)
const google = createGoogleGenerativeAI({ apiKey: process.env.GEMINI_API_KEY });
const AI_MODEL = 'gemini-2.5-flash';

// ── Constants ────────────────────────────────────────────────
// Only send last 5 messages to the model to save tokens
const MAX_HISTORY_MESSAGES = 5;

const LUNA_PERSONA = `Bạn là LunaBot - Trợ lý AI chuyên gia Skincare của Luna Beauty.

Tính cách: Thân thiện, chuyên nghiệp, ân cần như một người bạn hiểu biết về làm đẹp.
Ngôn ngữ: Trả lời bằng tiếng Việt, nếu người dùng hỏi tiếng Anh thì trả lời bằng tiếng Anh, tự nhiên, dễ hiểu. Dùng emoji nhẹ nhàng khi phù hợp.

Nguyên tắc:
- Luôn tư vấn dựa trên thông tin đã được cung cấp trong context.
- Nếu không có thông tin trong context, thành thật nói không biết thay vì bịa đặt.
- Khi gợi ý sản phẩm: ưu tiên phù hợp loại da, ngân sách và vấn đề da của user.
- Khi nêu thành phần hóa học: giải thích ngắn gọn công dụng.
- Luôn khuyến khích patch test trước khi dùng sản phẩm mới.
- Không chẩn đoán bệnh da liễu — hãy tư vấn gặp bác sĩ nếu tình trạng nghiêm trọng.
- Kết thúc mỗi câu trả lời bằng câu hỏi mở để tiếp tục cuộc trò chuyện (nếu phù hợp).

Format khi giới thiệu sản phẩm:
- Tên sản phẩm và thương hiệu rõ ràng
- Công dụng chính
- Phù hợp loại da nào
- Giá (nếu có)
- Nếu có link mua → để user bấm vào (hệ thống sẽ tự render nút)`;

// ── Main handler ─────────────────────────────────────────────
export async function POST(req) {
  // ── 1. Rate Limiting ──────────────────────────────────────
  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('x-real-ip') ||
    '127.0.0.1';

  if (!checkRateLimit(ip)) {
    return new Response(
      JSON.stringify({ error: 'Hệ thống đang bận, vui lòng thử lại sau 1 phút.' }),
      { status: 429, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // ── 2. Parse & Validate Input ─────────────────────────────
  // AI SDK v6: body is { id, messages (UIMessage[]), trigger, ...extraBody }
  // Extra body fields (sessionId, conversationId) are merged in by useChat's `body` option.
  let body;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const { messages = [], conversationId, sessionId } = body;
  console.log('[chat/route] Received body:', JSON.stringify(body, null, 2));

  if (!sessionId || typeof sessionId !== 'string') {
    return new Response(JSON.stringify({ error: 'sessionId is required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Extract the user's latest query text from the UIMessage parts array (AI SDK v6 format)
  // Each message.parts is an array of { type: 'text', text: '...' } objects
  const lastUserMsg = [...messages].reverse().find((m) => m.role === 'user');
  let userQuery = '';
  if (lastUserMsg) {
    if (typeof lastUserMsg.content === 'string' && lastUserMsg.content) {
      // Fallback: plain string content
      userQuery = lastUserMsg.content;
    } else if (Array.isArray(lastUserMsg.parts)) {
      // AI SDK v6 UIMessage format: parts array
      userQuery = lastUserMsg.parts
        .filter((p) => p.type === 'text')
        .map((p) => p.text)
        .join('\n');
    } else if (Array.isArray(lastUserMsg.content)) {
      // Older SDK: content as array of parts
      userQuery = lastUserMsg.content
        .filter((p) => p.type === 'text')
        .map((p) => p.text)
        .join('\n');
    }
  }

  if (!userQuery?.trim()) {
    return new Response(JSON.stringify({ error: 'Empty message' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Sanitize & truncate input
  userQuery = userQuery.trim().substring(0, 1000);

  // ── 3. Pre-stream async work ──────────────────────────────
  // Run conversation creation, profile fetch, and RAG retrieval in parallel.
  // RAG uses embedQuery internally (Gemini embedding call) — this is intentional
  // and necessary for semantic search. It does NOT re-embed the whole database.
  let convId = conversationId;

  const [convResult, profileResult, ragResult] = await Promise.allSettled([
    convId
      ? Promise.resolve({ data: { id: convId }, error: null })
      : supabaseAdmin
        .from('conversations')
        .insert({ session_id: sessionId, title: userQuery.substring(0, 60) })
        .select('id')
        .single(),
    supabaseAdmin
      .from('user_profiles')
      .select('skin_type, concerns, budget, age_range')
      .eq('session_id', sessionId)
      .single(),
    // retrieveContext only embeds the user's query (1 small API call),
    // then does a Supabase vector similarity search. No DB re-embedding.
    retrieveContext(userQuery, {}).catch(() => ({ contextText: '', products: [] })),
  ]);

  // Resolve conversation ID
  if (!convId) {
    if (convResult.status === 'fulfilled' && convResult.value?.data?.id) {
      convId = convResult.value.data.id;
    } else {
      console.error('Error creating conversation:', convResult.reason ?? convResult.value?.error);
      return new Response(
        JSON.stringify({ error: 'Failed to create conversation' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }
  }

  // Resolve profile (non-fatal — fall back to empty object)
  const profile =
    profileResult.status === 'fulfilled' ? (profileResult.value?.data ?? {}) : {};

  // Resolve RAG (non-fatal — fall back to empty)
  const { contextText = '', products = [] } =
    ragResult.status === 'fulfilled' ? ragResult.value : {};

  // Persist user message (fire-and-forget, don't block the stream)
  supabaseAdmin
    .from('messages')
    .insert({ conversation_id: convId, role: 'user', content: userQuery })
    .then(() => { })
    .catch((err) => console.error('Error saving user message:', err));

  // ── 4. Build System Prompt ────────────────────────────────
  const profileContext = buildProfileContext(profile);

  const systemPrompt = [
    LUNA_PERSONA,
    profileContext ? `\n## THÔNG TIN VỀ KHÁCH HÀNG\n${profileContext}` : '',
    contextText ? `\n## NGỮ CẢNH TỪ CƠ SỞ DỮ LIỆU\n${contextText}` : '',
    '\n## QUY TẮC ĐỊNH DẠNG KHI TRẢ LỜI',
    'Khi đề cập sản phẩm có link mua, viết link đầy đủ. Hệ thống sẽ tự render thành nút bấm.',
  ]
    .filter(Boolean)
    .join('\n');

  // ── 5. Context Window — only last 5 messages to save tokens ──
  // AI SDK v6: messages are UIMessage objects with `parts` arrays.
  // convertToModelMessages() converts them to the ModelMessage format Gemini needs.
  const recentUIMessages = messages
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .slice(-MAX_HISTORY_MESSAGES);
  const aiMessages = await convertToModelMessages(recentUIMessages);

  // ── 7. Call Gemini via streamText ─────────────────────────
  // maxRetries: 0 — prevents SDK from auto-retrying on 429 (which causes
  // a 9-second hang and makes quota worse, not better).
  let result;
  try {
    result = streamText({
      model: google(AI_MODEL),
      system: systemPrompt,
      messages: aiMessages,
      temperature: 0.7,
      maxTokens: 600,
      maxRetries: 0,  // Never retry — return 429 immediately to frontend
      onFinish: async ({ text }) => {
        try {
          if (convId) {
            await Promise.allSettled([
              // Save assistant reply
              supabaseAdmin.from('messages').insert({
                conversation_id: convId,
                role: 'assistant',
                content: text,
                metadata: {
                  product_ids: products.map((p) => p.id).filter(Boolean),
                  retrieved_count: products.length,
                },
              }),
              // Bump updated_at on the conversation
              supabaseAdmin
                .from('conversations')
                .update({ updated_at: new Date().toISOString() })
                .eq('id', convId),
            ]);
          }

          // Rule-based profile extraction (no extra Gemini call).
          // Only run every 5 messages to reduce Supabase write frequency.
          const totalMessages = messages.length;
          if (totalMessages > 0 && totalMessages % 5 === 0) {
            extractUserProfile(messages)
              .then((extracted) => upsertProfile(supabaseAdmin, sessionId, extracted))
              .catch(() => { });
          }
        } catch (err) {
          console.error('Error in onFinish DB write:', err);
        }
      },
    });
  } catch (err) {
    return handleAIError(err);
  }

  // ── 8. Return streaming response ──────────────────────────
  // AI SDK v6: use toUIMessageStreamResponse() so the new useChat (v3) can parse
  // the UIMessageChunk stream. toTextStreamResponse() is plain text only and
  // is not understood by the new useChat hook.
  try {
    return result.toUIMessageStreamResponse({
      headers: {
        ...(convId ? { 'X-Conversation-Id': String(convId) } : {}),
      },
    });
  } catch (err) {
    return handleAIError(err);
  }
}

// ── Helpers ──────────────────────────────────────────────────

/**
 * Detects Google API quota exhaustion (HTTP 429 / RESOURCE_EXHAUSTED).
 */
function isQuotaError(error) {
  if (!error) return false;
  const msg = String(error?.message ?? error).toLowerCase();
  const status = error?.status ?? error?.statusCode ?? error?.httpStatus;
  return (
    status === 429 ||
    msg.includes('resource_exhausted') ||
    msg.includes('quota') ||
    msg.includes('rate limit') ||
    msg.includes('429')
  );
}

/**
 * Returns a structured JSON Response for AI errors.
 * Returns HTTP 429 for quota errors so the frontend does NOT auto-retry.
 */
function handleAIError(err) {
  console.error('[chat/route] AI error:', err);
  if (isQuotaError(err)) {
    return new Response(
      JSON.stringify({
        error: 'Hệ thống đang bận, vui lòng thử lại sau 1 phút. 🙏',
      }),
      { status: 429, headers: { 'Content-Type': 'application/json' } }
    );
  }
  return new Response(
    JSON.stringify({ error: err.message || String(err) }),
    { status: 500, headers: { 'Content-Type': 'application/json' } }
  );
}

/**
 * Builds a concise profile context string for the system prompt.
 */
function buildProfileContext(profile) {
  if (!profile?.skin_type) return '';
  const parts = [];
  if (profile.skin_type) parts.push(`- Loại da: ${profile.skin_type}`);
  if (profile.concerns?.length) parts.push(`- Vấn đề da: ${profile.concerns.join(', ')}`);
  if (profile.budget) parts.push(`- Ngân sách: ${profile.budget}`);
  if (profile.age_range) parts.push(`- Độ tuổi: ${profile.age_range}`);
  return parts.join('\n');
}
