/**
 * vendorAllocationEngine.js
 *
 * Core allocation engine — no UI.
 *
 * Distributes marketplace demand across vendors using Competitiveness Score,
 * price advantage, reliability protection, capacity limits, stock checks,
 * admin overrides, new vendor entry caps, and marketplace stability rules.
 *
 * Usage:
 *   import { allocateDemand, generateMockAllocations, ... } from './vendorAllocationEngine';
 */

import { calculateCompetitivenessScore, scoreLabel } from './vendorCompetitivenessEngine';

// ── Configuration ─────────────────────────────────────────────────────────────

export const ALLOCATION_CONFIG = {
    maxSingleVendorShare: 0.60,       // No vendor > 60% by default
    reliabilityThreshold: 0.75,       // Below this → capped
    lowReliabilityCap: 0.25,          // Max share for low-reliability vendors
    priceBoostThreshold: 0.03,        // 3% below median → boost
    priceBoostAmount: 0.05,           // +5% allocation boost
    priceBoostMaxMultiplier: 1.15,    // Cap boost at 15%
    newVendorCap: 0.15,               // New vendors start at max 15%
    newVendorThresholdDays: 30,       // Vendors < 30 days = "new"
};

// ── Core Allocation Function ──────────────────────────────────────────────────

/**
 * Allocate demand for a single item across vendors.
 *
 * @param {Object} params
 * @param {string} params.itemName
 * @param {string} params.comparableGroup
 * @param {number} params.totalDemand — total units needed
 * @param {string} [params.deliveryDay] — e.g., 'Monday'
 * @param {Array} params.vendors — [{ vendorId, vendorName, price, capacity, inStock, reliabilityScore, competitivenessScore, isNewVendor, daysActive }]
 * @param {Object} [params.adminOverrides] — { vendorId: { maxShare, paused, boostShare } }
 * @param {Object} [params.config] — override ALLOCATION_CONFIG
 * @returns {Object} allocation result
 */
export function allocateDemand({
    itemName = '',
    comparableGroup = '',
    totalDemand = 0,
    deliveryDay = '',
    vendors = [],
    adminOverrides = {},
    config = ALLOCATION_CONFIG,
} = {}) {
    if (totalDemand <= 0 || vendors.length === 0) {
        return { itemName, comparableGroup, deliveryDay, totalDemand, allocations: [], unallocated: totalDemand, reason: 'No demand or vendors' };
    }

    // Step 1: Filter — remove out-of-stock and paused vendors
    let pool = vendors.filter(v => {
        if (!v.inStock) return false;
        const override = adminOverrides[v.vendorId];
        if (override?.paused) return false;
        return true;
    });

    if (pool.length === 0) {
        return { itemName, comparableGroup, deliveryDay, totalDemand, allocations: [], unallocated: totalDemand, reason: 'All vendors out of stock or paused' };
    }

    // Step 2: Calculate base shares from competitiveness score
    const totalScore = pool.reduce((sum, v) => sum + (v.competitivenessScore || 50), 0);
    let shares = pool.map(v => {
        const score = v.competitivenessScore || 50;
        let share = totalScore > 0 ? score / totalScore : 1 / pool.length;
        return { ...v, baseShare: share, adjustedShare: share, reasons: [] };
    });

    // Step 3: Price advantage boost
    const prices = pool.map(v => v.price).filter(p => p > 0);
    const medianPrice = prices.length > 0 ? prices.sort((a, b) => a - b)[Math.floor(prices.length / 2)] : 0;

    shares = shares.map(s => {
        if (medianPrice > 0 && s.price > 0 && s.price < medianPrice * (1 - config.priceBoostThreshold)) {
            const boost = Math.min(config.priceBoostMaxMultiplier, 1 + config.priceBoostAmount);
            s.adjustedShare = s.adjustedShare * boost;
            s.reasons.push(`Price boost: $${s.price.toFixed(2)} < median $${medianPrice.toFixed(2)}`);
        }
        return s;
    });

    // Step 4: Reliability cap
    shares = shares.map(s => {
        if ((s.reliabilityScore || 0) < config.reliabilityThreshold) {
            if (s.adjustedShare > config.lowReliabilityCap) {
                s.adjustedShare = config.lowReliabilityCap;
                s.reasons.push(`Reliability cap: ${Math.round((s.reliabilityScore || 0) * 100)}% < ${Math.round(config.reliabilityThreshold * 100)}% threshold`);
            }
        }
        return s;
    });

    // Step 5: New vendor cap
    shares = shares.map(s => {
        if (s.isNewVendor || (s.daysActive != null && s.daysActive < config.newVendorThresholdDays)) {
            if (s.adjustedShare > config.newVendorCap) {
                s.adjustedShare = config.newVendorCap;
                s.reasons.push(`New vendor cap: ${Math.round(config.newVendorCap * 100)}% max`);
            }
        }
        return s;
    });

    // Step 6: Admin overrides (max share, boost)
    shares = shares.map(s => {
        const override = adminOverrides[s.vendorId];
        if (override) {
            if (override.maxShare != null && s.adjustedShare > override.maxShare) {
                s.adjustedShare = override.maxShare;
                s.reasons.push(`Admin cap: max ${Math.round(override.maxShare * 100)}%`);
            }
            if (override.boostShare != null) {
                s.adjustedShare = s.adjustedShare * (1 + override.boostShare);
                s.reasons.push(`Admin boost: +${Math.round(override.boostShare * 100)}%`);
            }
        }
        return s;
    });

    // Step 7: Max single vendor share cap
    shares = shares.map(s => {
        if (s.adjustedShare > config.maxSingleVendorShare) {
            s.adjustedShare = config.maxSingleVendorShare;
            s.reasons.push(`Monopoly cap: max ${Math.round(config.maxSingleVendorShare * 100)}%`);
        }
        return s;
    });

    // Step 8: Normalize shares to sum = 1
    const shareTotal = shares.reduce((sum, s) => sum + s.adjustedShare, 0);
    shares = shares.map(s => ({
        ...s,
        normalizedShare: shareTotal > 0 ? s.adjustedShare / shareTotal : 1 / shares.length,
    }));

    // Step 9: Allocate units (respect capacity)
    let remaining = totalDemand;
    let allocations = shares.map(s => {
        let qty = Math.round(s.normalizedShare * totalDemand);
        // Cap at vendor capacity
        if (s.capacity != null && s.capacity > 0 && qty > s.capacity) {
            qty = s.capacity;
            s.reasons.push(`Capacity limited: max ${s.capacity} units`);
        }
        qty = Math.min(qty, remaining);
        remaining -= qty;
        return {
            vendorId: s.vendorId,
            vendorName: s.vendorName,
            allocatedQuantity: qty,
            allocationShare: parseFloat((qty / totalDemand).toFixed(4)),
            competitivenessScore: s.competitivenessScore || 50,
            scoreBand: scoreLabel(s.competitivenessScore || 50).text,
            price: s.price,
            reliability: s.reliabilityScore || 0,
            capacity: s.capacity,
            baseShare: parseFloat(s.baseShare.toFixed(4)),
            adjustedShare: parseFloat(s.normalizedShare.toFixed(4)),
            allocationReason: s.reasons.length > 0 ? s.reasons.join('; ') : 'Standard score-based allocation',
        };
    });

    // Step 10: Redistribute remaining (from capacity limits, rounding)
    if (remaining > 0) {
        const available = allocations.filter(a => !a.capacity || a.allocatedQuantity < a.capacity);
        if (available.length > 0) {
            const perVendor = Math.ceil(remaining / available.length);
            for (const a of available) {
                if (remaining <= 0) break;
                const add = Math.min(perVendor, remaining, (a.capacity || Infinity) - a.allocatedQuantity);
                a.allocatedQuantity += add;
                a.allocationShare = parseFloat((a.allocatedQuantity / totalDemand).toFixed(4));
                remaining -= add;
            }
        }
    }

    // Sort by allocation descending
    allocations.sort((a, b) => b.allocatedQuantity - a.allocatedQuantity);

    return {
        itemName,
        comparableGroup,
        deliveryDay,
        totalDemand,
        allocations,
        unallocated: Math.max(0, remaining),
        vendorCount: allocations.length,
        topVendor: allocations[0]?.vendorName || '—',
        concentrationRisk: allocations[0] ? (allocations[0].allocationShare > 0.5 ? 'High' : allocations[0].allocationShare > 0.35 ? 'Medium' : 'Low') : 'None',
        calculatedAt: new Date().toISOString(),
    };
}

/**
 * Allocate demand for multiple items × delivery days.
 */
export function allocateAll({ items = [], adminOverrides = {}, config = ALLOCATION_CONFIG } = {}) {
    return items.map(item => allocateDemand({ ...item, adminOverrides, config }));
}

/**
 * Calculate supply stability score for a comparable group.
 * Higher = more balanced distribution across vendors.
 */
export function supplyStabilityScore(allocations) {
    if (!allocations || allocations.length === 0) return 0;
    const shares = allocations.map(a => a.allocationShare);
    const avg = 1 / shares.length;
    const variance = shares.reduce((sum, s) => sum + Math.pow(s - avg, 2), 0) / shares.length;
    // Perfect balance = 1.0, monopoly = 0.0
    return Math.max(0, Math.min(100, Math.round((1 - Math.sqrt(variance) * 3) * 100)));
}

// ── Mock data generator ───────────────────────────────────────────────────────

export function generateMockAllocations() {
    const groups = [
        {
            itemName: 'Red Onion 25lb', comparableGroup: 'red_onion_25lb',
            demands: [{ day: 'Monday', qty: 60 }, { day: 'Thursday', qty: 40 }],
            vendors: [
                { vendorId: 'v1', vendorName: 'ON Thyme', price: 19.00, capacity: 100, inStock: true, reliabilityScore: 0.94, competitivenessScore: 89, isNewVendor: false },
                { vendorId: 'v2', vendorName: 'Test Taas', price: 18.50, capacity: 50, inStock: true, reliabilityScore: 0.68, competitivenessScore: 52, isNewVendor: false },
                { vendorId: 'v3', vendorName: 'Vendor A', price: 20.00, capacity: 200, inStock: true, reliabilityScore: 0.88, competitivenessScore: 75, isNewVendor: false },
            ],
        },
        {
            itemName: 'Coriander Fresh 1lb', comparableGroup: 'coriander_fresh_1lb',
            demands: [{ day: 'Monday', qty: 45 }, { day: 'Thursday', qty: 30 }],
            vendors: [
                { vendorId: 'v1', vendorName: 'ON Thyme', price: 8.00, capacity: 80, inStock: true, reliabilityScore: 0.95, competitivenessScore: 92, isNewVendor: false },
                { vendorId: 'v2', vendorName: 'Test Taas', price: 9.50, capacity: 40, inStock: true, reliabilityScore: 0.62, competitivenessScore: 45, isNewVendor: false },
            ],
        },
        {
            itemName: '8oz Soup Cup 500ct', comparableGroup: '8oz_soup_cups_500ct',
            demands: [{ day: 'Monday', qty: 20 }, { day: 'Thursday', qty: 15 }],
            vendors: [
                { vendorId: 'v1', vendorName: 'ON Thyme', price: 42.00, capacity: 30, inStock: true, reliabilityScore: 0.92, competitivenessScore: 84, isNewVendor: false },
                { vendorId: 'v3', vendorName: 'Vendor A', price: 44.50, capacity: 25, inStock: true, reliabilityScore: 0.85, competitivenessScore: 70, isNewVendor: false },
                { vendorId: 'v4', vendorName: 'Vendor B', price: 48.00, capacity: 50, inStock: true, reliabilityScore: 0.97, competitivenessScore: 88, isNewVendor: false },
            ],
        },
        {
            itemName: 'Chicken Breast 10lb', comparableGroup: 'chicken_breast_10lb',
            demands: [{ day: 'Monday', qty: 30 }, { day: 'Thursday', qty: 25 }],
            vendors: [
                { vendorId: 'v1', vendorName: 'ON Thyme', price: 28.00, capacity: 40, inStock: true, reliabilityScore: 0.93, competitivenessScore: 86, isNewVendor: false },
                { vendorId: 'v5', vendorName: 'Vendor C', price: 34.00, capacity: 60, inStock: true, reliabilityScore: 0.98, competitivenessScore: 82, isNewVendor: true, daysActive: 12 },
            ],
        },
    ];

    const allAllocations = [];
    for (const g of groups) {
        for (const d of g.demands) {
            const result = allocateDemand({
                itemName: g.itemName,
                comparableGroup: g.comparableGroup,
                totalDemand: d.qty,
                deliveryDay: d.day,
                vendors: g.vendors,
            });
            allAllocations.push(result);
        }
    }
    return allAllocations;
}
