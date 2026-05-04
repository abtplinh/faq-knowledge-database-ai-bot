#!/usr/bin/env node
/**
 * ════════════════════════════════════════════════════════════════
 *  T-05 — VALIDATE & QA: master_products.json
 * ════════════════════════════════════════════════════════════════
 *
 *  INPUT  : data/processed/master_products.json   (từ T-03)
 *           data/processed/etl_run_report.json    (từ T-03)
 *  OUTPUT : data/processed/master_products_clean.json  ← fixed
 *           data/audit/qa_report.md                    ← PM đọc
 *           data/audit/failed_records.json             ← dev debug
 *
 *  CHẠY  : node scripts/T05_validate_qa.js
 *
 * ════════════════════════════════════════════════════════════════
 *
 *  T-05 LÀM 3 VIỆC:
 *  ─────────────────
 *  1. VALIDATE  — kiểm tra từng record theo schema rules
 *  2. AUTO-FIX  — tự sửa các lỗi có thể sửa được tự động
 *  3. FLAG      — đánh dấu record cần review thủ công
 *
 *  QUY TẮC VALIDATE (15 rules):
 *  ─────────────────────────────
 *  R01  product_name không được rỗng
 *  R02  product_name không được là "nan" / "None"
 *  R03  price_usd nếu có phải là số dương hợp lệ
 *  R04  price_usd nếu có phải nằm trong khoảng $0.10–$2000
 *  R05  ingredients[] mỗi phần tử phải là chuỗi không rỗng
 *  R06  ingredients[] không được chứa "nan" / "none"
 *  R07  skin_type[] chỉ chứa giá trị trong SKIN_TYPE_ENUM
 *  R08  notable_effects[] mỗi phần tử không rỗng
 *  R09  source phải thuộc SOURCE_ENUM
 *  R10  image_url nếu có phải bắt đầu bằng http
 *  R11  product_url nếu có phải bắt đầu bằng http
 *  R12  rating nếu có phải nằm trong [0, 5]
 *  R13  review_count nếu có phải là số nguyên không âm
 *  R14  description nếu có không được chứa HTML tags
 *  R15  how_to_use nếu có không được chứa HTML tags
 * ════════════════════════════════════════════════════════════════
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const PRO_DIR = path.join(ROOT, "data", "processed");
const AUD_DIR = path.join(ROOT, "data", "audit");

// ─────────────────────────────────────────────────────────────────
//  BƯỚC 1 — CONSTANTS & ENUMS
// ─────────────────────────────────────────────────────────────────

const SKIN_TYPE_ENUM = ["Oily", "Dry", "Normal", "Combination", "Sensitive"];
const SOURCE_ENUM = ["skincare_clean", "mp_skin", "dermstore"];

/** Danh sách chuỗi "rỗng" thực chất */
const NULL_STRINGS = ["nan", "none", "null", "undefined", "n/a", "", "na"];
const isNullString = v => NULL_STRINGS.includes(String(v).trim().toLowerCase());

/** HTML tag regex */
const HTML_RE = /<[a-z][^>]*>/i;

// ─────────────────────────────────────────────────────────────────
//  BƯỚC 2 — ĐỊNH NGHĨA 15 VALIDATION RULES
//
//  Mỗi rule có:
//  - id       : "R01"
//  - desc     : mô tả rule
//  - check(p) : function trả về null (pass) hoặc string (lỗi)
//  - fix(p)   : function tự sửa product (optional) — trả về product đã fix
//  - severity : "error" (loại khỏi output) | "warning" (giữ, flag)
// ─────────────────────────────────────────────────────────────────

const RULES = [
    {
        id: "R01",
        desc: "product_name không được rỗng",
        severity: "error",
        check: p => (!p.product_name || p.product_name.trim() === "")
            ? "product_name trống"
            : null,
        fix: null,
    },
    {
        id: "R02",
        desc: "product_name không là chuỗi null-like",
        severity: "error",
        check: p => isNullString(p.product_name)
            ? `product_name = "${p.product_name}"`
            : null,
        fix: null,
    },
    {
        id: "R03",
        desc: "price_usd phải là số dương nếu có",
        severity: "warning",
        check: p => (p.price_usd !== null && p.price_usd !== undefined)
            ? (typeof p.price_usd !== "number" || isNaN(p.price_usd) || p.price_usd < 0
                ? `price_usd = ${p.price_usd} không hợp lệ`
                : null)
            : null,
        fix: p => {
            if (p.price_usd !== null && (typeof p.price_usd !== "number" || isNaN(p.price_usd))) {
                return { ...p, price_usd: null };
            }
            return p;
        },
    },
    {
        id: "R04",
        desc: "price_usd trong khoảng $0.10–$2000",
        severity: "warning",
        check: p => (typeof p.price_usd === "number" && !isNaN(p.price_usd))
            ? (p.price_usd < 0.1 || p.price_usd > 2000
                ? `price_usd = $${p.price_usd} ngoài khoảng hợp lý`
                : null)
            : null,
        fix: p => {
            if (typeof p.price_usd === "number" && (p.price_usd < 0.1 || p.price_usd > 2000)) {
                return { ...p, price_usd: null, _price_flagged: true };
            }
            return p;
        },
    },
    {
        id: "R05",
        desc: "ingredients[] mỗi phần tử là chuỗi không rỗng",
        severity: "warning",
        check: p => {
            if (!Array.isArray(p.ingredients)) return "ingredients không phải array";
            const bad = p.ingredients.filter(x => !x || String(x).trim() === "");
            return bad.length > 0 ? `${bad.length} ingredients rỗng` : null;
        },
        fix: p => ({
            ...p,
            ingredients: (p.ingredients || []).filter(x => x && String(x).trim() !== ""),
        }),
    },
    {
        id: "R06",
        desc: "ingredients[] không chứa null-like strings",
        severity: "warning",
        check: p => {
            if (!Array.isArray(p.ingredients)) return null;
            const bad = p.ingredients.filter(x => isNullString(x));
            return bad.length > 0 ? `ingredients có null-like: [${bad.slice(0, 3).join(", ")}]` : null;
        },
        fix: p => ({
            ...p,
            ingredients: (p.ingredients || []).filter(x => !isNullString(x)),
        }),
    },
    {
        id: "R07",
        desc: `skin_type[] chỉ chứa: ${SKIN_TYPE_ENUM.join(" | ")}`,
        severity: "warning",
        check: p => {
            if (!Array.isArray(p.skin_type)) return "skin_type không phải array";
            const bad = p.skin_type.filter(x => !SKIN_TYPE_ENUM.includes(x));
            return bad.length > 0 ? `skin_type có giá trị lạ: [${bad.join(", ")}]` : null;
        },
        fix: p => ({
            ...p,
            skin_type: (p.skin_type || []).filter(x => SKIN_TYPE_ENUM.includes(x)),
        }),
    },
    {
        id: "R08",
        desc: "notable_effects[] mỗi phần tử không rỗng",
        severity: "warning",
        check: p => {
            if (!Array.isArray(p.notable_effects)) return "notable_effects không phải array";
            const bad = p.notable_effects.filter(x => !x || String(x).trim() === "");
            return bad.length > 0 ? `${bad.length} effects rỗng` : null;
        },
        fix: p => ({
            ...p,
            notable_effects: (p.notable_effects || []).filter(x => x && String(x).trim() !== ""),
        }),
    },
    {
        id: "R09",
        desc: `source thuộc: ${SOURCE_ENUM.join(" | ")}`,
        severity: "error",
        check: p => !SOURCE_ENUM.includes(p.source)
            ? `source = "${p.source}" không hợp lệ`
            : null,
        fix: null,
    },
    {
        id: "R10",
        desc: "image_url nếu có phải bắt đầu bằng http",
        severity: "warning",
        check: p => (p.image_url && !p.image_url.startsWith("http"))
            ? `image_url không hợp lệ: "${p.image_url.slice(0, 50)}"`
            : null,
        fix: p => ({
            ...p,
            image_url: (p.image_url && !p.image_url.startsWith("http")) ? null : p.image_url,
        }),
    },
    {
        id: "R11",
        desc: "product_url nếu có phải bắt đầu bằng http",
        severity: "warning",
        check: p => (p.product_url && !p.product_url.startsWith("http"))
            ? `product_url không hợp lệ: "${p.product_url.slice(0, 50)}"`
            : null,
        fix: p => ({
            ...p,
            product_url: (p.product_url && !p.product_url.startsWith("http")) ? null : p.product_url,
        }),
    },
    {
        id: "R12",
        desc: "rating nếu có phải nằm trong [0, 5]",
        severity: "warning",
        check: p => (p.rating !== null && p.rating !== undefined)
            ? (typeof p.rating !== "number" || p.rating < 0 || p.rating > 5
                ? `rating = ${p.rating} ngoài [0,5]`
                : null)
            : null,
        fix: p => ({
            ...p,
            rating: (p.rating !== null && (typeof p.rating !== "number" || p.rating < 0 || p.rating > 5))
                ? null : p.rating,
        }),
    },
    {
        id: "R13",
        desc: "review_count nếu có là số nguyên không âm",
        severity: "warning",
        check: p => (p.review_count !== null && p.review_count !== undefined)
            ? (!Number.isInteger(p.review_count) || p.review_count < 0
                ? `review_count = ${p.review_count}`
                : null)
            : null,
        fix: p => ({
            ...p,
            review_count: (p.review_count !== null && (!Number.isInteger(p.review_count) || p.review_count < 0))
                ? null : p.review_count,
        }),
    },
    {
        id: "R14",
        desc: "description không chứa HTML tags",
        severity: "warning",
        check: p => (p.description && HTML_RE.test(p.description))
            ? "description chứa HTML tags"
            : null,
        fix: p => ({
            ...p,
            description: p.description
                ? p.description.replace(/<[^>]+>/g, " ").replace(/\s{2,}/g, " ").trim()
                : null,
        }),
    },
    {
        id: "R15",
        desc: "how_to_use không chứa HTML tags",
        severity: "warning",
        check: p => (p.how_to_use && HTML_RE.test(p.how_to_use))
            ? "how_to_use chứa HTML tags"
            : null,
        fix: p => ({
            ...p,
            how_to_use: p.how_to_use
                ? p.how_to_use.replace(/<[^>]+>/g, " ").replace(/\s{2,}/g, " ").trim()
                : null,
        }),
    },
];

// ─────────────────────────────────────────────────────────────────
//  BƯỚC 3 — VALIDATE + AUTO-FIX MỘT RECORD
// ─────────────────────────────────────────────────────────────────

/**
 * validateAndFix — chạy tất cả rules trên 1 product
 *
 * Returns: {
 *   product     : fixed product object
 *   violations  : [{ ruleId, severity, message }]
 *   hasError    : boolean (true = loại khỏi output)
 *   wasFixed    : boolean (true = đã auto-fix ≥1 rule)
 * }
 */
function validateAndFix(product) {
    let current = { ...product };
    const violations = [];
    let hasError = false;
    let wasFixed = false;

    for (const rule of RULES) {
        const errorMsg = rule.check(current);

        if (errorMsg) {
            violations.push({
                ruleId: rule.id,
                severity: rule.severity,
                message: errorMsg,
            });

            if (rule.severity === "error") {
                hasError = true;
            }

            // Thử auto-fix nếu rule có fix function
            if (rule.fix) {
                const fixed = rule.fix(current);
                // Kiểm tra fix có hiệu quả không (error còn sau fix?)
                const stillBroken = rule.check(fixed);
                if (!stillBroken) {
                    current = fixed;
                    wasFixed = true;
                }
            }
        }
    }

    return { product: current, violations, hasError, wasFixed };
}

// ─────────────────────────────────────────────────────────────────
//  BƯỚC 4 — MANUAL REVIEW SAMPLING
//
//  Lấy 20 records ngẫu nhiên để dev review bằng mắt
//  Acceptance criteria: ≥ 18/20 records đúng data
// ─────────────────────────────────────────────────────────────────

function sampleForManualReview(products, sampleSize = 20) {
    const shuffled = [...products].sort(() => Math.random() - 0.5);
    return shuffled.slice(0, sampleSize).map(p => ({
        id: p.id,
        product_name: p.product_name,
        brand: p.brand,
        product_type: p.product_type,
        price_raw: p.price_raw,
        price_usd: p.price_usd,
        ingredients_count: p.ingredients.length,
        ingredients_sample: p.ingredients.slice(0, 3),
        skin_type: p.skin_type,
        notable_effects: p.notable_effects.slice(0, 3),
        source: p.source,
        has_description: !!p.description,
        has_image: !!p.image_url,
    }));
}

// ─────────────────────────────────────────────────────────────────
//  BƯỚC 5 — RENDER QA REPORT MARKDOWN
// ─────────────────────────────────────────────────────────────────

function renderQaMarkdown(stats, ruleStats, failedSample, manualSample) {
    const lines = [];
    lines.push("# T-05 · QA Report: master_products.json");
    lines.push(`> Generated: ${new Date().toISOString()}\n`);

    // Overview
    lines.push("## 1. Tổng quan\n");
    lines.push("| Metric | Giá trị |");
    lines.push("|--------|---------|");
    lines.push(`| Tổng records input | ${stats.total} |`);
    lines.push(`| Records pass (vào output) | **${stats.passed}** |`);
    lines.push(`| Records bị loại (error) | ${stats.dropped} |`);
    lines.push(`| Records được auto-fix | ${stats.autoFixed} |`);
    lines.push(`| Records cần manual review | ${stats.flagged} |`);
    lines.push(`| % with ingredients | ${stats.withIngredientsPct}% |`);
    lines.push(`| % with skin_type | ${stats.withSkinTypePct}% |`);
    lines.push(`| % with description | ${stats.withDescriptionPct}% |`);
    lines.push(`| % with image_url | ${stats.withImagePct}% |`);
    lines.push("");

    // Rule breakdown
    lines.push("## 2. Kết quả từng Rule\n");
    lines.push("| Rule | Mô tả | Violations | Severity | Auto-fixed |");
    lines.push("|------|-------|-----------|----------|------------|");
    ruleStats.forEach(r => {
        const icon = r.violations === 0 ? "✅" : (r.severity === "error" ? "🔴" : "🟡");
        lines.push(`| ${r.id} | ${r.desc} | ${icon} ${r.violations} | ${r.severity} | ${r.autoFixed} |`);
    });
    lines.push("");

    // Failed records sample
    if (failedSample.length > 0) {
        lines.push("## 3. Sample records bị loại (error)\n");
        failedSample.slice(0, 10).forEach(r => {
            lines.push(`### \`${r.product_name}\` (source: ${r.source})`);
            r.violations.filter(v => v.severity === "error").forEach(v => {
                lines.push(`- **${v.ruleId}**: ${v.message}`);
            });
            lines.push("");
        });
    }

    // Manual review sample
    lines.push("## 4. Sample 20 records để review thủ công\n");
    lines.push("> Kiểm tra: ≥ 18/20 records phải có data đúng\n");
    lines.push("| # | product_name | brand | type | price_usd | ingreds | skin_type | source |");
    lines.push("|---|-------------|-------|------|-----------|---------|-----------|--------|");
    manualSample.forEach((p, i) => {
        lines.push(`| ${i + 1} | ${p.product_name.slice(0, 30)} | ${p.brand || "—"} | ${p.product_type || "—"} | ${p.price_usd ?? "—"} | ${p.ingredients_count} items | ${p.skin_type.join("/") || "—"} | ${p.source} |`);
    });
    lines.push("");

    // Acceptance criteria
    lines.push("## 5. Acceptance Criteria\n");
    const criteria = [
        { name: "0 records có product_name trống", pass: stats.emptyNameCount === 0 },
        { name: "0 records có giá trị 'nan' còn sót", pass: stats.nanStringCount === 0 },
        { name: "skin_type chỉ trong enum", pass: stats.invalidSkinTypeCount === 0 },
        { name: "0 HTML tags trong description", pass: stats.htmlDescCount === 0 },
        { name: "% ingredients ≥ 60%", pass: stats.withIngredientsPct >= 60 },
        { name: "% skin_type ≥ 55%", pass: stats.withSkinTypePct >= 55 },
        { name: "Tổng records ≥ 2400", pass: stats.passed >= 2400 },
    ];
    criteria.forEach(c => {
        lines.push(`- ${c.pass ? "✅" : "❌"} ${c.name}`);
    });

    return lines.join("\n");
}

// ─────────────────────────────────────────────────────────────────
//  MAIN
// ─────────────────────────────────────────────────────────────────

async function main() {
    for (const d of [PRO_DIR, AUD_DIR]) {
        if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
    }

    console.log("🔬 T-05: Validate & QA master_products.json...\n");

    // Load input
    const inputPath = path.join(PRO_DIR, "master_products.json");
    if (!fs.existsSync(inputPath)) {
        throw new Error("master_products.json không tìm thấy! Chạy T-03 trước.");
    }

    const inputData = JSON.parse(fs.readFileSync(inputPath, "utf-8"));
    const products = inputData.products;
    console.log(`  📦 Loaded ${products.length} records từ master_products.json\n`);

    // ── Chạy validate + fix ──
    console.log("  🔍 Chạy 15 validation rules...\n");

    const passedProducts = [];
    const failedRecords = [];
    let autoFixedCount = 0;
    let flaggedCount = 0;

    // Rule stats (đếm violations per rule)
    const ruleViolationCount = {};
    const ruleAutoFixCount = {};
    RULES.forEach(r => { ruleViolationCount[r.id] = 0; ruleAutoFixCount[r.id] = 0; });

    for (const product of products) {
        const result = validateAndFix(product);

        // Update rule stats
        for (const v of result.violations) {
            ruleViolationCount[v.ruleId] = (ruleViolationCount[v.ruleId] || 0) + 1;
        }
        if (result.wasFixed) {
            autoFixedCount++;
            result.violations.forEach(v => {
                // Nếu rule có fix và violation đã được sửa
                const rule = RULES.find(r => r.id === v.ruleId);
                if (rule?.fix) ruleAutoFixCount[v.ruleId] = (ruleAutoFixCount[v.ruleId] || 0) + 1;
            });
        }

        if (result.hasError) {
            failedRecords.push({
                product_name: product.product_name,
                source: product.source,
                violations: result.violations,
            });
        } else {
            if (result.violations.length > 0) flaggedCount++;
            passedProducts.push(result.product);
        }
    }

    console.log(`  Results:`);
    console.log(`    Pass  : ${passedProducts.length}`);
    console.log(`    Drop  : ${failedRecords.length} (critical errors)`);
    console.log(`    Fixed : ${autoFixedCount} (auto-fixed warnings)`);
    console.log(`    Flagged: ${flaggedCount} (có warnings nhưng giữ lại)\n`);

    // ── Tính stats ──
    const total = products.length;
    const passed = passedProducts.length;

    const withIngredients = passedProducts.filter(p => p.ingredients.length > 0).length;
    const withSkinType = passedProducts.filter(p => p.skin_type.length > 0).length;
    const withDescription = passedProducts.filter(p => p.description).length;
    const withImage = passedProducts.filter(p => p.image_url).length;

    // Đếm lỗi đặc biệt để đưa vào acceptance criteria
    const emptyNameCount = products.filter(p => !p.product_name?.trim()).length;
    const nanStringCount = passedProducts.filter(p =>
        isNullString(p.product_name) ||
        p.ingredients.some(x => isNullString(x))
    ).length;
    const invalidSkinTypeCount = passedProducts.filter(p =>
        p.skin_type.some(x => !SKIN_TYPE_ENUM.includes(x))
    ).length;
    const htmlDescCount = passedProducts.filter(p =>
        (p.description && HTML_RE.test(p.description)) ||
        (p.how_to_use && HTML_RE.test(p.how_to_use))
    ).length;

    const stats = {
        total,
        passed,
        dropped: failedRecords.length,
        autoFixed: autoFixedCount,
        flagged: flaggedCount,
        withIngredientsPct: Math.round(withIngredients / passed * 100),
        withSkinTypePct: Math.round(withSkinType / passed * 100),
        withDescriptionPct: Math.round(withDescription / passed * 100),
        withImagePct: Math.round(withImage / passed * 100),
        emptyNameCount,
        nanStringCount,
        invalidSkinTypeCount,
        htmlDescCount,
    };

    // ── Acceptance criteria check ──
    console.log("  🧪 Acceptance Criteria:\n");
    const acChecks = [
        { name: "0 empty product_name", pass: emptyNameCount === 0, val: emptyNameCount },
        { name: "0 'nan' string còn sót", pass: nanStringCount === 0, val: nanStringCount },
        { name: "0 invalid skin_type", pass: invalidSkinTypeCount === 0, val: invalidSkinTypeCount },
        { name: "0 HTML trong desc/how_to_use", pass: htmlDescCount === 0, val: htmlDescCount },
        { name: "ingredients ≥ 60%", pass: stats.withIngredientsPct >= 60, val: `${stats.withIngredientsPct}%` },
        { name: "skin_type ≥ 55%", pass: stats.withSkinTypePct >= 55, val: `${stats.withSkinTypePct}%` },
        { name: "total passed ≥ 2400", pass: passed >= 2400, val: passed },
    ];

    let allPass = true;
    acChecks.forEach(c => {
        console.log(`    ${c.pass ? "✅" : "❌"} ${c.name.padEnd(35)} → ${c.val}`);
        if (!c.pass) allPass = false;
    });

    // ── Rule stats array ──
    const ruleStats = RULES.map(r => ({
        id: r.id,
        desc: r.desc,
        severity: r.severity,
        violations: ruleViolationCount[r.id] || 0,
        autoFixed: ruleAutoFixCount[r.id] || 0,
    }));

    // ── Manual review sample ──
    const manualSample = sampleForManualReview(passedProducts);

    // ── Ghi output ──
    console.log("\n  📝 Ghi output...\n");

    // Clean output (products đã pass + fix)
    const cleanOutput = {
        ...inputData,
        generated_at: new Date().toISOString(),
        qa_run_at: new Date().toISOString(),
        stats_after_qa: stats,
        products: passedProducts,
    };

    fs.writeFileSync(
        path.join(PRO_DIR, "master_products_clean.json"),
        JSON.stringify(cleanOutput, null, 2)
    );
    console.log(`    ✅ master_products_clean.json  (${passedProducts.length} records)`);

    // Failed records
    fs.writeFileSync(
        path.join(AUD_DIR, "failed_records.json"),
        JSON.stringify({ total: failedRecords.length, records: failedRecords }, null, 2)
    );
    console.log(`    ✅ failed_records.json          (${failedRecords.length} dropped)`);

    // QA Report Markdown
    const md = renderQaMarkdown(stats, ruleStats, failedRecords, manualSample);
    fs.writeFileSync(path.join(AUD_DIR, "qa_report.md"), md);
    console.log(`    ✅ qa_report.md                 (PM review)`);

    // JSON report (for programmatic use)
    fs.writeFileSync(
        path.join(AUD_DIR, "qa_report.json"),
        JSON.stringify({
            generated_at: new Date().toISOString(),
            stats,
            rule_stats: ruleStats,
            acceptance_check: acChecks,
            all_pass: allPass,
            manual_review_sample: manualSample,
        }, null, 2)
    );
    console.log(`    ✅ qa_report.json`);

    // ── Final summary ──
    console.log(`
✅ T-05 XONG!

📊 Kết quả:
   Input    : ${total} records
   Output   : ${passed} records (→ master_products_clean.json)
   Dropped  : ${failedRecords.length} records (xem failed_records.json)
   Auto-fixed: ${autoFixedCount} records

📁 Output:
   data/processed/master_products_clean.json  ← dùng cho T-07 (ingest)
   data/audit/qa_report.md                    ← PM review
   data/audit/failed_records.json             ← debug
   data/audit/qa_report.json                  ← CI/CD check

${allPass
            ? "🟢 Tất cả acceptance criteria ĐẠT — sẵn sàng cho T-06 Supabase ingest"
            : "🔴 Một số criteria KHÔNG ĐẠT — review qa_report.md trước khi tiếp tục"
        }
`);
}

main().catch(err => { console.error(err); process.exit(1); });