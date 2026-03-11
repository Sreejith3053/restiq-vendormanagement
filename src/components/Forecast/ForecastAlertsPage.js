import React, { useState, useEffect } from 'react';
import { fetchOrderHistory, getRestaurantList, buildRestaurantForecast } from './forecastHelpers';

export default function ForecastAlertsPage() {
    const [alerts, setAlerts] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        async function loadAlerts() {
            setLoading(true);
            try {
                const records = await fetchOrderHistory(12);
                if (records.length === 0) {
                    setAlerts([]);
                    setLoading(false);
                    return;
                }

                const restaurants = getRestaurantList(records);
                const detectedAlerts = [];
                let alertIdCount = 1;

                // Build a global item history for alert detection
                const itemHistory = {};
                records.forEach(r => {
                    const key = r.itemName;
                    if (!key) return;
                    if (!itemHistory[key]) itemHistory[key] = { ordersByDate: {}, restaurants: new Set() };
                    const dateKey = r.date;
                    if (!itemHistory[key].ordersByDate[dateKey]) itemHistory[key].ordersByDate[dateKey] = 0;
                    itemHistory[key].ordersByDate[dateKey] += r.qty;
                    if (r.restaurantName) itemHistory[key].restaurants.add(r.restaurantName);
                });

                const getMedian = (arr) => {
                    if (!arr || arr.length === 0) return 0;
                    const sorted = [...arr].sort((a, b) => a - b);
                    const mid = Math.floor(sorted.length / 2);
                    return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
                };

                Object.entries(itemHistory).forEach(([itemName, data]) => {
                    const dates = Object.keys(data.ordersByDate).sort((a, b) => new Date(b) - new Date(a));
                    if (dates.length < 3) return;
                    const last8 = dates.slice(0, 8).map(d => data.ordersByDate[d]);
                    const median8 = getMedian(last8);
                    const latestDemand = last8[0] || 0;

                    // Rule 1: Sudden spike
                    if (median8 > 2 && latestDemand > median8 * 1.6) {
                        detectedAlerts.push({
                            id: `alt-${alertIdCount++}`,
                            title: `Sudden Spike Detected: ${itemName}`,
                            description: `Recent spike (${latestDemand} units ordered last cycle vs normal average of ${Math.round(median8)}).`,
                            severity: 'High', status: 'Open',
                            createdAt: new Date().toISOString(),
                            suggestedAction: 'Review Vendor Constraints',
                            relatedItemName: itemName
                        });
                    }

                    // Rule 2: Central buying opportunity
                    if (data.restaurants.size >= 3 && median8 >= 15) {
                        detectedAlerts.push({
                            id: `alt-${alertIdCount++}`,
                            title: `Central Buying Opportunity`,
                            description: `${data.restaurants.size} restaurants ordering ${itemName} — consider bulk pallet negotiation.`,
                            severity: 'Info', status: 'Open',
                            createdAt: new Date().toISOString(),
                            suggestedAction: 'Negotiate Bulk Pallet',
                            relatedItemName: itemName
                        });
                    }

                    // Rule 3: Zero-volume drop
                    if (median8 >= 8 && latestDemand === 0) {
                        detectedAlerts.push({
                            id: `alt-${alertIdCount++}`,
                            title: `Unexpected Zero-Volume Drop`,
                            description: `${itemName} had 0 orders last cycle despite a normal average of ${Math.round(median8)}. Check menu status.`,
                            severity: 'Medium', status: 'Open',
                            createdAt: new Date().toISOString(),
                            suggestedAction: 'Check Restaurant Stock',
                            relatedItemName: itemName
                        });
                    }
                });

                setAlerts(detectedAlerts.sort((a, b) => {
                    const severityVal = (v) => v === 'High' ? 3 : v === 'Medium' ? 2 : 1;
                    return severityVal(b.severity) - severityVal(a.severity);
                }));
            } catch (err) {
                console.error('ForecastAlertsPage load error', err);
            }
            setLoading(false);
        }
        loadAlerts();
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
                    <p className="subtitle" style={{ margin: 0 }}>Review live warnings regarding sudden spikes and central buying options from Firestore data.</p>
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
