import React, { useState, useEffect, useMemo } from 'react';
import { fetchOrderHistory, getRestaurantList, buildRestaurantForecast } from './forecastHelpers';
import { db } from '../../firebase';
import { collection, getDocs } from 'firebase/firestore';

// ─── Constants ────────────────────────────────────────────────────────────────
const CATEGORIES = ['All', 'Produce', 'Packaging', 'Cleaning Supplies'];

const CAT_COLORS = {
    Produce: { bg: 'rgba(52,211,153,0.12)', color: '#34d399' },
    Packaging: { bg: 'rgba(56,189,248,0.12)', color: '#38bdf8' },
    'Cleaning Supplies': { bg: 'rgba(251,146,60,0.12)', color: '#fb923c' },
};
const CONF_COLORS = { High: '#34d399', Medium: '#fbbf24', Low: '#f87171' };

// ─── Component ────────────────────────────────────────────────────────────────
export default function DemandForecastPage() {
    const [rows, setRows] = useState([]);
    const [loading, setLoading] = useState(true);
    const [activeCategory, setActiveCategory] = useState('All');
    const [searchTerm, setSearchTerm] = useState('');
    const [sortCol, setSortCol] = useState('weeklyTotal');
    const [sortDir, setSortDir] = useState('desc');

    useEffect(() => {
        async function loadData() {
            setLoading(true);
            try {
                const records = await fetchOrderHistory(12);
                const restaurants = getRestaurantList(records);

                // Load vendor catalog for pack info
                const vendorCatalog = {};
                const vendorsSnap = await getDocs(collection(db, 'vendors'));
                for (const vDoc of vendorsSnap.docs) {
                    const vendorName = vDoc.data().name || 'Unknown';
                    try {
                        const itemSnap = await getDocs(collection(db, `vendors/${vDoc.id}/items`));
                        itemSnap.docs.forEach(d => {
                            const data = d.data();
                            const name = (data.name || '').trim();
                            if (!name) return;
                            if (!vendorCatalog[name.toLowerCase()]) {
                                vendorCatalog[name.toLowerCase()] = {
                                    vendorName,
                                    packSize: parseFloat(data.packSize) || 1,
                                    packLabel: data.packLabel || data.unit || 'unit',
                                    category: data.category || 'Produce',
                                };
                            }
                        });
                    } catch (_) {}
                }

                // Aggregate forecasts across all restaurants
                const itemMap = {};
                for (const rest of restaurants) {
                    const forecast = buildRestaurantForecast(records, rest);
                    forecast.forEach(item => {
                        const key = item.itemName.toLowerCase();
                        if (!itemMap[key]) {
                            const cat = vendorCatalog[key];
                            itemMap[key] = {
                                itemName: item.itemName,
                                category: cat?.category || item.category || 'Produce',
                                mondayForecast: 0,
                                thursdayForecast: 0,
                                weeklyTotal: 0,
                                confidence: item.confidence || 'Medium',
                                vendorPackLogic: cat ? `${cat.packSize} / ${cat.packLabel}` : '—',
                                estimatedVendorPacks: 0,
                                vendorName: cat?.vendorName || '—',
                                packSize: cat?.packSize || 1,
                            };
                        }
                        itemMap[key].mondayForecast += item.mondayQty || 0;
                        itemMap[key].thursdayForecast += item.thursdayQty || 0;
                        itemMap[key].weeklyTotal += (item.mondayQty || 0) + (item.thursdayQty || 0);
                        // Take highest confidence
                        if (item.confidence === 'High') itemMap[key].confidence = 'High';
                        else if (item.confidence === 'Medium' && itemMap[key].confidence === 'Low') itemMap[key].confidence = 'Medium';
                    });
                }

                // Calculate packs
                const result = Object.values(itemMap)
                    .filter(r => r.weeklyTotal > 0)
                    .map(r => ({
                        ...r,
                        estimatedVendorPacks: r.packSize > 1 ? Math.ceil(r.weeklyTotal / r.packSize) : r.weeklyTotal
                    }))
                    .sort((a, b) => b.weeklyTotal - a.weeklyTotal);

                setRows(result);
            } catch (err) {
                console.error('DemandForecastPage load error:', err);
            }
            setLoading(false);
        }
        loadData();
    }, []);

    const handleSort = (col) => {
        if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
        else { setSortCol(col); setSortDir('desc'); }
    };

    const filtered = useMemo(() => {
        return rows
            .filter(r => activeCategory === 'All' || r.category === activeCategory)
            .filter(r => !searchTerm || r.itemName.toLowerCase().includes(searchTerm.toLowerCase()))
            .sort((a, b) => {
                const dir = sortDir === 'asc' ? 1 : -1;
                const va = a[sortCol] ?? 0;
                const vb = b[sortCol] ?? 0;
                return typeof va === 'string' ? va.localeCompare(vb) * dir : (va - vb) * dir;
            });
    }, [rows, activeCategory, searchTerm, sortCol, sortDir]);

    const totals = useMemo(() => filtered.reduce((acc, r) => ({
        mon: acc.mon + r.mondayForecast,
        thu: acc.thu + r.thursdayForecast,
        total: acc.total + r.weeklyTotal,
        packs: acc.packs + r.estimatedVendorPacks
    }), { mon: 0, thu: 0, total: 0, packs: 0 }), [filtered]);

    const SortIcon = ({ col }) => (
        <span style={{ marginLeft: 4, opacity: sortCol === col ? 1 : 0.3, fontSize: 10 }}>
            {sortCol === col ? (sortDir === 'asc' ? '▲' : '▼') : '⇅'}
        </span>
    );

    return (
        <div style={{ padding: '24px 32px', maxWidth: 1500, margin: '0 auto', color: '#f8fafc', paddingBottom: 80 }}>
            {/* Header */}
            <div style={{ marginBottom: 28 }}>
                <h1 style={{ fontSize: 26, fontWeight: 700, margin: '0 0 6px 0', background: 'linear-gradient(90deg,#f8fafc,#94a3b8)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
                    Demand Forecast
                </h1>
                <p style={{ color: '#94a3b8', fontSize: 14, margin: 0 }}>
                    Unified weekly demand forecast from live Firestore order history across all product categories.
                </p>
            </div>

            {/* KPI Strip */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 24 }}>
                {[
                    { label: 'Total Items', value: filtered.length, icon: '📦', color: '#38bdf8' },
                    { label: 'Monday Total', value: `${totals.mon} units`, icon: '📅', color: '#4dabf7' },
                    { label: 'Thursday Total', value: `${totals.thu} units`, icon: '📅', color: '#845ef7' },
                    { label: 'Est. Vendor Packs', value: totals.packs, icon: '🏭', color: '#34d399' },
                ].map(k => (
                    <div key={k.label} style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, padding: 20 }}>
                        <div style={{ fontSize: 22 }}>{k.icon}</div>
                        <div style={{ fontSize: 22, fontWeight: 700, color: k.color, margin: '6px 0 2px' }}>{k.value}</div>
                        <div style={{ fontSize: 12, color: '#94a3b8' }}>{k.label}</div>
                    </div>
                ))}
            </div>

            {/* Filters */}
            <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 20, flexWrap: 'wrap' }}>
                <input
                    placeholder="Search item..."
                    value={searchTerm}
                    onChange={e => setSearchTerm(e.target.value)}
                    style={{ padding: '8px 14px', borderRadius: 8, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: '#f8fafc', outline: 'none', fontSize: 13, width: 220 }}
                />
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {CATEGORIES.map(cat => {
                        const cs = CAT_COLORS[cat];
                        const active = activeCategory === cat;
                        return (
                            <button key={cat} onClick={() => setActiveCategory(cat)} style={{
                                padding: '6px 14px', borderRadius: 20, fontSize: 12, fontWeight: 600, cursor: 'pointer', transition: 'all 0.2s',
                                background: active ? (cs?.bg || 'rgba(255,255,255,0.15)') : 'rgba(255,255,255,0.04)',
                                color: active ? (cs?.color || '#f8fafc') : '#94a3b8',
                                border: `1px solid ${active ? (cs?.color || '#f8fafc') : 'rgba(255,255,255,0.08)'}`,
                            }}>
                                {cat}
                            </button>
                        );
                    })}
                </div>
            </div>

            {/* Table */}
            <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 12, overflow: 'hidden' }}>
                {loading ? (
                    <div style={{ padding: 48, textAlign: 'center', color: '#94a3b8', fontSize: 15 }}>
                        ⏳ Building unified demand forecast from Firestore...
                    </div>
                ) : filtered.length === 0 ? (
                    <div style={{ padding: 48, textAlign: 'center', color: '#94a3b8' }}>No items match your filters.</div>
                ) : (
                    <div style={{ overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                            <thead>
                                <tr style={{ background: 'rgba(255,255,255,0.04)', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                                    {[
                                        { key: 'itemName', label: 'Item' },
                                        { key: 'category', label: 'Category' },
                                        { key: 'mondayForecast', label: 'Mon Forecast' },
                                        { key: 'thursdayForecast', label: 'Thu Forecast' },
                                        { key: 'weeklyTotal', label: 'Weekly Total' },
                                        { key: 'confidence', label: 'Confidence' },
                                        { key: 'vendorPackLogic', label: 'Vendor Pack' },
                                        { key: 'estimatedVendorPacks', label: 'Est. Packs Needed' },
                                        { key: 'vendorName', label: 'Vendor' },
                                    ].map(col => (
                                        <th key={col.key} onClick={() => handleSort(col.key)}
                                            style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 600, color: '#94a3b8', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5, cursor: 'pointer', whiteSpace: 'nowrap', userSelect: 'none' }}>
                                            {col.label}<SortIcon col={col.key} />
                                        </th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {filtered.map((row, i) => {
                                    const catStyle = CAT_COLORS[row.category] || { bg: 'rgba(255,255,255,0.06)', color: '#94a3b8' };
                                    const confColor = CONF_COLORS[row.confidence] || '#94a3b8';
                                    return (
                                        <tr key={i} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)', transition: 'background 0.15s' }}
                                            onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.03)'}
                                            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                                            <td style={{ padding: '11px 16px', fontWeight: 600, color: '#f8fafc' }}>{row.itemName}</td>
                                            <td style={{ padding: '11px 16px' }}>
                                                <span style={{ background: catStyle.bg, color: catStyle.color, padding: '3px 10px', borderRadius: 12, fontSize: 11, fontWeight: 600 }}>
                                                    {row.category}
                                                </span>
                                            </td>
                                            <td style={{ padding: '11px 16px', color: '#4dabf7', fontWeight: 600 }}>{row.mondayForecast}</td>
                                            <td style={{ padding: '11px 16px', color: '#845ef7', fontWeight: 600 }}>{row.thursdayForecast}</td>
                                            <td style={{ padding: '11px 16px', color: '#f8fafc', fontWeight: 700, fontSize: 15 }}>{row.weeklyTotal}</td>
                                            <td style={{ padding: '11px 16px' }}>
                                                <span style={{ color: confColor, fontWeight: 700, fontSize: 12 }}>● {row.confidence}</span>
                                            </td>
                                            <td style={{ padding: '11px 16px', color: '#94a3b8', fontSize: 12 }}>{row.vendorPackLogic || '—'}</td>
                                            <td style={{ padding: '11px 16px', color: '#10b981', fontWeight: 700 }}>{row.estimatedVendorPacks}</td>
                                            <td style={{ padding: '11px 16px', color: '#94a3b8', fontSize: 12 }}>{row.vendorName}</td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                            <tfoot>
                                <tr style={{ background: 'rgba(255,255,255,0.04)', borderTop: '1px solid rgba(255,255,255,0.1)', fontWeight: 700 }}>
                                    <td colSpan={2} style={{ padding: '12px 16px', color: '#94a3b8' }}>TOTAL ({filtered.length} items)</td>
                                    <td style={{ padding: '12px 16px', color: '#4dabf7' }}>{totals.mon}</td>
                                    <td style={{ padding: '12px 16px', color: '#845ef7' }}>{totals.thu}</td>
                                    <td style={{ padding: '12px 16px', color: '#f8fafc', fontSize: 15 }}>{totals.total}</td>
                                    <td colSpan={2} />
                                    <td style={{ padding: '12px 16px', color: '#10b981' }}>{totals.packs}</td>
                                    <td />
                                </tr>
                            </tfoot>
                        </table>
                    </div>
                )}
            </div>
        </div>
    );
}
