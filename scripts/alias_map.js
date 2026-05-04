#!/usr/bin/env node
/**
 * ════════════════════════════════════════════════════════════════
 *  T-02 — ALIAS MAP & INGREDIENT NORMALIZER
 * ════════════════════════════════════════════════════════════════
 *
 *  INPUT  : data/raw/ingredientsList1.csv   (259 hoạt chất)
 *           data/audit/report.json          (từ T-01)
 *  OUTPUT : data/processed/alias_map.json          ← lookup table
 *           data/processed/normalize_ingredient.js ← reusable util
 *           data/processed/ingredients_enriched.json
 *
 *  CHẠY  : node scripts/T02_alias_map.js
 *
 *  MỤC ĐÍCH:
 *    Khi user hỏi "da dầu nên dùng Vitamin B3 không?", hệ thống
 *    cần biết B3 = Niacinamide để tìm đúng trong vector DB.
 *    Script này xây dựng bảng tra cứu synonym → canonical name.
 * ════════════════════════════════════════════════════════════════
 */

import fs from "fs";
import path from "path";
import { parse } from "csv-parse/sync";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RAW_DIR = path.join(ROOT, "data", "raw");
const OUT_DIR = path.join(ROOT, "data", "processed");

// ─────────────────────────────────────────────────────────────────
//  BƯỚC 1 — ALIAS MAP tĩnh
//  Key   = biến thể (lowercase)   → thường dùng / tên thương mại
//  Value = canonical name         → tên trong ingredientsList.csv
//
//  CÁCH BỔ SUNG: Khi thấy biến thể mới trong clean_ingreds mà
//  không match được, thêm entry vào đây và commit lại.
// ─────────────────────────────────────────────────────────────────
const ALIAS_MAP_RAW = {
    // ── Vitamin tên thương mại → INCI ──
    "vitamin b3": "niacinamide",
    "nicotinamide": "niacinamide",
    "vitamin pp": "niacinamide",

    "vitamin c": "ascorbic acid",
    "l-ascorbic acid": "ascorbic acid",
    "ascorbyl glucoside": "ascorbic acid",       // dạng ester ổn định
    "sodium ascorbyl phosphate": "ascorbic acid",
    "magnesium ascorbyl phosphate": "ascorbic acid",
    "ethyl ascorbic acid": "ascorbic acid",
    "3-o-ethyl ascorbic acid": "ascorbic acid",

    "vitamin e": "tocopherol",
    "tocopheryl acetate": "tocopherol",
    "alpha-tocopherol": "tocopherol",

    "vitamin a": "retinol",
    "retinyl palmitate": "retinol",
    "retinyl acetate": "retinol",
    "retinaldehyde": "retinol",             // dạng mạnh hơn retinol
    "retinal": "retinol",
    "tretinoin": "retinol",             // prescription, nhóm retinoid
    "retinoic acid": "retinol",

    "vitamin b5": "panthenol",
    "d-panthenol": "panthenol",
    "dl-panthenol": "panthenol",
    "pantothenic acid": "panthenol",

    "vitamin b12": "cyanocobalamin",

    "vitamin f": "linoleic acid",
    "vitamin k": "phytonadione",

    // ── Hyaluronic Acid và dạng muối ──
    "ha": "hyaluronic acid",
    "sodium hyaluronate": "hyaluronic acid",     // dạng muối, MW thấp hơn
    "hydrolyzed hyaluronic acid": "hyaluronic acid",   // đã phân cắt

    // ── AHA / BHA / PHA ──
    "aha": "glycolic acid",       // đại diện AHA phổ biến nhất
    "glycolic acid": "glycolic acid",
    "lactic acid": "lactic acid",
    "mandelic acid": "mandelic acid",
    "malic acid": "malic acid",
    "tartaric acid": "tartaric acid",
    "citric acid": "citric acid",

    "bha": "salicylic acid",
    "beta hydroxy acid": "salicylic acid",
    "beta-hydroxy acid": "salicylic acid",
    "willow bark extract": "salicylic acid",      // nguồn tự nhiên của BHA

    "pha": "gluconolactone",
    "glucono delta-lactone": "gluconolactone",
    "gluconolactone": "gluconolactone",

    // ── Peptide ──
    "matrixyl": "palmitoyl pentapeptide-4",   // tên thương mại
    "matrixyl 3000": "palmitoyl tripeptide-1",
    "argireline": "acetyl hexapeptide-3",
    "leuphasyl": "acetyl tetrapeptide-2",

    // ── Thực vật (common name → INCI-like name trong DB) ──
    "tea tree": "melaleuca alternifolia leaf extract",
    "tea tree oil": "melaleuca alternifolia leaf extract",
    "green tea": "camellia sinensis leaf extract",
    "green tea extract": "camellia sinensis leaf extract",
    "centella": "centella asiatica extract",
    "cica": "centella asiatica extract",
    "gotu kola": "centella asiatica extract",
    "madecassoside": "centella asiatica extract",
    "asiaticoside": "centella asiatica extract",
    "aloe": "aloe vera",
    "aloe barbadensis": "aloe vera",
    "aloe barbadensis leaf juice": "aloe vera",
    "licorice": "glycyrrhiza glabra root extract",
    "licorice root extract": "glycyrrhiza glabra root extract",
    "licorice extract": "glycyrrhiza glabra root extract",
    "kojic acid": "kojic acid",           // tự nhiên từ nấm
    "arbutin": "alpha-arbutin",
    "alpha arbutin": "alpha-arbutin",
    "beta arbutin": "arbutin",
    "rosehip": "rosa canina fruit oil",
    "rosehip oil": "rosa canina fruit oil",
    "rosehip seed oil": "rosa canina fruit oil",
    "jojoba": "simmondsia chinensis seed oil",
    "jojoba oil": "simmondsia chinensis seed oil",
    "shea": "butyrospermum parkii butter",
    "shea butter": "butyrospermum parkii butter",
    "bakuchiol": "bakuchiol",            // "retinol thực vật"

    // ── Chất ổn định / texture ──
    "glycerine": "glycerin",
    "glycerol": "glycerin",
    "propylene glycol": "propylene glycol",
    "pg": "propylene glycol",

    // ── Sunscreen actives ──
    "zinc oxide": "zinc oxide",
    "zno": "zinc oxide",
    "titanium dioxide": "titanium dioxide",
    "tio2": "titanium dioxide",
    "avobenzone": "butyl methoxydibenzoylmethane",
    "oxybenzone": "benzophenone-3",

    // ── Exfoliant / enzyme ──
    "papain": "carica papaya fruit extract",
    "bromelain": "ananas sativus fruit extract",
    "pumpkin enzyme": "cucurbita pepo fruit extract",

    // ── Tên viết tắt / tiếng Việt thường dùng ──
    "ceramide": "ceramide np",          // đại diện ceramide group
    "spf": "titanium dioxide",     // heuristic mapping
    "tranexamic acid": "tranexamic acid",
    "azelaic acid": "azelaic acid",
    "benzoyl peroxide": "benzoyl peroxide",
    "bp": "benzoyl peroxide",
    "collagen": "hydrolyzed collagen",
    "resveratrol": "resveratrol",
    "ferulic acid": "ferulic acid",
    "adenosine": "adenosine",
    "epigallocatechin": "camellia sinensis leaf extract",
    "egcg": "camellia sinensis leaf extract",
};

// ─────────────────────────────────────────────────────────────────
//  BƯỚC 2 — Đọc ingredientsList.csv và build canonical index
// ─────────────────────────────────────────────────────────────────

/**
 * parsePythonList — xử lý trường who_is_it_good_for / who_should_avoid
 * Định dạng thực tế: "[' ', 'Acne', ' ', 'Blackheads', ' ']"
 * Cần: ['Acne', 'Blackheads']
 */
function parsePythonList(raw) {
    if (!raw) return [];
    const s = String(raw).trim();

    if (s.startsWith("[") && s.endsWith("]")) {
        try {
            // Thay single-quote → double-quote để JSON.parse được
            const jsonStr = s
                .replace(/'/g, '"')
                .replace(/\bnan\b/gi, "null")
                .replace(/\bNone\b/g, "null");
            const arr = JSON.parse(jsonStr);
            // Filter bỏ null, chuỗi rỗng, chuỗi chỉ có space
            return arr.filter(x => x && String(x).trim().length > 1).map(x => String(x).trim());
        } catch {
            // Fallback: split by comma
            return s.slice(1, -1)
                .split(",")
                .map(x => x.replace(/['"]/g, "").trim())
                .filter(x => x.length > 1);
        }
    }

    return s.split(",").map(x => x.trim()).filter(Boolean);
}

function loadIngredients() {
    const fp = path.join(RAW_DIR, "ingredientsList1.csv");
    const raw = fs.readFileSync(fp, "utf-8");
    const rows = parse(raw, { columns: true, skip_empty_lines: true });

    // Trả về Map: canonical_name_lower → full record
    const byName = new Map();

    for (const row of rows) {
        if (!row.name?.trim()) continue;

        const canonical = row.name.trim().toLowerCase();
        byName.set(canonical, {
            canonical_name: row.name.trim(),
            scientific_name: row.scientific_name?.trim() || null,
            short_description: row.short_description?.trim() || null,
            what_is_it: row.what_is_it?.trim() || null,
            what_does_it_do: row.what_does_it_do?.trim() || null,
            who_is_it_good_for: parsePythonList(row.who_is_it_good_for),
            who_should_avoid: parsePythonList(row.who_should_avoid),
            source_url: row.url?.trim() || null,
        });
    }

    return byName;
}

// ─────────────────────────────────────────────────────────────────
//  BƯỚC 3 — Build alias index đầy đủ (static + dynamic từ CSV)
// ─────────────────────────────────────────────────────────────────

function buildAliasIndex(canonicalMap) {
    // alias_index: alias_lower → canonical_name (đúng case, từ CSV)
    const aliasIndex = new Map();

    // 3a. Thêm tất cả ALIAS_MAP_RAW tĩnh
    for (const [alias, canonical] of Object.entries(ALIAS_MAP_RAW)) {
        aliasIndex.set(alias.toLowerCase(), canonical.toLowerCase());
    }

    // 3b. Mỗi canonical name cũng tự map về chính nó (self-reference)
    for (const [canonical] of canonicalMap) {
        if (!aliasIndex.has(canonical)) {
            aliasIndex.set(canonical, canonical);
        }
    }

    // 3c. Thêm scientific_name làm alias nếu có
    for (const [canonical, data] of canonicalMap) {
        if (data.scientific_name) {
            const sciLower = data.scientific_name.toLowerCase();
            if (!aliasIndex.has(sciLower)) {
                aliasIndex.set(sciLower, canonical);
            }
        }
    }

    return aliasIndex;
}

// ─────────────────────────────────────────────────────────────────
//  BƯỚC 4 — normalizeIngredient function
//  Đây là function quan trọng nhất — được dùng lại ở T-03, T-06
// ─────────────────────────────────────────────────────────────────

/**
 * normalizeIngredient(raw, aliasIndex, canonicalMap)
 *
 * Input  : "Vitamin B3" (bất kỳ cách viết nào)
 * Output : {
 *   input          : "Vitamin B3",
 *   normalized     : "niacinamide",         ← tên canonical lowercase
 *   canonical_name : "Niacinamide",         ← tên đúng case từ CSV
 *   found          : true,                  ← có trong database không?
 *   data           : { what_does_it_do, who_should_avoid, ... }
 * }
 */
function createNormalizer(aliasIndex, canonicalMap) {
    return function normalizeIngredient(raw) {
        if (!raw) return { input: raw, normalized: null, found: false, data: null };

        const input = String(raw).trim();
        const lower = input.toLowerCase()
            // Bỏ dấu ngoặc đơn và phần trong ngoặc (vd: "Aqua (Water)" → "aqua")
            .replace(/\s*\(.*?\)/g, "")
            // Bỏ ký tự đặc biệt thừa
            .replace(/[*†‡]/g, "")
            .trim();

        // Tìm trong alias index
        const normalized = aliasIndex.get(lower);

        if (!normalized) {
            // Thử fuzzy: bỏ hyphens và spaces để match "alpha arbutin" ↔ "alpha-arbutin"
            const fuzzy = lower.replace(/[-\s]+/g, "");
            for (const [alias, canon] of aliasIndex) {
                if (alias.replace(/[-\s]+/g, "") === fuzzy) {
                    const data = canonicalMap.get(canon);
                    return { input, normalized: canon, canonical_name: data?.canonical_name ?? canon, found: true, data: data ?? null };
                }
            }

            return { input, normalized: lower, canonical_name: input, found: false, data: null };
        }

        const data = canonicalMap.get(normalized);
        return {
            input,
            normalized,
            canonical_name: data?.canonical_name ?? normalized,
            found: true,
            data: data ?? null,
        };
    };
}

// ─────────────────────────────────────────────────────────────────
//  BƯỚC 5 — Xuất normalizer dưới dạng module JS dùng lại
// ─────────────────────────────────────────────────────────────────

function writeNormalizerModule(aliasIndexObj) {
    const code = `/**
 * AUTO-GENERATED bởi T02_alias_map.js — KHÔNG SỬA TAY
 * Để thêm alias mới: sửa ALIAS_MAP_RAW trong T02 rồi chạy lại
 *
 * CÁCH DÙNG trong T-03, T-06, T-07:
 *   import { normalizeIngredient, ALIAS_MAP } from './normalize_ingredient.js';
 *
 *   normalizeIngredient("Vitamin B3")
 *   // → { normalized: "niacinamide", found: true, canonical_name: "Niacinamide", data: {...} }
 */

// Bảng alias đầy đủ (${Object.keys(aliasIndexObj).length} entries)
export const ALIAS_MAP = ${JSON.stringify(aliasIndexObj, null, 2)};

/**
 * Normalize 1 ingredient string về canonical name
 * @param {string} raw   - Tên ingredient thô (bất kỳ format nào)
 * @returns {{ input, normalized, canonical_name, found, data }}
 */
export function normalizeIngredient(raw) {
  if (!raw) return { input: raw, normalized: null, found: false, data: null };

  const input  = String(raw).trim();
  const lower  = input.toLowerCase()
    .replace(/\\s*\\(.*?\\)/g, "")   // bỏ phần trong ngoặc
    .replace(/[*†‡]/g, "")
    .trim();

  const normalized = ALIAS_MAP[lower];

  if (!normalized) {
    // Fuzzy: bỏ hyphens+spaces
    const fuzzy = lower.replace(/[-\\s]+/g, "");
    for (const [alias, canon] of Object.entries(ALIAS_MAP)) {
      if (alias.replace(/[-\\s]+/g, "") === fuzzy) {
        return { input, normalized: canon, canonical_name: canon, found: true, data: null };
      }
    }
    return { input, normalized: lower, canonical_name: input, found: false, data: null };
  }

  return { input, normalized, canonical_name: normalized, found: true, data: null };
}

/**
 * Normalize mảng ingredients (dùng trong ETL)
 * @param {string[]} arr - Mảng tên ingredient thô
 * @returns {string[]}   - Mảng canonical names (lowercase)
 */
export function normalizeIngredientList(arr) {
  return arr
    .map(x => normalizeIngredient(x).normalized)
    .filter(Boolean);
}
`;

    fs.writeFileSync(path.join(OUT_DIR, "normalize_ingredient.js"), code);
    console.log("  ✅ normalize_ingredient.js đã ghi");
}

// ─────────────────────────────────────────────────────────────────
//  BƯỚC 6 — Chạy coverage test: bao nhiêu % ingredients trong
//           skincare_products_clean.csv được resolve trong alias map?
// ─────────────────────────────────────────────────────────────────

function runCoverageTest(normalizer) {
    const fp = path.join(RAW_DIR, "skincare_products_clean.csv");
    const raw = fs.readFileSync(fp, "utf-8");
    const records = parse(raw, { columns: true, skip_empty_lines: true });

    const allIngredients = new Set();
    const notFound = new Set();

    for (const row of records) {
        const ingreds = parseIngredsFromClean(row.clean_ingreds);
        for (const ing of ingreds) {
            allIngredients.add(ing);
            const result = normalizer(ing);
            if (!result.found) notFound.add(ing);
        }
    }

    const total = allIngredients.size;
    const found = total - notFound.size;
    const coverage = Math.round((found / total) * 100);

    console.log(`\n  📊 Coverage Test (skincare_products_clean.csv):`);
    console.log(`     Unique ingredients: ${total}`);
    console.log(`     Resolved: ${found} (${coverage}%)`);
    console.log(`     Not found: ${notFound.size}`);

    // In top 20 không tìm thấy để dev bổ sung alias
    const notFoundArr = [...notFound].sort().slice(0, 20);
    console.log(`\n  ⚠️  Top ${notFoundArr.length} ingredients chưa có trong alias map:`);
    notFoundArr.forEach(x => console.log(`     - "${x}"`));

    return { total, found, coverage, notFound: [...notFound] };
}

/**
 * Parse clean_ingreds từ skincare_products_clean.csv
 * Format: "['capric triglyceride', 'cetyl alcohol', ...]"
 */
function parseIngredsFromClean(raw) {
    if (!raw) return [];
    const s = String(raw).trim();
    try {
        const jsonStr = s.replace(/'/g, '"');
        const arr = JSON.parse(jsonStr);
        return arr.filter(Boolean).map(x => String(x).trim().toLowerCase()).filter(x => x.length > 1);
    } catch {
        return s.replace(/[\[\]'"]/g, "").split(",").map(x => x.trim()).filter(x => x.length > 1);
    }
}

// ─────────────────────────────────────────────────────────────────
//  MAIN
// ─────────────────────────────────────────────────────────────────
async function main() {
    if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

    console.log("🔗 T-02: Build Alias Map & Ingredient Normalizer...\n");

    // 1. Load canonical ingredient data từ CSV
    console.log("  Đọc ingredientsList1.csv...");
    const canonicalMap = loadIngredients();
    console.log(`  ✅ Loaded ${canonicalMap.size} canonical ingredients`);

    // 2. Build alias index
    console.log("  Build alias index...");
    const aliasIndex = buildAliasIndex(canonicalMap);
    console.log(`  ✅ Alias index: ${aliasIndex.size} entries (static + self-ref + scientific names)`);

    // 3. Tạo normalizer function
    const normalizer = createNormalizer(aliasIndex, canonicalMap);

    // 4. Coverage test
    const coverage = runCoverageTest(normalizer);

    // 5. Ghi alias_map.json
    const aliasIndexObj = Object.fromEntries(aliasIndex);
    fs.writeFileSync(
        path.join(OUT_DIR, "alias_map.json"),
        JSON.stringify({
            generatedAt: new Date().toISOString(),
            totalEntries: aliasIndex.size,
            coverage,
            map: aliasIndexObj,
        }, null, 2)
    );
    console.log("\n  ✅ alias_map.json đã ghi");

    // 6. Ghi enriched ingredients (thêm aliases vào mỗi record)
    const enriched = [];
    for (const [canonical, data] of canonicalMap) {
        const aliases = Object.entries(aliasIndexObj)
            .filter(([, v]) => v === canonical && v !== canonical.toLowerCase())
            .map(([k]) => k);

        enriched.push({ ...data, id: `ing_${canonical.replace(/[^a-z0-9]+/g, "_").slice(0, 40)}`, aliases });
    }

    fs.writeFileSync(
        path.join(OUT_DIR, "ingredients_enriched.json"),
        JSON.stringify({ generatedAt: new Date().toISOString(), count: enriched.length, ingredients: enriched }, null, 2)
    );
    console.log("  ✅ ingredients_enriched.json đã ghi");

    // 7. Ghi normalize_ingredient.js module
    writeNormalizerModule(aliasIndexObj);

    console.log("\n✅ T-02 XONG!\n");
    console.log("📁 Output:");
    console.log("   data/processed/alias_map.json");
    console.log("   data/processed/ingredients_enriched.json");
    console.log("   data/processed/normalize_ingredient.js  ← import vào T-03, T-07");

    // Quick smoke test
    console.log("\n🧪 Smoke test normalizer:");
    const tests = [
        "Vitamin B3", "niacinamide", "sodium hyaluronate", "BHA",
        "Tea Tree", "retinal", "Matrixyl", "glycerine",
    ];
    tests.forEach(t => {
        const r = normalizer(t);
        console.log(`   "${t}" → "${r.normalized}" (found: ${r.found})`);
    });
}

main().catch(err => { console.error(err); process.exit(1); });