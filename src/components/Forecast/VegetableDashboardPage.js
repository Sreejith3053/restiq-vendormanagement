import React, { useState, useEffect } from 'react';

import vendorCatalogV2 from '../../data/catalog_v2.json';
import purchaseDatasetV2 from '../../data/history_realistic_v2_tomato.json';

export default function VegetableDashboardPage() {
    const [purchaseOrders, setPurchaseOrders] = useState([]);
    const [suggestedItems, setSuggestedItems] = useState([]);
    const [loading, setLoading] = useState(true);
    const [validationStats, setValidationStats] = useState(null);

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

    const V2_OCCASIONAL_EXCLUSIONS = ['Capsicum Green', 'Beets', 'Ash Guard', 'Pepper Mix', 'Cauliflower'];

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

    const fetchAndPredict = () => {
        setLoading(true);
        try {
            const catalogLookup = {};
            let loadedCatalogItems = 0;

            vendorCatalogV2.forEach(row => {
                const name = row.item_name?.trim();
                const vendor = row.vendor?.trim() || 'ON Thyme';
                if (name && vendor.toLowerCase().includes('thyme')) {
                    loadedCatalogItems++;

                    let packLogic = `1 ${row.base_unit} = 1 ${row.base_unit}`;
                    if (row.pack_size > 1) {
                        const packWord = row.pack_label.split(' ').pop();
                        packLogic = `1 ${packWord} = ${row.pack_size} ${row.base_unit}`;
                    } else {
                        const packWord = row.pack_label.split(' ').pop();
                        packLogic = `1 ${packWord} = 1 ${packWord}`;
                        if (row.base_unit === 'bundle' || row.base_unit === 'packet' || row.base_unit === 'bag') {
                            packLogic = `1 ${row.base_unit} = 1 ${row.base_unit}`;
                        } else if (packWord === 'lb') {
                            packLogic = `1 lb = 1 lb`;
                        } else if (packWord === 'unit') {
                            packLogic = `1 unit = 1 unit`;
                        } else if (packWord === 'box' || packWord === 'case') {
                            packLogic = `1 ${packWord} = 1 unit`;
                        }
                    }

                    let nameLower = name.toLowerCase();
                    if (nameLower === 'coriander leaves') packLogic = `1 bunch`;
                    else if (nameLower === 'mint leaves') packLogic = `1 bunch`;
                    else if (nameLower === 'leeks') packLogic = `1 bunch`;
                    else if (nameLower === 'celery') packLogic = `1kg`;
                    else if (nameLower === 'long beans') packLogic = `1 pack = 1.5lb`;
                    else if (nameLower === 'plantain green') packLogic = `1 pack = 5lb`;
                    else if (nameLower === 'lime') packLogic = `1 pack = 3.64kg`;
                    else if (nameLower === 'curry leaves') packLogic = `1 box = 12 lb`;
                    else if (nameLower === 'french beans') packLogic = `1 bag = 1.5lb (680g)`;
                    else if (nameLower === 'beets') packLogic = `25lb bag`;
                    else if (nameLower === 'ginger' || nameLower === 'thai chilli') packLogic = `30lb box`;
                    else if (row.pack_label.toLowerCase().includes('case') && row.pack_size === 100) {
                        packLogic = `1 case = 100 units`;
                    } else if (row.pack_label.toLowerCase().includes('bag') && row.pack_size === 50) {
                        packLogic = `50lb bag`;
                    } else if (row.pack_label.toLowerCase().includes('bag') && row.pack_size === 25) {
                        packLogic = `25lb bag`;
                    } else if (row.pack_label.toLowerCase().includes('box') && row.pack_size === 25) {
                        packLogic = `25lb box`;
                    } else if (row.pack_label.toLowerCase().includes('box') && row.pack_size === 30) {
                        packLogic = `30lb box`;
                    } else if (row.pack_label.toLowerCase().includes('case') && row.pack_size === 18) {
                        packLogic = `18lb case`;
                    } else if (row.pack_label.toLowerCase().includes('unit') && row.pack_size === 100) {
                        packLogic = `1 case = 100 units`;
                    }


                    catalogLookup[name] = {
                        base_unit: row.base_unit || 'unit',
                        pack_size: row.pack_size || 1,
                        packLogic: packLogic,
                        price: parseFloat(row.price) || 0,
                        vendor: vendor
                    };
                }
            });

            const globalDatesSet = new Set();
            purchaseDatasetV2.forEach(d => {
                if (d.purchase_date) globalDatesSet.add(d.purchase_date);
            });
            const allCycles = [...globalDatesSet].sort((a, b) => new Date(b).getTime() - new Date(a).getTime());
            const last8Cycles = allCycles.slice(0, 8);
            const last4Cycles = allCycles.slice(0, 4);

            const historyMap = {};
            const itemDatesMap = {};
            let loadedHistoryRows = 0;

            purchaseDatasetV2.forEach(data => {
                if (!data.purchase_date || !data.item_name) return;
                loadedHistoryRows++;

                const exactName = normalizeItemName(data.item_name);

                if (!historyMap[exactName]) {
                    historyMap[exactName] = { itemName: exactName, orderHistoryMap: {}, appearanceCount: 0 };
                    itemDatesMap[exactName] = new Set();
                }

                const qty = Number(data.normalized_quantity) || 0;
                if (!historyMap[exactName].orderHistoryMap[data.purchase_date]) {
                    historyMap[exactName].orderHistoryMap[data.purchase_date] = 0;
                }
                historyMap[exactName].orderHistoryMap[data.purchase_date] += qty;
                itemDatesMap[exactName].add(data.purchase_date);
            });

            Object.values(historyMap).forEach(item => {
                item.appearanceCount = Object.keys(item.orderHistoryMap).length;
            });

            let tomatoFoundInHistory = false;
            let tomatoForecasted = false;

            const mainPurchaseResults = [];
            const nonPredictedItems = [];
            const mainItemDates = new Set();

            Object.values(historyMap).forEach(item => {
                if (item.itemName === 'Tomato') tomatoFoundInHistory = true;

                const qtyIn8Filtered = last8Cycles.map(date => item.orderHistoryMap[date] || 0).filter(q => q > 0);

                const qtyIn8 = last8Cycles.map(date => item.orderHistoryMap[date] || 0);
                const qtyIn4 = last4Cycles.map(date => item.orderHistoryMap[date] || 0);

                const median8 = getMedian(qtyIn8);
                const median4 = getMedian(qtyIn4);

                let forecastQty = (0.3 * median4) + (0.7 * median8);
                let predictedTotal = Math.ceil(forecastQty);

                const override = V2_BASELINE_OVERRIDES[item.itemName];
                if (override) {
                    predictedTotal = override.min;
                } else {
                    const cap = Math.ceil(median8 * 1.5) || 1;
                    if (predictedTotal > cap) predictedTotal = cap;

                    if (item.itemName === 'Tomato' && predictedTotal < 1 && qtyIn8Filtered.length > 0) {
                        predictedTotal = Math.ceil(getMedian(qtyIn8Filtered));
                    }
                }

                const cMap = catalogLookup[item.itemName];
                let speedLabel = override ? override.speed : 'Slow';
                if (!override) {
                    const appearPercent = item.appearanceCount / allCycles.length;
                    if (appearPercent >= 0.7) speedLabel = 'Fast';
                    else if (appearPercent >= 0.3) speedLabel = 'Medium';
                }

                let isCoreItem = !!override;

                if (!isCoreItem && !V2_OCCASIONAL_EXCLUSIONS.includes(item.itemName)) {
                    if ((qtyIn8Filtered.length >= 6 || item.itemName === 'Tomato') && predictedTotal > 0) {
                        isCoreItem = true;
                    }
                }

                if (isCoreItem && predictedTotal > 0 && cMap) {
                    if (item.itemName === 'Tomato') tomatoForecasted = true;

                    let mondayQty = Math.round(predictedTotal * 0.6);
                    let thursdayQty = predictedTotal - mondayQty;

                    mainPurchaseResults.push({
                        itemName: item.itemName,
                        speed: speedLabel,
                        totalQty: predictedTotal,
                        mondayQty,
                        thursdayQty,
                        packLogic: cMap.packLogic,
                        unitPrice: cMap.price,
                        mondayCost: mondayQty * cMap.price,
                        thursdayCost: thursdayQty * cMap.price,
                        totalCost: predictedTotal * cMap.price,
                        sortWeight: override ? override.min * 10 : predictedTotal
                    });

                    itemDatesMap[item.itemName].forEach(d => mainItemDates.add(d));

                } else if (cMap) {
                    nonPredictedItems.push({
                        itemName: item.itemName,
                        appearPercent: item.appearanceCount / allCycles.length,
                        datesOrdered: itemDatesMap[item.itemName],
                        orderedLastCycle: !!item.orderHistoryMap[last8Cycles[0]],
                        qtyIn8_nonzero: qtyIn8Filtered.length,
                    });
                }
            });

            mainPurchaseResults.sort((a, b) => b.sortWeight - a.sortWeight);
            const finalMainList = mainPurchaseResults.slice(0, 10);

            const suggestionPool = [];
            nonPredictedItems.forEach(item => {
                let score = 0;
                let reasons = [];

                score += item.appearPercent * 10;
                if (item.appearPercent > 0.5) reasons.push("Common supporting ingredient in past orders");

                if (item.orderedLastCycle) {
                    score += 5;
                    reasons.push("Recent add-on item");
                }

                let overlapCount = 0;
                item.datesOrdered.forEach(d => {
                    if (mainItemDates.has(d)) overlapCount++;
                });
                let overlapRatio = item.datesOrdered.size > 0 ? overlapCount / item.datesOrdered.size : 0;
                if (overlapRatio > 0.8 && item.datesOrdered.size > 2) {
                    score += 4;
                    reasons.push("Frequently bought with main predicted items");
                }

                if (item.qtyIn8_nonzero > 0 && item.qtyIn8_nonzero < 3) {
                    score += 2;
                    reasons.push("Appears in similar historical weeks");
                }

                if (reasons.length === 0 && item.appearPercent > 0.2) {
                    reasons.push("Seasonal supporting item");
                    score += 2;
                }

                if (score > 3) {
                    suggestionPool.push({
                        itemName: item.itemName,
                        score,
                        suggestedQty: 1,
                        reason: reasons[0] || 'AI suggested addition'
                    });
                }
            });

            suggestionPool.sort((a, b) => b.score - a.score);
            const finalSuggestions = suggestionPool.slice(0, 6);

            setPurchaseOrders(finalMainList);
            setSuggestedItems(finalSuggestions);

            setValidationStats({
                catalogFile: 'vendor_item_catalog_v2.csv',
                historyFile: 'oruma_takeout_realistic_dataset_v2_tomato.csv',
                historyRows: loadedHistoryRows,
                catalogItems: loadedCatalogItems,
                tomatoFound: tomatoFoundInHistory ? 'Yes' : 'No',
                tomatoForecasted: tomatoForecasted ? 'Yes' : 'No',
                sectionA_Ranking: 'Simple V2 Ranking (No AI)',
                sectionB_Ranking: 'AI Co-occurrence Suggestion Logic'
            });

        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchAndPredict();
    }, []);

    if (loading) return <div style={{ padding: 40, textAlign: 'center' }}>Loading AI Forecasts...</div>;

    const mondayEstCost = purchaseOrders.reduce((acc, p) => acc + p.mondayCost, 0);
    const thursdayEstCost = purchaseOrders.reduce((acc, p) => acc + p.thursdayCost, 0);
    const totalEstCost = purchaseOrders.reduce((acc, p) => acc + p.totalCost, 0);

    const speedColors = {
        'Fast': '#10b981',
        'Medium': '#3b82f6',
        'Slow': '#f59e0b'
    };

    return (
        <div style={{ padding: 24, maxWidth: 1400, margin: '0 auto' }}>
            <div style={{ marginBottom: 32 }}>
                <h2 style={{ fontSize: 24, fontWeight: 700, margin: 0 }}>Vegetable Demand Dashboard</h2>
                <div style={{ color: 'var(--muted)', marginTop: 8 }}>Separation of Basic Raw Demand (Section A) and AI Optional Models (Section B)</div>
            </div>

            {validationStats && (
                <div className="ui-card" style={{ marginBottom: 32, padding: 16, borderRadius: 8, background: '#1e293b', border: '1px solid #334155', color: '#cbd5e1', fontSize: 13 }}>
                    <h3 style={{ margin: '0 0 12px 0', color: '#fff', fontSize: 14, textTransform: 'uppercase', letterSpacing: 1 }}>🛠️ Admin Validation Panel</h3>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 12 }}>
                        <div><strong>Active Catalog:</strong> {validationStats.catalogFile}</div>
                        <div><strong>Active History:</strong> {validationStats.historyFile}</div>
                        <div><strong>Tomato Found in History:</strong> <span style={{ color: validationStats.tomatoFound === 'Yes' ? '#4ade80' : '#f87171' }}>{validationStats.tomatoFound}</span></div>
                        <div><strong>Tomato Forecasted:</strong> <span style={{ color: validationStats.tomatoForecasted === 'Yes' ? '#4ade80' : '#f87171' }}>{validationStats.tomatoForecasted}</span></div>
                        <div><strong>Section A Mode:</strong> <span style={{ color: '#60a5fa' }}>{validationStats.sectionA_Ranking}</span></div>
                        <div><strong>Section B Mode:</strong> <span style={{ color: '#c084fc' }}>{validationStats.sectionB_Ranking}</span></div>
                    </div>
                </div>
            )}

            {/* SECTION A: MAIN PREDICTED WEEKLY ORDER */}
            <div className="ui-card" style={{ padding: 0, overflow: 'hidden', marginBottom: 32 }}>
                <div style={{ padding: 24, borderBottom: '1px solid var(--border)' }}>
                    <h3 style={{ margin: 0 }}>SECTION A — MAIN PREDICTED WEEKLY ORDER</h3>
                    <div style={{ color: 'var(--muted)', fontSize: 13, marginTop: 4 }}>Ranked via recent frequency and raw stable repeat patterns. Core constraints applied.</div>
                </div>
                <div className="ui-table-wrap">
                    <table className="ui-table" style={{ margin: 0, width: '100%' }}>
                        <thead>
                            <tr>
                                <th>Item</th>
                                <th>Speed</th>
                                <th>Monday</th>
                                <th>Thursday</th>
                                <th>Total</th>
                            </tr>
                        </thead>
                        <tbody>
                            {purchaseOrders.map((p, idx) => (
                                <tr key={idx}>
                                    <td style={{ fontWeight: 600 }}>{p.itemName}</td>
                                    <td>
                                        <span style={{
                                            background: `${speedColors[p.speed]}20`,
                                            color: speedColors[p.speed] || '#cbd5e1',
                                            padding: '4px 10px',
                                            borderRadius: 12,
                                            fontSize: 12,
                                            fontWeight: 600
                                        }}>
                                            {p.speed}
                                        </span>
                                    </td>
                                    <td style={{ color: '#3b82f6', fontWeight: 600 }}>{p.mondayQty}</td>
                                    <td style={{ color: '#8b5cf6', fontWeight: 600 }}>{p.thursdayQty}</td>
                                    <td style={{ fontWeight: 700, color: '#f8fafc' }}>{p.totalQty}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* SECTION A.1 — PACK LOGIC VIEW */}
            <div className="ui-card" style={{ padding: 0, overflow: 'hidden', marginBottom: 32 }}>
                <div style={{ padding: 24, borderBottom: '1px solid var(--border)' }}>
                    <h3 style={{ margin: 0 }}>SECTION A.1 — PACK LOGIC VIEW</h3>
                    <div style={{ color: 'var(--muted)', fontSize: 13, marginTop: 4 }}>Vendor catalog translation applied to the highly constrained Section A list.</div>
                </div>
                <div className="ui-table-wrap">
                    <table className="ui-table" style={{ margin: 0, width: '100%' }}>
                        <thead>
                            <tr>
                                <th>Item</th>
                                <th>Pack Logic</th>
                                <th>Unit Price</th>
                            </tr>
                        </thead>
                        <tbody>
                            {purchaseOrders.map((p, idx) => (
                                <tr key={idx}>
                                    <td style={{ fontWeight: 600 }}>{p.itemName}</td>
                                    <td style={{ color: '#cbd5e1' }}><span style={{ background: 'rgba(255,255,255,0.05)', padding: '2px 8px', borderRadius: 4 }}>{p.packLogic}</span></td>
                                    <td style={{ color: 'var(--muted)' }}>${p.unitPrice.toFixed(2)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* SECTION A.2 — ESTIMATED COST SUMMARY */}
            <div style={{ marginBottom: 32 }}>
                <div style={{ padding: '0 0 16px 0' }}>
                    <h3 style={{ margin: 0, fontSize: 18 }}>SECTION A.2 — ESTIMATED COST SUMMARY</h3>
                    <div style={{ color: 'var(--muted)', fontSize: 13, marginTop: 4 }}>Aggregated forecast purchasing bounds exactly hitting Section A logic.</div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: 24 }}>
                    <div className="ui-card" style={{ padding: 24, background: 'linear-gradient(145deg, var(--bg-hover) 0%, var(--bg-panel) 100%)' }}>
                        <div style={{ color: 'var(--muted)', fontSize: 13, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>Estimated Monday Cost</div>
                        <div style={{ fontSize: 28, fontWeight: 700, color: '#3b82f6' }}>${mondayEstCost.toFixed(2)}</div>
                    </div>
                    <div className="ui-card" style={{ padding: 24, background: 'linear-gradient(145deg, var(--bg-hover) 0%, var(--bg-panel) 100%)' }}>
                        <div style={{ color: 'var(--muted)', fontSize: 13, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>Estimated Thursday Cost</div>
                        <div style={{ fontSize: 28, fontWeight: 700, color: '#8b5cf6' }}>${thursdayEstCost.toFixed(2)}</div>
                    </div>
                    <div className="ui-card" style={{ padding: 24, background: 'linear-gradient(145deg, var(--bg-hover) 0%, var(--bg-panel) 100%)', border: '1px solid rgba(16, 185, 129, 0.3)' }}>
                        <div style={{ color: 'var(--muted)', fontSize: 13, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>Total Weekly Cost</div>
                        <div style={{ fontSize: 32, fontWeight: 700, color: '#10b981' }}>${totalEstCost.toFixed(2)}</div>
                    </div>
                </div>
            </div>

            {/* SECTION A.3 — DETAILED COST TABLE */}
            <div className="ui-card" style={{ padding: 0, overflow: 'hidden', marginBottom: 32 }}>
                <div style={{ padding: 24, borderBottom: '1px solid var(--border)' }}>
                    <h3 style={{ margin: 0 }}>SECTION A.3 — DETAILED COST TABLE</h3>
                    <div style={{ color: 'var(--muted)', fontSize: 13, marginTop: 4 }}>Price multiplied specifically against strict core limits.</div>
                </div>
                <div className="ui-table-wrap">
                    <table className="ui-table" style={{ margin: 0, width: '100%' }}>
                        <thead>
                            <tr>
                                <th>Item</th>
                                <th>Monday Qty</th>
                                <th>Thursday Qty</th>
                                <th>Total Qty</th>
                                <th>Unit Price</th>
                                <th>Monday Cost</th>
                                <th>Thursday Cost</th>
                                <th>Total Cost</th>
                            </tr>
                        </thead>
                        <tbody>
                            {purchaseOrders.map((p, idx) => (
                                <tr key={idx}>
                                    <td style={{ fontWeight: 600 }}>{p.itemName}</td>
                                    <td style={{ color: '#3b82f6' }}>{p.mondayQty}</td>
                                    <td style={{ color: '#8b5cf6' }}>{p.thursdayQty}</td>
                                    <td style={{ fontWeight: 700 }}>{p.totalQty}</td>
                                    <td style={{ color: 'var(--muted)' }}>${p.unitPrice.toFixed(2)}</td>
                                    <td style={{ color: '#3b82f6' }}>${p.mondayCost.toFixed(2)}</td>
                                    <td style={{ color: '#8b5cf6' }}>${p.thursdayCost.toFixed(2)}</td>
                                    <td style={{ fontWeight: 600, color: '#10b981' }}>${p.totalCost.toFixed(2)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* SECTION B: AI SUGGESTIONS FROM PREVIOUS ORDERS */}
            {suggestedItems.length > 0 && (
                <div className="ui-card" style={{ padding: 0, overflow: 'hidden', marginBottom: 32, border: '1px solid rgba(245, 158, 11, 0.3)' }}>
                    <div style={{ padding: 24, borderBottom: '1px solid var(--border)', background: 'rgba(245, 158, 11, 0.05)' }}>
                        <h3 style={{ margin: 0, color: '#f59e0b' }}>SECTION B — AI SUGGESTIONS FROM PREVIOUS ORDERS</h3>
                        <div style={{ color: 'var(--muted)', fontSize: 13, marginTop: 4 }}>Optional additions scored dynamically via Co-occurrence and Recency.</div>
                    </div>
                    <div className="ui-table-wrap">
                        <table className="ui-table" style={{ margin: 0, width: '100%' }}>
                            <thead>
                                <tr>
                                    <th>Item</th>
                                    <th>Suggested Qty</th>
                                    <th>Reason</th>
                                </tr>
                            </thead>
                            <tbody>
                                {suggestedItems.map((p, idx) => (
                                    <tr key={idx}>
                                        <td style={{ fontWeight: 600 }}>{p.itemName}</td>
                                        <td style={{ fontWeight: 600, color: '#f59e0b' }}>{p.suggestedQty}</td>
                                        <td style={{ color: '#cbd5e1', fontSize: 14 }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                                <span style={{ color: '#f59e0b' }}>✨</span> {p.reason}
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}
        </div>
    );
}
