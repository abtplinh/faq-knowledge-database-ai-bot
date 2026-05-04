#!/usr/bin/env node
/**
 * ════════════════════════════════════════════════════════════════
 *  T-01 — DATA AUDIT & THỐNG KÊ RAW DATA
 * ════════════════════════════════════════════════════════════════
 *
 *  INPUT  : 6 file raw (3 CSV sản phẩm + 1 JSON dermstore +
 *            1 JSON faq + 1 CSV ingredients)
 *  OUTPUT : data/audit/report.md   ← PM đọc
 *           data/audit/report.json ← T-02, T-03 đọc
 *
 *  CHẠY  : node scripts/T01_audit.js
 *
 *  CÀI ĐẶT:
 *    npm init -y
 *    npm install csv-parse
 * ════════════════════════════════════════════════════════════════
 */

import fs from "fs";
import path from "path";
import { parse } from "csv-parse/sync";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");          // project root
const RAW_DIR = path.join(ROOT, "data", "raw");
const OUT_DIR = path.join(ROOT, "data", "audit");

// ─────────────────────────────────────────────────────────────────
//  BƯỚC 1 — Khai báo tất cả file cần audit
//  Mỗi entry cho biết: loại file + vai trò trong hệ thống
// ─────────────────────────────────────────────────────────────────
const FILES = [
    {
        filename: "ingredientsList1.csv",
        type: "csv",
        role: "ingredients_dict",
        desc: "Từ điển 259 hoạt chất (tác dụng, đối tượng dùng/tránh)",
    },
    {
        filename: "skincare_products_clean.csv",
        type: "csv",
        role: "products_src1",
        desc: "1138 sản phẩm + bảng thành phần (£ GBP)",
    },
    {
        filename: "MP-Skin Care Product Recommendation System3.csv",
        type: "csv",
        role: "products_src2",
        desc: "1224 sản phẩm + skin_type + notable_effects (Rp IDR)",
    },
    {
        filename: "dermstore_data.json",
        type: "json_array",
        role: "products_src3",
        desc: "126 sản phẩm cao cấp, có description & how_to_use (USD)",
    },
    {
        filename: "faq.json",
        type: "json_nested",
        role: "faq",
        desc: "FAQ vận hành website (6 categories, 16 Q&A)",
    },
];

// ─────────────────────────────────────────────────────────────────
//  BƯỚC 2 — Các helper function nhỏ
// ─────────────────────────────────────────────────────────────────

/** Kiểm tra giá trị có phải "rỗng" không (null/undefined/""/nan/None) */
function isEmpty(val) {
    if (val === null || val === undefined) return true;
    const s = String(val).trim();
    return s === "" || s === "nan" || s === "None" || s === "NaN";
}

/** Phát hiện HTML tag trong chuỗi */
function hasHtml(val) {
    return typeof val === "string" && /<[a-z][\s\S]*>/i.test(val);
}

/** Phát hiện encoding lỗi (Windows-1252 đọc bằng latin-1 thường ra Ã ) */
function hasEncodingBug(val) {
    return typeof val === "string" && /Ã |â€|Ã©|Ã¨/.test(val);
}

/** Ước tính token (tiếng Việt ~3.5 chars/token) */
function estimateTokens(text) {
    return Math.round(text.length / 3.5);
}

// ─────────────────────────────────────────────────────────────────
//  BƯỚC 3 — Audit từng loại file
// ─────────────────────────────────────────────────────────────────

/**
 * auditCsv — đọc CSV, phân tích từng cột:
 *   - row count
 *   - null count & null %
 *   - có HTML không?
 *   - có encoding lỗi không?
 *   - 3 sample values để dev kiểm tra bằng mắt
 */
function auditCsv(filePath, meta) {
    const raw = fs.readFileSync(filePath, "utf-8");
    const records = parse(raw, { columns: true, skip_empty_lines: true });
    const total = records.length;

    if (total === 0) return { ...meta, totalRows: 0, columns: [] };

    const colNames = Object.keys(records[0]);

    const columns = colNames.map((col) => {
        let nullCnt = 0, htmlCnt = 0, encCnt = 0;
        const samples = [];

        for (const row of records) {
            const val = row[col];
            if (isEmpty(val)) {
                nullCnt++;
            } else {
                if (hasHtml(val)) htmlCnt++;
                if (hasEncodingBug(val)) encCnt++;
                if (samples.length < 3) samples.push(String(val).slice(0, 100));
            }
        }

        const nullPct = Math.round((nullCnt / total) * 100);

        // Đánh dấu cột cần xử lý:
        //   - null > 20%  → thiếu data, cần backfill hoặc chấp nhận
        //   - có HTML     → phải strip trước khi embedding
        //   - encoding bug → phải re-encode
        const issues = [
            htmlCnt > 0 && "⚠️ HTML",
            nullPct > 20 && `⚠️ NULL ${nullPct}%`,
            encCnt > 0 && "⚠️ ENCODING",
        ].filter(Boolean);

        return { col, nullCnt, nullPct, htmlCnt, encCnt, issues, samples };
    });

    return { ...meta, totalRows: total, columns };
}

/**
 * auditJsonArray — dành cho dermstore_data.json
 *   Cấu trúc: [ { key: val, ... }, ... ]
 */
function auditJsonArray(filePath, meta) {
    const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    const total = data.length;

    // Gom tất cả keys xuất hiện trong mảng (đề phòng schema lệch nhau)
    const allKeys = [...new Set(data.flatMap(Object.keys))];

    const columns = allKeys.map((col) => {
        let nullCnt = 0, htmlCnt = 0;
        const samples = [];

        for (const item of data) {
            const val = item[col];
            if (isEmpty(val)) {
                nullCnt++;
            } else {
                if (hasHtml(String(val))) htmlCnt++;
                if (samples.length < 3) samples.push(String(val).slice(0, 100));
            }
        }

        const nullPct = Math.round((nullCnt / total) * 100);
        const issues = [
            htmlCnt > 0 && "⚠️ HTML",
            nullPct > 20 && `⚠️ NULL ${nullPct}%`,
        ].filter(Boolean);

        return { col, nullCnt, nullPct, htmlCnt, encCnt: 0, issues, samples };
    });

    return { ...meta, totalRows: total, columns };
}

/**
 * auditJsonNested — dành cho faq.json
 *   Cấu trúc: [ { category, data: [ { id, question, answer } ] } ]
 */
function auditJsonNested(filePath, meta) {
    const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    const cats = data.map((c) => ({
        category: c.category,
        itemCount: c.data?.length ?? 0,
    }));
    const totalItems = cats.reduce((s, c) => s + c.itemCount, 0);

    return {
        ...meta,
        structure: "nested_categories",
        totalCategories: cats.length,
        totalItems,
        categories: cats,
        columns: [],          // không audit column-level
    };
}

// ─────────────────────────────────────────────────────────────────
//  BƯỚC 4 — Schema Mapping giữa 3 nguồn sản phẩm
//  Đây là bảng quan trọng nhất — input trực tiếp cho T-03 ETL
// ─────────────────────────────────────────────────────────────────
const SCHEMA_MAP = [
    {
        concept: "Tên sản phẩm",
        src1: "product_name",
        src2: "product_name",
        src3: "title",
        unified: "product_name",
        etl_action: "Rename dermstore.title → product_name",
    },
    {
        concept: "Thương hiệu",
        src1: "❌ THIẾU",
        src2: "brand",
        src3: "brand",
        unified: "brand",
        etl_action: "src1: extract từ product_name (từ đầu tiên viết hoa)",
    },
    {
        concept: "Loại sản phẩm",
        src1: "product_type (14 loại, tiếng Anh)",
        src2: "product_type (5 loại: Face Wash/Toner/Serum/Moisturizer/Sunscreen)",
        src3: "category = 'Brands / X / Product Name' → split('/')[1]",
        unified: "product_type",
        etl_action: "src3: category.split('/')[1].trim(). Normalize tên (Moisturizer vs Moisturiser)",
    },
    {
        concept: "Giá",
        src1: "price: '£5.20' (GBP string)",
        src2: "price: 'Rp 209.000' (IDR string, dấu . = nghìn)",
        src3: "price: 188.0 (USD float), currency: 'USD'",
        unified: "price_raw (giữ nguyên) + price_usd (float)",
        etl_action: "src1: £ × 1.27. src2: strip 'Rp ', replace('.','') / 15700. src3: dùng trực tiếp",
    },
    {
        concept: "Bảng thành phần",
        src1: "clean_ingreds: \"['a','b','c']\" (Python list-string!)",
        src2: "❌ THIẾU",
        src3: "ingredients (text thuần, comma-separated) + raw_ingredients (HTML — bỏ qua)",
        unified: "ingredients: string[]",
        etl_action: "src1: eval-safe parse list-string. src3: split(',').map(trim.toLowerCase)",
    },
    {
        concept: "Loại da phù hợp",
        src1: "❌ THIẾU",
        src2: "skintype: 'Oily' | 'Normal, Dry, Combination' (comma-string)",
        src3: "skin_type_and_concerns: chuỗi dài key:value (73/126 NULL!)",
        unified: "skin_type: string[] (enum: Oily/Dry/Normal/Combination/Sensitive)",
        etl_action: "src2: split(',').map(trim). src3: extract 'Skin Type:' section bằng regex",
    },
    {
        concept: "Công dụng",
        src1: "❌ THIẾU",
        src2: "notable_effects: 'Acne-Free, Pore-Care, Brightening' (comma-string)",
        src3: "❌ THIẾU (mention trong description)",
        unified: "notable_effects: string[]",
        etl_action: "src2: split(',').map(trim). src3: để trống []",
    },
    {
        concept: "Mô tả sản phẩm",
        src1: "❌ THIẾU",
        src2: "description_en (EN) — ưu tiên hơn description (ID)",
        src3: "description (text thuần)",
        unified: "description",
        etl_action: "src2: lấy description_en. src3: lấy description trực tiếp",
    },
    {
        concept: "Link sản phẩm",
        src1: "product_url",
        src2: "product_href",
        src3: "url",
        unified: "product_url",
        etl_action: "Rename src2.product_href + src3.url → product_url",
    },
    {
        concept: "Hình ảnh",
        src1: "❌ THIẾU",
        src2: "picture_src (1 URL)",
        src3: "images: 'url1, url2, ...' (comma-list) → lấy [0]",
        unified: "image_url",
        etl_action: "src3: images.split(',')[0].trim()",
    },
    {
        concept: "Cách dùng",
        src1: "❌ THIẾU",
        src2: "❌ THIẾU",
        src3: "how_to_use (text thuần) — raw_how_to_use là HTML bỏ qua",
        unified: "how_to_use",
        etl_action: "src3: lấy how_to_use trực tiếp",
    },
    {
        concept: "Rating",
        src1: "❌ THIẾU",
        src2: "❌ THIẾU",
        src3: "rating_value (string, 66/126 NULL) + review_count",
        unified: "rating + review_count",
        etl_action: "parseFloat(rating_value) || null",
    },
];

// ─────────────────────────────────────────────────────────────────
//  BƯỚC 5 — Tạo issue list tóm tắt những vấn đề cần fix ở T-03
// ─────────────────────────────────────────────────────────────────
const KNOWN_ISSUES = [
    {
        priority: "🔴 P0 — Blocking",
        file: "skincare_products_clean.csv",
        field: "clean_ingreds",
        problem: "Python list-string: \"['a','b']\" — không phải JS array",
        fix: "Parse bằng JSON.parse sau khi thay ' → \". Xử lý trong T-03",
    },
    {
        priority: "🔴 P0 — Blocking",
        file: "dermstore_data.json",
        field: "raw_ingredients, raw_how_to_use",
        problem: "Chứa HTML đầy đủ Tailwind class, không đọc được",
        fix: "Dùng trường 'ingredients' và 'how_to_use' (đã clean). Bỏ qua raw_*",
    },
    {
        priority: "🔴 P0 — Blocking",
        file: "dermstore_data.json",
        field: "category",
        problem: "'Brands / NEOSTRATA / Product Name' — cần lấy phần [1]",
        fix: "category.split('/')[1].trim() trong ETL",
    },
    {
        priority: "🟡 P1 — Important",
        file: "dermstore_data.json",
        field: "skin_type_and_concerns",
        problem: "73/126 records NULL. Khi có giá trị thì là chuỗi dài key:value",
        fix: "Regex extract 'Skin Type: X, Y' sau đó normalize về enum",
    },
    {
        priority: "🟡 P1 — Important",
        file: "Tất cả",
        field: "price",
        problem: "3 currencies khác nhau: £ GBP, Rp IDR, USD float",
        fix: "Giữ price_raw + thêm price_usd (convert). Xem normalizePrice() ở T-03",
    },
    {
        priority: "🟡 P1 — Important",
        file: "skincare_products_clean.csv",
        field: "brand",
        problem: "Cột brand không tồn tại",
        fix: "Extract từ product_name — heuristic: từ đầu viết hoa",
    },
    {
        priority: "🟡 P1 — Important",
        file: "MP-Skin_Care_...csv",
        field: "skintype",
        problem: "'Normal, Dry, Combination' — 15+ biến thể, cần normalize về enum chuẩn",
        fix: "split(',').map(trim) → map về SKIN_TYPE_ENUM",
    },
    {
        priority: "🟢 P2 — Nice to have",
        file: "dermstore_data.json",
        field: "images",
        problem: "Comma-separated list nhiều URL",
        fix: "split(',')[0].trim() → lấy ảnh đầu tiên",
    },
    {
        priority: "🟢 P2 — Nice to have",
        file: "ingredientsList1.csv",
        field: "who_is_it_good_for / who_should_avoid",
        problem: "Cũng là Python list-string: \"[' ', 'Acne', ' ', 'Blackheads']\"",
        fix: "Parse + filter string rỗng. Xử lý trong T-02",
    },
];

// ─────────────────────────────────────────────────────────────────
//  BƯỚC 6 — Render báo cáo Markdown
// ─────────────────────────────────────────────────────────────────
function renderMarkdown(results) {
    const lines = [];

    lines.push("# T-01 · Data Audit Report");
    lines.push(`> Generated: ${new Date().toISOString()}\n`);

    // ── Tổng quan ──
    lines.push("## 1. Tổng quan file\n");
    lines.push("| File | Role | Records | Cột có vấn đề |");
    lines.push("|------|------|---------|--------------|");
    for (const r of results) {
        const rec = r.totalRows ?? r.totalItems ?? "—";
        const issues = r.columns?.filter(c => c.issues.length > 0).length ?? 0;
        lines.push(`| \`${r.filename}\` | ${r.role} | **${rec}** | ${issues > 0 ? `⚠️ ${issues} cột` : "✅"} |`);
    }
    lines.push("");

    // ── Chi tiết từng file ──
    lines.push("## 2. Chi tiết từng file\n");
    for (const r of results) {
        lines.push(`### \`${r.filename}\``);
        lines.push(`> ${r.desc}\n`);

        if (r.structure === "nested_categories") {
            lines.push(`- **Cấu trúc:** nested categories`);
            lines.push(`- **Tổng categories:** ${r.totalCategories}`);
            lines.push(`- **Tổng Q&A:** ${r.totalItems}\n`);
            lines.push("| Category | Số Q&A |");
            lines.push("|----------|--------|");
            r.categories.forEach(c => lines.push(`| ${c.category} | ${c.itemCount} |`));
            lines.push("");
            continue;
        }

        lines.push(`- **Tổng records:** ${r.totalRows}`);
        lines.push(`- **Số cột:** ${r.columns.length}\n`);

        if (r.columns.length > 0) {
            lines.push("| Cột | Null | Null% | HTML | Issues | Sample |");
            lines.push("|-----|------|-------|------|--------|--------|");
            r.columns.forEach(c => {
                const iss = c.issues.join(" ") || "✅";
                const sample = c.samples[0]?.slice(0, 50) ?? "";
                lines.push(`| \`${c.col}\` | ${c.nullCnt} | ${c.nullPct}% | ${c.htmlCnt > 0 ? "⚠️" : "—"} | ${iss} | \`${sample}\` |`);
            });
            lines.push("");
        }
    }

    // ── Schema mapping ──
    lines.push("## 3. Schema Mapping (3 nguồn sản phẩm → Unified)\n");
    lines.push("| Khái niệm | skincare_clean | mp_skin | dermstore | Unified | ETL Action |");
    lines.push("|-----------|----------------|---------|-----------|---------|------------|");
    SCHEMA_MAP.forEach(m =>
        lines.push(`| **${m.concept}** | ${m.src1} | ${m.src2} | ${m.src3} | \`${m.unified}\` | ${m.etl_action} |`)
    );
    lines.push("");

    // ── Known issues ──
    lines.push("## 4. Issues cần fix (input cho T-03 ETL)\n");
    lines.push("| Priority | File | Field | Vấn đề | Fix |");
    lines.push("|----------|------|-------|--------|-----|");
    KNOWN_ISSUES.forEach(i =>
        lines.push(`| ${i.priority} | \`${i.file}\` | \`${i.field}\` | ${i.problem} | ${i.fix} |`)
    );

    return lines.join("\n");
}

// ─────────────────────────────────────────────────────────────────
//  BƯỚC 7 — MAIN: chạy tuần tự, ghi output
// ─────────────────────────────────────────────────────────────────
async function main() {
    if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

    console.log("🔍 T-01: Data Audit bắt đầu...\n");

    const results = [];

    for (const meta of FILES) {
        const fp = path.join(RAW_DIR, meta.filename);

        if (!fs.existsSync(fp)) {
            console.warn(`  ⚠️  Không tìm thấy: ${meta.filename}`);
            continue;
        }

        console.log(`  Auditing [${meta.type}] ${meta.filename}`);

        let r;
        if (meta.type === "csv") r = auditCsv(fp, meta);
        if (meta.type === "json_array") r = auditJsonArray(fp, meta);
        if (meta.type === "json_nested") r = auditJsonNested(fp, meta);

        results.push(r);
    }

    // Ghi JSON (các script sau đọc)
    fs.writeFileSync(
        path.join(OUT_DIR, "report.json"),
        JSON.stringify({ generatedAt: new Date().toISOString(), results, schemaMap: SCHEMA_MAP, issues: KNOWN_ISSUES }, null, 2)
    );

    // Ghi Markdown (người đọc)
    fs.writeFileSync(path.join(OUT_DIR, "report.md"), renderMarkdown(results));

    // In tóm tắt
    console.log("\n✅ XONG!\n");
    console.log("📁 Output:");
    console.log(`   data/audit/report.json  ← T-02, T-03 đọc`);
    console.log(`   data/audit/report.md    ← PM/dev review\n`);
    console.log("📊 Summary:");
    results.forEach(r => {
        const cnt = r.totalRows ?? r.totalItems ?? r.totalLines ?? "?";
        const bad = r.columns?.filter(c => c.issues.length).length ?? 0;
        const flag = bad > 0 ? `⚠️  ${bad} cột cần xử lý` : "✅ Clean";
        console.log(`   ${r.filename.padEnd(55)} ${String(cnt).padStart(5)} records   ${flag}`);
    });
}

main().catch(err => { console.error(err); process.exit(1); });