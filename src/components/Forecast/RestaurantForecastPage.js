import React, { useState, useEffect } from 'react';
import { collection, query, where, getDocs, orderBy, limit } from 'firebase/firestore';
import { db } from '../../firebase';
import { TrendBadge, ConfidenceBadge, ForecastInsightPanel } from './ForecastComponents';

export default function RestaurantForecastPage() {
    const [forecasts, setForecasts] = useState([]);
    const [loading, setLoading] = useState(false);
    const [restaurants, setRestaurants] = useState([]);
    const [selectedRestId, setSelectedRestId] = useState('');
    const [expandedIds, setExpandedIds] = useState(new Set());

    useEffect(() => {
        // Load active restaurants to populate the dropdown filter
        const loadRests = async () => {
            const snap = await getDocs(collection(db, 'restaurants'));
            const list = [];
            snap.forEach(d => list.push({ id: d.id, name: d.data().name || d.data().businessName || 'Unknown' }));
            setRestaurants(list);
            if (list.length > 0) {
                setSelectedRestId(list[0].id);
            }
        };
        loadRests();
    }, []);

    useEffect(() => {
        if (!selectedRestId) return;
        const loadData = async () => {
            setLoading(true);
            try {
                // Determine current week key
                const d = new Date();
                d.setHours(0, 0, 0, 0);
                d.setDate(d.getDate() + ((1 + 7 - d.getDay()) % 7));
                const weekKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

                const q = query(
                    collection(db, 'restaurantItemForecasts'),
                    where('weekStart', '==', weekKey),
                    where('restaurantId', '==', selectedRestId),
                    orderBy('predictedWeeklyQty', 'desc')
                );
                const snap = await getDocs(q);
                const results = [];
                snap.forEach(d => results.push({ id: d.id, ...d.data() }));
                setForecasts(results);
            } catch (err) {
                console.error("Failed to load restaurant forecast:", err);
            } finally {
                setLoading(false);
            }
        };
        loadData();
    }, [selectedRestId]);

    const toggleExpand = (id) => {
        const newSet = new Set(expandedIds);
        if (newSet.has(id)) newSet.delete(id);
        else newSet.add(id);
        setExpandedIds(newSet);
    };

    return (
        <div style={{ padding: '0 24px' }}>
            <div className="page-header" style={{ marginBottom: 24, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                    <h1>Restaurant Delivery Limits</h1>
                    <p className="subtitle" style={{ margin: 0 }}>View specific predicted limits per location.</p>
                </div>
                <div style={{ width: 300 }}>
                    <select className="ui-input" value={selectedRestId} onChange={e => setSelectedRestId(e.target.value)}>
                        <option value="">Select a Restaurant...</option>
                        {restaurants.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                    </select>
                </div>
            </div>

            {loading ? (
                <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>Calculating limits...</div>
            ) : forecasts.length === 0 ? (
                <div className="ui-card" style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>
                    No items forecasted for this restaurant next week.
                </div>
            ) : (
                <div className="ui-table-wrap">
                    <table className="ui-table">
                        <thead>
                            <tr>
                                <th>Item</th>
                                <th>Category</th>
                                <th>Total Wk Limit</th>
                                <th>Monday Route Qt.</th>
                                <th>Thursday Route Qt.</th>
                                <th>Demand Trend</th>
                                <th>Confidence</th>
                                <th>Event Impact</th>
                                <th></th>
                            </tr>
                        </thead>
                        <tbody>
                            {forecasts.map(f => {
                                const isExp = expandedIds.has(f.id);
                                return (
                                    <React.Fragment key={f.id}>
                                        <tr style={{ background: isExp ? 'rgba(255,255,255,0.02)' : 'transparent', cursor: 'pointer' }} onClick={() => toggleExpand(f.id)}>
                                            <td data-label="Item" style={{ fontWeight: 600 }}>{f.itemName}</td>
                                            <td data-label="Category">{f.category || 'Standard'}</td>
                                            <td data-label="Total Wk Limit" style={{ fontSize: 16, fontWeight: 700 }}>{f.predictedWeeklyQty} <span style={{ fontSize: 12, fontWeight: 400, color: 'var(--muted)' }}>{f.unit}</span></td>
                                            <td data-label="Monday Route Qt."><span style={{ color: '#4dabf7', fontWeight: 600 }}>{f.predictedMondayDeliveryQty}</span> <span style={{ fontSize: 11, color: 'var(--muted)' }}>({Math.round(f.mondaySplitPercent)}%)</span></td>
                                            <td data-label="Thursday Route Qt."><span style={{ color: '#845ef7', fontWeight: 600 }}>{f.predictedThursdayDeliveryQty}</span> <span style={{ fontSize: 11, color: 'var(--muted)' }}>({Math.round(f.thursdaySplitPercent)}%)</span></td>
                                            <td data-label="Trend"><TrendBadge trend={f.trend} /></td>
                                            <td data-label="Confidence"><ConfidenceBadge confidence={f.confidence} /></td>
                                            <td data-label="Event Impact">
                                                {f.isEventAffected ? <span style={{ fontSize: 11, padding: '2px 6px', background: '#ff6b7a22', color: '#ff6b7a', borderRadius: 4 }}>🎉 {f.eventNamesApplied?.join(', ')}</span> : <span style={{ color: 'var(--muted)' }}>-</span>}
                                            </td>
                                            <td style={{ textAlign: 'right', color: 'var(--muted)' }}>
                                                {isExp ? '▲' : '▼'}
                                            </td>
                                        </tr>
                                        {isExp && (
                                            <tr style={{ background: 'rgba(255,255,255,0.01)' }}>
                                                <td colSpan={9} style={{ padding: '0 24px 24px 24px', borderBottom: '1px solid var(--border)' }}>
                                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
                                                        <div>
                                                            <ForecastInsightPanel
                                                                title="Gemini AI Analysis"
                                                                content={f.forecastReasoning || "Insufficient history for AI reasoning."}
                                                                type="info"
                                                            />
                                                            <div style={{ marginTop: 16 }}>
                                                                <h5 style={{ margin: '0 0 12px 0', fontSize: 12, color: 'var(--muted)', textTransform: 'uppercase' }}>Delivery Schedule Metrics</h5>
                                                                <div style={{ display: 'flex', gap: 16 }}>
                                                                    <div style={{ padding: 12, background: 'rgba(77,171,247,0.1)', borderRadius: 8, flex: 1 }}>
                                                                        <div style={{ fontSize: 11, color: '#4dabf7', marginBottom: 4 }}>MONDAY WINDOW</div>
                                                                        <div style={{ fontSize: 20, fontWeight: 700 }}>{f.predictedMondayDeliveryQty} <span style={{ fontSize: 13, fontWeight: 400 }}>{f.unit}</span></div>
                                                                        <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Based on {f.mondaySplitPercent}% Mon-Wed usage.</div>
                                                                    </div>
                                                                    <div style={{ padding: 12, background: 'rgba(132,94,247,0.1)', borderRadius: 8, flex: 1 }}>
                                                                        <div style={{ fontSize: 11, color: '#845ef7', marginBottom: 4 }}>THURSDAY WINDOW</div>
                                                                        <div style={{ fontSize: 20, fontWeight: 700 }}>{f.predictedThursdayDeliveryQty} <span style={{ fontSize: 13, fontWeight: 400 }}>{f.unit}</span></div>
                                                                        <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Based on {f.thursdaySplitPercent}% Thu-Sun usage.</div>
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        </div>
                                                        <div>
                                                            <div style={{ padding: 16, background: 'var(--card-bg)', borderRadius: 8, border: '1px solid var(--border)', marginTop: 12 }}>
                                                                <h5 style={{ margin: '0 0 12px 0', fontSize: 12, color: 'var(--muted)', textTransform: 'uppercase' }}>Logistics Configuration</h5>
                                                                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, fontSize: 13 }}>
                                                                    <span style={{ color: 'var(--text-secondary)' }}>Historical Avg Weekly Qty</span>
                                                                    <span>{f.avgWeeklyQty?.toFixed(1) || 0} {f.unit}</span>
                                                                </div>
                                                                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, fontSize: 13 }}>
                                                                    <span style={{ color: 'var(--text-secondary)' }}>Recommended Safety Buffer</span>
                                                                    <span>+{f.safetyBufferQty || 0} {f.unit}</span>
                                                                </div>
                                                                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, fontSize: 13, borderTop: '1px solid var(--border)', paddingTop: 8, fontWeight: 600 }}>
                                                                    <span>Final Dispatch Readiness</span>
                                                                    <span>{f.recommendedDispatchQty || 0} {f.unit}</span>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    </div>
                                                </td>
                                            </tr>
                                        )}
                                    </React.Fragment>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}
