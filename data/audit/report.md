# T-01 · Data Audit Report
> Generated: 2026-04-26T09:16:18.200Z

## 1. Tổng quan file

| File | Role | Records | Cột có vấn đề |
|------|------|---------|--------------|
| `ingredientsList1.csv` | ingredients_dict | **259** | ⚠️ 1 cột |
| `skincare_products_clean.csv` | products_src1 | **1138** | ✅ |
| `MP-Skin Care Product Recommendation System3.csv` | products_src2 | **1224** | ✅ |
| `dermstore_data.json` | products_src3 | **126** | ⚠️ 9 cột |
| `faq.json` | faq | **16** | ✅ |

## 2. Chi tiết từng file

### `ingredientsList1.csv`
> Từ điển 259 hoạt chất (tác dụng, đối tượng dùng/tránh)

- **Tổng records:** 259
- **Số cột:** 8

| Cột | Null | Null% | HTML | Issues | Sample |
|-----|------|-------|------|--------|--------|
| `﻿name` | 1 | 0% | — | ✅ | `Alpha-Glucan Oligosaccharide` |
| `scientific_name` | 244 | 94% | — | ⚠️ NULL 94% | `5-Ureidohydantoin` |
| `short_description` | 1 | 0% | — | ✅ | `Alpha-glucan oligosaccharide is in a class of preb` |
| `what_is_it` | 1 | 0% | — | ✅ | `Prebiotics are a type of non-digestible dietary fi` |
| `what_does_it_do` | 1 | 0% | — | ✅ | `Prebiotics offer benefits such as:

- Help maintai` |
| `who_is_it_good_for` | 0 | 0% | — | ✅ | `[' ', 'Acne', ' ', 'Blackheads', ' ', 'Redness', '` |
| `who_should_avoid` | 0 | 0% | — | ✅ | `[' ', 'Related Allergy']` |
| `url` | 11 | 4% | — | ✅ | `https://renude.co/ingredients/alpha-glucan-oligosa` |

### `skincare_products_clean.csv`
> 1138 sản phẩm + bảng thành phần (£ GBP)

- **Tổng records:** 1138
- **Số cột:** 5

| Cột | Null | Null% | HTML | Issues | Sample |
|-----|------|-------|------|--------|--------|
| `product_name` | 0 | 0% | — | ✅ | `The Ordinary Natural Moisturising Factors + HA 30m` |
| `product_url` | 0 | 0% | — | ✅ | `https://www.lookfantastic.com/the-ordinary-natural` |
| `product_type` | 0 | 0% | — | ✅ | `Moisturiser` |
| `clean_ingreds` | 0 | 0% | — | ✅ | `['capric triglyceride', 'cetyl alcohol', 'propaned` |
| `price` | 0 | 0% | — | ✅ | `£5.20` |

### `MP-Skin Care Product Recommendation System3.csv`
> 1224 sản phẩm + skin_type + notable_effects (Rp IDR)

- **Tổng records:** 1224
- **Số cột:** 10

| Cột | Null | Null% | HTML | Issues | Sample |
|-----|------|-------|------|--------|--------|
| `﻿product_href` | 0 | 0% | — | ✅ | `https://www.beautyhaul.com/product/detail/bubble-f` |
| `product_name` | 0 | 0% | — | ✅ | `ACWELL Bubble Free PH Balancing Cleanser` |
| `product_type` | 0 | 0% | — | ✅ | `Face Wash` |
| `brand` | 0 | 0% | — | ✅ | `ACWELL ` |
| `notable_effects` | 0 | 0% | — | ✅ | `Acne-Free, Pore-Care, Brightening, Anti-Aging` |
| `skintype` | 0 | 0% | — | ✅ | `Oily` |
| `price` | 0 | 0% | — | ✅ | `Rp 209.000` |
| `description` | 0 | 0% | — | ✅ | `Mengangkat kotoran dan menghapus makeup dalam 1 st` |
| `picture_src` | 0 | 0% | — | ✅ | `https://www.beautyhaul.com/assets/uploads/products` |
| `description_en` | 0 | 0% | — | ✅ | `Removes dirt and removes makeup in 1 step, while m` |

### `dermstore_data.json`
> 126 sản phẩm cao cấp, có description & how_to_use (USD)

- **Tổng records:** 126
- **Số cột:** 24

| Cột | Null | Null% | HTML | Issues | Sample |
|-----|------|-------|------|--------|--------|
| `url` | 0 | 0% | — | ✅ | `https://www.dermstore.com/p/exclusive-neostrata-an` |
| `title` | 0 | 0% | — | ✅ | `Exclusive NEOSTRATA Anti-Aging Firming Duo` |
| `brand` | 0 | 0% | — | ✅ | `Neostrata` |
| `sku` | 0 | 0% | — | ✅ | `13441438` |
| `product_id` | 0 | 0% | — | ✅ | `13441438` |
| `price` | 0 | 0% | — | ✅ | `188.0` |
| `currency` | 0 | 0% | — | ✅ | `USD` |
| `availability` | 0 | 0% | — | ✅ | `OutOfStock` |
| `condition` | 0 | 0% | — | ✅ | `NewCondition` |
| `rating_value` | 66 | 52% | — | ⚠️ NULL 52% | `4.38` |
| `review_count` | 66 | 52% | — | ⚠️ NULL 52% | `16` |
| `category` | 0 | 0% | — | ✅ | `Brands / NEOSTRATA / Exclusive NEOSTRATA Anti-Agin` |
| `description` | 0 | 0% | — | ✅ | ` This anti aging neck cream is formulated with thr` |
| `ingredients` | 6 | 5% | ⚠️ | ⚠️ HTML | `Aqua (Water), Acetyl Glucosamine, Cyclopentasiloxa` |
| `raw_ingredients` | 6 | 5% | ⚠️ | ⚠️ HTML | `<div aria-labelledby="Ingredients" class="content ` |
| `how_to_use` | 3 | 2% | — | ✅ | `Gently smooth over neck and décolletage twice dail` |
| `raw_how_to_use` | 3 | 2% | ⚠️ | ⚠️ HTML | `<div aria-labelledby="How-to-Use" class="content m` |
| `skin_type_and_concerns` | 73 | 58% | — | ⚠️ NULL 58% | `Acne: BlackheadsAging Skin: Loss of FirmnessApplic` |
| `raw_skin_type_and_concerns` | 73 | 58% | ⚠️ | ⚠️ HTML ⚠️ NULL 58% | `<div aria-labelledby="Skin-Type-&amp;-Concerns" cl` |
| `range` | 82 | 65% | — | ⚠️ NULL 65% | `Curl Charisma` |
| `volume` | 62 | 49% | — | ⚠️ NULL 49% | `80ml` |
| `images` | 0 | 0% | — | ✅ | `https://static.thcdn.com/productimg/original/13441` |
| `uniq_id` | 0 | 0% | — | ✅ | `6635eafe-d8bd-53c7-b232-d359b208b4a1` |
| `scraped_at` | 0 | 0% | — | ✅ | `02/11/2024 11:15:28` |

### `faq.json`
> FAQ vận hành website (6 categories, 16 Q&A)

- **Cấu trúc:** nested categories
- **Tổng categories:** 6
- **Tổng Q&A:** 16

| Category | Số Q&A |
|----------|--------|
| Về LunaBot & Công nghệ | 3 |
| Mua sắm & Thanh toán | 3 |
| Vận chuyển & Theo dõi đơn hàng | 3 |
| Chính sách Đổi trả & Hoàn tiền | 2 |
| Kiến thức Skincare (Cơ bản) | 3 |
| An toàn & Miễn trừ trách nhiệm | 2 |

## 3. Schema Mapping (3 nguồn sản phẩm → Unified)

| Khái niệm | skincare_clean | mp_skin | dermstore | Unified | ETL Action |
|-----------|----------------|---------|-----------|---------|------------|
| **Tên sản phẩm** | product_name | product_name | title | `product_name` | Rename dermstore.title → product_name |
| **Thương hiệu** | ❌ THIẾU | brand | brand | `brand` | src1: extract từ product_name (từ đầu tiên viết hoa) |
| **Loại sản phẩm** | product_type (14 loại, tiếng Anh) | product_type (5 loại: Face Wash/Toner/Serum/Moisturizer/Sunscreen) | category = 'Brands / X / Product Name' → split('/')[1] | `product_type` | src3: category.split('/')[1].trim(). Normalize tên (Moisturizer vs Moisturiser) |
| **Giá** | price: '£5.20' (GBP string) | price: 'Rp 209.000' (IDR string, dấu . = nghìn) | price: 188.0 (USD float), currency: 'USD' | `price_raw (giữ nguyên) + price_usd (float)` | src1: £ × 1.27. src2: strip 'Rp ', replace('.','') / 15700. src3: dùng trực tiếp |
| **Bảng thành phần** | clean_ingreds: "['a','b','c']" (Python list-string!) | ❌ THIẾU | ingredients (text thuần, comma-separated) + raw_ingredients (HTML — bỏ qua) | `ingredients: string[]` | src1: eval-safe parse list-string. src3: split(',').map(trim.toLowerCase) |
| **Loại da phù hợp** | ❌ THIẾU | skintype: 'Oily' | 'Normal, Dry, Combination' (comma-string) | skin_type_and_concerns: chuỗi dài key:value (73/126 NULL!) | `skin_type: string[] (enum: Oily/Dry/Normal/Combination/Sensitive)` | src2: split(',').map(trim). src3: extract 'Skin Type:' section bằng regex |
| **Công dụng** | ❌ THIẾU | notable_effects: 'Acne-Free, Pore-Care, Brightening' (comma-string) | ❌ THIẾU (mention trong description) | `notable_effects: string[]` | src2: split(',').map(trim). src3: để trống [] |
| **Mô tả sản phẩm** | ❌ THIẾU | description_en (EN) — ưu tiên hơn description (ID) | description (text thuần) | `description` | src2: lấy description_en. src3: lấy description trực tiếp |
| **Link sản phẩm** | product_url | product_href | url | `product_url` | Rename src2.product_href + src3.url → product_url |
| **Hình ảnh** | ❌ THIẾU | picture_src (1 URL) | images: 'url1, url2, ...' (comma-list) → lấy [0] | `image_url` | src3: images.split(',')[0].trim() |
| **Cách dùng** | ❌ THIẾU | ❌ THIẾU | how_to_use (text thuần) — raw_how_to_use là HTML bỏ qua | `how_to_use` | src3: lấy how_to_use trực tiếp |
| **Rating** | ❌ THIẾU | ❌ THIẾU | rating_value (string, 66/126 NULL) + review_count | `rating + review_count` | parseFloat(rating_value) || null |

## 4. Issues cần fix (input cho T-03 ETL)

| Priority | File | Field | Vấn đề | Fix |
|----------|------|-------|--------|-----|
| 🔴 P0 — Blocking | `skincare_products_clean.csv` | `clean_ingreds` | Python list-string: "['a','b']" — không phải JS array | Parse bằng JSON.parse sau khi thay ' → ". Xử lý trong T-03 |
| 🔴 P0 — Blocking | `dermstore_data.json` | `raw_ingredients, raw_how_to_use` | Chứa HTML đầy đủ Tailwind class, không đọc được | Dùng trường 'ingredients' và 'how_to_use' (đã clean). Bỏ qua raw_* |
| 🔴 P0 — Blocking | `dermstore_data.json` | `category` | 'Brands / NEOSTRATA / Product Name' — cần lấy phần [1] | category.split('/')[1].trim() trong ETL |
| 🟡 P1 — Important | `dermstore_data.json` | `skin_type_and_concerns` | 73/126 records NULL. Khi có giá trị thì là chuỗi dài key:value | Regex extract 'Skin Type: X, Y' sau đó normalize về enum |
| 🟡 P1 — Important | `Tất cả` | `price` | 3 currencies khác nhau: £ GBP, Rp IDR, USD float | Giữ price_raw + thêm price_usd (convert). Xem normalizePrice() ở T-03 |
| 🟡 P1 — Important | `skincare_products_clean.csv` | `brand` | Cột brand không tồn tại | Extract từ product_name — heuristic: từ đầu viết hoa |
| 🟡 P1 — Important | `MP-Skin_Care_...csv` | `skintype` | 'Normal, Dry, Combination' — 15+ biến thể, cần normalize về enum chuẩn | split(',').map(trim) → map về SKIN_TYPE_ENUM |
| 🟢 P2 — Nice to have | `dermstore_data.json` | `images` | Comma-separated list nhiều URL | split(',')[0].trim() → lấy ảnh đầu tiên |
| 🟢 P2 — Nice to have | `ingredientsList1.csv` | `who_is_it_good_for / who_should_avoid` | Cũng là Python list-string: "[' ', 'Acne', ' ', 'Blackheads']" | Parse + filter string rỗng. Xử lý trong T-02 |