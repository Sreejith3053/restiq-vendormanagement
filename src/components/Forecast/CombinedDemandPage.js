import React, { useState, useEffect } from 'react';
import { collection, query, where, getDocs, orderBy } from 'firebase/firestore';
import { db } from '../../firebase';
import { TrendBadge, ForecastInsightPanel } from './ForecastComponents';

export default function CombinedDemandPage() {
    const [aggregated, setAggregated] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const loadAggregates = async () => {
            setLoading(true);
            try {
                const d = new Date();
                d.setHours(0, 0, 0, 0);
                d.setDate(d.getDate() + ((1 + 7 - d.getDay()) % 7));
                const weekKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

                const q = query(
                    collection(db, 'aggregateItemForecasts'),
                    where('weekStart', '==', weekKey),
                    orderBy('totalPredictedWeeklyQty', 'desc')
                );

                const snap = await getDocs(q);
                const results = [];
                snap.forEach(d => results.push({ id: d.id, ...d.data() }));
                setAggregated(results);
            } catch (err) {
                console.error("Failed to load aggregated forecast:", err);
            } finally {
                setLoading(false);
            }
        };
        loadAggregates();
    }, []);

    return (
        <div style={{ padding: '0 24px' }}>
            <div className="page-header" style={{ marginBottom: 24 }}>
                <div>
                    <h1>Combined Marketplace Demand</h1>
                    <p className="subtitle" style={{ margin: 0 }}>Aggregated items requested across all restaurants for procurement/central buying tracking.</p>
                </div>
            </div>

            {loading ? (
                <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>Calculating marketplace totals...</div>
            ) : aggregated.length === 0 ? (
                <div className="ui-card" style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>
                    No accumulated demand generated for next week yet. Wait for engine cron job or manually trigger it.
                </div>
            ) : (
                <div className="ui-table-wrap">
                    <table className="ui-table">
                        <thead>
                            <tr>
                                <th>Item</th>
                                <th>Category</th>
                                <th>Rest. Count</th>
                                <th style={{ background: 'rgba(77, 171, 247, 0.05)' }}>Total Monday Pick</th>
                                <th style={{ background: 'rgba(132, 94, 247, 0.05)' }}>Total Thursday Pick</th>
                                <th>Overall Week Needs</th>
                                <th>Central Buying Opt</th>
                                <th>Assigned Vendor</th>
                            </tr>
                        </thead>
                        <tbody>
                            {aggregated.map(a => (
                                <tr key={a.id}>
                                    <td data-label="Item" style={{ fontWeight: 600 }}>{a.itemName}</td>
                                    <td data-label="Category">{a.category || '-'}</td>
                                    <td data-label="Count">
                                        <span style={{ background: 'rgba(255,255,255,0.1)', padding: '2px 8px', borderRadius: 12, fontSize: 12 }}>
                                            {a.restaurantsCount} locations
                                        </span>
                                    </td>
                                    <td data-label="Total Monday Pick" style={{ color: '#4dabf7', fontWeight: 600, background: 'rgba(77, 171, 247, 0.02)' }}>
                                        {a.totalPredictedMondayDeliveryQty} <span style={{ fontSize: 12, fontWeight: 400, color: 'var(--muted)' }}>{a.unit}</span>
                                    </td>
                                    <td data-label="Total Thursday Pick" style={{ color: '#845ef7', fontWeight: 600, background: 'rgba(132, 94, 247, 0.02)' }}>
                                        {a.totalPredictedThursdayDeliveryQty} <span style={{ fontSize: 12, fontWeight: 400, color: 'var(--muted)' }}>{a.unit}</span>
                                    </td>
                                    <td data-label="Overall Week Needs" style={{ fontSize: 15, fontWeight: 700 }}>
                                        {a.totalPredictedWeeklyQty} <span style={{ fontSize: 12, fontWeight: 400, color: 'var(--muted)' }}>{a.unit}</span>
                                    </td>
                                    <td data-label="Central Buying Opt">
                                        {a.totalPredictedWeeklyQty > 100 && a.restaurantsCount > 2 ? (
                                            <span style={{ fontSize: 11, padding: '2px 6px', background: '#4ade8022', color: '#4ade80', borderRadius: 4 }}>
                                                Bulk Buy Savings
                                            </span>
                                        ) : <span style={{ color: 'var(--muted)' }}>-</span>}
                                    </td>
                                    <td data-label="Vendor">
                                        <span className="badge blue" style={{ background: 'rgba(0,180,255,0.1)', color: '#4dabf7' }}>{a.vendorName || a.vendorId || 'Unassigned'}</span>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}
