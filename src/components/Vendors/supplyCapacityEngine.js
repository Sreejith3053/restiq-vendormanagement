/**
 * supplyCapacityEngine.js
 *
 * Core Supply Capacity Forecast Engine — no UI.
 *
 * Compares next-week forecasted marketplace demand against aggregated
 * vendor supply capacity. Produces health labels, shortage alerts,
 * excess capacity signals, and delivery-day splits.
 *
 * Usage:
 *   import { forecastSupplyHealth, generateMockCapacityForecast, ... } from './supplyCapacityEngine';
 */

// ── Configuration ─────────────────────────────────────────────────────────────

export const CAPACITY_CONFIG = {
    defaultSafetyMargin: 0.10,       // 10% safety margin
    produceSafetyMargin: 0.15,       // 15% for perishables
    packagingSafetyMargin: 0.05,     // 5% for shelf-stable
    healthyThresholdPct: 0.20,       // 20%+ headroom = Healthy
    watchThresholdPct: 0.10,         // 10-20% = Watch
    tightThresholdPct: 0.0,          // 0-10% = Tight
    excessThresholdPct: 0.50,        // 50%+ headroom = Excess Capacity
};

// ── Health Labels ─────────────────────────────────────────────────────────────

export function supplyHealthLabel(capacityGapPct) {
    if (capacityGapPct >= CAPACITY_CONFIG.excessThresholdPct) return { text: 'Excess Capacity', color: '#a78bfa', icon: '🟣' };
    if (capacityGapPct >= CAPACITY_CONFIG.healthyThresholdPct) return { text: 'Healthy', color: '#34d399', icon: '🟢' };
    if (capacityGapPct >= CAPACITY_CONFIG.watchThresholdPct) return { text: 'Watch', color: '#fbbf24', icon: '🟡' };
    if (capacityGapPct >= CAPACITY_CONFIG.tightThresholdPct) return { text: 'Tight', color: '#fb923c', icon: '🟠' };
    return { text: 'Shortage Risk', color: '#f87171', icon: '🔴' };
}

// ── Safety margin per category ────────────────────────────────────────────────

function safetyMarginForCategory(category) {
    const cat = (category || '').toLowerCase();
    if (cat === 'produce' || cat === 'dairy' || cat === 'meat') return CAPACITY_CONFIG.produceSafetyMargin;
    if (cat === 'packaging' || cat === 'cleaning supplies') return CAPACITY_CONFIG.packagingSafetyMargin;
    return CAPACITY_CONFIG.defaultSafetyMargin;
}

// ── Core Forecast Function ────────────────────────────────────────────────────

/**
 * Forecast supply health for a single item / comparable group.
 *
 * @param {Object} params
 * @param {string} params.itemName
 * @param {string} params.comparableGroup
 * @param {string} params.category
 * @param {string} params.weekStart — ISO date
 * @param {Object} params.demand — { monday, thursday, weekly }
 * @param {Array}  params.vendors — [{ vendorId, vendorName, mondayCapacity, thursdayCapacity, weeklyCapacity, stockStatus, leadTimeDays, capacityConfidence, active, isNew }]
 * @param {Object} [params.config] — override CAPACITY_CONFIG
 * @returns {Object} supply forecast result
 */
export function forecastSupplyHealth({
    itemName = '',
    comparableGroup = '',
    category = '',
    weekStart = '',
    demand = {},
    vendors = [],
    config = CAPACITY_CONFIG,
} = {}) {
    // Filter active, in-stock vendors
    const activeVendors = vendors.filter(v => v.active !== false && v.stockStatus !== 'out_of_stock');

    // Aggregate capacity
    const mondayCap = activeVendors.reduce((s, v) => s + (v.mondayCapacity || 0), 0);
    const thursdayCap = activeVendors.reduce((s, v) => s + (v.thursdayCapacity || 0), 0);
    const weeklyCap = activeVendors.reduce((s, v) => s + (v.weeklyCapacity || Math.max(0, (v.mondayCapacity || 0) + (v.thursdayCapacity || 0))), 0);

    const weeklyDemand = demand.weekly || ((demand.monday || 0) + (demand.thursday || 0));
    const mondayDemand = demand.monday || 0;
    const thursdayDemand = demand.thursday || 0;

    // Safety-adjusted demand
    const margin = safetyMarginForCategory(category);
    const safeWeekly = Math.ceil(weeklyDemand * (1 + margin));
    const safeMonday = Math.ceil(mondayDemand * (1 + margin));
    const safeThursday = Math.ceil(thursdayDemand * (1 + margin));

    // Gaps
    const weeklyGap = weeklyCap - safeWeekly;
    const mondayGap = mondayCap - safeMonday;
    const thursdayGap = thursdayCap - safeThursday;

    // Health per period
    const weeklyGapPct = safeWeekly > 0 ? weeklyGap / safeWeekly : (weeklyCap > 0 ? 1 : 0);
    const mondayGapPct = safeMonday > 0 ? mondayGap / safeMonday : (mondayCap > 0 ? 1 : 0);
    const thursdayGapPct = safeThursday > 0 ? thursdayGap / safeThursday : (thursdayCap > 0 ? 1 : 0);

    const weeklyHealth = supplyHealthLabel(weeklyGapPct);
    const mondayHealth = supplyHealthLabel(mondayGapPct);
    const thursdayHealth = supplyHealthLabel(thursdayGapPct);

    // Shortage / excess quantities
    const shortageRiskQty = weeklyGap < 0 ? Math.abs(weeklyGap) : 0;
    const excessCapacityQty = weeklyGap > 0 ? weeklyGap : 0;

    // Vendor detail
    const vendorBreakdown = activeVendors.map(v => ({
        vendorId: v.vendorId,
        vendorName: v.vendorName,
        mondayCapacity: v.mondayCapacity || 0,
        thursdayCapacity: v.thursdayCapacity || 0,
        weeklyCapacity: v.weeklyCapacity || 0,
        stockStatus: v.stockStatus || 'in_stock',
        leadTimeDays: v.leadTimeDays || 0,
        capacityConfidence: v.capacityConfidence || 'declared',
        shareOfCapacity: weeklyCap > 0 ? parseFloat(((v.weeklyCapacity || 0) / weeklyCap).toFixed(4)) : 0,
    }));

    // Alerts
    const alerts = [];
    if (weeklyHealth.text === 'Shortage Risk') {
        alerts.push({ type: 'shortage', severity: 'critical', text: `Shortage risk: ${shortageRiskQty} units short for ${itemName}. Capacity ${weeklyCap} vs demand ${safeWeekly}` });
    }
    if (weeklyHealth.text === 'Tight') {
        alerts.push({ type: 'tight', severity: 'warning', text: `Tight supply for ${itemName}: only ${weeklyGap} units margin (${Math.round(weeklyGapPct * 100)}%)` });
    }
    if (weeklyHealth.text === 'Excess Capacity') {
        alerts.push({ type: 'opportunity', severity: 'info', text: `Excess capacity for ${itemName}: ${excessCapacityQty} units above demand — growth opportunity` });
    }
    if (mondayHealth.text === 'Shortage Risk') {
        alerts.push({ type: 'day_shortage', severity: 'warning', text: `Monday shortage risk: ${Math.abs(mondayGap)} units short` });
    }
    if (thursdayHealth.text === 'Shortage Risk') {
        alerts.push({ type: 'day_shortage', severity: 'warning', text: `Thursday shortage risk: ${Math.abs(thursdayGap)} units short` });
    }

    return {
        itemName,
        comparableGroup,
        category,
        weekStart,

        // Demand
        mondayForecastDemand: mondayDemand,
        thursdayForecastDemand: thursdayDemand,
        weeklyForecastDemand: weeklyDemand,
        safetyMargin: margin,
        safetyAdjustedDemand: safeWeekly,

        // Capacity
        mondayCapacity: mondayCap,
        thursdayCapacity: thursdayCap,
        weeklyCapacity: weeklyCap,
        activeVendorCount: activeVendors.length,

        // Health
        capacityGap: weeklyGap,
        capacityGapPct: parseFloat(weeklyGapPct.toFixed(4)),
        supplyHealthStatus: weeklyHealth.text,
        supplyHealthColor: weeklyHealth.color,
        supplyHealthIcon: weeklyHealth.icon,
        shortageRiskQty,
        excessCapacityQty,

        // Day splits
        mondayHealth: mondayHealth.text,
        thursdayHealth: thursdayHealth.text,
        mondayGap,
        thursdayGap,

        // Vendors
        vendorBreakdown,

        // Alerts
        alerts,

        calculatedAt: new Date().toISOString(),
    };
}

/**
 * Forecast supply health for all items.
 */
export function forecastAll(items = []) {
    return items.map(item => forecastSupplyHealth(item));
}

// ── Mock data generator ───────────────────────────────────────────────────────

export function generateMockCapacityForecast() {
    const nextMonday = (() => {
        const d = new Date(); d.setDate(d.getDate() + ((1 + 7 - d.getDay()) % 7 || 7));
        return d.toISOString().slice(0, 10);
    })();

    const items = [
        {
            itemName: 'Red Onion 25lb', comparableGroup: 'red_onion_25lb', category: 'Produce',
            demand: { monday: 60, thursday: 40 },
            vendors: [
                { vendorId: 'v1', vendorName: 'ON Thyme', mondayCapacity: 40, thursdayCapacity: 30, weeklyCapacity: 80, stockStatus: 'in_stock', leadTimeDays: 1, capacityConfidence: 'history', active: true },
                { vendorId: 'v2', vendorName: 'Test Taas', mondayCapacity: 15, thursdayCapacity: 10, weeklyCapacity: 30, stockStatus: 'in_stock', leadTimeDays: 2, capacityConfidence: 'declared', active: true },
                { vendorId: 'v3', vendorName: 'Vendor A', mondayCapacity: 20, thursdayCapacity: 15, weeklyCapacity: 40, stockStatus: 'in_stock', leadTimeDays: 1, capacityConfidence: 'declared', active: true },
            ],
        },
        {
            itemName: 'Coriander Fresh 1lb', comparableGroup: 'coriander_fresh_1lb', category: 'Produce',
            demand: { monday: 45, thursday: 30 },
            vendors: [
                { vendorId: 'v1', vendorName: 'ON Thyme', mondayCapacity: 35, thursdayCapacity: 25, weeklyCapacity: 70, stockStatus: 'in_stock', leadTimeDays: 1, capacityConfidence: 'history', active: true },
                { vendorId: 'v2', vendorName: 'Test Taas', mondayCapacity: 8, thursdayCapacity: 5, weeklyCapacity: 15, stockStatus: 'limited', leadTimeDays: 2, capacityConfidence: 'estimated', active: true },
            ],
        },
        {
            itemName: '8oz Soup Cup 500ct', comparableGroup: '8oz_soup_cups_500ct', category: 'Packaging',
            demand: { monday: 20, thursday: 15 },
            vendors: [
                { vendorId: 'v1', vendorName: 'ON Thyme', mondayCapacity: 15, thursdayCapacity: 10, weeklyCapacity: 30, stockStatus: 'in_stock', leadTimeDays: 1, capacityConfidence: 'declared', active: true },
                { vendorId: 'v3', vendorName: 'Vendor A', mondayCapacity: 12, thursdayCapacity: 10, weeklyCapacity: 25, stockStatus: 'in_stock', leadTimeDays: 1, capacityConfidence: 'declared', active: true },
                { vendorId: 'v4', vendorName: 'Vendor B', mondayCapacity: 20, thursdayCapacity: 15, weeklyCapacity: 40, stockStatus: 'in_stock', leadTimeDays: 3, capacityConfidence: 'history', active: true },
            ],
        },
        {
            itemName: 'Chicken Breast 10lb', comparableGroup: 'chicken_breast_10lb', category: 'Meat',
            demand: { monday: 30, thursday: 25 },
            vendors: [
                { vendorId: 'v1', vendorName: 'ON Thyme', mondayCapacity: 18, thursdayCapacity: 12, weeklyCapacity: 35, stockStatus: 'in_stock', leadTimeDays: 1, capacityConfidence: 'history', active: true },
                { vendorId: 'v5', vendorName: 'Vendor C', mondayCapacity: 5, thursdayCapacity: 5, weeklyCapacity: 12, stockStatus: 'in_stock', leadTimeDays: 2, capacityConfidence: 'declared', active: true, isNew: true },
            ],
        },
        {
            itemName: 'Cabbage 50lb', comparableGroup: 'cabbage_50lb', category: 'Produce',
            demand: { monday: 50, thursday: 35 },
            vendors: [
                { vendorId: 'v3', vendorName: 'Vendor A', mondayCapacity: 20, thursdayCapacity: 15, weeklyCapacity: 40, stockStatus: 'in_stock', leadTimeDays: 1, capacityConfidence: 'declared', active: true },
            ],
        },
        {
            itemName: 'T28 Container 500ct', comparableGroup: 't28_container_500ct', category: 'Packaging',
            demand: { monday: 8, thursday: 5 },
            vendors: [
                { vendorId: 'v4', vendorName: 'Vendor B', mondayCapacity: 30, thursdayCapacity: 25, weeklyCapacity: 60, stockStatus: 'in_stock', leadTimeDays: 2, capacityConfidence: 'history', active: true },
            ],
        },
    ];

    return items.map(item => forecastSupplyHealth({ ...item, weekStart: nextMonday }));
}
