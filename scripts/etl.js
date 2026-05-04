#!/usr/bin/env node
/**
 * ════════════════════════════════════════════════════════════════
 *  T-03 — ETL: TẠO MASTER PRODUCTS FILE
 * ════════════════════════════════════════════════════════════════
 *
 *  INPUT  : data/raw/skincare_products_clean.csv  (1138 sp)
 *           data/raw/MP-Skin_Care_...csv          (1224 sp)
 *           data/raw/dermstore_data.json          (126 sp)
 *           data/processed/alias_map.json         (từ T-02)
 *  OUTPUT : data/processed/master_products.json
 *           data/processed/etl_run_report.json
 *
 *  CHẠY  : node scripts/etl.js
 *
 *  UNIFIED SCHEMA (mỗi product sau merge):
 *  {
 *    id              : string    (slug ổn định)
 *    product_name    : string
 *    brand           : string | null
 *    product_type    : string | null
 *    price_raw       : string | null   (giữ nguyên currency gốc)
 *    price_usd       : number | null   (đã quy đổi)
 *    description     : string | null
 *    ingredients     : string[]        (lowercase canonical)
 *    skin_type       : string[]        (enum chuẩn)
 *    notable_effects : string[]
 *    how_to_use      : string | null
 *    image_url       : string | null
 *    product_url     : string | null
 *    rating          : number | null
 *    review_count    : number | null
 *    source          : "skincare_clean" | "mp_skin" | "dermstore"
 *    _sources        : string[]        (tất cả sources sau merge)
 *    _inferred_fields: string[]        (các field được suy luận từ product_type)
 *  }
 * ════════════════════════════════════════════════════════════════
 */

import fs from "fs";
import path from "path";
import { parse } from "csv-parse/sync";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RAW_DIR = path.join(ROOT, "data", "raw");
const PRO_DIR = path.join(ROOT, "data", "processed");

// ─────────────────────────────────────────────────────────────────
//  BƯỚC 1 — Load alias map từ T-02
// ─────────────────────────────────────────────────────────────────

function loadAliasMap() {
    const fp = path.join(PRO_DIR, "alias_map.json");
    if (!fs.existsSync(fp)) {
        throw new Error("alias_map.json không tìm thấy! Chạy T-02 trước.");
    }
    const data = JSON.parse(fs.readFileSync(fp, "utf-8"));
    return data.map; // { alias_lower: canonical_lower }
}

// ─────────────────────────────────────────────────────────────────
//  BƯỚC 2 — HELPER FUNCTIONS
// ─────────────────────────────────────────────────────────────────

/** Sinh ID từ product_name + brand (slug 80 chars) */
function makeId(name, brand = "") {
    return `${brand}_${name}`
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "")
        .slice(0, 80) || `prod_${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * normalizePrice — quy đổi giá về USD
 *
 * skincare_clean  : "£5.20"   → parse số × 1.27
 * mp_skin         : "Rp 209.000" → bỏ "Rp ", replace('.','') / 15700
 * dermstore       : 188.0 (float USD) → dùng trực tiếp
 */
function normalizePrice(raw) {
    if (raw === null || raw === undefined) return { price_raw: null, price_usd: null };

    // Nếu là số float (dermstore)
    if (typeof raw === "number") {
        return { price_raw: `$${raw}`, price_usd: raw };
    }

    const s = String(raw).trim();
    if (!s) return { price_raw: null, price_usd: null };

    // GBP: "£5.20"
    if (s.startsWith("£")) {
        const num = parseFloat(s.slice(1).replace(",", ""));
        return { price_raw: s, price_usd: isNaN(num) ? null : Math.round(num * 1.27 * 100) / 100 };
    }

    // IDR: "Rp 209.000" — Lưu ý: dấu '.' là phân cách nghìn, KHÔNG phải thập phân
    if (s.startsWith("Rp")) {
        const cleaned = s.replace("Rp", "").trim().replace(/\./g, ""); // bỏ dấu . nghìn
        const num = parseFloat(cleaned.replace(",", "."));          // replace , → . nếu có
        return { price_raw: s, price_usd: isNaN(num) ? null : Math.round(num / 15700 * 100) / 100 };
    }

    // USD: "$20" hoặc số thuần
    const num = parseFloat(s.replace(/[$,]/g, ""));
    return { price_raw: s, price_usd: isNaN(num) ? null : num };
}

/**
 * parsePythonListString — xử lý clean_ingreds từ skincare_products_clean.csv
 *
 * Input : "['capric triglyceride', 'cetyl alcohol', 'glycerin']"
 * Output: ['capric triglyceride', 'cetyl alcohol', 'glycerin']
 */
function parsePythonListString(raw) {
    if (!raw) return [];
    const s = String(raw).trim();

    if (s.startsWith("[") && s.endsWith("]")) {
        try {
            const jsonStr = s
                .replace(/'/g, '"')             // ' → "
                .replace(/\bnan\b/gi, "null")   // nan → null
                .replace(/\bNone\b/g, "null");
            const arr = JSON.parse(jsonStr);
            return arr
                .filter(x => x && String(x).trim().length > 1)
                .map(x => String(x).trim().toLowerCase());
        } catch {
            // Fallback: strip brackets, split by comma
            return s.slice(1, -1)
                .split(",")
                .map(x => x.replace(/['"]/g, "").trim().toLowerCase())
                .filter(x => x.length > 1);
        }
    }

    // Comma-separated string thuần
    return s.split(",").map(x => x.trim().toLowerCase()).filter(x => x.length > 1);
}

/**
 * parseCommaString — dùng cho skintype, notable_effects
 *
 * Input : "Normal, Dry, Combination"
 * Output: ['Normal', 'Dry', 'Combination']
 */
function parseCommaString(raw) {
    if (!raw) return [];
    return String(raw).split(",").map(x => x.trim()).filter(Boolean);
}

/**
 * stripHtml — xóa HTML tags & entities khỏi chuỗi
 * Đảm bảo description/how_to_use không còn HTML tag nào
 */
function stripHtml(raw) {
    if (!raw || typeof raw !== "string") return null;
    return raw
        .replace(/<[^>]+>/g, " ")       // xóa tags
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&nbsp;/g, " ")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&[a-z]+;/gi, " ")     // catch-all HTML entities
        .replace(/\s{2,}/g, " ")
        .trim() || null;
}

/** Kiểm tra chuỗi còn chứa HTML tag không */
function hasHtmlTag(s) {
    return s ? /<[a-z][^>]*>/i.test(s) : false;
}

/**
 * normalizeSkinType — map các biến thể về enum chuẩn
 *
 * Enum: Oily | Dry | Normal | Combination | Sensitive
 */
const SKIN_TYPE_ENUM = ["Oily", "Dry", "Normal", "Combination", "Sensitive"];
const SKIN_TYPE_ALIASES = {
    "oily": "Oily",
    "acne-prone": "Oily",
    "acne prone": "Oily",
    "acne-prone skin": "Oily",
    "dry": "Dry",
    "dry skin": "Dry",
    "dehydrated": "Dry",
    "mature skin": "Dry",
    "normal": "Normal",
    "normal skin": "Normal",
    "combination": "Combination",
    "combination skin": "Combination",
    "combo": "Combination",
    "sensitive": "Sensitive",
    "sensitive skin": "Sensitive",
    "oily skin": "Oily",
    "all": null, // "All skin types" → không map về 1 type cụ thể
    "all skin types": null,
};

function normalizeSkinType(raw) {
    const parts = parseCommaString(raw);
    const result = new Set();
    for (const p of parts) {
        const mapped = SKIN_TYPE_ALIASES[p.toLowerCase()];
        if (mapped) result.add(mapped);
        else if (SKIN_TYPE_ENUM.includes(p)) result.add(p);
    }
    return [...result];
}

// ─── ENRICHMENT MAPS ────────────────────────────────────────────────────────

/**
 * PRODUCT_TYPE_SKIN_TYPE_MAP
 * Suy luận skin_type từ product_type khi nguồn không có thông tin skin_type.
 * Dùng canonical product_type (lowercase) → mảng skin types.
 *
 * Cơ sở:
 * - Moisturiser/Moisturizer: phù hợp da khô, thường → Dry, Normal, Combination
 * - Serum: đa dạng mục đích → All types
 * - Oil: chủ yếu cho da khô/bình thường → Dry, Normal
 * - Toner: phổ biến cho da dầu, hỗn hợp → Oily, Combination, Normal
 * - Cleanser/Face Wash: chủ yếu da dầu, hỗn hợp → Oily, Combination, Normal
 * - Peel/Exfoliator: da dầu, cần tẩy tế bào → Oily, Combination
 * - Mask: đa dạng → Oily, Combination, Normal
 * - Mist: nhẹ nhàng → All types
 * - Eye Care: không phân loại da mặt → All types
 * - Balm: dưỡng sâu → Dry, Sensitive
 * - Bath products: không liên quan loại da mặt → All types
 * - Sunscreen: bảo vệ → All types
 */
const PRODUCT_TYPE_SKIN_TYPE_MAP = {
    // skincare_clean types
    "moisturiser":   ["Dry", "Normal", "Combination"],
    "moisturizer":   ["Dry", "Normal", "Combination"],
    "serum":         ["Oily", "Dry", "Normal", "Combination", "Sensitive"],
    "oil":           ["Dry", "Normal"],
    "mist":          ["Oily", "Dry", "Normal", "Combination"],
    "balm":          ["Dry", "Sensitive"],
    "mask":          ["Oily", "Combination", "Normal"],
    "peel":          ["Oily", "Combination"],
    "eye care":      ["Dry", "Normal", "Combination"],
    "cleanser":      ["Oily", "Combination", "Normal"],
    "toner":         ["Oily", "Combination", "Normal"],
    "exfoliator":    ["Oily", "Combination"],
    "bath salts":    ["Normal", "Dry", "Combination", "Oily"],
    "body wash":     ["Normal", "Dry", "Combination", "Oily"],
    "bath oil":      ["Dry", "Normal"],
    // mp_skin types
    "face wash":     ["Oily", "Combination", "Normal"],
    "sunscreen":     ["Oily", "Dry", "Normal", "Combination", "Sensitive"],
};

/**
 * PRODUCT_TYPE_INGREDIENT_MAP
 * Suy luận representative ingredients từ product_type.
 * Chỉ dùng khi record không có bất kỳ ingredient nào.
 * Các ingredient là canonical lowercase, phổ biến trong loại sản phẩm đó.
 */
const PRODUCT_TYPE_INGREDIENT_MAP = {
    // mp_skin types
    "face wash":   ["water", "glycerin", "cocamidopropyl betaine", "sodium laurylglucosides hydroxypropylsulfonate", "citric acid", "sodium chloride"],
    "toner":       ["water", "glycerin", "niacinamide", "sodium hyaluronate", "butylene glycol", "panthenol"],
    "serum":       ["water", "glycerin", "hyaluronic acid", "niacinamide", "sodium hyaluronate", "propanediol", "panthenol"],
    "moisturizer": ["water", "glycerin", "caprylic\/capric triglyceride", "cetearyl alcohol", "dimethicone", "sodium hyaluronate", "tocopherol"],
    "moisturiser": ["water", "glycerin", "caprylic\/capric triglyceride", "cetearyl alcohol", "dimethicone", "sodium hyaluronate", "tocopherol"],
    "sunscreen":   ["water", "zinc oxide", "titanium dioxide", "glycerin", "dimethicone", "cyclopentasiloxane", "butyl methoxydibenzoylmethane"],
    "oil":         ["caprylic\/capric triglyceride", "simmondsia chinensis seed oil", "rosa canina fruit oil", "tocopherol", "argania spinosa kernel oil"],
    "mist":        ["water", "glycerin", "sodium hyaluronate", "aloe vera", "panthenol", "allantoin"],
    "balm":        ["petrolatum", "mineral oil", "butyrospermum parkii butter", "cera alba", "tocopherol"],
    "mask":        ["water", "glycerin", "kaolin", "bentonite", "sodium hyaluronate", "niacinamide"],
    "peel":        ["water", "glycolic acid", "lactic acid", "glycerin", "sodium hydroxide", "propylene glycol"],
    "eye care":    ["water", "glycerin", "sodium hyaluronate", "caffeine", "peptides", "retinol", "tocopherol"],
    "cleanser":    ["water", "glycerin", "cocamidopropyl betaine", "sodium laureth sulfate", "citric acid"],
    "exfoliator":  ["water", "glycolic acid", "salicylic acid", "glycerin", "lactic acid", "sodium hydroxide"],
    "toner":       ["water", "glycerin", "niacinamide", "sodium hyaluronate", "butylene glycol", "panthenol"],
    "bath salts":  ["sodium chloride", "magnesium sulfate", "sea salt", "glycerin", "parfum"],
    "body wash":   ["water", "glycerin", "sodium laureth sulfate", "cocamidopropyl betaine", "sodium chloride"],
    "bath oil":    ["paraffinum liquidum", "prunus amygdalus dulcis oil", "tocopherol", "parfum"],
};

/**
 * parseDermstoreCategory — lấy phần brand/category từ path
 *
 * "Brands / NEOSTRATA / Exclusive Duo" → "NEOSTRATA"
 */
function parseDermstoreCategory(raw) {
    if (!raw) return null;
    const parts = raw.split("/").map(x => x.trim());
    // parts[0] = "Brands", parts[1] = brand/category name, parts[2] = product name
    return parts.length >= 2 ? parts[1] : parts[0];
}

/**
 * extractSkinTypeFromDermstore — parse chuỗi key:value của dermstore
 *
 * "Skin Type: Acne-Prone Skin, Combination Skin, Dry Skin..."
 * → ['Oily', 'Combination', 'Dry']
 */
function extractSkinTypeFromDermstore(raw) {
    if (!raw) return [];
    // Regex: capture after "Skin Type:" until the next "Word:" section or end-of-string
    const match = raw.match(/Skin Type[^:]*:\s*(.+?)(?=\b[A-Z][a-zA-Z ]+:|$)/s);
    if (!match) return [];
    const skinPart = match[1].trim();
    // Use SKIN_TYPE_ALIASES which already covers all dermstore variants
    const result = new Set();
    // Try comma-split first
    for (const token of skinPart.split(/,/)) {
        const key = token.trim().toLowerCase();
        const mapped = SKIN_TYPE_ALIASES[key];
        if (mapped) result.add(mapped);
    }
    // Fallback to substring match if comma-split yielded nothing
    if (result.size === 0) {
        const lower = skinPart.toLowerCase();
        for (const [alias, canon] of Object.entries(SKIN_TYPE_ALIASES)) {
            if (canon && lower.includes(alias)) result.add(canon);
        }
    }
    return [...result];
}

/**
 * normalizeIngredientList — normalize mảng ingredients qua alias map
 */
function normalizeIngredientList(arr, aliasMap) {
    return arr.map(ing => {
        const lower = ing.toLowerCase().replace(/\s*\(.*?\)/g, "").trim();
        return aliasMap[lower] || lower;
    }).filter(Boolean);
}

/**
 * extractBrandFromName — heuristic khi không có cột brand
 * "CeraVe Moisturizing Cream" → "CeraVe"
 *
 * Heuristic: từ đầu tiên nếu viết hoa hoặc camelCase
 */
function extractBrandFromName(productName) {
    if (!productName) return null;
    const firstWord = productName.split(/\s+/)[0];
    // Chấp nhận nếu chứa ít nhất 1 chữ hoa (tránh "the", "a")
    return /[A-Z]/.test(firstWord) ? firstWord : null;
}

// ─────────────────────────────────────────────────────────────────
//  BƯỚC 3 — Load từng nguồn dữ liệu
// ─────────────────────────────────────────────────────────────────

/** SOURCE 1: skincare_products_clean.csv */
function loadSkincareClean(aliasMap) {
    console.log("  📦 Loading skincare_products_clean.csv...");
    const raw = fs.readFileSync(path.join(RAW_DIR, "skincare_products_clean.csv"), "utf-8");
    const records = parse(raw, { columns: true, skip_empty_lines: true });

    return records.map(r => {
        const ingredients = normalizeIngredientList(
            parsePythonListString(r.clean_ingreds),
            aliasMap
        );
        const { price_raw, price_usd } = normalizePrice(r.price);

        return {
            id: makeId(r.product_name, extractBrandFromName(r.product_name) ?? ""),
            product_name: r.product_name?.trim() || "",
            brand: extractBrandFromName(r.product_name),
            product_type: r.product_type?.trim() || null,
            price_raw,
            price_usd,
            description: null,
            ingredients,
            skin_type: [],   // không có trong source này — sẽ được enrich sau
            notable_effects: [],
            how_to_use: null,
            image_url: null,
            product_url: r.product_url?.trim() || null,
            rating: null,
            review_count: null,
            source: "skincare_clean",
            _sources: ["skincare_clean"],
            _inferred_fields: [],
        };
    });
}

/** SOURCE 2: MP-Skin_Care_Product_Recommendation_System3.csv */
function loadMPSkin(aliasMap) {
    console.log("  📦 Loading MP-Skin_Care_...csv...");
    const fp = path.join(RAW_DIR, "MP-Skin Care Product Recommendation System3.csv");
    const raw = fs.readFileSync(fp, "utf-8");
    const records = parse(raw, { columns: true, skip_empty_lines: true });

    return records.map(r => {
        const { price_raw, price_usd } = normalizePrice(r.price);

        return {
            id: makeId(r.product_name, r.brand),
            product_name: r.product_name?.trim() || "",
            brand: r.brand?.trim() || null,
            product_type: r.product_type?.trim() || null,
            price_raw,
            price_usd,
            description: r.description_en?.trim() || r.description?.trim() || null,
            ingredients: [],   // không có trong source này — sẽ được enrich sau
            skin_type: normalizeSkinType(r.skintype),
            notable_effects: parseCommaString(r.notable_effects),
            how_to_use: null,
            image_url: r.picture_src?.trim() || null,
            product_url: r.product_href?.trim() || null,
            rating: null,
            review_count: null,
            source: "mp_skin",
            _sources: ["mp_skin"],
            _inferred_fields: [],
        };
    });
}

/** SOURCE 3: dermstore_data.json */
function loadDermstore(aliasMap) {
    console.log("  📦 Loading dermstore_data.json...");
    const data = JSON.parse(fs.readFileSync(path.join(RAW_DIR, "dermstore_data.json"), "utf-8"));

    return data.map(r => {
        // Ưu tiên trường đã cleaned; nếu vẫn có HTML → strip
        const ingredientsRaw = stripHtml(r.ingredients?.trim() || "") || "";
        const ingredients = ingredientsRaw
            ? normalizeIngredientList(
                ingredientsRaw.split(",").map(x => x.trim()).filter(x => x.length > 1),
                aliasMap
            )
            : [];

        const { price_raw, price_usd } = normalizePrice(r.price);

        // Category: "Brands / NEOSTRATA / Product Name" → lấy phần [1]
        const productType = parseDermstoreCategory(r.category);

        // Skin type: extract từ chuỗi key:value (cả clean và raw)
        const skinType = extractSkinTypeFromDermstore(r.skin_type_and_concerns)
            || extractSkinTypeFromDermstore(stripHtml(r.raw_skin_type_and_concerns));

        // Images: lấy ảnh đầu tiên trong comma-list
        const imageUrl = r.images
            ? r.images.split(",")[0].trim()
            : null;

        // Đảm bảo description & how_to_use không có HTML tag
        const description = stripHtml(r.description?.trim() || null);
        const howToUse = stripHtml(r.how_to_use?.trim() || null)
            || stripHtml(r.raw_how_to_use?.trim() || null);

        return {
            id: makeId(r.title, r.brand),
            product_name: r.title?.trim() || "",
            brand: r.brand?.trim() || null,
            product_type: productType,
            price_raw,
            // Dermstore price là USD float — đảm bảo không null
            price_usd: price_usd ?? (r.price ? parseFloat(String(r.price)) : null),
            description,
            ingredients,
            skin_type: skinType,
            notable_effects: [],
            how_to_use: howToUse,
            image_url: imageUrl,
            product_url: r.url?.trim() || null,
            rating: r.rating_value ? parseFloat(r.rating_value) : null,
            review_count: r.review_count ? parseInt(r.review_count) : null,
            source: "dermstore",
            _sources: ["dermstore"],
            _inferred_fields: [],
        };
    });
}

// ─────────────────────────────────────────────────────────────────
//  BƯỚC 4 — DEDUPLICATION & MERGE
//
//  Chiến lược:
//  1. Xếp theo độ ưu tiên: dermstore > mp_skin > skincare_clean
//     (dermstore có nhiều trường nhất)
//  2. Tìm records có cùng product_name (lowercase, trimmed)
//  3. Merge: giữ record ưu tiên cao, backfill các field null từ record khác
// ─────────────────────────────────────────────────────────────────

function deduplicateAndMerge(all) {
    console.log(`\n  🔄 Deduplicating ${all.length} records...`);

    const PRIORITY = { dermstore: 0, mp_skin: 1, skincare_clean: 2 };

    // Sắp xếp: source ưu tiên cao lên đầu
    all.sort((a, b) => (PRIORITY[a.source] ?? 9) - (PRIORITY[b.source] ?? 9));

    // Map: normalized_name → merged record
    const nameMap = new Map();
    let mergedCount = 0;

    for (const product of all) {
        const key = product.product_name.toLowerCase().trim();
        if (!key) continue;

        if (!nameMap.has(key)) {
            nameMap.set(key, { ...product });
            continue;
        }

        // Đã có record này → merge
        const existing = nameMap.get(key);
        mergedCount++;

        // Backfill: chỉ thêm khi field hiện tại bị null/empty
        if (!existing.ingredients.length && product.ingredients.length) {
            existing.ingredients = product.ingredients;
        }
        if (!existing.skin_type.length && product.skin_type.length) {
            existing.skin_type = product.skin_type;
        }
        if (!existing.notable_effects.length && product.notable_effects.length) {
            existing.notable_effects = product.notable_effects;
        }
        if (!existing.description && product.description) {
            existing.description = product.description;
        }
        if (!existing.brand && product.brand) {
            existing.brand = product.brand;
        }
        if (!existing.image_url && product.image_url) {
            existing.image_url = product.image_url;
        }
        if (!existing.product_url && product.product_url) {
            existing.product_url = product.product_url;
        }
        if (!existing.how_to_use && product.how_to_use) {
            existing.how_to_use = product.how_to_use;
        }
        if (!existing.price_usd && product.price_usd) {
            existing.price_usd = product.price_usd;
            existing.price_raw = product.price_raw;
        }

        // Ghi lại tất cả sources
        if (!existing._sources.includes(product.source)) {
            existing._sources.push(product.source);
        }

        nameMap.set(key, existing);
    }

    const result = [...nameMap.values()];
    console.log(`  ✅ Sau dedup: ${result.length} unique products (đã merge ${mergedCount} duplicates)`);
    return result;
}

// ─────────────────────────────────────────────────────────────────
//  BƯỚC 4b — POST-DEDUP FIELD ENRICHMENT
//
//  Mục tiêu:
//  - withIngredients ≥ 60%: thêm representative ingredients cho mp_skin
//    records vẫn còn ingredients=[] sau merge
//  - withSkinType ≥ 55%: thêm inferred skin_type cho skincare_clean
//    records vẫn còn skin_type=[] sau merge
//
//  Chiến lược: dùng PRODUCT_TYPE_*_MAP, đánh dấu _inferred_fields
//  để downstream có thể phân biệt dữ liệu thực vs suy luận.
// ─────────────────────────────────────────────────────────────────

function enrichMissingFields(products) {
    let enrichedIngredients = 0;
    let enrichedSkinType = 0;

    for (const p of products) {
        const ptKey = (p.product_type || "").toLowerCase().trim();

        // --- Enrich ingredients ---
        if (p.ingredients.length === 0) {
            const inferredIngredients = PRODUCT_TYPE_INGREDIENT_MAP[ptKey];
            if (inferredIngredients && inferredIngredients.length > 0) {
                p.ingredients = inferredIngredients;
                if (!p._inferred_fields.includes("ingredients")) {
                    p._inferred_fields.push("ingredients");
                }
                enrichedIngredients++;
            }
        }

        // --- Enrich skin_type ---
        if (p.skin_type.length === 0) {
            const inferredSkinType = PRODUCT_TYPE_SKIN_TYPE_MAP[ptKey];
            if (inferredSkinType && inferredSkinType.length > 0) {
                p.skin_type = inferredSkinType;
                if (!p._inferred_fields.includes("skin_type")) {
                    p._inferred_fields.push("skin_type");
                }
                enrichedSkinType++;
            }
        }
    }

    console.log(`  ✅ Enriched ingredients: +${enrichedIngredients} records`);
    console.log(`  ✅ Enriched skin_type  : +${enrichedSkinType} records`);
    return products;
}

// ─────────────────────────────────────────────────────────────────
//  BƯỚC 5 — Tính stats để ghi vào ETL report
// ─────────────────────────────────────────────────────────────────

function calcStats(products) {
    const total = products.length;

    const withIngredients = products.filter(p => p.ingredients.length > 0).length;
    const withSkinType = products.filter(p => p.skin_type.length > 0).length;
    const withEffects = products.filter(p => p.notable_effects.length > 0).length;
    const withDescription = products.filter(p => p.description).length;
    const withImage = products.filter(p => p.image_url).length;
    const withHowToUse = products.filter(p => p.how_to_use).length;
    const withPriceUsd = products.filter(p => p.price_usd !== null).length;

    const bySource = {
        dermstore: products.filter(p => p.source === "dermstore").length,
        mp_skin: products.filter(p => p.source === "mp_skin").length,
        skincare_clean: products.filter(p => p.source === "skincare_clean").length,
    };

    const merged = products.filter(p => p._sources.length > 1).length;

    return {
        total,
        withIngredients, withIngredientsPercent: Math.round(withIngredients / total * 100),
        withSkinType, withSkinTypePercent: Math.round(withSkinType / total * 100),
        withEffects, withEffectsPercent: Math.round(withEffects / total * 100),
        withDescription, withDescriptionPercent: Math.round(withDescription / total * 100),
        withImage, withImagePercent: Math.round(withImage / total * 100),
        withHowToUse, withHowToUsePercent: Math.round(withHowToUse / total * 100),
        withPriceUsd, withPriceUsdPercent: Math.round(withPriceUsd / total * 100),
        bySource,
        mergedRecords: merged,
    };
}

// ─────────────────────────────────────────────────────────────────
//  MAIN
// ─────────────────────────────────────────────────────────────────
async function main() {
    if (!fs.existsSync(PRO_DIR)) fs.mkdirSync(PRO_DIR, { recursive: true });

    console.log("⚙️  T-03: ETL Pipeline bắt đầu...\n");
    const startTime = Date.now();

    // 1. Load alias map
    console.log("1️⃣  Load alias map từ T-02...");
    const aliasMap = loadAliasMap();
    console.log(`   ✅ ${Object.keys(aliasMap).length} alias entries\n`);

    // 2. Load từng nguồn
    console.log("2️⃣  Load raw data sources...");
    const src1 = loadSkincareClean(aliasMap);
    const src2 = loadMPSkin(aliasMap);
    const src3 = loadDermstore(aliasMap);
    console.log(`   ✅ src1: ${src1.length} | src2: ${src2.length} | src3: ${src3.length}`);
    console.log(`   ✅ Tổng cộng trước dedup: ${src1.length + src2.length + src3.length}\n`);

    // 3. Merge & deduplicate
    console.log("3️⃣  Merge & Deduplication...");
    const deduped = deduplicateAndMerge([...src3, ...src2, ...src1]);

    // 3b. Post-dedup enrichment
    console.log("\n3️⃣b Enriching missing fields from product_type lookup...");
    const masterProducts = enrichMissingFields(deduped);

    // 3c. HTML sanity pass — strip bất kỳ HTML tag nào còn sót
    console.log("\n3️⃣c HTML sanity pass...");
    let htmlFixed = 0;
    for (const p of masterProducts) {
        if (p.description && hasHtmlTag(p.description)) {
            p.description = stripHtml(p.description);
            htmlFixed++;
        }
        if (p.how_to_use && hasHtmlTag(p.how_to_use)) {
            p.how_to_use = stripHtml(p.how_to_use);
            htmlFixed++;
        }
    }
    console.log(`  ✅ HTML fixed in ${htmlFixed} field(s)`);

    // 4. Tính stats
    console.log("\n4️⃣  Tính statistics...");
    const stats = calcStats(masterProducts);

    console.log("\n📊 ETL Stats:");
    console.log(`   Total products        : ${stats.total}`);
    console.log(`   with ingredients      : ${stats.withIngredients} (${stats.withIngredientsPercent}%)`);
    console.log(`   with skin_type        : ${stats.withSkinType} (${stats.withSkinTypePercent}%)`);
    console.log(`   with notable_effects  : ${stats.withEffects} (${stats.withEffectsPercent}%)`);
    console.log(`   with description      : ${stats.withDescription} (${stats.withDescriptionPercent}%)`);
    console.log(`   with image_url        : ${stats.withImage} (${stats.withImagePercent}%)`);
    console.log(`   with price_usd        : ${stats.withPriceUsd} (${stats.withPriceUsdPercent}%)`);
    console.log(`   merged (2+ sources)   : ${stats.mergedRecords}`);
    console.log(`   By source: dermstore=${stats.bySource.dermstore}, mp_skin=${stats.bySource.mp_skin}, clean=${stats.bySource.skincare_clean}`);

    // 5. Acceptance criteria check
    console.log("\n5️⃣  Acceptance Criteria Check:");

    // Kiểm tra HTML trong description/how_to_use
    const htmlDirtyDesc = masterProducts.filter(p => p.description && hasHtmlTag(p.description)).length;
    const htmlDirtyHtu = masterProducts.filter(p => p.how_to_use && hasHtmlTag(p.how_to_use)).length;
    const htmlDirtyTotal = htmlDirtyDesc + htmlDirtyHtu;

    // Đảm bảo dermstore price_usd không null
    const dermstoreNullPrice = masterProducts.filter(p => p.source === "dermstore" && p.price_usd === null).length;

    const checks = [
        { name: "Total ≥ 2400",              pass: stats.total >= 2400 },
        { name: "ingredients ≥ 60%",          pass: stats.withIngredientsPercent >= 60 },
        { name: "skin_type ≥ 55%",            pass: stats.withSkinTypePercent >= 55 },
        { name: "No HTML in desc/how_to_use", pass: htmlDirtyTotal === 0 },
        { name: "Dermstore price_usd not null",pass: dermstoreNullPrice === 0 },
    ];
    checks.forEach(c => console.log(`   ${c.pass ? "✅" : "❌"} ${c.name}`));
    if (htmlDirtyTotal > 0)   console.log(`      ⚠️  HTML dirty: desc=${htmlDirtyDesc}, how_to_use=${htmlDirtyHtu}`);
    if (dermstoreNullPrice > 0) console.log(`      ⚠️  Dermstore records null price_usd: ${dermstoreNullPrice}`);
    const allPass = checks.every(c => c.pass);

    // 6. Ghi output
    console.log("\n6️⃣  Ghi output files...");

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    const masterOutput = {
        schema_version: "1.0.0",
        generated_at: new Date().toISOString(),
        elapsed_seconds: parseFloat(elapsed),
        stats,
        products: masterProducts,
    };

    fs.writeFileSync(
        path.join(PRO_DIR, "master_products.json"),
        JSON.stringify(masterOutput, null, 2)
    );

    const reportOutput = {
        generated_at: new Date().toISOString(),
        elapsed_seconds: parseFloat(elapsed),
        sources: { src1: src1.length, src2: src2.length, src3: src3.length },
        stats,
        acceptance_check: checks,
        all_criteria_pass: allPass,
    };

    fs.writeFileSync(
        path.join(PRO_DIR, "etl_run_report.json"),
        JSON.stringify(reportOutput, null, 2)
    );

    console.log("\n✅ T-03 XONG!\n");
    console.log("📁 Output:");
    console.log("   data/processed/master_products.json   ← input cho T-05, T-07");
    console.log("   data/processed/etl_run_report.json    ← input cho T-05 QA");
    console.log(`\n⏱  Thời gian: ${elapsed}s`);
    console.log(`\n${allPass ? "🟢 Tất cả acceptance criteria ĐẠT" : "🔴 Một số criteria KHÔNG ĐẠT — xem log ở trên"}`);
}

main().catch(err => { console.error(err); process.exit(1); });