/**
 * VendorExpectedAllocation.js
 *
 * Vendor-facing expected allocation view.
 * Shows the vendor's expected marketplace demand share, allocated quantities
 * per item and delivery day, and tips to increase share.
 *
 * Data sources:
 *   - vendors/{id}/items  → vendor catalog, prices
 *   - marketplaceOrders   → demand computation
 *   - vendorAllocationEngine.allocateDemand() → allocation algorithm
 */
import React, { useState, useEffect } from 'react';
import {
    FiRefreshCw, FiTrendingUp, FiPackage, FiPieChart,
} from 'react-icons/fi';
import { toast } from 'react-toastify';
import { UserContext } from '../../contexts/UserContext';
import { db } from '../../firebase';
import { collection, getDocs } from 'firebase/firestore';
import { fetchOrderHistory } from '../Forecast/forecastHelpers';
import { allocateDemand } from './vendorAllocationEngine';
import { calculateCompetitivenessScore, scoreLabel } from './vendorCompetitivenessEngine';

const C = { green: '#34d399', red: '#f87171', amber: '#fbbf24', blue: '#38bdf8', purple: '#a78bfa', cyan: '#22d3ee', muted: '#94a3b8', fg: '#f8fafc' };

function normalizeItemName(n) { return (n || '').trim().replace(/\s+/g, ' '); }
function getMedian(arr) {
    if (!arr.length) return 0;
    const s = [...arr].sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    return s.length % 2 === 0 ? (s[m - 1] + s[m]) / 2 : s[m];
}

async function loadAllocations() {
    const vendorsSnap = await getDocs(collection(db, 'vendors'));
    const vendors = vendorsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    const allItems = [];
    for (const v of vendors) {
        try {
            const itemSnap = await getDocs(collection(db, `vendors/${v.id}/items`));
            const vendorItemNames = itemSnap.docs.map(d => (d.data().name || '').trim());
            itemSnap.docs.forEach(d => {
                const data = d.data();
                const name = normalizeItemName(data.name);
                if (!name) return;
                const price = parseFloat(data.vendorPrice) || parseFloat(data.price) || 0;
                if (price <= 0) return;
                allItems.push({ vendorId: v.id, vendorName: v.name || 'Unknown', itemId: d.id, itemName: name, price, category: data.category || 'Produce', inStock: data.inStock !== false, vendorItemNames });
            });
        } catch (_) {}
    }

    const orderRecords = await fetchOrderHistory(12);
    const itemGroups = {};
    allItems.forEach(item => { const key = item.itemName.toLowerCase(); if (!itemGroups[key]) itemGroups[key] = { itemName: item.itemName, category: item.category, vendors: [] }; itemGroups[key].vendors.push(item); });

    const itemDemand = {};
    orderRecords.forEach(rec => { const key = rec.itemName.toLowerCase(); if (!itemDemand[key]) itemDemand[key] = { total: 0 }; itemDemand[key].total += rec.qty; });

    const results = [];
    Object.entries(itemGroups).forEach(([key, group]) => {
        if (group.vendors.length < 1) return;
        const demand = itemDemand[key];
        if (!demand || demand.total === 0) return;
        const weeklyAvg = Math.round(demand.total / 12);
        const monday = Math.round(weeklyAvg * 0.6);
        const thursday = Math.round(weeklyAvg * 0.4);
        const prices = group.vendors.map(v => v.price);
        const lowest = Math.min(...prices); const highest = Math.max(...prices); const med = getMedian(prices);
        const vendorsWithScores = group.vendors.map(v => {
            const sr = calculateCompetitivenessScore({ vendorId: v.vendorId, vendorName: v.vendorName, itemId: v.itemId, itemName: group.itemName, comparableGroup: group.itemName.toLowerCase().replace(/\s+/g, '_'), normalizedPrice: v.price, lowestPrice: lowest, medianPrice: med, highestPrice: highest, vendorItemNames: v.vendorItemNames || [] });
            return { vendorId: v.vendorId, vendorName: v.vendorName, price: v.price, capacity: null, inStock: v.inStock, reliabilityScore: sr.reliabilityScore, competitivenessScore: sr.finalScore, isNewVendor: false };
        });
        ['Monday', 'Thursday'].forEach(day => {
            const qty = day === 'Monday' ? monday : thursday;
            if (qty <= 0) return;
            results.push(allocateDemand({ itemName: group.itemName, comparableGroup: group.itemName.toLowerCase().replace(/\s+/g, '_'), totalDemand: qty, deliveryDay: day, vendors: vendorsWithScores }));
        });
    });
    return results;
}

export default function VendorExpectedAllocation() {
    const { vendorId, vendorName } = React.useContext(UserContext);
    const [allAllocations, setAllAllocations] = useState([]);
    const [loading, setLoading] = useState(true);

    const loadData = async () => {
        setLoading(true);
        try {
            const data = await loadAllocations();
            setAllAllocations(data);
        } catch (err) { console.error('[VendorAllocation] load failed', err); toast.error('Failed to load allocation data'); }
        setLoading(false);
    };
    useEffect(() => { loadData(); }, []);

    const vId = vendorId || '';
    const itemMap = {};
    allAllocations.forEach(a => {
        a.allocations.forEach(va => {
            if (va.vendorId === vId) {
                const key = a.comparableGroup;
                if (!itemMap[key]) { itemMap[key] = { itemName: a.itemName, comparableGroup: a.comparableGroup, days: [], totalDemand: 0, totalAllocated: 0 }; }
                itemMap[key].days.push({ day: a.deliveryDay, demand: a.totalDemand, allocated: va.allocatedQuantity, share: va.allocationShare, score: va.competitivenessScore, price: va.price, reason: va.allocationReason });
                itemMap[key].totalDemand += a.totalDemand;
                itemMap[key].totalAllocated += va.allocatedQuantity;
            }
        });
    });

    const items = Object.values(itemMap);
    const totalUnits = items.reduce((s, i) => s + i.totalAllocated, 0);
    const totalDemandAll = items.reduce((s, i) => s + i.totalDemand, 0);
    const avgShare = totalDemandAll > 0 ? Math.round((totalUnits / totalDemandAll) * 100) : 0;

    return (
        <div style={{ padding: 24, paddingBottom: 100 }}>
            {/* HEADER */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 16, marginBottom: 24 }}>
                <div>
                    <h1 style={{ margin: 0, fontSize: 24, fontWeight: 800, color: C.fg }}>📦 Expected Allocation</h1>
                    <p style={{ margin: '4px 0 0', color: C.muted, fontSize: 13 }}>
                        Your expected marketplace demand share based on competitiveness score, pricing, and reliability.
                    </p>
                </div>
                <button onClick={() => { loadData(); toast.info('Recalculating…'); }} disabled={loading} style={{
                    padding: '8px 16px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.1)',
                    background: 'rgba(255,255,255,0.04)', color: C.fg, fontSize: 13, cursor: 'pointer',
                    display: 'flex', alignItems: 'center', gap: 6,
                }}><FiRefreshCw size={14} className={loading ? 'spin' : ''} /> Refresh</button>
            </div>

            {/* LOADING */}
            {loading && (
                <div style={{ textAlign: 'center', padding: 60, color: C.muted, fontSize: 14 }}>
                    <FiRefreshCw size={24} className="spin" style={{ marginBottom: 12 }} /><br />Loading allocation data…
                </div>
            )}

            {!loading && (
                <>
                    {/* SUMMARY CARDS */}
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginBottom: 24 }}>
                        {[
                            { icon: <FiPackage size={16} />, value: totalUnits, label: 'Total Allocated Units', color: C.blue },
                            { icon: <FiPieChart size={16} />, value: `${avgShare}%`, label: 'Avg Demand Share', color: C.green },
                            { icon: <FiTrendingUp size={16} />, value: items.length, label: 'Items Allocated', color: C.purple },
                            { icon: <FiTrendingUp size={16} />, value: totalDemandAll, label: 'Total Marketplace Demand', color: C.amber },
                        ].map(k => (
                            <div key={k.label} style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 12, padding: '16px 18px' }}>
                                <div style={{ color: k.color, marginBottom: 6 }}>{k.icon}</div>
                                <div style={{ fontSize: 28, fontWeight: 800, color: k.color, lineHeight: 1 }}>{k.value}</div>
                                <div style={{ fontSize: 11, color: C.muted, marginTop: 6 }}>{k.label}</div>
                            </div>
                        ))}
                    </div>

                    {/* ITEM ALLOCATION CARDS */}
                    {items.length === 0 ? (
                        <div style={{ textAlign: 'center', padding: 40, color: C.muted, fontSize: 14 }}>
                            No allocations found for your items. This may update as demand and scores are recalculated.
                        </div>
                    ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                            {items.map((item, idx) => {
                                const overallShare = item.totalDemand > 0 ? Math.round((item.totalAllocated / item.totalDemand) * 100) : 0;
                                const shareColor = overallShare >= 40 ? C.green : overallShare >= 25 ? C.blue : C.amber;
                                return (
                                    <div key={idx} style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 12, overflow: 'hidden' }}>
                                        <div style={{ padding: '16px 20px', borderBottom: '1px solid rgba(255,255,255,0.06)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                            <div>
                                                <div style={{ fontSize: 15, fontWeight: 700, color: C.fg }}>{item.itemName}</div>
                                                <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>{item.comparableGroup}</div>
                                            </div>
                                            <div style={{ textAlign: 'right' }}>
                                                <div style={{ fontSize: 13, color: C.muted }}>Marketplace demand: <strong style={{ color: C.fg }}>{item.totalDemand} units</strong></div>
                                                <div style={{ fontSize: 13, color: C.muted, marginTop: 2 }}>Your share: <strong style={{ color: shareColor }}>{overallShare}%</strong></div>
                                                <div style={{ fontSize: 13, color: C.muted, marginTop: 2 }}>Expected allocation: <strong style={{ color: C.fg }}>{item.totalAllocated} units</strong></div>
                                            </div>
                                        </div>
                                        <div style={{ padding: '0 20px', marginTop: 12, marginBottom: 6 }}>
                                            <div style={{ height: 10, borderRadius: 5, background: 'rgba(255,255,255,0.06)', overflow: 'hidden' }}>
                                                <div style={{ height: '100%', width: `${overallShare}%`, background: shareColor, borderRadius: 5, transition: 'width 0.4s' }} />
                                            </div>
                                        </div>
                                        <div style={{ padding: '12px 20px 16px' }}>
                                            <div style={{ display: 'grid', gridTemplateColumns: `repeat(${item.days.length}, 1fr)`, gap: 12 }}>
                                                {item.days.map((d, di) => {
                                                    const sl = scoreLabel(d.score);
                                                    return (
                                                        <div key={di} style={{ padding: '12px 14px', background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)', borderRadius: 8 }}>
                                                            <div style={{ fontSize: 12, fontWeight: 700, color: C.blue, marginBottom: 6 }}>{d.day}</div>
                                                            {[['Day demand', d.demand, C.fg], ['Your allocation', `${d.allocated} units`, C.green], ['Your share', `${Math.round(d.share * 100)}%`, C.blue], ['Score', d.score, sl.color]].map(([l, v, c], i) => (
                                                                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
                                                                    <span style={{ color: C.muted }}>{l}</span>
                                                                    <span style={{ fontWeight: l === 'Score' ? 700 : 600, color: c }}>{v}</span>
                                                                </div>
                                                            ))}
                                                            {d.reason && d.reason !== 'Standard score-based allocation' && (
                                                                <div style={{ fontSize: 11, color: C.amber, marginTop: 6, fontStyle: 'italic' }}>⚠ {d.reason}</div>
                                                            )}
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}

                    {/* HOW TO INCREASE SHARE */}
                    <div style={{ marginTop: 24, padding: '18px 20px', background: 'rgba(167,139,250,0.04)', border: '1px solid rgba(167,139,250,0.15)', borderRadius: 12 }}>
                        <div style={{ fontSize: 13, fontWeight: 700, color: C.purple, marginBottom: 10 }}>💡 How to Increase Your Allocation Share</div>
                        {[
                            { icon: '💰', text: 'Lower your price — vendors with better pricing receive higher allocation' },
                            { icon: '🛡️', text: 'Improve reliability — confirm dispatches faster, reduce disputes and short shipments' },
                            { icon: '📦', text: 'Increase capacity — vendors who can fulfill more demand get larger shares' },
                            { icon: '🔗', text: 'Add companion items — bundle completeness improves your competitiveness score' },
                            { icon: '⚡', text: 'Respond faster — quick dispatch confirmations and issue responses boost your score' },
                        ].map((t, i) => (
                            <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 8 }}>
                                <span style={{ fontSize: 16, flexShrink: 0 }}>{t.icon}</span>
                                <span style={{ fontSize: 13, color: C.fg, lineHeight: 1.4 }}>{t.text}</span>
                            </div>
                        ))}
                    </div>

                    <div style={{ marginTop: 16, fontSize: 12, color: '#475569', fontStyle: 'italic', textAlign: 'center' }}>
                        Allocations are recalculated on price changes, dispatch confirmations, deliveries, and weekly schedules. No competitor identities are disclosed.
                    </div>
                </>
            )}
        </div>
    );
}
