import React, { useState, useEffect } from 'react';
import { fetchOrderHistory, getRestaurantList, buildRestaurantForecast } from './forecastHelpers';

const TrendBadge = ({ trend }) => {
    let color = '#f59e0b';
    let text = 'Stable';
    if (trend === 'up') { color = '#10b981'; text = 'Increasing'; }
    if (trend === 'down') { color = '#3b82f6'; text = 'Decreasing'; }
    return <span style={{ background: `${color}20`, color, padding: '4px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600 }}>{text}</span>;
};

const ConfidenceBadge = ({ confidence }) => {
    let color = '#10b981';
    if (confidence === 'Medium') color = '#f59e0b';
    if (confidence === 'Low') color = '#f43f5e';
    return <span style={{ color, fontSize: 12, fontWeight: 600 }}>{confidence}</span>;
};

export default function RestaurantForecastPage() {
    const [forecasts, setForecasts] = useState([]);
    const [loading, setLoading] = useState(true);
    const [restaurants, setRestaurants] = useState([]);
    const [selectedRestId, setSelectedRestId] = useState('');
    const [orderRecords, setOrderRecords] = useState([]);

    // Load order history on mount
    useEffect(() => {
        async function loadData() {
            try {
                const records = await fetchOrderHistory(12);
                setOrderRecords(records);
                const restList = getRestaurantList(records);
                setRestaurants(restList);
                if (restList.length > 0 && !selectedRestId) {
                    setSelectedRestId(restList[0]);
                }
            } catch (err) {
                console.error('RestaurantForecastPage load error', err);
            }
            setLoading(false);
        }
        loadData();
    }, []);

    // Build forecast when restaurant selection changes
    useEffect(() => {
        if (!selectedRestId || orderRecords.length === 0) return;
        setLoading(true);

        try {
            const forecast = buildRestaurantForecast(orderRecords, selectedRestId);
            const results = forecast
                .filter(item => (item.mondayQty || 0) + (item.thursdayQty || 0) > 0)
                .map(item => ({
                    itemName: item.itemName,
                    category: item.category || 'Produce',
                    totalQty: (item.mondayQty || 0) + (item.thursdayQty || 0),
                    mondayQty: item.mondayQty || 0,
                    thursdayQty: item.thursdayQty || 0,
                    trend: item.trend || 'stable',
                    confidence: item.confidence || 'Medium',
                    sortWeight: item.weeklyTotal || ((item.mondayQty || 0) + (item.thursdayQty || 0))
                }))
                .sort((a, b) => b.sortWeight - a.sortWeight);

            setForecasts(results);
        } catch (err) {
            console.error('RestaurantForecastPage forecast error', err);
            setForecasts([]);
        }
        setLoading(false);
    }, [selectedRestId, orderRecords]);

    return (
        <div style={{ padding: '0 24px', maxWidth: 1400, margin: '0 auto' }}>
            <div className="page-header" style={{ marginBottom: 32, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                    <h2 style={{ fontSize: 24, fontWeight: 700, margin: 0 }}>Location Delivery Limits</h2>
                    <p style={{ color: 'var(--muted)', marginTop: 8, fontSize: 14 }}>Live Firestore predictions distributed to specific restaurant order flows.</p>
                </div>
                <div style={{ width: 300 }}>
                    <select
                        className="ui-input"
                        value={selectedRestId}
                        onChange={e => setSelectedRestId(e.target.value)}
                        style={{ background: 'var(--bg-panel)', border: '1px solid var(--border)', color: 'var(--text-primary)', padding: '10px 16px', borderRadius: 8, width: '100%' }}
                    >
                        <option value="">Select Location...</option>
                        {restaurants.map(r => <option key={r} value={r}>{r}</option>)}
                    </select>
                </div>
            </div>

            {loading ? (
                <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>Calculating location capacities...</div>
            ) : forecasts.length === 0 ? (
                <div className="ui-card" style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>
                    No items forecasted for this location next week.
                </div>
            ) : (
                <div className="ui-card" style={{ padding: 0, overflow: 'hidden' }}>
                    <table className="ui-table" style={{ margin: 0, width: '100%' }}>
                        <thead>
                            <tr>
                                <th>Item</th>
                                <th>Category</th>
                                <th>Location Weekly Target</th>
                                <th>Monday Route Qt.</th>
                                <th>Thursday Route Qt.</th>
                                <th>Location Trend</th>
                                <th>Confidence</th>
                            </tr>
                        </thead>
                        <tbody>
                            {forecasts.map((f, idx) => (
                                <tr key={idx}>
                                    <td style={{ fontWeight: 600 }}>{f.itemName}</td>
                                    <td style={{ color: 'var(--muted)', fontSize: 13 }}>{f.category}</td>
                                    <td style={{ fontSize: 15, fontWeight: 700, color: '#f8fafc' }}>
                                        {f.totalQty}
                                    </td>
                                    <td>
                                        <span style={{ color: '#3b82f6', fontWeight: 600 }}>{f.mondayQty}</span>
                                    </td>
                                    <td>
                                        <span style={{ color: '#8b5cf6', fontWeight: 600 }}>{f.thursdayQty}</span>
                                    </td>
                                    <td><TrendBadge trend={f.trend} /></td>
                                    <td><ConfidenceBadge confidence={f.confidence} /></td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}
