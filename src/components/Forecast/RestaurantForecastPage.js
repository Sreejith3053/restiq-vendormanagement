import React, { useState, useEffect } from 'react';
import vendorCatalogV2 from '../../data/catalog_v2.json';
import purchaseDatasetV2 from '../../data/history_realistic_v2_tomato.json';
import containerTestData from './containerTestData.json';
// Reuse the same local UI components for styling
const TrendBadge = ({ trend }) => {
    let color = '#f59e0b';
    let text = 'Stable';
    if (trend === 'up') { color = '#10b981'; text = 'Increasing'; }
    if (trend === 'down') { color = '#3b82f6'; text = 'Decreasing'; }
    return <span style={{ background: `${color}20`, color, padding: '4px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600 }}>{text}</span>;
};

const ConfidenceBadge = ({ confidence }) => {
    let color = '#10b981';
    if (confidence === 'Medium') color = '#f59e0b';
    if (confidence === 'Low') color = '#f43f5e';
    return <span style={{ color, fontSize: 12, fontWeight: 600 }}>{confidence}</span>;
};

export default function RestaurantForecastPage() {
    const [forecasts, setForecasts] = useState([]);
    const [loading, setLoading] = useState(true);
    const [restaurants, setRestaurants] = useState([]);
    const [selectedRestId, setSelectedRestId] = useState('');

    const ITEM_ALIAS_MAP = {
        'white onion': 'Onion - Cooking',
        'red onion': 'Onion - Red',
        'spring onion': 'Green Onion',
        'garlic': 'Peeled Garlic',
        'green plantain': 'Plantain Green',
        'Coriander': 'Coriander Leaves',
        'Mint': 'Mint Leaves',
        'Onion Cooking': 'Onion - Cooking',
        'Onion Cooking 50lbs': 'Onion - Cooking',
        'Onion - Red': 'Onion - Red',
        'Onion Red 25lbs': 'Onion - Red',
        'Carrot 50lbs': 'Carrot'
    };

    const V2_BASELINE_OVERRIDES = {
        'Onion - Cooking': { min: 10, speed: 'Fast' },
        'Onion - Red': { min: 5, speed: 'Fast' },
        'Cabbage': { min: 3, speed: 'Fast' },
        'Carrot': { min: 3, speed: 'Fast' },
        'French Beans': { min: 3, speed: 'Fast' },
        'Mint Leaves': { min: 3, speed: 'Medium' },
        'Coriander Leaves': { min: 3, speed: 'Medium' },
        'Lemon': { min: 2, speed: 'Medium' },
        'Okra': { min: 2, speed: 'Medium' }
    };

    function normalizeItemName(name) {
        if (!name) return '';
        const n = name.trim().toLowerCase();
        const mappedKey = Object.keys(ITEM_ALIAS_MAP).find(k => k.toLowerCase() === n);
        return mappedKey ? ITEM_ALIAS_MAP[mappedKey] : name.trim();
    }

    function getMedian(arr) {
        if (arr.length === 0) return 0;
        const sorted = [...arr].sort((a, b) => a - b);
        const mid = Math.floor(sorted.length / 2);
        if (sorted.length % 2 === 0) return (sorted[mid - 1] + sorted[mid]) / 2;
        return sorted[mid];
    }

    useEffect(() => {
        // Find all unique restaurants in the raw dataset
        const uniqueRests = new Set();
        purchaseDatasetV2.forEach(d => {
            if (d.restaurant) uniqueRests.add(d.restaurant);
        });
        const rList = Array.from(uniqueRests);
        setRestaurants(rList);
        if (rList.length > 0 && !selectedRestId) {
            setSelectedRestId(rList[0]);
        }
    }, [selectedRestId]);

    useEffect(() => {
        if (!selectedRestId) return;
        setLoading(true);

        setTimeout(() => {
            const catalogLookup = {};
            vendorCatalogV2.forEach(row => {
                const name = row.item_name?.trim();
                if (name) catalogLookup[name] = row;
            });

            // Map packaging items into the lookup implicitly
            containerTestData.forEach(row => {
                if (row.itemName && !catalogLookup[row.itemName]) {
                    catalogLookup[row.itemName] = {
                        category: row.category || 'Packaging',
                        isPackaging: true
                    }
                }
            });

            // 1. Calculate Global Forecast exactly like Dashboard
            const globalDatesSet = new Set();
            purchaseDatasetV2.forEach(d => {
                if (d.purchase_date) globalDatesSet.add(d.purchase_date);
            });
            containerTestData.forEach(d => {
                if (d.date) globalDatesSet.add(d.date);
            });

            const allCycles = [...globalDatesSet].sort((a, b) => new Date(b).getTime() - new Date(a).getTime());
            const last8Cycles = allCycles.slice(0, 8);
            const last4Cycles = allCycles.slice(0, 4);

            const globalHistoryMap = {};
            const restHistoryMap = {}; // Tracks percentage split per restraint

            purchaseDatasetV2.forEach(data => {
                if (!data.purchase_date || !data.item_name) return;
                const exactName = normalizeItemName(data.item_name);

                // Track Global
                if (!globalHistoryMap[exactName]) {
                    globalHistoryMap[exactName] = { orderHistoryMap: {}, appearanceCount: 0, totalVolume8Wks: 0 };
                }
                const qty = Number(data.normalized_quantity) || 0;
                if (!globalHistoryMap[exactName].orderHistoryMap[data.purchase_date]) {
                    globalHistoryMap[exactName].orderHistoryMap[data.purchase_date] = 0;
                }
                globalHistoryMap[exactName].orderHistoryMap[data.purchase_date] += qty;

                // Track Restaurant Specific Volume for Ratio Splitting
                if (last8Cycles.includes(data.purchase_date)) {
                    globalHistoryMap[exactName].totalVolume8Wks += qty;

                    if (!restHistoryMap[exactName]) restHistoryMap[exactName] = {};
                    if (!restHistoryMap[exactName][data.restaurant]) restHistoryMap[exactName][data.restaurant] = 0;
                    restHistoryMap[exactName][data.restaurant] += qty;
                }
            });

            // Ingest Packaging Container Dataset
            containerTestData.forEach(data => {
                if (!data.date || !data.itemName) return;
                const exactName = normalizeItemName(data.itemName);

                if (!globalHistoryMap[exactName]) {
                    globalHistoryMap[exactName] = { orderHistoryMap: {}, appearanceCount: 0, totalVolume8Wks: 0, isPackaging: true };
                }

                const qty = Number(data.boxesOrdered) || 0;
                if (!globalHistoryMap[exactName].orderHistoryMap[data.date]) {
                    globalHistoryMap[exactName].orderHistoryMap[data.date] = 0;
                }
                globalHistoryMap[exactName].orderHistoryMap[data.date] += qty;

                if (last8Cycles.includes(data.date)) {
                    globalHistoryMap[exactName].totalVolume8Wks += qty;
                }
            });

            const locationPurchaseResults = [];

            Object.keys(globalHistoryMap).forEach(itemName => {
                const item = globalHistoryMap[itemName];
                const qtyIn8Filtered = last8Cycles.map(date => item.orderHistoryMap[date] || 0).filter(q => q > 0);
                const qtyIn8 = last8Cycles.map(date => item.orderHistoryMap[date] || 0);
                const qtyIn4 = last4Cycles.map(date => item.orderHistoryMap[date] || 0);

                const median8 = getMedian(qtyIn8);
                const median4 = getMedian(qtyIn4);

                let forecastQty = (0.3 * median4) + (0.7 * median8);
                let predictedTotal = Math.ceil(forecastQty);

                const override = V2_BASELINE_OVERRIDES[itemName];
                const cat = catalogLookup[itemName]?.category || (item.isPackaging ? 'Packaging' : '');

                // Exclude central-stock-only explicitly
                if (catalogLookup[itemName]?.central_stock_only === true || catalogLookup[itemName]?.is_central_stock === true) {
                    return; // Skip this item entirely
                }

                let isCoreItem = !!override || item.isPackaging || ['Packaging', 'Cleaning', 'Cleaning Supplies'].includes(cat);

                if (override) {
                    predictedTotal = override.min;
                } else {
                    const cap = Math.ceil(median8 * 1.5) || 1;
                    if (predictedTotal > cap) predictedTotal = cap;
                    if (itemName === 'Tomato' && predictedTotal < 1 && qtyIn8Filtered.length > 0) {
                        predictedTotal = Math.ceil(getMedian(qtyIn8Filtered));
                    }
                }

                if (!isCoreItem && !['Capsicum Green', 'Beets', 'Ash Guard', 'Pepper Mix', 'Cauliflower'].includes(itemName)) {
                    if ((qtyIn8Filtered.length >= 6 || itemName === 'Tomato') && predictedTotal > 0) {
                        isCoreItem = true;
                    }
                }

                if (isCoreItem && predictedTotal > 0) {
                    // 2. Proportionally Allocate to Selected Restaurant
                    let restRatio = 1.0;
                    if (item.totalVolume8Wks > 0 && restHistoryMap[itemName] && restHistoryMap[itemName][selectedRestId]) {
                        restRatio = restHistoryMap[itemName][selectedRestId] / item.totalVolume8Wks;
                    } else if (item.totalVolume8Wks > 0 && restHistoryMap[itemName]) {
                        restRatio = 0.0; // This location famously ordered zero of this item historically
                    } else if (item.totalVolume8Wks > 0 || predictedTotal > 0) {
                        // Has volume, but no branch data map exists (e.g. from containerTestData)
                        restRatio = 1.0 / (restaurants.length || 1);
                    }

                    let restAllocatedTotal = Math.round(predictedTotal * restRatio);

                    if (restAllocatedTotal > 0) {
                        let mondayQty = Math.round(restAllocatedTotal * 0.6);
                        let thursdayQty = restAllocatedTotal - mondayQty;

                        if (item.isPackaging || ['Packaging', 'Cleaning', 'Cleaning Supplies'].includes(cat)) {
                            mondayQty = Math.round(restAllocatedTotal * 0.5);
                            thursdayQty = restAllocatedTotal - mondayQty;
                        }

                        // Calculate Trend
                        let trendLabel = 'stable';
                        if (median4 > median8 * 1.2) trendLabel = 'up';
                        else if (median4 < median8 * 0.8) trendLabel = 'down';

                        locationPurchaseResults.push({
                            itemName: itemName,
                            category: cat || 'Vegetable',
                            totalQty: restAllocatedTotal,
                            mondayQty,
                            thursdayQty,
                            trend: trendLabel,
                            confidence: override ? 'High' : (qtyIn8Filtered.length >= 7 ? 'High' : 'Medium'),
                            sortWeight: override ? override.min * 10 : restAllocatedTotal
                        });
                    }
                }
            });

            locationPurchaseResults.sort((a, b) => b.sortWeight - a.sortWeight);
            setForecasts(locationPurchaseResults);
            setLoading(false);

        }, 400); // Simulate network load
    }, [selectedRestId, restaurants.length]);

    return (
        <div style={{ padding: '0 24px', maxWidth: 1400, margin: '0 auto' }}>
            <div className="page-header" style={{ marginBottom: 32, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                    <h2 style={{ fontSize: 24, fontWeight: 700, margin: 0 }}>Location Delivery Limits</h2>
                    <p style={{ color: 'var(--muted)', marginTop: 8, fontSize: 14 }}>Global predictions proportionally distributed down to specific restaurant order flows.</p>
                </div>
                <div style={{ width: 300 }}>
                    <select
                        className="ui-input"
                        value={selectedRestId}
                        onChange={e => setSelectedRestId(e.target.value)}
                        style={{ background: 'var(--bg-panel)', border: '1px solid var(--border)', color: 'var(--text-primary)', padding: '10px 16px', borderRadius: 8, width: '100%' }}
                    >
                        <option value="">Select Location...</option>
                        {restaurants.map(r => <option key={r} value={r}>{r}</option>)}
                    </select>
                </div>
            </div>

            {loading ? (
                <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>Calculating location capacities...</div>
            ) : forecasts.length === 0 ? (
                <div className="ui-card" style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>
                    No items forecasted for this location next week.
                </div>
            ) : (
                <div className="ui-card" style={{ padding: 0, overflow: 'hidden' }}>
                    <table className="ui-table" style={{ margin: 0, width: '100%' }}>
                        <thead>
                            <tr>
                                <th>Item</th>
                                <th>Category</th>
                                <th>Location Weekly Target</th>
                                <th>Monday Route Qt.</th>
                                <th>Thursday Route Qt.</th>
                                <th>Location Trend</th>
                                <th>Confidence</th>
                            </tr>
                        </thead>
                        <tbody>
                            {forecasts.map((f, idx) => (
                                <tr key={idx}>
                                    <td style={{ fontWeight: 600 }}>{f.itemName}</td>
                                    <td style={{ color: 'var(--muted)', fontSize: 13 }}>{f.category}</td>
                                    <td style={{ fontSize: 15, fontWeight: 700, color: '#f8fafc' }}>
                                        {f.totalQty}
                                    </td>
                                    <td>
                                        <span style={{ color: '#3b82f6', fontWeight: 600 }}>{f.mondayQty}</span>
                                    </td>
                                    <td>
                                        <span style={{ color: '#8b5cf6', fontWeight: 600 }}>{f.thursdayQty}</span>
                                    </td>
                                    <td><TrendBadge trend={f.trend} /></td>
                                    <td><ConfidenceBadge confidence={f.confidence} /></td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}
