/**
 * marketplaceIntelligence.js
 *
 * Pure-logic module — no UI.
 *
 * Provides anonymous marketplace benchmarking, pricing recommendations,
 * billed-volume impact estimation, and cup/lid compatibility mapping.
 *
 * Usage:
 *   import { getMarketBenchmark, getPriceRecommendations, ... } from './marketplaceIntelligence';
 */

// ── Compatibility Map ─────────────────────────────────────────────────────────
// Hard pairs: item name → matched item name + expected ratio + bundle type

export const COMPATIBILITY_MAP = {
    '8oz Soup Cup':            { match: '8oz Soup Cup Lid',     ratio: '1:1', type: 'lid' },
    '8oz Soup Cup Lid':        { match: '8oz Soup Cup',         ratio: '1:1', type: 'lid' },
    '12oz Soup Cup':           { match: '12oz Soup Cup Lid',    ratio: '1:1', type: 'lid' },
    '12oz Soup Cup Lid':       { match: '12oz Soup Cup',        ratio: '1:1', type: 'lid' },
    '16oz Clear Container':    { match: '16oz Clear Lid',       ratio: '1:1', type: 'lid' },
    '16oz Clear Lid':          { match: '16oz Clear Container', ratio: '1:1', type: 'lid' },
    '24oz Clear Container':    { match: '24oz Clear Lid',       ratio: '1:1', type: 'lid' },
    '24oz Clear Lid':          { match: '24oz Clear Container', ratio: '1:1', type: 'lid' },
    'T28 Container':           { match: 'T28 Clear Lid',        ratio: '1:1', type: 'lid' },
    'T28 Clear Lid':           { match: 'T28 Container',        ratio: '1:1', type: 'lid' },
    'T34 Container':           { match: 'T34 Clear Lid',        ratio: '1:1', type: 'lid' },
    'T34 Clear Lid':           { match: 'T34 Container',        ratio: '1:1', type: 'lid' },
    'RC24 Container':          { match: 'RC24 Lid',             ratio: '1:1', type: 'lid' },
    'RC24 Lid':                { match: 'RC24 Container',       ratio: '1:1', type: 'lid' },
    'RC32 Container':          { match: 'RC32 Lid',             ratio: '1:1', type: 'lid' },
    'RC32 Lid':                { match: 'RC32 Container',       ratio: '1:1', type: 'lid' },
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function median(arr) {
    if (!arr.length) return 0;
    const s = [...arr].sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    return s.length % 2 === 0 ? (s[m - 1] + s[m]) / 2 : s[m];
}

/** Fuzzy-normalise names for cross-vendor comparison */
function normaliseName(n) {
    if (!n) return '';
    return n.trim().toLowerCase()
        .replace(/\s+/g, ' ')
        .replace(/['']/g, "'");
}

// ── Core Functions ────────────────────────────────────────────────────────────

/**
 * Scan all active marketplace items for the same comparable product.
 *
 * @param {string}   itemName   — name of the item to benchmark
 * @param {string}   category   — category (Produce, Packaging, etc.)
 * @param {Object[]} allItems   — flat array of { name, vendorPrice, vendorId, priceHistory? }
 *                                 fetched from Firestore `vendors/{id}/items` across all vendors
 * @returns {{ lowest, median, highest, trend4w, volatility, supplierCount }}
 */
export function getMarketBenchmark(itemName, category, allItems = []) {
    const needle = normaliseName(itemName);
    if (!needle) return null;

    // Find all comparable items across vendors
    const comparables = allItems.filter(i => {
        if (!i.name || !i.vendorPrice) return false;
        const n = normaliseName(i.name);
        // Exact name match or close match within same category
        return n === needle && (
            !category || !i.category || i.category.toLowerCase() === category.toLowerCase()
        );
    });

    const prices = comparables
        .map(i => parseFloat(i.vendorPrice) || 0)
        .filter(p => p > 0);

    if (prices.length === 0) {
        return {
            lowest: 0, median: 0, highest: 0,
            trend4w: 0, volatility: 'None',
            supplierCount: 0,
        };
    }

    const sorted = [...prices].sort((a, b) => a - b);
    const lowest = sorted[0];
    const highest = sorted[sorted.length - 1];
    const med = median(prices);

    // 4-week trend: use priceHistory if available, else estimate from spread
    let trend4w = 0;
    const withHistory = comparables.filter(c => c.priceHistory && c.priceHistory.length >= 2);
    if (withHistory.length > 0) {
        // Average the per-item trend
        const trends = withHistory.map(c => {
            const h = c.priceHistory; // [{ price, date }] sorted ascending
            const recent = parseFloat(h[h.length - 1].price) || 0;
            const older  = parseFloat(h[0].price) || recent;
            return older > 0 ? ((recent - older) / older) * 100 : 0;
        });
        trend4w = parseFloat((trends.reduce((a, b) => a + b, 0) / trends.length).toFixed(1));
    }

    // Volatility
    const spread = highest - lowest;
    const spreadPct = med > 0 ? (spread / med) * 100 : 0;
    let volatility = 'Low';
    if (spreadPct > 15 || Math.abs(trend4w) > 8) volatility = 'High';
    else if (spreadPct > 7 || Math.abs(trend4w) > 4) volatility = 'Medium';

    return {
        lowest,
        median: parseFloat(med.toFixed(2)),
        highest,
        trend4w,
        volatility,
        supplierCount: prices.length,
    };
}

/**
 * Generate pricing recommendations based on benchmark.
 *
 * @param {number} vendorPrice  — the vendor's entered price
 * @param {Object} benchmark    — output of getMarketBenchmark
 * @returns {{ aggressivePrice, matchPrice, safeRange, riskLevel }}
 */
export function getPriceRecommendations(vendorPrice, benchmark) {
    if (!benchmark || benchmark.supplierCount === 0) return null;

    const { lowest, median: med, highest, trend4w, volatility } = benchmark;
    const vp = parseFloat(vendorPrice) || 0;

    // Aggressive = 2.5% below current lowest (clamped to not go negative)
    const aggressivePrice = parseFloat(Math.max(lowest * 0.975, 0.01).toFixed(2));

    // Competitive match = current lowest
    const matchPrice = parseFloat(lowest.toFixed(2));

    // Safe range = lowest … median
    const safeRange = [
        parseFloat(lowest.toFixed(2)),
        parseFloat(med.toFixed(2)),
    ];

    // Risk level for the vendor's current price
    let riskLevel = 'Low';
    if (vp > highest) riskLevel = 'Critical';
    else if (vp > med) riskLevel = 'High';
    else if (vp > lowest) riskLevel = 'Medium';
    // If trend is sharply rising, lower the risk perceived
    if (trend4w > 5 && riskLevel !== 'Low') {
        riskLevel = riskLevel === 'Critical' ? 'High' : riskLevel === 'High' ? 'Medium' : 'Low';
    }

    return { aggressivePrice, matchPrice, safeRange, riskLevel };
}

/**
 * Estimate billed-volume impact of a price change.
 *
 * Uses a simple elasticity model:
 *   - % price change → proportional inverse demand change
 *   - Monthly baseline estimated from median market volume
 *
 * @param {number} currentPrice — existing vendor price (0 if new item)
 * @param {number} newPrice     — new/proposed vendor price
 * @param {Object} benchmark    — output of getMarketBenchmark
 * @param {number} [weeklyUnits] — optional known weekly unit volume
 * @returns {{ monthlyGainRange, monthlyLossRange, demandRisk, rankingImpact }}
 */
export function estimateBilledVolumeImpact(currentPrice, newPrice, benchmark, weeklyUnits = 12) {
    const cp = parseFloat(currentPrice) || 0;
    const np = parseFloat(newPrice) || 0;
    if (!benchmark || benchmark.supplierCount === 0 || np <= 0) return null;

    // Approximate current monthly billed
    const currentMonthly = cp > 0 ? cp * weeklyUnits * 4 : 0;

    const pctChange = cp > 0 ? ((np - cp) / cp) * 100 : 0;

    // Simple elasticity: 1% price increase → ~1.2% demand decrease (B2B food)
    const ELASTICITY = 1.2;
    const demandChangePct = -pctChange * ELASTICITY;

    // Monthly volume estimate
    const projectedMonthly = np * weeklyUnits * 4 * Math.max(0.2, 1 + demandChangePct / 100);

    let monthlyGainRange = null;
    let monthlyLossRange = null;

    if (np < cp) {
        // Price decrease → gain
        const gainLow  = parseFloat(Math.abs(projectedMonthly - currentMonthly) * 0.6).toFixed(2);
        const gainHigh = parseFloat(Math.abs(projectedMonthly - currentMonthly) * 1.3).toFixed(2);
        monthlyGainRange = [parseFloat(gainLow), parseFloat(gainHigh)];
    } else if (np > cp && cp > 0) {
        // Price increase → loss
        const lossLow  = parseFloat(Math.abs(currentMonthly - projectedMonthly) * 0.5).toFixed(2);
        const lossHigh = parseFloat(Math.abs(currentMonthly - projectedMonthly) * 1.2).toFixed(2);
        monthlyLossRange = [parseFloat(lossLow), parseFloat(lossHigh)];
    }

    // Demand risk
    let demandRisk = 'Low';
    if (Math.abs(pctChange) > 15) demandRisk = 'High';
    else if (Math.abs(pctChange) > 7) demandRisk = 'Medium';

    // Ranking impact
    let rankingImpact = 'Unchanged';
    if (np <= benchmark.lowest) rankingImpact = 'Best price — top ranking';
    else if (np <= benchmark.median) rankingImpact = 'Competitive — good ranking';
    else if (np <= benchmark.highest) rankingImpact = 'Above median — lower ranking';
    else rankingImpact = 'Highest priced — may lose priority';

    return {
        currentMonthly: parseFloat(currentMonthly.toFixed(2)),
        projectedMonthly: parseFloat(projectedMonthly.toFixed(2)),
        monthlyGainRange,
        monthlyLossRange,
        demandRisk,
        rankingImpact,
    };
}

/**
 * Look up compatibility/bundle matches for an item.
 *
 * @param {string} itemName — the item to check
 * @returns {Array<{ matchItem, ratio, bundleType }>|null}
 */
export function getCompatibilityMatches(itemName) {
    if (!itemName) return null;

    const results = [];
    const needle = normaliseName(itemName);

    for (const [key, val] of Object.entries(COMPATIBILITY_MAP)) {
        if (normaliseName(key) === needle) {
            results.push({
                matchItem: val.match,
                ratio: val.ratio,
                bundleType: val.type,
            });
        }
    }

    return results.length > 0 ? results : null;
}

/**
 * Given a list of item names in an order, return items that are missing
 * their required bundle counterpart.
 *
 * @param {string[]} orderItemNames — array of item names in the current order
 * @returns {Array<{ item, missingMatch, ratio, bundleType }>}
 */
export function findMissingBundlePairs(orderItemNames = []) {
    const normalised = new Set(orderItemNames.map(normaliseName));
    const missing = [];

    for (const name of orderItemNames) {
        const matches = getCompatibilityMatches(name);
        if (!matches) continue;

        for (const m of matches) {
            if (!normalised.has(normaliseName(m.matchItem))) {
                // Don't add duplicate warnings
                if (!missing.find(x => normaliseName(x.item) === normaliseName(name))) {
                    missing.push({
                        item: name,
                        missingMatch: m.matchItem,
                        ratio: m.ratio,
                        bundleType: m.bundleType,
                    });
                }
            }
        }
    }

    return missing;
}
