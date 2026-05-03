// lib/profileExtractor.js
// Rule-based user profile extraction — NO Gemini API call needed.
// This saves ~1 API call per chat message, reducing quota usage by ~33%.

/**
 * Extract user profile from last N messages using keyword/regex rules.
 * @param {Array<{role:string, content:string}>} messages
 * @returns {Promise<{skin_type,concerns,budget,age_range}>}
 */
export async function extractUserProfile(messages) {
  const recent = messages.slice(-10);
  const userText = recent
    .filter((m) => m.role === 'user')
    .map((m) => m.content)
    .join(' ')
    .toLowerCase();

  // ── Skin type detection ────────────────────────────────────
  let skin_type = null;
  if (/da dầu|oily skin|da bóng/i.test(userText)) skin_type = 'Oily';
  else if (/da khô|dry skin|da bị khô/i.test(userText)) skin_type = 'Dry';
  else if (/da hỗn hợp|combination skin/i.test(userText)) skin_type = 'Combination';
  else if (/da nhạy cảm|sensitive skin|da hay kích ứng/i.test(userText)) skin_type = 'Sensitive';
  else if (/da thường|normal skin/i.test(userText)) skin_type = 'Normal';

  // ── Concerns detection ─────────────────────────────────────
  const concerns = [];
  if (/mụn|acne|pimple|nổi mụn/i.test(userText)) concerns.push('acne');
  if (/thâm|dark spot|đốm nâu|tàn nhang/i.test(userText)) concerns.push('dark_spots');
  if (/lão hóa|aging|nếp nhăn|wrinkle/i.test(userText)) concerns.push('aging');
  if (/đỏ|redness|mẩn đỏ/i.test(userText)) concerns.push('redness');
  if (/lỗ chân lông|pore|毛穴/i.test(userText)) concerns.push('pores');
  if (/khô da|dryness|thiếu ẩm|dehydrat/i.test(userText)) concerns.push('dryness');
  if (/dầu nhờn|oiliness|nhờn bóng/i.test(userText)) concerns.push('oiliness');
  if (/kích ứng|sensitivity|nhạy cảm/i.test(userText)) concerns.push('sensitivity');

  // ── Budget detection ───────────────────────────────────────
  let budget = null;
  if (/bình dân|rẻ|tiết kiệm|dưới 200|budget|cheap/i.test(userText)) budget = 'low';
  else if (/trung bình|tầm trung|mid.?range|200.?500/i.test(userText)) budget = 'mid';
  else if (/cao cấp|luxury|đắt|premium|trên 500/i.test(userText)) budget = 'high';

  // ── Age range detection ────────────────────────────────────
  let age_range = null;
  if (/\b1[89]\b|\b2[0-4]\b|tuổi teen|sinh viên/i.test(userText)) age_range = '18-24';
  else if (/\b2[5-9]\b|\b3[0-4]\b/i.test(userText)) age_range = '25-34';
  else if (/\b3[5-9]\b|\b4[0-4]\b/i.test(userText)) age_range = '35-44';
  else if (/\b4[5-9]\b|\b[5-9]\d\b|trung niên/i.test(userText)) age_range = '45+';

  return { skin_type, concerns, budget, age_range };
}

/**
 * Upsert profile into Supabase user_profiles table
 */
export async function upsertProfile(supabase, sessionId, extracted, rawNotes = '') {
  const existing = await supabase
    .from('user_profiles')
    .select('*')
    .eq('session_id', sessionId)
    .single();

  const base = existing.data || {};

  const merged = {
    session_id: sessionId,
    skin_type: extracted.skin_type || base.skin_type || null,
    concerns: mergeArrays(base.concerns, extracted.concerns),
    budget: extracted.budget || base.budget || null,
    age_range: extracted.age_range || base.age_range || null,
    raw_notes: rawNotes || base.raw_notes || '',
  };

  await supabase
    .from('user_profiles')
    .upsert(merged, { onConflict: 'session_id' });

  return merged;
}

function mergeArrays(a = [], b = []) {
  return [...new Set([...(a || []), ...(b || [])])];
}
