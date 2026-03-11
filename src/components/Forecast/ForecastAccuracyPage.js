import React, { useState, useEffect } from 'react';
import { fetchOrderHistory, getRestaurantList, buildRestaurantForecast } from './forecastHelpers';

export default function ForecastAccuracyPage() {
    const [logs, setLogs] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        async function loadAccuracy() {
            setLoading(true);
            try {
                const records = await fetchOrderHistory(12);
                if (records.length === 0) { setLogs([]); setLoading(false); return; }

                const restaurants = getRestaurantList(records);
                const generatedLogs = [];
                let logCount = 1;

                // Group orders by date to find the latest and previous cycles
                const dateSet = new Set();
                records.forEach(r => { if (r.date) dateSet.add(r.date); });
                const allDates = [...dateSet].sort((a, b) => new Date(b) - new Date(a));
                const latestCycle = allDates[0];

                // For each restaurant, build forecast (which simulates what we would have predicted)
                // then compare with actual latest cycle orders
                for (const rest of restaurants.slice(0, 3)) {
                    const forecast = buildRestaurantForecast(records, rest);
                    const latestActuals = {};
                    records.filter(r => r.restaurantName === rest && r.date === latestCycle)
                        .forEach(r => { latestActuals[r.itemName] = (latestActuals[r.itemName] || 0) + r.qty; });

                    forecast.forEach(item => {
                        const predicted = (item.mondayQty || 0) + (item.thursdayQty || 0);
                        const actual = latestActuals[item.itemName] || 0;
                        if (predicted === 0 && actual === 0) return;

                        const varianceQty = actual - predicted;
                        const variancePercent = predicted > 0 ? Math.round((Math.abs(varianceQty) / predicted) * 100) : 0;
                        let status = 'Accurate';
                        if (varianceQty > 0) status = 'Under Forecast';
                        else if (varianceQty < 0) status = 'Over Forecast';

                        generatedLogs.push({
                            id: `log-${logCount++}`,
                            weekStart: latestCycle,
                            restaurantId: rest,
                            itemId: item.itemName,
                            confidenceAtForecastTime: item.confidence || 'Medium',
                            wasEventAffected: false,
                            predictedWeeklyQty: predicted,
                            actualWeeklyQty: actual,
                            varianceQty, variancePercent, status
                        });
                    });
                }

                setLogs(generatedLogs.sort((a, b) => Math.abs(b.variancePercent) - Math.abs(a.variancePercent)));
            } catch (err) {
                console.error('ForecastAccuracyPage load error', err);
            }
            setLoading(false);
        }
        loadAccuracy();
    }, []);

    return (
        <div style={{ padding: '0 24px', maxWidth: 1200, margin: '0 auto' }}>
            <div className="page-header" style={{ marginBottom: 24 }}>
                <div>
                    <h1>Prediction Accuracy Tracking</h1>
                    <p className="subtitle" style={{ margin: 0 }}>Review how well the forecast model performed against actual Firestore order data.</p>
                </div>
            </div>

            {loading ? (
                <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>Retrieving analytical reconciliations...</div>
            ) : logs.length === 0 ? (
                <div className="ui-card" style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>
                    No accuracy logs available — insufficient order history in Firestore.
                </div>
            ) : (
                <div className="ui-table-wrap fade-in">
                    <table className="ui-table">
                        <thead>
                            <tr>
                                <th>Week Start</th>
                                <th>Restaurant</th>
                                <th>Item</th>
                                <th>Confidence</th>
                                <th>Predicted Total</th>
                                <th>Actual Ordered</th>
                                <th>Variance Qty</th>
                                <th>Variance %</th>
                                <th>Status Result</th>
                            </tr>
                        </thead>
                        <tbody>
                            {logs.map(log => {
                                let statusColor = '#a0aec0';
                                if (log.status === 'Accurate') statusColor = '#4ade80';
                                else if (log.status === 'Over Forecast') statusColor = '#ff6b7a';
                                else if (log.status === 'Under Forecast') statusColor = '#f59f00';

                                return (
                                    <tr key={log.id}>
                                        <td data-label="Week Start" style={{ color: 'var(--muted)' }}>{log.weekStart}</td>
                                        <td data-label="Restaurant" style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{log.restaurantId}</td>
                                        <td data-label="Item" style={{ fontWeight: 600 }}>{log.itemId}</td>
                                        <td data-label="Confidence">
                                            <span style={{ fontSize: 12, padding: '2px 6px', background: 'rgba(255,255,255,0.05)', borderRadius: 4 }}>
                                                {log.confidenceAtForecastTime}
                                            </span>
                                        </td>
                                        <td data-label="Predicted Total" style={{ color: '#4dabf7', fontWeight: 600 }}>{log.predictedWeeklyQty}</td>
                                        <td data-label="Actual Ordered" style={{ fontWeight: 600 }}>{log.actualWeeklyQty}</td>
                                        <td data-label="Variance Qty" style={{ fontWeight: 600, color: log.varianceQty === 0 ? 'var(--text-secondary)' : (log.varianceQty > 0 ? '#f59f00' : '#ff6b7a') }}>
                                            {(log.varianceQty > 0 ? '+' : '')}{log.varianceQty}
                                        </td>
                                        <td data-label="Variance %" style={{ fontWeight: 600 }}>
                                            {log.variancePercent}%
                                        </td>
                                        <td data-label="Status Result">
                                            <span style={{ color: statusColor, fontWeight: 700, fontSize: 12 }}>{log.status}</span>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}
