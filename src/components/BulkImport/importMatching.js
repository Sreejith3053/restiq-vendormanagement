/**
 * importMatching.js — v3
 *
 * Confidence-based item matching for vendor bulk import.
 * Second-stage refinement:
 *  - Separates "pack size" (physical qty, e.g. 25lb, 24s) from "order unit" (how it's ordered: case, box, lb)
 *  - Pack size match + minor unit difference → HIGH confidence (not 'Review Recommended')
 *  - High Risk Review classification for major price changes or unit-type flips
 *  - Improved fuzzy produce naming variants (Carrot/Carrots, Mint/Mint Leaves, etc.)
 *  - Possible Duplicate defaults to "Create as new" not "Update"
 *
 * actionResult values:
 *   update_high        — confirmed match, auto apply
 *   update_medium      — match found but something differs, recommend review
 *   high_risk_review   — match found but price/unit change is large and risky
 *   needs_review       — ambiguous multi-match, user must resolve
 *   new_item           — no match found
 *   new_possible_duplicate — no confident match but fuzzy near-match exists
 *   unchanged          — match found, nothing changed
 *   error              — row failed validation
 *   skip               — mode excluded this row
 */

// ── Normalization ─────────────────────────────────────────────────────────────

export function normalizeText(value) {
    if (value === null || value === undefined) return '';
    return String(value)
        .trim()
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .replace(/[^a-z0-9 .]/g, '');
}

export function normalizePackSize(value) {
    if (!value) return '';
    let s = String(value).trim().toLowerCase();
    s = s.replace(/(\d+)\s+([a-z]+)/g, '$1$2');
    const unitMap = [
        [/(\d+)lbs?$/,      '$1lb'],
        [/(\d+)kgs?$/,      '$1kg'],
        [/(\d+)grams?$/,    '$1g'],
        [/(\d+)oz\.?$/,     '$1oz'],
        [/(\d+)litres?$/,   '$1l'],
        [/(\d+)liters?$/,   '$1l'],
        [/(\d+)mls?$/,      '$1ml'],
        [/(\d+)pieces?$/,   '$1pcs'],
        [/(\d+)units?$/,    '$1units'],
        [/(\d+)cases?$/,    '$1case'],
        [/(\d+)bags?$/,     '$1bag'],
        [/(\d+)boxes?$/,    '$1box'],
        [/(\d+)pkts?$/,     '$1pkt'],
        [/(\d+)packets?$/,  '$1pkt'],
        [/(\d+)doz\.?$/,    '$1doz'],
        [/(\d+)dozen?$/,    '$1doz'],
    ];
    for (const [pat, rep] of unitMap) s = s.replace(pat, rep);
    return s.trim();
}

export function normalizeUnit(value) {
    if (!value) return '';
    const u = String(value).trim().toLowerCase().replace(/\s+/g, '');
    const map = {
        lbs: 'lb', lb: 'lb',
        kgs: 'kg', kg: 'kg',
        grams: 'g', gram: 'g', g: 'g',
        litre: 'l', litres: 'l', liter: 'l', liters: 'l', l: 'l',
        ml: 'ml', mls: 'ml', milliliter: 'ml', milliliters: 'ml',
        unit: 'unit', units: 'unit',
        pcs: 'pcs', piece: 'pcs', pieces: 'pcs',
        each: 'each', ea: 'each',
        case: 'case', cases: 'case',
        box: 'box', boxes: 'box',
        bag: 'bag', bags: 'bag',
        bundle: 'bundle', bundles: 'bundle',
        dozen: 'dozen', doz: 'dozen', dozens: 'dozen',
        packet: 'packet', packets: 'packet', pkt: 'packet',
        tray: 'tray', trays: 'tray',
        container: 'container', containers: 'container',
    };
    return map[u] || u;
}

// ── Unit classification helpers ───────────────────────────────────────────────

// Per-individual-item units — price is per single piece
const EACH_UNITS = new Set(['each', 'ea', 'pcs', 'piece', 'pieces', 'unit', 'dozen', 'packet', 'pkt', 'bundle']);
// Bulk weight units
const BULK_UNITS = new Set(['lb', 'kg', 'g', 'l', 'ml', 'oz']);
// Container/packaging units
const CASE_UNITS = new Set(['case', 'box', 'bag', 'tray', 'container']);

function unitCategory(u) {
    if (EACH_UNITS.has(u)) return 'each';
    if (BULK_UNITS.has(u)) return 'bulk';
    if (CASE_UNITS.has(u)) return 'case';
    return 'unknown';
}

/**
 * isDangerousUnitFlip(a, b)
 * Returns true ONLY when crossing from per-item (each/pcs/packet) to
 * bulk/case or vice versa — i.e., the pricing basis genuinely changes.
 *
 * NOT dangerous:
 *   box ↔ lb     (when pack already says "25lb" — it's just labeling)
 *   case ↔ lb    (same — pack size encodes the weight)
 *   box ↔ case   (both containers, same pricing basis)
 *   lb ↔ kg      (both bulk weights)
 */
function isDangerousUnitFlip(a, b) {
    const catA = unitCategory(a);
    const catB = unitCategory(b);
    if (catA === catB) return false;            // same category → not dangerous
    if (catA === 'unknown' || catB === 'unknown') return false;
    // Dangerous only when EACH crosses to BULK or CASE (price-per-piece vs price-per-lot)
    if (catA === 'each' || catB === 'each') return true;
    // case ↔ bulk: usually cosmetic when pack encodes weight — caller will check
    return false;
}

/**
 * isMinorUnitMismatch(a, b)
 * Same unit-category → minor cosmetic difference.
 */
function isMinorUnitMismatch(a, b) {
    if (a === b) return true;
    const ca = unitCategory(a), cb = unitCategory(b);
    return ca !== 'unknown' && ca === cb;
}

/**
 * packContainsWeight(normalizedPackSize)
 * Returns true if pack size already embeds a weight/volume quantity,
 * e.g. "25lb", "10kg", "500g", "6l".
 * When true, the unit label is less significant for pricing basis.
 */
function packContainsWeight(ps) {
    if (!ps) return false;
    return /\d+(lb|kg|g|oz|ml|l)$/.test(ps.toLowerCase().replace(/\s+/g, ''));
}

// ── High Risk detection ───────────────────────────────────────────────────────

const HIGH_RISK_PRICE_PCT    = 50;  // % above which price change is definitely high-risk
const MEDIUM_RISK_PRICE_PCT  = 25;  // % above which unit-flip also becomes high-risk

/**
 * assessHighRisk(existingItem, normalizedRow, { packMatches, matchType })
 *
 * HIGH RISK — only when pricing basis may have actually changed:
 *   1. Price delta > 50%
 *   2. Unit flips from per-item (each/pcs/packet) to bulk/case — AND price also moved > 25%
 *   3. Naming-variant match (uncertain) + large price delta
 *
 * NOT high-risk (downgrade to Recommended Review):
 *   - box ↔ lb / case ↔ lb when pack size already encodes weight (e.g. 25lb)
 *   - case ↔ box (both containers)
 *   - lb ↔ kg (both bulk)
 *   - any unit mismatch when price delta is small (< 25%)
 */
function assessHighRisk(existingItem, normalizedRow, { packMatches = false, matchType = '' } = {}) {
    const riskReasons = [];

    const oldPrice = parseFloat(existingItem.vendorPrice ?? existingItem.price ?? 0);
    const newPrice = parseFloat(normalizedRow.price || 0);
    let deltaPct   = null;
    if (oldPrice > 0 && newPrice > 0) {
        deltaPct = ((newPrice - oldPrice) / oldPrice) * 100;
        if (Math.abs(deltaPct) > HIGH_RISK_PRICE_PCT) {
            const sign = deltaPct > 0 ? '+' : '';
            riskReasons.push(
                `Large price change: ${sign}${deltaPct.toFixed(0)}% ($${oldPrice.toFixed(2)} → $${newPrice.toFixed(2)})`
            );
        }
    }

    const existingUnit = normalizeUnit(existingItem.unit || '');
    const newUnit      = normalizeUnit(normalizedRow.unit || '');
    const unitChanged  = newUnit && existingUnit && newUnit !== existingUnit;

    if (unitChanged) {
        const packNorm = normalizedRow.packSizeNormalized || '';
        const packHasWeight = packContainsWeight(packNorm);
        const dangerous     = isDangerousUnitFlip(existingUnit, newUnit);

        if (dangerous) {
            // per-item ↔ bulk/case — genuinely dangerous regardless of pack size
            // BUT only flag as high-risk if price also moved above medium threshold
            const priceAlsoMoved = deltaPct !== null && Math.abs(deltaPct) > MEDIUM_RISK_PRICE_PCT;
            if (priceAlsoMoved) {
                riskReasons.push(
                    `Unit changed: ${existingUnit} → ${newUnit} (price-per-piece vs price-per-${newUnit} risk)`
                );
            }
            // If price didn't move much, this is "Review Recommended" not "High Risk"
        } else if (!packHasWeight && !isMinorUnitMismatch(existingUnit, newUnit)) {
            // case ↔ lb or box ↔ lb but pack doesn't encode weight → moderate concern
            // Only escalate to high-risk if price moved significantly
            const priceAlsoMoved = deltaPct !== null && Math.abs(deltaPct) > HIGH_RISK_PRICE_PCT;
            if (priceAlsoMoved) {
                riskReasons.push(
                    `Unit changed: ${existingUnit} → ${newUnit} combined with significant price change`
                );
            }
        }
        // else: minor unit mismatch (box↔case, lb↔kg) or pack encodes weight → not high risk
    }

    return { highRisk: riskReasons.length > 0, riskReasons };
}

// ── Fuzzy similarity (bigram Jaccard) ─────────────────────────────────────────

function bigrams(str) {
    const set = new Set();
    for (let i = 0; i < str.length - 1; i++) set.add(str.slice(i, i + 2));
    return set;
}

export function stringSimilarity(a, b) {
    if (!a || !b) return 0;
    const na = normalizeText(a);
    const nb = normalizeText(b);
    if (na === nb) return 1.0;
    if (na.length < 2 || nb.length < 2) return 0;
    const ba = bigrams(na);
    const bb = bigrams(nb);
    let intersection = 0;
    ba.forEach(g => { if (bb.has(g)) intersection++; });
    const union = ba.size + bb.size - intersection;
    return union === 0 ? 0 : intersection / union;
}

/**
 * isNamingVariant(a, b)
 * Detects common produce naming variants that are the same item:
 *   "carrot" vs "carrots"           (pluralization)
 *   "mint" vs "mint leaves"          (suffix " leaves")
 *   "green pepper" vs "green bell pepper" (inserted word)
 *   "cooking onion" vs "onion cooking"   (word order swap)
 *   "snake guard" vs "snake gourd"       (typo class)
 */
function isNamingVariant(a, b) {
    const na = normalizeText(a);
    const nb = normalizeText(b);
    if (na === nb) return true;

    // 1. Pluralization — "carrot" vs "carrots", "leaf" vs "leaves"
    if (na + 's' === nb || nb + 's' === na) return true;
    if (na + 'es' === nb || nb + 'es' === na) return true;

    // 2. " leaves" / " leaf" suffix variant — "mint" vs "mint leaves"
    if (nb === na + ' leaves' || na === nb + ' leaves') return true;
    if (nb === na + ' leaf'   || na === nb + ' leaf')   return true;

    // 3. Word-order swap — "cooking onion" vs "onion cooking"
    const wordsA = na.split(' ').sort().join(' ');
    const wordsB = nb.split(' ').sort().join(' ');
    if (wordsA === wordsB) return true;

    // 4. One word inserted — "green pepper" ↔ "green bell pepper"
    //    i.e., all words in shorter are present in longer in same order
    const arrA = na.split(' ');
    const arrB = nb.split(' ');
    const [shorter, longer] = arrA.length <= arrB.length ? [arrA, arrB] : [arrB, arrA];
    if (shorter.length >= 1 && isSubsequence(shorter, longer)) return true;

    // 5. High bigram similarity (>= 0.75) — catches typos like snake guard/gourd
    if (stringSimilarity(na, nb) >= 0.75) return true;

    return false;
}

function isSubsequence(sub, arr) {
    let si = 0;
    for (const w of arr) {
        if (si < sub.length && w === sub[si]) si++;
    }
    return si === sub.length;
}

// ── Normalize a parsed import row ─────────────────────────────────────────────

export function normalizeRow(raw) {
    const priceClean = String(raw.price || '').trim().replace(/[$,\s]/g, '');
    return {
        ...raw,
        itemName:          (raw.itemName || '').trim(),
        itemNameNormalized: normalizeText(raw.itemName),
        category:          (raw.category || '').trim(),
        brand:             (raw.brand || '').trim(),
        packSize:          (raw.packSize || '').trim(),
        packSizeNormalized: normalizePackSize(raw.packSize),
        unit:              (raw.unit || '').trim(),
        unitNormalized:     normalizeUnit(raw.unit),
        price:             priceClean ? parseFloat(priceClean) : '',
        currency:          (raw.currency || 'CAD').trim().toUpperCase(),
        vendorSKU:         (raw.vendorSKU || '').trim(),
        vendorItemId:      (raw.vendorItemId || '').trim(),
        status:            (raw.status || 'Active').trim(),
        notes:             (raw.notes || '').trim(),
        minOrderQty:       raw.minOrderQty ? parseFloat(raw.minOrderQty) || '' : '',
        leadTimeDays:      raw.leadTimeDays ? parseFloat(raw.leadTimeDays) || '' : '',
    };
}

// ── Build lookup maps ─────────────────────────────────────────────────────────

function buildExistingMaps(existingItems) {
    const byId = {};
    const bySKU = {};
    const byFullKey = {};
    const byName = {};

    existingItems.forEach(item => {
        if (item.id) byId[item.id] = item;

        const sku = normalizeText(item.vendorSKU || '');
        if (sku) bySKU[sku] = item;

        const nameNorm = normalizeText(item.name || item.itemName || '');
        const packNorm = normalizePackSize(item.packSize || '');
        const unitNorm = normalizeUnit(item.unit || '');
        const fullKey  = [nameNorm, packNorm, unitNorm].join('|');

        if (nameNorm) {
            byFullKey[fullKey] = item;
            if (!byName[nameNorm]) byName[nameNorm] = [];
            byName[nameNorm].push(item);
        }
    });

    return { byId, bySKU, byFullKey, byName };
}

// ── Compute changed fields ────────────────────────────────────────────────────

function computeChangedFields(normalizedRow, existingItem) {
    const changedFields = [];
    const oldValues = {};
    const newValues = {};

    const fieldMap = [
        { rowKey: 'itemName',     itemKey: 'name',        label: 'Item Name' },
        { rowKey: 'price',        itemKey: 'vendorPrice',  label: 'Price', altItemKey: 'price' },
        { rowKey: 'category',     itemKey: 'category',     label: 'Category' },
        { rowKey: 'brand',        itemKey: 'brand',        label: 'Brand' },
        { rowKey: 'packSize',     itemKey: 'packSize',     label: 'Pack Size' },
        { rowKey: 'unit',         itemKey: 'unit',         label: 'Unit' },
        { rowKey: 'status',       itemKey: 'status',       label: 'Status' },
        { rowKey: 'vendorSKU',    itemKey: 'vendorSKU',   label: 'Vendor SKU' },
        { rowKey: 'minOrderQty',  itemKey: 'minOrderQty', label: 'Min Order Qty' },
        { rowKey: 'leadTimeDays', itemKey: 'leadTimeDays',label: 'Lead Time Days' },
        { rowKey: 'notes',        itemKey: 'notes',        label: 'Notes' },
        { rowKey: 'currency',     itemKey: 'currency',     label: 'Currency' },
    ];

    fieldMap.forEach(({ rowKey, itemKey, altItemKey, label }) => {
        const newVal = normalizedRow[rowKey];
        const oldVal = existingItem[itemKey] ?? (altItemKey ? existingItem[altItemKey] : undefined) ?? '';
        if (newVal === '' || newVal === null || newVal === undefined) return;
        const newStr = String(newVal).trim();
        const oldStr = String(oldVal).trim();
        if (newStr !== oldStr && newStr !== '') {
            changedFields.push(label);
            oldValues[label] = oldStr;
            newValues[label] = newStr;
        }
    });

    return { changedFields, oldValues, newValues };
}

// ── Price delta % calculation ─────────────────────────────────────────────────

export function priceDeltaPct(oldPrice, newPrice) {
    const o = parseFloat(oldPrice || 0);
    const n = parseFloat(newPrice || 0);
    if (o === 0) return null; // can't compute
    return ((n - o) / o) * 100;
}

// ── Core single-row matcher ───────────────────────────────────────────────────

function matchOneRow(normalizedRow, maps, existingItems) {
    const { byId, bySKU, byFullKey, byName } = maps;

    // ─ Priority 1: vendorItemId ─────────────────────────────────────────────
    if (normalizedRow.vendorItemId && byId[normalizedRow.vendorItemId]) {
        return {
            matchType: 'id_match', confidence: 'high',
            reason: 'Matched by system Item ID (most reliable)',
            matchedItem: byId[normalizedRow.vendorItemId],
            matchedItemId: normalizedRow.vendorItemId,
        };
    }

    // ─ Priority 2: vendorSKU ────────────────────────────────────────────────
    const skuNorm = normalizeText(normalizedRow.vendorSKU);
    if (skuNorm && bySKU[skuNorm]) {
        return {
            matchType: 'sku_match', confidence: 'high',
            reason: 'Exact SKU match',
            matchedItem: bySKU[skuNorm],
            matchedItemId: bySKU[skuNorm].id,
        };
    }

    // ─ Priority 3: exact name + packSize + unit ─────────────────────────────
    const nameNorm = normalizedRow.itemNameNormalized;
    const packNorm = normalizedRow.packSizeNormalized;
    const unitNorm = normalizedRow.unitNormalized;
    const fullKey  = [nameNorm, packNorm, unitNorm].join('|');

    if (nameNorm && byFullKey[fullKey]) {
        return {
            matchType: 'full_key_match', confidence: 'high',
            reason: 'Exact match on name, pack size, and unit',
            matchedItem: byFullKey[fullKey],
            matchedItemId: byFullKey[fullKey].id,
        };
    }

    // ─ Priority 4: exact name match, refined confidence ─────────────────────
    if (nameNorm && byName[nameNorm]) {
        const candidates = byName[nameNorm];

        if (candidates.length === 1) {
            return resolveNameSingleCandidate(normalizedRow, candidates[0], packNorm, unitNorm);
        }

        // Multiple candidates with same name
        return {
            matchType: 'name_match_multiple', confidence: 'low',
            reason: `${candidates.length} items share this name — select the correct one`,
            matchedItem: null, matchedItemId: null,
            ambiguousCandidates: candidates.map(toCandidateMeta),
        };
    }

    // ─ No exact name match — check naming variants ──────────────────────────
    const variantMatches = existingItems.filter(item => {
        const en = normalizeText(item.name || item.itemName || '');
        return en !== nameNorm && isNamingVariant(normalizedRow.itemName, item.name || item.itemName || '');
    });

    if (variantMatches.length === 1) {
        return {
            matchType: 'naming_variant', confidence: 'medium',
            reason: `Naming variant match: "${variantMatches[0].name}" ↔ "${normalizedRow.itemName}"`,
            matchedItem: variantMatches[0],
            matchedItemId: variantMatches[0].id,
        };
    }
    if (variantMatches.length > 1) {
        return {
            matchType: 'name_match_multiple', confidence: 'low',
            reason: 'Multiple naming variants found — review required',
            matchedItem: null, matchedItemId: null,
            ambiguousCandidates: variantMatches.map(toCandidateMeta),
        };
    }

    // ─ Fuzzy near-duplicate detection ───────────────────────────────────────
    const SIMILARITY_THRESHOLD = 0.60;
    const nearDuplicates = existingItems
        .map(item => ({ item, sim: stringSimilarity(normalizedRow.itemName, item.name || item.itemName || '') }))
        .filter(({ sim }) => sim >= SIMILARITY_THRESHOLD)
        .sort((a, b) => b.sim - a.sim)
        .slice(0, 3);

    if (nearDuplicates.length > 0) {
        return {
            matchType: 'new_possible_duplicate', confidence: 'n/a',
            reason: 'No match found — but similar items exist. Verify this is truly a new item.',
            matchedItem: null, matchedItemId: null,
            similarItems: nearDuplicates.map(({ item, sim }) => ({
                id: item.id, name: item.name || item.itemName || '',
                similarity: Math.round(sim * 100),
                packSize: item.packSize || '', unit: item.unit || '',
                vendorPrice: item.vendorPrice ?? item.price ?? '',
            })),
        };
    }

    return {
        matchType: 'new_item', confidence: 'n/a',
        reason: 'No existing item found — will be created as new',
        matchedItem: null, matchedItemId: null,
    };
}

// ── Resolve confidence for single-candidate name match ────────────────────────

function resolveNameSingleCandidate(row, candidate, packNorm, unitNorm) {
    const existingPackNorm = normalizePackSize(candidate.packSize || '');
    const existingUnitNorm = normalizeUnit(candidate.unit || '');

    const packMatches = !packNorm || !existingPackNorm || packNorm === existingPackNorm;
    const unitMatches = !unitNorm || !existingUnitNorm || unitNorm === existingUnitNorm;
    const minorUnit   = unitNorm && existingUnitNorm && isMinorUnitMismatch(existingUnitNorm, unitNorm);
    const dangerous   = unitNorm && existingUnitNorm && isDangerousUnitFlip(existingUnitNorm, unitNorm);
    const packHasWeight = packContainsWeight(packNorm || existingPackNorm);

    if (packMatches && (unitMatches || minorUnit)) {
        // Pack matches, unit is same or same category (box↔case, lb↔kg) → HIGH confidence
        return {
            matchType: 'name_match_single', confidence: 'high',
            reason: unitMatches
                ? 'Exact name match with single existing item'
                : 'Exact name + pack size match; unit label is equivalent',
            matchedItem: candidate, matchedItemId: candidate.id,
        };
    }

    if (packMatches && !dangerous) {
        // Pack matches but units are different categories (case↔lb, box↔lb)
        // but NOT the dangerous each↔case flip.
        // When pack encodes weight (e.g. 25lb) this is cosmetic → still HIGH
        if (packHasWeight) {
            return {
                matchType: 'name_match_single', confidence: 'high',
                reason: 'Pack size match (weight-encoded); unit label differs but not a pricing risk',
                matchedItem: candidate, matchedItemId: candidate.id,
            };
        }
        // Pack doesn't encode weight → medium confidence (structural diff)
        return {
            matchType: 'name_match_single', confidence: 'medium',
            reason: `Exact name + pack match; unit label differs (${existingUnitNorm} → ${unitNorm}) — verify same product`,
            matchedItem: candidate, matchedItemId: candidate.id,
        };
    }

    if (packMatches && dangerous) {
        // Pack matches but dangerous unit flip (each→case, pcs→lb etc.)
        return {
            matchType: 'name_match_single', confidence: 'medium',
            reason: `Exact name + pack match, but unit type changed significantly (${existingUnitNorm} → ${unitNorm})`,
            matchedItem: candidate, matchedItemId: candidate.id,
        };
    }

    // Pack size itself differs
    return {
        matchType: 'name_match_single', confidence: 'medium',
        reason: `Exact name match; pack size differs (${existingPackNorm || '?'} → ${packNorm || '?'})`,
        matchedItem: candidate, matchedItemId: candidate.id,
    };
}

function toCandidateMeta(c) {
    return {
        id: c.id, name: c.name || c.itemName || '',
        packSize: c.packSize || '', unit: c.unit || '',
        vendorPrice: c.vendorPrice ?? c.price ?? '',
        vendorSKU: c.vendorSKU || '',
    };
}

// ── Resolve actionResult from match + mode + risk ─────────────────────────────

function resolveActionResult(match, normalizedRow, mode) {
    const { matchType, confidence } = match;

    if (matchType === 'new_item') return mode === 'update_existing' ? 'skip' : 'new_item';
    if (matchType === 'new_possible_duplicate') return mode === 'update_existing' ? 'skip' : 'new_possible_duplicate';
    if (matchType === 'name_match_multiple') return 'needs_review';

    if (mode === 'add_new') return 'skip';

    // For any confident match, check high-risk conditions
    if (match.matchedItem) {
        const packNorm = normalizedRow.packSizeNormalized || '';
        const existingPackNorm = normalizePackSize(match.matchedItem.packSize || '');
        const packMatches = !packNorm || !existingPackNorm || packNorm === existingPackNorm;

        const { highRisk, riskReasons } = assessHighRisk(
            match.matchedItem,
            normalizedRow,
            { packMatches, matchType }
        );
        if (highRisk) {
            match._riskReasons = riskReasons;
            return 'high_risk_review';
        }
    }

    if (confidence === 'high')   return 'update_high';
    if (confidence === 'medium') return 'update_medium';
    return 'needs_review';
}

// ── Main export: match all rows ───────────────────────────────────────────────

export function matchAgainstExistingItems(normalizedRows, existingItems, mode) {
    const maps = buildExistingMaps(existingItems);

    return normalizedRows.map(row => {
        if (!row._valid) {
            return {
                ...row, matchType: 'none', confidence: 'n/a',
                reason: 'Row has validation errors',
                actionResult: 'error', changedFields: [], oldValues: {}, newValues: {},
            };
        }

        const match = matchOneRow(row, maps, existingItems);

        let changedFields = [], oldValues = {}, newValues = {};
        if (match.matchedItem) {
            const diff = computeChangedFields(row, match.matchedItem);
            changedFields = diff.changedFields;
            oldValues     = diff.oldValues;
            newValues     = diff.newValues;
        }

        let actionResult = resolveActionResult(match, row, mode);

        // unchanged detection
        if ((actionResult === 'update_high' || actionResult === 'update_medium') && changedFields.length === 0) {
            actionResult = 'unchanged';
        }

        // Price delta for display
        const existingPrice = match.matchedItem
            ? (match.matchedItem.vendorPrice ?? match.matchedItem.price ?? null)
            : null;
        const pricePct = existingPrice !== null && row.price !== ''
            ? priceDeltaPct(existingPrice, row.price)
            : null;

        return {
            ...row,
            matchType:          match.matchType,
            confidence:         match.confidence,
            reason:             match.reason,
            riskReasons:        match._riskReasons || [],
            matchedItemId:      match.matchedItemId,
            matchedItem:        match.matchedItem || null,
            ambiguousCandidates:match.ambiguousCandidates || null,
            similarItems:       match.similarItems || null,
            actionResult,
            changedFields,
            oldValues,
            newValues,
            priceDeltaPct:      pricePct,
            existingPrice,
        };
    });
}

// ── Summary generator ─────────────────────────────────────────────────────────

export function generateMatchSummary(matchedRows) {
    const s = {
        total: 0, newItems: 0, possibleDuplicates: 0,
        updatesHigh: 0, updatesMedium: 0,
        highRiskReview: 0, needsReview: 0,
        unchanged: 0, errors: 0, skipped: 0, warnings: 0,
    };
    matchedRows.forEach(row => {
        s.total++;
        if (row.warnings?.length) s.warnings++;
        switch (row.actionResult) {
            case 'new_item':               s.newItems++;           break;
            case 'new_possible_duplicate': s.possibleDuplicates++; break;
            case 'update_high':            s.updatesHigh++;        break;
            case 'update_medium':          s.updatesMedium++;      break;
            case 'high_risk_review':       s.highRiskReview++;     break;
            case 'needs_review':           s.needsReview++;        break;
            case 'unchanged':              s.unchanged++;          break;
            case 'error':                  s.errors++;             break;
            case 'skip':                   s.skipped++;            break;
            default: break;
        }
    });
    return s;
}
