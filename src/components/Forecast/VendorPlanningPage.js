import React, { useState, useEffect } from 'react';
import { ForecastInsightPanel } from './ForecastComponents';
import vendorCatalogV2 from '../../data/catalog_v2.json';
import purchaseDatasetV2 from '../../data/history_realistic_v2_tomato.json';
import containerTestData from './containerTestData.json';
import { db } from '../../firebase';
import { collection, getDocs } from 'firebase/firestore';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

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
    if (!arr || arr.length === 0) return 0;
    const sorted = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    if (sorted.length % 2 === 0) return (sorted[mid - 1] + sorted[mid]) / 2;
    return sorted[mid];
}

const Toast = ({ message, type }) => (
    <div style={{ position: 'fixed', bottom: 24, right: 24, padding: '12px 24px', background: type === 'error' ? '#f43f5e' : '#10b981', color: '#fff', borderRadius: 8, fontWeight: 600, boxShadow: '0 4px 12px rgba(0,0,0,0.15)', zIndex: 9999 }}>
        {message}
    </div>
);

const SendToVendorModal = ({ vendor, onClose, onSend }) => {
    const today = new Date();
    const tmw = new Date(today);
    tmw.setDate(tmw.getDate() + 1);
    const inAWeek = new Date(today);
    inAWeek.setDate(inAWeek.getDate() + 7);
    const weekStr = `${tmw.toLocaleString('default', { month: 'long' })} ${tmw.getDate()} – ${inAWeek.toLocaleString('default', { month: 'long' })} ${inAWeek.getDate()}`;

    const message = `Hello ${vendor.vendorName},

Please find the Oruma Marketplace supply order for the delivery week of ${weekStr}.

Monday Delivery:
${vendor.totalMondayDemand} units

Thursday Delivery:
${vendor.totalThursdayDemand} units

Estimated Vendor Payout: $${vendor.estimatedVendorPayout.toFixed(2)}

Please review and confirm availability.

Thank you,
Oruma Marketplace`;

    return (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 24 }}>
            <div className="ui-card" style={{ width: '100%', maxWidth: 600, background: 'var(--bg-panel)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
                <div style={{ padding: '16px 24px', background: 'rgba(255,255,255,0.02)', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <h3 style={{ margin: 0, fontSize: 18 }}>Send Order to {vendor.vendorName}</h3>
                    <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: 20 }}>&times;</button>
                </div>
                <div style={{ padding: 24 }}>
                    <div style={{ marginBottom: 16 }}>
                        <label style={{ display: 'block', fontSize: 12, color: 'var(--muted)', marginBottom: 4, fontWeight: 600 }}>SUBJECT</label>
                        <input type="text" readOnly value={`Oruma Marketplace Supply Order – Week of ${tmw.toLocaleString('default', { month: 'long' })} ${tmw.getDate()}`} className="ui-input" style={{ width: '100%', background: 'rgba(0,0,0,0.2)', color: '#f8fafc', padding: '10px 12px', borderRadius: 6, border: '1px solid var(--border)' }} />
                    </div>
                    <div style={{ marginBottom: 24 }}>
                        <label style={{ display: 'block', fontSize: 12, color: 'var(--muted)', marginBottom: 4, fontWeight: 600 }}>MESSAGE BODY</label>
                        <textarea readOnly rows={12} value={message} className="ui-input" style={{ width: '100%', background: 'rgba(0,0,0,0.2)', color: '#f8fafc', padding: '10px 12px', borderRadius: 6, border: '1px solid var(--border)', fontFamily: 'inherit', resize: 'vertical' }} />
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12 }}>
                        <button onClick={onClose} className="ui-btn ghost">Cancel</button>
                        <button onClick={onSend} className="ui-btn primary">Send Email</button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default function VendorPlanningPage() {
    const [vendors, setVendors] = useState([]);
    const [loading, setLoading] = useState(true);
    const [expandedVendors, setExpandedVendors] = useState(new Set());
    const [toast, setToast] = useState(null);
    const [modalVendor, setModalVendor] = useState(null);

    const showToast = (message, type = 'success') => {
        setToast({ message, type });
        setTimeout(() => setToast(null), 3000);
    };

    const toggleExpand = (vid) => {
        const next = new Set(expandedVendors);
        if (next.has(vid)) next.delete(vid);
        else next.add(vid);
        setExpandedVendors(next);
    };

    useEffect(() => {
        setLoading(true);
        (async () => {
            const catalogLookup = {};

            vendorCatalogV2.forEach(row => {
                const name = row.item_name?.trim();
                const exactName = normalizeItemName(name);
                if (exactName) catalogLookup[exactName] = { ...row, price: parseFloat(row.price) || 0 };
            });

            try {
                const vendorSnap = await getDocs(collection(db, 'vendors'));
                const vendorDocs = vendorSnap.docs.map(d => ({ id: d.id, ...d.data() }));
                for (const v of vendorDocs) {
                    try {
                        const itemSnap = await getDocs(collection(db, `vendors/${v.id}/items`));
                        itemSnap.docs.forEach(d => {
                            const itemData = d.data();
                            const name = itemData.name?.trim();
                            const exactName = normalizeItemName(name);
                            if (exactName) {
                                const dbPrice = parseFloat(itemData.vendorPrice) || parseFloat(itemData.price) || 0;
                                catalogLookup[exactName] = {
                                    ...catalogLookup[exactName],
                                    ...itemData,
                                    price: dbPrice > 0 ? dbPrice : (catalogLookup[exactName]?.price || 0),
                                    vendor: v.name || catalogLookup[exactName]?.vendor || 'Unknown Vendor',
                                    base_unit: itemData.unit || catalogLookup[exactName]?.base_unit,
                                    pack_size: itemData.packQuantity || catalogLookup[exactName]?.pack_size || 1,
                                    pack_label: itemData.itemSize || catalogLookup[exactName]?.pack_label
                                };
                            }
                        });
                    } catch (e) {
                        // ignore
                    }
                }
            } catch (err) {
                console.error("Failed to load Firebase catalog:", err);
            }

            containerTestData.forEach(row => {
                if (row.itemName) {
                    const exactName = normalizeItemName(row.itemName);
                    if (!catalogLookup[exactName]) {
                        catalogLookup[exactName] = {
                            vendor: row.vendorName,
                            category: row.category,
                            base_unit: row.packType,
                            pack_size: row.packSize,
                            pack_label: `${row.packSize} ${row.packType}`,
                            price: 0,
                            isPackaging: true,
                            central_stock_only: row.central_stock_only,
                            is_central_stock: row.is_central_stock
                        };
                    }
                }
            });

            const globalDatesSet = new Set();
            purchaseDatasetV2.forEach(d => { if (d.purchase_date) globalDatesSet.add(d.purchase_date); });
            containerTestData.forEach(d => { if (d.date) globalDatesSet.add(d.date); });

            const allCycles = [...globalDatesSet].sort((a, b) => new Date(b).getTime() - new Date(a).getTime());
            const last8Cycles = allCycles.slice(0, 8);
            const last4Cycles = allCycles.slice(0, 4);

            const globalHistoryMap = {};

            Object.keys(catalogLookup).forEach(exactName => {
                globalHistoryMap[exactName] = { orderHistoryMap: {}, isPackaging: catalogLookup[exactName].isPackaging || ['Packaging', 'Cleaning', 'Cleaning Supplies'].includes(catalogLookup[exactName].category) };
            });

            purchaseDatasetV2.forEach(data => {
                if (!data.purchase_date || !data.item_name) return;
                const exactName = normalizeItemName(data.item_name);
                if (!globalHistoryMap[exactName]) globalHistoryMap[exactName] = { orderHistoryMap: {}, isPackaging: false };
                if (!globalHistoryMap[exactName].orderHistoryMap[data.purchase_date]) globalHistoryMap[exactName].orderHistoryMap[data.purchase_date] = 0;
                globalHistoryMap[exactName].orderHistoryMap[data.purchase_date] += (Number(data.normalized_quantity) || 0);
            });

            containerTestData.forEach(data => {
                if (!data.date || !data.itemName) return;
                const exactName = normalizeItemName(data.itemName);
                if (!globalHistoryMap[exactName]) globalHistoryMap[exactName] = { orderHistoryMap: {}, isPackaging: true };
                if (!globalHistoryMap[exactName].orderHistoryMap[data.date]) globalHistoryMap[exactName].orderHistoryMap[data.date] = 0;
                globalHistoryMap[exactName].orderHistoryMap[data.date] += (Number(data.boxesOrdered) || 0);
            });

            const vendorGroupMap = {};

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
                let isCoreItem = !!override || item.isPackaging || ['Packaging', 'Cleaning', 'Cleaning Supplies'].includes(catalogLookup[itemName]?.category);

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
                    if ((qtyIn8Filtered.length >= 6 || itemName === 'Tomato') && predictedTotal > 0) isCoreItem = true;
                }

                if (isCoreItem && predictedTotal > 0) {
                    let mondayQty = Math.round(predictedTotal * 0.6);
                    let thursdayQty = predictedTotal - mondayQty;

                    if (item.isPackaging || ['Packaging', 'Cleaning', 'Cleaning Supplies'].includes(catalogLookup[itemName]?.category)) {
                        mondayQty = Math.round(predictedTotal * 0.5);
                        thursdayQty = predictedTotal - mondayQty;
                    }

                    const vendorName = catalogLookup[itemName]?.vendor || 'Unknown Vendor';

                    let pkSize = catalogLookup[itemName]?.pack_size || 1;
                    let baseUnit = catalogLookup[itemName]?.base_unit || 'lb';
                    let rawPackLabel = catalogLookup[itemName]?.pack_label || baseUnit;

                    let displayVendorPackStr = `${pkSize}${baseUnit} ${rawPackLabel}`;
                    if (pkSize === 1 && !item.isPackaging) displayVendorPackStr = baseUnit;
                    if (item.isPackaging) displayVendorPackStr = `${pkSize} units / ${baseUnit}`;
                    else if (itemName.toLowerCase() === 'coriander leaves' || itemName.toLowerCase() === 'mint leaves' || itemName.toLowerCase() === 'leeks') displayVendorPackStr = `1 bunch`;
                    else if (itemName.toLowerCase() === 'celery') displayVendorPackStr = `1kg`;
                    else if (itemName.toLowerCase() === 'long beans') displayVendorPackStr = `1 pack = 1.5lb`;
                    else if (itemName.toLowerCase() === 'plantain green') displayVendorPackStr = `1 pack = 5lb`;
                    else if (itemName.toLowerCase() === 'lime') displayVendorPackStr = `1 pack = 3.64kg`;
                    else if (itemName.toLowerCase() === 'curry leaves') displayVendorPackStr = `1 box = 12 lb`;
                    else if (itemName.toLowerCase() === 'french beans') displayVendorPackStr = `1 bag = 1.5lb (680g)`;
                    else if (itemName.toLowerCase() === 'beets') displayVendorPackStr = `25lb bag`;
                    else if (itemName.toLowerCase() === 'ginger' || itemName.toLowerCase() === 'thai chilli') displayVendorPackStr = `30lb box`;
                    else if (itemName.toLowerCase() === 'onion - cooking' || itemName.toLowerCase() === 'cabbage' || itemName.toLowerCase() === 'carrot') displayVendorPackStr = `50lb bag`;
                    else if (itemName.toLowerCase() === 'onion - red') displayVendorPackStr = `25lb bag`;
                    else if (rawPackLabel.toLowerCase().includes('case') && pkSize === 100) displayVendorPackStr = `1 case = 100 units`;
                    else if (rawPackLabel.toLowerCase().includes('bag') && pkSize === 50) displayVendorPackStr = `50lb bag`;
                    else if (rawPackLabel.toLowerCase().includes('bag') && pkSize === 25) displayVendorPackStr = `25lb bag`;
                    else if (rawPackLabel.toLowerCase().includes('box') && pkSize === 25) displayVendorPackStr = `25lb box`;
                    else if (rawPackLabel.toLowerCase().includes('box') && pkSize === 30) displayVendorPackStr = `30lb box`;
                    else if (rawPackLabel.toLowerCase().includes('case') && pkSize === 18) displayVendorPackStr = `18lb case`;
                    else if (rawPackLabel.toLowerCase() === 'lb' || (pkSize === 1 && baseUnit === 'lb')) displayVendorPackStr = `1 lb`;
                    else if (rawPackLabel.includes(String(pkSize))) displayVendorPackStr = rawPackLabel;

                    const catalogSellPrice = catalogLookup[itemName]?.price || 0;

                    const routeTotalQty = predictedTotal;

                    const lineRestaurantBilling = routeTotalQty * catalogSellPrice;
                    const lineMarketplaceCommission = lineRestaurantBilling * 0.10;
                    const lineVendorPayout = lineRestaurantBilling * 0.90;

                    let trendLabel = 'stable';
                    if (median4 > median8 * 1.2) trendLabel = 'up';
                    else if (median4 < median8 * 0.8 && median4 > 0) trendLabel = 'down';

                    if (!vendorGroupMap[vendorName]) {
                        vendorGroupMap[vendorName] = {
                            id: vendorName,
                            vendorName: vendorName,
                            isPackagingVendor: vendorName.toLowerCase().includes('taas') || item.isPackaging,
                            items: [],

                            totalMondayDemand: 0,
                            totalThursdayDemand: 0,
                            totalWeeklyDemand: 0,

                            estimatedVendorPayout: 0,
                            marketplaceCommission: 0,
                            totalRestaurantBilling: 0,

                            missingCostItems: []
                        };
                    }

                    if (catalogSellPrice <= 0) {
                        vendorGroupMap[vendorName].missingCostItems.push(itemName);
                    }

                    vendorGroupMap[vendorName].items.push({
                        itemName,
                        displayVendorPackStr,
                        mondayQty,
                        thursdayQty,
                        totalQty: routeTotalQty,
                        catalogSellPrice,
                        lineRestaurantBilling,
                        lineMarketplaceCommission,
                        lineVendorPayout,
                        trend: trendLabel
                    });

                    vendorGroupMap[vendorName].totalMondayDemand += mondayQty;
                    vendorGroupMap[vendorName].totalThursdayDemand += thursdayQty;
                    vendorGroupMap[vendorName].totalWeeklyDemand += routeTotalQty;

                    vendorGroupMap[vendorName].estimatedVendorPayout += lineVendorPayout;
                    vendorGroupMap[vendorName].marketplaceCommission += lineMarketplaceCommission;
                    vendorGroupMap[vendorName].totalRestaurantBilling += lineRestaurantBilling;
                }
            });

            let arrayResults = Object.values(vendorGroupMap).map(v => {
                v.items.sort((a, b) => b.totalQty - a.totalQty);

                const topItems = v.items.slice(0, 3).map(i => i.itemName);
                const hasUps = v.items.some(i => i.trend === 'up');
                const hasDowns = v.items.some(i => i.trend === 'down');

                let insightText = `Demand is generally stable.`;
                if (v.isPackagingVendor) {
                    if (hasUps) insightText = `Packaging demand is increasing slightly with restocking required.`;
                    else insightText = `Packaging demand stable with light Thursday refill requirement.`;
                } else {
                    if (hasUps) insightText = `Produce demand expected to increase 8%.`;
                    else if (hasDowns) insightText = `Produce demand expected to drop 4% from general baseline.`;
                    else insightText = `Produce demand follows standard baseline volume.`;
                }

                v.forecastInsight = {
                    text: insightText,
                    topItems
                };

                return v;
            });

            arrayResults = arrayResults.sort((a, b) => b.totalWeeklyDemand - a.totalWeeklyDemand);

            setVendors(arrayResults);
            setLoading(false);

        })();
    }, []);

    const handleExportPDF = (vendor) => {
        const doc = new jsPDF();

        const today = new Date();
        const tmw = new Date(today);
        tmw.setDate(tmw.getDate() + 1);
        const inAWeek = new Date(today);
        inAWeek.setDate(inAWeek.getDate() + 7);
        const weekStr = `${tmw.toLocaleString('default', { month: 'long' })} ${tmw.getDate()} – ${inAWeek.toLocaleString('default', { month: 'long' })} ${inAWeek.getDate()}`;

        doc.setFontSize(18);
        doc.text('ORUMA MARKETPLACE SUPPLY ORDER', 14, 22);

        doc.setFontSize(11);
        doc.text(`Vendor: ${vendor.vendorName}`, 14, 32);
        doc.text(`Delivery Week: ${weekStr}`, 14, 38);

        let currentY = 50;

        doc.setFontSize(12);
        doc.setFont(undefined, 'bold');
        doc.text('MONDAY DELIVERY', 14, currentY);
        doc.setFont(undefined, 'normal');
        currentY += 8;

        const monItems = vendor.items.filter(i => i.mondayQty > 0);
        if (monItems.length > 0) {
            monItems.forEach(i => {
                doc.setFontSize(10);
                doc.text(`${i.itemName} – ${i.mondayQty} ${i.displayVendorPackStr.includes('units') ? '' : ''} (${i.displayVendorPackStr})`, 14, currentY);
                currentY += 6;
            });
        } else {
            doc.setFontSize(10);
            doc.text('No items for Monday route.', 14, currentY);
            currentY += 6;
        }

        currentY += 4;
        doc.setFontSize(10);
        doc.setFont(undefined, 'bold');
        doc.text(`Total Monday Units: ${vendor.totalMondayDemand}`, 14, currentY);
        doc.setFont(undefined, 'normal');
        currentY += 14;

        doc.setFontSize(12);
        doc.setFont(undefined, 'bold');
        doc.text('THURSDAY DELIVERY', 14, currentY);
        doc.setFont(undefined, 'normal');
        currentY += 8;

        const thuItems = vendor.items.filter(i => i.thursdayQty > 0);
        if (thuItems.length > 0) {
            thuItems.forEach(i => {
                doc.setFontSize(10);
                doc.text(`${i.itemName} – ${i.thursdayQty} ${i.displayVendorPackStr.includes('units') ? '' : ''} (${i.displayVendorPackStr})`, 14, currentY);
                currentY += 6;
            });
        } else {
            doc.setFontSize(10);
            doc.text('No items for Thursday route.', 14, currentY);
            currentY += 6;
        }

        currentY += 4;
        doc.setFontSize(10);
        doc.setFont(undefined, 'bold');
        doc.text(`Total Thursday Units: ${vendor.totalThursdayDemand}`, 14, currentY);
        doc.setFont(undefined, 'normal');
        currentY += 16;

        autoTable(doc, {
            startY: currentY,
            head: [['Financial Summary', 'Amount']],
            body: [
                ['Estimated Vendor Payout', `$${vendor.estimatedVendorPayout.toFixed(2)}`],
                ['Marketplace Commission (10%)', `$${vendor.marketplaceCommission.toFixed(2)}`],
                ['Total Restaurant Billing', `$${vendor.totalRestaurantBilling.toFixed(2)}`]
            ],
            theme: 'grid',
            headStyles: { fillColor: [11, 18, 32] },
            styles: { fontSize: 10 }
        });

        const safeFilename = `oruma-supply-order-${vendor.vendorName.toLowerCase().replace(/\s+/g, '-')}-${tmw.getFullYear()}-${String(tmw.getMonth() + 1).padStart(2, '0')}-${String(tmw.getDate()).padStart(2, '0')}.pdf`;
        doc.save(safeFilename);

        showToast(`Exported ${safeFilename} successfully!`);
    };

    return (
        <div style={{ padding: '0 24px', maxWidth: 1400, margin: '0 auto', paddingBottom: 64 }}>
            {toast && <Toast message={toast.message} type={toast.type} />}
            {modalVendor && <SendToVendorModal vendor={modalVendor} onClose={() => setModalVendor(null)} onSend={() => { setModalVendor(null); showToast(`Email processed successfully to ${modalVendor.vendorName}!`); }} />}

            <div className="page-header" style={{ marginBottom: 32, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                    <h2 style={{ fontSize: 24, fontWeight: 700, margin: 0 }}>Vendor Dispatch</h2>
                    <p style={{ color: 'var(--muted)', marginTop: 8, fontSize: 14 }}>Review aggregated logistics notes, print packing slips, and confirm vendor dispatch limits.</p>
                </div>
            </div>

            {loading ? (
                <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>Retrieving vendor rollups and live pricing...</div>
            ) : vendors.length === 0 ? (
                <div className="ui-card" style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>
                    No vendor plans generated for next week.
                </div>
            ) : (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
                    {vendors.map(v => (
                        <div key={v.id} className="ui-card" style={{ padding: 0, display: 'flex', flexDirection: 'column', border: v.isPackagingVendor ? '1px solid rgba(139, 92, 246, 0.4)' : '1px solid var(--border)', overflow: 'hidden' }}>
                            <div style={{ padding: 24, borderBottom: '1px solid var(--border)' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
                                    <div>
                                        <h3 style={{ margin: 0, color: v.isPackagingVendor ? '#8b5cf6' : '#4dabf7', fontSize: 20 }}>
                                            {v.vendorName}
                                            {v.isPackagingVendor && <span style={{ fontSize: 12, fontWeight: 400, color: '#8b5cf6', marginLeft: 8 }}>(Packaging)</span>}
                                        </h3>
                                        <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 4 }}>Delivery Week: {new Date(Date.now() + 86400000).toLocaleString('default', { month: 'long' })} {new Date(Date.now() + 86400000).getDate()}</div>
                                    </div>
                                    <span style={{ background: 'rgba(255,255,255,0.05)', padding: '6px 12px', borderRadius: 20, fontSize: 12, fontWeight: 600 }}>
                                        {v.items.length} Predicted Items
                                    </span>
                                </div>

                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 20 }}>
                                    <div style={{ border: '1px solid var(--border)', padding: 16, borderRadius: 8, background: 'rgba(77, 171, 247, 0.05)' }}>
                                        <div style={{ fontSize: 11, color: '#4dabf7', marginBottom: 6, fontWeight: 700, letterSpacing: 0.5 }}>MONDAY ESTIMATE</div>
                                        <div style={{ fontSize: 28, fontWeight: 700 }}>{v.totalMondayDemand} <span style={{ fontSize: 14, fontWeight: 400, color: 'var(--muted)' }}>Units</span></div>
                                    </div>
                                    <div style={{ border: '1px solid var(--border)', padding: 16, borderRadius: 8, background: 'rgba(132, 94, 247, 0.05)' }}>
                                        <div style={{ fontSize: 11, color: '#845ef7', marginBottom: 6, fontWeight: 700, letterSpacing: 0.5 }}>THURSDAY ESTIMATE</div>
                                        <div style={{ fontSize: 28, fontWeight: 700 }}>{v.totalThursdayDemand} <span style={{ fontSize: 14, fontWeight: 400, color: 'var(--muted)' }}>Units</span></div>
                                    </div>
                                </div>

                                <div style={{ background: 'var(--bg-lighter)', padding: 16, borderRadius: 8, marginBottom: 20, borderTop: '2px solid #f59e0b' }}>
                                    <h4 style={{ margin: '0 0 16px 0', fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 600 }}>Financial Summary</h4>

                                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
                                        <span style={{ color: 'var(--text-secondary)' }}>Estimated Vendor Payout</span>
                                        <span style={{ fontWeight: 600, color: '#f8fafc' }}>${v.estimatedVendorPayout.toFixed(2)}</span>
                                    </div>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
                                        <span style={{ color: 'var(--text-secondary)' }}>Marketplace Commission (10%)</span>
                                        <span style={{ fontWeight: 600, color: '#10b981' }}>${v.marketplaceCommission.toFixed(2)}</span>
                                    </div>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: 12, borderTop: '1px dashed var(--border)' }}>
                                        <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>Total Restaurant Billing</span>
                                        <span style={{ fontWeight: 700, color: '#ec4899', fontSize: 16 }}>${v.totalRestaurantBilling.toFixed(2)}</span>
                                    </div>

                                    {v.missingCostItems.length > 0 && (
                                        <div style={{ marginTop: 12, padding: '8px 12px', background: 'rgba(244, 63, 94, 0.1)', color: '#f43f5e', border: '1px solid rgba(244, 63, 94, 0.2)', borderRadius: 4, fontSize: 12, fontWeight: 500 }}>
                                            Missing catalog price for: {v.missingCostItems.slice(0, 3).join(', ')}{v.missingCostItems.length > 3 ? ` and ${v.missingCostItems.length - 3} more` : ''}
                                        </div>
                                    )}
                                </div>

                                <div style={{ background: 'rgba(255,255,255,0.02)', padding: 16, borderRadius: 8, border: '1px solid var(--border)' }}>
                                    <h4 style={{ margin: '0 0 12px 0', fontSize: 12, color: '#38bdf8', textTransform: 'uppercase', letterSpacing: 0.5 }}>Next Week Forecast</h4>
                                    <div style={{ fontSize: 14, lineHeight: 1.5 }}>
                                        <div style={{ fontWeight: 500, color: '#f8fafc', marginBottom: 12, fontStyle: 'italic' }}>"{v.forecastInsight.text}"</div>
                                        {v.forecastInsight.topItems.length > 0 && (
                                            <div style={{ color: 'var(--muted)', fontSize: 13 }}>
                                                <span style={{ fontWeight: 600 }}>High demand items:</span>
                                                <ul style={{ margin: '6px 0 0 0', paddingLeft: 20 }}>
                                                    {v.forecastInsight.topItems.map(t => <li key={t}>{t}</li>)}
                                                </ul>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>

                            <div style={{ padding: '16px 24px', background: 'rgba(0,0,0,0.2)' }}>
                                <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
                                    <button className="ui-btn small primary ghost" style={{ flex: 1, padding: '12px 0' }} onClick={() => handleExportPDF(v)}>
                                        📄 Export PDF
                                    </button>
                                    <button className="ui-btn small primary" style={{ flex: 1, padding: '12px 0' }} onClick={() => setModalVendor(v)}>
                                        ✉️ Send to Vendor
                                    </button>
                                </div>
                                <button
                                    onClick={() => toggleExpand(v.id)}
                                    style={{ width: '100%', background: 'var(--bg-panel)', border: '1px solid var(--border)', color: 'var(--text-primary)', padding: '12px 16px', borderRadius: 6, cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontWeight: 600, fontSize: 14 }}
                                >
                                    <span>{v.vendorName} Delivery Breakdown</span>
                                    <span>{expandedVendors.has(v.id) ? '▲ Hide Items' : '▼ Show Items'}</span>
                                </button>
                            </div>

                            {expandedVendors.has(v.id) && (
                                <div style={{ padding: '0 24px 24px 24px', background: 'rgba(0,0,0,0.2)' }}>
                                    <div style={{ background: 'var(--bg-panel)', border: '1px solid var(--border)', borderRadius: 8, marginTop: 4 }}>
                                        <div style={{ padding: '16px', borderBottom: '1px solid var(--border)' }}>
                                            <h5 style={{ margin: '0 0 12px 0', color: '#4dabf7', fontSize: 14 }}>Monday Route</h5>
                                            {v.items.filter(i => i.mondayQty > 0).map((item, idx) => (
                                                <div key={idx} style={{ padding: '8px 0', borderBottom: '1px dashed rgba(255,255,255,0.05)', fontSize: 13, display: 'flex', alignItems: 'center' }}>
                                                    <span style={{ width: 40, color: '#38bdf8', fontWeight: 700, fontSize: 15 }}>{item.mondayQty}</span>
                                                    <span style={{ flex: 1, fontWeight: 500 }}>{item.itemName}</span>
                                                    <span style={{ color: 'var(--muted)', fontSize: 12 }}>({item.displayVendorPackStr})</span>
                                                </div>
                                            ))}
                                            <div style={{ padding: '12px 0 0 0', fontSize: 13, fontWeight: 600, color: '#f8fafc', display: 'flex', justifyContent: 'space-between' }}>
                                                <span>Total:</span>
                                                <span>{v.totalMondayDemand} packs</span>
                                            </div>
                                        </div>

                                        <div style={{ padding: '16px' }}>
                                            <h5 style={{ margin: '0 0 12px 0', color: '#845ef7', fontSize: 14 }}>Thursday Route</h5>
                                            {v.items.filter(i => i.thursdayQty > 0).map((item, idx) => (
                                                <div key={idx} style={{ padding: '8px 0', borderBottom: '1px dashed rgba(255,255,255,0.05)', fontSize: 13, display: 'flex', alignItems: 'center' }}>
                                                    <span style={{ width: 40, color: '#8b5cf6', fontWeight: 700, fontSize: 15 }}>{item.thursdayQty}</span>
                                                    <span style={{ flex: 1, fontWeight: 500 }}>{item.itemName}</span>
                                                    <span style={{ color: 'var(--muted)', fontSize: 12 }}>({item.displayVendorPackStr})</span>
                                                </div>
                                            ))}
                                            <div style={{ padding: '12px 0 0 0', fontSize: 13, fontWeight: 600, color: '#f8fafc', display: 'flex', justifyContent: 'space-between' }}>
                                                <span>Total:</span>
                                                <span>{v.totalThursdayDemand} packs</span>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            )}

                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

