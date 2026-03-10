import React, { useState, useEffect } from 'react';
import vendorCatalogV2 from '../../data/catalog_v2.json';
import purchaseDatasetV2 from '../../data/history_realistic_v2_tomato.json';

const V2_BASELINE_OVERRIDES = {
    'Onion - Cooking': { min: 40, speed: 'Fast' },
    'Onion - Red': { min: 3, speed: 'Slow' },
    'Cabbage': { min: 2, speed: 'Slow' },
    'Carrot': { min: 4, speed: 'Slow' },
    'French Beans': { min: 0, speed: 'None' },
    'Potatoes': { min: 10, speed: 'Medium' }
};

export default function ForecastAlertsPage() {
    const [alerts, setAlerts] = useState([]);
    const [loading, setLoading] = useState(true);

    const getMedian = (arr) => {
        if (!arr || arr.length === 0) return 0;
        const sorted = [...arr].sort((a, b) => a - b);
        const mid = Math.floor(sorted.length / 2);
        if (sorted.length % 2 === 0) return (sorted[mid - 1] + sorted[mid]) / 2;
        return sorted[mid];
    };

    useEffect(() => {
        setLoading(true);
        setTimeout(() => {
            const detectedAlerts = [];
            const historyMap = {};
            const globalDatesSet = new Set();
            let alertIdCount = 1;

            purchaseDatasetV2.forEach(data => {
                if (!data.purchase_date || !data.item_name) return;
                const exactName = data.item_name.trim().toLowerCase()
                    .replace(/\b\w/g, c => c.toUpperCase());

                globalDatesSet.add(data.purchase_date);

                if (!historyMap[exactName]) {
                    historyMap[exactName] = { itemName: exactName, orderHistoryMap: {}, locationCount: new Set() };
                }

                historyMap[exactName].locationCount.add(data.location_name);

                const qty = Number(data.normalized_quantity) || 0;
                if (!historyMap[exactName].orderHistoryMap[data.purchase_date]) {
                    historyMap[exactName].orderHistoryMap[data.purchase_date] = 0;
                }
                historyMap[exactName].orderHistoryMap[data.purchase_date] += qty;
            });

            const allCycles = [...globalDatesSet].sort((a, b) => new Date(b).getTime() - new Date(a).getTime());
            const last8Cycles = allCycles.slice(0, 8);
            const latestCycle = last8Cycles[0];

            Object.values(historyMap).forEach(item => {
                const qtyIn8Filtered = last8Cycles.filter(date => (item.orderHistoryMap[date] || 0) > 0);
                const qtyIn8 = last8Cycles.map(date => item.orderHistoryMap[date] || 0);

                const median8 = getMedian(qtyIn8);
                const latestDemand = item.orderHistoryMap[latestCycle] || 0;

                const override = V2_BASELINE_OVERRIDES[item.itemName];

                // Rule 1: High Demand Anomaly Warning (Ignore manually suppressed items)
                if (median8 > 2 && latestDemand > (median8 * 1.6) && (!override || override.min > 0)) {
                    detectedAlerts.push({
                        id: `alt-${alertIdCount++}`,
                        title: `Sudden Spike Detected: ${item.itemName}`,
                        description: `The deterministic engine capped next week's order, but recorded a recent spike (${latestDemand} units ordered last week vs normal average of ${Math.round(median8)}).`,
                        severity: 'High',
                        status: 'Open',
                        createdAt: new Date().toISOString(),
                        suggestedAction: 'Review Vendor Constraints',
                        relatedItemName: item.itemName
                    });
                }

                // Rule 2: Multiple locations creating central buying opp
                if (item.locationCount.size >= 3 && median8 >= 15 && !override) {
                    detectedAlerts.push({
                        id: `alt-${alertIdCount++}`,
                        title: `Central Buying Opportunity`,
                        description: `High decentralized volume detected. ${item.locationCount.size} separate restaurants are requesting significant volumes of ${item.itemName}.`,
                        severity: 'Info',
                        status: 'Open',
                        createdAt: new Date().toISOString(),
                        suggestedAction: 'Negotiate Bulk Pallet',
                        relatedItemName: item.itemName
                    });
                }

                // Rule 3: Zero Demand Drop Warning for High Mover
                if (median8 >= 8 && latestDemand === 0 && !override) {
                    detectedAlerts.push({
                        id: `alt-${alertIdCount++}`,
                        title: `Unexpected Zero-Volume Drop`,
                        description: `A traditionally fast moving item (${item.itemName}) had exactly 0 orders last week. Ensure the item wasn't accidentally removed from the menu.`,
                        severity: 'Medium',
                        status: 'Open',
                        createdAt: new Date().toISOString(),
                        suggestedAction: 'Check Restaurant Stock',
                        relatedItemName: item.itemName
                    });
                }
            });

            setAlerts(detectedAlerts.sort((a, b) => {
                const severityVal = (v) => v === 'High' ? 3 : v === 'Medium' ? 2 : 1;
                return severityVal(b.severity) - severityVal(a.severity);
            }));
            setLoading(false);

        }, 400);
    }, []);

    const getSeverityDetails = (severity) => {
        switch (severity) {
            case 'High': return { color: '#ff6b7a', bg: 'rgba(255, 107, 122, 0.1)', icon: '🚨' };
            case 'Medium': return { color: '#f59f00', bg: 'rgba(245, 159, 0, 0.1)', icon: '⚠️' };
            default: return { color: '#4dabf7', bg: 'rgba(77, 171, 247, 0.1)', icon: 'ℹ️' };
        }
    };

    return (
        <div style={{ padding: '0 24px', maxWidth: 1000, margin: '0 auto' }}>
            <div className="page-header" style={{ marginBottom: 24, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                    <h1>Forecast Alerts & Opportunities</h1>
                    <p className="subtitle" style={{ margin: 0 }}>Review deterministic warnings regarding sudden spikes and central buying options.</p>
                </div>
                <button className="ui-btn primary ghost">Mark All Read</button>
            </div>

            {loading ? (
                <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>Scanning analytical pipeline...</div>
            ) : alerts.length === 0 ? (
                <div className="ui-card" style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>
                    No alerts triggered over the last week. The AI monitor is quiet.
                </div>
            ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                    {alerts.map(alert => {
                        const style = getSeverityDetails(alert.severity);
                        return (
                            <div key={alert.id} className="ui-card fade-in" style={{ padding: 20, display: 'flex', gap: 16, alignItems: 'flex-start', background: alert.status === 'Open' ? 'var(--card-bg)' : 'rgba(255,255,255,0.02)' }}>
                                <div style={{ fontSize: 24, background: style.bg, width: 48, height: 48, borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                    {style.icon}
                                </div>
                                <div style={{ flex: 1 }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                                        <h4 style={{ margin: 0, fontSize: 16, color: style.color }}>{alert.title}</h4>
                                        <span style={{ fontSize: 12, color: 'var(--muted)' }}>{new Date(alert.createdAt).toLocaleString()}</span>
                                    </div>
                                    <p style={{ margin: '0 0 12px 0', fontSize: 14, color: 'var(--text-secondary)' }}>
                                        {alert.description}
                                    </p>
                                    <div style={{ display: 'flex', gap: 12 }}>
                                        {alert.suggestedAction && (
                                            <button className="ui-btn small ghost" style={{ color: style.color, borderColor: style.color }}>
                                                Action: {alert.suggestedAction}
                                            </button>
                                        )}
                                        {alert.relatedItemName && (
                                            <span style={{ background: 'rgba(255,255,255,0.05)', padding: '4px 12px', borderRadius: 12, fontSize: 12 }}>
                                                Item: {alert.relatedItemName}
                                            </span>
                                        )}
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
