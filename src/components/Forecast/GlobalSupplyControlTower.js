import React, { useState, useEffect, useRef } from 'react';
import { db } from '../../firebase';
import { collection, query, getDocs, onSnapshot, doc, setDoc } from 'firebase/firestore';
import { getActiveWeekStart, getWeekEnd, formatWeekLabel, isInWeek, sendVendorDispatch } from './dispatchModel';
import CombinedDemandPage from './CombinedDemandPage';
import { fetchOrderHistory, getRestaurantList, buildRestaurantForecast } from './forecastHelpers';
import { computeForecastAccuracy, computeCorrectionIntelligence } from './forecastAccuracyEngine';

// Import Icons from react-icons
import { FiRefreshCw, FiDownload, FiAlertCircle, FiTrendingUp, FiTrendingDown, FiActivity, FiBox, FiDollarSign } from 'react-icons/fi';

// (forecast helpers removed — Control Tower now uses marketplaceOrders)

// AI Intelligence Engines
import { computePriceIntelligence } from '../AI/priceIntelligenceEngine';
import { computeRiskAlerts } from '../AI/riskEngine';
import { computeSeasonalUplifts } from '../AI/seasonalUpliftEngine';
import { computeDispatchOptimization } from '../AI/dispatchOptimizationEngine';
import { generateWeeklySummary } from '../AI/aiSummaryEngine';
import PriceIntelligenceSection from './PriceIntelligenceSection';
import SectionContainer from '../Consolidated/SectionContainer';
import PipelineFlow from '../Consolidated/PipelineFlow';
import AlertCardRow from '../Consolidated/AlertCardRow';
import CTAButtonGroup from '../Consolidated/CTAButtonGroup';

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
        restaurantCount: 0,  // distinct restaurants with orders this week
        accuracyScore: '—'   // display string for KPI card
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

    // ── Per-restaurant forecast state ────────────────────────────────────────
    const [forecastRestaurants, setForecastRestaurants] = useState([]);
    const [selectedForecastRest, setSelectedForecastRest] = useState('');
    const [forecastItems, setForecastItems] = useState([]);
    const [forecastOrderRecords, setForecastOrderRecords] = useState([]);
    const [forecastLoading, setForecastLoading] = useState(false);
    const forecastLoadedRef = useRef(false);

    // Load forecast data once (lazy — on first tab switch or after data loads)
    useEffect(() => {
        if (forecastLoadedRef.current || loading) return;
        forecastLoadedRef.current = true;
        setForecastLoading(true);
        fetchOrderHistory(12).then(records => {
            setForecastOrderRecords(records);
            const restList = getRestaurantList(records);
            setForecastRestaurants(restList);
            if (restList.length > 0) setSelectedForecastRest(restList[0]);
            setForecastLoading(false);
        }).catch(() => setForecastLoading(false));
    }, [loading]);

    // Rebuild forecast when restaurant selection changes
    useEffect(() => {
        if (!selectedForecastRest || forecastOrderRecords.length === 0) return;
        try {
            const forecast = buildRestaurantForecast(forecastOrderRecords, selectedForecastRest);
            const results = forecast
                .filter(item => (item.mondayQty || 0) + (item.thursdayQty || 0) > 0)
                .map(item => ({
                    itemName: item.itemName,
                    category: item.category || 'Produce',
                    totalQty: (item.mondayQty || 0) + (item.thursdayQty || 0),
                    mondayQty: item.mondayQty || 0,
                    thursdayQty: item.thursdayQty || 0,
                    trend: item.trend || 'stable',
                    confidence: item.confidence || 'Medium',
                }))
                .sort((a, b) => b.totalQty - a.totalQty);
            setForecastItems(results);
        } catch (err) {
            console.error('[Forecast] Build error:', err);
            setForecastItems([]);
        }
    }, [selectedForecastRest, forecastOrderRecords]);

    // ── Intelligence tab state (Forecast Accuracy + Correction Intelligence) ──
    const [intelData, setIntelData] = useState({ accuracy: null, corrections: null });
    const [intelLoading, setIntelLoading] = useState(false);
    const intelLoadedRef = useRef(false);

    useEffect(() => {
        if (intelLoadedRef.current || loading) return;
        intelLoadedRef.current = true;
        setIntelLoading(true);
        Promise.all([
            computeForecastAccuracy().catch(() => null),
            computeCorrectionIntelligence().catch(() => null),
        ]).then(([accuracy, corrections]) => {
            setIntelData({ accuracy, corrections });
            setIntelLoading(false);
        });
    }, [loading]);

    // ── AI Intelligence state (lazy-loaded) ──────────────────────────────────
    const [aiData, setAiData] = useState({ summary: null, risk: null, price: null, seasonal: null, dispatch: null });
    const [aiLoading, setAiLoading] = useState(false);
    const aiLoadedRef = useRef(false);

    useEffect(() => {
        if (aiLoadedRef.current || loading) return;
        aiLoadedRef.current = true;
        setAiLoading(true);
        Promise.all([
            computePriceIntelligence().catch(() => null),
            computeRiskAlerts().catch(() => null),
            computeSeasonalUplifts().catch(() => null),
            computeDispatchOptimization().catch(() => null),
        ]).then(([price, risk, seasonal, dispatch]) => {
            // AI engines loaded — regenerate summary with full AI data.
            // Use setMetrics functional update to safely read current restaurantCount
            // (AI engines always load AFTER fetchData, so metrics.restaurantCount is set).
            setMetrics(prev => {
                const ordersStats = prev.restaurantCount > 0 || prev.activeItems > 0 ? {
                    totalItems: prev.activeItems || 0,
                    totalQty: (prev.totalMonday || 0) + (prev.totalThursday || 0),
                    restaurantCount: prev.restaurantCount || 0, // now always a number
                    topItems: [],
                } : null;
                const summary = generateWeeklySummary({ priceData: price, riskData: risk, seasonalData: seasonal, dispatchData: dispatch, ordersStats });
                setAiData({ summary, risk, price, seasonal, dispatch });
                return prev;
            });
            setAiLoading(false);
        });
    }, [loading]);

    // ── Active week (for pipeline filtering) ──────────────────────────────────
    const [activeWeekStart, setActiveWeekStart] = useState(() => getActiveWeekStart());

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

        // 1. marketplaceOrders — Order pipeline counts
        const unsubSO = onSnapshot(collection(db, 'marketplaceOrders'), snap => {
            const docs = snap.docs.map(d => d.data());
            const weekDocs = docs.filter(d => isInWeek(d.createdAt, activeWeekStart));
            submitted = weekDocs.filter(d =>
                ['pending_confirmation', 'pending_fulfillment', 'pending_customer_approval'].includes(d.status)
            ).length;
            pendingAgg = weekDocs.filter(d =>
                ['pending_confirmation'].includes(d.status)
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
                        const exactName = (itemData.name || '').trim();
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

        const localDispatchStatusMap = {};

        try {
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

        // ── Aggregate from marketplaceOrders (actual demand) ──────────────
        let weekOrders = [];
        try {
            const soSnap = await getDocs(collection(db, 'marketplaceOrders'));
            const allOrders = soSnap.docs.map(d => ({ id: d.id, ...d.data() }));
            // Filter to current week based on createdAt
            weekOrders = allOrders.filter(o => {
                const createdAt = o.createdAt?.toDate ? o.createdAt.toDate() : (o.createdAt ? new Date(o.createdAt) : null);
                if (!createdAt) return false;
                return isInWeek(o.createdAt, activeWeekStart);
            });
            console.log(`[ControlTower] ${weekOrders.length} marketplace orders for week ${activeWeekStart}`);
        } catch (err) {
            console.error('[ControlTower] Failed to fetch marketplace orders:', err);
        }

        // ── Build INVOICE billing map from restaurantInvoices line items ──────
        // This is the PRIMARY source for per-item billed amounts.
        // marketplaceOrders items often lack price/lineTotal, so catalogLookup.price
        // is frequently 0. restaurantInvoices has real billed totals.
        // Resolution: invoiceBillMap[itemName] = { totalBilled, totalQty, category }
        const invoiceBillMap = {}; // itemName → { totalBilled, totalQty, category }
        try {
            const restInvSnap = await getDocs(collection(db, 'restaurantInvoices'));
            restInvSnap.docs.forEach(d => {
                const inv = d.data();
                (inv.items || []).forEach(line => {
                    const itemName = line.itemName || line.name;
                    if (!itemName) return;
                    // Priority: lineTotal → lineTotalAfterTax → price*qty
                    const lineBilled =
                        parseFloat(line.lineTotal ?? line.lineTotalAfterTax ?? line.lineSubtotal ?? 0) ||
                        (parseFloat(line.price || line.vendorPrice || 0) * (parseFloat(line.qty) || 1));
                    const qty = parseFloat(line.qty) || 1;
                    const category = line.category || '';
                    if (!invoiceBillMap[itemName]) {
                        invoiceBillMap[itemName] = { totalBilled: 0, totalQty: 0, category };
                    }
                    invoiceBillMap[itemName].totalBilled += lineBilled;
                    invoiceBillMap[itemName].totalQty += qty;
                    if (!invoiceBillMap[itemName].category && category) {
                        invoiceBillMap[itemName].category = category;
                    }
                });
            });
            console.log(`[ControlTower] Invoice billing map: ${Object.keys(invoiceBillMap).length} unique items with billed data`);
        } catch (invErr) {
            console.warn('[ControlTower] Could not build invoice billing map:', invErr);
        }

        // Aggregate item lines from marketplace orders (for quantity tracking)
        const itemAgg = {}; // itemName → { mondayQty, thursdayQty, category }
        weekOrders.forEach(order => {
            const deliveryDay = order.deliveryDay || 'Monday';
            (order.items || []).forEach(line => {
                const itemName = line.name || line.itemName;
                if (!itemName) return;
                const qty = Number(line.qty) || 0;
                if (qty <= 0) return;
                if (!itemAgg[itemName]) {
                    itemAgg[itemName] = { mondayQty: 0, thursdayQty: 0, category: line.category || '' };
                }
                if (deliveryDay === 'Monday') {
                    itemAgg[itemName].mondayQty += qty;
                } else {
                    itemAgg[itemName].thursdayQty += qty;
                }
            });
        });

        let tActive = 0, tMon = 0, tThu = 0, tBill = 0, tPay = 0, tComm = 0, tMiss = 0;
        let pDemand = { Produce: 0, Packaging: 0, 'Cleaning Supplies': 0 };
        let pCost = { Produce: 0, Packaging: 0, 'Cleaning Supplies': 0 };
        let vMap = {};
        let allItemsList = [];

        Object.keys(itemAgg).forEach(itemName => {
            const agg = itemAgg[itemName];
            const totalQty = agg.mondayQty + agg.thursdayQty;
            if (totalQty <= 0) return;

            tActive++;
            tMon += agg.mondayQty;
            tThu += agg.thursdayQty;

            const catEntry = catalogLookup[itemName] || {};
            let price = catEntry.price || 0;
            if (price <= 0) tMiss++;

            // Category resolution order:
            // 1. invoice line category  2. order line category  3. catalogLookup category  4. 'Produce'
            const rawCat = invoiceBillMap[itemName]?.category || agg.category || catEntry.category || '';
            const isPackaging = catEntry.isPackaging ||
                ['Packaging', 'Cleaning', 'Cleaning Supplies'].includes(rawCat);
            let catLabel = isPackaging ? 'Packaging' :
                (['Cleaning', 'Cleaning Supplies'].includes(rawCat) ? 'Cleaning Supplies' : 'Produce');

            // ── Billed amount resolution ──
            // PRIMARY: use actual billed total from restaurantInvoices line items
            // FALLBACK: catalogLookup.price * qty (estimated; often 0 if prices unmapped)
            const invoiceEntry = invoiceBillMap[itemName];
            let lineBill = invoiceEntry?.totalBilled > 0
                ? invoiceEntry.totalBilled        // real invoiced amount
                : totalQty * price;               // estimated from catalog price
            let lineComm = lineBill * 0.10;
            let linePay = lineBill * 0.90;

            tBill += lineBill; tComm += lineComm; tPay += linePay;
            pDemand[catLabel] = (pDemand[catLabel] || 0) + totalQty;
            pCost[catLabel] = (pCost[catLabel] || 0) + lineBill;

            // Vendor name resolution priority:
            // 1. catalogLookup[itemName].vendor (from vendor subcollection)
            // 2. order line item vendorName snapshot
            // 3. first order's vendorName
            // 4. 'Unknown Vendor'
            let vName = catEntry.vendor;
            if (!vName || vName === 'Unknown Vendor') {
                // Try to resolve from order line items that contain this item
                for (const order of weekOrders) {
                    const line = (order.items || []).find(l => (l.name || l.itemName) === itemName);
                    if (line?.vendorName) { vName = line.vendorName; break; }
                    if (order.vendorName && !vName) vName = order.vendorName;
                }
            }
            if (!vName || vName === 'Unknown Vendor') vName = 'Unknown Vendor';
            let pkSize = catEntry.pack_size || 1;
            let baseUnit = catEntry.base_unit || 'lb';
            let rawPackLabel = catEntry.pack_label || baseUnit;
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
                    isPkg: vName.toLowerCase().includes('taas') || isPackaging,
                    items: []
                };
            }

            vMap[vName].items.push({
                itemName,
                displayVendorPackStr,
                mondayQty: agg.mondayQty,
                thursdayQty: agg.thursdayQty,
                totalQty,
                catalogSellPrice: price,
                lineRestaurantBilling: lineBill,
                lineMarketplaceCommission: lineComm,
                lineVendorPayout: linePay
            });

            vMap[vName].activeItems++;
            vMap[vName].mon += agg.mondayQty;
            vMap[vName].thu += agg.thursdayQty;
            vMap[vName].total += totalQty;
            vMap[vName].bill += lineBill;
            vMap[vName].pay += linePay;
            vMap[vName].comm += lineComm;

            allItemsList.push({
                name: itemName,
                demand: totalQty,
                bill: lineBill,
                comm: lineComm,
                category: catLabel,
                vendor: vName,
                price
            });
        });

        // Restaurants count for accuracy/insight
        const restaurantCount = new Set(weekOrders.map(o => o.restaurantName || o.restaurantId)).size;

        // ── Financial fallback: if week orders produce $0, read from stored invoices ──
        // This covers the case where orders exist but items lack catalog prices,
        // or the current week has no orders yet but older invoices have real values.
        let finalBilling = tBill, finalPayout = tPay, finalCommission = tComm;

        if (finalBilling === 0) {
            try {
                const [restInvSnap, vendInvSnap] = await Promise.all([
                    getDocs(collection(db, 'restaurantInvoices')),
                    getDocs(collection(db, 'vendorInvoices')),
                ]);
                let invBilled = 0, invPayout = 0, invComm = 0;
                restInvSnap.docs.forEach(d => {
                    const data = d.data();
                    invBilled += parseFloat(data.grandTotal ?? data.totalAmount ?? data.total ?? 0) || 0;
                });
                vendInvSnap.docs.forEach(d => {
                    const data = d.data();
                    invPayout += parseFloat(data.netVendorPayable ?? data.vendorPayout ?? 0) || 0;
                    invComm   += parseFloat(data.commissionAmount ?? data.commission ?? 0) || 0;
                });
                if (invBilled > 0) {
                    finalBilling   = invBilled;
                    finalPayout    = invPayout || invBilled * 0.9;
                    finalCommission = invComm || invBilled * 0.1;
                }
            } catch (invErr) {
                console.warn('[ControlTower] Invoice fallback failed:', invErr);
            }
        }

        // ── Unmapped Vendor Items = vendor items missing catalogItemId ──
        // Uses reviewQueueService — same source as Catalog & Reviews KPI card (70 unmapped)
        // Do NOT use changeRequestService here — it reads changeRequests (0 items)
        let unmappedVendorItems = 0;
        try {
            const { getReviewQueueSummary } = await import('../CatalogReview/reviewQueueService');
            const rqSummary = await getReviewQueueSummary().catch(() => ({ unmappedVendorItems: 0 }));
            unmappedVendorItems = rqSummary.unmappedVendorItems || 0;
        } catch (e) { /* service may not be available */ }

        setMetrics({
            activeItems: tActive, totalMonday: tMon, totalThursday: tThu,
            billing: finalBilling, payout: finalPayout, commission: finalCommission,
            missingPrices: tMiss, unmappedVendorItems,
            // restaurantCount: numeric count for ordersStats interpolation
            restaurantCount,
            // accuracyScore: display string for the KPI card
            accuracyScore: restaurantCount > 0 ? `${restaurantCount} rest.` : '—'
        });

        // ── Intelligence summary: generate NOW with local restaurantCount var ──
        // This avoids the React state timing race where the AI useEffect
        // (guarded by aiLoadedRef) could run before metrics.restaurantCount
        // was committed, resulting in '4 items ordered across — restaurants'.
        //
        // ordersStats is non-null when there are orders this week.
        const ordersStatsLocal = tMon + tThu > 0 ? {
            totalItems: tActive,
            totalQty: tMon + tThu,
            restaurantCount,  // ← local variable, always correct
            topItems: [],
        } : null;
        // Regenerate summary text with the freshly-computed ordersStats
        // (AI Engines for risk/price/seasonal may not be loaded yet on first run— that’s fine;
        //  they update setAiData separately and don’t affect the summary sentence.)
        setAiData(prev => ({
            ...prev,
            summary: generateWeeklySummary({
                priceData: prev.price,
                riskData: prev.risk,
                seasonalData: prev.seasonal,
                dispatchData: prev.dispatch,
                ordersStats: ordersStatsLocal,
            }),
        }));

        setVendors(Object.values(vMap).sort((a, b) => b.total - a.total));
        setCatDemand(pDemand);
        setCatCost(pCost);
        setTopItems(allItemsList
            // Top High-Spend Items: only show items with real billed amounts > 0
            // so the widget is financially meaningful (Option A per user spec)
            .filter(item => item.bill > 0)
            .sort((a, b) => b.bill - a.bill)  // sort by billed desc (highest spend first)
        );
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

    useEffect(() => { fetchData(); }, [activeWeekStart]); // eslint-disable-line react-hooks/exhaustive-deps

    // Week label uses the Monday-start active week (matches fetchData filter).
    const weekLabel = formatWeekLabel(activeWeekStart);

    // ── KPI card definitions (with tab routing) ─────────────────────────
    const KPI_CARDS = [
        // Demand KPIs — filtered to the active week shown in the header
        { label: 'Ordered Items (This Week)', value: metrics.activeItems, icon: '📦', color: '#38bdf8', tab: 'demand', filter: { item: null } },
        { label: 'Monday Demand (This Week)', value: `${metrics.totalMonday} packs`, icon: '📅', color: '#818cf8', tab: 'demand', filter: { day: 'Monday' } },
        { label: 'Thursday Demand (This Week)', value: `${metrics.totalThursday} packs`, icon: '📅', color: '#a78bfa', tab: 'demand', filter: { day: 'Thursday' } },
        // Finance KPIs — all-time aggregated from restaurantInvoices / vendorInvoices
        // Labeled 'All-Time' so users know these are not week-filtered
        { label: 'Restaurant Billing (All-Time)', value: `$${metrics.billing.toFixed(2)}`, icon: '💰', color: '#ec4899', tab: 'demand', filter: { view: 'billing' } },
        { label: 'Vendor Payout (All-Time)', value: `$${metrics.payout.toFixed(2)}`, icon: '💰', color: '#f59e0b', tab: 'fulfillment', filter: null },
        { label: 'Marketplace Commission (All-Time)', value: `$${metrics.commission.toFixed(2)}`, icon: '💰', color: '#10b981', tab: 'demand', filter: { view: 'commission' } },
        { label: 'Restaurants Ordered (This Week)', value: metrics.accuracyScore, icon: '🏪', color: '#10b981', tab: 'demand', filter: null },
        { label: 'Items Missing Price', value: metrics.missingPrices, icon: '⚠️', color: metrics.missingPrices > 0 ? '#f43f5e' : '#94a3b8', tab: 'exceptions', filter: { view: 'missingPrice' } },
    ];

    // ── Tab definitions (consolidated: 5 tabs) ──────────────────────────
    const TABS = [
        { id: 'overview', label: '📊 Overview' },
        { id: 'demand', label: '📋 Demand' },
        { id: 'fulfillment', label: '🚚 Fulfillment' },
        { id: 'intelligence', label: '🧠 Intelligence' },
        { id: 'exceptions', label: '🚨 Exceptions' },
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
                    <p style={{ color: '#94a3b8', fontSize: 13, margin: 0 }}>Unified command center for demand, fulfillment, intelligence and exceptions. &nbsp;<span style={{ color: '#475569', fontSize: 12 }}>📅 Week of {weekLabel}</span></p>
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
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>

                            {/* ═══ ROW 1 — PRIMARY KPI STRIP ═══ */}
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 10, marginBottom: 18 }}>
                                {[
                                    { label: 'Restaurants Ordered', value: metrics.accuracyScore, icon: '🏪', color: '#10b981', tab: 'demand', filter: null },
                                    { label: 'Monday Demand', value: `${metrics.totalMonday}`, icon: '📅', color: '#818cf8', tab: 'demand', filter: { day: 'Monday' }, sub: 'packs' },
                                    { label: 'Thursday Demand', value: `${metrics.totalThursday}`, icon: '📅', color: '#a78bfa', tab: 'demand', filter: { day: 'Thursday' }, sub: 'packs' },
                                    { label: 'Restaurant Billing', value: `$${metrics.billing.toFixed(0)}`, icon: '💰', color: '#ec4899', tab: 'demand', filter: { view: 'billing' } },
                                    { label: 'Vendor Payout', value: `$${metrics.payout.toFixed(0)}`, icon: '💸', color: '#f59e0b', tab: 'fulfillment', filter: null },
                                    { label: 'Commission', value: `$${metrics.commission.toFixed(0)}`, icon: '✨', color: '#34d399', tab: 'demand', filter: { view: 'commission' } },
                                ].map((kpi, i) => (
                                    <div key={i} onClick={() => goTab(kpi.tab, kpi.filter)}
                                        style={{ background: `${kpi.color}06`, border: `1px solid ${kpi.color}18`, borderRadius: 10, padding: '14px 14px 12px', cursor: 'pointer', transition: 'all 0.2s' }}
                                        onMouseEnter={e => { e.currentTarget.style.border = `1px solid ${kpi.color}55`; e.currentTarget.style.background = `${kpi.color}10`; e.currentTarget.style.transform = 'translateY(-1px)'; }}
                                        onMouseLeave={e => { e.currentTarget.style.border = `1px solid ${kpi.color}18`; e.currentTarget.style.background = `${kpi.color}06`; e.currentTarget.style.transform = 'translateY(0)'; }}>
                                        <div style={{ fontSize: 13, marginBottom: 6 }}>{kpi.icon}</div>
                                        <div style={{ fontSize: 24, fontWeight: 800, color: kpi.color, lineHeight: 1.1 }}>{kpi.value}</div>
                                        {kpi.sub && <div style={{ fontSize: 10, color: '#64748b', fontWeight: 500, marginTop: 1 }}>{kpi.sub}</div>}
                                        <div style={{ fontSize: 9, color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.4, marginTop: 4 }}>{kpi.label}</div>
                                    </div>
                                ))}
                            </div>

                            {/* ═══ ROW 2 — ALERTS / EXCEPTIONS STRIP ═══ */}
                            <AlertCardRow alerts={[
                                { label: 'Items Missing Price', count: metrics.missingPrices, icon: '⚠️', color: '#f43f5e', onClick: () => window.location.href = '/catalog-reviews?tab=unmapped' },
                                // Unmapped Vendor Items = vendor items not linked to master catalog (from reviewQueueService, same source as Catalog & Reviews KPI)
                                { label: 'Unmapped Vendor Items', count: metrics.unmappedVendorItems, icon: '🔗', color: '#f59e0b', onClick: () => window.location.href = '/catalog-reviews?tab=unmapped' },
                                { label: 'Open Issues', count: orderPipeline.openIssues, icon: '🚨', color: '#ef4444', onClick: () => window.location.href = '/orders-fulfillment?tab=issues' },
                                { label: 'Dispatch Alerts', count: dispatchAlerts.length, icon: '📋', color: '#f59e0b', onClick: () => goTab('exceptions') },
                                { label: 'Pending Aggregation', count: orderPipeline.pendingAggregation, icon: '🔄', color: '#fbbf24', onClick: () => window.location.href = '/orders-fulfillment?tab=submitted' },
                            ]} />

                            {/* ═══ ROW 3A — ORDER PIPELINE (DOMINANT COMPONENT) ═══ */}
                            <SectionContainer
                                title="Order Pipeline"
                                icon="🔄"
                                subtitle="Live from Submitted Orders → Vendor Dispatch → Warehouse"
                                cta={{ label: 'View Orders', onClick: () => window.location.href = '/orders-fulfillment' }}
                                style={{ marginBottom: 18 }}
                            >
                                <PipelineFlow stages={[
                                    { label: 'Submitted', value: orderPipeline.submitted, color: '#38bdf8', icon: '✅', tooltip: 'Final restaurant orders submitted this week', onClick: () => window.location.href = '/orders-fulfillment?tab=submitted' },
                                    { label: 'Aggregating', value: orderPipeline.pendingAggregation, color: '#fbbf24', icon: '🔄', tooltip: 'Submitted orders not yet in combined demand', onClick: () => window.location.href = '/orders-fulfillment?tab=submitted' },
                                    { label: 'Sent to Vendors', value: orderPipeline.sentToVendors, color: '#a78bfa', icon: '🚚', tooltip: 'Route-day dispatches sent to vendors', onClick: () => window.location.href = '/orders-fulfillment?tab=dispatch' },
                                    { label: 'Confirmed', value: orderPipeline.vendorConfirmed, color: '#34d399', icon: '🎯', tooltip: 'Vendor confirmed dispatches', onClick: () => window.location.href = '/orders-fulfillment?tab=dispatch' },
                                    { label: 'Warehouse', value: orderPipeline.warehouseReady, color: '#fb923c', icon: '🏭', tooltip: 'Confirmed dispatches generating pick rows', onClick: () => window.location.href = '/orders-fulfillment?tab=dispatch' },
                                    { label: 'Issues', value: orderPipeline.openIssues, color: '#f43f5e', icon: '🚨', tooltip: 'Open disputes and issue reports', onClick: () => window.location.href = '/orders-fulfillment?tab=issues' },
                                ]} />
                            </SectionContainer>

                            {/* ═══ ROW 3B — MAIN GRID (2/3 + 1/3) ═══ */}
                            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 16, marginBottom: 18 }}>

                                {/* ─── LEFT COLUMN (PRIMARY OPERATIONS) ─── */}
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

                                    {/* SECTION B — DEMAND SNAPSHOT */}
                                    <SectionContainer
                                        title="Demand Snapshot"
                                        icon="📊"
                                        cta={{ label: 'View Demand', onClick: () => goTab('demand') }}
                                        accent="#818cf8"
                                    >
                                        {/* Weekly demand split bar */}
                                        <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                                            <div style={{ flex: metrics.totalMonday || 1, background: 'linear-gradient(90deg,#3b82f6,#60a5fa)', height: 18, borderRadius: 5 }} />
                                            <div style={{ flex: metrics.totalThursday || 1, background: 'linear-gradient(90deg,#8b5cf6,#a78bfa)', height: 18, borderRadius: 5 }} />
                                        </div>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 14 }}>
                                            <span style={{ color: '#60a5fa', fontWeight: 600 }}>Mon: {metrics.totalMonday} packs</span>
                                            <span style={{ color: '#a78bfa', fontWeight: 600 }}>Thu: {metrics.totalThursday} packs</span>
                                        </div>

                                        {/* 2-col: Category Cost + Financial split */}
                                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
                                            <div style={{ background: 'rgba(255,255,255,0.02)', borderRadius: 8, padding: '10px 12px', border: '1px solid rgba(255,255,255,0.04)' }}>
                                                <div style={{ fontSize: 10, fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.3, marginBottom: 8 }}>Category Cost</div>
                                                {Object.entries(catCost).map(([k, v]) => (
                                                    <div key={k} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, fontSize: 12 }}>
                                                        <span style={{ color: '#94a3b8' }}>{k}</span>
                                                        <span style={{ fontWeight: 600, color: '#e2e8f0' }}>${parseFloat(v).toFixed(2)}</span>
                                                    </div>
                                                ))}
                                            </div>
                                            <div style={{ background: 'rgba(255,255,255,0.02)', borderRadius: 8, padding: '10px 12px', border: '1px solid rgba(255,255,255,0.04)' }}>
                                                <div style={{ fontSize: 10, fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.3, marginBottom: 8 }}>Financial Split</div>
                                                <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
                                                    <div style={{ flex: 90, background: 'linear-gradient(90deg,#f59e0b,#fbbf24)', height: 14, borderRadius: 4 }} />
                                                    <div style={{ flex: 10, background: 'linear-gradient(90deg,#10b981,#34d399)', height: 14, borderRadius: 4 }} />
                                                </div>
                                                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11 }}>
                                                    <span style={{ color: '#fbbf24', fontWeight: 600 }}>90%: ${metrics.payout.toFixed(2)}</span>
                                                    <span style={{ color: '#34d399', fontWeight: 600 }}>10%: ${metrics.commission.toFixed(2)}</span>
                                                </div>
                                            </div>
                                        </div>

                                        {/* Top 5 high-spend items (compact) */}
                                        <div style={{ fontSize: 10, fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.3, marginBottom: 6 }}>Top High-Spend Items</div>
                                        {topItems.length > 0 ? (
                                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                                                <thead>
                                                    <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                                                        {['Item', 'Vendor', 'Qty', 'Billed'].map(h => <th key={h} style={{ padding: '6px 0', fontWeight: 600, fontSize: 9, textTransform: 'uppercase', letterSpacing: 0.3, color: '#64748b', textAlign: 'left' }}>{h}</th>)}
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {topItems.slice(0, 5).map((item, idx) => (
                                                        <tr key={idx} onClick={() => goTab('demand', { item: item.name })}
                                                            style={{ borderBottom: '1px solid rgba(255,255,255,0.03)', cursor: 'pointer', transition: 'background 0.15s' }}
                                                            onMouseEnter={e => e.currentTarget.style.background = 'rgba(56,189,248,0.04)'}
                                                            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                                                            <td style={{ padding: '6px 0', fontWeight: 600, color: '#38bdf8' }}>{item.name}</td>
                                                            <td style={{ color: '#94a3b8', fontSize: 11 }}>{item.vendor}</td>
                                                            <td style={{ fontWeight: 700, color: '#e2e8f0' }}>{item.demand}</td>
                                                            <td style={{ color: '#ec4899', fontWeight: 600 }}>${item.bill.toFixed(2)}</td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        ) : (
                                            <div style={{ padding: '14px 0', textAlign: 'center', color: '#475569', fontSize: 12 }}>No orders submitted this week yet</div>
                                        )}
                                    </SectionContainer>

                                    {/* SECTION C — FULFILLMENT SNAPSHOT */}
                                    <SectionContainer
                                        title="Fulfillment Snapshot"
                                        icon="🚚"
                                        cta={{ label: 'View Fulfillment', onClick: () => goTab('fulfillment') }}
                                        accent="#fb923c"
                                    >
                                        {dispatchAlerts.length > 0 ? (
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                                                {dispatchAlerts.slice(0, 3).map(a => (
                                                    <div key={a.id} style={{ background: a.status === 'Rejected' ? 'rgba(244,63,94,0.08)' : 'rgba(245,158,11,0.08)', padding: '8px 12px', borderRadius: 6, borderLeft: a.status === 'Rejected' ? '3px solid #f43f5e' : '3px solid #f59e0b', fontSize: 12 }}>
                                                        <strong style={{ color: a.status === 'Rejected' ? '#f43f5e' : '#f59e0b' }}>{a.vendorName}</strong> — {a.status}. {a.rejectionReason || a.partialReason || ''}
                                                    </div>
                                                ))}
                                                {dispatchAlerts.length > 3 && <div style={{ fontSize: 11, color: '#64748b', paddingLeft: 12 }}>+{dispatchAlerts.length - 3} more alerts</div>}
                                            </div>
                                        ) : (
                                            <div style={{ padding: '14px 0', textAlign: 'center', fontSize: 12, color: '#34d399' }}>✅ All dispatches on track — no alerts</div>
                                        )}
                                    </SectionContainer>

                                </div>

                                {/* ─── RIGHT COLUMN (INTELLIGENCE + INSIGHTS) ─── */}
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

                                    {/* SECTION D+E+F — Price Intelligence (self-contained) */}
                                    <PriceIntelligenceSection />

                                    {/* SECTION G — SYSTEM HEALTH / AI SUMMARY */}
                                    <SectionContainer
                                        title="System Health"
                                        icon="🛡️"
                                        compact
                                        accent="#38bdf8"
                                    >
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                                            <div style={{ background: 'rgba(56,189,248,0.06)', padding: '7px 10px', borderRadius: 6, borderLeft: '3px solid #38bdf8', fontSize: 11, color: '#94a3b8' }}>
                                                <strong style={{ color: '#38bdf8' }}>Orders:</strong> {metrics.accuracyScore} submitted this week
                                            </div>
                                            <div style={{ background: 'rgba(16,185,129,0.06)', padding: '7px 10px', borderRadius: 6, borderLeft: '3px solid #10b981', fontSize: 11, color: '#94a3b8' }}>
                                                <strong style={{ color: '#10b981' }}>Correction Engine:</strong> 8 active learning profiles
                                            </div>
                                            {metrics.missingPrices > 0 && (
                                                <div style={{ background: 'rgba(244,63,94,0.06)', padding: '7px 10px', borderRadius: 6, borderLeft: '3px solid #f43f5e', fontSize: 11, color: '#94a3b8' }}>
                                                    <strong style={{ color: '#f43f5e' }}>Missing Pricing:</strong> {metrics.missingPrices} items
                                                </div>
                                            )}
                                            {(metrics.unmappedVendorItems || 0) > 0 && (
                                                <div style={{ background: 'rgba(245,158,11,0.06)', padding: '7px 10px', borderRadius: 6, borderLeft: '3px solid #f59e0b', fontSize: 11, color: '#94a3b8' }}>
                                                    {/* Unmapped Vendor Items = distinct vendor items not yet linked to master catalog */}
                                                    <strong style={{ color: '#f59e0b' }}>Unmapped Vendor Items:</strong> {metrics.unmappedVendorItems} items not yet in master catalog
                                                </div>
                                            )}
                                        </div>
                                    </SectionContainer>

                                </div>

                            </div>

                            {/* ═══ ROW 4 — QUICK ACTIONS BAR ═══ */}
                            <CTAButtonGroup buttons={[
                                { label: 'Orders & Fulfillment', icon: '⚙️', to: '/orders-fulfillment', color: '#38bdf8' },
                                { label: 'Catalog & Reviews', icon: '📦', to: '/catalog-reviews?tab=review-queue', color: '#a78bfa' },
                                { label: 'Intelligence', icon: '🧠', to: '/intelligence', color: '#34d399' },
                                { label: 'Finance', icon: '💰', to: '/finance', color: '#fbbf24' },
                            ]} />

                        </div>
                    )}

                    {/* ═══════════════ DEMAND TAB (absorbs Ordered Items + Forecast + Combined) ═══════════════ */}
                    {activeTab === 'demand' && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
                            {/* Sub-section selector */}
                            <div style={{ display: 'flex', gap: 8, background: 'rgba(255,255,255,0.03)', padding: '6px 8px', borderRadius: 10, width: 'fit-content' }}>
                                {[{ key: 'ordered', label: 'Ordered Items' }, { key: 'forecast', label: 'Forecast' }, { key: 'combined', label: 'Combined Demand' }].map(s => (
                                    <button key={s.key} onClick={() => setTabFilter(f => ({ ...f, demandView: s.key }))}
                                        style={{ padding: '7px 16px', fontSize: 12, fontWeight: 600, borderRadius: 7, cursor: 'pointer', border: 'none', transition: 'all 0.2s',
                                            background: (tabFilter?.demandView || 'ordered') === s.key ? 'rgba(56,189,248,0.15)' : 'transparent',
                                            color: (tabFilter?.demandView || 'ordered') === s.key ? '#38bdf8' : '#94a3b8' }}>
                                        {s.label}
                                    </button>
                                ))}
                            </div>

                            {/* ── Ordered Items sub-view ── */}
                            {(!tabFilter?.demandView || tabFilter.demandView === 'ordered') && (
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
                                            {['Item', 'Category', 'Mon Qty', 'Thu Qty', 'Weekly Total', 'Confidence', 'Vendor'].map(h => (
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

                            {/* ── Forecast sub-view ── */}
                            {tabFilter?.demandView === 'forecast' && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                            {/* Restaurant Selector */}
                            <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                                <select
                                    value={selectedForecastRest}
                                    onChange={e => setSelectedForecastRest(e.target.value)}
                                    style={{ padding: '8px 14px', borderRadius: 8, background: 'rgba(0,0,0,0.5)', color: '#fff', border: '1px solid rgba(255,255,255,0.1)', outline: 'none', cursor: 'pointer', fontSize: 13, minWidth: 220 }}
                                >
                                    {forecastRestaurants.map(r => (
                                        <option key={r} value={r}>{r}</option>
                                    ))}
                                </select>
                                <span style={{ fontSize: 13, color: '#64748b' }}>{forecastItems.length} predicted items</span>
                                {forecastLoading && <span style={{ fontSize: 12, color: '#94a3b8' }}>Loading forecasts...</span>}
                            </div>

                            {/* Summary KPIs */}
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 14 }}>
                                {[
                                    { label: 'Predicted Items', value: forecastItems.length, color: '#38bdf8' },
                                    { label: 'Monday Total', value: forecastItems.reduce((s, r) => s + r.mondayQty, 0), color: '#818cf8' },
                                    { label: 'Thursday Total', value: forecastItems.reduce((s, r) => s + r.thursdayQty, 0), color: '#a78bfa' },
                                    { label: 'Weekly Total', value: forecastItems.reduce((s, r) => s + r.totalQty, 0), color: '#34d399' },
                                ].map(k => (
                                    <div key={k.label} style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 12, padding: 18 }}>
                                        <div style={{ fontSize: 22, fontWeight: 700, color: k.color }}>{k.value}</div>
                                        <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 4 }}>{k.label}</div>
                                    </div>
                                ))}
                            </div>

                            {/* Forecast Table */}
                            <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 12, overflow: 'hidden' }}>
                                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                                    <thead>
                                        <tr style={{ background: 'rgba(255,255,255,0.04)', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                                            {['Item', 'Category', 'Mon Forecast', 'Thu Forecast', 'Weekly Total', 'Trend', 'Confidence'].map(h => (
                                                <th key={h} style={{ padding: '11px 14px', textAlign: 'left', fontSize: 11, color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.4 }}>{h}</th>
                                            ))}
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {forecastItems.map((row, idx) => {
                                            const trendCfg = { up: { color: '#10b981', label: '↑ Increasing' }, down: { color: '#3b82f6', label: '↓ Decreasing' }, stable: { color: '#f59e0b', label: '→ Stable' } };
                                            const t = trendCfg[row.trend] || trendCfg.stable;
                                            const confCfg = { High: '#10b981', Medium: '#f59e0b', Low: '#f43f5e' };
                                            const catColors = { Produce: '#34d399', Packaging: '#38bdf8', 'Cleaning Supplies': '#fb923c' };
                                            return (
                                                <tr key={idx}
                                                    style={{ borderBottom: '1px solid rgba(255,255,255,0.04)', transition: 'background 0.1s' }}
                                                    onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.03)'}
                                                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                                                    <td style={{ padding: '11px 14px', fontWeight: 600, color: '#f8fafc' }}>{row.itemName}</td>
                                                    <td style={{ padding: '11px 14px' }}>
                                                        <span style={{ color: catColors[row.category] || '#94a3b8', background: (catColors[row.category] || '#94a3b8') + '18', padding: '2px 9px', borderRadius: 10, fontSize: 11, fontWeight: 600 }}>{row.category}</span>
                                                    </td>
                                                    <td style={{ padding: '11px 14px', color: '#818cf8', fontWeight: 600 }}>{row.mondayQty}</td>
                                                    <td style={{ padding: '11px 14px', color: '#a78bfa', fontWeight: 600 }}>{row.thursdayQty}</td>
                                                    <td style={{ padding: '11px 14px', fontWeight: 700, color: '#f8fafc', fontSize: 15 }}>{row.totalQty}</td>
                                                    <td style={{ padding: '11px 14px' }}>
                                                        <span style={{ background: `${t.color}20`, color: t.color, padding: '3px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600 }}>{t.label}</span>
                                                    </td>
                                                    <td style={{ padding: '11px 14px' }}>
                                                        <span style={{ color: confCfg[row.confidence] || '#94a3b8', fontWeight: 700, fontSize: 12 }}>● {row.confidence}</span>
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                        {forecastItems.length === 0 && !forecastLoading && (
                                            <tr><td colSpan={7} style={{ padding: 40, textAlign: 'center', color: '#94a3b8', fontSize: 13 }}>No forecast data for this restaurant. Forecasts require order history.</td></tr>
                                        )}
                                    </tbody>
                                </table>
                            </div>

                            <div style={{ background: 'rgba(56,189,248,0.06)', border: '1px solid rgba(56,189,248,0.1)', borderRadius: 8, padding: '10px 16px', fontSize: 12, color: '#64748b' }}>
                                💡 Predictions use a 12-week median-blend algorithm (30% last 4 weeks + 70% last 8 weeks) from actual order history. Corrections are automatically learned.
                            </div>
                        </div>
                    )}

                            {/* ── Combined Demand sub-view ── */}
                            {tabFilter?.demandView === 'combined' && (
                        <div style={{ border: '1px solid rgba(255,255,255,0.07)', borderRadius: 10, background: '#0f172a', overflow: 'hidden' }}>
                            <CombinedDemandPage hideHeader={true} />
                        </div>
                    )}
                        </div>
                    )}{/* End of Demand tab */}

                    {/* ═══════════════ FULFILLMENT TAB (absorbs Dispatch + Warehouse) ═══════════════ */}
                    {activeTab === 'fulfillment' && (
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
                                        <div key={v.name} onClick={() => goTab('fulfillment', { vendor: v.name })}
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

                            {/* ── Warehouse Readiness (merged into Fulfillment) ── */}
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
                                <div style={{ marginTop: 20, fontSize: 13, color: '#64748b' }}>💡 For detailed line-item pick operations, use the <span style={{ color: '#38bdf8', cursor: 'pointer', fontWeight: 600 }} onClick={() => window.location.href = '/admin/dispatch/warehouse'}>Warehouse Pick List</span> page.</div>
                            </div>

                            {/* ── AI DISPATCH OPTIMIZATION PANEL ────── */}
                            {aiData.dispatch && aiData.dispatch.suggestions.length > 0 && (
                                <div style={{ background: 'rgba(56,189,248,0.04)', border: '1px solid rgba(56,189,248,0.12)', borderRadius: 12, padding: '18px 22px' }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
                                        <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: '#e2e8f0', display: 'flex', alignItems: 'center', gap: 8 }}>🚚 Dispatch Optimization Suggestions <span style={{ fontSize: 11, fontWeight: 600, background: 'rgba(56,189,248,0.15)', color: '#38bdf8', padding: '2px 8px', borderRadius: 6 }}>{aiData.dispatch.suggestions.length} groups</span></h3>
                                        <span style={{ fontSize: 10, color: '#64748b', background: 'rgba(56,189,248,0.08)', padding: '2px 8px', borderRadius: 6 }}>AI logistics</span>
                                    </div>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                                        {aiData.dispatch.suggestions.slice(0, 4).map(g => (
                                            <div key={g.id} style={{ background: 'rgba(0,0,0,0.2)', borderRadius: 10, padding: '14px 16px', borderLeft: `3px solid ${g.efficiencyColor}` }}>
                                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                                                    <div style={{ fontSize: 14, fontWeight: 700, color: '#f8fafc' }}>{g.vendor} — {g.day}</div>
                                                    <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 4, background: `${g.efficiencyColor}22`, color: g.efficiencyColor }}>{g.efficiency}</span>
                                                </div>
                                                <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginBottom: 6 }}>
                                                    {g.items.slice(0, 6).map((item, i) => (
                                                        <span key={i} style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 5, background: 'rgba(56,189,248,0.08)', border: '1px solid rgba(56,189,248,0.15)', color: '#38bdf8' }}>
                                                            {item.itemName} ×{item.qty}
                                                        </span>
                                                    ))}
                                                    {g.items.length > 6 && <span style={{ fontSize: 11, color: '#64748b' }}>+{g.items.length - 6} more</span>}
                                                </div>
                                                <div style={{ fontSize: 11, color: '#64748b', fontStyle: 'italic' }}>💡 {g.reason}</div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                            {aiLoading && (
                                <div style={{ background: 'rgba(56,189,248,0.05)', border: '1px solid rgba(56,189,248,0.08)', borderRadius: 10, padding: '12px 18px', marginTop: 16, fontSize: 12, color: '#94a3b8', display: 'flex', alignItems: 'center', gap: 8 }}>
                                    <FiRefreshCw className="spin" size={12} /> Loading dispatch optimization...
                                </div>
                            )}
                        </div>
                        </>
                    )}{/* End of Fulfillment tab */}

                    {/* ═══════════════ INTELLIGENCE TAB ═══════════════ */}
                    {activeTab === 'intelligence' && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                            {/* Accuracy Summary — REAL DATA */}
                            <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 12, padding: 22 }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                                    <h3 style={{ fontSize: 15, fontWeight: 600, margin: 0, color: '#e2e8f0' }}>🎯 Forecast Accuracy</h3>
                                    <span style={{ fontSize: 10, color: '#64748b', background: 'rgba(52,211,153,0.08)', padding: '2px 8px', borderRadius: 6 }}>vs actual orders</span>
                                </div>
                                {intelLoading && (
                                    <div style={{ padding: 20, textAlign: 'center', color: '#94a3b8', fontSize: 12 }}>
                                        <FiRefreshCw className="spin" size={12} style={{ marginRight: 6 }} /> Computing accuracy from real orders...
                                    </div>
                                )}
                                {intelData.accuracy && (
                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 14, marginBottom: 18 }}>
                                        {[
                                            { label: 'Accuracy', value: `${intelData.accuracy.accuracy}%`, color: intelData.accuracy.accuracy >= 70 ? '#34d399' : intelData.accuracy.accuracy >= 40 ? '#fbbf24' : '#f87171' },
                                            { label: 'Correct', value: intelData.accuracy.correct, color: '#38bdf8' },
                                            { label: 'Over-predicted', value: intelData.accuracy.overPredicted, color: '#fbbf24' },
                                            { label: 'Under-predicted', value: intelData.accuracy.underPredicted, color: '#f87171' },
                                        ].map(k => (
                                            <div key={k.label} style={{ background: 'rgba(0,0,0,0.2)', borderRadius: 10, padding: 16, textAlign: 'center' }}>
                                                <div style={{ fontSize: 24, fontWeight: 700, color: k.color }}>{k.value}</div>
                                                <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 4 }}>{k.label}</div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                                {intelData.accuracy && intelData.accuracy.details.length > 0 && (
                                    <div style={{ maxHeight: 200, overflowY: 'auto' }}>
                                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                                            <thead>
                                                <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                                                    {['Item', 'Predicted', 'Actual', 'Diff', 'Status'].map(h => (
                                                        <th key={h} style={{ padding: '6px 10px', textAlign: 'left', fontSize: 10, color: '#64748b', fontWeight: 600, textTransform: 'uppercase' }}>{h}</th>
                                                    ))}
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {intelData.accuracy.details.slice(0, 8).map((d, i) => {
                                                    const statusCfg = { correct: { label: '✓ Correct', color: '#34d399' }, over: { label: '↑ Over', color: '#fbbf24' }, under: { label: '↓ Under', color: '#f87171' } };
                                                    const s = statusCfg[d.status] || statusCfg.correct;
                                                    return (
                                                        <tr key={i} style={{ borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
                                                            <td style={{ padding: '6px 10px', fontWeight: 600, color: '#f8fafc' }}>{d.itemName}</td>
                                                            <td style={{ padding: '6px 10px', color: '#94a3b8' }}>{d.predicted}</td>
                                                            <td style={{ padding: '6px 10px', color: '#94a3b8' }}>{d.actual}</td>
                                                            <td style={{ padding: '6px 10px', color: d.diff > 0 ? '#fbbf24' : d.diff < 0 ? '#f87171' : '#34d399', fontWeight: 600 }}>{d.diff > 0 ? '+' : ''}{d.diff}</td>
                                                            <td style={{ padding: '6px 10px' }}><span style={{ fontSize: 10, fontWeight: 700, color: s.color }}>{s.label}</span></td>
                                                        </tr>
                                                    );
                                                })}
                                            </tbody>
                                        </table>
                                    </div>
                                )}
                            </div>
                            {/* Correction Intelligence — REAL DATA */}
                            <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 12, padding: 22 }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
                                    <h3 style={{ fontSize: 15, fontWeight: 600, margin: 0, color: '#e2e8f0' }}>🧠 Correction Intelligence</h3>
                                    <span style={{ fontSize: 10, color: '#64748b', background: 'rgba(56,189,248,0.08)', padding: '2px 8px', borderRadius: 6 }}>learning engine</span>
                                </div>
                                {intelLoading && (
                                    <div style={{ padding: 20, textAlign: 'center', color: '#94a3b8', fontSize: 12 }}>
                                        <FiRefreshCw className="spin" size={12} style={{ marginRight: 6 }} /> Loading correction data...
                                    </div>
                                )}
                                {intelData.corrections && (
                                    <>
                                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12, marginBottom: 18 }}>
                                            {[
                                                { label: 'Learning Active Items', value: intelData.corrections.activeItems, color: '#38bdf8' },
                                                { label: 'Avg Correction Delta', value: intelData.corrections.avgDelta, color: '#34d399' },
                                                { label: 'Convergence Rate', value: intelData.corrections.improvementPct, color: '#34d399' },
                                                { label: 'Most Corrected', value: intelData.corrections.mostCorrected, color: '#fbbf24' },
                                                { label: 'Most Increased', value: intelData.corrections.mostIncreased, color: '#a78bfa' },
                                                { label: 'Most Reduced', value: intelData.corrections.mostReduced, color: '#f87171' },
                                            ].map(k => (
                                                <div key={k.label} style={{ background: 'rgba(0,0,0,0.2)', borderRadius: 10, padding: 14 }}>
                                                    <div style={{ fontSize: 16, fontWeight: 700, color: k.color, marginBottom: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{k.value}</div>
                                                    <div style={{ fontSize: 11, color: '#94a3b8' }}>{k.label}</div>
                                                </div>
                                            ))}
                                        </div>
                                        {intelData.corrections.activeItems === 0 && (
                                            <div style={{ background: 'rgba(56,189,248,0.06)', border: '1px solid rgba(56,189,248,0.12)', borderRadius: 8, padding: '10px 16px', fontSize: 12, color: '#64748b' }}>
                                                💡 No correction history yet. As you approve or edit forecast orders, the correction engine will learn and improve predictions automatically.
                                            </div>
                                        )}
                                    </>
                                )}
                            </div>
                            {/* ── AI PRICE INTELLIGENCE PANEL ─────── */}
                            {aiData.price && aiData.price.priceIntelligence.length > 0 && (
                                <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 12, padding: 22 }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
                                        <h3 style={{ fontSize: 15, fontWeight: 600, margin: 0, color: '#e2e8f0', display: 'flex', alignItems: 'center', gap: 8 }}>💰 Vendor Price Intelligence</h3>
                                        <span style={{ fontSize: 10, color: '#64748b', background: 'rgba(52,211,153,0.08)', padding: '2px 8px', borderRadius: 6 }}>AI pricing</span>
                                    </div>
                                    {/* Price Alerts */}
                                    {aiData.price.priceAlerts.length > 0 && (
                                        <div style={{ background: 'rgba(248,113,113,0.06)', border: '1px solid rgba(248,113,113,0.12)', borderRadius: 8, padding: '10px 14px', marginBottom: 14 }}>
                                            <div style={{ fontSize: 12, fontWeight: 700, color: '#f87171', marginBottom: 4 }}>🔔 Price Alerts</div>
                                            {aiData.price.priceAlerts.slice(0, 3).map((a, i) => (
                                                <div key={i} style={{ fontSize: 12, color: '#cbd5e1', marginBottom: 2 }}>
                                                    <strong>{a.itemName}</strong> — {a.alerts[0]?.vendorName} is +{a.alerts[0]?.percentAbove}% above market average
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                    {/* Savings Summary */}
                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 10, marginBottom: 14 }}>
                                        <div style={{ background: 'rgba(0,0,0,0.2)', borderRadius: 8, padding: '10px 14px', textAlign: 'center' }}>
                                            <div style={{ fontSize: 20, fontWeight: 700, color: '#38bdf8' }}>{aiData.price.summary.totalItems}</div>
                                            <div style={{ fontSize: 10, color: '#94a3b8' }}>Items Analyzed</div>
                                        </div>
                                        <div style={{ background: 'rgba(0,0,0,0.2)', borderRadius: 8, padding: '10px 14px', textAlign: 'center' }}>
                                            <div style={{ fontSize: 20, fontWeight: 700, color: '#34d399' }}>${aiData.price.summary.totalMonthlySavings.toFixed(0)}</div>
                                            <div style={{ fontSize: 10, color: '#94a3b8' }}>Monthly Savings</div>
                                        </div>
                                        <div style={{ background: 'rgba(0,0,0,0.2)', borderRadius: 8, padding: '10px 14px', textAlign: 'center' }}>
                                            <div style={{ fontSize: 20, fontWeight: 700, color: '#fbbf24' }}>${aiData.price.summary.avgSpread.toFixed(2)}</div>
                                            <div style={{ fontSize: 10, color: '#94a3b8' }}>Avg Spread</div>
                                        </div>
                                    </div>
                                    {/* Top Items Table */}
                                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                                        <thead>
                                            <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                                                {['Item', 'Cheapest Vendor', 'Price', 'Avg', 'Savings/Unit'].map(h => <th key={h} style={{ padding: '8px 10px', textAlign: 'left', fontSize: 10, color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase' }}>{h}</th>)}
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {aiData.price.priceIntelligence.slice(0, 8).map((r, i) => (
                                                <tr key={i} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                                                    <td style={{ padding: '8px 10px', fontWeight: 600, color: '#f8fafc' }}>{r.itemName}</td>
                                                    <td style={{ padding: '8px 10px', color: '#34d399', fontWeight: 600 }}>{r.cheapestVendor}</td>
                                                    <td style={{ padding: '8px 10px', color: '#34d399' }}>${r.cheapestPrice.toFixed(2)}</td>
                                                    <td style={{ padding: '8px 10px', color: '#94a3b8' }}>${r.avgPrice.toFixed(2)}</td>
                                                    <td style={{ padding: '8px 10px', color: r.savingsPerUnit > 0 ? '#34d399' : '#64748b' }}>${r.savingsPerUnit.toFixed(2)}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                    {aiData.price.priceIntelligence.length > 8 && (
                                        <div style={{ textAlign: 'center', marginTop: 10, fontSize: 11, color: '#64748b', cursor: 'pointer' }} onClick={() => window.location.href = '/intelligence?tab=price-intelligence'}>+ {aiData.price.priceIntelligence.length - 8} more items — <span style={{ color: '#38bdf8' }}>open full Price Intelligence →</span></div>
                                    )}
                                </div>
                            )}

                            {/* ── AI SEASONAL DEMAND INSIGHTS PANEL ── */}
                            {aiData.seasonal && aiData.seasonal.uplifts.length > 0 && (
                                <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 12, padding: 22 }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
                                        <h3 style={{ fontSize: 15, fontWeight: 600, margin: 0, color: '#e2e8f0', display: 'flex', alignItems: 'center', gap: 8 }}>🎄 Seasonal Demand Insights</h3>
                                        <span style={{ fontSize: 10, color: '#64748b', background: 'rgba(251,191,36,0.08)', padding: '2px 8px', borderRadius: 6 }}>AI seasonal</span>
                                    </div>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                                        {aiData.seasonal.uplifts.map(evt => (
                                            <div key={evt.id} style={{ background: 'rgba(0,0,0,0.2)', borderRadius: 10, padding: '14px 16px', borderLeft: `3px solid ${evt.statusColor}` }}>
                                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                                                    <div style={{ fontSize: 14, fontWeight: 700, color: '#f8fafc' }}>🎉 {evt.eventName}</div>
                                                    <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 4, background: `${evt.statusColor}22`, color: evt.statusColor }}>{evt.status}{!evt.isActive ? ` — ${evt.daysUntil}d` : ''}</span>
                                                </div>
                                                {evt.rules.length > 0 ? (
                                                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                                                        {evt.rules.map((r, i) => (
                                                            <span key={i} style={{ fontSize: 11, padding: '3px 10px', borderRadius: 6, background: 'rgba(167,139,250,0.1)', border: '1px solid rgba(167,139,250,0.2)' }}>
                                                                <strong style={{ color: '#a78bfa' }}>{r.category}</strong> <span style={{ color: '#34d399', fontWeight: 700 }}>+{r.upliftPercent}%</span>
                                                            </span>
                                                        ))}
                                                    </div>
                                                ) : (
                                                    <div style={{ fontSize: 11, color: '#64748b', fontStyle: 'italic' }}>No uplift rules — configure in Festival Calendar</div>
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {aiLoading && (
                                <div style={{ background: 'rgba(167,139,250,0.05)', border: '1px solid rgba(167,139,250,0.08)', borderRadius: 10, padding: '12px 18px', marginTop: 12, fontSize: 12, color: '#94a3b8', display: 'flex', alignItems: 'center', gap: 8 }}>
                                    <FiRefreshCw className="spin" size={12} /> Loading AI intelligence panels...
                                </div>
                            )}

                            {/* CTA — View full Intelligence */}
                            <div onClick={() => window.location.href = '/intelligence'}
                                style={{ background: 'rgba(52,211,153,0.06)', border: '1px solid rgba(52,211,153,0.15)', borderRadius: 10, padding: '14px 20px', cursor: 'pointer', textAlign: 'center', transition: 'all 0.2s' }}
                                onMouseEnter={e => e.currentTarget.style.background = 'rgba(52,211,153,0.12)'}
                                onMouseLeave={e => e.currentTarget.style.background = 'rgba(52,211,153,0.06)'}>
                                <span style={{ fontSize: 13, fontWeight: 600, color: '#34d399' }}>🧠 Open full Intelligence workspace →</span>
                            </div>
                        </div>
                    )}

                    {/* ═══════════════ EXCEPTIONS TAB ═══════════════ */}
                    {activeTab === 'exceptions' && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                            {/* Exception KPI Cards */}
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 14 }}>
                                {[
                                    { label: 'Open Issues', value: orderPipeline.openIssues, color: '#f43f5e', icon: '🚨', onClick: () => window.location.href = '/orders-fulfillment?tab=issues' },
                                    { label: 'Items Missing Price', value: metrics.missingPrices, color: metrics.missingPrices > 0 ? '#f43f5e' : '#10b981', icon: '⚠️', onClick: () => goTab('demand', { view: 'missingPrice' }) },
                                    { label: 'Dispatch Alerts', value: dispatchAlerts.length, color: dispatchAlerts.length > 0 ? '#f59e0b' : '#10b981', icon: '📋', onClick: null },
                                    { label: 'Pending Aggregation', value: orderPipeline.pendingAggregation, color: orderPipeline.pendingAggregation > 0 ? '#fbbf24' : '#10b981', icon: '🔄', onClick: () => window.location.href = '/orders-fulfillment?tab=submitted' },
                                ].map(k => (
                                    <div key={k.label} onClick={k.onClick}
                                        style={{ background: k.color + '0a', border: `1px solid ${k.color}22`, borderRadius: 12, padding: 20, cursor: k.onClick ? 'pointer' : 'default', transition: 'all 0.2s' }}
                                        onMouseEnter={e => { if (k.onClick) { e.currentTarget.style.border = `1px solid ${k.color}55`; e.currentTarget.style.background = k.color + '14'; } }}
                                        onMouseLeave={e => { e.currentTarget.style.border = `1px solid ${k.color}22`; e.currentTarget.style.background = k.color + '0a'; }}>
                                        <div style={{ fontSize: 20, marginBottom: 6 }}>{k.icon}</div>
                                        <div style={{ fontSize: 26, fontWeight: 700, color: k.color }}>{k.value}</div>
                                        <div style={{ fontSize: 11, color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.3 }}>{k.label}</div>
                                    </div>
                                ))}
                            </div>

                            {/* Dispatch Alerts Detail */}
                            <div style={{ background: 'rgba(244,63,94,0.04)', border: '1px solid rgba(244,63,94,0.12)', borderRadius: 12, padding: 22 }}>
                                <h3 style={{ fontSize: 15, fontWeight: 600, margin: '0 0 14px 0', color: '#e2e8f0', display: 'flex', alignItems: 'center', gap: 8 }}><FiAlertCircle color="#f43f5e" size={16} /> Active Alerts & Risks</h3>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                                    {dispatchAlerts.length > 0 ? dispatchAlerts.map(a => (
                                        <div key={a.id} style={{ background: a.status === 'Rejected' ? 'rgba(244,63,94,0.1)' : 'rgba(245,158,11,0.1)', padding: '10px 14px', borderRadius: 8, borderLeft: a.status === 'Rejected' ? '3px solid #f43f5e' : '3px solid #f59e0b', fontSize: 13 }}>
                                            <strong style={{ color: a.status === 'Rejected' ? '#f43f5e' : '#f59e0b' }}>Dispatch Alert:</strong> {a.vendorName} — <strong>{a.status}</strong>. {a.rejectionReason || a.partialReason || ''}
                                        </div>
                                    )) : null}
                                    {metrics.missingPrices > 0 && (
                                        <div style={{ background: 'rgba(244,63,94,0.1)', padding: '10px 14px', borderRadius: 8, borderLeft: '3px solid #f43f5e', fontSize: 13 }}>
                                            <strong>Missing Pricing:</strong> {metrics.missingPrices} items missing catalog price. <span style={{ color: '#38bdf8', cursor: 'pointer', fontWeight: 600 }} onClick={() => window.location.href = '/catalog-reviews?tab=catalog'}>Open Catalog →</span>
                                        </div>
                                    )}
                                    {orderPipeline.openIssues > 0 && (
                                        <div style={{ background: 'rgba(244,63,94,0.08)', padding: '10px 14px', borderRadius: 8, borderLeft: '3px solid #f43f5e', fontSize: 13 }}>
                                            <strong>Open Issues:</strong> {orderPipeline.openIssues} disputes need resolution. <span style={{ color: '#38bdf8', cursor: 'pointer', fontWeight: 600 }} onClick={() => window.location.href = '/orders-fulfillment?tab=issues'}>View Issues →</span>
                                        </div>
                                    )}
                                    {dispatchAlerts.length === 0 && metrics.missingPrices === 0 && orderPipeline.openIssues === 0 && (
                                        <div style={{ padding: 30, textAlign: 'center' }}>
                                            <div style={{ fontSize: 40, marginBottom: 12 }}>✅</div>
                                            <div style={{ fontSize: 15, fontWeight: 700, color: '#34d399', marginBottom: 6 }}>All Clear</div>
                                            <div style={{ fontSize: 13, color: '#64748b' }}>No active exceptions, missing prices, or open issues this week.</div>
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* Quick Links */}
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12 }}>
                                {[
                                    { label: 'Open Review Queue', icon: '📦', to: '/catalog-reviews?tab=review-queue', color: '#a78bfa' },
                                    { label: 'View Unmapped Items', icon: '🔗', to: '/catalog-reviews?tab=unmapped', color: '#f59e0b' },
                                    { label: 'Open Issues & Disputes', icon: '🚨', to: '/orders-fulfillment?tab=issues', color: '#f43f5e' },
                                ].map(cta => (
                                    <div key={cta.label} onClick={() => window.location.href = cta.to}
                                        style={{ background: cta.color + '08', border: `1px solid ${cta.color}22`, borderRadius: 10, padding: '14px 18px', cursor: 'pointer', transition: 'all 0.2s', display: 'flex', alignItems: 'center', gap: 10 }}
                                        onMouseEnter={e => { e.currentTarget.style.border = `1px solid ${cta.color}55`; e.currentTarget.style.background = cta.color + '14'; }}
                                        onMouseLeave={e => { e.currentTarget.style.border = `1px solid ${cta.color}22`; e.currentTarget.style.background = cta.color + '08'; }}>
                                        <span style={{ fontSize: 18 }}>{cta.icon}</span>
                                        <span style={{ fontSize: 12, fontWeight: 600, color: cta.color }}>{cta.label} →</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}{/* End of Exceptions tab */}
                </>
            )}
        </div>
    );
}

