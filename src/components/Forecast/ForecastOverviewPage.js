import React, { useState, useEffect } from 'react';
import { TrendBadge, ForecastSummaryCard } from './ForecastComponents';
import vendorCatalogV2 from '../../data/catalog_v2.json';
import purchaseDatasetV2 from '../../data/history_realistic_v2_tomato.json';
import containerTestData from './containerTestData.json';
import {
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer
} from 'recharts';

const V2_BASELINE_OVERRIDES = {
    'Onion - Cooking': { min: 40 },
    'Onion - Red': { min: 3 },
    'Cabbage': { min: 2 },
    'Carrot': { min: 4 },
    'French Beans': { min: 0 },
    'Potatoes': { min: 10 }
};

const V2_OCCASIONAL_EXCLUSIONS = ['Peeled Garlic'];

export default function ForecastOverviewPage() {
    const [loading, setLoading] = useState(true);
    const [stats, setStats] = useState({
        totalMon: 0, totalThu: 0, totalWeekly: 0, activeEvents: 1, totalItems: 0
    });
    const [chartData, setChartData] = useState([]);

    const getMedian = (arr) => {
        if (!arr || arr.length === 0) return 0;
        const sorted = [...arr].sort((a, b) => a - b);
        const mid = Math.floor(sorted.length / 2);
        if (sorted.length % 2 === 0) return (sorted[mid - 1] + sorted[mid]) / 2;
        return sorted[mid];
    };

    const fetchOverview = () => {
        setLoading(true);
        setTimeout(() => {
            const catalogLookup = {};
            vendorCatalogV2.forEach(row => {
                const name = row.item_name?.trim();
                const vendor = row.vendor?.trim() || 'ON Thyme';
                if (name && vendor.toLowerCase().includes('thyme')) {
                    catalogLookup[name] = {
                        category: row.category || 'Other'
                    };
                }
            });

            // Map packaging items into the lookup table
            containerTestData.forEach(row => {
                if (row.itemName && !catalogLookup[row.itemName]) {
                    catalogLookup[row.itemName] = {
                        category: row.category || 'Packaging',
                        isPackaging: true
                    }
                }
            });

            const historyMap = {};
            const globalDatesSet = new Set();

            purchaseDatasetV2.forEach(data => {
                if (!data.purchase_date || !data.item_name) return;
                const exactName = data.item_name.trim().toLowerCase()
                    .replace(/\b\w/g, c => c.toUpperCase());

                globalDatesSet.add(data.purchase_date);

                if (!historyMap[exactName]) {
                    historyMap[exactName] = { itemName: exactName, orderHistoryMap: {} };
                }

                const qty = Number(data.normalized_quantity) || 0;
                if (!historyMap[exactName].orderHistoryMap[data.purchase_date]) {
                    historyMap[exactName].orderHistoryMap[data.purchase_date] = 0;
                }
                historyMap[exactName].orderHistoryMap[data.purchase_date] += qty;
            });

            // Ingest Packaging Container Dataset
            containerTestData.forEach(data => {
                if (!data.date || !data.itemName) return;
                const exactName = data.itemName.trim().toLowerCase()
                    .replace(/\b\w/g, c => c.toUpperCase());

                globalDatesSet.add(data.date);

                if (!historyMap[exactName]) {
                    historyMap[exactName] = { itemName: exactName, orderHistoryMap: {}, isPackaging: true };
                }

                const qty = Number(data.boxesOrdered) || 0;
                if (!historyMap[exactName].orderHistoryMap[data.date]) {
                    historyMap[exactName].orderHistoryMap[data.date] = 0;
                }
                historyMap[exactName].orderHistoryMap[data.date] += qty;
            });

            const allCycles = [...globalDatesSet].sort((a, b) => new Date(b).getTime() - new Date(a).getTime());
            const last8Cycles = allCycles.slice(0, 8);
            const last4Cycles = allCycles.slice(0, 4);

            let tMon = 0, tThu = 0, tWeek = 0, tItems = 0;
            const catMap = {};

            Object.values(historyMap).forEach(item => {
                const qtyIn8Filtered = last8Cycles.filter(date => (item.orderHistoryMap[date] || 0) > 0);
                const qtyIn8 = last8Cycles.map(date => item.orderHistoryMap[date] || 0);
                const qtyIn4 = last4Cycles.map(date => item.orderHistoryMap[date] || 0);

                const median8 = getMedian(qtyIn8);
                const median4 = getMedian(qtyIn4);

                let forecastQty = (0.3 * median4) + (0.7 * median8);
                let predictedTotal = Math.ceil(forecastQty);

                const override = V2_BASELINE_OVERRIDES[item.itemName];
                let isCoreItem = !!override || item.isPackaging;

                if (override) {
                    predictedTotal = override.min;
                } else {
                    const cap = Math.ceil(median8 * 1.5) || 1;
                    if (predictedTotal > cap) predictedTotal = cap;

                    if (item.itemName === 'Tomato' && predictedTotal < 1 && qtyIn8Filtered.length > 0) {
                        predictedTotal = Math.ceil(getMedian(qtyIn8Filtered));
                    }
                }

                if (!isCoreItem && !V2_OCCASIONAL_EXCLUSIONS.includes(item.itemName)) {
                    if ((qtyIn8Filtered.length >= 6 || item.itemName === 'Tomato') && predictedTotal > 0) {
                        isCoreItem = true;
                    }
                }

                // Make sure to fetch correct casing of item name from catalog to match UI
                let displayItemName = item.itemName;
                const matchName = Object.keys(catalogLookup).find(k => k.toLowerCase() === item.itemName.toLowerCase());
                if (matchName) displayItemName = matchName;

                if (isCoreItem && predictedTotal > 0 && catalogLookup[displayItemName]) {
                    let mondayQty = Math.round(predictedTotal * 0.6);
                    let thursdayQty = predictedTotal - mondayQty;

                    if (item.isPackaging) {
                        mondayQty = Math.round(predictedTotal * 0.5);
                        thursdayQty = predictedTotal - mondayQty;
                    }

                    tItems++;
                    tMon += mondayQty;
                    tThu += thursdayQty;
                    tWeek += predictedTotal;

                    const cat = catalogLookup[displayItemName].category || 'Other';
                    if (!catMap[cat]) catMap[cat] = { name: cat, Monday: 0, Thursday: 0 };
                    catMap[cat].Monday += mondayQty;
                    catMap[cat].Thursday += thursdayQty;
                }
            });

            setStats({
                totalMon: tMon,
                totalThu: tThu,
                totalWeekly: tWeek,
                totalItems: tItems,
                activeEvents: 0
            });

            setChartData(Object.values(catMap).sort((a, b) => (b.Monday + b.Thursday) - (a.Monday + a.Thursday)).slice(0, 10));
            setLoading(false);
        }, 300);
    };

    useEffect(() => {
        fetchOverview();
    }, []);

    if (loading) return <div className="page-padding loader-text">Generating Forecast Engine Data...</div>;

    return (
        <div className="forecast-dashboard fade-in">
            <div className="flex-between" style={{ marginBottom: 24 }}>
                <div>
                    <h2>AI Delivery Forecast Overview</h2>
                    <p className="text-muted">Predicting next week's demand and logistics load based on deterministic limits.</p>
                </div>
                <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
                    <button className="ui-btn secondary" onClick={fetchOverview} disabled={loading}>
                        <span className="link-icon">↻</span> Refresh Data
                    </button>
                    <button className="ui-btn primary" disabled={loading}>
                        <span className="link-icon">✅</span> Engine Synced
                    </button>
                </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 20, marginBottom: 24 }}>
                <ForecastSummaryCard title="Monday Delivery Total" value={`${stats.totalMon.toLocaleString()} units`} subtitle="Across all regions" icon="📦" color="#4dabf7" />
                <ForecastSummaryCard title="Thursday Delivery Total" value={`${stats.totalThu.toLocaleString()} units`} subtitle="Weekend prep load" icon="🚚" color="#845ef7" />
                <ForecastSummaryCard title="Total Weekly Volume" value={`${stats.totalWeekly.toLocaleString()} units`} subtitle={`Forecasted for ${stats.totalItems} items`} icon="📈" color="#4ade80" />
                <ForecastSummaryCard title="Active Events/Festivals" value={stats.activeEvents} subtitle="Impacting next week's demand" icon="🎉" color="#ff6b7a" />
            </div>

            <div className="ui-card" style={{ padding: 24, paddingBottom: 40 }}>
                <h3 style={{ marginTop: 0, marginBottom: 20 }}>Forecasted Category Demand Split</h3>
                <div style={{ height: 400, width: '100%' }}>
                    <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={chartData} margin={{ top: 10, right: 30, left: 0, bottom: 20 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                            <XAxis dataKey="name" stroke="var(--text-secondary)" tick={{ fill: 'var(--text-secondary)' }} angle={-45} textAnchor="end" height={60} />
                            <YAxis stroke="var(--text-secondary)" tick={{ fill: 'var(--text-secondary)' }} />
                            <Tooltip contentStyle={{ backgroundColor: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text-primary)' }} />
                            <Legend verticalAlign="top" height={36} />
                            <Bar dataKey="Monday" stackId="a" fill="#4dabf7" radius={[0, 0, 4, 4]} />
                            <Bar dataKey="Thursday" stackId="a" fill="#845ef7" radius={[4, 4, 0, 0]} />
                        </BarChart>
                    </ResponsiveContainer>
                </div>
            </div>
        </div>
    );
}
