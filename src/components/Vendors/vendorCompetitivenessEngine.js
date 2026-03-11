/**
 * vendorCompetitivenessEngine.js
 *
 * Core scoring engine — no UI.
 *
 * Calculates a 0–100 Competitiveness Score for vendor-items across
 * 6 weighted factors. Uses mock/simulated data where live Firestore
 * collections are not yet available. Structures are designed to be
 * a drop-in match for future live data.
 *
 * Usage:
 *   import { calculateCompetitivenessScore, scoreLabel, ... } from './vendorCompetitivenessEngine';
 */

import { getCompatibilityMatches } from './marketplaceIntelligence';

// ── Default weights (configurable later via admin) ────────────────────────────
export const DEFAULT_WEIGHTS = {
    price:        40,
    reliability:  25,
    demandMatch:  15,
    availability: 10,
    bundle:        5,
    response:      5,
};

// ── Score label bands ─────────────────────────────────────────────────────────
export function scoreLabel(score) {
    if (score >= 90) return { text: 'Excellent',    color: '#34d399' };
    if (score >= 75) return { text: 'Strong',       color: '#38bdf8' };
    if (score >= 60) return { text: 'Competitive',  color: '#fbbf24' };
    if (score >= 40) return { text: 'Weak',         color: '#f97316' };
    return                  { text: 'At Risk',      color: '#f87171' };
}

// ── Marketplace ranking badges ────────────────────────────────────────────────
export function assignBadges(scoredVendors) {
    if (!scoredVendors.length) return scoredVendors;

    // Sort by final score descending to find best overall
    const sorted = [...scoredVendors].sort((a, b) => b.finalScore - a.finalScore);
    sorted[0].badges = sorted[0].badges || [];
    sorted[0].badges.push('Best Overall Choice');

    // Lowest price
    const lowestPriced = [...scoredVendors].sort((a, b) => a.normalizedPrice - b.normalizedPrice);
    lowestPriced[0].badges = lowestPriced[0].badges || [];
    if (!lowestPriced[0].badges.includes('Best Overall Choice')) {
        lowestPriced[0].badges.push('Lowest Price');
    } else {
        lowestPriced[0].badges.push('Lowest Price');
    }

    // Most reliable
    const mostReliable = [...scoredVendors].sort((a, b) => b.factorBreakdown.reliability - a.factorBreakdown.reliability);
    mostReliable[0].badges = mostReliable[0].badges || [];
    if (!mostReliable[0].badges.includes('Best Overall Choice')) {
        mostReliable[0].badges.push('Most Reliable');
    } else {
        mostReliable[0].badges.push('Most Reliable');
    }

    return sorted;
}

// ── Factor Calculators ────────────────────────────────────────────────────────

/**
 * 1. PRICE COMPETITIVENESS (0–1)
 *
 * Uses a fairness-banded linear interpolation:
 * - at or below lowest → 1.0
 * - at median → 0.5
 * - at or above highest → 0.0
 * - within $0.50 fairness band of lowest → treated as equal (0.95+)
 */
export function calcPriceScore(vendorPrice, lowest, median, highest) {
    const vp = parseFloat(vendorPrice) || 0;
    if (vp <= 0 || lowest <= 0) return 0;

    // Fairness band — small differences ($0.50) shouldn't penalize much
    const FAIRNESS_BAND = 0.50;
    if (vp <= lowest + FAIRNESS_BAND) {
        // Within fairness band of lowest → near-perfect score
        const micro = vp <= lowest ? 1.0 : 1.0 - ((vp - lowest) / FAIRNESS_BAND) * 0.05;
        return Math.max(0, Math.min(1, micro));
    }

    // Linear interpolation: lowest→1, highest→0
    const range = highest - lowest;
    if (range <= 0) return vp <= lowest ? 1.0 : 0.5;
    const raw = 1.0 - ((vp - lowest) / range);
    return Math.max(0, Math.min(1, raw));
}

/**
 * 2. RELIABILITY (0–1)
 *
 * Inputs (all rates 0–1): confirmRate, onTimeRate, fulfillRate, disputeRate, rejectionRate
 * Positive signals weighted, negative signals subtracted.
 */
export function calcReliabilityScore(stats = {}) {
    const {
        confirmRate = 0.9,    // % dispatches confirmed
        onTimeRate = 0.85,    // % delivered on time
        fulfillRate = 0.92,   // % orders fully fulfilled
        disputeRate = 0.03,   // % orders with disputes (lower is better)
        rejectionRate = 0.02, // % dispatches rejected (lower is better)
        shortShipRate = 0.05, // % with short shipments (lower is better)
    } = stats;

    // Positive: 40% confirm + 30% onTime + 30% fulfill
    const positive = (confirmRate * 0.40) + (onTimeRate * 0.30) + (fulfillRate * 0.30);
    // Negative penalty: dispute + rejection + shortShip weighted
    const penalty = (disputeRate * 0.4) + (rejectionRate * 0.3) + (shortShipRate * 0.3);

    return Math.max(0, Math.min(1, positive - penalty));
}

/**
 * 3. DEMAND MATCH / FILL CAPACITY (0–1)
 *
 * Inputs: fulfilledQty, requestedQty, consistencyRate (how often vendor fulfills recurring orders)
 */
export function calcDemandMatchScore(stats = {}) {
    const {
        fulfilledQty = 40,
        requestedQty = 48,
        consistencyRate = 0.85, // 0–1
    } = stats;

    const fillRatio = requestedQty > 0 ? Math.min(1, fulfilledQty / requestedQty) : 0.5;
    // 60% fill ratio + 40% consistency
    return Math.max(0, Math.min(1, (fillRatio * 0.60) + (consistencyRate * 0.40)));
}

/**
 * 4. AVAILABILITY / STOCK HEALTH (0–1)
 *
 * Inputs: isActive, isInStock, stockoutDays (last 30), activeDays (last 30)
 */
export function calcAvailabilityScore(stats = {}) {
    const {
        isActive = true,
        isInStock = true,
        stockoutDays = 0,
        activeDays = 30,
    } = stats;

    if (!isActive) return 0;
    if (!isInStock) return 0.1; // Still listed but out of stock

    const uptimeRatio = activeDays > 0 ? Math.max(0, (activeDays - stockoutDays) / activeDays) : 0.5;
    return Math.max(0, Math.min(1, uptimeRatio));
}

/**
 * 5. BUNDLE COMPLETENESS (0–1)
 *
 * Checks if vendor also supplies companion items from compatibility groups.
 * Uses COMPATIBILITY_MAP from marketplaceIntelligence.
 */
export function calcBundleScore(itemName, vendorItemNames = []) {
    const matches = getCompatibilityMatches(itemName);
    if (!matches || matches.length === 0) return 1.0; // No bundle required → full score

    const vendorNames = new Set(vendorItemNames.map(n => (n || '').trim().toLowerCase()));
    let matched = 0;
    for (const m of matches) {
        if (vendorNames.has((m.matchItem || '').trim().toLowerCase())) {
            matched++;
        }
    }
    return matched / matches.length;
}

/**
 * 6. RESPONSE SPEED (0–1)
 *
 * Inputs: avgConfirmHours, avgIssueResponseHours
 * Benchmarks: <4h = excellent, >24h = poor
 */
export function calcResponseScore(stats = {}) {
    const {
        avgConfirmHours = 6,
        avgIssueResponseHours = 8,
    } = stats;

    const confirmScore = avgConfirmHours <= 2 ? 1.0 : avgConfirmHours <= 6 ? 0.85 : avgConfirmHours <= 12 ? 0.65 : avgConfirmHours <= 24 ? 0.4 : 0.15;
    const issueScore = avgIssueResponseHours <= 2 ? 1.0 : avgIssueResponseHours <= 6 ? 0.85 : avgIssueResponseHours <= 12 ? 0.65 : avgIssueResponseHours <= 24 ? 0.4 : 0.15;

    return (confirmScore * 0.6) + (issueScore * 0.4);
}

// ── Main Scoring Function ─────────────────────────────────────────────────────

/**
 * Calculate the full competitiveness score for a single vendor-item.
 *
 * @param {Object} params
 * @param {string} params.vendorId
 * @param {string} params.vendorName
 * @param {string} params.itemId
 * @param {string} params.itemName
 * @param {string} params.comparableGroup
 * @param {number} params.normalizedPrice — vendor's normalized price
 * @param {number} params.lowestPrice — lowest in comparable group
 * @param {number} params.medianPrice — median in comparable group
 * @param {number} params.highestPrice — highest in comparable group
 * @param {Object} [params.reliabilityStats] — dispatch/delivery stats
 * @param {Object} [params.demandStats] — fulfillment stats
 * @param {Object} [params.availabilityStats] — stock health stats
 * @param {string[]} [params.vendorItemNames] — all item names this vendor has
 * @param {Object} [params.responseStats] — response speed stats
 * @param {Object} [params.weights] — override default weights
 * @returns {Object} scored record
 */
export function calculateCompetitivenessScore({
    vendorId = '',
    vendorName = '',
    itemId = '',
    itemName = '',
    comparableGroup = '',
    normalizedPrice = 0,
    lowestPrice = 0,
    medianPrice = 0,
    highestPrice = 0,
    reliabilityStats = {},
    demandStats = {},
    availabilityStats = {},
    vendorItemNames = [],
    responseStats = {},
    weights = DEFAULT_WEIGHTS,
} = {}) {
    // Calculate each factor (0–1)
    const priceScore       = calcPriceScore(normalizedPrice, lowestPrice, medianPrice, highestPrice);
    const reliabilityScore = calcReliabilityScore(reliabilityStats);
    const demandMatchScore = calcDemandMatchScore(demandStats);
    const availabilityScore= calcAvailabilityScore(availabilityStats);
    const bundleScore      = calcBundleScore(itemName, vendorItemNames);
    const responseScore    = calcResponseScore(responseStats);

    // Weighted sum → 0–100
    const finalScore = Math.round(
        (priceScore       * weights.price) +
        (reliabilityScore * weights.reliability) +
        (demandMatchScore * weights.demandMatch) +
        (availabilityScore* weights.availability) +
        (bundleScore      * weights.bundle) +
        (responseScore    * weights.response)
    );

    return {
        vendorId,
        vendorName,
        itemId,
        itemName,
        comparableGroup,
        normalizedPrice,
        priceScore:       parseFloat(priceScore.toFixed(3)),
        reliabilityScore: parseFloat(reliabilityScore.toFixed(3)),
        demandMatchScore: parseFloat(demandMatchScore.toFixed(3)),
        availabilityScore:parseFloat(availabilityScore.toFixed(3)),
        bundleScore:      parseFloat(bundleScore.toFixed(3)),
        responseScore:    parseFloat(responseScore.toFixed(3)),
        finalScore:       Math.max(0, Math.min(100, finalScore)),
        scoreVersion: '1.0.0',
        factorBreakdown: {
            price:        parseFloat((priceScore       * weights.price).toFixed(1)),
            reliability:  parseFloat((reliabilityScore * weights.reliability).toFixed(1)),
            demandMatch:  parseFloat((demandMatchScore * weights.demandMatch).toFixed(1)),
            availability: parseFloat((availabilityScore* weights.availability).toFixed(1)),
            bundle:       parseFloat((bundleScore      * weights.bundle).toFixed(1)),
            response:     parseFloat((responseScore    * weights.response).toFixed(1)),
        },
        badges: [],
        calculatedAt: new Date().toISOString(),
    };
}

/**
 * Generate improvement suggestions based on the factor breakdown.
 * Returns an array of actionable strings, ordered by potential impact.
 */
export function getImprovementSuggestions(scoreRecord) {
    if (!scoreRecord) return [];

    const suggestions = [];
    const fb = scoreRecord.factorBreakdown;
    const maxPrice = scoreRecord.priceScore < 0.8;
    const maxReliability = scoreRecord.reliabilityScore < 0.85;
    const maxBundle = scoreRecord.bundleScore < 1.0;
    const maxResponse = scoreRecord.responseScore < 0.8;
    const maxAvailability = scoreRecord.availabilityScore < 0.95;
    const maxDemand = scoreRecord.demandMatchScore < 0.8;

    // Sorted by weight impact
    if (maxPrice) {
        const save = scoreRecord.normalizedPrice > 0 ? `$${(scoreRecord.normalizedPrice * 0.025).toFixed(2)}` : 'slightly';
        suggestions.push({
            factor: 'Price',
            icon: '💰',
            text: `Lower your price by ${save} to improve competitiveness`,
            impact: 'High',
            potential: `+${Math.round((1 - scoreRecord.priceScore) * 40 * 0.3)} points`,
        });
    }
    if (maxReliability) {
        suggestions.push({
            factor: 'Reliability',
            icon: '🛡️',
            text: 'Improve dispatch confirmation rate and reduce disputes',
            impact: 'High',
            potential: `+${Math.round((1 - scoreRecord.reliabilityScore) * 25 * 0.3)} points`,
        });
    }
    if (maxDemand) {
        suggestions.push({
            factor: 'Demand Match',
            icon: '📦',
            text: 'Increase fill capacity to consistently meet requested quantities',
            impact: 'Medium',
            potential: `+${Math.round((1 - scoreRecord.demandMatchScore) * 15 * 0.3)} points`,
        });
    }
    if (maxAvailability) {
        suggestions.push({
            factor: 'Availability',
            icon: '✅',
            text: 'Reduce stockout frequency — keep items active and in stock',
            impact: 'Medium',
            potential: `+${Math.round((1 - scoreRecord.availabilityScore) * 10 * 0.3)} points`,
        });
    }
    if (maxBundle) {
        suggestions.push({
            factor: 'Bundle',
            icon: '🔗',
            text: 'Add matching companion items (e.g., lids for cups) to your catalog',
            impact: 'Low',
            potential: `+${Math.round((1 - scoreRecord.bundleScore) * 5 * 0.3)} points`,
        });
    }
    if (maxResponse) {
        suggestions.push({
            factor: 'Response',
            icon: '⚡',
            text: 'Respond to dispatches and issues faster (target under 4 hours)',
            impact: 'Low',
            potential: `+${Math.round((1 - scoreRecord.responseScore) * 5 * 0.3)} points`,
        });
    }

    return suggestions;
}

// ── Mock data generator for demo ──────────────────────────────────────────────

export function generateMockScores() {
    const groups = [
        {
            group: 'red_onion_25lb', category: 'Produce',
            vendors: [
                { id: 'v1', name: 'ON Thyme', price: 19.00, reliability: { confirmRate: 0.95, onTimeRate: 0.92, fulfillRate: 0.94, disputeRate: 0.02, rejectionRate: 0.01, shortShipRate: 0.03 }, demand: { fulfilledQty: 46, requestedQty: 48, consistencyRate: 0.92 }, avail: { isActive: true, isInStock: true, stockoutDays: 1, activeDays: 30 }, response: { avgConfirmHours: 3, avgIssueResponseHours: 5 } },
                { id: 'v2', name: 'Test Taas', price: 18.50, reliability: { confirmRate: 0.82, onTimeRate: 0.78, fulfillRate: 0.80, disputeRate: 0.08, rejectionRate: 0.05, shortShipRate: 0.10 }, demand: { fulfilledQty: 30, requestedQty: 48, consistencyRate: 0.65 }, avail: { isActive: true, isInStock: true, stockoutDays: 5, activeDays: 30 }, response: { avgConfirmHours: 14, avgIssueResponseHours: 20 } },
                { id: 'v3', name: 'Vendor A', price: 20.00, reliability: { confirmRate: 0.90, onTimeRate: 0.88, fulfillRate: 0.91, disputeRate: 0.04, rejectionRate: 0.02, shortShipRate: 0.04 }, demand: { fulfilledQty: 42, requestedQty: 48, consistencyRate: 0.88 }, avail: { isActive: true, isInStock: true, stockoutDays: 2, activeDays: 30 }, response: { avgConfirmHours: 5, avgIssueResponseHours: 7 } },
            ],
        },
        {
            group: 'coriander_fresh_1lb', category: 'Produce',
            vendors: [
                { id: 'v1', name: 'ON Thyme', price: 8.00, reliability: { confirmRate: 0.96, onTimeRate: 0.94, fulfillRate: 0.95, disputeRate: 0.01, rejectionRate: 0.01, shortShipRate: 0.02 }, demand: { fulfilledQty: 38, requestedQty: 40, consistencyRate: 0.95 }, avail: { isActive: true, isInStock: true, stockoutDays: 0, activeDays: 30 }, response: { avgConfirmHours: 2, avgIssueResponseHours: 4 } },
                { id: 'v2', name: 'Test Taas', price: 9.50, reliability: { confirmRate: 0.80, onTimeRate: 0.75, fulfillRate: 0.78, disputeRate: 0.10, rejectionRate: 0.06, shortShipRate: 0.12 }, demand: { fulfilledQty: 25, requestedQty: 40, consistencyRate: 0.60 }, avail: { isActive: true, isInStock: true, stockoutDays: 8, activeDays: 30 }, response: { avgConfirmHours: 18, avgIssueResponseHours: 28 } },
            ],
        },
        {
            group: '8oz_soup_cups_500ct', category: 'Packaging',
            vendors: [
                { id: 'v1', name: 'ON Thyme', price: 42.00, reliability: { confirmRate: 0.93, onTimeRate: 0.90, fulfillRate: 0.92, disputeRate: 0.03, rejectionRate: 0.02, shortShipRate: 0.04 }, demand: { fulfilledQty: 10, requestedQty: 12, consistencyRate: 0.88 }, avail: { isActive: true, isInStock: true, stockoutDays: 2, activeDays: 30 }, response: { avgConfirmHours: 4, avgIssueResponseHours: 6 }, vendorItems: ['8oz Soup Cup', '8oz Soup Cup Lid'] },
                { id: 'v3', name: 'Vendor A', price: 44.50, reliability: { confirmRate: 0.88, onTimeRate: 0.85, fulfillRate: 0.87, disputeRate: 0.05, rejectionRate: 0.03, shortShipRate: 0.06 }, demand: { fulfilledQty: 8, requestedQty: 12, consistencyRate: 0.75 }, avail: { isActive: true, isInStock: true, stockoutDays: 4, activeDays: 30 }, response: { avgConfirmHours: 8, avgIssueResponseHours: 12 }, vendorItems: ['8oz Soup Cup'] },
                { id: 'v4', name: 'Vendor B', price: 48.00, reliability: { confirmRate: 0.97, onTimeRate: 0.96, fulfillRate: 0.98, disputeRate: 0.01, rejectionRate: 0.00, shortShipRate: 0.01 }, demand: { fulfilledQty: 12, requestedQty: 12, consistencyRate: 0.98 }, avail: { isActive: true, isInStock: true, stockoutDays: 0, activeDays: 30 }, response: { avgConfirmHours: 1, avgIssueResponseHours: 2 }, vendorItems: ['8oz Soup Cup', '8oz Soup Cup Lid', '12oz Soup Cup', '12oz Soup Cup Lid'] },
            ],
        },
        {
            group: 'chicken_breast_10lb', category: 'Meat',
            vendors: [
                { id: 'v1', name: 'ON Thyme', price: 28.00, reliability: { confirmRate: 0.94, onTimeRate: 0.91, fulfillRate: 0.93, disputeRate: 0.02, rejectionRate: 0.01, shortShipRate: 0.03 }, demand: { fulfilledQty: 18, requestedQty: 20, consistencyRate: 0.90 }, avail: { isActive: true, isInStock: true, stockoutDays: 1, activeDays: 30 }, response: { avgConfirmHours: 3, avgIssueResponseHours: 5 } },
                { id: 'v5', name: 'Vendor C', price: 34.00, reliability: { confirmRate: 0.98, onTimeRate: 0.97, fulfillRate: 0.99, disputeRate: 0.00, rejectionRate: 0.00, shortShipRate: 0.00 }, demand: { fulfilledQty: 20, requestedQty: 20, consistencyRate: 0.99 }, avail: { isActive: true, isInStock: true, stockoutDays: 0, activeDays: 30 }, response: { avgConfirmHours: 1, avgIssueResponseHours: 2 } },
            ],
        },
    ];

    const allScores = [];
    for (const g of groups) {
        const prices = g.vendors.map(v => v.price);
        const lowest = Math.min(...prices);
        const highest = Math.max(...prices);
        const sorted = [...prices].sort((a, b) => a - b);
        const mid = Math.floor(sorted.length / 2);
        const med = sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];

        for (const v of g.vendors) {
            const record = calculateCompetitivenessScore({
                vendorId: v.id,
                vendorName: v.name,
                itemId: `${v.id}_${g.group}`,
                itemName: g.group,
                comparableGroup: g.group,
                normalizedPrice: v.price,
                lowestPrice: lowest,
                medianPrice: med,
                highestPrice: highest,
                reliabilityStats: v.reliability,
                demandStats: v.demand,
                availabilityStats: v.avail,
                vendorItemNames: v.vendorItems || [],
                responseStats: v.response,
            });
            record.category = g.category;
            allScores.push(record);
        }
    }

    // Assign badges per group
    const grouped = {};
    allScores.forEach(s => {
        (grouped[s.comparableGroup] = grouped[s.comparableGroup] || []).push(s);
    });
    Object.values(grouped).forEach(g => assignBadges(g));

    return allScores;
}
