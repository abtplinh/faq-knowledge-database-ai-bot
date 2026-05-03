/**
 * AUTO-GENERATED bởi T02_alias_map.js — KHÔNG SỬA TAY
 * Để thêm alias mới: sửa ALIAS_MAP_RAW trong T02 rồi chạy lại
 *
 * CÁCH DÙNG trong T-03, T-06, T-07:
 *   import { normalizeIngredient, ALIAS_MAP } from './normalize_ingredient.js';
 *
 *   normalizeIngredient("Vitamin B3")
 *   // → { normalized: "niacinamide", found: true, canonical_name: "Niacinamide", data: {...} }
 */

// Bảng alias đầy đủ (100 entries)
export const ALIAS_MAP = {
  "vitamin b3": "niacinamide",
  "nicotinamide": "niacinamide",
  "vitamin pp": "niacinamide",
  "vitamin c": "ascorbic acid",
  "l-ascorbic acid": "ascorbic acid",
  "ascorbyl glucoside": "ascorbic acid",
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
  "retinaldehyde": "retinol",
  "retinal": "retinol",
  "tretinoin": "retinol",
  "retinoic acid": "retinol",
  "vitamin b5": "panthenol",
  "d-panthenol": "panthenol",
  "dl-panthenol": "panthenol",
  "pantothenic acid": "panthenol",
  "vitamin b12": "cyanocobalamin",
  "vitamin f": "linoleic acid",
  "vitamin k": "phytonadione",
  "ha": "hyaluronic acid",
  "sodium hyaluronate": "hyaluronic acid",
  "hydrolyzed hyaluronic acid": "hyaluronic acid",
  "aha": "glycolic acid",
  "glycolic acid": "glycolic acid",
  "lactic acid": "lactic acid",
  "mandelic acid": "mandelic acid",
  "malic acid": "malic acid",
  "tartaric acid": "tartaric acid",
  "citric acid": "citric acid",
  "bha": "salicylic acid",
  "beta hydroxy acid": "salicylic acid",
  "beta-hydroxy acid": "salicylic acid",
  "willow bark extract": "salicylic acid",
  "pha": "gluconolactone",
  "glucono delta-lactone": "gluconolactone",
  "gluconolactone": "gluconolactone",
  "matrixyl": "palmitoyl pentapeptide-4",
  "matrixyl 3000": "palmitoyl tripeptide-1",
  "argireline": "acetyl hexapeptide-3",
  "leuphasyl": "acetyl tetrapeptide-2",
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
  "kojic acid": "kojic acid",
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
  "bakuchiol": "bakuchiol",
  "glycerine": "glycerin",
  "glycerol": "glycerin",
  "propylene glycol": "propylene glycol",
  "pg": "propylene glycol",
  "zinc oxide": "zinc oxide",
  "zno": "zinc oxide",
  "titanium dioxide": "titanium dioxide",
  "tio2": "titanium dioxide",
  "avobenzone": "butyl methoxydibenzoylmethane",
  "oxybenzone": "benzophenone-3",
  "papain": "carica papaya fruit extract",
  "bromelain": "ananas sativus fruit extract",
  "pumpkin enzyme": "cucurbita pepo fruit extract",
  "ceramide": "ceramide np",
  "spf": "titanium dioxide",
  "tranexamic acid": "tranexamic acid",
  "azelaic acid": "azelaic acid",
  "benzoyl peroxide": "benzoyl peroxide",
  "bp": "benzoyl peroxide",
  "collagen": "hydrolyzed collagen",
  "resveratrol": "resveratrol",
  "ferulic acid": "ferulic acid",
  "adenosine": "adenosine",
  "epigallocatechin": "camellia sinensis leaf extract",
  "egcg": "camellia sinensis leaf extract"
};

/**
 * Normalize 1 ingredient string về canonical name
 * @param {string} raw   - Tên ingredient thô (bất kỳ format nào)
 * @returns {{ input, normalized, canonical_name, found, data }}
 */
export function normalizeIngredient(raw) {
  if (!raw) return { input: raw, normalized: null, found: false, data: null };

  const input  = String(raw).trim();
  const lower  = input.toLowerCase()
    .replace(/\s*\(.*?\)/g, "")   // bỏ phần trong ngoặc
    .replace(/[*†‡]/g, "")
    .trim();

  const normalized = ALIAS_MAP[lower];

  if (!normalized) {
    // Fuzzy: bỏ hyphens+spaces
    const fuzzy = lower.replace(/[-\s]+/g, "");
    for (const [alias, canon] of Object.entries(ALIAS_MAP)) {
      if (alias.replace(/[-\s]+/g, "") === fuzzy) {
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
