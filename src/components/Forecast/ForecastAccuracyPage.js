import React, { useState, useEffect } from 'react';
import { collection, query, orderBy, limit, getDocs } from 'firebase/firestore';
import { db } from '../../firebase';

export default function ForecastAccuracyPage() {
    const [logs, setLogs] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const loadLogs = async () => {
            setLoading(true);
            try {
                // Fetch recent 100 accuracy logs
                const q = query(collection(db, 'forecastAccuracyLogs'), orderBy('generatedAt', 'desc'), limit(100));
                const snap = await getDocs(q);
                const results = [];
                snap.forEach(d => results.push({ id: d.id, ...d.data() }));
                setLogs(results);
            } catch (err) {
                console.error("Failed to load accuracy logs:", err);
            } finally {
                setLoading(false);
            }
        };
        loadLogs();
    }, []);

    return (
        <div style={{ padding: '0 24px' }}>
            <div className="page-header" style={{ marginBottom: 24 }}>
                <div>
                    <h1>Prediction Accuracy Tracking</h1>
                    <p className="subtitle" style={{ margin: 0 }}>Review how well the deterministic model performed against reality week-over-week.</p>
                </div>
            </div>

            {loading ? (
                <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>Retrieving accuracy reconciliations...</div>
            ) : logs.length === 0 ? (
                <div className="ui-card" style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>
                    No accuracy logs available. The backend cron job will generate these routinely after a forecast week closes out.
                </div>
            ) : (
                <div className="ui-table-wrap">
                    <table className="ui-table">
                        <thead>
                            <tr>
                                <th>Week Start</th>
                                <th>Location ID</th>
                                <th>Item ID</th>
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
                                        <td data-label="Location ID" style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{log.restaurantId.substring(0, 8)}...</td>
                                        <td data-label="Item ID" style={{ fontWeight: 600 }}>{log.itemId.substring(0, 8)}...</td>
                                        <td data-label="Confidence">
                                            <span style={{ fontSize: 12, padding: '2px 6px', background: 'rgba(255,255,255,0.05)', borderRadius: 4 }}>
                                                {log.confidenceAtForecastTime}
                                            </span>
                                            {log.wasEventAffected && <span style={{ marginLeft: 6, fontSize: 12 }}>🎉</span>}
                                        </td>
                                        <td data-label="Predicted Total" style={{ color: '#4dabf7', fontWeight: 600 }}>{log.predictedWeeklyQty}</td>
                                        <td data-label="Actual Ordered" style={{ fontWeight: 600 }}>{log.actualWeeklyQty}</td>
                                        <td data-label="Variance Qty" style={{ fontWeight: 600 }}>
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
