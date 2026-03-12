/**
 * aiSummaryEngine.js
 *
 * Aggregates insights from all 4 AI engine modules into a weekly intelligence summary.
 * Designed for the SuperAdmin AI Summary Panel.
 *
 * Input:  Results from priceIntelligenceEngine, riskEngine, seasonalUpliftEngine, dispatchOptimizationEngine
 * Output: weeklySummary object
 */

export function generateWeeklySummary({ priceData, riskData, seasonalData, dispatchData, ordersStats }) {
    const insights = [];

    // ── Demand insight ───────────────────────────────────────────────────
    if (ordersStats) {
        insights.push({
            id: 'demand',
            icon: '📈',
            color: '#38bdf8',
            title: 'Weekly Demand',
            text: `${ordersStats.totalItems} items ordered across ${ordersStats.restaurantCount} restaurant${ordersStats.restaurantCount !== 1 ? 's' : ''} this week. Total demand: ${ordersStats.totalQty} units.`,
        });
    }

    // ── Top movers ───────────────────────────────────────────────────────
    if (ordersStats?.topItems?.length > 0) {
        const topNames = ordersStats.topItems.slice(0, 5).map(i => i.name).join(', ');
        insights.push({
            id: 'top_movers',
            icon: '🔥',
            color: '#f59e0b',
            title: 'Top Moving Items',
            text: topNames,
        });
    }

    // ── Price intelligence ────────────────────────────────────────────────
    if (priceData?.summary) {
        const s = priceData.summary;
        if (s.totalMonthlySavings > 0) {
            insights.push({
                id: 'savings',
                icon: '💰',
                color: '#34d399',
                title: 'Savings Opportunity',
                text: `$${s.totalMonthlySavings.toFixed(2)} potential monthly savings identified across ${s.totalItems} items.`,
            });
        }
        if (s.itemsWithAlerts > 0) {
            insights.push({
                id: 'price_alerts',
                icon: '📉',
                color: '#f87171',
                title: 'Price Alerts',
                text: `${s.itemsWithAlerts} item${s.itemsWithAlerts > 1 ? 's' : ''} with vendor prices >10% above market average.`,
            });
        }
    }

    // ── Cheapest vendor ──────────────────────────────────────────────────
    if (priceData?.priceIntelligence?.length > 0) {
        // Find vendor that appears most as cheapest
        const vendorWins = {};
        priceData.priceIntelligence.forEach(r => {
            if (r.cheapestVendor && r.cheapestVendor !== '—') {
                vendorWins[r.cheapestVendor] = (vendorWins[r.cheapestVendor] || 0) + 1;
            }
        });
        const sorted = Object.entries(vendorWins).sort((a, b) => b[1] - a[1]);
        if (sorted.length > 0) {
            insights.push({
                id: 'cheapest_vendor',
                icon: '🏷️',
                color: '#22d3ee',
                title: 'Most Competitive Vendor',
                text: `${sorted[0][0]} offers the lowest price on ${sorted[0][1]} items.`,
            });
        }
    }

    // ── Risk alerts ──────────────────────────────────────────────────────
    if (riskData?.summary) {
        const s = riskData.summary;
        if (s.high > 0) {
            insights.push({
                id: 'risk_high',
                icon: '🚨',
                color: '#f87171',
                title: 'High Risk Alerts',
                text: `${s.high} high-risk alert${s.high > 1 ? 's' : ''} detected — review supply chain immediately.`,
            });
        }
        if (s.medium > 0) {
            insights.push({
                id: 'risk_medium',
                icon: '⚠️',
                color: '#fbbf24',
                title: 'Medium Risk Alerts',
                text: `${s.medium} medium-risk alert${s.medium > 1 ? 's' : ''} — monitor vendor dependencies.`,
            });
        }
    }

    // ── Seasonal ─────────────────────────────────────────────────────────
    if (seasonalData?.summary?.activeNow > 0) {
        const activeEvents = seasonalData.uplifts.filter(e => e.isActive);
        insights.push({
            id: 'seasonal',
            icon: '🎄',
            color: '#a78bfa',
            title: 'Active Seasonal Event',
            text: `${activeEvents.map(e => e.eventName).join(', ')} — demand uplift rules applied.`,
        });
    } else if (seasonalData?.summary?.thisWeek > 0) {
        insights.push({
            id: 'seasonal_upcoming',
            icon: '📅',
            color: '#a78bfa',
            title: 'Upcoming Event This Week',
            text: `${seasonalData.uplifts.filter(e => e.daysUntil <= 7).map(e => e.eventName).join(', ')} starting soon.`,
        });
    }

    // ── Dispatch optimization ────────────────────────────────────────────
    if (dispatchData?.summary?.totalGroups > 0) {
        const s = dispatchData.summary;
        insights.push({
            id: 'dispatch',
            icon: '🚚',
            color: '#818cf8',
            title: 'Dispatch Optimization',
            text: `${s.totalGroups} dispatch group${s.totalGroups > 1 ? 's' : ''} can be consolidated across ${s.uniqueVendors} vendor${s.uniqueVendors > 1 ? 's' : ''}, covering ${s.totalItems} items ($${s.totalValue.toFixed(2)} total value).`,
        });
    }

    return {
        generatedAt: new Date().toISOString(),
        insights,
        kpis: {
            totalInsights: insights.length,
            savingsOpportunity: priceData?.summary?.totalMonthlySavings || 0,
            riskAlerts: riskData?.summary?.total || 0,
            highRisks: riskData?.summary?.high || 0,
            seasonalEvents: seasonalData?.summary?.totalEvents || 0,
            dispatchGroups: dispatchData?.summary?.totalGroups || 0,
        },
    };
}
