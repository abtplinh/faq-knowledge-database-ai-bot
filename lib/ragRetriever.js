// lib/ragRetriever.js
import { supabaseAdmin } from './supabase';
import { embedQuery } from './embeddings';

// Top 3 products + Top 3 guidelines = safe token budget for free-tier Gemini
const PRODUCT_MATCH_COUNT = 3;
const GUIDELINE_MATCH_COUNT = 3;
const PRODUCT_THRESHOLD = 0.60;   // Higher = only retrieve very relevant products
const GUIDELINE_THRESHOLD = 0.70;

/**
 * Full RAG retrieval: embed query → RPC → format context string
 * @param {string} query  - user's message
 * @param {object} profile - { skin_type, concerns, budget }
 * @returns {{ contextText: string, products: object[], guidelines: object[] }}
 */
export async function retrieveContext(query, profile = {}) {
  const vector = await embedQuery(query);

  // Run both RPC calls in parallel
  const [productRes, guidelineRes] = await Promise.all([
    supabaseAdmin.rpc('match_products', {
      query_embedding: vector,
      match_count: PRODUCT_MATCH_COUNT,
      ...buildProductFilter(profile),
    }),
    supabaseAdmin.rpc('match_guidelines_faq', {
      query_embedding: vector,
      match_count: GUIDELINE_MATCH_COUNT,
    }),
  ]);

  // ── Layer 1: Similarity Threshold Filter ─────────────────────
  // Only keep documents that pass the minimum similarity score.
  // This is the first line of defence against "knowledge leakage":
  // if nothing passes the threshold, hasContext will be false and
  // the route will NOT inject any context into the LLM prompt.
  const products = (productRes.data || []).filter(p => p.similarity >= PRODUCT_THRESHOLD);
  const guidelines = (guidelineRes.data || []).filter(g => g.similarity >= GUIDELINE_THRESHOLD);

  // Flag consumed by route.js to decide whether to call the LLM or return early.
  const hasContext = products.length > 0 || guidelines.length > 0;

  const contextText = buildContextText(products, guidelines);
  return { contextText, products, guidelines, hasContext };
}

// ─── Helpers ────────────────────────────────────────────────

function buildProductFilter(profile) {
  const filter = {};
  if (profile.skin_type) filter.filter_skin_type = [profile.skin_type];
  return Object.keys(filter).length ? filter : {};
}

function buildContextText(products, guidelines) {
  let text = '';

  if (guidelines.length > 0) {
    text += '## KIẾN THỨC SKINCARE LIÊN QUAN\n\n';
    for (const g of guidelines) {
      text += `### ${g.title || g.topic}\n${g.content}\n\n`;
    }
  }

  if (products.length > 0) {
    text += '## SẢN PHẨM PHÙ HỢP\n\n';
    for (const p of products) {
      text += formatProduct(p) + '\n\n';
    }
  }

  return text.trim();
}

function formatProduct(p) {
  const parts = [
    `**Tên:** ${p.product_name || 'N/A'}`,
    p.brand ? `**Thương hiệu:** ${p.brand}` : null,
    p.product_type ? `**Danh mục:** ${p.product_type}` : null,
    p.price_usd ? `**Giá:** $${Number(p.price_usd).toFixed(2)}` : null,
    p.skin_type ? `**Loại da:** ${Array.isArray(p.skin_type) ? p.skin_type.join(', ') : p.skin_type}` : null,
    p.notable_effects ? `**Công dụng:** ${Array.isArray(p.notable_effects) ? p.notable_effects.join(', ') : p.notable_effects}` : null,
    p.description ? `**Mô tả:** ${p.description.substring(0, 200)}${p.description.length > 200 ? '…' : ''}` : null,
    p.ingredients ? `**Thành phần chính:** ${(Array.isArray(p.ingredients) ? p.ingredients : [p.ingredients]).slice(0, 6).join(', ')}` : null,
    p.product_url ? `**Link mua:** ${p.product_url}` : null,
    p.image_url ? `**Ảnh:** ${p.image_url}` : null,
  ];
  return parts.filter(Boolean).join('\n');
}
