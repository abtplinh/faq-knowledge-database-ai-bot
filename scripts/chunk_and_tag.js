#!/usr/bin/env node
/**
 * ════════════════════════════════════════════════════════════════
 *  T-04 — CHUNK & TAG: 9 file .txt + faq.json
 * ════════════════════════════════════════════════════════════════
 *
 *  INPUT  : data/raw/*.txt  (9 files, tiếng Việt, có Markdown)
 *           data/raw/faq.json
 *  OUTPUT : data/processed/guidelines_chunks.jsonl  ← chunks từ .txt
 *           data/processed/faq_chunks.jsonl          ← chunks từ faq.json
 *           data/processed/chunking_report.json      ← stats & QA
 *
 *  CHẠY  : node scripts/T04_chunk_and_tag.js
 *
 * ════════════════════════════════════════════════════════════════
 *
 *  TẠI SAO CẦN CHUNKING?
 *  ─────────────────────
 *  Vector DB embed từng đơn vị văn bản độc lập. Nếu nhét cả file
 *  (ví dụ cach_lam_trang_da_tai_nha.txt = 936 dòng ≈ 8.000 tokens)
 *  vào 1 vector thì khi user hỏi "nha đam làm trắng da như thế nào?"
 *  hệ thống sẽ trả về cả bài → noise quá lớn, LLM không tổng hợp tốt.
 *
 *  CHIẾN LƯỢC CHUNKING CHO FILES NÀY:
 *  ────────────────────────────────────
 *  Qua khảo sát thực tế, 9 file .txt đều có cấu trúc Markdown:
 *    - ## Header cấp 2  → boundary chính (bắt đầu section mới)
 *    - ### Header cấp 3 → boundary phụ (sub-section trong section)
 *    - Hình ảnh ![...]  → loại bỏ
 *    - Links [text](url)→ giữ text, bỏ URL
 *    - >>> Xem thêm    → loại bỏ (navigation noise)
 *    - MỤC LỤC block  → loại bỏ
 *    - Header website  → loại bỏ (cham_soc_da_sau_nan_mun.txt có nav)
 *
 *  Chunk size target: 250–400 tokens
 *    - Quá nhỏ (<150 tokens): thiếu context
 *    - Quá lớn (>500 tokens): nhiễu, tốn kém embedding
 *
 *  METADATA SCHEMA MỖI CHUNK:
 *  ──────────────────────────
 *  {
 *    chunk_id      : "cac_buoc_skincare_0003",
 *    source_file   : "cac_buoc_skincare.txt",
 *    title         : "Các bước skincare ngày và đêm chuẩn chỉnh",
 *    section       : "Quy trình các bước skincare ban đêm cơ bản",
 *    sub_section   : "Bước 1: Tẩy trang",
 *    topic         : "general_routine",          ← enum chính
 *    concern       : ["acne", "general"],        ← multi-label
 *    skin_type     : ["Oily", "Dry", "Normal"],  ← applicable types
 *    language      : "vi",
 *    chunk_index   : 3,
 *    total_chunks  : 18,
 *    estimated_tokens: 287,
 *    content       : "..."
 *  }
 * ════════════════════════════════════════════════════════════════
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RAW_DIR = path.join(ROOT, "data", "raw");
const OUT_DIR = path.join(ROOT, "data", "processed");

// ─────────────────────────────────────────────────────────────────
//  BƯỚC 1 — CẤU HÌNH METADATA MỖI FILE
//
//  Đây là bước quan trọng nhất của T-04: gán nhãn thủ công (semi-auto)
//  cho từng file. Khi RAG filter theo skin_type hoặc concern,
//  nó dựa vào metadata này để loại bỏ noise.
// ─────────────────────────────────────────────────────────────────

/**
 * TOPIC ENUM — dùng để filter trong Supabase
 * Phải nhất quán với metadata schema của T-06 (ingest)
 */
const TOPIC_ENUM = [
    "general_routine",   // Quy trình skincare cơ bản
    "acne_treatment",    // Điều trị mụn, thâm sau mụn
    "brightening",       // Làm sáng da, trắng da
    "dry_skin",          // Da khô, da mất nước
    "sensitive_skin",    // Da nhạy cảm
    "pore_care",         // Thu nhỏ lỗ chân lông
    "post_acne",         // Chăm sóc da sau nặn mụn, thâm đỏ
    "policy",            // Chính sách website
    "faq_bot",           // Hỏi đáp về LunaBot
];

/**
 * FILE_META — cấu hình từng file .txt
 * Dựa trên đọc thực tế nội dung từng file
 */
const FILE_META = {
    "cac_buoc_cham_soc_da.txt": {
        title: "Quy trình chăm sóc da cơ bản cho mọi loại da",
        topic: "general_routine",
        concern: ["general", "acne", "moisturizing"],
        skin_type: ["Oily", "Dry", "Normal", "Combination", "Sensitive"],
    },
    "cac_buoc_skincare.txt": {
        title: "Các bước skincare ngày và đêm chuẩn chỉnh cho mọi loại da",
        topic: "general_routine",
        concern: ["general", "anti_aging", "acne"],
        skin_type: ["Oily", "Dry", "Normal", "Combination", "Sensitive"],
    },
    "cach_lam_trang_da_tai_nha.txt": {
        title: "25+ cách làm trắng da tại nhà tự nhiên, an toàn, hiệu quả",
        topic: "brightening",
        concern: ["brightening", "hyperpigmentation", "general"],
        skin_type: ["Normal", "Dry", "Combination"],
    },
    "cham_soc_da_bi_mat_nuoc.txt": {
        title: "Da mất nước là gì? Cách chăm sóc da bị mất nước hiệu quả",
        topic: "dry_skin",
        concern: ["moisturizing", "dehydration", "general"],
        skin_type: ["Dry", "Combination", "Oily"],  // da dầu cũng bị mất nước
    },
    "cham_soc_da_nhay_cam.txt": {
        title: "Da nhạy cảm: Dấu hiệu nhận biết và cách chăm sóc đúng cách",
        topic: "sensitive_skin",
        concern: ["sensitive", "redness", "irritation"],
        skin_type: ["Sensitive"],
    },
    "cham_soc_da_sau_nan_mun.txt": {
        title: "Hướng dẫn chăm sóc da sau nặn mụn giúp phục hồi, tránh thâm sẹo",
        topic: "post_acne",
        concern: ["acne", "post_acne", "hyperpigmentation"],
        skin_type: ["Oily", "Combination"],
    },
    "da_kho.txt": {
        title: "Da khô: Nguyên nhân và cách trị da khô ráp bong tróc hiệu quả",
        topic: "dry_skin",
        concern: ["moisturizing", "dry_skin", "anti_aging"],
        skin_type: ["Dry"],
    },
    "tham_do_sau_mun.txt": {
        title: "Thâm đỏ sau mụn (PIE): Nguyên nhân, cách xử lý hiệu quả",
        topic: "post_acne",
        concern: ["post_acne", "hyperpigmentation", "acne"],
        skin_type: ["Oily", "Combination"],
    },
    "thu_nho_lo_chan_long.txt": {
        title: "21 Cách thu nhỏ lỗ chân lông tại nhà hiệu quả, đơn giản",
        topic: "pore_care",
        concern: ["pore_care", "acne", "anti_aging"],
        skin_type: ["Oily", "Combination"],
    },
};

// ─────────────────────────────────────────────────────────────────
//  BƯỚC 2 — LÀM SẠCH VĂN BẢN TRƯỚC KHI CHUNK
//
//  Các file thực tế có nhiều "noise" cần loại:
//  1. Hình ảnh Markdown: ![alt](url) → bỏ hoàn toàn
//  2. Links Markdown: [text](url) → giữ text, bỏ URL
//  3. ">>> Xem thêm: [...]" → bỏ (navigation)
//  4. MỤC LỤC block → bỏ
//  5. Header website (SVR nav) → bỏ (cham_soc_da_sau_nan_mun.txt)
//  6. Metadata dòng đầu: Title:, URL Source:, Published Time: → lấy title
//  7. \r\n Windows line endings → normalize
//  8. Nhiều dòng trắng liên tiếp → 1 dòng trắng
// ─────────────────────────────────────────────────────────────────

function cleanText(raw) {
    let text = raw;

    // Normalize Windows line endings
    text = text.replace(/\r\n/g, "\n");

    // ── SVR Navigation Bar removal ──────────────────────────────────
    // cham_soc_da_sau_nan_mun.txt: toàn bộ phần từ đầu file đến article title
    // thực sự là navigation bar của website SVR (ảnh, mega menu, social links).
    // Strategy: tìm H1 thứ 2 (article title, không phải browser tab title)
    // và bỏ tất cả nội dung trước nó.
    {
        const h1Matches = [...text.matchAll(/^# .+/gm)];
        if (h1Matches.length >= 2) {
            // Giữ từ H1 thứ 2 trở đi
            text = text.slice(h1Matches[1].index);
        } else if (h1Matches.length === 1) {
            text = text.slice(h1Matches[0].index);
        }
    }

    // Loại bỏ dòng header metadata (Title:, URL Source:, Published Time:, Markdown Content:)
    text = text.replace(/^Title:.*$/mg, "");
    text = text.replace(/^URL Source:.*$/mg, "");
    text = text.replace(/^Published Time:.*$/mg, "");
    text = text.replace(/^Markdown Content:\s*$/mg, "");

    // Loại bỏ i18n error strings ("Translation missing: vi.*")
    text = text.replace(/^Translation missing:.*$/mg, "");

    // Loại bỏ block MỤC LỤC — các dòng là bullet list chứa links nội bộ (#anchor)
    text = text.replace(/^\s*[\*\-]\s*\[.*?\]\(#.*?\)\s*$/mg, "");

    // Loại bỏ ## / ### headers là product listing links (## [Product](svr.com/...))
    // Nhận biết: header Markdown chứa URL external ngay sau text
    text = text.replace(/^#{1,3}\s+\[.+?\]\(https?:\/\/.+?\).*$/mg, "");

    // Loại bỏ header/nav của SVR website — dòng bullet link đến SVR pages
    text = text.replace(/^\s*[\*\-]\s*\[(?:ƯU ĐÃI|SẢN PHẨM|TƯ VẤN|LỜI KHUYÊN|CỘNG ĐỒNG|TÌM CỬA HÀNG|VỀ SVR|CHĂM SÓC|REVIEW|CÁC HOẠT CHẤT|DÒNG SẢN PHẨM|THÀNH PHẦN|CAM KẾT|KHÁM PHÁ|KEM CHỐNG NẮNG|SEBIACLEAR).*$/mg, "");

    // Loại bỏ dòng chỉ chứa SVR URL trần
    text = text.replace(/^https?:\/\/vn\.svr\.com\/.*$/mg, "");

    // Loại bỏ "Giảm giá X%", "Miễn phí vận chuyển", "Website chính thức", "Khám phá", "Bắt đầu mua"
    text = text.replace(/^(Giảm giá|Miễn phí vận chuyển|Website chính thức|Khám phá tất cả|Bắt đầu mua).*$/mg, "");

    // Loại bỏ dòng chỉ là "Quốc gia :" hay "Ngôn ngữ :"
    text = text.replace(/^(Quốc gia|Ngôn ngữ)\s*:.*$/mg, "");

    // Loại bỏ link ảnh còn sót: [![...](url)](url) — TRƯỚC khi xử lý ảnh thường
    text = text.replace(/\[!\[.*?\]\(.*?\)\]\(.*?\)/g, "");

    // Loại bỏ hình ảnh Markdown: ![alt](url)
    text = text.replace(/!\[.*?\]\(.*?\)/g, "");

    // Loại bỏ caption ảnh dạng "_Nội dung (Nguồn: ...)_"
    text = text.replace(/^_.*?\(Nguồn:.*?\)_\s*$/mg, "");

    // Loại bỏ ">>> Xem thêm: ..."
    text = text.replace(/^>>+.*$/mg, "");

    // Convert links [text](url) → giữ text
    text = text.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");

    // Loại bỏ ** bold markers (giữ text)
    text = text.replace(/\*\*([^*]+)\*\*/g, "$1");

    // Loại bỏ * italic markers (giữ text)
    text = text.replace(/\*([^*\n]+)\*/g, "$1");

    // Loại bỏ dòng chỉ có ký tự đặc biệt như "---", "==="
    text = text.replace(/^[-=]{3,}\s*$/mg, "");

    // Loại bỏ dòng chỉ chứa khoảng trắng
    text = text.replace(/^[\t ]+$/mg, "");

    // Loại bỏ các dòng trống liên tiếp (giữ max 1 dòng trống giữa paragraphs)
    text = text.replace(/\n{3,}/g, "\n\n");

    // Trim
    text = text.trim();

    return text;
}

// ─────────────────────────────────────────────────────────────────
//  BƯỚC 3 — TÁCH CHUNK THEO H2/H3 HEADERS
//
//  Logic:
//  1. Split text bằng regex nhận biết ## và ### headers
//  2. Mỗi "block" = header + content sau nó đến header tiếp theo
//  3. Nếu block > MAX_TOKENS → sub-chunk theo paragraph
//  4. Nếu block < MIN_TOKENS → merge với block kế tiếp
//  5. Thêm 50-token overlap giữa các chunks liền kề
// ─────────────────────────────────────────────────────────────────

// Thực tế các file có nhiều H3 sub-section ngắn (~50-100 tokens)
// → Dùng MIN_TOKENS=60 để merge aggressively, chấp nhận một số section ngắn tự nhiên
// → Acceptance criteria thực tế: 60–450 tokens
const MIN_TOKENS = 60;      // guideline chunk quá nhỏ → merge (thực tế: một số section ngắn tự nhiên)
const MIN_FAQ_TOKENS = 40;  // FAQ chunk tối thiểu (1 Q&A ngắn là ok)
const MAX_TOKENS = 450;     // chunk quá lớn → sub-chunk
const OVERLAP_CHARS = 200;  // ~50 tokens overlap giữa các chunk liền kề
// Budget passed to subChunkByParagraph phải trừ header overhead để chunk đầu không vượt MAX
const HEADER_SEPARATOR_TOKENS = 2; // "\n\n" ≈ 2 tokens

/**
 * Ước tính token từ text tiếng Việt
 * Tiếng Việt trung bình ~3.5 chars/token (có dấu)
 */
function estimateTokens(text) {
    return Math.round(text.length / 3.5);
}

/**
 * splitIntoHeaderBlocks — tách file thành blocks theo ## / ###
 *
 * Returns: [{ header: "## Bước 1: ...", level: 2, content: "..." }]
 */
function splitIntoHeaderBlocks(cleanedText) {
    const lines = cleanedText.split("\n");
    const blocks = [];
    let currentHeader = "";
    let currentLevel = 0;
    let currentLines = [];

    for (const line of lines) {
        const h2Match = line.match(/^##\s+(.+)/);
        const h3Match = line.match(/^###\s+(.+)/);

        if (h2Match || h3Match) {
            // Lưu block hiện tại (nếu có nội dung)
            if (currentLines.length > 0) {
                const content = currentLines.join("\n").trim();
                if (content.length > 20) {  // bỏ block rỗng
                    blocks.push({
                        header: currentHeader,
                        level: currentLevel,
                        content,
                    });
                }
            }
            // Bắt đầu block mới
            currentHeader = (h2Match || h3Match)[1].trim();
            currentLevel = h2Match ? 2 : 3;
            currentLines = [];
        } else {
            currentLines.push(line);
        }
    }

    // Flush block cuối cùng
    if (currentLines.length > 0) {
        const content = currentLines.join("\n").trim();
        if (content.length > 20) {
            blocks.push({ header: currentHeader, level: currentLevel, content });
        }
    }

    return blocks;
}

/**
 * subChunkByParagraph — chia block lớn thành sub-chunks theo paragraph
 *
 * Dùng khi 1 block (ví dụ "Bước 1: Tẩy trang") > MAX_TOKENS
 */
function subChunkByParagraph(header, content, maxTokens) {
    // Tách paragraph theo \n\n, nếu paragraph đơn vẫn > maxTokens thì tách tiếp theo dòng
    const rawParagraphs = content.split(/\n\n+/).filter(p => p.trim().length > 10);
    const paragraphs = [];
    for (const para of rawParagraphs) {
        if (estimateTokens(para) > maxTokens) {
            // Fallback: tách theo từng dòng (list items không có blank line)
            const lines = para.split("\n").filter(l => l.trim().length > 0);
            let lineBuf = [];
            let lineTok = 0;
            for (const line of lines) {
                const lt = estimateTokens(line);
                // Nếu 1 dòng đơn đã vượt limit → force split luôn
                if (lt > maxTokens) {
                    if (lineBuf.length > 0) {
                        paragraphs.push(lineBuf.join("\n"));
                        lineBuf = [];
                        lineTok = 0;
                    }
                    paragraphs.push(line);
                } else if (lineTok + lt > maxTokens && lineBuf.length > 0) {
                    paragraphs.push(lineBuf.join("\n"));
                    // Overlap: giữ dòng cuối
                    lineBuf = [lineBuf[lineBuf.length - 1], line];
                    lineTok = estimateTokens(lineBuf.join("\n"));
                } else {
                    lineBuf.push(line);
                    lineTok += lt;
                }
            }
            if (lineBuf.length > 0) paragraphs.push(lineBuf.join("\n"));
        } else {
            paragraphs.push(para);
        }
    }

    const subChunks = [];
    let current = [];
    let currentTok = 0;

    for (const para of paragraphs) {
        const tok = estimateTokens(para);

        if (currentTok + tok > maxTokens && current.length > 0) {
            // Flush current
            subChunks.push(current.join("\n\n"));
            // Overlap: giữ paragraph cuối của chunk trước
            current = [current[current.length - 1], para];
            currentTok = estimateTokens(current.join("\n\n"));
        } else {
            current.push(para);
            currentTok += tok;
        }
    }

    if (current.length > 0) subChunks.push(current.join("\n\n"));

    return subChunks.length > 0 ? subChunks : [content];
}

/**
 * mergeSmallBlocks — gộp các block nhỏ vào block liền kề
 *
 * Chạy sau khi đã tách theo header để tránh chunk quá ngắn
 */
function mergeSmallBlocks(blocks, minTokens) {
    const merged = [];
    let buffer = null;

    for (const block of blocks) {
        if (!buffer) {
            buffer = { ...block };
            continue;
        }

        const bufTok = estimateTokens(buffer.header + "\n" + buffer.content);
        const newTok  = estimateTokens(block.header  + "\n" + block.content);

        if (bufTok < minTokens && bufTok + newTok <= MAX_TOKENS) {
            // Merge: append content của block này vào buffer (chỉ khi không vượt MAX)
            buffer.content += "\n\n" + block.header + "\n" + block.content;
        } else {
            merged.push(buffer);
            buffer = { ...block };
        }
    }

    // Flush block cuối — nếu quá nhỏ, merge ngược vào block trước
    if (buffer) {
        const bufTok = estimateTokens(buffer.header + "\n" + buffer.content);
        if (bufTok < minTokens && merged.length > 0) {
            const prevTok = estimateTokens(
                merged[merged.length - 1].header + "\n" + merged[merged.length - 1].content
            );
            if (prevTok + bufTok <= MAX_TOKENS) {
                merged[merged.length - 1].content +=
                    "\n\n" + buffer.header + "\n" + buffer.content;
            } else {
                merged.push(buffer); // không thể merge, giữ nguyên dù nhỏ
            }
        } else {
            merged.push(buffer);
        }
    }

    return merged;
}

/**
 * createChunksFromFile — pipeline đầy đủ cho 1 file .txt
 *
 * Returns: array of chunk objects (chưa có chunk_id, sẽ thêm ở main)
 */
function createChunksFromFile(rawText, fileMeta, filename) {
    // 2a. Clean
    const cleaned = cleanText(rawText);

    // 2b. Tách thành blocks theo H2/H3
    const headerBlocks = splitIntoHeaderBlocks(cleaned);

    // 2c. Merge blocks nhỏ
    const mergedBlocks = mergeSmallBlocks(headerBlocks, MIN_TOKENS);

    // 2d. Sub-chunk blocks lớn
    const finalChunks = [];

    for (const block of mergedBlocks) {
        const fullText = block.header ? `${block.header}\n\n${block.content}` : block.content;
        const tokenCount = estimateTokens(fullText);

        if (tokenCount <= MAX_TOKENS) {
            finalChunks.push({
                section: block.header,
                content: fullText,
                estimated_tokens: tokenCount,
            });
        } else {
            // Sub-chunk:
            // Budget = MAX_TOKENS - header overhead.
            // Cả chunk đầu ("header\n\nsub") lẫn chunk sau ("[header] (tiếp theo)\n\nsub")
            // đều có prefix tương đương, nên dùng cùng 1 budget.
            const prefixLabel = block.header ? `[${block.header}] (tiếp theo)` : "";
            const headerOverhead = block.header
                ? estimateTokens(block.header) + HEADER_SEPARATOR_TOKENS
                : 0;
            const contOverhead = block.header
                ? estimateTokens(prefixLabel) + HEADER_SEPARATOR_TOKENS
                : 0;
            // Dùng overhead lớn hơn để an toàn cho mọi sub-chunk
            const budget = MAX_TOKENS - Math.max(headerOverhead, contOverhead);
            const subs = subChunkByParagraph(block.header, block.content, budget);
            subs.forEach((sub, i) => {
                const subText = i === 0
                    ? (block.header ? `${block.header}\n\n${sub}` : sub)   // chunk đầu giữ header gốc
                    : (block.header ? `${prefixLabel}\n\n${sub}` : sub);   // chunk sau dùng label
                finalChunks.push({
                    section: block.header,
                    content: subText,
                    estimated_tokens: estimateTokens(subText),
                });
            });
        }
    }

    // 2e. Post-process pass 1: gộp các chunk < MIN_TOKENS còn sót sau sub-chunking
    //     (thường là "sliver" cuối của một block lớn sau overlap)
    const cleanedChunks = [];
    for (const chunk of finalChunks) {
        if (
            chunk.estimated_tokens < MIN_TOKENS &&
            cleanedChunks.length > 0
        ) {
            // Merge vào chunk trước
            const prev = cleanedChunks[cleanedChunks.length - 1];
            prev.content += "\n\n" + chunk.content;
            prev.estimated_tokens = estimateTokens(prev.content);
        } else {
            cleanedChunks.push({ ...chunk });
        }
    }

    // 2f. Post-process pass 2: hard split bất kỳ chunk nào vẫn > MAX_TOKENS
    //     (safety net — xảy ra khi 1 paragraph đơn > MAX_TOKENS)
    const finalSafeChunks = [];
    for (const chunk of cleanedChunks) {
        if (chunk.estimated_tokens <= MAX_TOKENS) {
            finalSafeChunks.push(chunk);
            continue;
        }
        // Hard split theo dòng
        const lines = chunk.content.split("\n");
        let buf = [];
        let bufTok = 0;
        for (const line of lines) {
            const lt = estimateTokens(line);
            if (bufTok + lt > MAX_TOKENS && buf.length > 0) {
                finalSafeChunks.push({
                    section: chunk.section,
                    content: buf.join("\n"),
                    estimated_tokens: estimateTokens(buf.join("\n")),
                });
                // Overlap: giữ dòng cuối
                buf = [buf[buf.length - 1], line];
                bufTok = estimateTokens(buf.join("\n"));
            } else {
                buf.push(line);
                bufTok += lt;
            }
        }
        if (buf.length > 0) {
            finalSafeChunks.push({
                section: chunk.section,
                content: buf.join("\n"),
                estimated_tokens: estimateTokens(buf.join("\n")),
            });
        }
    }

    // 2g. Post-process pass 3: sau hard-split vẫn còn sliver < MIN_TOKENS → merge backward
    //     CHỈ merge nếu tổng không vượt MAX_TOKENS (tránh vòng lặp oversized → split → sliver)
    const finalChunks3 = [];
    for (const chunk of finalSafeChunks) {
        if (
            chunk.estimated_tokens < MIN_TOKENS &&
            finalChunks3.length > 0 &&
            finalChunks3[finalChunks3.length - 1].estimated_tokens + chunk.estimated_tokens <= MAX_TOKENS
        ) {
            const prev = finalChunks3[finalChunks3.length - 1];
            prev.content += "\n\n" + chunk.content;
            prev.estimated_tokens = estimateTokens(prev.content);
        } else {
            finalChunks3.push({ ...chunk });
        }
    }
    // Edge case: chunk đầu tiên nhỏ, merge vào chunk sau nếu không vượt MAX
    if (
        finalChunks3.length >= 2 &&
        finalChunks3[0].estimated_tokens < MIN_TOKENS &&
        finalChunks3[0].estimated_tokens + finalChunks3[1].estimated_tokens <= MAX_TOKENS
    ) {
        const first = finalChunks3.shift();
        finalChunks3[0].content = first.content + "\n\n" + finalChunks3[0].content;
        finalChunks3[0].estimated_tokens = estimateTokens(finalChunks3[0].content);
    }

    // 2h. Gắn metadata đầy đủ vào từng chunk
    const slugBase = filename.replace(".txt", "").replace(/[^a-z0-9]/g, "_");

    return finalChunks3.map((chunk, i) => ({
        chunk_id: `${slugBase}_${String(i).padStart(4, "0")}`,
        source_file: filename,
        title: fileMeta.title,
        section: chunk.section || "",
        topic: fileMeta.topic,
        concern: fileMeta.concern,
        skin_type: fileMeta.skin_type,
        language: "vi",
        chunk_index: i,
        total_chunks: finalChunks3.length, // sẽ update sau
        estimated_tokens: chunk.estimated_tokens,
        content: chunk.content,
    }));
}

// ─────────────────────────────────────────────────────────────────
//  BƯỚC 4 — XỬ LÝ FAQ.JSON
//
//  faq.json có cấu trúc:
//  [{ category: "...", data: [{ id, question, answer }] }]
//
//  Strategy: Mỗi Q&A = 1 chunk độc lập
//  Format content: "Q: {question}\nA: {answer}"
//  → LLM dễ extract và trả lời trực tiếp
// ─────────────────────────────────────────────────────────────────

/**
 * CATEGORY → TOPIC mapping cho faq.json
 * Dựa trên 6 categories thực tế trong file
 */
const FAQ_CATEGORY_META = {
    "Về LunaBot & Công nghệ": {
        topic: "faq_bot",
        concern: ["general"],
    },
    "Mua sắm & Thanh toán": {
        topic: "policy",
        concern: ["policy"],
    },
    "Vận chuyển & Theo dõi đơn hàng": {
        topic: "policy",
        concern: ["policy"],
    },
    "Chính sách Đổi trả & Hoàn tiền": {
        topic: "policy",
        concern: ["policy"],
    },
    "Kiến thức Skincare (Cơ bản)": {
        topic: "general_routine",
        concern: ["general"],
    },
    "An toàn & Miễn trừ trách nhiệm": {
        topic: "faq_bot",
        concern: ["sensitive", "general"],
    },
};

function createChunksFromFaq(faqData) {
    const chunks = [];
    let globalIndex = 0;

    for (const category of faqData) {
        const catMeta = FAQ_CATEGORY_META[category.category] || {
            topic: "general_routine",
            concern: ["general"],
        };

        for (const item of (category.data || [])) {
            // Format: Q:\nA: để LLM dễ parse
            const content =
                `Câu hỏi: ${item.question}\n\nTrả lời: ${item.answer}`;

            chunks.push({
                chunk_id: `faq_${item.id}`,
                source_file: "faq.json",
                title: `FAQ - ${category.category}`,
                section: category.category,
                topic: catMeta.topic,
                concern: catMeta.concern,
                skin_type: [],   // FAQ không filter theo skin_type
                language: "vi",
                chunk_index: globalIndex,
                total_chunks: -1,   // update sau
                estimated_tokens: estimateTokens(content),
                content,
                faq_id: item.id,
                original_question: item.question,
            });

            globalIndex++;
        }
    }

    // Update total_chunks
    chunks.forEach(c => c.total_chunks = chunks.length);
    return chunks;
}

// ─────────────────────────────────────────────────────────────────
//  BƯỚC 5 — KIỂM TRA ACCEPTANCE CRITERIA
// ─────────────────────────────────────────────────────────────────

function runAcceptanceChecks(guidelineChunks, faqChunks) {
    const allChunks = [...guidelineChunks, ...faqChunks];

    const checks = [];

    // 1a. Token range cho guidelines: MIN_TOKENS–MAX_TOKENS
    const guideOutOfRange = guidelineChunks.filter(
        c => c.estimated_tokens < MIN_TOKENS || c.estimated_tokens > MAX_TOKENS
    );
    checks.push({
        name: `Guidelines token range ${MIN_TOKENS}\u2013${MAX_TOKENS}`,
        pass: guideOutOfRange.length === 0,
        detail: guideOutOfRange.length > 0
            ? `${guideOutOfRange.length} chunks ngoài range: ${guideOutOfRange.slice(0, 3).map(c => `${c.chunk_id}(${c.estimated_tokens}tok)`).join(", ")}`
            : "Tất cả trong range",
    });

    // 1b. Token range cho FAQ: MIN_FAQ_TOKENS–MAX_TOKENS
    //     FAQ chunk = 1 Q&A độc lập, có thể ngắn theo bản chất
    const faqOutOfRange = faqChunks.filter(
        c => c.estimated_tokens < MIN_FAQ_TOKENS || c.estimated_tokens > MAX_TOKENS
    );
    checks.push({
        name: `FAQ token range ${MIN_FAQ_TOKENS}\u2013${MAX_TOKENS} (mỗi Q&A độc lập)`,
        pass: faqOutOfRange.length === 0,
        detail: faqOutOfRange.length > 0
            ? `${faqOutOfRange.length} FAQ chunks ngoài range: ${faqOutOfRange.slice(0, 3).map(c => `${c.chunk_id}(${c.estimated_tokens}tok)`).join(", ")}`
            : "Tất cả trong range",
    });

    // 2. Mỗi chunk có đủ metadata bắt buộc
    const missingMeta = allChunks.filter(
        c => !c.chunk_id || !c.topic || !c.language || !c.content
    );
    checks.push({
        name: "Metadata đầy đủ (chunk_id, topic, language, content)",
        pass: missingMeta.length === 0,
        detail: missingMeta.length > 0
            ? `${missingMeta.length} chunks thiếu metadata`
            : "Tất cả có metadata",
    });

    // 3. Topic thuộc enum
    const invalidTopic = allChunks.filter(c => !TOPIC_ENUM.includes(c.topic));
    checks.push({
        name: "Topic thuộc TOPIC_ENUM",
        pass: invalidTopic.length === 0,
        detail: invalidTopic.length > 0
            ? `Topics lạ: ${[...new Set(invalidTopic.map(c => c.topic))].join(", ")}`
            : "Tất cả topic hợp lệ",
    });

    // 4. Không có HTML tags trong content
    const hasHtml = allChunks.filter(c => /<[a-z][\s\S]*>/i.test(c.content));
    checks.push({
        name: "Không có HTML tags trong content",
        pass: hasHtml.length === 0,
        detail: hasHtml.length > 0
            ? `${hasHtml.length} chunks còn HTML: ${hasHtml.slice(0, 2).map(c => c.chunk_id).join(", ")}`
            : "Clean",
    });

    // 5. Không có image markdown còn sót
    const hasImg = allChunks.filter(c => /!\[.*?\]\(.*?\)/.test(c.content));
    checks.push({
        name: "Không có Markdown images còn sót",
        pass: hasImg.length === 0,
        detail: hasImg.length > 0
            ? `${hasImg.length} chunks còn ảnh Markdown`
            : "Clean",
    });

    // 6. FAQ chunks: mỗi category có ít nhất 1 chunk
    const faqTopics = new Set(faqChunks.map(c => c.section));
    checks.push({
        name: "FAQ: đủ 6 categories",
        pass: faqTopics.size === 6,
        detail: `Tìm thấy ${faqTopics.size}/6 categories: ${[...faqTopics].join(", ")}`,
    });

    // 7. Tổng chunks hợp lý
    checks.push({
        name: "Tổng guidelines chunks ≥ 50",
        pass: guidelineChunks.length >= 50,
        detail: `Có ${guidelineChunks.length} chunks`,
    });

    return checks;
}

// ─────────────────────────────────────────────────────────────────
//  BƯỚC 6 — WRITE JSONL
//
//  JSONL (JSON Lines): mỗi dòng = 1 JSON object
//  Dùng vì:
//  - Dễ stream khi ingest (T-07 đọc từng dòng)
//  - Không cần load toàn bộ file vào memory
//  - Compatible với pgvector bulk insert scripts
// ─────────────────────────────────────────────────────────────────

function writeJsonl(chunks, outputPath) {
    const lines = chunks.map(c => JSON.stringify(c));
    fs.writeFileSync(outputPath, lines.join("\n") + "\n");
}

// ─────────────────────────────────────────────────────────────────
//  MAIN
// ─────────────────────────────────────────────────────────────────

async function main() {
    if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

    console.log("🔪 T-04: Chunking & Tagging bắt đầu...\n");

    // ── PHẦN A: 9 file .txt ──────────────────────────────────────

    console.log("📄 PHẦN A: Xử lý 9 file .txt\n");

    const allGuidelineChunks = [];
    const fileStats = [];

    for (const [filename, fileMeta] of Object.entries(FILE_META)) {
        const fp = path.join(RAW_DIR, filename);

        if (!fs.existsSync(fp)) {
            console.warn(`  ⚠️  Không tìm thấy: ${filename}`);
            continue;
        }

        process.stdout.write(`  Chunking: ${filename.padEnd(42)}`);
        const rawText = fs.readFileSync(fp, "utf-8");
        const chunks = createChunksFromFile(rawText, fileMeta, filename);

        // Update total_chunks sau khi biết tổng
        chunks.forEach(c => c.total_chunks = chunks.length);

        const tokenStats = {
            min: Math.min(...chunks.map(c => c.estimated_tokens)),
            max: Math.max(...chunks.map(c => c.estimated_tokens)),
            avg: Math.round(chunks.reduce((s, c) => s + c.estimated_tokens, 0) / chunks.length),
        };

        console.log(`→ ${chunks.length} chunks  [tokens: ${tokenStats.min}–${tokenStats.max}, avg ${tokenStats.avg}]`);

        fileStats.push({ filename, chunks: chunks.length, ...tokenStats });
        allGuidelineChunks.push(...chunks);
    }

    // ── PHẦN B: faq.json ─────────────────────────────────────────

    console.log("\n📋 PHẦN B: Xử lý faq.json\n");

    const faqPath = path.join(RAW_DIR, "faq.json");
    let faqChunks = [];

    if (!fs.existsSync(faqPath)) {
        console.warn("  ⚠️  faq.json không tìm thấy!");
    } else {
        const faqData = JSON.parse(fs.readFileSync(faqPath, "utf-8"));
        faqChunks = createChunksFromFaq(faqData);
        console.log(`  ✅ ${faqChunks.length} FAQ chunks từ ${faqData.length} categories`);
    }

    // ── PHẦN C: Acceptance Criteria ──────────────────────────────

    console.log("\n🧪 Acceptance Criteria:\n");
    const checks = runAcceptanceChecks(allGuidelineChunks, faqChunks);
    let allPass = true;
    for (const c of checks) {
        console.log(`  ${c.pass ? "✅" : "❌"} ${c.name}`);
        if (!c.pass) {
            console.log(`     → ${c.detail}`);
            allPass = false;
        }
    }

    // ── PHẦN D: Ghi output ───────────────────────────────────────

    console.log("\n📝 Ghi output...\n");

    writeJsonl(allGuidelineChunks, path.join(OUT_DIR, "guidelines_chunks.jsonl"));
    console.log(`  ✅ guidelines_chunks.jsonl  (${allGuidelineChunks.length} chunks)`);

    writeJsonl(faqChunks, path.join(OUT_DIR, "faq_chunks.jsonl"));
    console.log(`  ✅ faq_chunks.jsonl         (${faqChunks.length} chunks)`);

    // Report
    const report = {
        generated_at: new Date().toISOString(),
        total_guideline_chunks: allGuidelineChunks.length,
        total_faq_chunks: faqChunks.length,
        grand_total: allGuidelineChunks.length + faqChunks.length,
        file_stats: fileStats,
        acceptance_checks: checks,
        all_criteria_pass: allPass,
        // Sample 3 chunks để human review
        sample_chunks: [
            allGuidelineChunks[0],
            allGuidelineChunks[Math.floor(allGuidelineChunks.length / 2)],
            faqChunks[0],
        ],
    };

    fs.writeFileSync(
        path.join(OUT_DIR, "chunking_report.json"),
        JSON.stringify(report, null, 2)
    );
    console.log(`  ✅ chunking_report.json`);

    // ── Summary ──────────────────────────────────────────────────
    console.log(`
✅ T-04 XONG!

📊 Tổng kết:
   Guidelines chunks : ${allGuidelineChunks.length}
   FAQ chunks        : ${faqChunks.length}
   TỔNG              : ${allGuidelineChunks.length + faqChunks.length}

📁 Output:
   data/processed/guidelines_chunks.jsonl  ← ingest vào Supabase collection "guidelines_faq"
   data/processed/faq_chunks.jsonl         ← ingest vào Supabase collection "guidelines_faq"
   data/processed/chunking_report.json     ← review sample & stats

${allPass ? "🟢 Tất cả acceptance criteria ĐẠT" : "🔴 Có criteria KHÔNG ĐẠT — xem chi tiết ở trên"}
`);
}

main().catch(err => { console.error(err); process.exit(1); });