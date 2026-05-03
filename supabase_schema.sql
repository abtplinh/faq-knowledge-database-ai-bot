-- ════════════════════════════════════════════════════════════════
--  T-06 — SUPABASE SCHEMA SETUP: pgvector + 3 collections
-- ════════════════════════════════════════════════════════════════
--
--  CHẠY file này trong Supabase SQL Editor:
--  Dashboard → SQL Editor → New query → Paste → Run
--
--  THỨ TỰ CHẠY (quan trọng):
--    1. Phần A: Extensions
--    2. Phần B: Tables
--    3. Phần C: Indexes
--    4. Phần D: Functions (RPC)
--    5. Phần E: RLS Policies
--    6. Phần F: Verify
-- ════════════════════════════════════════════════════════════════


-- ─────────────────────────────────────────────────────────────────
--  PHẦN A — Extensions
--  pgvector: cho phép lưu và tìm kiếm vector (cosine similarity)
-- ─────────────────────────────────────────────────────────────────

create extension if not exists vector;


-- ─────────────────────────────────────────────────────────────────
--  PHẦN B — 4 Tables
--
--  Mỗi table đại diện 1 "collection" trong RAG system:
--    1. products         ← master_products_clean.json
--    2. ingredients      ← ingredients_enriched.json
--    3. guidelines_faq   ← guidelines_chunks.jsonl + faq_chunks.jsonl
--    4. user_profiles    ← skin quiz results (dùng cho T-11)
--
--  DESIGN DECISION:
--  Dùng embedding vector(768) cho Google Gemini text-embedding-004.
--  Thay đổi số này TRƯỚC KHI ingest — không thể alter vector dimension sau khi có data.
-- ─────────────────────────────────────────────────────────────────


-- TABLE 1: products
-- Lưu 2401 sản phẩm đã merge + vector embedding của description/ingredients
create table if not exists products (
  -- Primary key
  id              text primary key,          -- slug: "cerave_moisturizing_cream..."

  -- Core product info
  product_name    text        not null,
  brand           text,
  product_type    text,                       -- Face Wash | Serum | Moisturiser | ...
  price_raw       text,                       -- "£5.20" | "Rp 209.000" | "$45.00"
  price_usd       numeric(10,2),             -- Đã quy đổi về USD
  description     text,
  how_to_use      text,

  -- Ingredients
  ingredients     text[]      default '{}',  -- Array lowercase canonical names

  -- Filtering metadata — đây là các field quan trọng cho RAG filter
  skin_type       text[]      default '{}',  -- ['Oily', 'Dry', 'Combination']
  notable_effects text[]      default '{}',  -- ['Acne-Free', 'Brightening']
  price_tier      text,                       -- 'budget' | 'mid' | 'luxury'
  step_order      smallint,                   -- 1=Cleanse 2=Tone 3=Serum 4=Moisturize 5=SPF

  -- External links
  image_url       text,
  product_url     text,
  rating          numeric(3,2),              -- 0.00 – 5.00
  review_count    integer,

  -- Source tracking
  source          text,                       -- 'skincare_clean' | 'mp_skin' | 'dermstore'
  _sources        text[]      default '{}',

  -- RAG vector embedding
  -- Được tạo từ: product_name + description + ingredients + skin_type + effects
  embedding       vector(768),

  -- Timestamps
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);

-- TABLE 2: ingredients
-- 259 hoạt chất với mô tả khoa học, tác dụng, đối tượng dùng/tránh
create table if not exists ingredients (
  -- Primary key
  id              text primary key,          -- "ing_niacinamide"

  -- Core ingredient info
  canonical_name  text        not null,      -- "Niacinamide" (đúng case)
  scientific_name text,
  short_description text,
  what_is_it      text,
  what_does_it_do text,

  -- Who should/shouldn't use
  who_is_it_good_for text[]  default '{}',   -- ['Acne', 'Oily', 'Sensitive']
  who_should_avoid   text[]  default '{}',   -- ['Related Allergy']

  -- Synonym mapping
  aliases         text[]     default '{}',   -- ['Vitamin B3', 'Nicotinamide']

  -- External reference
  source_url      text,

  -- Full text for embedding (concat của các fields trên)
  embed_text      text,

  -- RAG vector embedding
  embedding       vector(768),

  created_at      timestamptz default now()
);

-- TABLE 3: guidelines_faq
-- 327 text chunks từ 9 file .txt + 16 FAQ items
create table if not exists guidelines_faq (
  -- Primary key
  id              bigserial primary key,

  -- Chunk identification
  chunk_id        text        not null unique, -- "cac_buoc_skincare_0003"
  source_file     text,                         -- "cac_buoc_skincare.txt" | "faq.json"

  -- Document metadata
  title           text,                         -- Tiêu đề file gốc
  section         text,                         -- H2 header section
  chunk_index     integer,
  total_chunks    integer,

  -- Filtering metadata — dùng để filter trước khi similarity search
  topic           text,   -- enum: general_routine | acne_treatment | brightening | ...
  concern         text[]  default '{}',  -- ['acne', 'moisturizing', 'general']
  skin_type       text[]  default '{}',  -- applicable skin types
  language        text    default 'vi',

  -- FAQ-specific (null cho guideline chunks)
  faq_id          text,
  original_question text,

  -- The actual text content
  content         text        not null,
  estimated_tokens integer,

  -- RAG vector embedding
  embedding       vector(768),

  created_at      timestamptz default now()
);

-- TABLE 4: user_profiles
-- Skin quiz results và conversation context
create table if not exists user_profiles (
  id              uuid primary key default gen_random_uuid(),

  -- Link to Supabase Auth (null nếu anonymous)
  user_id         uuid references auth.users(id) on delete cascade,

  -- Anonymous session tracking
  session_id      text,                     -- UUID tạo ở client-side

  -- Skin assessment (từ Skin Quiz T-14)
  skin_type       text,                     -- 'Oily' | 'Dry' | 'Normal' | 'Combination' | 'Sensitive'
  skin_concerns   text[]  default '{}',     -- ['acne', 'hyperpigmentation', 'anti_aging']
  current_products text[] default '{}',     -- Sản phẩm đang dùng (free text)

  -- Preferences
  budget_tier     text,                     -- 'budget' | 'mid' | 'luxury'
  preferred_language text default 'vi',

  -- Timestamps
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);


-- ─────────────────────────────────────────────────────────────────
--  PHẦN C — INDEXES
--
--  Quan trọng: PHẢI tạo index TRƯỚC KHI ingest data nếu có nhiều records.
--  ivfflat index cần approximate: tốt cho >1000 vectors.
--
--  THAM SỐ: lists = sqrt(số rows)
--    products    (2401 rows) → lists = 49  (≈ sqrt(2401))
--    ingredients (259 rows)  → lists = 16  (≈ sqrt(259))
--    guidelines  (343 rows)  → lists = 18  (≈ sqrt(343))
-- ─────────────────────────────────────────────────────────────────

-- IVFFlat index cho cosine similarity search
-- Tạo sau khi có data: nếu tạo trước thì index rỗng (vẫn hoạt động nhưng kém tối ưu)

create index if not exists products_embedding_idx
  on products using ivfflat (embedding vector_cosine_ops)
  with (lists = 50);

create index if not exists ingredients_embedding_idx
  on ingredients using ivfflat (embedding vector_cosine_ops)
  with (lists = 16);

create index if not exists guidelines_faq_embedding_idx
  on guidelines_faq using ivfflat (embedding vector_cosine_ops)
  with (lists = 20);

-- B-tree indexes cho metadata filtering (WHERE clause)
create index if not exists products_skin_type_idx      on products      using gin (skin_type);
create index if not exists products_notable_effects_idx on products     using gin (notable_effects);
create index if not exists products_ingredients_idx    on products      using gin (ingredients);
create index if not exists products_product_type_idx   on products      (product_type);
create index if not exists products_price_tier_idx     on products      (price_tier);
create index if not exists products_source_idx         on products      (source);

create index if not exists guidelines_topic_idx        on guidelines_faq (topic);
create index if not exists guidelines_concern_idx      on guidelines_faq using gin (concern);
create index if not exists guidelines_skin_type_idx    on guidelines_faq using gin (skin_type);
create index if not exists guidelines_source_idx       on guidelines_faq (source_file);

create index if not exists user_profiles_user_id_idx   on user_profiles (user_id);
create index if not exists user_profiles_session_idx   on user_profiles (session_id);


-- ─────────────────────────────────────────────────────────────────
--  PHẦN D — FUNCTIONS (RPC)
--
--  Đây là các stored procedures được gọi từ LangChain/Next.js.
--  Lý do dùng RPC thay vì query trực tiếp:
--    1. Bảo mật: client không cần biết schema
--    2. Performance: query optimizer tốt hơn với mixed filter + vector
--    3. Tiện: LangChain SupabaseVectorStore dùng match_documents() theo convention
-- ─────────────────────────────────────────────────────────────────

-- FUNCTION 1: match_products
-- Tìm sản phẩm gần nhất theo vector + filter theo skin_type và effects
create or replace function match_products(
  query_embedding  vector(768),
  match_threshold  float    default 0.3,
  match_count      int      default 5,
  filter_skin_type text[]   default null,      -- Nếu null → không filter
  filter_effects   text[]   default null,
  filter_price_max numeric  default null,
  filter_type      text     default null
)
returns table (
  id              text,
  product_name    text,
  brand           text,
  product_type    text,
  price_usd       numeric,
  description     text,
  ingredients     text[],
  skin_type       text[],
  notable_effects text[],
  how_to_use      text,
  image_url       text,
  product_url     text,
  rating          numeric,
  source          text,
  similarity      float
)
language plpgsql
as $$
begin
  return query
  select
    p.id,
    p.product_name,
    p.brand,
    p.product_type,
    p.price_usd,
    p.description,
    p.ingredients,
    p.skin_type,
    p.notable_effects,
    p.how_to_use,
    p.image_url,
    p.product_url,
    p.rating,
    p.source,
    -- Cosine similarity: 1 = identical, -1 = opposite
    1 - (p.embedding <=> query_embedding) as similarity
  from products p
  where
    p.embedding is not null
    and 1 - (p.embedding <=> query_embedding) > match_threshold
    -- Metadata filters (chỉ áp dụng khi param không null)
    and (filter_skin_type is null or p.skin_type && filter_skin_type)
    and (filter_effects is null   or p.notable_effects && filter_effects)
    and (filter_price_max is null or p.price_usd <= filter_price_max)
    and (filter_type is null      or p.product_type ilike '%' || filter_type || '%')
  order by
    p.embedding <=> query_embedding   -- ASC = most similar first
  limit match_count;
end;
$$;


-- FUNCTION 2: match_ingredients
-- Tìm hoạt chất gần nhất theo vector
create or replace function match_ingredients(
  query_embedding  vector(768),
  match_threshold  float  default 0.3,
  match_count      int    default 5
)
returns table (
  id                 text,
  canonical_name     text,
  short_description  text,
  what_does_it_do    text,
  who_is_it_good_for text[],
  who_should_avoid   text[],
  aliases            text[],
  similarity         float
)
language plpgsql
as $$
begin
  return query
  select
    i.id,
    i.canonical_name,
    i.short_description,
    i.what_does_it_do,
    i.who_is_it_good_for,
    i.who_should_avoid,
    i.aliases,
    1 - (i.embedding <=> query_embedding) as similarity
  from ingredients i
  where
    i.embedding is not null
    and 1 - (i.embedding <=> query_embedding) > match_threshold
  order by i.embedding <=> query_embedding
  limit match_count;
end;
$$;


-- FUNCTION 3: match_guidelines_faq
-- Tìm chunks hướng dẫn/FAQ gần nhất + filter theo topic và skin_type
create or replace function match_guidelines_faq(
  query_embedding  vector(768),
  match_threshold  float   default 0.3,
  match_count      int     default 5,
  filter_topic     text    default null,
  filter_skin_type text[]  default null,
  filter_concern   text[]  default null
)
returns table (
  chunk_id          text,
  source_file       text,
  title             text,
  section           text,
  topic             text,
  concern           text[],
  skin_type         text[],
  faq_id            text,
  original_question text,
  content           text,
  similarity        float
)
language plpgsql
as $$
begin
  return query
  select
    g.chunk_id,
    g.source_file,
    g.title,
    g.section,
    g.topic,
    g.concern,
    g.skin_type,
    g.faq_id,
    g.original_question,
    g.content,
    1 - (g.embedding <=> query_embedding) as similarity
  from guidelines_faq g
  where
    g.embedding is not null
    and 1 - (g.embedding <=> query_embedding) > match_threshold
    and (filter_topic is null     or g.topic = filter_topic)
    and (filter_skin_type is null or g.skin_type && filter_skin_type)
    and (filter_concern is null   or g.concern && filter_concern)
  order by g.embedding <=> query_embedding
  limit match_count;
end;
$$;


-- ─────────────────────────────────────────────────────────────────
--  PHẦN E — ROW LEVEL SECURITY (RLS)
--
--  RLS đảm bảo:
--    - Anon user: chỉ đọc (SELECT) products, ingredients, guidelines
--    - Authenticated user: đọc tất cả + ghi user_profiles của mình
--    - Service role (backend): full access
-- ─────────────────────────────────────────────────────────────────

-- Enable RLS trên tất cả tables
alter table products       enable row level security;
alter table ingredients    enable row level security;
alter table guidelines_faq enable row level security;
alter table user_profiles  enable row level security;

-- products: anon + authenticated đều có thể đọc
create policy "products_read_all" on products
  for select using (true);

-- ingredients: anon + authenticated đều có thể đọc
create policy "ingredients_read_all" on ingredients
  for select using (true);

-- guidelines_faq: anon + authenticated đều có thể đọc
create policy "guidelines_faq_read_all" on guidelines_faq
  for select using (true);

-- user_profiles: chỉ đọc/ghi profile của chính mình
create policy "user_profiles_own" on user_profiles
  for all using (
    auth.uid() = user_id
    or session_id = current_setting('app.session_id', true)
  );

-- user_profiles: cho phép insert mới (kể cả anonymous qua session_id)
create policy "user_profiles_insert" on user_profiles
  for insert with check (true);


-- ─────────────────────────────────────────────────────────────────
--  PHẦN F — VERIFY: Chạy sau khi setup xong
-- ─────────────────────────────────────────────────────────────────

-- Kiểm tra tables đã tạo
select table_name, pg_size_pretty(pg_total_relation_size(table_name::regclass)) as size
from information_schema.tables
where table_schema = 'public'
  and table_name in ('products', 'ingredients', 'guidelines_faq', 'user_profiles')
order by table_name;

-- Kiểm tra vector extension
select extname, extversion from pg_extension where extname = 'vector';

-- Kiểm tra functions
select routine_name, routine_type
from information_schema.routines
where routine_schema = 'public'
  and routine_name in ('match_products', 'match_ingredients', 'match_guidelines_faq');

-- Test match_products (sau khi có data)
-- select product_name, similarity
-- from match_products(
--   query_embedding := '[0.1, 0.2, ...]'::vector,
--   filter_skin_type := array['Oily'],
--   filter_effects   := array['Acne-Free']
-- );

-- ============================================================
-- LunaBot: Conversations, Messages & User Profiles Schema
-- Run this in Supabase SQL Editor
-- ============================================================

-- Enable UUID extension (already enabled by default in Supabase)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ────────────────────────────────────────
-- 1. USER PROFILES  (skincare persona)
-- ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_profiles (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  session_id    TEXT NOT NULL UNIQUE,          -- anonymous session key from cookie
  skin_type     TEXT,                          -- Oily | Dry | Combination | Normal | Sensitive
  concerns      TEXT[],                        -- ['acne','dark_spots','aging',…]
  budget        TEXT,                          -- 'low' | 'mid' | 'high'
  age_range     TEXT,                          -- '18-24' | '25-34' | '35-44' | '45+'
  raw_notes     TEXT,                          -- free-form notes captured from conversation
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_profiles_session ON user_profiles(session_id);

-- ────────────────────────────────────────
-- 2. CONVERSATIONS  (chat sessions)
-- ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS conversations (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  session_id    TEXT NOT NULL,
  title         TEXT DEFAULT 'Cuộc trò chuyện mới',
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_conversations_session ON conversations(session_id);
CREATE INDEX IF NOT EXISTS idx_conversations_updated ON conversations(updated_at DESC);

-- ────────────────────────────────────────
-- 3. MESSAGES  (individual chat turns)
-- ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS messages (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role            TEXT NOT NULL CHECK (role IN ('user','assistant','system')),
  content         TEXT NOT NULL,
  metadata        JSONB DEFAULT '{}',          -- store retrieved product IDs, chunk IDs, etc.
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id, created_at ASC);

-- ────────────────────────────────────────
-- 4. AUTO-UPDATE updated_at TRIGGER
-- ────────────────────────────────────────
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_conversations_updated ON conversations;
CREATE TRIGGER trg_conversations_updated
  BEFORE UPDATE ON conversations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS trg_user_profiles_updated ON user_profiles;
CREATE TRIGGER trg_user_profiles_updated
  BEFORE UPDATE ON user_profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ────────────────────────────────────────
-- 5. ROW LEVEL SECURITY (enable but open for anon via session_id)
-- ────────────────────────────────────────
ALTER TABLE conversations  ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages       ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_profiles  ENABLE ROW LEVEL SECURITY;

-- Allow service_role (server) full access
CREATE POLICY "service_role_all_conversations" ON conversations  FOR ALL USING (true);
CREATE POLICY "service_role_all_messages"      ON messages       FOR ALL USING (true);
CREATE POLICY "service_role_all_profiles"      ON user_profiles  FOR ALL USING (true);
