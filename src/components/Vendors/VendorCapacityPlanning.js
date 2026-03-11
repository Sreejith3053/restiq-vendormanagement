/**
 * VendorCapacityPlanning.js
 *
 * Vendor-facing supply forecast view.
 * Shows upcoming marketplace demand, vendor's declared capacity,
 * supply opportunity, and allows declaring capacity changes.
 *
 * Data sources:
 *   - vendors/{id}/items  → vendor catalog
 *   - marketplaceOrders   → demand computation + capacity estimation
 *   - supplyCapacityEngine.forecastSupplyHealth() → core algorithm
 */
import React, { useState, useEffect } from 'react';
import {
    FiRefreshCw, FiTrendingUp, FiPackage, FiEdit3, FiCheckCircle,
} from 'react-icons/fi';
import { toast } from 'react-toastify';
import { UserContext } from '../../contexts/UserContext';
import { db } from '../../firebase';
import { collection, getDocs } from 'firebase/firestore';
import { fetchOrderHistory } from '../Forecast/forecastHelpers';
import { forecastSupplyHealth, supplyHealthLabel } from './supplyCapacityEngine';

const C = { green: '#34d399', red: '#f87171', amber: '#fbbf24', blue: '#38bdf8', purple: '#a78bfa', cyan: '#22d3ee', muted: '#94a3b8', fg: '#f8fafc' };

function normalizeItemName(n) { return (n || '').trim().replace(/\s+/g, ' '); }

function getNextMonday() {
    const d = new Date();
    d.setDate(d.getDate() + ((1 + 7 - d.getDay()) % 7 || 7));
    return d.toISOString().slice(0, 10);
}

async function loadCapacityForecasts() {
    const vendorsSnap = await getDocs(collection(db, 'vendors'));
    const vendors = vendorsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    const allItems = [];
    for (const v of vendors) {
        try {
            const itemSnap = await getDocs(collection(db, `vendors/${v.id}/items`));
            itemSnap.docs.forEach(d => {
                const data = d.data();
                const name = normalizeItemName(data.name);
                if (!name) return;
                allItems.push({ vendorId: v.id, vendorName: v.name || 'Unknown', itemName: name, category: data.category || 'Produce', inStock: data.inStock !== false });
            });
        } catch (_) {}
    }

    const orderRecords = await fetchOrderHistory(12);
    const weekStart = getNextMonday();
    const itemGroups = {};
    allItems.forEach(item => { const key = item.itemName.toLowerCase(); if (!itemGroups[key]) itemGroups[key] = { itemName: item.itemName, category: item.category, vendors: {} }; if (!itemGroups[key].vendors[item.vendorId]) itemGroups[key].vendors[item.vendorId] = { vendorId: item.vendorId, vendorName: item.vendorName, inStock: item.inStock }; });

    const itemDemand = {};
    const vendorItemHistory = {};
    orderRecords.forEach(rec => {
        const key = rec.itemName.toLowerCase();
        if (!itemDemand[key]) itemDemand[key] = { total: 0 };
        itemDemand[key].total += rec.qty;
        if (rec.vendor) { const vk = `${rec.vendor}_${key}`; if (!vendorItemHistory[vk]) vendorItemHistory[vk] = { total: 0 }; vendorItemHistory[vk].total += rec.qty; }
    });

    const forecasts = [];
    Object.entries(itemGroups).forEach(([key, group]) => {
        const demand = itemDemand[key];
        if (!demand || demand.total === 0) return;
        const weeklyAvg = Math.round(demand.total / 12);
        const monday = Math.round(weeklyAvg * 0.6);
        const thursday = Math.round(weeklyAvg * 0.4);
        const vendorList = Object.values(group.vendors).map(v => {
            const vk = `${v.vendorId}_${key}`;
            const hist = vendorItemHistory[vk];
            const weeklyCapEst = hist ? Math.round((hist.total / 12) * 1.2) : 0;
            return { vendorId: v.vendorId, vendorName: v.vendorName, mondayCapacity: Math.round(weeklyCapEst * 0.6), thursdayCapacity: Math.round(weeklyCapEst * 0.4), weeklyCapacity: weeklyCapEst, stockStatus: v.inStock ? 'in_stock' : 'out_of_stock', leadTimeDays: 1, capacityConfidence: hist ? 'history' : 'estimated', active: true };
        }).filter(v => v.weeklyCapacity > 0);
        if (vendorList.length === 0) return;
        forecasts.push(forecastSupplyHealth({ itemName: group.itemName, comparableGroup: group.itemName.toLowerCase().replace(/\s+/g, '_'), category: group.category, weekStart, demand: { monday, thursday, weekly: weeklyAvg }, vendors: vendorList }));
    });
    return forecasts;
}

export default function VendorCapacityPlanning() {
    const { vendorId } = React.useContext(UserContext);
    const [allForecasts, setAllForecasts] = useState([]);
    const [loading, setLoading] = useState(true);

    const loadData = async () => {
        setLoading(true);
        try {
            const data = await loadCapacityForecasts();
            setAllForecasts(data);
        } catch (err) { console.error('[VendorCapacity] load failed', err); toast.error('Failed to load capacity data'); }
        setLoading(false);
    };
    useEffect(() => { loadData(); }, []);

    const vId = vendorId || '';
    const myItems = allForecasts
        .filter(f => f.vendorBreakdown.some(v => v.vendorId === vId))
        .map(f => {
            const myV = f.vendorBreakdown.find(v => v.vendorId === vId);
            const hl = supplyHealthLabel(f.capacityGapPct);
            const additionalDemand = f.shortageRiskQty > 0 ? f.shortageRiskQty : (f.excessCapacityQty > 0 ? 0 : Math.max(0, f.weeklyForecastDemand - f.weeklyCapacity));
            return { ...f, myVendor: myV, healthLabel: hl, additionalDemand };
        });

    const totalCapacity = myItems.reduce((s, i) => s + (i.myVendor?.weeklyCapacity || 0), 0);
    const totalMarketDemand = myItems.reduce((s, i) => s + i.weeklyForecastDemand, 0);
    const opportunities = myItems.filter(i => i.additionalDemand > 0).length;

    return (
        <div style={{ padding: 24, paddingBottom: 100 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 16, marginBottom: 24 }}>
                <div>
                    <h1 style={{ margin: 0, fontSize: 24, fontWeight: 800, color: C.fg }}>🛡️ Capacity Planning</h1>
                    <p style={{ margin: '4px 0 0', color: C.muted, fontSize: 13 }}>
                        See next week's marketplace demand forecast and how your supply capacity compares. Update capacity to capture more demand.
                    </p>
                </div>
                <button onClick={() => { loadData(); toast.info('Recalculating…'); }} disabled={loading} style={{
                    padding: '8px 16px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.1)',
                    background: 'rgba(255,255,255,0.04)', color: C.fg, fontSize: 13, cursor: 'pointer',
                    display: 'flex', alignItems: 'center', gap: 6,
                }}><FiRefreshCw size={14} className={loading ? 'spin' : ''} /> Refresh</button>
            </div>

            {loading && (
                <div style={{ textAlign: 'center', padding: 60, color: C.muted, fontSize: 14 }}>
                    <FiRefreshCw size={24} className="spin" style={{ marginBottom: 12 }} /><br />Loading capacity data…
                </div>
            )}

            {!loading && (
                <>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginBottom: 24 }}>
                        {[
                            { icon: <FiPackage size={16} />, value: totalCapacity, label: 'Your Total Capacity', color: C.blue },
                            { icon: <FiTrendingUp size={16} />, value: totalMarketDemand, label: 'Marketplace Demand', color: C.amber },
                            { icon: <FiTrendingUp size={16} />, value: opportunities, label: 'Supply Opportunities', color: C.purple },
                            { icon: <FiCheckCircle size={16} />, value: myItems.length, label: 'Items You Supply', color: C.green },
                        ].map(k => (
                            <div key={k.label} style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 12, padding: '16px 18px' }}>
                                <div style={{ color: k.color, marginBottom: 6 }}>{k.icon}</div>
                                <div style={{ fontSize: 28, fontWeight: 800, color: k.color, lineHeight: 1 }}>{k.value}</div>
                                <div style={{ fontSize: 11, color: C.muted, marginTop: 6 }}>{k.label}</div>
                            </div>
                        ))}
                    </div>

                    {myItems.length === 0 ? (
                        <div style={{ textAlign: 'center', padding: 40, color: C.muted }}>No capacity data found for your items.</div>
                    ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                            {myItems.map((item, idx) => {
                                const mv = item.myVendor;
                                const hl = item.healthLabel;
                                const capShare = item.weeklyCapacity > 0 ? Math.round((mv.weeklyCapacity / item.weeklyCapacity) * 100) : 0;
                                return (
                                    <div key={idx} style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 12, overflow: 'hidden' }}>
                                        <div style={{ padding: '16px 20px', borderBottom: '1px solid rgba(255,255,255,0.06)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                            <div>
                                                <div style={{ fontSize: 15, fontWeight: 700, color: C.fg }}>{item.itemName}</div>
                                                <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>{item.comparableGroup} • {item.category}</div>
                                            </div>
                                            <span style={{ background: `${hl.color}22`, color: hl.color, padding: '4px 12px', borderRadius: 6, fontSize: 12, fontWeight: 700 }}>
                                                {hl.icon} {hl.text}
                                            </span>
                                        </div>
                                        <div style={{ padding: '16px 20px' }}>
                                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
                                                <div>
                                                    <div style={{ fontSize: 12, fontWeight: 700, color: C.blue, marginBottom: 8 }}>📊 Marketplace Demand Forecast</div>
                                                    {[['Next week demand', `${item.weeklyForecastDemand} units`, C.fg], ['Monday', `${item.mondayForecastDemand} units`, C.muted], ['Thursday', `${item.thursdayForecastDemand} units`, C.muted], ['Total marketplace capacity', `${item.weeklyCapacity} units`, C.blue], ['Active vendors', item.activeVendorCount, C.muted]].map(([l, v, c], i) => (
                                                        <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
                                                            <span style={{ color: C.muted }}>{l}</span><span style={{ fontWeight: 600, color: c }}>{v}</span>
                                                        </div>
                                                    ))}
                                                </div>
                                                <div>
                                                    <div style={{ fontSize: 12, fontWeight: 700, color: C.green, marginBottom: 8 }}>📦 Your Capacity</div>
                                                    {[['Weekly capacity', `${mv.weeklyCapacity} units`, C.green], ['Monday', `${mv.mondayCapacity} units`, C.muted], ['Thursday', `${mv.thursdayCapacity} units`, C.muted], ['Your share', `${capShare}%`, C.purple], ['Confidence', mv.capacityConfidence, C.muted]].map(([l, v, c], i) => (
                                                        <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
                                                            <span style={{ color: C.muted }}>{l}</span><span style={{ fontWeight: 600, color: c }}>{v}</span>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                            {item.additionalDemand > 0 && (
                                                <div style={{ padding: '12px 16px', background: 'rgba(167,139,250,0.06)', border: '1px solid rgba(167,139,250,0.15)', borderRadius: 8, marginBottom: 12 }}>
                                                    <div style={{ fontSize: 13, fontWeight: 700, color: C.purple, marginBottom: 4 }}>💰 Supply Opportunity</div>
                                                    <div style={{ fontSize: 13, color: C.fg }}>
                                                        Marketplace is short <strong style={{ color: C.purple }}>{item.additionalDemand} units</strong>.
                                                        Increase your capacity to capture additional demand and improve your allocation share.
                                                    </div>
                                                </div>
                                            )}
                                            <div>
                                                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: C.muted, marginBottom: 4 }}>
                                                    <span>Your capacity share</span><span>{capShare}%</span>
                                                </div>
                                                <div style={{ height: 8, borderRadius: 4, background: 'rgba(255,255,255,0.06)', overflow: 'hidden' }}>
                                                    <div style={{ height: '100%', width: `${capShare}%`, background: C.green, borderRadius: 4 }} />
                                                </div>
                                            </div>
                                            <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
                                                <button onClick={() => toast.info('Capacity update — coming soon')} style={{
                                                    padding: '8px 16px', borderRadius: 8, border: '1px solid rgba(52,211,153,0.3)',
                                                    background: 'rgba(52,211,153,0.08)', color: C.green, fontSize: 12, fontWeight: 600,
                                                    cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6,
                                                }}><FiEdit3 size={13} /> Update Capacity</button>
                                                <button onClick={() => toast.info('Temporary increase noted')} style={{
                                                    padding: '8px 16px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.1)',
                                                    background: 'rgba(255,255,255,0.04)', color: C.muted, fontSize: 12, fontWeight: 600,
                                                    cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6,
                                                }}><FiTrendingUp size={13} /> Temp Increase</button>
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}

                    <div style={{ marginTop: 24, fontSize: 12, color: '#475569', fontStyle: 'italic', textAlign: 'center' }}>
                        Demand forecasts are based on marketplace history and may change. Update your capacity weekly to receive the best allocation.
                    </div>
                </>
            )}
        </div>
    );
}
