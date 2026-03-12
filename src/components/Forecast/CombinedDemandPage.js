import React, { useState, useEffect, useMemo } from 'react';
import { db } from '../../firebase';
import { collection, getDocs, onSnapshot } from 'firebase/firestore';
import { getActiveWeekStart, formatWeekLabel } from './dispatchModel';

// ── Utility badges ──────────────────────────────────────────────────────────
const StatusDot = ({ status }) => {
    const colors = {
        'Submitted': '#38bdf8',
        'Locked': '#818cf8',
        'Aggregated': '#34d399',
        'Sent to Vendor': '#a78bfa',
    };
    const c = colors[status] || '#94a3b8';
    return <span style={{ background: `${c}20`, color: c, padding: '3px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600 }}>{status}</span>;
};

export default function CombinedDemandPage({ hideHeader = false }) {
    const [aggregated, setAggregated] = useState([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [viewMode, setViewMode] = useState('demand'); // 'demand' | 'picklist'
    const [expandedItems, setExpandedItems] = useState(new Set());

    // Filters
    const [categoryFilter, setCategoryFilter] = useState('all');
    const [vendorFilter, setVendorFilter] = useState('all');

    // Week filter
    const [activeWeek, setActiveWeek] = useState(() => getActiveWeekStart());
    const weekLabel = useMemo(() => formatWeekLabel(activeWeek), [activeWeek]);

    // Week navigation helpers
    const shiftWeek = (delta) => {
        const d = new Date(activeWeek);
        d.setDate(d.getDate() + delta * 7);
        setActiveWeek(d.toISOString().slice(0, 10));
    };

    const toggleExpand = (itemName) => {
        const newSet = new Set(expandedItems);
        if (newSet.has(itemName)) newSet.delete(itemName);
        else newSet.add(itemName);
        setExpandedItems(newSet);
    };

    // Auto-expand all items on search
    useEffect(() => {
        if (searchTerm.length >= 2) {
            const matches = filteredAggregated.map(a => a.itemName);
            setExpandedItems(new Set(matches));
        } else {
            setExpandedItems(new Set());
        }
    }, [searchTerm]);

    // ── Main data load: submittedOrders (real-time) + vendor catalog ─────────
    useEffect(() => {
        let cancelled = false;

        // 1. Load vendor catalog (one-time)
        async function loadCatalog() {
            const catalogLookup = {};
            try {
                const vendorSnap = await getDocs(collection(db, 'vendors'));
                const vendors = vendorSnap.docs.map(d => ({ id: d.id, ...d.data() }));
                for (const v of vendors) {
                    try {
                        const itemSnap = await getDocs(collection(db, `vendors/${v.id}/items`));
                        itemSnap.docs.forEach(d => {
                            const itemData = d.data();
                            const name = itemData.name?.trim();
                            if (name) {
                                const dbPrice = parseFloat(itemData.vendorPrice) || parseFloat(itemData.price) || 0;
                                catalogLookup[name] = {
                                    ...catalogLookup[name],
                                    ...itemData,
                                    price: dbPrice > 0 ? dbPrice : (catalogLookup[name]?.price || 0),
                                    vendor: v.name || 'Unknown Vendor',
                                    base_unit: itemData.unit || catalogLookup[name]?.base_unit,
                                    pack_size: itemData.packQuantity || catalogLookup[name]?.pack_size || 1,
                                    pack_label: itemData.itemSize || catalogLookup[name]?.pack_label,
                                    category: itemData.category || catalogLookup[name]?.category || 'Produce',
                                    isPackaging: (itemData.category || '').toLowerCase().includes('packaging') || (itemData.category || '').toLowerCase().includes('cleaning')
                                };
                            }
                        });
                    } catch (e) {
                        console.warn('Failed to fetch items for vendor', v.id);
                    }
                }
            } catch (err) {
                console.error("Failed to load vendor catalog:", err);
            }
            return catalogLookup;
        }

        loadCatalog().then(catalogLookup => {
            if (cancelled) return;

            // 2. Real-time listener on submittedOrders
            const unsub = onSnapshot(collection(db, 'submittedOrders'), snap => {
                if (cancelled) return;

                const allOrders = snap.docs.map(d => ({ id: d.id, ...d.data() }));

                // Filter to active week
                const weekOrders = allOrders.filter(o => o.weekStart === activeWeek);
                console.log(`[CombinedDemand] ${weekOrders.length} submitted orders for week ${activeWeek}`);

                // Aggregate item lines across all restaurants and delivery days
                const itemMap = {}; // itemName → aggregated data

                weekOrders.forEach(order => {
                    const restId = order.restaurantId || 'unknown';
                    const restName = order.restaurantName || restId;
                    const deliveryDay = order.deliveryDay || 'Monday';
                    const orderStatus = order.status || 'Submitted';

                    (order.items || []).forEach(line => {
                        const itemName = line.itemName;
                        if (!itemName) return;

                        const qty = Number(line.finalQty) || 0;
                        if (qty <= 0) return;

                        if (!itemMap[itemName]) {
                            itemMap[itemName] = {
                                mondayQty: 0,
                                thursdayQty: 0,
                                branches: {}, // restId → { name, mon, thu, status }
                                category: line.category || '',
                                packLabel: line.packLabel || '',
                            };
                        }

                        if (deliveryDay === 'Monday') {
                            itemMap[itemName].mondayQty += qty;
                        } else {
                            itemMap[itemName].thursdayQty += qty;
                        }

                        // Per-branch tracking
                        if (!itemMap[itemName].branches[restId]) {
                            itemMap[itemName].branches[restId] = { name: restName, mon: 0, thu: 0, status: orderStatus };
                        }
                        if (deliveryDay === 'Monday') {
                            itemMap[itemName].branches[restId].mon += qty;
                        } else {
                            itemMap[itemName].branches[restId].thu += qty;
                        }
                        // Keep the most advanced status
                        itemMap[itemName].branches[restId].status = orderStatus;
                    });
                });

                // Build aggregated results enriched with catalog data
                const aggregatedResults = [];

                Object.keys(itemMap).forEach(itemName => {
                    const item = itemMap[itemName];
                    const totalQty = item.mondayQty + item.thursdayQty;

                    // Catalog enrichment
                    const catEntry = catalogLookup[itemName] || {};
                    const vendorName = catEntry.vendor || 'Unknown Vendor';
                    const category = item.category || catEntry.category || 'Produce';
                    const catalogSellPrice = catEntry.price || 0;

                    let pkSize = catEntry.pack_size || 1;
                    let baseUnit = catEntry.base_unit || 'lb';
                    let rawPackLabel = catEntry.pack_label || baseUnit;
                    const isPackaging = catEntry.isPackaging || ['Packaging', 'Cleaning', 'Cleaning Supplies'].includes(category);

                    // Order unit logic (same as before)
                    let orderUnit = baseUnit;
                    let nameLower = itemName.toLowerCase();
                    if (['onion - cooking', 'onion - red', 'cabbage', 'carrot', 'french beans', 'potatoes', 'beets'].includes(nameLower)) orderUnit = 'bag';
                    else if (['tomato', 'cauliflower', 'curry leaves', 'ginger', 'thai chilli'].includes(nameLower)) orderUnit = 'box';
                    else if (['lemon', 'peeled garlic'].includes(nameLower)) orderUnit = 'case';
                    else if (['coriander leaves', 'mint leaves', 'leeks'].includes(nameLower)) orderUnit = 'bunch';
                    else if (['green onion'].includes(nameLower)) orderUnit = 'bundle';
                    else if (['celery'].includes(nameLower)) orderUnit = 'kg';
                    else if (['long beans', 'plantain green', 'lime'].includes(nameLower)) orderUnit = 'pack';
                    else if (['okra'].includes(nameLower)) orderUnit = 'packet';

                    // Vendor pack display string
                    let displayVendorPackStr = `${pkSize}${baseUnit} ${rawPackLabel}`;
                    if (pkSize === 1 && !isPackaging) displayVendorPackStr = baseUnit;
                    if (isPackaging) {
                        displayVendorPackStr = `${pkSize} ${pkSize === 1 ? 'unit' : 'units'} / ${baseUnit}`;
                        orderUnit = baseUnit;
                    } else if (nameLower === 'coriander leaves' || nameLower === 'mint leaves' || nameLower === 'leeks') displayVendorPackStr = `1 bunch`;
                    else if (nameLower === 'celery') displayVendorPackStr = `1kg`;
                    else if (nameLower === 'long beans') displayVendorPackStr = `1 pack = 1.5lb`;
                    else if (nameLower === 'plantain green') displayVendorPackStr = `1 pack = 5lb`;
                    else if (nameLower === 'lime') displayVendorPackStr = `1 pack = 3.64kg`;
                    else if (nameLower === 'curry leaves') displayVendorPackStr = `1 box = 12 lb`;
                    else if (nameLower === 'french beans') displayVendorPackStr = `1.5lb bag`;
                    else if (nameLower === 'beets') displayVendorPackStr = `25lb bag`;
                    else if (nameLower === 'ginger' || nameLower === 'thai chilli') displayVendorPackStr = `30lb box`;
                    else if (nameLower === 'onion - cooking' || nameLower === 'cabbage' || nameLower === 'carrot') displayVendorPackStr = `50lb bag`;
                    else if (nameLower === 'onion - red') displayVendorPackStr = `25lb bag`;
                    else if (rawPackLabel.toLowerCase().includes('case') && pkSize === 100) displayVendorPackStr = `1 case = 100 units`;
                    else if (rawPackLabel.toLowerCase().includes('bag') && pkSize === 50) displayVendorPackStr = `50lb bag`;
                    else if (rawPackLabel.toLowerCase().includes('bag') && pkSize === 25) displayVendorPackStr = `25lb bag`;
                    else if (rawPackLabel.toLowerCase().includes('box') && pkSize === 25) displayVendorPackStr = `25lb box`;
                    else if (rawPackLabel.toLowerCase().includes('box') && pkSize === 30) displayVendorPackStr = `30lb box`;
                    else if (rawPackLabel.toLowerCase().includes('case') && pkSize === 18) displayVendorPackStr = `18lb case`;
                    else if (rawPackLabel.toLowerCase().includes('unit') && pkSize === 100) displayVendorPackStr = `1 case = 100 units`;
                    else if (rawPackLabel.toLowerCase() === 'lb' || (pkSize === 1 && baseUnit === 'lb')) displayVendorPackStr = `1 lb`;
                    else if (rawPackLabel.includes(String(pkSize))) displayVendorPackStr = rawPackLabel;

                    // Financial calculations
                    const restaurantBilling = totalQty * catalogSellPrice;
                    const marketplaceCommission = restaurantBilling * 0.10;
                    const vendorPayout = restaurantBilling * 0.90;

                    // Branch drilldown
                    const branchKeys = Object.keys(item.branches);
                    const branchDrilldownData = branchKeys.map(bId => {
                        const b = item.branches[bId];
                        return {
                            branchName: b.name,
                            mon: b.mon,
                            thu: b.thu,
                            total: b.mon + b.thu,
                            status: b.status,
                        };
                    }).sort((a, b) => b.total - a.total);

                    const activeBranchCount = branchKeys.length;
                    let locationDisplayStr = activeBranchCount === 1 ? branchDrilldownData[0]?.branchName || '1 branch' : `${activeBranchCount} branches`;

                    aggregatedResults.push({
                        itemName,
                        category,
                        restsCount: activeBranchCount,
                        locationDisplayStr,
                        totalQty,
                        vendorPacks: totalQty,
                        monVendorPacks: item.mondayQty,
                        thuVendorPacks: item.thursdayQty,
                        mondayQty: item.mondayQty,
                        thursdayQty: item.thursdayQty,
                        vendorName,
                        sortWeight: totalQty,
                        baseUnit: orderUnit,
                        displayVendorPackStr,
                        simplePackWord: orderUnit,
                        isPackaging,
                        catalogSellPrice,
                        vendorPayout,
                        restaurantBilling,
                        marketplaceCommission,
                        branchDrilldownData,
                        storageZone: category === 'Produce' ? 'Chiller Zone A' : (category === 'Packaging' ? 'Dry Storage D' : 'Standard Rack'),
                        isActiveForecast: totalQty > 0, // kept for UI compatibility
                    });
                });

                aggregatedResults.sort((a, b) => b.sortWeight - a.sortWeight);
                setAggregated(aggregatedResults);
                setLoading(false);
            }, err => {
                console.error('[CombinedDemand] Listener error:', err);
                setLoading(false);
            });

            // Cleanup listener
            return () => { cancelled = true; unsub(); };
        });

        return () => { cancelled = true; };
    }, [activeWeek]);

    // ── Filter Logic ────────────────────────────────────────────────────────
    const vendorList = useMemo(() => {
        const set = new Set(aggregated.map(a => a.vendorName));
        return ['all', ...Array.from(set).sort()];
    }, [aggregated]);

    const filteredAggregated = useMemo(() => {
        return aggregated.filter(a => {
            if (searchTerm && !a.itemName.toLowerCase().includes(searchTerm.toLowerCase())) return false;
            if (categoryFilter === 'Produce' && a.category !== 'Produce') return false;
            if (categoryFilter === 'Packaging' && a.category !== 'Packaging') return false;
            if (categoryFilter === 'Cleaning Supplies' && !['Cleaning', 'Cleaning Supplies'].includes(a.category)) return false;
            if (categoryFilter === 'missingCost' && a.catalogSellPrice > 0) return false;
            if (vendorFilter !== 'all' && a.vendorName !== vendorFilter) return false;
            return true;
        });
    }, [aggregated, searchTerm, categoryFilter, vendorFilter]);

    // Picklist Grouping
    const vendorRollups = useMemo(() => {
        const prepMap = {};
        filteredAggregated.forEach(r => {
            if (r.vendorPacks > 0) {
                if (!prepMap[r.vendorName]) prepMap[r.vendorName] = [];
                prepMap[r.vendorName].push(r);
            }
        });
        return prepMap;
    }, [filteredAggregated]);

    // Stats
    const activeItems = aggregated.filter(a => a.totalQty > 0).length;
    const itemsMissingCost = aggregated.filter(a => a.totalQty > 0 && a.catalogSellPrice <= 0).length;
    const prodCount = filteredAggregated.filter(a => a.category === 'Produce').length;
    const packCount = filteredAggregated.filter(a => a.category === 'Packaging').length;
    const cleanCount = filteredAggregated.filter(a => ['Cleaning', 'Cleaning Supplies'].includes(a.category)).length;

    // Vendor Subtotals
    const fullGridVendorRollups = useMemo(() => {
        const rollups = {};
        filteredAggregated.forEach(item => {
            if (item.totalQty <= 0) return;
            const vendor = item.vendorName || 'Unknown Vendor';
            if (!rollups[vendor]) rollups[vendor] = { m: 0, t: 0, r: 0, p: 0, c: 0, count: 0 };
            rollups[vendor].m += item.mondayQty;
            rollups[vendor].t += item.thursdayQty;
            rollups[vendor].r += item.restaurantBilling;
            rollups[vendor].p += item.vendorPayout;
            rollups[vendor].c += item.marketplaceCommission;
            rollups[vendor].count += 1;
        });
        return rollups;
    }, [filteredAggregated]);

    // Sums
    const totalMonday = filteredAggregated.reduce((sum, item) => sum + item.mondayQty, 0);
    const totalThursday = filteredAggregated.reduce((sum, item) => sum + item.thursdayQty, 0);
    const sumVendorPayout = filteredAggregated.reduce((sum, item) => sum + item.vendorPayout, 0);
    const sumCommission = filteredAggregated.reduce((sum, item) => sum + item.marketplaceCommission, 0);
    const sumBilling = filteredAggregated.reduce((sum, item) => sum + item.restaurantBilling, 0);

    return (
        <div style={{ padding: '0 24px', maxWidth: 1400, margin: '0 auto', paddingBottom: 64 }}>
            {!hideHeader && (
                <div className="page-header" style={{ marginBottom: 32, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 4 }}>
                            <h2 style={{ fontSize: 24, fontWeight: 700, margin: 0 }}>Combined Marketplace Demand</h2>
                            <span style={{
                                background: 'linear-gradient(135deg, #10b981, #059669)',
                                color: '#fff', padding: '4px 12px', borderRadius: 20,
                                fontSize: 11, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase'
                            }}>
                                Actual Ordered Demand
                            </span>
                        </div>
                        <p style={{ color: 'var(--muted)', marginTop: 8, fontSize: 14 }}>
                            Real marketplace demand from submitted restaurant orders — operational view for dispatch, warehouse, and invoicing.
                        </p>
                    </div>
                    <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
                        {/* Week Navigator */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--bg-panel)', padding: '6px 12px', borderRadius: 8, border: '1px solid var(--border)' }}>
                            <button onClick={() => shiftWeek(-1)} style={{ background: 'transparent', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: 16, padding: '2px 6px' }}>◀</button>
                            <div style={{ textAlign: 'center', minWidth: 160 }}>
                                <div style={{ fontSize: 13, fontWeight: 600, color: '#f8fafc' }}>{weekLabel}</div>
                                <div style={{ fontSize: 10, color: 'var(--muted)' }}>
                                    {activeWeek === getActiveWeekStart() ? 'Current Week' : activeWeek}
                                </div>
                            </div>
                            <button onClick={() => shiftWeek(1)} style={{ background: 'transparent', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: 16, padding: '2px 6px' }}>▶</button>
                        </div>

                        <div style={{ display: 'flex', background: 'var(--bg-panel)', padding: 4, borderRadius: 8, border: '1px solid var(--border)' }}>
                            <button
                                onClick={() => setViewMode('demand')}
                                style={{ padding: '8px 16px', background: viewMode === 'demand' ? 'var(--primary)' : 'transparent', color: viewMode === 'demand' ? '#fff' : 'var(--muted)', border: 'none', borderRadius: 4, cursor: 'pointer', fontWeight: 600, fontSize: 13 }}
                            >
                                Demand Matrix
                            </button>
                            <button
                                onClick={() => setViewMode('picklist')}
                                style={{ padding: '8px 16px', background: viewMode === 'picklist' ? 'var(--primary)' : 'transparent', color: viewMode === 'picklist' ? '#fff' : 'var(--muted)', border: 'none', borderRadius: 4, cursor: 'pointer', fontWeight: 600, fontSize: 13 }}
                            >
                                Warehouse Pick List
                            </button>
                        </div>

                        <div style={{ width: 280 }}>
                            <input
                                type="text"
                                placeholder="Search items..."
                                value={searchTerm}
                                onChange={e => setSearchTerm(e.target.value)}
                                className="ui-input"
                                style={{ background: 'var(--bg-panel)', border: '1px solid var(--border)', color: 'var(--text-primary)', padding: '10px 16px', borderRadius: 8, width: '100%' }}
                            />
                        </div>
                    </div>
                </div>
            )}

            {loading ? (
                <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>Loading submitted orders...</div>
            ) : (
                <>
                    {/* Top Summary Cards */}
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 16, marginBottom: 24 }}>
                        <div className="ui-card" style={{ padding: 20 }}>
                            <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>Ordered Items</div>
                            <div style={{ fontSize: 24, fontWeight: 700, color: '#f8fafc', marginTop: 8 }}>{activeItems} <span style={{ fontSize: 13, color: 'var(--muted)', fontWeight: 400 }}>Line Items</span></div>
                        </div>
                        <div className="ui-card" style={{ padding: 20, borderTop: '3px solid #f43f5e' }}>
                            <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>Items Missing Catalog Price</div>
                            <div style={{ fontSize: 24, fontWeight: 700, color: itemsMissingCost > 0 ? '#f43f5e' : 'var(--muted)', marginTop: 8 }}>{itemsMissingCost}</div>
                        </div>
                        <div className="ui-card" style={{ padding: 20, borderTop: '3px solid #ec4899' }}>
                            <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>Total Rest. Billing</div>
                            <div style={{ fontSize: 24, fontWeight: 700, color: '#ec4899', marginTop: 8 }}>${sumBilling.toFixed(2)}</div>
                        </div>
                        <div className="ui-card" style={{ padding: 20, borderTop: '3px solid #f59e0b' }}>
                            <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>Total Vendor Payout</div>
                            <div style={{ fontSize: 24, fontWeight: 700, color: '#f59e0b', marginTop: 8 }}>${sumVendorPayout.toFixed(2)}</div>
                        </div>
                        <div className="ui-card" style={{ padding: 20, borderTop: '3px solid #10b981', position: 'relative' }}>
                            <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>Marketplace Commission Net</div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginTop: 8 }}>
                                <div style={{ fontSize: 24, fontWeight: 700, color: '#10b981' }}>${sumCommission.toFixed(2)}</div>
                            </div>
                        </div>
                        <div className="ui-card" style={{ padding: 20, borderTop: '3px solid #3b82f6', position: 'relative' }}>
                            <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>Commission Rate</div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginTop: 8 }}>
                                <div style={{ fontSize: 24, fontWeight: 700, color: '#3b82f6' }}>10%</div>
                            </div>
                        </div>
                    </div>

                    {/* Category Lines Summary */}
                    <div style={{ display: 'flex', gap: 24, padding: '0 8px', marginBottom: 16, fontSize: 13, color: 'var(--muted)', fontWeight: 500 }}>
                        <span>Produce: <b style={{ color: '#f8fafc' }}>{prodCount} items</b></span>
                        <span>Packaging: <b style={{ color: '#f8fafc' }}>{packCount} items</b></span>
                        <span>Cleaning: <b style={{ color: '#f8fafc' }}>{cleanCount} items</b></span>
                    </div>

                    {/* Filters Bar */}
                    <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 24, background: 'var(--bg-panel)', padding: '12px 20px', borderRadius: 8, border: '1px solid var(--border)' }}>
                        <div style={{ display: 'flex', gap: 8 }}>
                            {['all', 'Produce', 'Packaging', 'Cleaning Supplies'].map(cat => (
                                <button
                                    key={cat}
                                    onClick={() => setCategoryFilter(cat)}
                                    style={{
                                        padding: '6px 16px', borderRadius: 20, border: 'none',
                                        background: categoryFilter === cat ? 'var(--primary)' : 'rgba(255,255,255,0.05)',
                                        color: categoryFilter === cat ? '#fff' : 'var(--muted)',
                                        cursor: 'pointer', fontWeight: 600, fontSize: 13, transition: 'all 0.2s'
                                    }}
                                >
                                    {cat === 'all' ? 'All' : cat}
                                </button>
                            ))}
                            <button
                                onClick={() => setCategoryFilter('missingCost')}
                                style={{ padding: '6px 12px', background: categoryFilter === 'missingCost' ? 'rgba(244, 63, 94, 0.1)' : 'transparent', color: categoryFilter === 'missingCost' ? '#f43f5e' : (itemsMissingCost > 0 ? '#f43f5e' : 'var(--muted)'), border: '1px solid', borderColor: categoryFilter === 'missingCost' ? '#f43f5e' : 'transparent', borderRadius: 20, cursor: 'pointer', fontWeight: 600, fontSize: 12 }}
                            >
                                Missing Catalog Price ({itemsMissingCost})
                            </button>
                        </div>
                        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 600 }}>VENDOR:</span>
                            <select
                                value={vendorFilter}
                                onChange={e => setVendorFilter(e.target.value)}
                                style={{ background: 'var(--bg-panel)', color: 'var(--text-primary)', border: '1px solid var(--border)', padding: '6px 12px', borderRadius: 6, fontSize: 13, outline: 'none' }}
                            >
                                {vendorList.map(v => <option key={v} value={v}>{v === 'all' ? 'All Vendors' : v}</option>)}
                            </select>
                        </div>
                    </div>

                    {/* Empty state */}
                    {aggregated.length === 0 && !loading && (
                        <div className="ui-card" style={{ padding: '60px 32px', textAlign: 'center' }}>
                            <div style={{ fontSize: 48, marginBottom: 16, opacity: 0.6 }}>📭</div>
                            <h3 style={{ margin: '0 0 8px 0', fontSize: 18, fontWeight: 700, color: '#e2e8f0' }}>No Submitted Orders This Week</h3>
                            <p style={{ margin: 0, color: 'var(--muted)', fontSize: 14, maxWidth: 480, marginLeft: 'auto', marginRight: 'auto' }}>
                                No restaurants have submitted orders for <b>{weekLabel}</b>. Once restaurants review and submit their suggested orders, the actual demand will appear here.
                            </p>
                        </div>
                    )}

                    {viewMode === 'demand' && aggregated.length > 0 && (
                        <div className="ui-card" style={{ padding: 0, overflow: 'hidden' }}>
                            <table className="ui-table" style={{ margin: 0, width: '100%', borderCollapse: 'collapse' }}>
                                <thead>
                                    <tr>
                                        <th style={{ width: 40 }}></th>
                                        <th>Item / Vendor</th>
                                        <th>Locations</th>
                                        <th style={{ background: 'rgba(77, 171, 247, 0.05)' }}>Monday</th>
                                        <th style={{ background: 'rgba(132, 94, 247, 0.05)' }}>Thursday</th>
                                        <th>Vendor Pack Logic</th>
                                        <th>Packs Needed</th>
                                        <th>Catalog Price</th>
                                        <th>Restaurant Billing</th>
                                        <th>Vendor Payout</th>
                                        <th>Commission (10%)</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {filteredAggregated.length === 0 && (
                                        <tr>
                                            <td colSpan={11} style={{ textAlign: 'center', padding: '32px 16px', color: 'var(--muted)' }}>
                                                No items match your filters.
                                            </td>
                                        </tr>
                                    )}

                                    {Object.keys(fullGridVendorRollups).map(vendor => (
                                        <React.Fragment key={`vendor-group-${vendor}`}>
                                            <tr style={{ background: 'rgba(0,0,0,0.2)', borderBottom: '2px solid rgba(255,255,255,0.05)' }}>
                                                <td colSpan={11} style={{ padding: 0 }}>
                                                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px' }}>
                                                        <div style={{ fontWeight: 700, color: '#f8fafc', fontSize: 13, textTransform: 'uppercase', letterSpacing: 1 }}>{vendor}</div>
                                                        <div style={{ display: 'flex', gap: 24, fontSize: 13, color: 'var(--muted)' }}>
                                                            <span>Monday Packs: <b style={{ color: '#3b82f6' }}>{fullGridVendorRollups[vendor].m}</b></span>
                                                            <span>Thursday Packs: <b style={{ color: '#8b5cf6' }}>{fullGridVendorRollups[vendor].t}</b></span>
                                                            <span>Restaurant Billing: <b style={{ color: '#ec4899' }}>${fullGridVendorRollups[vendor].r.toFixed(2)}</b></span>
                                                            <span>Vendor Payout: <b style={{ color: '#f59e0b' }}>${fullGridVendorRollups[vendor].p.toFixed(2)}</b></span>
                                                            <span>Commission: <b style={{ color: '#10b981' }}>${fullGridVendorRollups[vendor].c.toFixed(2)}</b></span>
                                                        </div>
                                                    </div>
                                                </td>
                                            </tr>
                                            {filteredAggregated.filter(a => a.vendorName === vendor || (!a.vendorName && vendor === 'Unknown Vendor')).map((a, idx) => (
                                                <React.Fragment key={`${vendor}-${idx}`}>
                                                    <tr style={{ background: expandedItems.has(a.itemName) ? 'rgba(255,255,255,0.02)' : 'transparent', borderBottom: expandedItems.has(a.itemName) ? 'none' : '1px solid var(--border)' }}>
                                                        <td style={{ textAlign: 'center' }}>
                                                            {a.branchDrilldownData.length > 0 && (
                                                                <button onClick={() => toggleExpand(a.itemName)} style={{ background: 'transparent', border: 'none', color: 'var(--muted)', cursor: 'pointer', padding: 4 }}>
                                                                    {expandedItems.has(a.itemName) ? '▼' : '▶'}
                                                                </button>
                                                            )}
                                                        </td>
                                                        <td style={{ fontWeight: 600 }}>
                                                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                                                {a.itemName}
                                                                {a.catalogSellPrice <= 0 && <span title="Missing Catalog Price" style={{ color: '#f43f5e', fontSize: 13 }}>⚠️</span>}
                                                            </div>
                                                            <div style={{ color: '#38bdf8', fontSize: 11, marginTop: 4, fontWeight: 500 }}>{a.vendorName}</div>
                                                        </td>
                                                        <td>
                                                            <span style={{ background: 'rgba(255,255,255,0.05)', padding: '4px 10px', borderRadius: 12, fontSize: 12, fontWeight: 500 }}>
                                                                {a.locationDisplayStr}
                                                            </span>
                                                        </td>
                                                        <td style={{ color: '#3b82f6', fontWeight: 600, background: 'rgba(77, 171, 247, 0.02)' }}>
                                                            {a.mondayQty > 0 ? a.mondayQty : '0'}
                                                        </td>
                                                        <td style={{ color: '#8b5cf6', fontWeight: 600, background: 'rgba(132, 94, 247, 0.02)' }}>
                                                            {a.thursdayQty > 0 ? a.thursdayQty : '0'}
                                                        </td>
                                                        <td style={{ fontSize: 13, color: '#f8fafc' }}>
                                                            {a.displayVendorPackStr}
                                                        </td>
                                                        <td>
                                                            {a.vendorPacks > 0 ? (
                                                                <span style={{ fontSize: 14, fontWeight: 700, color: '#f59e0b' }}>
                                                                    {a.vendorPacks}
                                                                </span>
                                                            ) : (
                                                                <span style={{ color: 'var(--muted)' }}>0</span>
                                                            )}
                                                        </td>
                                                        <td style={{ fontSize: 14, fontWeight: 600, color: 'var(--muted)' }}>
                                                            {a.catalogSellPrice > 0 ? (
                                                                <span>${a.catalogSellPrice.toFixed(2)}</span>
                                                            ) : (
                                                                <span style={{ fontSize: 12, color: '#f43f5e' }}>- TBD -</span>
                                                            )}
                                                        </td>
                                                        <td style={{ fontSize: 14, fontWeight: 600, color: '#ec4899' }}>
                                                            {a.catalogSellPrice > 0 ? (
                                                                <span>${a.restaurantBilling.toFixed(2)}</span>
                                                            ) : (
                                                                <span style={{ fontSize: 12, color: 'var(--muted)' }}>- TBD -</span>
                                                            )}
                                                        </td>
                                                        <td style={{ fontSize: 14, fontWeight: 600, color: '#f59e0b' }}>
                                                            {a.catalogSellPrice > 0 ? (
                                                                <span>${a.vendorPayout.toFixed(2)}</span>
                                                            ) : (
                                                                <span style={{ fontSize: 12, color: 'var(--muted)' }}>- TBD -</span>
                                                            )}
                                                        </td>
                                                        <td style={{ fontSize: 14, fontWeight: 700, color: '#10b981' }}>
                                                            {a.catalogSellPrice > 0 ? (
                                                                <span>${a.marketplaceCommission.toFixed(2)}</span>
                                                            ) : (
                                                                <span style={{ fontSize: 12, color: 'var(--muted)' }}>- TBD -</span>
                                                            )}
                                                        </td>
                                                    </tr>

                                                    {expandedItems.has(a.itemName) && a.branchDrilldownData.length > 0 && (
                                                        <tr style={{ borderTop: 'none', borderBottom: '1px solid var(--border)' }}>
                                                            <td colSpan={11} style={{ padding: 0 }}>
                                                                <div style={{ padding: '16px 40px 24px 64px', background: 'rgba(0,0,0,0.15)', boxShadow: 'inset 0 4px 6px rgba(0,0,0,0.2)' }}>
                                                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 12 }}>
                                                                        <h4 style={{ margin: 0, fontSize: 13, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 1 }}>Branch Order Breakdown</h4>
                                                                        <div style={{ fontSize: 12, color: 'var(--muted)' }}>Catalog Billed Unit Price: <b>${a.catalogSellPrice.toFixed(2)}</b></div>
                                                                    </div>
                                                                    <table style={{ width: '100%', borderCollapse: 'collapse', background: 'var(--bg-panel)', borderRadius: 8, overflow: 'hidden', border: '1px solid var(--border)' }}>
                                                                        <thead>
                                                                            <tr>
                                                                                <th style={{ padding: '12px 16px', textAlign: 'left', fontSize: 12, color: 'var(--muted)', borderBottom: '1px solid var(--border)', background: 'rgba(255,255,255,0.02)' }}>Restaurant</th>
                                                                                <th style={{ padding: '12px 16px', textAlign: 'left', fontSize: 12, color: '#3b82f6', borderBottom: '1px solid var(--border)', background: 'rgba(255,255,255,0.02)' }}>Mon Qty</th>
                                                                                <th style={{ padding: '12px 16px', textAlign: 'left', fontSize: 12, color: '#8b5cf6', borderBottom: '1px solid var(--border)', background: 'rgba(255,255,255,0.02)' }}>Thu Qty</th>
                                                                                <th style={{ padding: '12px 16px', textAlign: 'left', fontSize: 12, color: 'var(--text-primary)', borderBottom: '1px solid var(--border)', background: 'rgba(255,255,255,0.02)' }}>Total Ordered</th>
                                                                                <th style={{ padding: '12px 16px', textAlign: 'left', fontSize: 12, color: 'var(--muted)', borderBottom: '1px solid var(--border)', background: 'rgba(255,255,255,0.02)' }}>Order Status</th>
                                                                            </tr>
                                                                        </thead>
                                                                        <tbody>
                                                                            {a.branchDrilldownData.map((branch, bid) => (
                                                                                <tr key={bid}>
                                                                                    <td style={{ padding: '10px 16px', fontSize: 13, fontWeight: 500, borderBottom: '1px solid rgba(255,255,255,0.05)' }}>{branch.branchName}</td>
                                                                                    <td style={{ padding: '10px 16px', fontSize: 13, fontWeight: 600, color: '#3b82f6', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>{branch.mon}</td>
                                                                                    <td style={{ padding: '10px 16px', fontSize: 13, fontWeight: 600, color: '#8b5cf6', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>{branch.thu}</td>
                                                                                    <td style={{ padding: '10px 16px', fontSize: 13, fontWeight: 600, borderBottom: '1px solid rgba(255,255,255,0.05)' }}>{branch.total}</td>
                                                                                    <td style={{ padding: '10px 16px', borderBottom: '1px solid rgba(255,255,255,0.05)' }}><StatusDot status={branch.status} /></td>
                                                                                </tr>
                                                                            ))}
                                                                        </tbody>
                                                                    </table>
                                                                </div>
                                                            </td>
                                                        </tr>
                                                    )}
                                                </React.Fragment>
                                            ))}
                                        </React.Fragment>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}

                    {viewMode === 'picklist' && (
                        <div style={{ display: 'flex', gap: 24, paddingBottom: 64 }}>
                            {/* MONDAY PICK LIST */}
                            <div className="ui-card" style={{ flex: 1, padding: 0, overflow: 'hidden' }}>
                                <div style={{ padding: 16, background: 'rgba(59, 130, 246, 0.1)', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 12 }}>
                                    <div style={{ width: 12, height: 12, borderRadius: '50%', background: '#3b82f6' }}></div>
                                    <h3 style={{ margin: 0, color: '#3b82f6', fontSize: 18 }}>Monday Pick Route</h3>
                                </div>

                                {Object.keys(vendorRollups).map(vendor => {
                                    const monItems = vendorRollups[vendor].filter(i => i.monVendorPacks > 0);
                                    if (monItems.length === 0) return null;

                                    const subPacks = monItems.reduce((s, i) => s + i.monVendorPacks, 0);
                                    const subRestBilling = monItems.reduce((s, i) => s + (i.monVendorPacks * i.catalogSellPrice), 0);
                                    const subComm = subRestBilling * 0.10;
                                    const subVendorPayout = subRestBilling * 0.90;

                                    return (
                                        <div key={vendor} style={{ borderBottom: '1px solid var(--border)' }}>
                                            <div style={{ padding: '16px 16px 8px 16px', fontSize: 13, color: '#f8fafc', fontWeight: 700, textTransform: 'uppercase' }}>Vendor: {vendor}</div>
                                            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                                                <thead>
                                                    <tr>
                                                        <th style={{ textAlign: 'left', fontSize: 11, color: 'var(--muted)', padding: '0 16px 8px 16px' }}>Item</th>
                                                        <th style={{ textAlign: 'left', fontSize: 11, color: 'var(--muted)', padding: '0 16px 8px 16px' }}>Zone</th>
                                                        <th style={{ textAlign: 'center', fontSize: 11, color: 'var(--muted)', padding: '0 16px 8px 16px' }}>Qty</th>
                                                        <th style={{ width: 60, textAlign: 'center', fontSize: 11, color: 'var(--muted)', padding: '0 16px 8px 16px' }}>Status</th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {monItems.map((item, id) => (
                                                        <tr key={id} style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                                                            <td style={{ padding: '10px 16px', fontSize: 13, fontWeight: 500 }}>{item.itemName}</td>
                                                            <td style={{ padding: '10px 16px', fontSize: 12, color: 'var(--muted)' }}>
                                                                <span style={{ background: 'rgba(255,255,255,0.05)', padding: '3px 6px', borderRadius: 4 }}>{item.storageZone}</span>
                                                            </td>
                                                            <td style={{ padding: '10px 16px', textAlign: 'center', fontSize: 14, fontWeight: 700, color: '#3b82f6' }}>{item.monVendorPacks} <span style={{ fontSize: 11, fontWeight: 400 }}>{item.baseUnit}</span></td>
                                                            <td style={{ padding: '10px 16px', textAlign: 'center' }}>
                                                                <input type="checkbox" style={{ width: 18, height: 18, cursor: 'pointer' }} />
                                                            </td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                            <div style={{ background: 'rgba(255,255,255,0.02)', padding: '12px 16px', display: 'flex', justifyContent: 'space-between', fontSize: 13, color: 'var(--muted)' }}>
                                                <div>Subtotal Packs: <b style={{ color: '#f8fafc' }}>{subPacks}</b></div>
                                                <div style={{ display: 'flex', gap: 16 }}>
                                                    <span>Rest. Billing: <b style={{ color: '#ec4899' }}>${subRestBilling.toFixed(2)}</b></span>
                                                    <span>Vendor Payout: <b style={{ color: '#f59e0b' }}>${subVendorPayout.toFixed(2)}</b></span>
                                                    <span>Comm: <b style={{ color: '#10b981' }}>${subComm.toFixed(2)}</b></span>
                                                </div>
                                            </div>
                                        </div>
                                    )
                                })}
                            </div>

                            {/* THURSDAY PICK LIST */}
                            <div className="ui-card" style={{ flex: 1, padding: 0, overflow: 'hidden' }}>
                                <div style={{ padding: 16, background: 'rgba(139, 92, 246, 0.1)', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 12 }}>
                                    <div style={{ width: 12, height: 12, borderRadius: '50%', background: '#8b5cf6' }}></div>
                                    <h3 style={{ margin: 0, color: '#8b5cf6', fontSize: 18 }}>Thursday Pick Route</h3>
                                </div>

                                {Object.keys(vendorRollups).map(vendor => {
                                    const thuItems = vendorRollups[vendor].filter(i => i.thuVendorPacks > 0);
                                    if (thuItems.length === 0) return null;

                                    const subPacks = thuItems.reduce((s, i) => s + i.thuVendorPacks, 0);
                                    const subRestBilling = thuItems.reduce((s, i) => s + (i.thuVendorPacks * i.catalogSellPrice), 0);
                                    const subComm = subRestBilling * 0.10;
                                    const subVendorPayout = subRestBilling * 0.90;

                                    return (
                                        <div key={vendor} style={{ borderBottom: '1px solid var(--border)' }}>
                                            <div style={{ padding: '16px 16px 8px 16px', fontSize: 13, color: '#f8fafc', fontWeight: 700, textTransform: 'uppercase' }}>Vendor: {vendor}</div>
                                            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                                                <thead>
                                                    <tr>
                                                        <th style={{ textAlign: 'left', fontSize: 11, color: 'var(--muted)', padding: '0 16px 8px 16px' }}>Item</th>
                                                        <th style={{ textAlign: 'left', fontSize: 11, color: 'var(--muted)', padding: '0 16px 8px 16px' }}>Zone</th>
                                                        <th style={{ textAlign: 'center', fontSize: 11, color: 'var(--muted)', padding: '0 16px 8px 16px' }}>Qty</th>
                                                        <th style={{ width: 60, textAlign: 'center', fontSize: 11, color: 'var(--muted)', padding: '0 16px 8px 16px' }}>Status</th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {thuItems.map((item, id) => (
                                                        <tr key={id} style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                                                            <td style={{ padding: '10px 16px', fontSize: 13, fontWeight: 500 }}>{item.itemName}</td>
                                                            <td style={{ padding: '10px 16px', fontSize: 12, color: 'var(--muted)' }}>
                                                                <span style={{ background: 'rgba(255,255,255,0.05)', padding: '3px 6px', borderRadius: 4 }}>{item.storageZone}</span>
                                                            </td>
                                                            <td style={{ padding: '10px 16px', textAlign: 'center', fontSize: 14, fontWeight: 700, color: '#8b5cf6' }}>{item.thuVendorPacks} <span style={{ fontSize: 11, fontWeight: 400 }}>{item.baseUnit}</span></td>
                                                            <td style={{ padding: '10px 16px', textAlign: 'center' }}>
                                                                <input type="checkbox" style={{ width: 18, height: 18, cursor: 'pointer' }} />
                                                            </td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                            <div style={{ background: 'rgba(255,255,255,0.02)', padding: '12px 16px', display: 'flex', justifyContent: 'space-between', fontSize: 13, color: 'var(--muted)' }}>
                                                <div>Subtotal Packs: <b style={{ color: '#f8fafc' }}>{subPacks}</b></div>
                                                <div style={{ display: 'flex', gap: 16 }}>
                                                    <span>Rest. Billing: <b style={{ color: '#ec4899' }}>${subRestBilling.toFixed(2)}</b></span>
                                                    <span>Vendor Payout: <b style={{ color: '#f59e0b' }}>${subVendorPayout.toFixed(2)}</b></span>
                                                    <span>Comm: <b style={{ color: '#10b981' }}>${subComm.toFixed(2)}</b></span>
                                                </div>
                                            </div>
                                        </div>
                                    )
                                })}
                            </div>
                        </div>
                    )}
                </>
            )}
        </div>
    );
}
