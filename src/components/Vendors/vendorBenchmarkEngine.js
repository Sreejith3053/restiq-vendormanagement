/**
 * vendorBenchmarkEngine.js
 *
 * Vendor-facing anonymous market benchmark engine.
 * Pure functions — no side effects, no UI, no Firestore.
 *
 * Privacy contract:
 *   - Inputs are AGGREGATED market numbers (lowest, median) only — no vendor identities
 *   - Outputs never include competitor names, IDs, or exact pricing from others
 */

// ── Position band thresholds (configurable from platformSettings later) ────────
export const DEFAULT_BAND_THRESHOLDS = {
    marketLeading:      0.02,  // within 2% of market best  → Market Leading
    competitive:        0.05,  // within 2–5% of market best → Competitive
    slightlyAbove:      0.10,  // within 5–10% above best   → Slightly Above Market
    // > 10% above best → High Price Risk
};

// ── Position band classifier ──────────────────────────────────────────────────
/**
 * Classify an item into a position band based on price delta vs market best.
 * Returns { band, label, color, icon, description }
 */
export function getPositionBand(vendorUnitPrice, marketBest, thresholds = DEFAULT_BAND_THRESHOLDS) {
    if (!vendorUnitPrice || !marketBest || marketBest <= 0) {
        return {
            band:        'needs-review',
            label:       'Needs Review',
            color:       '#fbbf24',
            bg:          'rgba(251,191,36,0.1)',
            icon:        '⚠️',
            description: 'Insufficient data for accurate comparison',
        };
    }

    const delta = (vendorUnitPrice - marketBest) / marketBest; // fraction above best

    if (delta <= thresholds.marketLeading) {
        return {
            band:        'market-leading',
            label:       'Market Leading',
            color:       '#34d399',
            bg:          'rgba(52,211,153,0.1)',
            icon:        '🏆',
            description: 'Your price is at or near market best',
        };
    }
    if (delta <= thresholds.competitive) {
        return {
            band:        'competitive',
            label:       'Competitive',
            color:       '#38bdf8',
            bg:          'rgba(56,189,248,0.1)',
            icon:        '✅',
            description: 'Your price is within the competitive range',
        };
    }
    if (delta <= thresholds.slightlyAbove) {
        return {
            band:        'slightly-above',
            label:       'Slightly Above Market',
            color:       '#fbbf24',
            bg:          'rgba(251,191,36,0.1)',
            icon:        '📊',
            description: 'Your price is moderately above market best',
        };
    }
    return {
        band:        'high-price-risk',
        label:       'High Price Risk',
        color:       '#f87171',
        bg:          'rgba(248,113,113,0.1)',
        icon:        '🔴',
        description: 'Your price is significantly above market best',
    };
}

// ── Confidence band ───────────────────────────────────────────────────────────
export function getConfidenceBand(confidencePct) {
    if (confidencePct >= 80) return { label: 'High',          color: '#34d399' };
    if (confidencePct >= 50) return { label: 'Medium',        color: '#fbbf24' };
    if (confidencePct >= 20) return { label: 'Low',           color: '#f97316' };
    return                          { label: 'Review Needed', color: '#f87171' };
}

// ── Anonymous percentile description ─────────────────────────────────────────
export function getAnonymousPercentile(priceRank, totalVendors) {
    if (!priceRank || !totalVendors || totalVendors < 2) return null;
    const pct = Math.round((priceRank / totalVendors) * 100);
    if (pct <= 25)  return { label: `Top 25% — strong price position`, icon: '🏅', positive: true };
    if (pct <= 50)  return { label: `Top 50% — competitive`, icon: '📈', positive: true };
    if (pct <= 75)  return { label: `Lower 50% — above median pricing`, icon: '📊', positive: false };
    return                 { label: `Bottom 25% — pricing above most vendors`, icon: '⚠️', positive: false };
}

// ── Delta calculation helpers ─────────────────────────────────────────────────
export function calcDeltaPct(vendorPrice, referencePrice) {
    if (!referencePrice || referencePrice <= 0) return null;
    return parseFloat((((vendorPrice - referencePrice) / referencePrice) * 100).toFixed(1));
}

export function formatDelta(deltaPct, baseUnit = 'unit', absValue = null) {
    if (deltaPct === null) return '—';
    const sign  = deltaPct > 0 ? '+' : '';
    const abs   = absValue != null ? ` ($${Math.abs(absValue).toFixed(4)}/${baseUnit})` : '';
    return `${sign}${deltaPct}%${abs}`;
}

// ── Recommendation engine ─────────────────────────────────────────────────────
/**
 * Generate a list of actionable, non-sensitive recommendations for the vendor.
 * All inputs are sanitized aggregates — no competitor data is passed.
 *
 * @param {Object} params
 * @param {number} params.vendorUnitPrice
 * @param {number} params.marketBest
 * @param {number} params.marketMedian
 * @param {string} params.baseUnit
 * @param {string} params.positionBand
 * @param {number} params.confidencePct       0–100
 * @param {boolean} params.hasPackSize
 * @param {boolean} params.hasFreshPrice      price updated within 60 days
 * @param {number} params.availabilityScore   0–1
 * @param {number} params.responseScore       0–1
 * @param {number} params.reliabilityScore    0–1
 * @param {number} params.capacityScore       0–1 (null if unavailable)
 * @param {string} params.demandTier         'high'|'medium'|'low'|null
 */
export function generateRecommendations(params = {}) {
    const {
        vendorUnitPrice,
        marketBest,
        marketMedian,
        baseUnit = 'unit',
        positionBand,
        confidencePct = 0,
        hasPackSize   = true,
        hasFreshPrice = true,
        availabilityScore = null,
        responseScore     = null,
        reliabilityScore  = null,
        capacityScore     = null,
        demandTier        = null,
    } = params;

    const recs = [];

    // ── Price recommendations ──────────────────────────────────────
    if (vendorUnitPrice && marketBest) {
        const deltaPct = calcDeltaPct(vendorUnitPrice, marketBest);
        const absBest  = vendorUnitPrice - marketBest;

        if (positionBand === 'market-leading') {
            recs.push({
                type: 'success', impact: 'info',
                icon: '🏆',
                text: 'Your price is market-leading — excellent competitive position',
                detail: 'Maintaining this price maximises your allocation chances',
            });
        } else if (positionBand === 'competitive') {
            recs.push({
                type: 'success', impact: 'low',
                icon: '✅',
                text: 'Your price is competitively positioned',
                detail: `A small adjustment of 1–3% could put you in the top band`,
            });
        } else if (positionBand === 'slightly-above') {
            const reducePct = Math.ceil(deltaPct - 2);
            recs.push({
                type: 'warning', impact: 'medium',
                icon: '💰',
                text: `Price is ${deltaPct}% above market best — consider reducing by ${reducePct}%`,
                detail: demandTier === 'high'
                    ? 'This is a high-demand item — competitive pricing may significantly increase your allocation'
                    : 'A moderate price adjustment could improve your competitiveness score',
            });
        } else if (positionBand === 'high-price-risk') {
            const reducePct = Math.ceil(deltaPct - 4);
            recs.push({
                type: 'error', impact: 'high',
                icon: '⚠️',
                text: `Price is ${deltaPct}% above market best — high risk of losing allocation`,
                detail: `Reducing by approximately ${reducePct}% would move you into a competitive range`,
            });
        }

        // Median comparison
        if (marketMedian && vendorUnitPrice > marketMedian) {
            const absMed = vendorUnitPrice - marketMedian;
            recs.push({
                type: 'info', impact: 'medium',
                icon: '📊',
                text: `$${absMed.toFixed(4)}/${baseUnit} above market median`,
                detail: 'You are priced above the majority of market suppliers for this item',
            });
        }
    }

    // ── Data quality recommendations ──────────────────────────────
    if (!hasPackSize) {
        recs.push({
            type: 'warning', impact: 'high',
            icon: '📦',
            text: 'Missing pack size — limits comparison accuracy',
            detail: 'Adding pack size enables precise unit-level comparison and improves your confidence score',
        });
    }

    if (!hasFreshPrice) {
        recs.push({
            type: 'warning', impact: 'medium',
            icon: '🕐',
            text: 'Price may be stale — last update over 60 days ago',
            detail: 'Keeping prices current signals active participation and improves your ranking',
        });
    }

    if (confidencePct < 50) {
        recs.push({
            type: 'info', impact: 'low',
            icon: '🔍',
            text: 'Low comparison confidence — data may be incomplete',
            detail: 'Ensure item name, pack size, and price match catalog expectations',
        });
    }

    // ── Operational recommendations ───────────────────────────────
    if (responseScore !== null && responseScore < 0.7) {
        recs.push({
            type: 'warning', impact: 'medium',
            icon: '⚡',
            text: 'Response time is affecting your performance score',
            detail: 'Confirming dispatches within 4 hours significantly improves your allocation priority',
        });
    }

    if (availabilityScore !== null && availabilityScore < 0.80) {
        recs.push({
            type: 'warning', impact: 'medium',
            icon: '✅',
            text: 'Availability gaps are reducing your competitiveness score',
            detail: 'Reducing out-of-stock periods improves your allocation eligibility',
        });
    }

    if (reliabilityScore !== null && reliabilityScore < 0.75) {
        recs.push({
            type: 'warning', impact: 'high',
            icon: '🛡️',
            text: 'Reliability score is below the competitive threshold',
            detail: 'Improving dispatch confirmation rate and reducing disputes will significantly boost your score',
        });
    }

    if (capacityScore === null) {
        recs.push({
            type: 'info', impact: 'low',
            icon: '📋',
            text: 'No capacity data — add weekly capacity to improve allocation readiness',
            detail: 'Vendors with capacity declared are prioritised for high-volume dispatch allocation',
        });
    }

    // ── Demand tier specific ──────────────────────────────────────
    if (demandTier === 'high' && positionBand === 'high-price-risk') {
        recs.push({
            type: 'error', impact: 'high',
            icon: '🎯',
            text: 'High-demand item with high price risk — significant opportunity being missed',
            detail: 'Competitive pricing on high-demand items can meaningfully increase your monthly revenue',
        });
    }

    // Sort: errors first, then warnings, then info; within each by impact
    const order = { error: 0, warning: 1, success: 2, info: 3 };
    const iOrder = { high: 0, medium: 1, low: 2, info: 3 };
    return recs.sort((a, b) => {
        const byType = (order[a.type] ?? 9) - (order[b.type] ?? 9);
        if (byType !== 0) return byType;
        return (iOrder[a.impact] ?? 9) - (iOrder[b.impact] ?? 9);
    });
}

// ── Conservative demand gain estimation ──────────────────────────────────────
/**
 * Estimate potential monthly demand gain opportunity.
 * Deliberately conservative — uses soft language, never promises exact demand.
 */
export function estimateDemandGain(params = {}) {
    const { positionBand, demandTier, monthlyUsage = 0, vendorUnitPrice = 0, marketBest = 0 } = params;
    if (!demandTier || demandTier === 'unknown') {
        return { available: false, message: 'Insufficient demand history for opportunity estimate' };
    }

    const aboveBest = Math.max(0, vendorUnitPrice - marketBest);
    const savingsAtBest = parseFloat((aboveBest * monthlyUsage).toFixed(2));

    if (positionBand === 'market-leading' || positionBand === 'competitive') {
        return {
            available: true,
            type: 'strong',
            message: 'Your pricing supports strong allocation eligibility',
            subtext: 'Maintain current price to retain competitive advantage',
            savingsAtBest: 0,
        };
    }

    if (positionBand === 'slightly-above') {
        return {
            available: true,
            type: 'opportunity',
            message: 'Moderate pricing opportunity exists',
            subtext: demandTier === 'high'
                ? 'This item has strong marketplace demand — competitive pricing may increase allocation'
                : 'A price adjustment could improve your chances on recurring orders',
            savingsAtBest,
        };
    }

    if (positionBand === 'high-price-risk') {
        return {
            available: true,
            type: 'risk',
            message: 'Current price may be limiting allocation eligibility',
            subtext: demandTier === 'high'
                ? 'Your current pricing on this high-volume item may be causing you to miss significant demand'
                : 'Reducing price to the competitive range could restore allocation for this item',
            savingsAtBest,
        };
    }

    return { available: false, message: 'Position band unknown — cannot estimate demand gain' };
}

// ── Full benchmark record builder ─────────────────────────────────────────────
/**
 * Build a complete benchmark record for a single vendor item.
 * All market inputs are anonymous aggregates (no competitor identities).
 */
export function buildBenchmarkRecord({
    itemName,
    itemDocId,
    category,
    vendorUnitPrice,
    packSize,
    marketBest,
    marketMedian,
    baseUnit,
    confidencePct,
    priceRank,
    totalVendors,
    monthlyUsage,
    demandTier,
    availabilityScore,
    responseScore,
    reliabilityScore,
    capacityScore,
    updatedAt,
    thresholds,
}) {
    const positionBand = getPositionBand(vendorUnitPrice, marketBest, thresholds);
    const confidence   = getConfidenceBand(confidencePct);
    const percentile   = getAnonymousPercentile(priceRank, totalVendors);
    const deltaBest    = calcDeltaPct(vendorUnitPrice, marketBest);
    const deltaMedian  = calcDeltaPct(vendorUnitPrice, marketMedian);
    const absBest      = vendorUnitPrice && marketBest ? vendorUnitPrice - marketBest : null;
    const absMedian    = vendorUnitPrice && marketMedian ? vendorUnitPrice - marketMedian : null;

    const now          = Date.now();
    const hasFreshPrice= updatedAt ? (now - new Date(updatedAt).getTime()) < 60 * 24 * 60 * 60 * 1000 : null;
    const hasPackSize  = Boolean(packSize);

    const recommendations = generateRecommendations({
        vendorUnitPrice, marketBest, marketMedian, baseUnit,
        positionBand: positionBand.band,
        confidencePct,
        hasPackSize,
        hasFreshPrice: hasFreshPrice !== false,
        availabilityScore, responseScore, reliabilityScore, capacityScore,
        demandTier,
    });

    const demandGain = estimateDemandGain({
        positionBand: positionBand.band,
        demandTier, monthlyUsage,
        vendorUnitPrice, marketBest,
    });

    // Primary actionable recommendation (first non-success)
    const primaryRec = recommendations.find(r => r.type !== 'success') || recommendations[0];

    return {
        itemName, itemDocId, category, packSize, baseUnit,
        vendorUnitPrice, marketBest, marketMedian,
        deltaBest, deltaMedian, absBest, absMedian,
        positionBand, confidence, percentile,
        confidencePct, priceRank, totalVendors,
        monthlyUsage, demandTier,
        availabilityScore, responseScore, reliabilityScore, capacityScore,
        hasFreshPrice, hasPackSize,
        recommendations, demandGain,
        primaryRec,
        isComparable: positionBand.band !== 'needs-review' && confidencePct > 0,
    };
}
