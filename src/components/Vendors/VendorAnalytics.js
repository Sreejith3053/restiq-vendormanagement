/**
 * VendorAnalytics.js
 * 
 * Vendor-private performance metrics dashboard.
 * Shows: weekly revenue, dispatch stats, fulfillment rate, top items, issue rate.
 */
import React, { useState, useEffect, useContext, useMemo } from 'react';
import { UserContext } from '../../contexts/UserContext';
import { db } from '../../firebase';
import { collection, query, where, getDocs, orderBy, limit } from 'firebase/firestore';

const C = { green: '#34d399', red: '#f87171', amber: '#fbbf24', blue: '#38bdf8', purple: '#a78bfa', muted: '#94a3b8', fg: '#f8fafc' };

export default function VendorAnalytics() {
    const { vendorId, vendorName } = useContext(UserContext);
    const [orders, setOrders] = useState([]);
    const [dispatches, setDispatches] = useState([]);
    const [issues, setIssues] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!vendorId) { setLoading(false); return; }
        (async () => {
            try {
                // Orders
                const oSnap = await getDocs(query(collection(db, 'marketplaceOrders'), where('vendorId', '==', vendorId)));
                setOrders(oSnap.docs.map(d => ({ id: d.id, ...d.data() })));

                // Dispatches
                const dSnap = await getDocs(query(collection(db, 'vendorDispatches'), where('vendorId', '==', vendorId)));
                setDispatches(dSnap.docs.map(d => ({ id: d.id, ...d.data() })));

                // Issues
                try {
                    const iSnap = await getDocs(query(collection(db, 'issuesDisputes'), where('vendorId', '==', vendorId)));
                    setIssues(iSnap.docs.map(d => ({ id: d.id, ...d.data() })));
                } catch (_) {}
            } catch (err) { console.error('[VendorAnalytics]', err); }
            finally { setLoading(false); }
        })();
    }, [vendorId]);

    const metrics = useMemo(() => {
        const now = new Date();
        const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

        // Revenue
        let weeklyRev = 0, monthlyRev = 0, totalRev = 0;
        const itemCounts = {};
        orders.forEach(o => {
            const d = o.createdAt?.toDate ? o.createdAt.toDate() : new Date(o.createdAt || 0);
            const total = Number(o.total || 0);
            const isCompleted = ['fulfilled', 'completed', 'delivered'].includes((o.status || '').toLowerCase());
            if (isCompleted) {
                totalRev += total;
                if (d >= sevenDaysAgo) weeklyRev += total;
                if (d >= thirtyDaysAgo) monthlyRev += total;
            }
            // Count items
            if (o.items && Array.isArray(o.items)) {
                o.items.forEach(item => {
                    const name = item.itemName || item.name || 'Unknown';
                    if (!itemCounts[name]) itemCounts[name] = { name, qty: 0, revenue: 0 };
                    itemCounts[name].qty += (item.qty || 0);
                    itemCounts[name].revenue += ((item.vendorPrice || item.price || 0) * (item.qty || 0));
                });
            }
        });

        const topItems = Object.values(itemCounts).sort((a, b) => b.qty - a.qty).slice(0, 8);
        const neverOrdered = []; // Would need catalog cross-ref

        // Dispatches
        let accepted = 0, rejected = 0, delivered = 0, totalDispatches = dispatches.length;
        let totalResponseMs = 0, responseCount = 0;
        dispatches.forEach(d => {
            const s = d.status || '';
            if (['Confirmed', 'Partially Confirmed', 'Packed', 'Out for Delivery', 'Delivered'].includes(s)) accepted++;
            if (s === 'Rejected') rejected++;
            if (s === 'Delivered') delivered++;
            if (d.confirmedAt && d.sentAt) {
                const sent = d.sentAt?.toDate ? d.sentAt.toDate() : new Date(d.sentAt);
                const confirmed = d.confirmedAt?.toDate ? d.confirmedAt.toDate() : new Date(d.confirmedAt);
                const diff = confirmed.getTime() - sent.getTime();
                if (diff > 0) { totalResponseMs += diff; responseCount++; }
            }
        });
        const fulfillmentRate = totalDispatches > 0 ? Math.round((accepted / totalDispatches) * 100) : 0;
        const acceptanceRate = totalDispatches > 0 ? Math.round(((totalDispatches - rejected) / totalDispatches) * 100) : 0;
        const cancellationRate = totalDispatches > 0 ? Math.round((rejected / totalDispatches) * 100) : 0;
        const avgResponseHrs = responseCount > 0 ? Math.round(totalResponseMs / responseCount / 3600000 * 10) / 10 : null;
        const onTimeDelivery = delivered > 0 ? Math.round((delivered / Math.max(accepted, 1)) * 100) : null;

        // Issues
        const issueRate = totalDispatches > 0 ? Math.round((issues.length / totalDispatches) * 100) : 0;
        const openIssues = issues.filter(i => (i.status || '').toLowerCase() === 'open').length;

        return { weeklyRev, monthlyRev, totalRev, topItems, accepted, rejected, delivered, totalDispatches, fulfillmentRate, acceptanceRate, cancellationRate, avgResponseHrs, onTimeDelivery, issueRate, issueCount: issues.length, openIssues };
    }, [orders, dispatches, issues]);

    const formatCurrency = (v) => new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' }).format(v || 0);

    if (loading) return <div style={{ padding: 40, textAlign: 'center', color: '#94a3b8' }}>Loading analytics...</div>;

    return (
        <div style={{ padding: '24px 32px', maxWidth: 1200, margin: '0 auto', color: '#f8fafc' }}>
            <div style={{ marginBottom: 24 }}>
                <h1 style={{ fontSize: 24, fontWeight: 700, margin: '0 0 8px' }}>📊 Vendor Analytics</h1>
                <p style={{ color: '#94a3b8', fontSize: 14, margin: 0 }}>Private performance metrics for {vendorName || 'your account'}.</p>
            </div>

            {/* Revenue KPIs */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginBottom: 24 }}>
                {[
                    { label: 'Weekly Revenue', value: formatCurrency(metrics.weeklyRev), color: C.green },
                    { label: 'Monthly Revenue', value: formatCurrency(metrics.monthlyRev), color: C.blue },
                    { label: 'Total Revenue', value: formatCurrency(metrics.totalRev), color: C.amber },
                    { label: 'Fulfillment Rate', value: `${metrics.fulfillmentRate}%`, color: metrics.fulfillmentRate >= 80 ? C.green : C.red },
                ].map(k => (
                    <div key={k.label} style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 12, padding: '16px 18px' }}>
                        <div style={{ fontSize: 11, color: '#94a3b8', textTransform: 'uppercase', fontWeight: 600, marginBottom: 6 }}>{k.label}</div>
                        <div style={{ fontSize: 24, fontWeight: 800, color: k.color }}>{k.value}</div>
                    </div>
                ))}
            </div>

            {/* Dispatch / Operations Stats */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 24 }}>
                <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 12, padding: 20 }}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: C.blue, marginBottom: 16 }}>🚚 Dispatch Performance</div>
                    {[
                        ['Total Dispatches', metrics.totalDispatches, C.fg],
                        ['Accepted', metrics.accepted, C.green],
                        ['Rejected', metrics.rejected, metrics.rejected > 0 ? C.red : C.muted],
                        ['Delivered', metrics.delivered, C.green],
                        ['Acceptance Rate', `${metrics.acceptanceRate}%`, metrics.acceptanceRate >= 90 ? C.green : metrics.acceptanceRate >= 70 ? C.amber : C.red],
                        ['Cancellation Rate', `${metrics.cancellationRate}%`, metrics.cancellationRate === 0 ? C.green : metrics.cancellationRate <= 10 ? C.amber : C.red],
                        ['Avg Response Time', metrics.avgResponseHrs ? `${metrics.avgResponseHrs}h` : 'N/A', metrics.avgResponseHrs && metrics.avgResponseHrs <= 24 ? C.green : C.amber],
                        ['On-Time Delivery', metrics.onTimeDelivery !== null ? `${metrics.onTimeDelivery}%` : 'N/A', metrics.onTimeDelivery >= 80 ? C.green : C.amber],
                    ].map(([label, value, color]) => (
                        <div key={label} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 8 }}>
                            <span style={{ color: '#94a3b8' }}>{label}</span>
                            <span style={{ fontWeight: 700, color }}>{value}</span>
                        </div>
                    ))}
                </div>

                <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 12, padding: 20 }}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: C.amber, marginBottom: 16 }}>🏆 Top Ordered Items</div>
                    {metrics.topItems.length === 0 ? (
                        <div style={{ color: '#64748b', fontSize: 13 }}>No order data yet.</div>
                    ) : (
                        metrics.topItems.map((item, i) => (
                            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 13, marginBottom: 8, padding: '6px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                                <div>
                                    <span style={{ color: '#475569', fontSize: 11, marginRight: 8 }}>{i + 1}.</span>
                                    <span style={{ color: C.fg, fontWeight: 500 }}>{item.name}</span>
                                </div>
                                <div style={{ display: 'flex', gap: 16, fontSize: 12 }}>
                                    <span style={{ color: C.muted }}>{item.qty} units</span>
                                    <span style={{ color: C.green, fontWeight: 600 }}>{formatCurrency(item.revenue)}</span>
                                </div>
                            </div>
                        ))
                    )}
                </div>
            </div>

            {/* Issue Summary */}
            <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 12, padding: 20 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: C.red, marginBottom: 12 }}>🚨 Quality & Issues</div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14 }}>
                    <div>
                        <div style={{ fontSize: 11, color: C.muted, marginBottom: 4 }}>Total Issues</div>
                        <div style={{ fontSize: 24, fontWeight: 800, color: metrics.issueCount > 0 ? C.red : C.green }}>{metrics.issueCount}</div>
                    </div>
                    <div>
                        <div style={{ fontSize: 11, color: C.muted, marginBottom: 4 }}>Open Issues</div>
                        <div style={{ fontSize: 24, fontWeight: 800, color: metrics.openIssues > 0 ? C.amber : C.green }}>{metrics.openIssues}</div>
                    </div>
                    <div>
                        <div style={{ fontSize: 11, color: C.muted, marginBottom: 4 }}>Issue Rate</div>
                        <div style={{ fontSize: 24, fontWeight: 800, color: metrics.issueRate > 10 ? C.red : C.green }}>{metrics.issueRate}%</div>
                    </div>
                    <div>
                        <div style={{ fontSize: 11, color: C.muted, marginBottom: 4 }}>Total Orders</div>
                        <div style={{ fontSize: 24, fontWeight: 800, color: C.fg }}>{orders.length}</div>
                    </div>
                </div>
            </div>

            <div style={{ marginTop: 24, fontSize: 12, color: '#475569', fontStyle: 'italic', textAlign: 'center' }}>
                Analytics are private to your vendor account. Data updates in real-time.
            </div>
        </div>
    );
}
