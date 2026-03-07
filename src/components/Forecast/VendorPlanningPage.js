import React, { useState, useEffect } from 'react';
import { collection, query, where, getDocs, orderBy } from 'firebase/firestore';
import { db } from '../../firebase';
import { ForecastInsightPanel } from './ForecastComponents';

export default function VendorPlanningPage() {
    const [vendors, setVendors] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const loadVendorRollups = async () => {
            setLoading(true);
            try {
                const d = new Date();
                d.setHours(0, 0, 0, 0);
                d.setDate(d.getDate() + ((1 + 7 - d.getDay()) % 7));
                const weekKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

                const q = query(
                    collection(db, 'vendorPlanningForecasts'),
                    where('weekStart', '==', weekKey),
                    orderBy('totalWeeklyDemand', 'desc')
                );

                const snap = await getDocs(q);
                const results = [];
                snap.forEach(d => results.push({ id: d.id, ...d.data() }));
                setVendors(results);
            } catch (err) {
                console.error("Failed to load vendor planning forecasts:", err);
            } finally {
                setLoading(false);
            }
        };
        loadVendorRollups();
    }, []);

    return (
        <div style={{ padding: '0 24px' }}>
            <div className="page-header" style={{ marginBottom: 24 }}>
                <div>
                    <h1>Vendor Delivery Planning</h1>
                    <p className="subtitle" style={{ margin: 0 }}>Review aggregated logistics notes and AI dispatch instructions per vendor.</p>
                </div>
            </div>

            {loading ? (
                <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>Retrieving vendor rollups...</div>
            ) : vendors.length === 0 ? (
                <div className="ui-card" style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>
                    No vendor plans generated for next week.
                </div>
            ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))', gap: 24, paddingBottom: 40 }}>
                    {vendors.map(v => (
                        <div key={v.id} className="ui-card" style={{ padding: 24, display: 'flex', flexDirection: 'column' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                                <h3 style={{ margin: 0, color: '#4dabf7' }}>{v.vendorName || v.vendorId}</h3>
                                <span style={{ background: 'rgba(255,255,255,0.05)', padding: '4px 12px', borderRadius: 20, fontSize: 12 }}>
                                    {v.itemForecasts?.length || 0} Predicted Items
                                </span>
                            </div>

                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
                                <div style={{ border: '1px solid var(--border)', padding: 12, borderRadius: 8, background: 'rgba(77, 171, 247, 0.05)' }}>
                                    <div style={{ fontSize: 11, color: '#4dabf7', marginBottom: 4 }}>MONDAY ESTIMATE</div>
                                    <div style={{ fontSize: 24, fontWeight: 700 }}>{v.totalMondayDemand}</div>
                                </div>
                                <div style={{ border: '1px solid var(--border)', padding: 12, borderRadius: 8, background: 'rgba(132, 94, 247, 0.05)' }}>
                                    <div style={{ fontSize: 11, color: '#845ef7', marginBottom: 4 }}>THURSDAY ESTIMATE</div>
                                    <div style={{ fontSize: 24, fontWeight: 700 }}>{v.totalThursdayDemand}</div>
                                </div>
                            </div>

                            <div style={{ borderTop: '1px solid var(--border)', paddingTop: 16, marginTop: 'auto' }}>
                                <div style={{ marginBottom: 12, display: 'flex', justifyContent: 'space-between', fontSize: 14 }}>
                                    <span style={{ color: 'var(--text-secondary)' }}>Combined Weekly Dispatch Qty:</span>
                                    <strong style={{ fontSize: 16 }}>{v.totalWeeklyDemand}</strong>
                                </div>

                                <ForecastInsightPanel
                                    title="AI Preparation Warning"
                                    content={v.planningNotes || "Produce standard volume distribution."}
                                    type={v.totalThursdayDemand > v.totalMondayDemand ? "warning" : "info"}
                                />

                                <div style={{ marginTop: 16, display: 'flex', gap: 8 }}>
                                    <button className="ui-btn small primary ghost" style={{ flex: 1 }}>Export PDF</button>
                                    <button className="ui-btn small ghost" style={{ flex: 1 }}>Send to Vendor</button>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
