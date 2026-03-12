import React, { useState, useEffect, useRef } from 'react';
import { ForecastInsightPanel } from './ForecastComponents';
import { db } from '../../firebase';
import { collection, getDocs, onSnapshot, doc, setDoc } from 'firebase/firestore';
import { getActiveWeekStart, formatWeekLabel } from './dispatchModel';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

const Toast = ({ message, type }) => (
    <div style={{ position: 'fixed', bottom: 24, right: 24, padding: '12px 24px', background: type === 'error' ? '#f43f5e' : '#10b981', color: '#fff', borderRadius: 8, fontWeight: 600, boxShadow: '0 4px 12px rgba(0,0,0,0.15)', zIndex: 9999 }}>
        {message}
    </div>
);

export default function VendorPlanningPage() {
    const [vendors, setVendors] = useState([]);
    const [loading, setLoading] = useState(true);
    const [expandedVendors, setExpandedVendors] = useState(new Set());
    const [toast, setToast] = useState(null);

    // Week filter
    const [activeWeek, setActiveWeek] = useState(() => getActiveWeekStart());

    const showToast = (message, type = 'success') => {
        setToast({ message, type });
        setTimeout(() => setToast(null), 3000);
    };

    const shiftWeek = (delta) => {
        const d = new Date(activeWeek);
        d.setDate(d.getDate() + delta * 7);
        setActiveWeek(d.toISOString().slice(0, 10));
    };

    const handleSendDayDispatch = async (vendor, day) => {
        // Optimistic update
        setVendors(prev => prev.map(v => {
            if (v.vendorId !== vendor.vendorId) return v;
            return {
                ...v,
                mondaySent: day === 'Monday' ? true : v.mondaySent,
                thuSent: day === 'Thursday' ? true : v.thuSent
            };
        }));

        const today = new Date();
        const tmw = new Date(today);
        tmw.setDate(tmw.getDate() + 1);
        const inAWeek = new Date(today);
        inAWeek.setDate(inAWeek.getDate() + 7);

        const dispatchId = `disp_${vendor.vendorId}_${tmw.getFullYear()}_${tmw.getMonth()}_${tmw.getDate()}`;
        const docRef = doc(collection(db, 'vendorDispatches'), dispatchId);

        const itemsPayload = vendor.items.map(i => ({
            itemId: i.itemName.toLowerCase().replace(/\s+/g, '-'),
            itemName: i.itemName,
            mondayQty: i.mondayQty,
            thursdayQty: i.thursdayQty,
            packLabel: i.displayVendorPackStr,
            catalogSellPrice: i.catalogSellPrice || 0,
            lineMarketplaceCommission: i.lineMarketplaceCommission || 0,
            lineVendorPayout: i.lineVendorPayout || 0,
            lineRestaurantBilling: i.lineRestaurantBilling || 0
        }));

        const basePayload = {
            dispatchId,
            vendorId: vendor.vendorId,
            vendorName: vendor.vendorName,
            weekStart: tmw.toISOString(),
            weekEnd: inAWeek.toISOString(),
            restaurantId: 'marketplace_network',
            restaurantName: 'Marketplace Network',
            status: 'Sent',
            mondayTotalPacks: vendor.totalMondayDemand,
            thursdayTotalPacks: vendor.totalThursdayDemand,
            restaurantBilling: vendor.totalRestaurantBilling,
            vendorPayout: vendor.estimatedVendorPayout,
            marketplaceCommission: vendor.marketplaceCommission,
            sentAt: new Date(),
            confirmedAt: null,
            deliveredAt: null,
            updatedAt: new Date(),
            mondayDelivered: false,
            thursdayDelivered: false,
            mondaySent: false,
            thursdaySent: false,
            confirmationNotes: '',
            rejectionReason: '',
            partialReason: '',
            items: itemsPayload
        };

        const dayField = day === 'Monday' ? 'mondaySent' : 'thursdaySent';
        const sentAtField = day === 'Monday' ? 'mondaySentAt' : 'thursdaySentAt';

        try {
            await setDoc(docRef, { ...basePayload, [dayField]: true, [sentAtField]: new Date() }, { merge: true });
            showToast(`${day} order sent to ${vendor.vendorName}!`);
        } catch (err) {
            console.error('Error sending dispatch:', err);
            showToast(`Failed to send ${day} order.`, 'error');
        }
    };

    const toggleExpand = (vid) => {
        const next = new Set(expandedVendors);
        if (next.has(vid)) next.delete(vid);
        else next.add(vid);
        setExpandedVendors(next);
    };

    // Persist the latest dispatch status map so fetchData can apply it after loading
    const liveDispatchRef = useRef({});

    useEffect(() => {
        // Live listener: subscribe to vendorDispatches and immediately patch vendor states
        const unsubscribe = onSnapshot(collection(db, 'vendorDispatches'), (snapshot) => {
            const freshMap = {};
            const STATUS_PRIORITY = { 'Delivered': 5, 'Partially Confirmed': 4, 'Confirmed': 3, 'Sent': 2 };
            snapshot.docs.forEach(d => {
                const data = d.data();
                const recordTime = data.updatedAt?.toMillis ? data.updatedAt.toMillis() : (data.sentAt?.toMillis ? data.sentAt.toMillis() : 0);
                const newPriority = STATUS_PRIORITY[data.status] || 1;
                const existing = freshMap[data.vendorId];
                const existingPriority = existing ? (STATUS_PRIORITY[existing.status] || 1) : 0;
                if (!existing || newPriority > existingPriority || (newPriority === existingPriority && recordTime > existing.recordTime)) {
                    freshMap[data.vendorId] = {
                        status: data.status,
                        monDelivered: !!data.mondayDelivered,
                        thuDelivered: !!data.thursdayDelivered,
                        mondaySent: !!data.mondaySent,
                        thuSent: !!data.thursdaySent,
                        recordTime
                    };
                }
            });
            liveDispatchRef.current = freshMap;
            setVendors(prev => {
                if (!prev.length) return prev;
                return prev.map(v => {
                    const live = freshMap[v.vendorId];
                    if (!live) return v;
                    return { ...v, dispatchStatus: live.status, monDelivered: live.monDelivered, thuDelivered: live.thuDelivered, mondaySent: live.mondaySent, thuSent: live.thuSent };
                });
            });
        });
        return () => unsubscribe();
    }, []);

    // ── Main data load: catalog + submittedOrders ────────────────────────────
    useEffect(() => {
        setLoading(true);
        (async () => {
            const catalogLookup = {};
            const localVendorIdMap = {};

            // 1. Build catalog from vendors + vendor items
            try {
                const vendorSnap = await getDocs(collection(db, 'vendors'));
                const vendorDocs = vendorSnap.docs.map(d => ({ id: d.id, ...d.data() }));
                for (const v of vendorDocs) {
                    localVendorIdMap[v.name] = v.id;
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
                        // ignore
                    }
                }
            } catch (err) {
                console.error("Failed to load Firebase catalog:", err);
            }

            // 2. Load submittedOrders and filter to active week
            let weekOrders = [];
            try {
                const soSnap = await getDocs(collection(db, 'submittedOrders'));
                const allOrders = soSnap.docs.map(d => ({ id: d.id, ...d.data() }));
                weekOrders = allOrders.filter(o => o.weekStart === activeWeek);
                console.log(`[VendorPlanning] ${weekOrders.length} submitted orders for week ${activeWeek}`);
            } catch (err) {
                console.error('[VendorPlanning] Failed to fetch submitted orders:', err);
            }

            // 3. Aggregate item lines by item, then group by vendor
            const itemAgg = {}; // itemName → { mondayQty, thursdayQty, restaurants[] }

            weekOrders.forEach(order => {
                const deliveryDay = order.deliveryDay || 'Monday';
                const restName = order.restaurantName || order.restaurantId || 'unknown';

                (order.items || []).forEach(line => {
                    const itemName = line.itemName;
                    if (!itemName) return;
                    const qty = Number(line.finalQty) || 0;
                    if (qty <= 0) return;

                    if (!itemAgg[itemName]) {
                        itemAgg[itemName] = { mondayQty: 0, thursdayQty: 0, category: line.category || '', restaurants: new Set() };
                    }

                    if (deliveryDay === 'Monday') {
                        itemAgg[itemName].mondayQty += qty;
                    } else {
                        itemAgg[itemName].thursdayQty += qty;
                    }
                    itemAgg[itemName].restaurants.add(restName);
                });
            });

            // 4. Group by vendor using catalog enrichment
            const vendorGroupMap = {};

            Object.keys(itemAgg).forEach(itemName => {
                const item = itemAgg[itemName];
                const totalQty = item.mondayQty + item.thursdayQty;
                if (totalQty <= 0) return;

                const catEntry = catalogLookup[itemName] || {};
                const vendorName = catEntry.vendor || 'Unknown Vendor';
                const category = item.category || catEntry.category || 'Produce';
                const isPackaging = catEntry.isPackaging || ['Packaging', 'Cleaning', 'Cleaning Supplies'].includes(category);
                const catalogSellPrice = catEntry.price || 0;

                let pkSize = catEntry.pack_size || 1;
                let baseUnit = catEntry.base_unit || 'lb';
                let rawPackLabel = catEntry.pack_label || baseUnit;

                // Vendor pack display string logic (same as before)
                let displayVendorPackStr = `${pkSize}${baseUnit} ${rawPackLabel}`;
                if (pkSize === 1 && !isPackaging) displayVendorPackStr = baseUnit;
                if (isPackaging) displayVendorPackStr = `${pkSize} units / ${baseUnit}`;
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

                const lineRestaurantBilling = totalQty * catalogSellPrice;
                const lineMarketplaceCommission = lineRestaurantBilling * 0.10;
                const lineVendorPayout = lineRestaurantBilling * 0.90;

                const resolvedVendorId = localVendorIdMap[vendorName] || vendorName.toLowerCase().replace(/\s+/g, '-');

                if (!vendorGroupMap[vendorName]) {
                    vendorGroupMap[vendorName] = {
                        id: vendorName,
                        vendorId: resolvedVendorId,
                        vendorName: vendorName,
                        dispatchStatus: null,
                        monDelivered: false,
                        thuDelivered: false,
                        isPackagingVendor: vendorName.toLowerCase().includes('taas') || isPackaging,
                        items: [],
                        totalMondayDemand: 0,
                        totalThursdayDemand: 0,
                        totalWeeklyDemand: 0,
                        estimatedVendorPayout: 0,
                        marketplaceCommission: 0,
                        totalRestaurantBilling: 0,
                        missingCostItems: [],
                        orderingRestaurants: new Set()
                    };
                }

                if (catalogSellPrice <= 0) {
                    vendorGroupMap[vendorName].missingCostItems.push(itemName);
                }

                // Merge restaurant sets
                item.restaurants.forEach(r => vendorGroupMap[vendorName].orderingRestaurants.add(r));

                vendorGroupMap[vendorName].items.push({
                    itemName,
                    displayVendorPackStr,
                    mondayQty: item.mondayQty,
                    thursdayQty: item.thursdayQty,
                    totalQty,
                    catalogSellPrice,
                    lineRestaurantBilling,
                    lineMarketplaceCommission,
                    lineVendorPayout,
                });

                vendorGroupMap[vendorName].totalMondayDemand += item.mondayQty;
                vendorGroupMap[vendorName].totalThursdayDemand += item.thursdayQty;
                vendorGroupMap[vendorName].totalWeeklyDemand += totalQty;
                vendorGroupMap[vendorName].estimatedVendorPayout += lineVendorPayout;
                vendorGroupMap[vendorName].marketplaceCommission += lineMarketplaceCommission;
                vendorGroupMap[vendorName].totalRestaurantBilling += lineRestaurantBilling;
            });

            let arrayResults = Object.values(vendorGroupMap).map(v => {
                v.items.sort((a, b) => b.totalQty - a.totalQty);
                const topItems = v.items.slice(0, 3).map(i => i.itemName);
                const restCount = v.orderingRestaurants.size;

                v.forecastInsight = {
                    text: `${restCount} restaurant${restCount !== 1 ? 's' : ''} submitted orders — ${v.items.length} line items, ${v.totalWeeklyDemand} total packs.`,
                    topItems
                };

                return v;
            });

            arrayResults = arrayResults.sort((a, b) => b.totalWeeklyDemand - a.totalWeeklyDemand);

            // Apply live dispatch flags
            const liveMap = liveDispatchRef.current;
            arrayResults = arrayResults.map(v => {
                const live = liveMap[v.vendorId];
                if (!live) return v;
                return { ...v, dispatchStatus: live.status, monDelivered: live.monDelivered, thuDelivered: live.thuDelivered, mondaySent: live.mondaySent, thuSent: live.thuSent };
            });

            setVendors(arrayResults);
            setLoading(false);
        })();
    }, [activeWeek]);

    const handleExportPDF = (vendor) => {
        const pdfDoc = new jsPDF();

        const today = new Date();
        const tmw = new Date(today);
        tmw.setDate(tmw.getDate() + 1);
        const inAWeek = new Date(today);
        inAWeek.setDate(inAWeek.getDate() + 7);
        const weekStr = `${tmw.toLocaleString('default', { month: 'long' })} ${tmw.getDate()} – ${inAWeek.toLocaleString('default', { month: 'long' })} ${inAWeek.getDate()}`;

        pdfDoc.setFontSize(18);
        pdfDoc.text('MARKETPLACE SUPPLY ORDER', 14, 22);

        pdfDoc.setFontSize(11);
        pdfDoc.text(`Vendor: ${vendor.vendorName}`, 14, 32);
        pdfDoc.text(`Delivery Week: ${weekStr}`, 14, 38);

        let currentY = 50;

        pdfDoc.setFontSize(12);
        pdfDoc.setFont(undefined, 'bold');
        pdfDoc.text('MONDAY DELIVERY', 14, currentY);
        pdfDoc.setFont(undefined, 'normal');
        currentY += 8;

        const monItems = vendor.items.filter(i => i.mondayQty > 0);
        if (monItems.length > 0) {
            monItems.forEach(i => {
                pdfDoc.setFontSize(10);
                pdfDoc.text(`${i.itemName} – ${i.mondayQty} (${i.displayVendorPackStr})`, 14, currentY);
                currentY += 6;
            });
        } else {
            pdfDoc.setFontSize(10);
            pdfDoc.text('No items for Monday route.', 14, currentY);
            currentY += 6;
        }

        currentY += 4;
        pdfDoc.setFontSize(10);
        pdfDoc.setFont(undefined, 'bold');
        pdfDoc.text(`Total Monday Units: ${vendor.totalMondayDemand}`, 14, currentY);
        pdfDoc.setFont(undefined, 'normal');
        currentY += 14;

        pdfDoc.setFontSize(12);
        pdfDoc.setFont(undefined, 'bold');
        pdfDoc.text('THURSDAY DELIVERY', 14, currentY);
        pdfDoc.setFont(undefined, 'normal');
        currentY += 8;

        const thuItems = vendor.items.filter(i => i.thursdayQty > 0);
        if (thuItems.length > 0) {
            thuItems.forEach(i => {
                pdfDoc.setFontSize(10);
                pdfDoc.text(`${i.itemName} – ${i.thursdayQty} (${i.displayVendorPackStr})`, 14, currentY);
                currentY += 6;
            });
        } else {
            pdfDoc.setFontSize(10);
            pdfDoc.text('No items for Thursday route.', 14, currentY);
            currentY += 6;
        }

        currentY += 4;
        pdfDoc.setFontSize(10);
        pdfDoc.setFont(undefined, 'bold');
        pdfDoc.text(`Total Thursday Units: ${vendor.totalThursdayDemand}`, 14, currentY);
        pdfDoc.setFont(undefined, 'normal');
        currentY += 16;

        autoTable(pdfDoc, {
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

        const safeFilename = `marketplace-supply-order-${vendor.vendorName.toLowerCase().replace(/\s+/g, '-')}-${tmw.getFullYear()}-${String(tmw.getMonth() + 1).padStart(2, '0')}-${String(tmw.getDate()).padStart(2, '0')}.pdf`;
        pdfDoc.save(safeFilename);

        showToast(`Exported ${safeFilename} successfully!`);
    };

    const activeWeekLabel = formatWeekLabel(activeWeek);

    return (
        <div style={{ padding: '0 24px', maxWidth: 1400, margin: '0 auto', paddingBottom: 64 }}>
            {toast && <Toast message={toast.message} type={toast.type} />}

            <div className="page-header" style={{ marginBottom: 32, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 4 }}>
                        <h2 style={{ fontSize: 24, fontWeight: 700, margin: 0 }}>Vendor Dispatch</h2>
                        <span style={{
                            background: 'linear-gradient(135deg, #10b981, #059669)',
                            color: '#fff', padding: '4px 12px', borderRadius: 20,
                            fontSize: 11, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase'
                        }}>
                            Actual Orders
                        </span>
                    </div>
                    <p style={{ color: 'var(--muted)', marginTop: 8, fontSize: 14 }}>Dispatch actual restaurant-submitted orders to vendors — review, send, and track delivery.</p>
                </div>

                {/* Week Navigator */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--bg-panel)', padding: '6px 12px', borderRadius: 8, border: '1px solid var(--border)' }}>
                    <button onClick={() => shiftWeek(-1)} style={{ background: 'transparent', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: 16, padding: '2px 6px' }}>◀</button>
                    <div style={{ textAlign: 'center', minWidth: 160 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: '#f8fafc' }}>{activeWeekLabel}</div>
                        <div style={{ fontSize: 10, color: 'var(--muted)' }}>
                            {activeWeek === getActiveWeekStart() ? 'Current Week' : activeWeek}
                        </div>
                    </div>
                    <button onClick={() => shiftWeek(1)} style={{ background: 'transparent', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: 16, padding: '2px 6px' }}>▶</button>
                </div>
            </div>

            {loading ? (
                <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>Loading submitted orders for vendor dispatch...</div>
            ) : vendors.length === 0 ? (
                <div className="ui-card" style={{ padding: '60px 32px', textAlign: 'center' }}>
                    <div style={{ fontSize: 48, marginBottom: 16, opacity: 0.6 }}>📭</div>
                    <h3 style={{ margin: '0 0 8px 0', fontSize: 18, fontWeight: 700, color: '#e2e8f0' }}>No Orders to Dispatch</h3>
                    <p style={{ margin: 0, color: 'var(--muted)', fontSize: 14, maxWidth: 480, marginLeft: 'auto', marginRight: 'auto' }}>
                        No restaurants have submitted orders for <b>{activeWeekLabel}</b>. Once restaurants submit their final orders, vendor dispatch cards will appear here.
                    </p>
                </div>
            ) : (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
                    {vendors.map(v => (
                        <div key={v.id} className="ui-card" style={{ padding: 0, display: 'flex', flexDirection: 'column', border: v.isPackagingVendor ? '1px solid rgba(139, 92, 246, 0.4)' : '1px solid var(--border)', overflow: 'hidden' }}>
                            <div style={{ padding: 24, borderBottom: '1px solid var(--border)' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
                                    <div>
                                        <h3 style={{ margin: 0, color: v.isPackagingVendor ? '#8b5cf6' : '#4dabf7', fontSize: 20, display: 'flex', alignItems: 'center', gap: 12 }}>
                                            {v.vendorName}
                                            {v.isPackagingVendor && <span style={{ fontSize: 12, fontWeight: 400, color: '#8b5cf6' }}>(Packaging)</span>}
                                            {v.dispatchStatus && (
                                                <span style={{
                                                    fontSize: 11, fontWeight: 700, padding: '4px 8px', borderRadius: 4, textTransform: 'uppercase',
                                                    background: v.dispatchStatus === 'Delivered' || v.dispatchStatus === 'Confirmed' ? 'rgba(16, 185, 129, 0.15)' :
                                                        v.dispatchStatus === 'Rejected' ? 'rgba(244, 63, 94, 0.15)' :
                                                            v.dispatchStatus === 'Partially Confirmed' ? 'rgba(245, 158, 11, 0.15)' : 'rgba(56, 189, 248, 0.15)',
                                                    color: v.dispatchStatus === 'Delivered' || v.dispatchStatus === 'Confirmed' ? '#10b981' :
                                                        v.dispatchStatus === 'Rejected' ? '#f43f5e' :
                                                            v.dispatchStatus === 'Partially Confirmed' ? '#f59e0b' : '#38bdf8'
                                                }}>
                                                    {v.dispatchStatus}
                                                </span>
                                            )}
                                        </h3>
                                        <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 4 }}>Week: {activeWeekLabel}</div>
                                    </div>
                                    <span style={{ background: 'rgba(255,255,255,0.05)', padding: '6px 12px', borderRadius: 20, fontSize: 12, fontWeight: 600 }}>
                                        {v.items.length} Ordered Items
                                    </span>
                                </div>

                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 20 }}>
                                    <div style={{ border: '1px solid var(--border)', padding: 16, borderRadius: 8, background: 'rgba(77, 171, 247, 0.05)', position: 'relative' }}>
                                        <div style={{ fontSize: 11, color: '#4dabf7', marginBottom: 6, fontWeight: 700, letterSpacing: 0.5 }}>MONDAY TOTAL</div>
                                        <div style={{ fontSize: 28, fontWeight: 700, color: v.monDelivered ? '#10b981' : '#f8fafc' }}>
                                            {v.totalMondayDemand} <span style={{ fontSize: 14, fontWeight: 400, color: v.monDelivered ? '#10b981' : 'var(--muted)' }}>Units</span>
                                        </div>
                                        {v.monDelivered && <span style={{ position: 'absolute', top: 12, right: 12, fontSize: 11, background: 'rgba(16, 185, 129, 0.2)', color: '#10b981', padding: '2px 8px', borderRadius: 6, fontWeight: 700 }}>✓ DONE</span>}
                                    </div>
                                    <div style={{ border: '1px solid var(--border)', padding: 16, borderRadius: 8, background: 'rgba(132, 94, 247, 0.05)', position: 'relative' }}>
                                        <div style={{ fontSize: 11, color: '#845ef7', marginBottom: 6, fontWeight: 700, letterSpacing: 0.5 }}>THURSDAY TOTAL</div>
                                        <div style={{ fontSize: 28, fontWeight: 700, color: v.thuDelivered ? '#10b981' : '#f8fafc' }}>
                                            {v.totalThursdayDemand} <span style={{ fontSize: 14, fontWeight: 400, color: v.thuDelivered ? '#10b981' : 'var(--muted)' }}>Units</span>
                                        </div>
                                        {v.thuDelivered && <span style={{ position: 'absolute', top: 12, right: 12, fontSize: 11, background: 'rgba(16, 185, 129, 0.2)', color: '#10b981', padding: '2px 8px', borderRadius: 6, fontWeight: 700 }}>✓ DONE</span>}
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
                                    <h4 style={{ margin: '0 0 12px 0', fontSize: 12, color: '#38bdf8', textTransform: 'uppercase', letterSpacing: 0.5 }}>Order Summary</h4>
                                    <div style={{ fontSize: 14, lineHeight: 1.5 }}>
                                        <div style={{ fontWeight: 500, color: '#f8fafc', marginBottom: 12 }}>"{v.forecastInsight.text}"</div>
                                        {v.forecastInsight.topItems.length > 0 && (
                                            <div style={{ color: 'var(--muted)', fontSize: 13 }}>
                                                <span style={{ fontWeight: 600 }}>Top demand items:</span>
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
                                    {/* Send Monday */}
                                    <button
                                        className="ui-btn small"
                                        style={{
                                            flex: 1, padding: '12px 0',
                                            background: v.mondaySent ? 'rgba(16,185,129,0.1)' : 'rgba(77, 171, 247, 0.15)',
                                            color: v.mondaySent ? '#10b981' : '#4dabf7',
                                            border: `1px solid ${v.mondaySent ? 'rgba(16,185,129,0.3)' : 'rgba(77,171,247,0.3)'}`,
                                            cursor: v.mondaySent ? 'not-allowed' : 'pointer',
                                            fontWeight: 600,
                                            opacity: v.mondaySent ? 0.8 : 1
                                        }}
                                        disabled={v.mondaySent}
                                        onClick={() => handleSendDayDispatch(v, 'Monday')}
                                    >
                                        {v.mondaySent ? '✓ Mon Sent' : '📤 Send Monday'}
                                    </button>
                                    {/* Send Thursday */}
                                    <button
                                        className="ui-btn small"
                                        style={{
                                            flex: 1, padding: '12px 0',
                                            background: v.thuSent ? 'rgba(16,185,129,0.1)' : 'rgba(132, 94, 247, 0.15)',
                                            color: v.thuSent ? '#10b981' : '#845ef7',
                                            border: `1px solid ${v.thuSent ? 'rgba(16,185,129,0.3)' : 'rgba(132,94,247,0.3)'}`,
                                            cursor: v.thuSent ? 'not-allowed' : 'pointer',
                                            fontWeight: 600,
                                            opacity: v.thuSent ? 0.8 : 1
                                        }}
                                        disabled={v.thuSent}
                                        onClick={() => handleSendDayDispatch(v, 'Thursday')}
                                    >
                                        {v.thuSent ? '✓ Thu Sent' : '📤 Send Thursday'}
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
