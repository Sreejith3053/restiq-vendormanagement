import React, { useState, useEffect } from 'react';
import { collection, query, orderBy, limit, getDocs } from 'firebase/firestore';
import { db } from '../../firebase';

export default function ForecastAlertsPage() {
    const [alerts, setAlerts] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const loadAlerts = async () => {
            setLoading(true);
            try {
                // Fetch recent alerts
                const q = query(collection(db, 'forecastAlerts'), orderBy('createdAt', 'desc'), limit(50));
                const snap = await getDocs(q);
                const results = [];
                snap.forEach(d => results.push({ id: d.id, ...d.data() }));
                setAlerts(results);
            } catch (err) {
                console.error("Failed to load alerts:", err);
            } finally {
                setLoading(false);
            }
        };
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
        <div style={{ padding: '0 24px' }}>
            <div className="page-header" style={{ marginBottom: 24, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                    <h1>Forecast Alerts & Opportunities</h1>
                    <p className="subtitle" style={{ margin: 0 }}>Review AI-detected shortage risks, unusual spikes, and central buying options.</p>
                </div>
                <button className="ui-btn primary ghost">Mark All Read</button>
            </div>

            {loading ? (
                <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>Scanning alerts...</div>
            ) : alerts.length === 0 ? (
                <div className="ui-card" style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>
                    No alerts triggered over the last week. The AI monitor is quiet.
                </div>
            ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                    {alerts.map(alert => {
                        const style = getSeverityDetails(alert.severity);
                        return (
                            <div key={alert.id} className="ui-card" style={{ padding: 20, display: 'flex', gap: 16, alignItems: 'flex-start', background: alert.status === 'Open' ? 'var(--card-bg)' : 'rgba(255,255,255,0.02)' }}>
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
