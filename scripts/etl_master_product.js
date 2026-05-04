/**
 * ETL Script: Skincare Knowledge Base Normalization
 * Chuẩn hóa dữ liệu từ 3 nguồn sản phẩm → Master Product File
 * Stack: Next.js / Node.js (chạy với `node etl_master_product.js`)
 *
 * Input:
 *   - skincare_products_clean.csv     (1,138 sản phẩm, có ingredients)
 *   - MP-Skin_Care_...csv             (1,224 sản phẩm, có skin_type & effects)
 *   - dermstore_data.json             (126 sản phẩm cao cấp, có HTML)
 *
 * Output:
 *   - master_products.json            (Unified schema)
 *   - ingredients_dict.json           (Normalized ingredient dictionary)
 */

import fs from "fs";
import path from "path";
import { parse } from "csv-parse/sync";

// ─── CONFIG ────────────────────────────────────────────────────────────────
const DATA_DIR = "./data/raw"; // Thư mục chứa file gốc
const OUT_DIR = "./data/processed";

const SCHEMA_VERSION = "1.0.0";

// ─── UNIFIED PRODUCT SCHEMA ────────────────────────────────────────────────
/**
 * Canonical schema cho mỗi sản phẩm sau khi merge:
 * {
 *   id: string,                   // Unique ID (sha256 của product_name+brand)
 *   product_name: string,
 *   brand: string | null,
 *   product_type: string,         // Face Wash, Moisturiser, Serum...
 *   price: string | null,         // Giữ nguyên currency string (£, $, Rp)
 *   price_usd: number | null,     // Chuẩn hóa sang USD nếu có thể
 *   description: string | null,
 *   ingredients: string[],        // Mảng tên ingredient (lowercase, trimmed)
 *   skin_type: string[],          // ["Oily", "Dry", "Combination", ...]
 *   notable_effects: string[],    // ["Brightening", "Acne-Free", ...]
 *   how_to_use: string | null,
 *   image_url: string | null,
 *   product_url: string | null,
 *   source: string,               // "skincare_clean" | "mp_skin" | "dermstore"
 *   rating: number | null,
 *   review_count: number | null,
 *   _raw_meta: object,            // Debug: giữ lại trường gốc
 * }
 */

// ─── HELPERS ───────────────────────────────────────────────────────────────

/**
 * Xóa HTML tags & entities khỏi chuỗi
 * (xử lý raw_ingredients, raw_how_to_use trong dermstore)
 */
function stripHtml(raw) {
    if (!raw || typeof raw !== "string") return null;
    return raw
        .replace(/<[^>]+>/g, " ") // xóa tags
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&nbsp;/g, " ")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/\s{2,}/g, " ") // collapse whitespace
        .trim();
}

/**
 * Parse list-string sang JS array
 * Xử lý nhiều định dạng: "['a', 'b']" | "a, b, c" | JSON array
 */
function parseIngredients(raw) {
    if (!raw) return [];
    if (Array.isArray(raw)) return raw.map((s) => s.trim().toLowerCase());

    const str = String(raw).trim();

    // Dạng Python-list: ['capric triglyceride', 'glycerin', ...]
    if (str.startsWith("[") && str.endsWith("]")) {
        try {
            // Thay single quotes → double quotes để JSON.parse
            const jsonStr = str
                .replace(/'/g, '"')
                .replace(/\bnan\b/g, "null")
                .replace(/\bNone\b/g, "null");
            const arr = JSON.parse(jsonStr);
            return arr
                .filter(Boolean)
                .map((s) => String(s).trim().toLowerCase())
                .filter((s) => s.length > 1);
        } catch {
            // fallback: split by comma inside brackets
            return str
                .slice(1, -1)
                .split(",")
                .map((s) => s.replace(/['"\s]/g, "").toLowerCase())
                .filter((s) => s.length > 1);
        }
    }

    // Plain comma-separated: "niacinamide, glycerin, water"
    return str
        .split(",")
        .map((s) => s.trim().toLowerCase())
        .filter((s) => s.length > 1);
}

/**
 * Parse skin_type string → array
 * "Normal, Dry, Combination" → ["Normal", "Dry", "Combination"]
 */
function parseSkinType(raw) {
    if (!raw) return [];
    if (Array.isArray(raw)) return raw;
    return String(raw)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
}

/**
 * Parse notable_effects string → array
 * "Brightening, Acne-Free, Anti-Aging" → ["Brightening", "Acne-Free", "Anti-Aging"]
 */
function parseEffects(raw) {
    if (!raw) return [];
    if (Array.isArray(raw)) return raw;
    return String(raw)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
}

/**
 * Tạo stable ID từ product_name + brand (slug-safe)
 * Không cần crypto; dùng slug đơn giản là đủ cho dev stage
 */
function makeId(name, brand = "") {
    const base = `${brand}_${name}`
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_|_$/g, "")
        .slice(0, 80);
    return base || `product_${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Normalize price string → USD float (best-effort)
 * Trả về null nếu không thể convert
 */
function normalizePrice(raw) {
    if (!raw) return null;
    const str = String(raw).trim();

    // Loại bỏ currency symbols và thousand separators
    const digits = str.replace(/[^0-9.,]/g, "").replace(",", ".");
    const num = parseFloat(digits);
    if (isNaN(num)) return null;

    // Heuristic conversion (rough, for dev only; dùng FX API nếu cần chính xác)
    if (str.includes("£")) return Math.round(num * 1.27 * 100) / 100; // GBP→USD
    if (str.includes("Rp")) return Math.round((num / 15700) * 100) / 100; // IDR→USD
    if (str.includes("$") || str.includes("USD")) return num;

    return num; // Giả sử USD nếu không có ký hiệu
}

// ─── SOURCE 1: skincare_products_clean.csv ─────────────────────────────────
function loadSkincareClean(filePath) {
    console.log("📦 Loading skincare_products_clean.csv...");
    const raw = fs.readFileSync(filePath, "utf-8");
    const records = parse(raw, { columns: true, skip_empty_lines: true });

    return records.map((r) => ({
        id: makeId(r.product_name, ""),
        product_name: r.product_name?.trim() || "",
        brand: null, // Không có cột brand
        product_type: r.product_type?.trim() || null,
        price: r.price?.trim() || null,
        price_usd: normalizePrice(r.price),
        description: null, // Không có cột description
        ingredients: parseIngredients(r.clean_ingreds),
        skin_type: [], // Không có thông tin
        notable_effects: [],
        how_to_use: null,
        image_url: null,
        product_url: r.product_url?.trim() || null,
        source: "skincare_clean",
        rating: null,
        review_count: null,
        _raw_meta: { original_cols: Object.keys(r) },
    }));
}

// ─── SOURCE 2: MP-Skin_Care_Product_Recommendation_System3.csv ─────────────
function loadMPSkin(filePath) {
    console.log("📦 Loading MP-Skin_Care_Product_Recommendation_System3.csv...");
    const raw = fs.readFileSync(filePath, "utf-8");
    const records = parse(raw, { columns: true, skip_empty_lines: true });

    return records.map((r) => ({
        id: makeId(r.product_name, r.brand),
        product_name: r.product_name?.trim() || "",
        brand: r.brand?.trim() || null,
        product_type: r.product_type?.trim() || null,
        price: r.price?.trim() || null,
        price_usd: normalizePrice(r.price),
        description: r.description_en?.trim() || r.description?.trim() || null,
        ingredients: [], // Không có bảng thành phần
        skin_type: parseSkinType(r.skintype),
        notable_effects: parseEffects(r.notable_effects),
        how_to_use: null,
        image_url: r.picture_src?.trim() || null,
        product_url: r.product_href?.trim() || null,
        source: "mp_skin",
        rating: null,
        review_count: null,
        _raw_meta: { original_cols: Object.keys(r) },
    }));
}

// ─── SOURCE 3: dermstore_data.json ─────────────────────────────────────────
function loadDermstore(filePath) {
    console.log("📦 Loading dermstore_data.json...");
    const raw = fs.readFileSync(filePath, "utf-8");
    const records = JSON.parse(raw);

    return records.map((r) => {
        // Ưu tiên trường đã cleaned, fallback sang raw (strip HTML)
        const description =
            r.description?.trim() ||
            stripHtml(r.raw_how_to_use) ||
            null;

        const ingredients =
            r.ingredients
                ? parseIngredients(r.ingredients)
                : parseIngredients(stripHtml(r.raw_ingredients));

        const howToUse =
            r.how_to_use?.trim() ||
            stripHtml(r.raw_how_to_use) ||
            null;

        // Dermstore đôi khi có "skin_type_and_concerns" là chuỗi rỗng
        const skinTypeRaw = r.skin_type_and_concerns?.trim() || "";
        const skinType = skinTypeRaw
            ? parseSkinType(skinTypeRaw)
            : [];

        return {
            id: makeId(r.title, r.brand),
            product_name: r.title?.trim() || "",
            brand: r.brand?.trim() || null,
            product_type: r.category?.split("/").pop()?.trim() || null,
            price: r.price ? `$${r.price}` : null,
            price_usd: r.price ? parseFloat(r.price) : null,
            description,
            ingredients,
            skin_type: skinType,
            notable_effects: [],
            how_to_use: howToUse,
            image_url: r.images?.split(",")[0]?.trim() || null,
            product_url: r.url?.trim() || null,
            source: "dermstore",
            rating: r.rating_value ? parseFloat(r.rating_value) : null,
            review_count: r.review_count ? parseInt(r.review_count) : null,
            _raw_meta: {
                sku: r.sku,
                uniq_id: r.uniq_id,
                scraped_at: r.scraped_at,
            },
        };
    });
}

// ─── SOURCE 4: ingredientsList1.csv → Ingredient Dictionary ────────────────
function loadIngredients(filePath) {
    console.log("📦 Loading ingredientsList1.csv...");
    const raw = fs.readFileSync(filePath, "utf-8");
    const records = parse(raw, { columns: true, skip_empty_lines: true });

    /**
     * Alias map: tên thường gặp → tên canonical trong database
     * Bổ sung thêm alias khi phát hiện variant mới
     */
    const ALIAS_MAP = {
        "vitamin b3": "niacinamide",
        "vitamin c": "ascorbic acid",
        "vitamin e": "tocopherol",
        "vitamin a": "retinol",
        "vitamin b5": "panthenol",
        "ha": "hyaluronic acid",
        "sodium hyaluronate": "hyaluronic acid",
        "bha": "salicylic acid",
        "aha": "glycolic acid",
        "pha": "gluconolactone",
        "retinal": "retinaldehyde",
        "retinoic acid": "tretinoin",
        "tea tree": "melaleuca alternifolia extract",
        "green tea": "camellia sinensis extract",
    };

    return records.map((r) => {
        const canonicalName = r.name?.trim().toLowerCase() || "";
        const aliases = Object.entries(ALIAS_MAP)
            .filter(([, v]) => v === canonicalName)
            .map(([k]) => k);

        return {
            id: `ing_${canonicalName.replace(/[^a-z0-9]+/g, "_").slice(0, 40)}`,
            canonical_name: canonicalName,
            display_name: r.name?.trim() || "",
            scientific_name: r.scientific_name?.trim() || null,
            aliases, // Danh sách alias trỏ vào ingredient này
            short_description: r.short_description?.trim() || null,
            what_is_it: r.what_is_it?.trim() || null,
            what_does_it_do: r.what_does_it_do?.trim() || null,
            who_is_it_good_for: parseIngredients(r.who_is_it_good_for),
            who_should_avoid: parseIngredients(r.who_should_avoid),
            source_url: r.url?.trim() || null,
        };
    });
}

// ─── DEDUPLICATION ─────────────────────────────────────────────────────────
/**
 * Merge records có cùng product_name (case-insensitive) từ nhiều nguồn.
 * Ưu tiên: dermstore > mp_skin > skincare_clean (data quality descending)
 */
function deduplicateProducts(allProducts) {
    console.log(`🔄 Deduplicating ${allProducts.length} records...`);
    const map = new Map();

    // Priority order: dermstore (best quality) → mp_skin → skincare_clean
    const priorityOrder = ["dermstore", "mp_skin", "skincare_clean"];
    const sorted = [...allProducts].sort(
        (a, b) =>
            priorityOrder.indexOf(a.source) - priorityOrder.indexOf(b.source)
    );

    for (const product of sorted) {
        const key = product.product_name.toLowerCase().trim();

        if (!map.has(key)) {
            map.set(key, { ...product });
        } else {
            // Merge: bổ sung các trường còn null từ nguồn khác
            const existing = map.get(key);

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

            // Track merged sources
            if (!existing._sources) existing._sources = [existing.source];
            existing._sources.push(product.source);

            map.set(key, existing);
        }
    }

    return Array.from(map.values());
}

// ─── MAIN ───────────────────────────────────────────────────────────────────
async function main() {
    if (!fs.existsSync(OUT_DIR)) {
        fs.mkdirSync(OUT_DIR, { recursive: true });
    }

    // 1. Load tất cả nguồn
    const source1 = loadSkincareClean(
        path.join(DATA_DIR, "skincare_products_clean.csv")
    );
    const source2 = loadMPSkin(
        path.join(DATA_DIR, "MP-Skin_Care_Product_Recommendation_System3.csv")
    );
    const source3 = loadDermstore(
        path.join(DATA_DIR, "dermstore_data.json")
    );
    const ingredients = loadIngredients(
        path.join(DATA_DIR, "ingredientsList1.csv")
    );

    console.log(
        `✅ Loaded: ${source1.length} + ${source2.length} + ${source3.length} products`
    );

    // 2. Merge & Deduplicate
    const allProducts = [...source3, ...source2, ...source1]; // priority order
    const masterProducts = deduplicateProducts(allProducts);

    console.log(
        `✅ After deduplication: ${masterProducts.length} unique products`
    );

    // 3. Statistics
    const stats = {
        total: masterProducts.length,
        with_ingredients: masterProducts.filter((p) => p.ingredients.length > 0)
            .length,
        with_skin_type: masterProducts.filter((p) => p.skin_type.length > 0)
            .length,
        with_effects: masterProducts.filter((p) => p.notable_effects.length > 0)
            .length,
        with_description: masterProducts.filter((p) => p.description).length,
        with_image: masterProducts.filter((p) => p.image_url).length,
        by_source: {
            dermstore: masterProducts.filter((p) => p.source === "dermstore").length,
            mp_skin: masterProducts.filter((p) => p.source === "mp_skin").length,
            skincare_clean: masterProducts.filter(
                (p) => p.source === "skincare_clean"
            ).length,
        },
    };

    console.log("\n📊 Master Product Stats:");
    console.table(stats);

    // 4. Output
    const output = {
        schema_version: SCHEMA_VERSION,
        generated_at: new Date().toISOString(),
        stats,
        products: masterProducts,
    };

    fs.writeFileSync(
        path.join(OUT_DIR, "master_products.json"),
        JSON.stringify(output, null, 2)
    );

    fs.writeFileSync(
        path.join(OUT_DIR, "ingredients_dict.json"),
        JSON.stringify(
            {
                schema_version: SCHEMA_VERSION,
                generated_at: new Date().toISOString(),
                count: ingredients.length,
                ingredients,
            },
            null,
            2
        )
    );

    console.log(`\n✅ Done! Output saved to ${OUT_DIR}/`);
    console.log("   → master_products.json");
    console.log("   → ingredients_dict.json");
}

main().catch(console.error);