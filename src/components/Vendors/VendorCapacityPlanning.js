/**
 * VendorCapacityPlanning.js
 *
 * Vendor-facing supply capacity management.
 * Shows upcoming marketplace demand, vendor's declared capacity,
 * supply opportunity, and allows planning capacity changes.
 *
 * Data sources:
 *   - vendors/{id}/items  → vendor catalog
 *   - marketplaceOrders   → demand computation + capacity estimation
 *   - supplyCapacityEngine.forecastSupplyHealth() → core algorithm
 *   - vendors/{id}/capacityPlan/{weekStart} → saved capacity
 */
import React, { useState, useEffect } from 'react';
import {
    FiRefreshCw, FiTrendingUp, FiPackage, FiEdit3, FiCheckCircle,
    FiCopy, FiXCircle, FiSave,
} from 'react-icons/fi';
import { toast } from 'react-toastify';
import { UserContext } from '../../contexts/UserContext';
import GuidanceText from '../ui/GuidanceText';
import { db } from '../../firebase';
import { collection, getDocs, doc, setDoc, getDoc, serverTimestamp } from 'firebase/firestore';
import { fetchOrderHistory } from '../Forecast/forecastHelpers';
import { forecastSupplyHealth, supplyHealthLabel } from './supplyCapacityEngine';

const C = { green: '#34d399', red: '#f87171', amber: '#fbbf24', blue: '#38bdf8', purple: '#a78bfa', cyan: '#22d3ee', muted: '#94a3b8', fg: '#f8fafc' };

function normalizeItemName(n) { return (n || '').trim().replace(/\s+/g, ' '); }

function getNextMonday() {
    const d = new Date();
    d.setDate(d.getDate() + ((1 + 7 - d.getDay()) % 7 || 7));
    return d.toISOString().slice(0, 10);
}

function getPreviousMonday() {
    const d = new Date();
    const dayOfWeek = d.getDay();
    const diff = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
    d.setDate(d.getDate() - diff);
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
    const [editingCapacity, setEditingCapacity] = useState({}); // { itemKey: { monday, thursday } }
    const [savingItems, setSavingItems] = useState(new Set());
    const [outOfStock, setOutOfStock] = useState(new Set()); // item keys temporarily OOS

    const weekStart = getNextMonday();

    const loadData = async () => {
        setLoading(true);
        try {
            const data = await loadCapacityForecasts();
            setAllForecasts(data);

            // Load saved capacity plan
            if (vendorId) {
                try {
                    const planDoc = await getDoc(doc(db, `vendors/${vendorId}/capacityPlan`, weekStart));
                    if (planDoc.exists()) {
                        const saved = planDoc.data();
                        if (saved.items) {
                            const edits = {};
                            const oos = new Set();
                            Object.entries(saved.items).forEach(([key, val]) => {
                                edits[key] = { monday: val.monday || 0, thursday: val.thursday || 0 };
                                if (val.outOfStock) oos.add(key);
                            });
                            setEditingCapacity(edits);
                            setOutOfStock(oos);
                        }
                    }
                } catch (_) {}
            }
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
            const itemKey = f.comparableGroup;
            return { ...f, myVendor: myV, healthLabel: hl, additionalDemand, itemKey };
        });

    const totalCapacity = myItems.reduce((s, i) => {
        const edited = editingCapacity[i.itemKey];
        if (edited) return s + (edited.monday || 0) + (edited.thursday || 0);
        return s + (i.myVendor?.weeklyCapacity || 0);
    }, 0);
    const totalMarketDemand = myItems.reduce((s, i) => s + i.weeklyForecastDemand, 0);
    const opportunities = myItems.filter(i => i.additionalDemand > 0).length;

    const handleCapacityChange = (itemKey, field, value) => {
        setEditingCapacity(prev => ({
            ...prev,
            [itemKey]: { ...(prev[itemKey] || {}), [field]: parseInt(value) || 0 },
        }));
    };

    const toggleOutOfStock = (itemKey) => {
        setOutOfStock(prev => {
            const next = new Set(prev);
            if (next.has(itemKey)) {
                next.delete(itemKey);
            } else {
                next.add(itemKey);
                setEditingCapacity(p => ({ ...p, [itemKey]: { monday: 0, thursday: 0 } }));
            }
            return next;
        });
    };

    const saveCapacityPlan = async () => {
        if (!vendorId) { toast.warn('Vendor not identified'); return; }
        setSavingItems(new Set(['all']));
        try {
            const items = {};
            myItems.forEach(item => {
                const edited = editingCapacity[item.itemKey];
                const isOOS = outOfStock.has(item.itemKey);
                items[item.itemKey] = {
                    itemName: item.itemName,
                    category: item.category,
                    monday: isOOS ? 0 : (edited?.monday ?? item.myVendor?.mondayCapacity ?? 0),
                    thursday: isOOS ? 0 : (edited?.thursday ?? item.myVendor?.thursdayCapacity ?? 0),
                    outOfStock: isOOS,
                };
            });

            await setDoc(doc(db, `vendors/${vendorId}/capacityPlan`, weekStart), {
                weekStart,
                vendorId,
                items,
                updatedAt: serverTimestamp(),
                createdAt: serverTimestamp(),
            }, { merge: true });
            toast.success('Capacity plan saved for next week!');
        } catch (err) {
            console.error('Error saving capacity plan:', err);
            toast.error('Failed to save capacity plan');
        } finally {
            setSavingItems(new Set());
        }
    };

    const copyLastWeek = async () => {
        if (!vendorId) return;
        try {
            const lastWeek = getPreviousMonday();
            const lastDoc = await getDoc(doc(db, `vendors/${vendorId}/capacityPlan`, lastWeek));
            if (lastDoc.exists() && lastDoc.data().items) {
                const saved = lastDoc.data().items;
                const edits = {};
                Object.entries(saved).forEach(([key, val]) => {
                    edits[key] = { monday: val.monday || 0, thursday: val.thursday || 0 };
                });
                setEditingCapacity(edits);
                toast.success('Copied last week\'s capacity');
            } else {
                toast.info('No saved capacity found for last week');
            }
        } catch (err) {
            console.error('Error loading last week:', err);
            toast.error('Failed to load last week');
        }
    };

    const resetToForecast = () => {
        const edits = {};
        myItems.forEach(item => {
            edits[item.itemKey] = {
                monday: item.myVendor?.mondayCapacity || 0,
                thursday: item.myVendor?.thursdayCapacity || 0,
            };
        });
        setEditingCapacity(edits);
        setOutOfStock(new Set());
        toast.success('Reset to forecast estimates');
    };

    const isSaving = savingItems.size > 0;

    return (
        <div style={{ padding: 24, paddingBottom: 100 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 16, marginBottom: 24 }}>
                <div>
                    <h1 style={{ margin: 0, fontSize: 24, fontWeight: 800, color: C.fg }}>🛡️ Capacity Planning</h1>
                    <p style={{ margin: '4px 0 0', color: C.muted, fontSize: 13 }}>
                        Plan your capacity for next week ({weekStart}). Edit quantities directly and save your plan.
                    </p>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                    <button onClick={() => { loadData(); toast.info('Recalculating…'); }} disabled={loading} style={{
                        padding: '8px 16px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.1)',
                        background: 'rgba(255,255,255,0.04)', color: C.fg, fontSize: 13, cursor: 'pointer',
                        display: 'flex', alignItems: 'center', gap: 6,
                    }}><FiRefreshCw size={14} className={loading ? 'spin' : ''} /> Refresh</button>
                </div>
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

                    {/* Capacity Guidance */}
                    {totalCapacity < totalMarketDemand && totalMarketDemand > 0 && (
                        <GuidanceText
                            text={`Capacity is ${Math.round((1 - totalCapacity / totalMarketDemand) * 100)}% below demand — increase supply to capture missed orders`}
                            type="warning"
                            style={{ marginBottom: 16 }}
                        />
                    )}
                    {opportunities > 0 && totalCapacity >= totalMarketDemand && (
                        <GuidanceText
                            text={`${opportunities} item${opportunities > 1 ? 's' : ''} with additional demand you could supply`}
                            type="info"
                            style={{ marginBottom: 16 }}
                        />
                    )}
                    {myItems.length === 0 && (
                        <GuidanceText
                            text="Add items to your catalog to receive supply allocation and capacity planning"
                            type="muted"
                            style={{ marginBottom: 16 }}
                        />
                    )}

                    {/* Action Bar */}
                    <div style={{ display: 'flex', gap: 10, marginBottom: 24, padding: '14px 18px', background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 10 }}>
                        <button onClick={saveCapacityPlan} disabled={isSaving} style={{
                            padding: '8px 20px', borderRadius: 8, border: 'none',
                            background: '#10b981', color: '#fff', fontSize: 13, fontWeight: 700,
                            cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6,
                            opacity: isSaving ? 0.6 : 1,
                        }}><FiSave size={14} /> {isSaving ? 'Saving…' : 'Save Capacity Plan'}</button>
                        <button onClick={copyLastWeek} style={{
                            padding: '8px 16px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.1)',
                            background: 'rgba(255,255,255,0.04)', color: C.fg, fontSize: 13, fontWeight: 600,
                            cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6,
                        }}><FiCopy size={13} /> Copy Last Week</button>
                        <button onClick={resetToForecast} style={{
                            padding: '8px 16px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.1)',
                            background: 'rgba(255,255,255,0.04)', color: C.muted, fontSize: 13, fontWeight: 600,
                            cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6,
                        }}><FiRefreshCw size={13} /> Reset to Forecast</button>
                    </div>

                    {myItems.length === 0 ? (
                        <div style={{ textAlign: 'center', padding: 40, color: C.muted }}>No capacity data found for your items.</div>
                    ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                            {myItems.map((item, idx) => {
                                const mv = item.myVendor;
                                const hl = item.healthLabel;
                                const itemKey = item.itemKey;
                                const edited = editingCapacity[itemKey];
                                const isOOS = outOfStock.has(itemKey);
                                const currentMon = isOOS ? 0 : (edited?.monday ?? mv.mondayCapacity);
                                const currentThu = isOOS ? 0 : (edited?.thursday ?? mv.thursdayCapacity);
                                const currentWeekly = currentMon + currentThu;
                                const capShare = item.weeklyCapacity > 0 ? Math.round((currentWeekly / item.weeklyCapacity) * 100) : 0;

                                return (
                                    <div key={idx} style={{ background: isOOS ? 'rgba(244,63,94,0.02)' : 'rgba(255,255,255,0.03)', border: `1px solid ${isOOS ? 'rgba(244,63,94,0.15)' : 'rgba(255,255,255,0.07)'}`, borderRadius: 12, overflow: 'hidden', transition: 'all 0.2s' }}>
                                        <div style={{ padding: '16px 20px', borderBottom: '1px solid rgba(255,255,255,0.06)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                            <div>
                                                <div style={{ fontSize: 15, fontWeight: 700, color: isOOS ? '#f87171' : C.fg, textDecoration: isOOS ? 'line-through' : 'none' }}>{item.itemName}</div>
                                                <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>{item.category} • {item.activeVendorCount} vendors</div>
                                            </div>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                                <button onClick={() => toggleOutOfStock(itemKey)} style={{
                                                    padding: '4px 10px', borderRadius: 6, fontSize: 11, fontWeight: 600,
                                                    border: `1px solid ${isOOS ? 'rgba(16,185,129,0.3)' : 'rgba(244,63,94,0.3)'}`,
                                                    background: isOOS ? 'rgba(16,185,129,0.08)' : 'rgba(244,63,94,0.08)',
                                                    color: isOOS ? '#10b981' : '#f87171',
                                                    cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4,
                                                }}>
                                                    {isOOS ? <><FiCheckCircle size={12} /> Back In Stock</> : <><FiXCircle size={12} /> Mark Out of Stock</>}
                                                </button>
                                                <span style={{ background: `${hl.color}22`, color: hl.color, padding: '4px 12px', borderRadius: 6, fontSize: 12, fontWeight: 700 }}>
                                                    {hl.icon} {hl.text}
                                                </span>
                                            </div>
                                        </div>
                                        <div style={{ padding: '16px 20px' }}>
                                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
                                                <div>
                                                    <div style={{ fontSize: 12, fontWeight: 700, color: C.blue, marginBottom: 8 }}>📊 Marketplace Demand</div>
                                                    {[['Next week demand', `${item.weeklyForecastDemand} units`, C.fg], ['Monday', `${item.mondayForecastDemand} units`, C.muted], ['Thursday', `${item.thursdayForecastDemand} units`, C.muted]].map(([l, v, c], i) => (
                                                        <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
                                                            <span style={{ color: C.muted }}>{l}</span><span style={{ fontWeight: 600, color: c }}>{v}</span>
                                                        </div>
                                                    ))}
                                                </div>
                                                <div>
                                                    <div style={{ fontSize: 12, fontWeight: 700, color: C.green, marginBottom: 8 }}>📦 Your Capacity {isOOS && <span style={{ color: '#f87171', fontSize: 11 }}>(OUT OF STOCK)</span>}</div>
                                                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 8, alignItems: 'center' }}>
                                                        <span style={{ color: C.muted }}>Monday</span>
                                                        <input type="number" min="0" disabled={isOOS} value={currentMon}
                                                            onChange={(e) => handleCapacityChange(itemKey, 'monday', e.target.value)}
                                                            style={{ width: 70, padding: '4px 8px', borderRadius: 6, border: '1px solid rgba(255,255,255,0.15)', background: isOOS ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.4)', color: isOOS ? '#475569' : C.green, textAlign: 'center', fontSize: 13, fontWeight: 700 }}
                                                        />
                                                    </div>
                                                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 8, alignItems: 'center' }}>
                                                        <span style={{ color: C.muted }}>Thursday</span>
                                                        <input type="number" min="0" disabled={isOOS} value={currentThu}
                                                            onChange={(e) => handleCapacityChange(itemKey, 'thursday', e.target.value)}
                                                            style={{ width: 70, padding: '4px 8px', borderRadius: 6, border: '1px solid rgba(255,255,255,0.15)', background: isOOS ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.4)', color: isOOS ? '#475569' : C.green, textAlign: 'center', fontSize: 13, fontWeight: 700 }}
                                                        />
                                                    </div>
                                                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                                                        <span style={{ color: C.muted }}>Weekly total</span><span style={{ fontWeight: 700, color: isOOS ? '#475569' : C.green }}>{currentWeekly} units</span>
                                                    </div>
                                                </div>
                                            </div>
                                            {item.additionalDemand > 0 && !isOOS && (
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
                                                    <div style={{ height: '100%', width: `${Math.min(capShare, 100)}%`, background: isOOS ? '#f87171' : C.green, borderRadius: 4, transition: 'width 0.3s' }} />
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}

                    <div style={{ marginTop: 24, fontSize: 12, color: '#475569', fontStyle: 'italic', textAlign: 'center' }}>
                        Demand forecasts are based on marketplace history and may change. Save your capacity plan weekly for best allocation.
                    </div>
                </>
            )}
        </div>
    );
}
