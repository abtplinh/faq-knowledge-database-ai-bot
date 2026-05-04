/**
 * ════════════════════════════════════════════════════════════════
 *  HOTFIX — 4 bugs phát hiện sau review output T01–T05
 * ════════════════════════════════════════════════════════════════
 *
 *  Chạy: node scripts/hotfix_patches.js
 *
 *  Script này PATCH trực tiếp vào file đã có, không cần re-run
 *  toàn bộ T02/T03 từ đầu.
 *
 *  SAU KHI CHẠY XONG: chạy lại T05 để tạo master_products_clean.json
 *    node scripts/T05_validate_qa.js
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
//  FIX 1 — Rebuild ingredients_enriched.json từ ingredientsList1.csv
//
//  LỖI GỐC: csv-parse không tìm được cột "name" vì BOM prefix.
//  FIX: thêm option `bom: true` và kiểm tra cột đầu tiên
// ─────────────────────────────────────────────────────────────────

function parsePythonList(raw) {
    if (!raw) return [];
    const s = String(raw).trim();
    if (s.startsWith("[") && s.endsWith("]")) {
        try {
            const jsonStr = s.replace(/'/g, '"').replace(/\bnan\b/gi, "null").replace(/\bNone\b/g, "null");
            const arr = JSON.parse(jsonStr);
            return arr.filter(x => x && String(x).trim().length > 1).map(x => String(x).trim());
        } catch {
            return s.slice(1, -1).split(",").map(x => x.replace(/['"]/g, "").trim()).filter(x => x.length > 1);
        }
    }
    return s.split(",").map(x => x.trim()).filter(Boolean);
}

function fixIngredientsEnriched() {
    console.log("🔧 FIX 1: Rebuild ingredients_enriched.json\n");

    const fp = path.join(RAW_DIR, "ingredientsList1.csv");
    const raw = fs.readFileSync(fp, "utf-8");

    // KEY FIX: thêm bom: true để csv-parse tự động strip UTF-8 BOM (\uFEFF)
    const records = parse(raw, {
        columns: true,
        skip_empty_lines: true,
        bom: true,   // ← Fix chính
        trim: true,
    });

    console.log(`  Parsed ${records.length} records`);

    // Verify cột đầu tiên
    if (records.length > 0) {
        const firstKey = Object.keys(records[0])[0];
        console.log(`  First column key: "${firstKey}" (expected: "name")`);

        if (firstKey !== "name") {
            console.error(`  ❌ Cột đầu vẫn không phải "name" — thử rename thủ công`);
            // Fallback: rename cột đầu tiên về "name"
            records.forEach(r => {
                if (!r.name && r[firstKey] !== undefined) {
                    r.name = r[firstKey];
                    delete r[firstKey];
                }
            });
            console.log(`  Đã rename "${firstKey}" → "name"`);
        }
    }

    // Load alias_map để biết alias nào trỏ về canonical nào
    const aliasMapPath = path.join(PRO_DIR, "alias_map.json");
    let aliasMap = {};
    if (fs.existsSync(aliasMapPath)) {
        aliasMap = JSON.parse(fs.readFileSync(aliasMapPath, "utf-8")).map || {};
    }

    const enriched = [];

    for (const row of records) {
        if (!row.name?.trim()) continue;

        const canonical = row.name.trim().toLowerCase();
        const displayName = row.name.trim();

        // Tìm tất cả aliases trỏ về canonical này
        const aliases = Object.entries(aliasMap)
            .filter(([alias, target]) => target === canonical && alias !== canonical)
            .map(([alias]) => alias);

        enriched.push({
            id: `ing_${canonical.replace(/[^a-z0-9]+/g, "_").slice(0, 40)}`,
            canonical_name: displayName,
            scientific_name: row.scientific_name?.trim() || null,
            short_description: row.short_description?.trim() || null,
            what_is_it: row.what_is_it?.trim() || null,
            what_does_it_do: row.what_does_it_do?.trim() || null,
            who_is_it_good_for: parsePythonList(row.who_is_it_good_for),
            who_should_avoid: parsePythonList(row.who_should_avoid),
            source_url: row.url?.trim() || null,
            aliases,
            // Text đầy đủ để embed (concat các field quan trọng)
            embed_text: [
                displayName,
                row.short_description?.trim(),
                row.what_does_it_do?.trim(),
                parsePythonList(row.who_is_it_good_for).join(", "),
            ].filter(Boolean).join(". "),
        });
    }

    const output = {
        generatedAt: new Date().toISOString(),
        count: enriched.length,
        ingredients: enriched,
    };

    fs.writeFileSync(
        path.join(PRO_DIR, "ingredients_enriched.json"),
        JSON.stringify(output, null, 2)
    );

    console.log(`  ✅ ingredients_enriched.json: ${enriched.length} ingredients\n`);
    console.log(`  Sample: "${enriched[0]?.canonical_name}" → ${enriched[0]?.aliases.length} aliases`);
    return enriched.length;
}

// ─────────────────────────────────────────────────────────────────
//  FIX 2 — Sửa price_usd của 6 sản phẩm Laneige (IDR với dấu phẩy)
//
//  LỖI GỐC: "Rp 650,000" → parseFloat sau replace('.',''): 650.000 = 650 IDR
//  FIX: bỏ cả dấu . và dấu , trước khi parseFloat
// ─────────────────────────────────────────────────────────────────

function fixedNormalizePrice(raw) {
    if (raw === null || raw === undefined) return { price_raw: null, price_usd: null };
    if (typeof raw === "number") return { price_raw: `$${raw}`, price_usd: raw };

    const s = String(raw).trim();
    if (!s) return { price_raw: null, price_usd: null };

    // GBP: "£5.20"
    if (s.startsWith("£")) {
        const num = parseFloat(s.slice(1).replace(",", ""));
        return { price_raw: s, price_usd: isNaN(num) ? null : Math.round(num * 1.27 * 100) / 100 };
    }

    // IDR: "Rp 209.000" hoặc "Rp 650,000"
    // FIX: loại bỏ TẤT CẢ dấu . và , (đều là phân cách nghìn trong IDR)
    if (s.startsWith("Rp")) {
        const cleaned = s
            .replace("Rp", "").trim()
            .replace(/[.,]/g, "");  // ← FIX: bỏ cả . và ,
        const num = parseFloat(cleaned);
        return { price_raw: s, price_usd: isNaN(num) ? null : Math.round(num / 15700 * 100) / 100 };
    }

    const num = parseFloat(s.replace(/[$,]/g, ""));
    return { price_raw: s, price_usd: isNaN(num) ? null : num };
}

function fixPriceUsd() {
    console.log("🔧 FIX 2: Sửa price_usd cho IDR với dấu phẩy\n");

    const masterPath = path.join(PRO_DIR, "master_products.json");
    const master = JSON.parse(fs.readFileSync(masterPath, "utf-8"));
    let fixCount = 0;

    master.products = master.products.map(p => {
        // Chỉ sửa products từ mp_skin có price_raw bắt đầu bằng "Rp"
        if (p.source === "mp_skin" && p.price_raw?.startsWith("Rp")) {
            const { price_usd } = fixedNormalizePrice(p.price_raw);
            if (price_usd !== p.price_usd) {
                console.log(`  Fixed: "${p.product_name.slice(0, 40)}" | ${p.price_raw} → $${p.price_usd} → $${price_usd}`);
                fixCount++;
                return { ...p, price_usd };
            }
        }
        return p;
    });

    master.stats.withPriceUsd = master.products.filter(p => p.price_usd !== null).length;
    fs.writeFileSync(masterPath, JSON.stringify(master, null, 2));
    console.log(`\n  ✅ Đã sửa ${fixCount} records\n`);
}

// ─────────────────────────────────────────────────────────────────
//  FIX 3 — product_type của dermstore: brand name → inferred type
//
//  LỖI GỐC: category.split('/')[1] = brand (NEOSTRATA, PMD...)
//  FIX: keyword inference từ product_name title
// ─────────────────────────────────────────────────────────────────

function inferProductType(title = "") {
    const t = title.toLowerCase();
    if (/shampoo|conditioner|hair mask|hair oil/.test(t)) return "Hair Care";
    if (/body wash|body lotion|body cream/.test(t)) return "Body Care";
    if (/face wash|cleanser|cleansing foam|foaming/.test(t)) return "Face Wash";
    if (/micellar|makeup remover|cleansing water/.test(t)) return "Face Wash";
    if (/eye cream|eye serum|eye gel/.test(t)) return "Eye Cream";
    if (/sunscreen|spf|sun protect|sun block/.test(t)) return "Sunscreen";
    if (/sheet mask|sleeping mask|face mask/.test(t)) return "Mask";
    if (/serum|essence|ampoule/.test(t)) return "Serum";
    if (/toner|mist|lotion spray/.test(t)) return "Toner";
    if (/moisturis|moisturize|cream|lotion|gel cream/.test(t)) return "Moisturiser";
    if (/lip balm|lip mask|lip oil/.test(t)) return "Lip Care";
    if (/facial oil|face oil|rosehip oil/.test(t)) return "Facial Oil";
    if (/exfoliant|scrub|peeling|exfol/.test(t)) return "Exfoliator";
    if (/primer|foundation|bb cream|cc cream/.test(t)) return "Makeup";
    if (/set|kit|duo|trio|bundle|gift/.test(t)) return "Set / Bundle";
    return null; // Không xác định được (hơn là đặt tên brand sai)
}

function fixDermstoreProductType() {
    console.log("🔧 FIX 3: Sửa product_type dermstore\n");

    const masterPath = path.join(PRO_DIR, "master_products.json");
    const master = JSON.parse(fs.readFileSync(masterPath, "utf-8"));
    let fixCount = 0;
    const typeDistribution = {};

    master.products = master.products.map(p => {
        if (p.source !== "dermstore") return p;

        const inferred = inferProductType(p.product_name);
        if (inferred !== p.product_type) fixCount++;

        typeDistribution[inferred || "Unknown"] = (typeDistribution[inferred || "Unknown"] || 0) + 1;

        return { ...p, product_type: inferred };
    });

    fs.writeFileSync(masterPath, JSON.stringify(master, null, 2));
    console.log(`  ✅ Đã fix product_type cho ${fixCount} dermstore records`);
    console.log(`  Distribution:`);
    Object.entries(typeDistribution).sort((a, b) => b[1] - a[1]).forEach(([t, c]) => {
        console.log(`    ${t.padEnd(18)}: ${c}`);
    });
    console.log("");
}

// ─────────────────────────────────────────────────────────────────
//  FIX 4 — Lọc ingredient strings là mô tả thiết bị/text dài
//
//  LỖI GỐC: PMD Clean có "silicone AA battery.\nFor the latest info..."
//  FIX: filter ingredients > 80 chars hoặc chứa keywords thiết bị
// ─────────────────────────────────────────────────────────────────

function fixBadIngredients() {
    console.log("🔧 FIX 4: Lọc ingredients không hợp lệ\n");

    const masterPath = path.join(PRO_DIR, "master_products.json");
    const master = JSON.parse(fs.readFileSync(masterPath, "utf-8"));
    let fixCount = 0;

    const DEVICE_KEYWORDS = /battery|information|recommended|prior to usage|ingredient list|packaging|consumption/i;

    master.products = master.products.map(p => {
        const original = p.ingredients || [];
        const filtered = original.filter(ing => {
            if (!ing || ing.trim() === "") return false;
            if (ing.length > 80) return false;           // Tên ingredient thật không dài hơn 80 chars
            if (DEVICE_KEYWORDS.test(ing)) return false; // Là text mô tả, không phải ingredient
            return true;
        });

        if (filtered.length !== original.length) {
            fixCount++;
            if (original.length - filtered.length > 0) {
                const removed = original.filter(x => !filtered.includes(x));
                console.log(`  ${p.product_name.slice(0, 40)}: removed ${removed.length} bad strings`);
                if (removed.length <= 2) {
                    removed.forEach(r => console.log(`    → "${r.slice(0, 60)}..."`));
                }
            }
            return { ...p, ingredients: filtered };
        }
        return p;
    });

    // Update stats
    master.stats.withIngredients = master.products.filter(p => p.ingredients.length > 0).length;
    master.stats.withIngredientsPercent = Math.round(master.stats.withIngredients / master.stats.total * 100);

    fs.writeFileSync(masterPath, JSON.stringify(master, null, 2));
    console.log(`\n  ✅ Đã fix ${fixCount} products có bad ingredients\n`);
}

// ─────────────────────────────────────────────────────────────────
//  MAIN — chạy tuần tự 4 fixes
// ─────────────────────────────────────────────────────────────────

async function main() {
    console.log("═══════════════════════════════════════════════════");
    console.log("  HOTFIX: Sửa 4 bugs phát hiện trong T01–T05");
    console.log("═══════════════════════════════════════════════════\n");

    // Fix 1: ingredients_enriched (standalone — không phụ thuộc master_products)
    const ingCount = fixIngredientsEnriched();

    console.log("───────────────────────────────────────────────────\n");

    // Fix 2, 3, 4 đều patch vào master_products.json
    fixPriceUsd();

    console.log("───────────────────────────────────────────────────\n");

    fixDermstoreProductType();

    console.log("───────────────────────────────────────────────────\n");

    fixBadIngredients();

    console.log("═══════════════════════════════════════════════════");
    console.log("  Hoàn thành! Bước tiếp theo:");
    console.log("");
    console.log("  1. Chạy lại T-05 để tạo master_products_clean.json:");
    console.log("     node scripts/T05_validate_qa.js");
    console.log("");
    console.log("  2. Verify nhanh:");
    console.log('     node -e "');
    console.log('       const ie = JSON.parse(require(\'fs\').readFileSync(\'data/processed/ingredients_enriched.json\'));');
    console.log('       console.log(\'ingredients count:\', ie.count);  // expected: 259');
    console.log('       const mp = JSON.parse(require(\'fs\').readFileSync(\'data/processed/master_products.json\'));');
    console.log('       const laneige = mp.products.filter(p => p.product_name.includes(\'Laneige Water Bank Blue Hyaluronic Cream\'));');
    console.log('       console.log(\'Laneige price_usd:\', laneige[0]?.price_usd);  // expected: ~41.4');
    console.log('     "');
    console.log("");
    console.log("  3. Nếu verify pass → bắt đầu T-06 Supabase setup");
    console.log("═══════════════════════════════════════════════════");
}

main().catch(err => { console.error(err); process.exit(1); });