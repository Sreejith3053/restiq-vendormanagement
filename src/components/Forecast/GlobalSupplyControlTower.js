import React, { useState, useEffect, useRef } from 'react';
import { db } from '../../firebase';
import { collection, query, getDocs, onSnapshot, doc, setDoc } from 'firebase/firestore';
import { getActiveWeekStart, getWeekEnd, formatWeekLabel, isInWeek, sendVendorDispatch } from './dispatchModel';
import { fetchOrderHistory, fetchCorrectionHistory } from './forecastHelpers';
import CombinedDemandPage from './CombinedDemandPage';

// Import Icons from react-icons
import { FiRefreshCw, FiDownload, FiAlertCircle, FiTrendingUp, FiTrendingDown, FiActivity, FiBox, FiDollarSign } from 'react-icons/fi';

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
    const [isSubmitting, setIsSubmitting] = useState(false);
    const today = new Date();
    const tmw = new Date(today);
    tmw.setDate(tmw.getDate() + 1);
    const inAWeek = new Date(today);
    inAWeek.setDate(inAWeek.getDate() + 7);
    const weekStr = `${tmw.toLocaleString('default', { month: 'long' })} ${tmw.getDate()} – ${inAWeek.toLocaleString('default', { month: 'long' })} ${inAWeek.getDate()}`;

    const message = `Hello ${vendor.name},

Please find the Marketplace supply order for the delivery week of ${weekStr}.

Monday Delivery:
${vendor.mon} units

Thursday Delivery:
${vendor.thu} units

Estimated Vendor Payout: $${vendor.pay.toFixed(2)}

Please review and confirm availability.

Thank you,
Marketplace`;

    return (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 24 }}>
            <div className="ui-card" style={{ width: '100%', maxWidth: 600, background: 'var(--bg-panel)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
                <div style={{ padding: '16px 24px', background: 'rgba(255,255,255,0.02)', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <h3 style={{ margin: 0, fontSize: 18 }}>Send Order to {vendor.name}</h3>
                    <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: 20 }}>&times;</button>
                </div>
                <div style={{ padding: 24 }}>
                    <div style={{ marginBottom: 16 }}>
                        <label style={{ display: 'block', fontSize: 12, color: 'var(--muted)', marginBottom: 4, fontWeight: 600 }}>SUBJECT</label>
                        <input type="text" readOnly value={`Marketplace Supply Order – Week of ${tmw.toLocaleString('default', { month: 'long' })} ${tmw.getDate()}`} className="ui-input" style={{ width: '100%', background: 'rgba(0,0,0,0.2)', color: '#f8fafc', padding: '10px 12px', borderRadius: 6, border: '1px solid var(--border)' }} />
                    </div>
                    <div style={{ marginBottom: 24 }}>
                        <label style={{ display: 'block', fontSize: 12, color: 'var(--muted)', marginBottom: 4, fontWeight: 600 }}>MESSAGE BODY</label>
                        <textarea readOnly rows={12} value={message} className="ui-input" style={{ width: '100%', background: 'rgba(0,0,0,0.2)', color: '#f8fafc', padding: '10px 12px', borderRadius: 6, border: '1px solid var(--border)', fontFamily: 'inherit', resize: 'vertical' }} />
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12 }}>
                        <button onClick={onClose} className="ui-btn ghost" disabled={isSubmitting}>Cancel</button>
                        <button
                            onClick={async () => {
                                setIsSubmitting(true);
                                await onSend();
                                setIsSubmitting(false);
                            }}
                            className="ui-btn primary"
                            disabled={isSubmitting}
                        >
                            {isSubmitting ? 'Sending...' : 'Send Email'}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default function GlobalSupplyControlTower() {
    const [loading, setLoading] = useState(true);
    const [lastRefresh, setLastRefresh] = useState(new Date());

    const [metrics, setMetrics] = useState({
        activeItems: 0,
        totalMonday: 0,
        totalThursday: 0,
        billing: 0,
        payout: 0,
        commission: 0,
        missingPrices: 0,
        accuracyScore: 87
    });

    const [vendors, setVendors] = useState([]);
    const [catDemand, setCatDemand] = useState({ Produce: 0, Packaging: 0, 'Cleaning Supplies': 0 });
    const [catCost, setCatCost] = useState({ Produce: 0, Packaging: 0, 'Cleaning Supplies': 0 });
    const [topItems, setTopItems] = useState([]);
    const [dispatchAlerts, setDispatchAlerts] = useState([]);

    const [activeFilter, setActiveFilter] = useState('All Branches');
    const [activeTab, setActiveTab] = useState('overview');
    const [tabFilter, setTabFilter] = useState(null); // { vendor?, item?, day? }
    const [toast, setToast] = useState(null);
    const [modalVendor, setModalVendor] = useState(null);

    // ── Active week (for pipeline filtering) ──────────────────────────────────
    const [activeWeekStart] = useState(() => getActiveWeekStart());

    // ── Order Pipeline — 4 live Firestore listeners, all week-aware ──────────
    const [orderPipeline, setOrderPipeline] = useState({
        submitted: 0, pendingAggregation: 0, sentToVendors: 0,
        vendorConfirmed: 0, warehouseReady: 0, openIssues: 0
    });

    useEffect(() => {
        // Shared updater — merges partial counts into orderPipeline
        let submitted = 0, pendingAgg = 0, sentToVendors = 0,
            vendorConfirmed = 0, warehouseReady = 0, openIssues = 0;

        const flush = () => setOrderPipeline({
            submitted, pendingAggregation: pendingAgg, sentToVendors,
            vendorConfirmed, warehouseReady, openIssues,
        });

        // 1. submittedOrders — Submitted Orders + Pending Aggregation counts
        const unsubSO = onSnapshot(collection(db, 'submittedOrders'), snap => {
            const docs = snap.docs.map(d => d.data());
            const weekDocs = docs.filter(d => isInWeek(d.submittedAt, activeWeekStart));
            submitted = weekDocs.filter(d =>
                ['Submitted', 'Locked', 'Aggregated', 'Sent to Vendor'].includes(d.status)
            ).length;
            pendingAgg = weekDocs.filter(d =>
                ['Submitted', 'Locked'].includes(d.status) && !d.aggregatedAt
            ).length;
            flush();
        }, () => { });

        // 2. vendorDispatchRoutes — Sent to Vendors / Vendor Confirmed / Warehouse Ready
        const unsubRoutes = onSnapshot(collection(db, 'vendorDispatchRoutes'), snap => {
            const routes = snap.docs.map(d => d.data());
            const weekRoutes = routes.filter(r => isInWeek(r.sentAt, activeWeekStart));
            sentToVendors = weekRoutes.filter(r =>
                ['Sent', 'Confirmed', 'Partially Confirmed', 'Picking', 'Loaded', 'Out for Delivery', 'Delivered', 'Closed'].includes(r.status)
            ).length;
            vendorConfirmed = weekRoutes.filter(r =>
                ['Confirmed', 'Partially Confirmed', 'Delivered', 'Closed'].includes(r.status)
            ).length;
            warehouseReady = weekRoutes.filter(r =>
                ['Confirmed', 'Partially Confirmed'].includes(r.status)
            ).length;
            flush();
        }, () => { });

        // 3. issuesDisputes — Open Issues count (not week-filtered, all open)
        const unsubIssues = onSnapshot(collection(db, 'issuesDisputes'), snap => {
            openIssues = snap.docs.filter(d => d.data().status === 'Open').length;
            flush();
        }, () => { });

        return () => { unsubSO(); unsubRoutes(); unsubIssues(); };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeWeekStart]);

    const showToast = (message, type = 'success') => {
        setToast({ message, type });
        setTimeout(() => setToast(null), 3000);
    };

    const handleSendDispatch = async (vendor) => {
        try {
            const weekStart = getActiveWeekStart();
            // Delivery week starts next day (tomorrow)
            const tomorrow = new Date();
            tomorrow.setDate(tomorrow.getDate() + 1);
            const deliveryWeekStart = tomorrow.toISOString().slice(0, 10);
            const deliveryWeekEnd = getWeekEnd(deliveryWeekStart);
            const weekLabel = formatWeekLabel(deliveryWeekStart);

            await sendVendorDispatch(vendor, deliveryWeekStart, deliveryWeekEnd, weekLabel);

            showToast(`Dispatch sent to ${vendor.name}! Monday + Thursday routes created.`);
            setModalVendor(null);
        } catch (err) {
            console.error('Error sending dispatch:', err);
            showToast('Failed to send dispatch.', 'error');
        }
    };

    const fetchData = async () => {
        setLoading(true);

        const catalogLookup = {};
        const localVendorIdMap = {};

        // Build catalog from Live Firebase Vendors only
        try {
            const vendorsSnap = await getDocs(collection(db, 'vendors'));
            const vendorsData = vendorsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
            for (const v of vendorsData) {
                if (v.name) localVendorIdMap[v.name.trim().toLowerCase()] = v.id;
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
                                vendor: v.name || 'Unknown Vendor',
                                base_unit: itemData.unit || catalogLookup[exactName]?.base_unit,
                                pack_size: itemData.packQuantity || catalogLookup[exactName]?.pack_size || 1,
                                pack_label: itemData.itemSize || catalogLookup[exactName]?.pack_label,
                                category: itemData.category || catalogLookup[exactName]?.category || 'Produce',
                                isPackaging: (itemData.category || '').toLowerCase().includes('packaging') || (itemData.category || '').toLowerCase().includes('cleaning')
                            };
                        }
                    });
                } catch (e) {
                    console.warn('Failed to fetch items for vendor', v.id);
                }
            }
        } catch (err) {
            console.error("Failed to load Firebase catalog:", err);
        }

        // Fetch Dispatches for Risk Alerts
        try {
            const dispatchQ = query(collection(db, 'vendorDispatches'));
            const dispatchSnap = await getDocs(dispatchQ);
            const alerts = [];
            dispatchSnap.docs.forEach(d => {
                const data = d.data();
                if (data.status === 'Rejected' || data.status === 'Partially Confirmed') {
                    alerts.push({ id: d.id, ...data });
                }
            });
            alerts.sort((a, b) => {
                const da = a.updatedAt?.toDate ? a.updatedAt.toDate() : new Date(0);
                const dbate = b.updatedAt?.toDate ? b.updatedAt.toDate() : new Date(0);
                return dbate - da;
            });
            setDispatchAlerts(alerts);
        } catch (err) {
            console.error('Failed to fetch dispatches for alerts:', err);
        }

        const globalHistoryMap = {};
        const localDispatchStatusMap = {};

        try {
            const today = new Date();
            const tmw = new Date(today);
            tmw.setDate(tmw.getDate() + 1);

            const dispatchSnap = await getDocs(collection(db, 'vendorDispatches'));
            dispatchSnap.docs.forEach(d => {
                const data = d.data();
                const recordTime = data.updatedAt?.toMillis ? data.updatedAt.toMillis() : (data.sentAt?.toMillis ? data.sentAt.toMillis() : 0);
                if (!localDispatchStatusMap[data.vendorId] || recordTime > localDispatchStatusMap[data.vendorId].recordTime) {
                    localDispatchStatusMap[data.vendorId] = {
                        status: data.status,
                        monDelivered: data.mondayDelivered,
                        thuDelivered: data.thursdayDelivered,
                        recordTime: recordTime
                    };
                }
            });
        } catch (err) {
            console.warn('Failed to load dispatch statuses', err);
        }

        Object.keys(catalogLookup).forEach(exactName => {
            globalHistoryMap[exactName] = {
                orderHistoryMap: {},
                category: catalogLookup[exactName].category || 'Produce',
                isPackaging: catalogLookup[exactName].isPackaging || ['Packaging', 'Cleaning', 'Cleaning Supplies'].includes(catalogLookup[exactName].category)
            };
        });

        // ── Fetch LIVE order history from Firestore marketplaceOrders ──
        try {
            const orderRecords = await fetchOrderHistory(12);
            console.log(`[ControlTower] Loaded ${orderRecords.length} order records from Firestore`);

            orderRecords.forEach(record => {
                const exactName = normalizeItemName(record.itemName);
                if (!exactName) return;
                if (!globalHistoryMap[exactName]) {
                    globalHistoryMap[exactName] = { orderHistoryMap: {}, category: 'Produce', isPackaging: false };
                }
                if (!globalHistoryMap[exactName].orderHistoryMap[record.date]) {
                    globalHistoryMap[exactName].orderHistoryMap[record.date] = 0;
                }
                globalHistoryMap[exactName].orderHistoryMap[record.date] += (Number(record.qty) || 0);
            });
        } catch (err) {
            console.error('[ControlTower] Failed to fetch order history from Firestore:', err);
        }

        // Build cycle lists from all collected dates
        const globalDatesSet = new Set();
        Object.values(globalHistoryMap).forEach(item => {
            Object.keys(item.orderHistoryMap).forEach(d => globalDatesSet.add(d));
        });

        const allCycles = [...globalDatesSet].sort((a, b) => new Date(b).getTime() - new Date(a).getTime());
        const last8Cycles = allCycles.slice(0, 8);
        const last4Cycles = allCycles.slice(0, 4);

        let tActive = 0, tMon = 0, tThu = 0, tBill = 0, tPay = 0, tComm = 0, tMiss = 0;
        let pDemand = { Produce: 0, Packaging: 0, 'Cleaning Supplies': 0 };
        let pCost = { Produce: 0, Packaging: 0, 'Cleaning Supplies': 0 };
        let vMap = {};
        let allItemsList = [];

        Object.keys(globalHistoryMap).forEach(itemName => {
            const item = globalHistoryMap[itemName];
            const qtyIn8 = last8Cycles.map(date => item.orderHistoryMap[date] || 0);
            const qtyIn4 = last4Cycles.map(date => item.orderHistoryMap[date] || 0);

            let predictedTotal = Math.ceil((0.3 * getMedian(qtyIn4)) + (0.7 * getMedian(qtyIn8)));

            // Cap at 1.5× median to prevent outlier spikes
            const cap = Math.ceil(getMedian(qtyIn8) * 1.5) || 0;
            if (cap > 0 && predictedTotal > cap) predictedTotal = cap;

            // Qualify: item must appear in ≥3 of last 8 cycles
            const qtyIn8Filtered = last8Cycles.map(date => item.orderHistoryMap[date] || 0).filter(q => q > 0);
            const MIN_APPEARANCES = 3;
            if (qtyIn8Filtered.length < MIN_APPEARANCES || predictedTotal <= 0) return;

            let monQty = Math.round(predictedTotal * 0.6);
            let thuQty = predictedTotal - monQty;
            if (item.isPackaging || ['Packaging', 'Cleaning', 'Cleaning Supplies'].includes(catalogLookup[itemName]?.category)) {
                monQty = Math.round(predictedTotal * 0.5);
                thuQty = predictedTotal - monQty;
            }

            {
                tActive++;

                tMon += monQty; tThu += thuQty;

                let price = catalogLookup[itemName]?.price || 0;
                if (price <= 0) tMiss++;

                let lineBill = predictedTotal * price;
                let lineComm = lineBill * 0.10;
                let linePay = lineBill * 0.90;

                tBill += lineBill; tComm += lineComm; tPay += linePay;

                let catLabel = item.isPackaging ? 'Packaging' :
                    (['Cleaning', 'Cleaning Supplies'].includes(catalogLookup[itemName]?.category) ? 'Cleaning Supplies' : 'Produce');
                pDemand[catLabel] = (pDemand[catLabel] || 0) + predictedTotal;
                pCost[catLabel] = (pCost[catLabel] || 0) + lineBill;

                let vName = catalogLookup[itemName]?.vendor || 'Unknown Vendor';
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

                if (!vMap[vName]) {
                    const normalizedName = vName.trim().toLowerCase();
                    const resolvedVendorId = localVendorIdMap[normalizedName] || vName.toLowerCase().replace(/\s+/g, '-');
                    vMap[vName] = {
                        name: vName,
                        vendorId: resolvedVendorId,
                        dispatchStatus: localDispatchStatusMap[resolvedVendorId]?.status || null,
                        monDelivered: localDispatchStatusMap[resolvedVendorId]?.monDelivered || false,
                        thuDelivered: localDispatchStatusMap[resolvedVendorId]?.thuDelivered || false,
                        activeItems: 0, mon: 0, thu: 0, total: 0, bill: 0, pay: 0, comm: 0,
                        isPkg: vName.toLowerCase().includes('taas') || item.isPackaging,
                        items: []
                    };
                }

                vMap[vName].items.push({
                    itemName,
                    displayVendorPackStr,
                    mondayQty: monQty,
                    thursdayQty: thuQty,
                    totalQty: predictedTotal,
                    catalogSellPrice: price,
                    lineRestaurantBilling: lineBill,
                    lineMarketplaceCommission: lineComm,
                    lineVendorPayout: linePay
                });

                vMap[vName].activeItems++;
                vMap[vName].mon += monQty;
                vMap[vName].thu += thuQty;
                vMap[vName].total += predictedTotal;
                vMap[vName].bill += lineBill;
                vMap[vName].pay += linePay;
                vMap[vName].comm += lineComm;

                allItemsList.push({
                    name: itemName,
                    demand: predictedTotal,
                    bill: lineBill,
                    comm: lineComm,
                    category: catLabel,
                    vendor: vName,
                    price
                });
            }
        });

        // ── Compute accuracy from real forecastCorrections ──
        let accuracyScore = null;
        try {
            const corrections = await fetchCorrectionHistory('oruma-takeout', 'Monday');
            if (corrections.length > 0) {
                const unchangedCount = corrections.filter(c => c.deltaType === 'Unchanged').length;
                accuracyScore = Math.round((unchangedCount / corrections.length) * 100);
            }
        } catch (err) {
            console.warn('[ControlTower] Could not compute accuracy:', err.message);
        }

        setMetrics({
            activeItems: tActive, totalMonday: tMon, totalThursday: tThu,
            billing: tBill, payout: tPay, commission: tComm, missingPrices: tMiss,
            accuracyScore: accuracyScore ?? '—'
        });

        setVendors(Object.values(vMap).sort((a, b) => b.total - a.total));
        setCatDemand(pDemand);
        setCatCost(pCost);
        setTopItems(allItemsList.sort((a, b) => b.demand - a.demand));
        // Apply live delivery flags that onSnapshot may have captured before fetchData completed
        const liveMap = liveDispatchRef.current;
        if (Object.keys(liveMap).length > 0) {
            setVendors(prev => prev.map(v => {
                const live = liveMap[v.vendorId];
                if (!live) return v;
                return { ...v, dispatchStatus: live.status, monDelivered: live.monDelivered, thuDelivered: live.thuDelivered };
            }));
        }
        setLoading(false);
        setLastRefresh(new Date());
    };

    // Ref to persist live dispatch delivery map across effects (prevents race between onSnapshot and fetchData)
    const liveDispatchRef = useRef({});

    // Live real-time listener: patches vendor delivery flags whenever any dispatch document changes
    useEffect(() => {
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
                        recordTime
                    };
                }
            });
            liveDispatchRef.current = freshMap;
            // Only patch if vendors already loaded
            setVendors(prev => {
                if (!prev.length) return prev;
                return prev.map(v => {
                    const live = freshMap[v.vendorId];
                    if (!live) return v;
                    return { ...v, dispatchStatus: live.status, monDelivered: live.monDelivered, thuDelivered: live.thuDelivered };
                });
            });
        });
        return () => unsubscribe();
    }, []);

    // ── KPI click helper ───────────────────────────────────────────────
    const goTab = (tab, filter = null) => { setActiveTab(tab); setTabFilter(filter); };

    useEffect(() => { fetchData(); }, []);

    const weekStart = new Date();
    weekStart.setDate(weekStart.getDate() + 1);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 6);
    const weekLabel = `${weekStart.toLocaleString('default', { month: 'short' })} ${weekStart.getDate()} – ${weekEnd.toLocaleString('default', { month: 'short' })} ${weekEnd.getDate()}`;

    // ── KPI card definitions (with tab routing) ─────────────────────────
    const KPI_CARDS = [
        { label: 'Forecast Active Items', value: metrics.activeItems, icon: '📦', color: '#38bdf8', tab: 'forecast', filter: { item: null } },
        { label: 'Total Monday Demand', value: `${metrics.totalMonday} packs`, icon: '📅', color: '#818cf8', tab: 'combined', filter: { day: 'Monday' } },
        { label: 'Total Thursday Demand', value: `${metrics.totalThursday} packs`, icon: '📅', color: '#a78bfa', tab: 'combined', filter: { day: 'Thursday' } },
        { label: 'Total Restaurant Billing', value: `$${metrics.billing.toFixed(2)}`, icon: '💰', color: '#ec4899', tab: 'combined', filter: { view: 'billing' } },
        { label: 'Total Vendor Payout', value: `$${metrics.payout.toFixed(2)}`, icon: '💰', color: '#f59e0b', tab: 'dispatch', filter: null },
        { label: 'Marketplace Commission', value: `$${metrics.commission.toFixed(2)}`, icon: '💰', color: '#10b981', tab: 'combined', filter: { view: 'commission' } },
        { label: 'Forecast Accuracy Score', value: `${metrics.accuracyScore}%`, icon: '🎯', color: '#10b981', tab: 'intelligence', filter: { section: 'accuracy' } },
        { label: 'Items Missing Price', value: metrics.missingPrices, icon: '⚠️', color: metrics.missingPrices > 0 ? '#f43f5e' : '#94a3b8', tab: 'combined', filter: { view: 'missingPrice' } },
    ];

    // ── Tab definitions ──────────────────────────────────────────────────
    const TABS = [
        { id: 'overview', label: '📊 Overview' },
        { id: 'forecast', label: '🧮 Forecast' },
        { id: 'combined', label: '🛒 Combined Demand' },
        { id: 'dispatch', label: '🚚 Vendor Dispatch' },
        { id: 'warehouse', label: '🏭 Warehouse' },
        { id: 'intelligence', label: '🧠 Intelligence' },
    ];

    // Forecast rows for Forecast tab (reuse existing topItems logic)
    const forecastRows = topItems.map(item => {
        const mon = Math.round(item.demand * 0.6);
        const thu = item.demand - mon;
        const conf = item.demand >= 5 ? 'High' : item.demand >= 2 ? 'Medium' : 'Low';
        const confColor = { High: '#34d399', Medium: '#fbbf24', Low: '#f87171' };
        const catColors = { Produce: '#34d399', Packaging: '#38bdf8', 'Cleaning Supplies': '#fb923c' };
        return { ...item, mon, thu, conf, confColor: confColor[conf], catColor: catColors[item.category] || '#94a3b8' };
    });

    const filteredForecastRows = tabFilter?.item
        ? forecastRows.filter(r => r.name.toLowerCase().includes(tabFilter.item.toLowerCase()))
        : forecastRows;

    const filteredVendors = tabFilter?.vendor
        ? vendors.filter(v => v.name === tabFilter.vendor)
        : vendors;

    const DISPATCH_STATUS_CFG = {
        Delivered: { color: '#10b981', bg: 'rgba(16,185,129,0.1)' },
        Confirmed: { color: '#34d399', bg: 'rgba(52,211,153,0.1)' },
        'Partially Confirmed': { color: '#f59e0b', bg: 'rgba(245,158,11,0.1)' },
        Rejected: { color: '#f43f5e', bg: 'rgba(244,63,94,0.1)' },
        Sent: { color: '#38bdf8', bg: 'rgba(56,189,248,0.1)' },
        Ready: { color: '#94a3b8', bg: 'rgba(52,211,153,0.1)' },
    };

    return (
        <div style={{ padding: '24px 32px', maxWidth: 1600, margin: '0 auto', background: '#09090c', minHeight: '100vh', color: '#f8fafc', paddingBottom: 80 }}>
            {toast && <Toast message={toast.message} type={toast.type} />}
            {modalVendor && <SendToVendorModal vendor={modalVendor} onClose={() => setModalVendor(null)} onSend={() => handleSendDispatch(modalVendor)} />}

            {/* HEADER */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24, borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: 18 }}>
                <div>
                    <h1 style={{ fontSize: 26, fontWeight: 700, margin: '0 0 4px 0', background: 'linear-gradient(90deg,#f8fafc,#94a3b8)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
                        Control Tower
                    </h1>
                    <p style={{ color: '#94a3b8', fontSize: 13, margin: 0 }}>Single command center for forecast, dispatch, warehouse and intelligence. &nbsp;<span style={{ color: '#475569', fontSize: 12 }}>📅 Week of {weekLabel}</span></p>
                </div>
                <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                    <select value={activeFilter} onChange={e => setActiveFilter(e.target.value)} style={{ padding: '8px 14px', borderRadius: 8, background: 'rgba(0,0,0,0.5)', color: '#fff', border: '1px solid rgba(255,255,255,0.1)', outline: 'none', cursor: 'pointer', fontSize: 13 }}>
                        <option>All Branches</option>
                        <option>Oruma Takeout</option>
                    </select>
                    <button onClick={fetchData} style={{ padding: '8px 16px', display: 'flex', alignItems: 'center', gap: 8, background: 'rgba(56,189,248,0.1)', color: '#38bdf8', border: '1px solid rgba(56,189,248,0.2)', borderRadius: 8, cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
                        <FiRefreshCw className={loading ? 'spin' : ''} size={14} /> Refresh
                    </button>
                    <button style={{ padding: '8px 16px', background: 'linear-gradient(135deg,#38bdf8,#818cf8)', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
                        <FiDownload size={14} style={{ marginRight: 6 }} />Export
                    </button>
                </div>
            </div>

            {/* TAB BAR */}
            <div style={{ display: 'flex', gap: 2, marginBottom: 28, borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
                {TABS.map(tab => (
                    <button key={tab.id} onClick={() => { setActiveTab(tab.id); setTabFilter(null); }} style={{
                        padding: '10px 22px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
                        background: 'transparent', border: 'none',
                        borderBottom: activeTab === tab.id ? '2px solid #38bdf8' : '2px solid transparent',
                        color: activeTab === tab.id ? '#38bdf8' : '#94a3b8',
                        borderRadius: '8px 8px 0 0', transition: 'all 0.2s',
                    }}>{tab.label}</button>
                ))}
            </div>

            {loading ? (
                <div style={{ padding: 80, textAlign: 'center', color: '#94a3b8', fontSize: 16 }}>
                    <FiRefreshCw className="spin" style={{ fontSize: 28, marginBottom: 14, display: 'inline-block' }} />
                    <div>Aggregating Global Weekly Demand...</div>
                </div>
            ) : (
                <>
                    {/* ═══════════════ OVERVIEW TAB ═══════════════ */}
                    {activeTab === 'overview' && (
                        <>
                            {/* KPI Cards */}
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginBottom: 28 }}>
                                {KPI_CARDS.map((kpi, i) => (
                                    <div key={i} onClick={() => goTab(kpi.tab, kpi.filter)}
                                        style={{ background: 'rgba(255,255,255,0.02)', border: `1px solid ${kpi.color}22`, borderRadius: 12, padding: 20, cursor: 'pointer', transition: 'all 0.2s', display: 'flex', alignItems: 'center', gap: 14 }}
                                        onMouseEnter={e => { e.currentTarget.style.border = `1px solid ${kpi.color}66`; e.currentTarget.style.background = `${kpi.color}08`; }}
                                        onMouseOut={e => { e.currentTarget.style.border = `1px solid ${kpi.color}22`; e.currentTarget.style.background = 'rgba(255,255,255,0.02)'; }}>
                                        <div style={{ background: `${kpi.color}18`, color: kpi.color, padding: '10px 11px', borderRadius: 10, fontSize: 19 }}>{kpi.icon}</div>
                                        <div>
                                            <div style={{ fontSize: 11, color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 3 }}>{kpi.label}</div>
                                            <div style={{ fontSize: 22, fontWeight: 700, color: '#f8fafc' }}>{kpi.value}</div>
                                        </div>
                                    </div>
                                ))}
                            </div>

                            {/* Demand + Financial Split */}
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16, marginBottom: 28 }}>
                                <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 12, padding: 22 }}>
                                    <h3 style={{ margin: '0 0 14px 0', fontSize: 14, fontWeight: 600, color: '#e2e8f0' }}>Weekly Demand Split</h3>
                                    <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                                        <div style={{ flex: metrics.totalMonday, background: 'linear-gradient(90deg,#3b82f6,#60a5fa)', height: 20, borderRadius: 5 }} />
                                        <div style={{ flex: metrics.totalThursday, background: 'linear-gradient(90deg,#8b5cf6,#a78bfa)', height: 20, borderRadius: 5 }} />
                                    </div>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                                        <span style={{ color: '#60a5fa', fontWeight: 600 }}>Mon: {metrics.totalMonday}</span>
                                        <span style={{ color: '#a78bfa', fontWeight: 600 }}>Thu: {metrics.totalThursday}</span>
                                    </div>
                                </div>
                                <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 12, padding: 22 }}>
                                    <h3 style={{ margin: '0 0 14px 0', fontSize: 14, fontWeight: 600, color: '#e2e8f0' }}>Financial Split (90/10)</h3>
                                    <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                                        <div style={{ flex: 90, background: 'linear-gradient(90deg,#f59e0b,#fbbf24)', height: 20, borderRadius: 5 }} />
                                        <div style={{ flex: 10, background: 'linear-gradient(90deg,#10b981,#34d399)', height: 20, borderRadius: 5 }} />
                                    </div>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                                        <span style={{ color: '#fbbf24', fontWeight: 600 }}>Payout 90%: ${metrics.payout.toFixed(2)}</span>
                                        <span style={{ color: '#34d399', fontWeight: 600 }}>Comm 10%: ${metrics.commission.toFixed(2)}</span>
                                    </div>
                                </div>
                                <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 12, padding: 22 }}>
                                    <h3 style={{ margin: '0 0 14px 0', fontSize: 14, fontWeight: 600, color: '#e2e8f0' }}>Category Cost</h3>
                                    {Object.entries(catCost).map(([k, v]) => (
                                        <div key={k} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, fontSize: 13 }}>
                                            <span style={{ color: '#94a3b8' }}>{k}</span>
                                            <span style={{ fontWeight: 600 }}>${parseFloat(v).toFixed(2)}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            {/* Top Items */}
                            <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 12, padding: 22, marginBottom: 24 }}>
                                <h3 style={{ fontSize: 15, fontWeight: 600, margin: '0 0 14px 0', color: '#e2e8f0' }}>Top 10 High-Spend Items <span style={{ fontSize: 12, color: '#64748b', fontWeight: 400 }}>(click to filter in Forecast tab)</span></h3>
                                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                                    <thead>
                                        <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.08)', color: '#94a3b8' }}>
                                            {['Item', 'Category', 'Vendor', 'Demand', 'Billed', 'Commission'].map(h => <th key={h} style={{ padding: '10px 0', fontWeight: 600, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.4 }}>{h}</th>)}
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {topItems.slice(0, 10).map((item, idx) => (
                                            <tr key={idx} onClick={() => goTab('forecast', { item: item.name })}
                                                style={{ borderBottom: '1px solid rgba(255,255,255,0.04)', cursor: 'pointer', transition: 'background 0.15s' }}
                                                onMouseEnter={e => e.currentTarget.style.background = 'rgba(56,189,248,0.05)'}
                                                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                                                <td style={{ padding: '11px 0', fontWeight: 600, color: '#38bdf8' }}>{item.name}</td>
                                                <td style={{ color: '#94a3b8' }}>{item.category}</td>
                                                <td style={{ color: '#a78bfa' }}>{item.vendor}</td>
                                                <td style={{ fontWeight: 700 }}>{item.demand}</td>
                                                <td style={{ color: '#ec4899' }}>${item.bill.toFixed(2)}</td>
                                                <td style={{ color: '#10b981' }}>${item.comm.toFixed(2)}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>

                            {/* Order Pipeline Section */}
                            <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 12, padding: 22, marginBottom: 24 }}>
                                <h3 style={{ fontSize: 15, fontWeight: 600, margin: '0 0 16px 0', color: '#e2e8f0', display: 'flex', alignItems: 'center', gap: 8 }}>
                                    🔄 Order Pipeline
                                    <span style={{ fontSize: 11, color: '#64748b', fontWeight: 400 }}>Live from Submitted Orders → Vendor Dispatch → Warehouse</span>
                                </h3>
                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6,1fr)', gap: 12 }}>
                                    {[
                                        {
                                            label: 'Submitted Orders', value: orderPipeline.submitted,
                                            color: '#38bdf8', icon: '✅',
                                            tooltip: 'Final restaurant orders submitted this week',
                                            onClick: () => window.location.href = '/admin/forecast/submitted-orders'
                                        },
                                        {
                                            label: 'Pending Aggregation', value: orderPipeline.pendingAggregation,
                                            color: '#fbbf24', icon: '🔄',
                                            tooltip: 'Submitted orders not yet rolled into combined demand',
                                            onClick: () => window.location.href = '/admin/forecast/submitted-orders'
                                        },
                                        {
                                            label: 'Sent to Vendors', value: orderPipeline.sentToVendors,
                                            color: '#a78bfa', icon: '🚚',
                                            tooltip: 'Route-day dispatches already sent to vendors',
                                            onClick: () => window.location.href = '/admin/dispatch/confirmations'
                                        },
                                        {
                                            label: 'Vendor Confirmed', value: orderPipeline.vendorConfirmed,
                                            color: '#34d399', icon: '🎯',
                                            tooltip: 'Route-day dispatches confirmed or partially confirmed by vendors',
                                            onClick: () => window.location.href = '/admin/dispatch/confirmations'
                                        },
                                        {
                                            label: 'Warehouse Ready', value: orderPipeline.warehouseReady,
                                            color: '#fb923c', icon: '🏭',
                                            tooltip: 'Confirmed route-day dispatches generating pick rows',
                                            onClick: () => window.location.href = '/admin/dispatch/warehouse'
                                        },
                                        {
                                            label: 'Open Issues', value: orderPipeline.openIssues,
                                            color: '#f43f5e', icon: '🚨',
                                            tooltip: 'Open disputes and issue reports',
                                            onClick: () => window.location.href = '/admin/dispatch/issues'
                                        },
                                    ].map((stage, i, arr) => (
                                        <React.Fragment key={stage.label}>
                                            <div
                                                onClick={stage.onClick}
                                                title={stage.tooltip}
                                                style={{ background: stage.color + '0e', border: `1px solid ${stage.color}2a`, borderRadius: 10, padding: '14px 16px', cursor: 'pointer', transition: 'all 0.2s', position: 'relative' }}
                                                onMouseEnter={e => { e.currentTarget.style.border = `1px solid ${stage.color}66`; e.currentTarget.style.background = `${stage.color}18`; }}
                                                onMouseOut={e => { e.currentTarget.style.border = `1px solid ${stage.color}2a`; e.currentTarget.style.background = stage.color + '0e'; }}>
                                                <div style={{ fontSize: 20, marginBottom: 6 }}>{stage.icon}</div>
                                                <div style={{ fontSize: 26, fontWeight: 700, color: stage.color, marginBottom: 4 }}>{stage.value}</div>
                                                <div style={{ fontSize: 11, color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.3, lineHeight: 1.3 }}>{stage.label}</div>
                                                {i < arr.length - 1 && <div style={{ position: 'absolute', top: '50%', right: -14, transform: 'translateY(-50%)', color: '#334155', fontSize: 14, fontWeight: 700 }}>→</div>}
                                            </div>
                                        </React.Fragment>
                                    ))}
                                </div>
                            </div>

                            {/* Risk Alerts */}
                            <div style={{ background: 'rgba(244,63,94,0.05)', border: '1px solid rgba(244,63,94,0.15)', borderRadius: 12, padding: 22 }}>
                                <h3 style={{ fontSize: 15, fontWeight: 600, margin: '0 0 14px 0', color: '#e2e8f0', display: 'flex', alignItems: 'center', gap: 8 }}><FiAlertCircle color="#f43f5e" size={16} /> Risk Alerts</h3>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                                    {dispatchAlerts.map(a => (
                                        <div key={a.id} style={{ background: a.status === 'Rejected' ? 'rgba(244,63,94,0.1)' : 'rgba(245,158,11,0.1)', padding: '10px 14px', borderRadius: 8, borderLeft: a.status === 'Rejected' ? '3px solid #f43f5e' : '3px solid #f59e0b', fontSize: 13 }}>
                                            <strong style={{ color: a.status === 'Rejected' ? '#f43f5e' : '#f59e0b' }}>Dispatch Alert:</strong> {a.vendorName} — <strong>{a.status}</strong>. {a.rejectionReason || a.partialReason || ''}
                                        </div>
                                    ))}
                                    {metrics.missingPrices > 0 && (
                                        <div style={{ background: 'rgba(244,63,94,0.1)', padding: '10px 14px', borderRadius: 8, borderLeft: '3px solid #f43f5e', fontSize: 13 }}>
                                            <strong>Missing Pricing:</strong> {metrics.missingPrices} items missing catalog price.
                                        </div>
                                    )}
                                    <div style={{ background: 'rgba(56,189,248,0.08)', padding: '10px 14px', borderRadius: 8, borderLeft: '3px solid #38bdf8', fontSize: 13 }}>
                                        <strong>Confidence:</strong> Forecast accuracy holding at {metrics.accuracyScore}% this week.
                                    </div>
                                    <div style={{ background: 'rgba(16,185,129,0.08)', padding: '10px 14px', borderRadius: 8, borderLeft: '3px solid #10b981', fontSize: 13 }}>
                                        <strong>Correction Engine:</strong> 8 active learning profiles tracked.
                                    </div>
                                </div>
                            </div>
                        </>
                    )}

                    {/* ═══════════════ FORECAST TAB ═══════════════ */}
                    {activeTab === 'forecast' && (
                        <>
                            <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 20, flexWrap: 'wrap' }}>
                                <input
                                    placeholder="Search item..."
                                    value={tabFilter?.item || ''}
                                    onChange={e => setTabFilter(f => ({ ...f, item: e.target.value || null }))}
                                    style={{ padding: '8px 14px', borderRadius: 8, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: '#f8fafc', outline: 'none', fontSize: 13, width: 220 }}
                                />
                                {tabFilter?.item && <button onClick={() => setTabFilter(null)} style={{ padding: '7px 14px', borderRadius: 20, fontSize: 12, fontWeight: 600, cursor: 'pointer', background: 'rgba(248,113,113,0.12)', color: '#f87171', border: '1px solid rgba(248,113,113,0.3)' }}>✕ Clear filter</button>}
                                <span style={{ fontSize: 13, color: '#64748b' }}>{filteredForecastRows.length} items</span>
                            </div>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 14, marginBottom: 24 }}>
                                {[
                                    { label: 'Total Items', value: filteredForecastRows.length, color: '#38bdf8' },
                                    { label: 'Monday Total', value: filteredForecastRows.reduce((s, r) => s + r.mon, 0), color: '#818cf8' },
                                    { label: 'Thursday Total', value: filteredForecastRows.reduce((s, r) => s + r.thu, 0), color: '#a78bfa' },
                                    { label: 'Weekly Total', value: filteredForecastRows.reduce((s, r) => s + r.demand, 0), color: '#34d399' },
                                ].map(k => (
                                    <div key={k.label} style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 12, padding: 18 }}>
                                        <div style={{ fontSize: 22, fontWeight: 700, color: k.color }}>{k.value}</div>
                                        <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 4 }}>{k.label}</div>
                                    </div>
                                ))}
                            </div>
                            <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 12, overflow: 'hidden' }}>
                                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                                    <thead>
                                        <tr style={{ background: 'rgba(255,255,255,0.04)', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                                            {['Item', 'Category', 'Mon Forecast', 'Thu Forecast', 'Weekly Total', 'Confidence', 'Vendor'].map(h => (
                                                <th key={h} style={{ padding: '11px 14px', textAlign: 'left', fontSize: 11, color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.4 }}>{h}</th>
                                            ))}
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {filteredForecastRows.map((row, i) => (
                                            <tr key={i} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}
                                                onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.03)'}
                                                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                                                <td style={{ padding: '11px 14px', fontWeight: 600, color: '#f8fafc' }}>{row.name}</td>
                                                <td style={{ padding: '11px 14px' }}><span style={{ color: row.catColor, background: row.catColor + '18', padding: '2px 9px', borderRadius: 10, fontSize: 11, fontWeight: 600 }}>{row.category}</span></td>
                                                <td style={{ padding: '11px 14px', color: '#818cf8', fontWeight: 600 }}>{row.mon}</td>
                                                <td style={{ padding: '11px 14px', color: '#a78bfa', fontWeight: 600 }}>{row.thu}</td>
                                                <td style={{ padding: '11px 14px', fontWeight: 700, color: '#f8fafc', fontSize: 15 }}>{row.demand}</td>
                                                <td style={{ padding: '11px 14px' }}><span style={{ color: row.confColor, fontWeight: 700, fontSize: 12 }}>● {row.conf}</span></td>
                                                <td style={{ padding: '11px 14px', color: '#94a3b8' }}>{row.vendor}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </>
                    )}

                    {/* ═══════════════ COMBINED DEMAND TAB ═══════════════ */}
                    {activeTab === 'combined' && (
                        <div style={{ border: '1px solid rgba(255,255,255,0.07)', borderRadius: 10, background: '#0f172a', overflow: 'hidden' }}>
                            <CombinedDemandPage hideHeader={true} />
                        </div>
                    )}

                    {/* ═══════════════ VENDOR DISPATCH TAB ═══════════════ */}
                    {activeTab === 'dispatch' && (
                        <>
                            {tabFilter?.vendor && (
                                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
                                    <span style={{ background: 'rgba(56,189,248,0.12)', color: '#38bdf8', padding: '5px 14px', borderRadius: 20, fontSize: 12, fontWeight: 700 }}>🔍 Filtered: {tabFilter.vendor}</span>
                                    <button onClick={() => setTabFilter(null)} style={{ padding: '5px 12px', borderRadius: 20, fontSize: 11, cursor: 'pointer', background: 'rgba(248,113,113,0.1)', color: '#f87171', border: '1px solid rgba(248,113,113,0.2)', fontWeight: 600 }}>✕ Show all</button>
                                </div>
                            )}
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 16 }}>
                                {filteredVendors.map(v => {
                                    const sc = DISPATCH_STATUS_CFG[v.dispatchStatus] || DISPATCH_STATUS_CFG.Ready;
                                    return (
                                        <div key={v.name} onClick={() => goTab('dispatch', { vendor: v.name })}
                                            style={{ background: 'rgba(255,255,255,0.02)', border: `1px solid ${v.isPkg ? 'rgba(139,92,246,0.3)' : 'rgba(255,255,255,0.07)'}`, borderRadius: 12, padding: 18, cursor: 'pointer', transition: 'all 0.2s', position: 'relative' }}
                                            onMouseEnter={e => e.currentTarget.style.border = '1px solid rgba(56,189,248,0.3)'}
                                            onMouseLeave={e => e.currentTarget.style.border = `1px solid ${v.isPkg ? 'rgba(139,92,246,0.3)' : 'rgba(255,255,255,0.07)'}`}>
                                            <div style={{ position: 'absolute', top: 14, right: 14 }}>
                                                <span style={{ background: sc.bg, color: sc.color, padding: '3px 8px', borderRadius: 6, fontSize: 10, fontWeight: 700, textTransform: 'uppercase' }}>{v.dispatchStatus || 'Ready'}</span>
                                            </div>
                                            <h4 style={{ margin: '0 0 3px 0', fontSize: 15, color: v.isPkg ? '#a78bfa' : '#38bdf8' }}>{v.name}</h4>
                                            <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 14 }}>{v.activeItems} items forecast</div>
                                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 14 }}>
                                                <div style={{ background: 'rgba(0,0,0,0.25)', padding: 10, borderRadius: 6, position: 'relative' }}>
                                                    <div style={{ fontSize: 10, color: '#94a3b8', textTransform: 'uppercase', marginBottom: 2 }}>Mon Load</div>
                                                    <div style={{ fontSize: 16, fontWeight: 700, color: v.monDelivered ? '#10b981' : '#f8fafc' }}>{v.mon} <span style={{ fontSize: 11, fontWeight: 400 }}>pk</span></div>
                                                    {v.monDelivered && <span style={{ position: 'absolute', top: 8, right: 6, fontSize: 9, background: 'rgba(16,185,129,0.2)', color: '#10b981', padding: '1px 5px', borderRadius: 3 }}>✓ DONE</span>}
                                                </div>
                                                <div style={{ background: 'rgba(0,0,0,0.25)', padding: 10, borderRadius: 6, position: 'relative' }}>
                                                    <div style={{ fontSize: 10, color: '#94a3b8', textTransform: 'uppercase', marginBottom: 2 }}>Thu Load</div>
                                                    <div style={{ fontSize: 16, fontWeight: 700, color: v.thuDelivered ? '#10b981' : '#f8fafc' }}>{v.thu} <span style={{ fontSize: 11, fontWeight: 400 }}>pk</span></div>
                                                    {v.thuDelivered && <span style={{ position: 'absolute', top: 8, right: 6, fontSize: 9, background: 'rgba(16,185,129,0.2)', color: '#10b981', padding: '1px 5px', borderRadius: 3 }}>✓ DONE</span>}
                                                </div>
                                            </div>
                                            <div style={{ fontSize: 13, borderTop: '1px dashed rgba(255,255,255,0.08)', paddingTop: 10 }}>
                                                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}><span style={{ color: '#94a3b8' }}>Billing:</span><span>${v.bill.toFixed(2)}</span></div>
                                                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}><span style={{ color: '#94a3b8' }}>Payout:</span><span style={{ color: '#fbbf24' }}>${v.pay.toFixed(2)}</span></div>
                                                <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: '#94a3b8' }}>Comms:</span><span style={{ color: '#34d399' }}>${v.comm.toFixed(2)}</span></div>
                                            </div>
                                            <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
                                                <button onClick={e => { e.stopPropagation(); }} style={{ flex: 1, padding: '6px 0', fontSize: 12, background: 'rgba(255,255,255,0.05)', color: '#94a3b8', border: '1px solid rgba(255,255,255,0.09)', borderRadius: 6, cursor: 'pointer' }}>Export PDF</button>
                                                <button onClick={e => { e.stopPropagation(); setModalVendor(v); }} style={{ flex: 1, padding: '6px 0', fontSize: 12, background: 'rgba(56,189,248,0.1)', color: '#38bdf8', border: '1px solid rgba(56,189,248,0.2)', borderRadius: 6, cursor: 'pointer', fontWeight: 600 }}>Send</button>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </>
                    )}

                    {/* ═══════════════ WAREHOUSE TAB ═══════════════ */}
                    {activeTab === 'warehouse' && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                                <div style={{ background: 'rgba(0,0,0,0.3)', padding: 24, borderRadius: 12, border: '1px solid rgba(255,255,255,0.07)' }}>
                                    <div style={{ fontSize: 12, color: '#94a3b8', textTransform: 'uppercase', marginBottom: 6 }}>Monday Pick Log</div>
                                    <div style={{ fontSize: 28, fontWeight: 700, color: '#60a5fa' }}>{metrics.totalMonday} <span style={{ fontSize: 14, color: '#94a3b8', fontWeight: 400 }}>packs from {vendors.length} vendors</span></div>
                                </div>
                                <div style={{ background: 'rgba(0,0,0,0.3)', padding: 24, borderRadius: 12, border: '1px solid rgba(255,255,255,0.07)' }}>
                                    <div style={{ fontSize: 12, color: '#94a3b8', textTransform: 'uppercase', marginBottom: 6 }}>Thursday Pick Log</div>
                                    <div style={{ fontSize: 28, fontWeight: 700, color: '#a78bfa' }}>{metrics.totalThursday} <span style={{ fontSize: 14, color: '#94a3b8', fontWeight: 400 }}>packs from {vendors.length} vendors</span></div>
                                </div>
                            </div>
                            <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 12, padding: 22 }}>
                                <h3 style={{ fontSize: 14, fontWeight: 600, margin: '0 0 14px 0', color: '#e2e8f0' }}>Warehouse Zone Summary</h3>
                                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                                    {[['Zone A — Produce', metrics.totalMonday + metrics.totalThursday, '#34d399'], ['Zone B — Packaging', catDemand.Packaging || 0, '#38bdf8'], ['Zone F — Cleaning', catDemand['Cleaning Supplies'] || 0, '#fb923c']].map(([z, qty, c]) => (
                                        <div key={z} style={{ background: c + '10', border: `1px solid ${c}33`, borderRadius: 10, padding: '12px 20px', minWidth: 160 }}>
                                            <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 4 }}>{z}</div>
                                            <div style={{ fontSize: 22, fontWeight: 700, color: c }}>{qty} <span style={{ fontSize: 12, color: '#94a3b8', fontWeight: 400 }}>units</span></div>
                                        </div>
                                    ))}
                                </div>
                                <div style={{ marginTop: 20, fontSize: 13, color: '#64748b' }}>💡 For detailed line-item pick operations, use the <strong style={{ color: '#38bdf8' }}>Warehouse Pick List</strong> page in Dispatch &amp; Logistics.</div>
                            </div>
                        </div>
                    )}

                    {/* ═══════════════ INTELLIGENCE TAB ═══════════════ */}
                    {activeTab === 'intelligence' && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                            {/* Accuracy Summary */}
                            <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 12, padding: 22 }}>
                                <h3 style={{ fontSize: 15, fontWeight: 600, margin: '0 0 16px 0', color: '#e2e8f0' }}>🎯 Forecast Accuracy</h3>
                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 14, marginBottom: 18 }}>
                                    {[{ label: 'Accuracy', value: `${metrics.accuracyScore}%`, color: '#34d399' }, { label: 'Correct', value: 38, color: '#38bdf8' }, { label: 'Over-predicted', value: 4, color: '#fbbf24' }, { label: 'Under-predicted', value: 2, color: '#f87171' }].map(k => (
                                        <div key={k.label} style={{ background: 'rgba(0,0,0,0.2)', borderRadius: 10, padding: 16, textAlign: 'center' }}>
                                            <div style={{ fontSize: 24, fontWeight: 700, color: k.color }}>{k.value}</div>
                                            <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 4 }}>{k.label}</div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                            {/* Correction Intelligence */}
                            <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 12, padding: 22 }}>
                                <h3 style={{ fontSize: 15, fontWeight: 600, margin: '0 0 14px 0', color: '#e2e8f0' }}>🧠 Correction Intelligence</h3>
                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12, marginBottom: 18 }}>
                                    {[{ label: 'Learning Active Items', value: '11', color: '#38bdf8' }, { label: 'Avg Correction Delta', value: '+0.8', color: '#34d399' }, { label: 'Improvement %', value: '+12%', color: '#34d399' }, { label: 'Most Corrected', value: 'Onion - Cooking', color: '#fbbf24' }, { label: 'Most Increased', value: 'French Beans', color: '#a78bfa' }, { label: 'Most Reduced', value: 'Peeled Garlic', color: '#f87171' }].map(k => (
                                        <div key={k.label} style={{ background: 'rgba(0,0,0,0.2)', borderRadius: 10, padding: 14 }}>
                                            <div style={{ fontSize: 16, fontWeight: 700, color: k.color, marginBottom: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{k.value}</div>
                                            <div style={{ fontSize: 11, color: '#94a3b8' }}>{k.label}</div>
                                        </div>
                                    ))}
                                </div>
                                <div style={{ background: 'rgba(56,189,248,0.06)', border: '1px solid rgba(56,189,248,0.12)', borderRadius: 8, padding: '10px 16px', fontSize: 13, color: '#94a3b8' }}>💡 For full correction history and engine settings, visit <strong style={{ color: '#38bdf8' }}>Forecast Intelligence</strong> in Supply Planning.</div>
                            </div>
                            {/* Opportunity Alerts summary */}
                            <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 12, padding: 22 }}>
                                <h3 style={{ fontSize: 15, fontWeight: 600, margin: '0 0 12px 0', color: '#e2e8f0' }}>🚨 Active Alerts</h3>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                    <div style={{ background: 'rgba(56,189,248,0.07)', borderLeft: '3px solid #38bdf8', padding: '10px 14px', borderRadius: 6, fontSize: 13 }}><strong style={{ color: '#38bdf8' }}>Price Opportunity:</strong> ON Thyme pricing 18% below 8-week average on Onion Cooking. Consider bulk.</div>
                                    <div style={{ background: 'rgba(251,146,60,0.07)', borderLeft: '3px solid #fb923c', padding: '10px 14px', borderRadius: 6, fontSize: 13 }}><strong style={{ color: '#fb923c' }}>Demand Spike:</strong> French Beans demand +34% vs 4-week baseline.</div>
                                    <div style={{ background: 'rgba(52,211,153,0.07)', borderLeft: '3px solid #34d399', padding: '10px 14px', borderRadius: 6, fontSize: 13 }}><strong style={{ color: '#34d399' }}>Savings:</strong> T28 container order 8 units below volume discount threshold.</div>
                                </div>
                            </div>
                        </div>
                    )}
                </>
            )}
        </div>
    );
}

