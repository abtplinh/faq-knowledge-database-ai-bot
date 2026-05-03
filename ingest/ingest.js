#!/usr/bin/env node
import fs from "fs";
import path from "path";
import { createClient } from "@supabase/supabase-js";
import { parse } from "csv-parse/sync";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RAW_DIR = path.join(ROOT, "data", "raw");
const PRO_DIR = path.join(ROOT, "data", "processed");

// CONFIG
const GEMINI_MODEL = "gemini-embedding-001";
const EMBED_DIMS = 768;
const INSERT_BATCH = 50;  // items per Supabase upsert
const CHUNK_SIZE = 50;  // items per embedBatch call
// Throttle: 1 request per INTERVAL => 40 RPM (safe under 100)
const INTERVAL_MS = 1500;

// STEP 1 — validate & init
function validateEnv() {
    const needed = ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "GEMINI_API_KEY"];
    const miss = needed.filter(k => !process.env[k]);
    if (miss.length) throw new Error("Thieu env:\n" + miss.join("\n"));
}
let supabase;
function initClients() {
    supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL,
        process.env.SUPABASE_SERVICE_ROLE_KEY,
        { auth: { persistSession: false } }
    );
}

// STEP 2 — throttle + embed
const sleep = ms => new Promise(r => setTimeout(r, ms));
let _lastTs = 0;
async function throttle() {
    const wait = INTERVAL_MS - (Date.now() - _lastTs);
    if (wait > 0) await sleep(wait);
    _lastTs = Date.now();
}

function isRPD(body) {
    const t = (body || "").toLowerCase();
    return (t.includes("quota") && t.includes("exceeded")) ||
        t.includes("per day") || t.includes("daily") ||
        (t.includes("resource_exhausted") && !t.includes("rate_limit_exceeded"));
}

async function embedOne(text, taskType = "RETRIEVAL_DOCUMENT", attempt = 1) {
    await throttle();
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:embedContent?key=${process.env.GEMINI_API_KEY}`;
    let res;
    try {
        res = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                model: `models/${GEMINI_MODEL}`,
                content: { parts: [{ text: String(text || "").slice(0, 7500) }] },
                taskType,
                outputDimensionality: EMBED_DIMS,
            }),
        });
    } catch (e) {
        if (attempt > 3) throw e;
        await sleep(5000); return embedOne(text, taskType, attempt + 1);
    }

    if (res.status === 429) {
        const body = await res.text();
        if (isRPD(body)) {
            console.error("\n\n  DAILY QUOTA HET cho hom nay.");
            console.error("  Chi tiet:", body.slice(0, 200));
            console.error("  Quota reset 00:00 GMT (07:00 sang VN). Chay lai script vao ngay mai.");
            process.exit(0);
        }
        if (attempt > 5) throw new Error("Qua 5 lan retry RPM 429");
        const retryAfter = res.headers.get("Retry-After");
        const wait = retryAfter ? parseInt(retryAfter) * 1000 : 65000;
        process.stdout.write(`\n  RPM 429 lan ${attempt}/5, doi ${Math.round(wait / 1000)}s...`);
        await sleep(wait);
        _lastTs = 0;
        return embedOne(text, taskType, attempt + 1);
    }
    if (!res.ok) throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return (await res.json()).embedding.values;
}

async function embedBatch(texts, taskType = "RETRIEVAL_DOCUMENT") {
    const out = [];
    for (let i = 0; i < texts.length; i++) {
        out.push(await embedOne(texts[i], taskType));
        process.stdout.write(`\r  embed ${i + 1}/${texts.length}...`);
    }
    return out;
}

// STEP 3 — progress bar
function bar(cur, tot, label = "") {
    const pct = Math.round(cur / tot * 100);
    const b = "x".repeat(Math.round(pct / 5)) + ".".repeat(20 - Math.round(pct / 5));
    process.stdout.write(`\r  [${b}] ${pct}% ${cur}/${tot} ${label}`);
    if (cur === tot) process.stdout.write("\n");
}

// STEP 4 — supabase helpers
async function existingIds(table, col = "id") {
    const ids = new Set(); let from = 0;
    while (true) {
        const { data } = await supabase.from(table).select(col).range(from, from + 999);
        if (!data || !data.length) break;
        data.forEach(r => ids.add(r[col]));
        if (data.length < 1000) break;
        from += 1000;
    }
    return ids;
}

async function upsert(table, rows, conflict = "id") {
    const seen = new Set();
    const deduped = rows.filter(r => {
        if (seen.has(r[conflict])) return false;
        seen.add(r[conflict]); return true;
    });
    for (let i = 0; i < deduped.length; i += INSERT_BATCH) {
        const { error } = await supabase.from(table)
            .upsert(deduped.slice(i, i + INSERT_BATCH), { onConflict: conflict, ignoreDuplicates: true });
        if (error) console.error(`\n  Supabase [${table}]: ${error.message}`);
    }
}

// helpers
function productText(p) {
    return [p.product_name, p.brand && `by ${p.brand}`, p.product_type,
    p.description && p.description.slice(0, 400),
    p.skin_type?.length && `Phu hop: ${p.skin_type.join(", ")}`,
    p.notable_effects?.length && `Cong dung: ${p.notable_effects.join(", ")}`,
    p.ingredients?.slice(0, 15).join(", ")].filter(Boolean).join(". ");
}
function ingredientText(ing) {
    return [ing.canonical_name, ing.short_description, ing.what_does_it_do,
    ing.who_is_it_good_for?.length && `Tot cho: ${ing.who_is_it_good_for.join(", ")}`,
    ing.who_should_avoid?.length && `Tranh: ${ing.who_should_avoid.join(", ")}`].filter(Boolean).join(". ");
}
function priceTier(u) { return !u ? null : u < 20 ? "budget" : u < 60 ? "mid" : "luxury"; }
function stepOrder(t) {
    return {
        "Face Wash": 1, "Cleanser": 1, "Exfoliator": 2, "Toner": 3, "Serum": 4, "Essence": 4,
        "Eye Cream": 5, "Moisturiser": 6, "Moisturizer": 6, "Facial Oil": 7, "Sunscreen": 8
    }[t] ?? null;
}
function parsePyList(raw) {
    if (!raw) return [];
    const s = String(raw).trim();
    if (s.startsWith("[")) {
        try {
            return JSON.parse(s.replace(/'/g, '"').replace(/\bnan\b/gi, "null"))
                .filter(x => x && String(x).trim().length > 1).map(x => String(x).trim());
        }
        catch { return s.slice(1, -1).split(",").map(x => x.replace(/['"]/g, "").trim()).filter(x => x.length > 1); }
    }
    return s.split(",").map(x => x.trim()).filter(Boolean);
}

// INGEST PRODUCTS
async function ingestProducts() {
    console.log("\n  COLLECTION 1: PRODUCTS\n");
    const fp = path.join(PRO_DIR, "master_products.json");
    if (!fs.existsSync(fp)) throw new Error("master_products.json khong tim thay");
    const { products } = JSON.parse(fs.readFileSync(fp, "utf-8"));
    console.log(`  Loaded: ${products.length}`);
    const existing = await existingIds("products");
    const todo = products.filter(p => !existing.has(p.id));
    console.log(`  DB co: ${existing.size}, can insert: ${todo.length}`);
    if (!todo.length) { console.log("  Skip\n"); return; }
    const estMin = Math.ceil(todo.length * INTERVAL_MS / 60000);
    console.log(`  Uoc tinh: ~${estMin} phut (${todo.length} items x ${INTERVAL_MS}ms)\n`);

    let done = 0;
    for (let i = 0; i < todo.length; i += CHUNK_SIZE) {
        const batch = todo.slice(i, i + CHUNK_SIZE);
        const vecs = await embedBatch(batch.map(productText));
        bar(i + batch.length, todo.length, "products");
        await upsert("products", batch.map((p, j) => ({
            id: p.id, product_name: p.product_name, brand: p.brand ?? null,
            product_type: p.product_type ?? null, price_raw: p.price_raw ?? null,
            price_usd: p.price_usd ?? null, description: p.description ?? null,
            how_to_use: p.how_to_use ?? null, ingredients: p.ingredients ?? [],
            skin_type: p.skin_type ?? [], notable_effects: p.notable_effects ?? [],
            price_tier: priceTier(p.price_usd), step_order: stepOrder(p.product_type),
            image_url: p.image_url ?? null, product_url: p.product_url ?? null,
            rating: p.rating ?? null, review_count: p.review_count ?? null,
            source: p.source, _sources: p._sources ?? [p.source], embedding: vecs[j],
        })));
        done += batch.length;
    }
    console.log(`\n  Inserted ${done} products\n`);
}

// INGEST INGREDIENTS
async function ingestIngredients() {
    console.log("\n  COLLECTION 2: INGREDIENTS\n");
    let ings = [];
    const enriched = path.join(PRO_DIR, "ingredients_enriched.json");
    if (fs.existsSync(enriched)) {
        const d = JSON.parse(fs.readFileSync(enriched, "utf-8"));
        if (d.count > 0) { ings = d.ingredients; console.log(`  Loaded: ${d.count}`); }
    }
    if (!ings.length) {
        const csvPath = path.join(RAW_DIR, "ingredientsList1.csv");
        if (!fs.existsSync(csvPath)) { console.log("  Skip\n"); return; }
        const records = parse(fs.readFileSync(csvPath, "utf-8"), { columns: true, skip_empty_lines: true, bom: true, trim: true });
        const aliasPath = path.join(PRO_DIR, "alias_map.json");
        const aliasMap = fs.existsSync(aliasPath) ? JSON.parse(fs.readFileSync(aliasPath, "utf-8")).map || {} : {};
        ings = records.filter(r => r.name?.trim()).map(r => {
            const canonical = r.name.trim().toLowerCase();
            return {
                id: `ing_${canonical.replace(/[^a-z0-9]+/g, "_").slice(0, 40)}`,
                canonical_name: r.name.trim(), scientific_name: r.scientific_name?.trim() || null,
                short_description: r.short_description?.trim() || null, what_is_it: r.what_is_it?.trim() || null,
                what_does_it_do: r.what_does_it_do?.trim() || null,
                who_is_it_good_for: parsePyList(r.who_is_it_good_for),
                who_should_avoid: parsePyList(r.who_should_avoid), source_url: r.url?.trim() || null,
                aliases: Object.entries(aliasMap).filter(([, v]) => v === canonical).map(([k]) => k)
            };
        });
        console.log(`  Parsed: ${ings.length} from CSV`);
    }
    const existing = await existingIds("ingredients");
    const todo = ings.filter(i => !existing.has(i.id));
    console.log(`  DB co: ${existing.size}, can insert: ${todo.length}`);
    if (!todo.length) { console.log("  Skip\n"); return; }
    let done = 0;
    for (let i = 0; i < todo.length; i += CHUNK_SIZE) {
        const batch = todo.slice(i, i + CHUNK_SIZE);
        const vecs = await embedBatch(batch.map(ingredientText));
        bar(i + batch.length, todo.length, "ingredients");
        await upsert("ingredients", batch.map((ing, j) => ({
            id: ing.id, canonical_name: ing.canonical_name,
            scientific_name: ing.scientific_name ?? null, short_description: ing.short_description ?? null,
            what_is_it: ing.what_is_it ?? null, what_does_it_do: ing.what_does_it_do ?? null,
            who_is_it_good_for: ing.who_is_it_good_for ?? [], who_should_avoid: ing.who_should_avoid ?? [],
            aliases: ing.aliases ?? [], source_url: ing.source_url ?? null,
            embed_text: ingredientText(ing), embedding: vecs[j],
        })));
        done += batch.length;
    }
    console.log(`\n  Inserted ${done} ingredients\n`);
}

// INGEST GUIDELINES + FAQ
function readJsonl(fp) {
    if (!fs.existsSync(fp)) return [];
    return fs.readFileSync(fp, "utf-8").trim().split("\n").filter(Boolean).map(l => JSON.parse(l));
}
async function ingestGuidelinesFaq() {
    console.log("\n  COLLECTION 3: GUIDELINES + FAQ\n");
    const all = [...readJsonl(path.join(PRO_DIR, "guidelines_chunks.jsonl")),
    ...readJsonl(path.join(PRO_DIR, "faq_chunks.jsonl"))];
    console.log(`  Total chunks: ${all.length}`);
    const existing = await existingIds("guidelines_faq", "chunk_id");
    const todo = all.filter(c => !existing.has(c.chunk_id));
    console.log(`  DB co: ${existing.size}, can insert: ${todo.length}`);
    if (!todo.length) { console.log("  Skip\n"); return; }
    let done = 0;
    for (let i = 0; i < todo.length; i += CHUNK_SIZE) {
        const batch = todo.slice(i, i + CHUNK_SIZE);
        const vecs = await embedBatch(batch.map(c => c.content));
        bar(i + batch.length, todo.length, "chunks");
        await upsert("guidelines_faq", batch.map((c, j) => ({
            chunk_id: c.chunk_id, source_file: c.source_file, title: c.title ?? null,
            section: c.section ?? null, chunk_index: c.chunk_index ?? 0, total_chunks: c.total_chunks ?? 1,
            topic: c.topic, concern: c.concern ?? [], skin_type: c.skin_type ?? [],
            language: c.language ?? "vi", faq_id: c.faq_id ?? null,
            original_question: c.original_question ?? null, content: c.content,
            estimated_tokens: c.estimated_tokens ?? 0, embedding: vecs[j],
        })), "chunk_id");
        done += batch.length;
    }
    console.log(`\n  Inserted ${done} chunks\n`);
}

// VERIFY
async function verify() {
    console.log("  VERIFY\n");
    for (const t of ["products", "ingredients", "guidelines_faq"]) {
        const { count } = await supabase.from(t).select("*", { count: "exact", head: true });
        console.log(`  ${t.padEnd(20)}: ${count} rows`);
    }
    const qVec = await embedOne("da dau mun nen dung gi", "RETRIEVAL_QUERY");
    const { data, error } = await supabase.rpc("match_products", {
        query_embedding: qVec, match_threshold: 0.2, match_count: 3, filter_skin_type: ["Oily"],
    });
    if (error) console.log(`  RPC error: ${error.message}`);
    else {
        console.log(`  match_products: ${data.length} results`);
        data.forEach(r => console.log(`    "${r.product_name.slice(0, 45)}" sim=${r.similarity.toFixed(3)}`));
    }
    const { count: pC } = await supabase.from("products").select("*", { count: "exact", head: true });
    const { count: iC } = await supabase.from("ingredients").select("*", { count: "exact", head: true });
    const { count: gC } = await supabase.from("guidelines_faq").select("*", { count: "exact", head: true });
    // [{ n: "products >= 2400", p: (pC ?? 0) >= 2400, v: pC },
    // { n: "ingredients >= 259", p: (iC ?? 0) >= 259, v: iC },
    // { n: "guidelines_faq >= 300", p: (gC ?? 0) >= 300, v: gC },
    // { n: "RPC ok", p: !error, v: data?.length }
    // ].forEach(c => console.log(`    ${c.p ? "OK" : "FAIL"} ${c.n} (${c.v})`));
}

// MAIN
async function main() {
    console.log("T-07: INGEST -> SUPABASE");
    console.log(`Model: ${GEMINI_MODEL} | Throttle: 1 req/${INTERVAL_MS}ms = ${Math.round(60000 / INTERVAL_MS)} RPM`);
    console.log("NOTE: Free tier 1500 RPD. Script tu dong dung khi het quota.\n");
    validateEnv(); initClients();
    const t0 = Date.now();
    await ingestProducts();
    await ingestIngredients();
    await ingestGuidelinesFaq();
    await verify();
    const s = Math.round((Date.now() - t0) / 1000);
    console.log(`\nTong: ${Math.floor(s / 60)}m${s % 60}s`);
}
main().catch(err => { console.error("\n", err.message); process.exit(1); });
