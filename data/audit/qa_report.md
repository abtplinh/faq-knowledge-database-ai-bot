# T-05 · QA Report: master_products.json
> Generated: 2026-04-29T05:11:11.412Z

## 1. Tổng quan

| Metric | Giá trị |
|--------|---------|
| Tổng records input | 2401 |
| Records pass (vào output) | **2401** |
| Records bị loại (error) | 0 |
| Records được auto-fix | 10 |
| Records cần manual review | 10 |
| % with ingredients | 99% |
| % with skin_type | 96% |
| % with description | 53% |
| % with image_url | 52% |

## 2. Kết quả từng Rule

| Rule | Mô tả | Violations | Severity | Auto-fixed |
|------|-------|-----------|----------|------------|
| R01 | product_name không được rỗng | ✅ 0 | error | 0 |
| R02 | product_name không là chuỗi null-like | ✅ 0 | error | 0 |
| R03 | price_usd phải là số dương nếu có | ✅ 0 | warning | 0 |
| R04 | price_usd trong khoảng $0.10–$2000 | ✅ 0 | warning | 0 |
| R05 | ingredients[] mỗi phần tử là chuỗi không rỗng | ✅ 0 | warning | 0 |
| R06 | ingredients[] không chứa null-like strings | ✅ 0 | warning | 0 |
| R07 | skin_type[] chỉ chứa: Oily | Dry | Normal | Combination | Sensitive | ✅ 0 | warning | 0 |
| R08 | notable_effects[] mỗi phần tử không rỗng | ✅ 0 | warning | 0 |
| R09 | source thuộc: skincare_clean | mp_skin | dermstore | ✅ 0 | error | 0 |
| R10 | image_url nếu có phải bắt đầu bằng http | 🟡 10 | warning | 10 |
| R11 | product_url nếu có phải bắt đầu bằng http | ✅ 0 | warning | 0 |
| R12 | rating nếu có phải nằm trong [0, 5] | ✅ 0 | warning | 0 |
| R13 | review_count nếu có là số nguyên không âm | ✅ 0 | warning | 0 |
| R14 | description không chứa HTML tags | ✅ 0 | warning | 0 |
| R15 | how_to_use không chứa HTML tags | ✅ 0 | warning | 0 |

## 4. Sample 20 records để review thủ công

> Kiểm tra: ≥ 18/20 records phải có data đúng

| # | product_name | brand | type | price_usd | ingreds | skin_type | source |
|---|-------------|-------|------|-----------|---------|-----------|--------|
| 1 | Cowshed SLEEP Calming Bath Sal | Cowshed | Bath Salts | 22.86 | 23 items | Normal/Dry/Combination/Oily | skincare_clean |
| 2 | Garnier Bright Complete 3 in 1 | GARNIER | Face Wash | 2.23 | 6 items | Oily | mp_skin |
| 3 | PYUNKANG YUL Black Tea Serum | PYUNKANG YUL | Serum | 24.84 | 7 items | Normal/Dry | mp_skin |
| 4 | Somethinc Lemonade Waterless V | SOMETHINC | Serum | 8.22 | 7 items | Normal/Dry/Oily/Combination | mp_skin |
| 5 | SCARLETT Whitening Facial Wash | SCARLETT | Face Wash | 5.25 | 6 items | Dry | mp_skin |
| 6 | SNP PREP Cicaronic Toning Esse | SNP PREP | Toner | 11.46 | 6 items | Dry/Sensitive | mp_skin |
| 7 | HADA LABO Gokujyun Alpha Lotio | HADA LABO | Moisturizer | 3.82 | 7 items | Dry | mp_skin |
| 8 | ELSHE SKIN Radiant Supple Seru | ELSHE SKIN | Serum | 11.64 | 7 items | Normal/Dry/Oily/Combination/Sensitive | mp_skin |
| 9 | AZARINE Easy White Nutrifull N | AZARINE | Moisturizer | 1.5 | 7 items | Oily | mp_skin |
| 10 | SCARLETT WHITENING Acne Serum | SCARLETT | Serum | 4.2 | 7 items | Sensitive | mp_skin |
| 11 | Avoskin Natural Sublime Facial | AVOSKIN | Face Wash | 6.94 | 6 items | Normal/Dry/Oily/Combination | mp_skin |
| 12 | GLOWINC POTION GENTLE+ Soothin | GLOWINC POTION | Toner | 5.67 | 6 items | Dry | mp_skin |
| 13 | SKINMEE Treasure Perfect Radia | SKINMEE | Serum | 11.4 | 7 items | Oily | mp_skin |
| 14 | Oribe Côte d’Azur Restorative | Oribe | — | 65 | 58 items | — | dermstore |
| 15 | Somethinc Holyshield! Sunscree | SOMETHINC | Sunscreen | 6.94 | 7 items | Sensitive | mp_skin |
| 16 | GLOWINC POTION HYDRALIVE+ Mois | GLOWINC POTION | Serum | 5.03 | 7 items | Sensitive | mp_skin |
| 17 | SKIN GAME Acne Combat | SKIN GAME | Serum | 9.49 | 7 items | Oily | mp_skin |
| 18 | BHUMI HPR Retinol Serum | BHUMI | Serum | 20.83 | 7 items | Oily | mp_skin |
| 19 | Elsheskin Brightening Refresh  | ELSHE SKIN | Toner | 4.14 | 6 items | Dry | mp_skin |
| 20 | SOME BY MI Super Matcha Pore T | SOME BY MI | Serum | 30.57 | 7 items | Oily | mp_skin |

## 5. Acceptance Criteria

- ✅ 0 records có product_name trống
- ✅ 0 records có giá trị 'nan' còn sót
- ✅ skin_type chỉ trong enum
- ✅ 0 HTML tags trong description
- ✅ % ingredients ≥ 60%
- ✅ % skin_type ≥ 55%
- ✅ Tổng records ≥ 2400