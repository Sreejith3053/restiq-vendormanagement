/**
 * vendorComparisonEngine.js
 *
 * Core comparison engine for the Vendor Comparison module.
 * Handles unit normalization, savings calculation, weighted vendor scoring,
 * comparability classification, and recommendation labelling.
 *
 * NO side effects — all functions are pure and deterministic.
 */

// ── Unit normalization map ─────────────────────────────────────────────────────
// Maps common unit aliases → canonical base unit + conversion factor TO that base.
const UNIT_CONVERSIONS = {
    // Weight
    lb:  { base: 'lb',  factor: 1 },
    lbs: { base: 'lb',  factor: 1 },
    pound: { base: 'lb', factor: 1 },
    pounds: { base: 'lb', factor: 1 },
    oz:  { base: 'lb',  factor: 1 / 16 },
    ounce: { base: 'lb', factor: 1 / 16 },
    kg:  { base: 'lb',  factor: 2.20462 },
    g:   { base: 'lb',  factor: 0.00220462 },

    // Volume
    gal: { base: 'gal', factor: 1 },
    gallon: { base: 'gal', factor: 1 },
    gallons: { base: 'gal', factor: 1 },
    qt:  { base: 'gal', factor: 0.25 },
    quart: { base: 'gal', factor: 0.25 },
    l:   { base: 'gal', factor: 0.264172 },
    liter: { base: 'gal', factor: 0.264172 },
    litre: { base: 'gal', factor: 0.264172 },
    ml:  { base: 'gal', factor: 0.000264172 },
    fl_oz: { base: 'gal', factor: 0.0078125 },

    // Count / each
    ea:  { base: 'ea',  factor: 1 },
    each: { base: 'ea', factor: 1 },
    pc:  { base: 'ea',  factor: 1 },
    piece: { base: 'ea', factor: 1 },
    pieces: { base: 'ea', factor: 1 },
    ct:  { base: 'ea',  factor: 1 },
    count: { base: 'ea', factor: 1 },

    // Box/case/pack — these stay as-is (cannot convert without per-unit quantity)
    box:  { base: 'box',  factor: 1 },
    case: { base: 'case', factor: 1 },
    bag:  { base: 'bag',  factor: 1 },
    pack: { base: 'pack', factor: 1 },
    bundle: { base: 'bundle', factor: 1 },
};

/**
 * Parse a pack-size string like "50 lb", "25lb", "500 ct", "1 gal".
 * Returns { qty: number, unit: string (canonical base) } or null if unparseable.
 */
export function parsePackSize(packSizeStr) {
    if (!packSizeStr) return null;
    const str = String(packSizeStr).trim().toLowerCase();

    // Match: optional number, optional space, word unit. E.g. "25lb", "25 lb", "500 ct"
    const m = str.match(/^([\d.]+)\s*([a-z_]+)$/);
    if (!m) return null;

    const qty  = parseFloat(m[1]);
    const unit = m[2];
    const conv = UNIT_CONVERSIONS[unit];
    if (!conv || isNaN(qty) || qty <= 0) return null;

    return { qty, rawUnit: unit, baseUnit: conv.base, baseFactor: conv.factor };
}

/**
 * Normalize any vendor price to a per-base-unit price.
 *
 * Examples:
 *  normalizeUnitPrice(20, '50 lb') → $0.40/lb
 *  normalizeUnitPrice(12.50, '25 lb') → $0.50/lb
 *  normalizeUnitPrice(42, '500 ct') → $0.084/ea
 *
 * @returns {{ unitPrice: number, baseUnit: string } | null}
 */
export function normalizeUnitPrice(price, packSizeStr) {
    const parsed = parsePackSize(packSizeStr);
    if (!parsed) return null;

    const priceNum = parseFloat(price);
    if (isNaN(priceNum) || priceNum <= 0) return null;

    // Price per pack → price per raw unit → price per base unit
    const unitPrice = priceNum / (parsed.qty * parsed.baseFactor);
    return { unitPrice: parseFloat(unitPrice.toFixed(6)), baseUnit: parsed.baseUnit };
}

// ── Comparability classifier ───────────────────────────────────────────────────

/**
 * Determine if a set of vendor offers for the same item are comparable.
 *
 * @param {Array<{ price, packSize, updatedAt? }>} offers
 * @returns {{ status: 'comparable'|'non-comparable'|'needs-review', reason: string, confidence: number }}
 */
export function classifyComparability(offers) {
    if (!offers || offers.length < 2) {
        return { status: 'non-comparable', reason: 'Only one vendor — no comparison possible', confidence: 0 };
    }

    const normalized = offers.map(o => {
        const n = normalizeUnitPrice(o.price, o.packSize);
        return { ...o, _normalized: n };
    });

    const missingPackSize = normalized.filter(o => !o.packSize || !o._normalized);
    if (missingPackSize.length > 0) {
        if (missingPackSize.length === normalized.length) {
            return { status: 'non-comparable', reason: 'Pack size missing for all offers', confidence: 0 };
        }
        return { status: 'needs-review', reason: `${missingPackSize.length} offer(s) missing pack size`, confidence: 40 };
    }

    // Check base unit compatibility
    const baseUnits = [...new Set(normalized.map(o => o._normalized?.baseUnit).filter(Boolean))];
    if (baseUnits.length > 1) {
        return { status: 'needs-review', reason: `Incompatible units: ${baseUnits.join(' vs ')}`, confidence: 20 };
    }

    // Stale price check (older than 60 days = lower confidence)
    const now = Date.now();
    const sixtyDaysMs = 60 * 24 * 60 * 60 * 1000;
    const stale = normalized.filter(o => o.updatedAt && (now - new Date(o.updatedAt).getTime()) > sixtyDaysMs);
    if (stale.length === normalized.length) {
        return { status: 'needs-review', reason: 'All vendor prices are stale (>60 days)', confidence: 30 };
    }
    if (stale.length > 0) {
        return { status: 'comparable', reason: `${stale.length} price(s) may be stale`, confidence: 70 };
    }

    return { status: 'comparable', reason: 'All offers normalized successfully', confidence: 95 };
}

// ── Savings calculation ────────────────────────────────────────────────────────

/**
 * Calculate savings potential for a comparable item group.
 *
 * @param {number} benchmarkUnitPrice  Current/median unit price
 * @param {number} bestUnitPrice       Lowest available unit price
 * @param {number} monthlyQty          Estimated monthly usage (in base units)
 * @returns {{ monthly: number, weekly: number, annual: number }}
 */
export function calcSavings(benchmarkUnitPrice, bestUnitPrice, monthlyQty) {
    const bench = parseFloat(benchmarkUnitPrice) || 0;
    const best  = parseFloat(bestUnitPrice) || 0;
    const qty   = parseFloat(monthlyQty) || 0;

    const monthly = Math.max(0, (bench - best) * qty);
    return {
        monthly:  parseFloat(monthly.toFixed(2)),
        weekly:   parseFloat((monthly / 4.33).toFixed(2)),
        annual:   parseFloat((monthly * 12).toFixed(2)),
    };
}

// ── Weighted vendor scoring ────────────────────────────────────────────────────

export const DEFAULT_COMPARISON_WEIGHTS = {
    price:        0.40,
    reliability:  0.25,
    availability: 0.15,
    responseSpeed: 0.10,
    capacity:     0.10,
};

/**
 * Score a vendor for comparison purposes.
 * All factor inputs are 0–1 normalized.
 *
 * @param {{ priceScore, reliabilityScore, availabilityScore, responseScore, capacityScore }} factors
 * @param {Object} weights — override defaults (from platformSettings)
 * @returns {number} 0–100
 */
export function scoreVendorForComparison(factors = {}, weights = DEFAULT_COMPARISON_WEIGHTS) {
    const {
        priceScore        = 0.5,
        reliabilityScore  = 0.8,
        availabilityScore = 0.9,
        responseScore     = 0.7,
        capacityScore     = 0.8,
    } = factors;

    const raw =
        (priceScore        * weights.price)        +
        (reliabilityScore  * weights.reliability)  +
        (availabilityScore * weights.availability) +
        (responseScore     * weights.responseSpeed)+
        (capacityScore     * weights.capacity);

    return Math.round(Math.max(0, Math.min(1, raw)) * 100);
}

// ── Price score helper (copied from competitiveness engine for self-containment) ──
function calcPriceScoreLocal(vendorPrice, lowest, highest) {
    const vp = parseFloat(vendorPrice) || 0;
    if (vp <= 0 || lowest <= 0) return 0;
    const FAIRNESS_BAND = 0.50;
    if (vp <= lowest + FAIRNESS_BAND) {
        return vp <= lowest ? 1.0 : 1.0 - ((vp - lowest) / FAIRNESS_BAND) * 0.05;
    }
    const range = highest - lowest;
    if (range <= 0) return vp <= lowest ? 1.0 : 0.5;
    return Math.max(0, Math.min(1, 1.0 - ((vp - lowest) / range)));
}

// ── Recommendation labels ──────────────────────────────────────────────────────

/**
 * Assign recommendation badges to a ranked list of vendor offers.
 * Input: array of compared vendors with normalizedUnitPrice, comparisonScore, reliabilityScore.
 * Returns the same array with .badge added to each.
 */
export function assignComparisonBadges(vendors) {
    if (!vendors || vendors.length === 0) return vendors;

    const ranked = [...vendors].map(v => ({ ...v, badge: null }));

    // Cheapest by unit price
    const byPrice = [...ranked].sort((a, b) => (a.normalizedUnitPrice || 0) - (b.normalizedUnitPrice || 0));
    if (byPrice[0]) byPrice[0].badge = 'cheapest';

    // Best value = highest comparison score
    const byScore = [...ranked].sort((a, b) => (b.comparisonScore || 0) - (a.comparisonScore || 0));
    if (byScore[0] && byScore[0].badge !== 'cheapest') byScore[0].badge = 'best-value';
    else if (byScore[0]) byScore[0].badge = 'cheapest-best-value';

    // Most reliable
    const byReliability = [...ranked].sort((a, b) => (b.reliabilityScore || 0) - (a.reliabilityScore || 0));
    if (byReliability[0] && !byReliability[0].badge) byReliability[0].badge = 'most-reliable';

    // Risky low price: cheapest but reliability < 0.6
    ranked.forEach(v => {
        if (v.badge === 'cheapest' && (v.reliabilityScore || 0) < 0.6) {
            v.badge = 'risky-low-price';
        }
    });

    // Needs review: any without pack size
    ranked.forEach(v => {
        if (!v.packSize || !v.normalizedUnitPrice) v.badge = 'needs-review';
    });

    return ranked;
}

export const BADGE_CONFIG = {
    'cheapest':             { label: 'Cheapest',       color: '#34d399', bg: 'rgba(52,211,153,0.12)'  },
    'cheapest-best-value':  { label: 'Best Overall',   color: '#34d399', bg: 'rgba(52,211,153,0.12)'  },
    'best-value':           { label: 'Best Value',      color: '#38bdf8', bg: 'rgba(56,189,248,0.12)'  },
    'most-reliable':        { label: 'Most Reliable',   color: '#a78bfa', bg: 'rgba(167,139,250,0.12)' },
    'risky-low-price':      { label: 'Risky Low Price', color: '#f97316', bg: 'rgba(249,115,22,0.12)'  },
    'needs-review':         { label: 'Needs Review',    color: '#fbbf24', bg: 'rgba(251,191,36,0.12)'  },
};

// ── Full group comparison ──────────────────────────────────────────────────────

/**
 * Compare all vendor offers for a single normalized catalog item.
 *
 * @param {string} itemName - normalized catalog item name
 * @param {Array} offers - [{ vendorId, vendorName, price, packSize, category,
 *                             reliabilityStats?, availabilityStats?, responseStats?,
 *                             updatedAt? }]
 * @param {number} monthlyQtyBase - estimated monthly usage in base units
 * @param {Object} weights - optional weight overrides
 * @returns {Object} full comparison result for this item group
 */
export function compareVendorsForItem(itemName, offers, monthlyQtyBase = 0, weights) {
    const sortedOffers = (offers || []).filter(o => o && o.vendorId);
    if (sortedOffers.length === 0) return null;

    const comparability = classifyComparability(sortedOffers);

    // Normalize prices
    const normalized = sortedOffers.map(o => {
        const n = normalizeUnitPrice(o.price, o.packSize);
        return {
            ...o,
            normalizedUnitPrice: n?.unitPrice ?? null,
            baseUnit: n?.baseUnit ?? null,
        };
    }).filter(o => o.normalizedUnitPrice !== null && o.normalizedUnitPrice > 0);

    if (normalized.length === 0) {
        return {
            itemName, comparability,
            vendors: sortedOffers.map(o => ({ ...o, badge: 'needs-review' })),
            stats: null, savings: null,
        };
    }

    const prices = normalized.map(o => o.normalizedUnitPrice);
    const lowest  = Math.min(...prices);
    const highest = Math.max(...prices);
    const sorted  = [...prices].sort((a, b) => a - b);
    const mid     = Math.floor(sorted.length / 2);
    const median  = sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
    const spread  = highest > 0 ? parseFloat((((highest - lowest) / highest) * 100).toFixed(1)) : 0;
    const baseUnit = normalized[0].baseUnit;

    // Score each vendor
    const scoredVendors = normalized.map(o => {
        const priceScore  = calcPriceScoreLocal(o.normalizedUnitPrice, lowest, highest);
        const relScore    = typeof o.reliabilityScore === 'number' ? o.reliabilityScore :
                            (o.reliabilityStats ? calcReliabilityScoreLocal(o.reliabilityStats) : 0.8);
        const availScore  = typeof o.availabilityScore === 'number' ? o.availabilityScore : 0.9;
        const respScore   = typeof o.responseScore === 'number' ? o.responseScore : 0.7;
        const capScore    = typeof o.capacityScore === 'number' ? o.capacityScore : 0.8;

        const compScore   = scoreVendorForComparison({
            priceScore, reliabilityScore: relScore,
            availabilityScore: availScore, responseScore: respScore, capacityScore: capScore,
        }, weights);

        return {
            ...o,
            priceScore: parseFloat(priceScore.toFixed(3)),
            reliabilityScore: parseFloat(relScore.toFixed(3)),
            availabilityScore: parseFloat(availScore.toFixed(3)),
            responseScore: parseFloat(respScore.toFixed(3)),
            capacityScore: parseFloat(capScore.toFixed(3)),
            comparisonScore: compScore,
        };
    });

    // Assign badges
    const vendorsWithBadges = assignComparisonBadges(scoredVendors);
    const byScore  = [...vendorsWithBadges].sort((a, b) => b.comparisonScore - a.comparisonScore);
    const ranked   = byScore.map((v, i) => ({ ...v, rank: i + 1 }));

    // Savings vs median and vs best
    const lowestVendor = vendorsWithBadges.find(v => v.normalizedUnitPrice === lowest);
    const savings = calcSavings(median, lowest, monthlyQtyBase);

    return {
        itemName,
        baseUnit,
        comparability,
        vendors: ranked,
        stats: { lowest, highest, median, spread, vendorCount: ranked.length },
        savings,
        lowestVendor: lowestVendor?.vendorName || '—',
        lowestVendorId: lowestVendor?.vendorId || null,
    };
}

// ── Simple reliability helper ──────────────────────────────────────────────────
function calcReliabilityScoreLocal(stats = {}) {
    const {
        confirmRate = 0.9, onTimeRate = 0.85, fulfillRate = 0.92,
        disputeRate = 0.03, rejectionRate = 0.02, shortShipRate = 0.05,
    } = stats;
    const positive = (confirmRate * 0.40) + (onTimeRate * 0.30) + (fulfillRate * 0.30);
    const penalty  = (disputeRate * 0.4) + (rejectionRate * 0.3) + (shortShipRate * 0.3);
    return Math.max(0, Math.min(1, positive - penalty));
}

// ── Rank band labels for vendor-facing view ────────────────────────────────────
/**
 * Get an anonymous rank band description.
 * priceRank and totalVendors must be determined by the caller.
 */
export function getAnonymousRankBand(priceRank, totalVendors) {
    if (!priceRank || !totalVendors || totalVendors < 2) return null;
    const pct = priceRank / totalVendors;
    if (pct <= 0.25) return 'Top 25% price band';
    if (pct <= 0.50) return 'Top 50% price band';
    if (pct <= 0.75) return 'Lower 50% — pricing above median';
    return 'Bottom 25% — pricing significantly above market';
}

/**
 * Get an anonymous market insight message for a vendor.
 * Never reveals competitor names or exact prices.
 */
export function getAnonymousMarketInsight({ vendorUnitPrice, marketBest, marketMedian, baseUnit }) {
    const vp   = parseFloat(vendorUnitPrice) || 0;
    const best = parseFloat(marketBest) || 0;
    const med  = parseFloat(marketMedian) || 0;
    const unit = baseUnit || 'unit';
    const insights = [];

    if (vp > 0 && best > 0) {
        const aboveBest = vp - best;
        if (aboveBest > 0.001) {
            insights.push(`Your price is $${aboveBest.toFixed(2)}/${unit} above current market best`);
        } else {
            insights.push(`Your price is at or below the current market best — strong position`);
        }
    }

    if (vp > 0 && med > 0) {
        const aboveMed = vp - med;
        if (aboveMed > 0.001) {
            const pctAbove = ((aboveMed / med) * 100).toFixed(0);
            insights.push(`Lowering price by ${pctAbove}% may improve your allocation score`);
        } else {
            insights.push(`Your price is at or below market median`);
        }
    }

    return insights;
}
