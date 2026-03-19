import React, { useEffect, useState, useContext, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { UserContext } from '../contexts/UserContext';
import { db } from '../firebase';
import { collection, getDocs, doc, getDoc, query, where } from 'firebase/firestore';

/* ─────────────────────── Color Tokens ─────────────────────── */
const C = {
    green: '#34d399', red: '#f87171', amber: '#fbbf24', blue: '#38bdf8',
    purple: '#a78bfa', cyan: '#22d3ee', pink: '#f472b6',
    muted: '#94a3b8', fg: '#f8fafc', bg: '#0f172a',
    cardBg: 'rgba(255,255,255,0.025)', border: 'rgba(255,255,255,0.06)',
};

/* ─────────────────────── Reusable Shells ─────────────────────── */
const Card = ({ children, onClick, style, highlight }) => (
    <div onClick={onClick} style={{
        background: C.cardBg, border: `1px solid ${highlight || C.border}`,
        borderRadius: 12, padding: '18px 20px', cursor: onClick ? 'pointer' : 'default',
        transition: 'all 0.2s', ...style,
    }}
    onMouseOver={e => { if (onClick) e.currentTarget.style.transform = 'translateY(-2px)'; }}
    onMouseOut={e => { if (onClick) e.currentTarget.style.transform = 'none'; }}
    >{children}</div>
);

const KPICard = ({ icon, value, label, sub, color, onClick }) => (
    <Card onClick={onClick} highlight={`${color}30`} style={{ position: 'relative', overflow: 'hidden' }}>
        <div style={{ position: 'absolute', top: 14, right: 16, fontSize: 28, opacity: 0.15 }}>{icon}</div>
        <div style={{ fontSize: 11, color: C.muted, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 8 }}>{label}</div>
        <div style={{ fontSize: 32, fontWeight: 800, color, lineHeight: 1, marginBottom: 6 }}>{value}</div>
        {sub && <div style={{ fontSize: 12, color: C.muted, lineHeight: 1.3 }}>{sub}</div>}
    </Card>
);

const AlertBadge = ({ icon, label, count, color, onClick }) => {
    if (count <= 0) return null;
    return (
        <button onClick={onClick} style={{
            display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px',
            borderRadius: 8, border: `1px solid ${color}30`, background: `${color}08`,
            color, fontSize: 12, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap',
            transition: 'all 0.15s',
        }}
        onMouseOver={e => { e.currentTarget.style.background = `${color}15`; }}
        onMouseOut={e => { e.currentTarget.style.background = `${color}08`; }}
        >
            <span>{icon}</span>
            <span>{count}</span>
            <span style={{ color: `${color}cc` }}>{label}</span>
        </button>
    );
};

const SectionHeader = ({ title, cta, onCta }) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: C.fg }}>{title}</div>
        {cta && <button onClick={onCta} style={{
            fontSize: 12, fontWeight: 600, padding: '5px 12px', borderRadius: 6,
            border: `1px solid ${C.border}`, background: 'transparent', color: C.muted, cursor: 'pointer',
        }}>{cta}</button>}
    </div>
);

/* ═══════════════════════ DASHBOARD ═══════════════════════ */
export default function Dashboard() {
    const navigate = useNavigate();
    const { vendorId, vendorName, isSuperAdmin } = useContext(UserContext);

    /* ── State ── */
    const [loading, setLoading] = useState(true);
    const [vendorData, setVendorData] = useState(null);
    const [allItems, setAllItems] = useState([]);
    const [allOrders, setAllOrders] = useState([]);
    const [allDispatches, setAllDispatches] = useState([]);
    const [allIssues, setAllIssues] = useState([]);
    const [allInvoices, setAllInvoices] = useState([]);
    const [showRevenueModal, setShowRevenueModal] = useState(false);

    /* ── Data Fetching ── */
    useEffect(() => {
        if (isSuperAdmin || !vendorId) { setLoading(false); return; }
        (async () => {
            try {
                // 1. Vendor profile
                const vendorSnap = await getDoc(doc(db, 'vendors', vendorId));
                if (vendorSnap.exists()) setVendorData({ id: vendorSnap.id, ...vendorSnap.data() });

                // 2. Vendor items
                try {
                    const itemSnap = await getDocs(collection(db, `vendors/${vendorId}/items`));
                    setAllItems(itemSnap.docs.map(d => ({ id: d.id, ...d.data() })));
                } catch (_) {}

                // 3. Orders
                try {
                    const oSnap = await getDocs(query(collection(db, 'marketplaceOrders'), where('vendorId', '==', vendorId)));
                    const orders = oSnap.docs.map(d => ({ id: d.id, ...d.data() }));
                    orders.sort((a, b) => {
                        const dA = a.createdAt?.toDate ? a.createdAt.toDate() : new Date(a.createdAt || 0);
                        const dB = b.createdAt?.toDate ? b.createdAt.toDate() : new Date(b.createdAt || 0);
                        return dB - dA;
                    });
                    setAllOrders(orders);
                } catch (_) {}

                // 4. Dispatches
                try {
                    const dSnap = await getDocs(query(collection(db, 'vendorDispatches'), where('vendorId', '==', vendorId)));
                    setAllDispatches(dSnap.docs.map(d => ({ id: d.id, ...d.data() })));
                } catch (_) {}

                // 5. Issues
                try {
                    const iSnap = await getDocs(query(collection(db, 'issuesDisputes'), where('vendorId', '==', vendorId)));
                    setAllIssues(iSnap.docs.map(d => ({ id: d.id, ...d.data() })));
                } catch (_) {}

                // 6. Invoices
                try {
                    const invSnap = await getDocs(query(collection(db, 'vendorInvoices'), where('vendorId', '==', vendorId)));
                    setAllInvoices(invSnap.docs.map(d => ({ id: d.id, ...d.data() })));
                } catch (_) {}
            } catch (err) { console.error('Dashboard load error:', err); }
            finally { setLoading(false); }
        })();
    }, [vendorId, isSuperAdmin]);

    /* ── Derived: Revenue KPIs ── */
    const kpiData = useMemo(() => {
        const now = new Date();
        const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
        let currentRev = 0, prevRev = 0;
        const weekOrders = [];
        allOrders.forEach(o => {
            const d = o.createdAt?.toDate ? o.createdAt.toDate() : new Date(o.createdAt || 0);
            const ok = ['fulfilled', 'completed', 'delivered'].includes((o.status || '').toLowerCase());
            if (ok) {
                if (d >= sevenDaysAgo) { currentRev += (o.total || 0); weekOrders.push(o); }
                else if (d >= fourteenDaysAgo) prevRev += (o.total || 0);
            }
        });
        const revChange = prevRev > 0 ? ((currentRev - prevRev) / prevRev) * 100 : (currentRev > 0 ? 100 : 0);
        const revenueDetails = weekOrders.map(o => ({
            id: o.id, orderGroupId: o.orderGroupId || o.id.slice(-8).toUpperCase(),
            status: o.status, createdAt: o.createdAt, total: Number(o.total || 0),
        })).sort((a, b) => b.total - a.total);
        return { currentRev, prevRev, revChange, revenueDetails };
    }, [allOrders]);

    /* ── Derived: Dispatch Stats ── */
    const dispatchStats = useMemo(() => {
        const s = { pending: 0, confirmed: 0, packed: 0, outForDelivery: 0, delivered: 0, rejected: 0, partiallyConfirmed: 0 };
        allDispatches.forEach(d => {
            const st = d.status || '';
            if (st === 'Sent') s.pending++;
            else if (st === 'Confirmed') s.confirmed++;
            else if (st === 'Partially Confirmed') s.partiallyConfirmed++;
            else if (st === 'Packed') s.packed++;
            else if (st === 'Out for Delivery') s.outForDelivery++;
            else if (st === 'Delivered') s.delivered++;
            else if (st === 'Rejected') s.rejected++;
        });
        s.total = allDispatches.length;
        return s;
    }, [allDispatches]);

    /* ── Derived: Catalog Health ── */
    const catalogHealth = useMemo(() => {
        const now = Date.now();
        const day14 = 14 * 24 * 60 * 60 * 1000;
        const day30 = 30 * 24 * 60 * 60 * 1000;
        let active = 0, inactive = 0, missingPack = 0, missingSKU = 0, stale14 = 0, stale30 = 0, suspectPrice = 0, missingCategory = 0;
        allItems.forEach(item => {
            if ((item.status || 'Active') === 'Active') active++; else inactive++;
            if (!item.packSize && !item.packQuantity) missingPack++;
            if (!item.vendorSKU) missingSKU++;
            if (!item.category) missingCategory++;
            const p = parseFloat(item.vendorPrice ?? item.price ?? 0);
            if (p <= 0 || p > 5000) suspectPrice++;
            const updMs = item.updatedAt?.toMillis?.() || (item.updatedAt?.seconds ? item.updatedAt.seconds * 1000 : 0);
            if (updMs > 0 && (now - updMs) > day30) stale30++;
            else if (updMs > 0 && (now - updMs) > day14) stale14++;
        });
        const flagged = missingPack + missingSKU + missingCategory + suspectPrice;
        return { active, inactive, missingPack, missingSKU, stale14, stale30, suspectPrice, missingCategory, flagged, total: allItems.length };
    }, [allItems]);

    /* ── Derived: Payout ── */
    const payoutData = useMemo(() => {
        const now = new Date();
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        let pending = 0, paidThisMonth = 0, totalPaid = 0, pendingCount = 0, latestInv = null;
        allInvoices.forEach(inv => {
            const amt = Number(inv.totalVendorAmount || inv.total || 0);
            const paid = inv.paymentStatus === 'PAID';
            const created = inv.createdAt?.toDate ? inv.createdAt.toDate() : new Date(inv.createdAt || 0);
            if (paid) {
                totalPaid += amt;
                if (created >= startOfMonth) paidThisMonth += amt;
            } else {
                pending += amt;
                pendingCount++;
            }
            if (!latestInv || created > (latestInv.date || 0)) latestInv = { ...inv, date: created };
        });
        // Fallback: compute from fulfilled orders if no invoices
        if (allInvoices.length === 0) {
            pending = allOrders.filter(o => o.status === 'fulfilled').reduce((s, o) => s + (o.total || 0), 0) * 0.85;
        }
        return { pending, paidThisMonth, totalPaid, pendingCount, latestInv };
    }, [allInvoices, allOrders]);

    /* ── Derived: Issues ── */
    const openIssues = useMemo(() => allIssues.filter(i => (i.status || '').toLowerCase() === 'open'), [allIssues]);

    /* ── Derived: Top Items ── */
    const topItems = useMemo(() => {
        const counts = {};
        allOrders.forEach(o => {
            if (o.status === 'rejected') return;
            (o.items || []).forEach(item => {
                const name = item.itemName || item.name || '';
                if (!name) return;
                if (!counts[name]) counts[name] = { name, qty: 0, revenue: 0, category: item.category || '' };
                counts[name].qty += (item.qty || 0);
                counts[name].revenue += ((item.vendorPrice || item.price || 0) * (item.qty || 0));
            });
        });
        return Object.values(counts).sort((a, b) => b.qty - a.qty).slice(0, 5);
    }, [allOrders]);

    /* ── Derived: Action Queue ── */
    const actionQueue = useMemo(() => {
        const actions = [];
        if (dispatchStats.pending > 0) actions.push({
            priority: 1, icon: '📩', label: `${dispatchStats.pending} dispatch request${dispatchStats.pending > 1 ? 's' : ''} awaiting confirmation`,
            cta: 'Review Now', to: '/dispatch-requests', color: C.blue,
        });
        if (openIssues.length > 0) actions.push({
            priority: 2, icon: '🚨', label: `${openIssues.length} open issue${openIssues.length > 1 ? 's' : ''} need response`,
            cta: 'View Issues', to: '/vendor/issues', color: C.red,
        });
        if (catalogHealth.stale30 > 0) actions.push({
            priority: 3, icon: '⏰', label: `${catalogHealth.stale30} item${catalogHealth.stale30 > 1 ? 's' : ''} have stale prices (30+ days)`,
            cta: 'Update Prices', to: '/items', color: C.amber,
        });
        if (catalogHealth.missingPack > 0) actions.push({
            priority: 4, icon: '📦', label: `${catalogHealth.missingPack} item${catalogHealth.missingPack > 1 ? 's' : ''} missing pack size`,
            cta: 'Fix Now', to: '/items', color: C.amber,
        });
        if (payoutData.pendingCount > 0) actions.push({
            priority: 5, icon: '💳', label: `${payoutData.pendingCount} invoice${payoutData.pendingCount > 1 ? 's' : ''} pending payout`,
            cta: 'View Invoices', to: '/vendor/invoices', color: C.purple,
        });
        if (catalogHealth.suspectPrice > 0) actions.push({
            priority: 6, icon: '💰', label: `${catalogHealth.suspectPrice} item${catalogHealth.suspectPrice > 1 ? 's' : ''} with suspect pricing`,
            cta: 'Review', to: '/items', color: C.red,
        });
        if (catalogHealth.stale14 > 0 && catalogHealth.stale30 === 0) actions.push({
            priority: 7, icon: '🔄', label: `${catalogHealth.stale14} item${catalogHealth.stale14 > 1 ? 's' : ''} with stale prices (14+ days)`,
            cta: 'Review', to: '/items', color: C.amber,
        });
        return actions.sort((a, b) => a.priority - b.priority);
    }, [dispatchStats, openIssues, catalogHealth, payoutData]);

    /* ── Helpers ── */
    const fmt = (v) => new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' }).format(v || 0);
    const timeAgo = (ts) => {
        if (!ts) return '';
        const d = ts.toDate ? ts.toDate() : new Date(ts);
        const s = Math.floor((Date.now() - d.getTime()) / 1000);
        if (s < 60) return 'just now';
        if (s < 3600) return `${Math.floor(s / 60)}m ago`;
        if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
        return `${Math.floor(s / 86400)}d ago`;
    };
    const statusColor = (s) => {
        const m = { Sent: C.blue, Confirmed: C.green, 'Partially Confirmed': C.amber, Packed: C.cyan, 'Out for Delivery': C.purple, Delivered: '#4ade80', Rejected: C.red };
        return m[s] || C.muted;
    };

    /* ── Loading ── */
    if (loading) return (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '80px 24px', color: C.muted }}>
            <div style={{ fontSize: 36, marginBottom: 16, animation: 'pulse 1.5s infinite' }}>📊</div>
            <div style={{ fontSize: 15, fontWeight: 600 }}>Loading your command center...</div>
        </div>
    );

    /* ═══════════════════════ RENDER ═══════════════════════ */
    return (
        <div style={{ padding: '24px 28px', maxWidth: 1400, margin: '0 auto', paddingBottom: 100 }}>

            {/* ═══════ HEADER ═══════ */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 24 }}>
                <div>
                    <h1 style={{ margin: 0, fontSize: 26, fontWeight: 800, color: C.fg, display: 'flex', alignItems: 'center', gap: 10 }}>
                        🏠 {vendorName || 'Vendor'} Dashboard
                    </h1>
                    <p style={{ margin: '4px 0 0', color: C.muted, fontSize: 13 }}>
                        {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })} — Here's what needs your attention.
                    </p>
                </div>
                {/* Quick Actions */}
                <div style={{ display: 'flex', gap: 8 }}>
                    {[
                        { icon: '📩', label: 'Dispatches', to: '/dispatch-requests', color: C.blue },
                        { icon: '🛡️', label: 'Capacity', to: '/vendor/capacity', color: C.green },
                        { icon: '📥', label: 'Import', to: '/vendor/import', color: C.purple },
                        { icon: '📋', label: 'Items', to: '/items', color: C.muted },
                        { icon: '💳', label: 'Payouts', to: '/vendor/invoices', color: C.amber },
                    ].map(a => (
                        <button key={a.label} onClick={() => navigate(a.to)} style={{
                            padding: '7px 12px', borderRadius: 8, border: `1px solid ${C.border}`,
                            background: 'transparent', color: '#cbd5e1', fontSize: 12, fontWeight: 600,
                            cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5, whiteSpace: 'nowrap',
                        }}
                        onMouseOver={e => { e.currentTarget.style.borderColor = a.color; e.currentTarget.style.color = a.color; }}
                        onMouseOut={e => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.color = '#cbd5e1'; }}
                        >{a.icon} {a.label}</button>
                    ))}
                </div>
            </div>

            {/* ═══════ SECTION 1: TOP KPI ROW ═══════ */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 20 }}>
                <KPICard icon="📩" label="Pending Dispatches" value={dispatchStats.pending}
                    sub={dispatchStats.pending > 0 ? 'Awaiting your confirmation' : 'All clear'} color={C.blue}
                    onClick={() => navigate('/dispatch-requests')} />
                <KPICard icon="💳" label="Pending Payout" value={fmt(payoutData.pending)}
                    sub={payoutData.pendingCount > 0 ? `${payoutData.pendingCount} invoice${payoutData.pendingCount > 1 ? 's' : ''} awaiting payment` : 'No pending invoices'}
                    color={C.amber} onClick={() => navigate('/vendor/invoices')} />
                <KPICard icon="📦" label="Active Items" value={catalogHealth.active}
                    sub={`${catalogHealth.total} total in catalog`} color={C.green}
                    onClick={() => navigate('/items')} />
                <KPICard icon="📈" label="Weekly Revenue" value={fmt(kpiData.currentRev)}
                    sub={kpiData.revChange >= 0 ? `↑ ${Math.abs(kpiData.revChange).toFixed(0)}% vs last week` : `↓ ${Math.abs(kpiData.revChange).toFixed(0)}% vs last week`}
                    color={kpiData.revChange >= 0 ? C.green : C.red}
                    onClick={() => setShowRevenueModal(true)} />
            </div>

            {/* ═══════ SECTION 2: ATTENTION / ALERTS ROW ═══════ */}
            {(catalogHealth.flagged > 0 || catalogHealth.stale14 > 0 || catalogHealth.stale30 > 0 || openIssues.length > 0 || dispatchStats.rejected > 0) && (
                <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap', padding: '10px 14px', background: 'rgba(251,191,36,0.03)', border: `1px solid rgba(251,191,36,0.12)`, borderRadius: 10 }}>
                    <span style={{ fontSize: 12, fontWeight: 700, color: C.amber, display: 'flex', alignItems: 'center', gap: 4, marginRight: 6 }}>⚠️ Needs Attention</span>
                    <AlertBadge icon="📦" label="Missing Pack" count={catalogHealth.missingPack} color={C.amber} onClick={() => navigate('/items')} />
                    <AlertBadge icon="🏷️" label="No SKU" count={catalogHealth.missingSKU} color={C.muted} onClick={() => navigate('/items')} />
                    <AlertBadge icon="💰" label="Suspect Price" count={catalogHealth.suspectPrice} color={C.red} onClick={() => navigate('/items')} />
                    <AlertBadge icon="⏰" label="Stale 14d" count={catalogHealth.stale14} color={C.amber} onClick={() => navigate('/items')} />
                    <AlertBadge icon="🚨" label="Stale 30d" count={catalogHealth.stale30} color={C.red} onClick={() => navigate('/items')} />
                    <AlertBadge icon="🔥" label="Open Issues" count={openIssues.length} color={C.red} onClick={() => navigate('/vendor/issues')} />
                    <AlertBadge icon="❌" label="Rejected" count={dispatchStats.rejected} color={C.red} onClick={() => navigate('/dispatch-requests')} />
                    <AlertBadge icon="📂" label="No Category" count={catalogHealth.missingCategory} color={C.amber} onClick={() => navigate('/items')} />
                </div>
            )}

            {/* ═══════ SECTION 3: 2-COLUMN LAYOUT ═══════ */}
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 20, alignItems: 'start' }}>

                {/* ── LEFT COLUMN ── */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

                    {/* A. TODAY'S ACTION QUEUE */}
                    <Card>
                        <SectionHeader title="⚡ Today's Actions" />
                        {actionQueue.length === 0 ? (
                            <div style={{ textAlign: 'center', padding: '24px 16px' }}>
                                <div style={{ fontSize: 32, marginBottom: 8, opacity: 0.6 }}>✅</div>
                                <div style={{ fontSize: 14, fontWeight: 600, color: C.green, marginBottom: 4 }}>All caught up!</div>
                                <div style={{ fontSize: 13, color: C.muted }}>No urgent actions right now. Check your forecast for upcoming demand.</div>
                            </div>
                        ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                {actionQueue.map((a, i) => (
                                    <div key={i} style={{
                                        display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px',
                                        background: `${a.color}06`, border: `1px solid ${a.color}18`,
                                        borderRadius: 8, transition: 'background 0.15s',
                                    }}
                                    onMouseOver={e => e.currentTarget.style.background = `${a.color}12`}
                                    onMouseOut={e => e.currentTarget.style.background = `${a.color}06`}
                                    >
                                        <span style={{ fontSize: 20, flexShrink: 0 }}>{a.icon}</span>
                                        <div style={{ flex: 1, fontSize: 13, color: C.fg, fontWeight: 500 }}>{a.label}</div>
                                        <button onClick={() => navigate(a.to)} style={{
                                            padding: '6px 14px', borderRadius: 6, border: `1px solid ${a.color}40`,
                                            background: `${a.color}15`, color: a.color, fontSize: 12, fontWeight: 700,
                                            cursor: 'pointer', whiteSpace: 'nowrap',
                                        }}>{a.cta} →</button>
                                    </div>
                                ))}
                            </div>
                        )}
                    </Card>

                    {/* B. DISPATCH SNAPSHOT */}
                    <Card>
                        <SectionHeader title="🚚 Dispatch Operations" cta="View All →" onCta={() => navigate('/dispatch-requests')} />
                        {/* Status Strip */}
                        <div style={{ display: 'flex', gap: 6, marginBottom: 16, flexWrap: 'wrap' }}>
                            {[
                                { label: 'Pending', count: dispatchStats.pending, color: C.blue },
                                { label: 'Confirmed', count: dispatchStats.confirmed, color: C.green },
                                { label: 'Partially', count: dispatchStats.partiallyConfirmed, color: C.amber },
                                { label: 'Packed', count: dispatchStats.packed, color: C.cyan },
                                { label: 'Out for Delivery', count: dispatchStats.outForDelivery, color: C.purple },
                                { label: 'Delivered', count: dispatchStats.delivered, color: '#4ade80' },
                                { label: 'Rejected', count: dispatchStats.rejected, color: C.red },
                            ].filter(s => s.count > 0).map(s => (
                                <div key={s.label} style={{
                                    padding: '6px 12px', borderRadius: 6, fontSize: 12, fontWeight: 700,
                                    background: `${s.color}12`, color: s.color, border: `1px solid ${s.color}25`,
                                }}>
                                    {s.count} {s.label}
                                </div>
                            ))}
                            {dispatchStats.total === 0 && (
                                <div style={{ color: C.muted, fontSize: 13 }}>No dispatch activity yet.</div>
                            )}
                        </div>
                        {/* Recent 3 Dispatches */}
                        {allDispatches.length > 0 && (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                                {allDispatches.slice(0, 3).map(d => (
                                    <div key={d.id} onClick={() => navigate(`/dispatch-requests/${d.id}`)} style={{
                                        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                                        padding: '10px 14px', background: 'rgba(255,255,255,0.02)',
                                        borderRadius: 8, border: `1px solid ${C.border}`, cursor: 'pointer',
                                        transition: 'background 0.15s',
                                    }}
                                    onMouseOver={e => e.currentTarget.style.background = 'rgba(255,255,255,0.05)'}
                                    onMouseOut={e => e.currentTarget.style.background = 'rgba(255,255,255,0.02)'}
                                    >
                                        <div>
                                            <div style={{ fontSize: 13, fontWeight: 600, color: C.fg }}>
                                                {d.weekLabel || d.weekStart || d.id.slice(-8).toUpperCase()}
                                            </div>
                                            <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>
                                                Mon: <b style={{ color: '#3b82f6' }}>{d.mondayTotalPacks || 0}</b> · Thu: <b style={{ color: '#8b5cf6' }}>{d.thursdayTotalPacks || 0}</b>
                                            </div>
                                        </div>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                            <span style={{ fontSize: 13, fontWeight: 600, color: C.amber }}>{fmt(d.vendorPayoutTotal || d.vendorPayout || 0)}</span>
                                            <span style={{
                                                padding: '3px 10px', borderRadius: 6, fontSize: 11, fontWeight: 700,
                                                background: `${statusColor(d.status)}15`, color: statusColor(d.status),
                                            }}>{d.status || 'Sent'}</span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </Card>

                    {/* C. TOP ORDERED ITEMS */}
                    <Card>
                        <SectionHeader title="🏆 Most Ordered Items" cta="View Catalog →" onCta={() => navigate('/items')} />
                        {topItems.length === 0 ? (
                            <div style={{ textAlign: 'center', padding: '20px 0', color: C.muted, fontSize: 13 }}>
                                No order history yet. Items will appear once restaurants start ordering.
                            </div>
                        ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                                {topItems.map((item, i) => {
                                    const maxQty = topItems[0]?.qty || 1;
                                    const pct = (item.qty / maxQty) * 100;
                                    return (
                                        <div key={i} style={{
                                            display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px',
                                            background: 'rgba(255,255,255,0.02)', borderRadius: 8, border: `1px solid ${C.border}`,
                                        }}>
                                            <span style={{ fontSize: 14, fontWeight: 800, color: C.muted, width: 22 }}>{i + 1}</span>
                                            <div style={{ flex: 1 }}>
                                                <div style={{ fontSize: 13, fontWeight: 600, color: C.fg, marginBottom: 4 }}>{item.name}</div>
                                                <div style={{ width: '100%', height: 4, background: 'rgba(255,255,255,0.06)', borderRadius: 2, overflow: 'hidden' }}>
                                                    <div style={{ width: `${pct}%`, height: '100%', background: C.blue, borderRadius: 2, transition: 'width 0.3s' }} />
                                                </div>
                                            </div>
                                            <div style={{ textAlign: 'right' }}>
                                                <div style={{ fontSize: 14, fontWeight: 700, color: C.fg }}>{item.qty} units</div>
                                                <div style={{ fontSize: 11, color: C.green }}>{fmt(item.revenue)}</div>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </Card>

                    {/* D. RECENT ACTIVITY */}
                    <Card>
                        <SectionHeader title="📋 Recent Activity" />
                        {allOrders.length === 0 && allDispatches.length === 0 ? (
                            <div style={{ textAlign: 'center', padding: '20px 0', color: C.muted, fontSize: 13 }}>
                                Activity will appear as dispatches, imports, and payouts occur.
                            </div>
                        ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                                {allDispatches.slice(0, 4).map(d => (
                                    <div key={`d-${d.id}`} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', fontSize: 13 }}>
                                        <span style={{ fontSize: 16 }}>🚚</span>
                                        <span style={{ flex: 1, color: C.fg }}>
                                            Dispatch <b>{d.weekLabel || d.weekStart || d.id.slice(-6).toUpperCase()}</b> — {d.status || 'Sent'}
                                        </span>
                                        <span style={{ fontSize: 11, color: C.muted }}>{timeAgo(d.sentAt || d.createdAt)}</span>
                                    </div>
                                ))}
                                {allOrders.slice(0, 3).map(o => (
                                    <div key={`o-${o.id}`} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', fontSize: 13 }}>
                                        <span style={{ fontSize: 16 }}>📦</span>
                                        <span style={{ flex: 1, color: C.fg }}>
                                            Order #{o.orderGroupId || o.id.slice(-6).toUpperCase()} — {fmt(o.total)}
                                        </span>
                                        <span style={{ fontSize: 11, color: C.muted }}>{timeAgo(o.createdAt)}</span>
                                    </div>
                                ))}
                            </div>
                        )}
                    </Card>
                </div>

                {/* ── RIGHT COLUMN ── */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

                    {/* E. PAYOUT SUMMARY */}
                    <Card>
                        <SectionHeader title="💳 Payout Summary" cta="View Invoices" onCta={() => navigate('/vendor/invoices')} />
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
                            <div style={{ background: 'rgba(255,255,255,0.03)', padding: '10px 12px', borderRadius: 8 }}>
                                <div style={{ fontSize: 10, color: C.muted, fontWeight: 700, textTransform: 'uppercase', marginBottom: 4 }}>Pending Payout</div>
                                <div style={{ fontSize: 20, fontWeight: 800, color: C.amber }}>{fmt(payoutData.pending)}</div>
                            </div>
                            <div style={{ background: 'rgba(255,255,255,0.03)', padding: '10px 12px', borderRadius: 8 }}>
                                <div style={{ fontSize: 10, color: C.muted, fontWeight: 700, textTransform: 'uppercase', marginBottom: 4 }}>Paid This Month</div>
                                <div style={{ fontSize: 20, fontWeight: 800, color: C.green }}>{fmt(payoutData.paidThisMonth)}</div>
                            </div>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: C.muted, padding: '6px 0' }}>
                            <span>Total Paid</span>
                            <span style={{ fontWeight: 700, color: C.fg }}>{fmt(payoutData.totalPaid)}</span>
                        </div>
                        {payoutData.pendingCount > 0 && (
                            <div style={{ fontSize: 12, color: C.amber, marginTop: 8 }}>
                                📋 {payoutData.pendingCount} invoice{payoutData.pendingCount > 1 ? 's' : ''} pending
                            </div>
                        )}
                        {payoutData.pending === 0 && payoutData.totalPaid === 0 && (
                            <div style={{ textAlign: 'center', padding: '12px 0', color: C.muted, fontSize: 13 }}>
                                No pending payouts right now.
                            </div>
                        )}
                    </Card>

                    {/* F. CATALOG HEALTH */}
                    <Card>
                        <SectionHeader title="🩺 Catalog Health" cta="Review Catalog" onCta={() => navigate('/items')} />
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                            {[
                                { label: 'Active Items', value: catalogHealth.active, color: C.green },
                                { label: 'Inactive', value: catalogHealth.inactive, color: C.muted },
                                { label: 'Missing Pack Size', value: catalogHealth.missingPack, color: catalogHealth.missingPack > 0 ? C.amber : C.muted },
                                { label: 'Missing SKU', value: catalogHealth.missingSKU, color: catalogHealth.missingSKU > 0 ? C.amber : C.muted },
                                { label: 'Suspect Price', value: catalogHealth.suspectPrice, color: catalogHealth.suspectPrice > 0 ? C.red : C.muted },
                                { label: 'Stale Prices (14+ days)', value: catalogHealth.stale14 + catalogHealth.stale30, color: (catalogHealth.stale14 + catalogHealth.stale30) > 0 ? C.amber : C.muted },
                            ].map(r => (
                                <div key={r.label} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '5px 0', borderBottom: `1px solid ${C.border}` }}>
                                    <span style={{ color: C.muted }}>{r.label}</span>
                                    <span style={{ fontWeight: 700, color: r.color }}>{r.value}</span>
                                </div>
                            ))}
                        </div>
                        {catalogHealth.flagged > 0 && (
                            <div style={{ marginTop: 10, padding: '8px 12px', background: 'rgba(251,191,36,0.06)', border: '1px solid rgba(251,191,36,0.15)', borderRadius: 8, fontSize: 12, color: C.amber }}>
                                ⚠️ {catalogHealth.flagged} item{catalogHealth.flagged > 1 ? 's' : ''} need attention
                            </div>
                        )}
                    </Card>

                    {/* G. COMPETITIVENESS SNAPSHOT */}
                    <Card onClick={() => navigate('/vendor/score')}>
                        <SectionHeader title="🏅 Competitiveness" cta="View Score" onCta={() => navigate('/vendor/score')} />
                        <div style={{ textAlign: 'center', padding: '10px 0' }}>
                            <div style={{ fontSize: 12, color: C.muted, marginBottom: 6 }}>Your competitive score</div>
                            <div style={{ fontSize: 36, fontWeight: 800, color: C.blue }}>
                                {catalogHealth.active > 0 ? '—' : '0'}
                            </div>
                            <div style={{ fontSize: 12, color: C.muted, marginTop: 4 }}>Open to see factor breakdown & improvement tips</div>
                        </div>
                        {catalogHealth.stale30 > 0 && (
                            <div style={{ fontSize: 12, color: C.amber, marginTop: 8, padding: '8px 10px', background: 'rgba(251,191,36,0.06)', borderRadius: 6 }}>
                                💡 Stale prices may be reducing your score — update {catalogHealth.stale30} item{catalogHealth.stale30 > 1 ? 's' : ''}
                            </div>
                        )}
                    </Card>

                    {/* H. VENDOR PROFILE */}
                    <Card onClick={() => navigate('/vendor/profile')}>
                        <SectionHeader title="🏢 Vendor Profile" />
                        {vendorData ? (
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, fontSize: 13 }}>
                                <div>
                                    <div style={{ fontSize: 10, color: C.muted, fontWeight: 700, textTransform: 'uppercase', marginBottom: 3 }}>Business</div>
                                    <div style={{ color: C.fg, fontWeight: 500 }}>{vendorData.name || vendorData.businessName || '—'}</div>
                                </div>
                                <div>
                                    <div style={{ fontSize: 10, color: C.muted, fontWeight: 700, textTransform: 'uppercase', marginBottom: 3 }}>Category</div>
                                    <span style={{ padding: '2px 8px', borderRadius: 6, background: `${C.blue}15`, color: C.blue, fontSize: 11, fontWeight: 600 }}>
                                        {vendorData.category || 'General'}
                                    </span>
                                </div>
                                <div>
                                    <div style={{ fontSize: 10, color: C.muted, fontWeight: 700, textTransform: 'uppercase', marginBottom: 3 }}>Contact</div>
                                    <div style={{ color: C.fg, fontWeight: 500 }}>{vendorData.contactPhone || vendorData.contactEmail || '—'}</div>
                                </div>
                                <div>
                                    <div style={{ fontSize: 10, color: C.muted, fontWeight: 700, textTransform: 'uppercase', marginBottom: 3 }}>Status</div>
                                    <span style={{
                                        padding: '2px 8px', borderRadius: 6, fontSize: 11, fontWeight: 600,
                                        background: vendorData.status === 'active' ? `${C.green}15` : 'rgba(255,255,255,0.06)',
                                        color: vendorData.status === 'active' ? C.green : C.muted,
                                    }}>{vendorData.status || 'active'}</span>
                                </div>
                            </div>
                        ) : (
                            <div style={{ color: C.muted, fontSize: 13, padding: '12px 0' }}>No profile data available</div>
                        )}
                    </Card>

                    {/* I. SMART INSIGHTS */}
                    <Card>
                        <SectionHeader title="💡 Insights" />
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                            {dispatchStats.delivered > 0 && (
                                <div style={{ fontSize: 13, color: C.fg, padding: '8px 10px', background: `${C.green}08`, borderRadius: 6 }}>
                                    ✅ <b style={{ color: C.green }}>{dispatchStats.delivered}</b> successful deliver{dispatchStats.delivered > 1 ? 'ies' : 'y'} completed
                                </div>
                            )}
                            {topItems.length > 0 && (
                                <div style={{ fontSize: 13, color: C.fg, padding: '8px 10px', background: `${C.blue}08`, borderRadius: 6 }}>
                                    📈 Top demand: <b style={{ color: C.blue }}>{topItems[0].name}</b> ({topItems[0].qty} units)
                                </div>
                            )}
                            {catalogHealth.stale14 + catalogHealth.stale30 > 0 && (
                                <div style={{ fontSize: 13, color: C.fg, padding: '8px 10px', background: `${C.amber}08`, borderRadius: 6 }}>
                                    ⏰ {catalogHealth.stale14 + catalogHealth.stale30} item{catalogHealth.stale14 + catalogHealth.stale30 > 1 ? 's' : ''} need price updates
                                </div>
                            )}
                            <div style={{ fontSize: 13, color: C.fg, padding: '8px 10px', background: `${C.purple}08`, borderRadius: 6 }}>
                                ℹ️ Keep your catalog updated to maximize allocation on RestIQ.
                            </div>
                        </div>
                    </Card>
                </div>
            </div>

            {/* ═══════ SECTION 5: TREND FOOTER ═══════ */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginTop: 24 }}>
                <Card>
                    <div style={{ fontSize: 11, color: C.muted, fontWeight: 700, textTransform: 'uppercase', marginBottom: 6 }}>Total Revenue</div>
                    <div style={{ fontSize: 22, fontWeight: 800, color: C.green }}>{fmt(kpiData.currentRev)}</div>
                    <div style={{ fontSize: 11, color: C.muted }}>This week</div>
                </Card>
                <Card>
                    <div style={{ fontSize: 11, color: C.muted, fontWeight: 700, textTransform: 'uppercase', marginBottom: 6 }}>Fulfillment Rate</div>
                    <div style={{ fontSize: 22, fontWeight: 800, color: (dispatchStats.total > 0 && (dispatchStats.confirmed + dispatchStats.delivered + dispatchStats.packed + dispatchStats.outForDelivery) / dispatchStats.total >= 0.8) ? C.green : C.amber }}>
                        {dispatchStats.total > 0 ? `${Math.round(((dispatchStats.confirmed + dispatchStats.delivered + dispatchStats.packed + dispatchStats.outForDelivery) / dispatchStats.total) * 100)}%` : '—'}
                    </div>
                    <div style={{ fontSize: 11, color: C.muted }}>Accepted / Total</div>
                </Card>
                <Card>
                    <div style={{ fontSize: 11, color: C.muted, fontWeight: 700, textTransform: 'uppercase', marginBottom: 6 }}>Total Dispatches</div>
                    <div style={{ fontSize: 22, fontWeight: 800, color: C.blue }}>{dispatchStats.total}</div>
                    <div style={{ fontSize: 11, color: C.muted }}>Across all time</div>
                </Card>
                <Card>
                    <div style={{ fontSize: 11, color: C.muted, fontWeight: 700, textTransform: 'uppercase', marginBottom: 6 }}>Open Issues</div>
                    <div style={{ fontSize: 22, fontWeight: 800, color: openIssues.length > 0 ? C.red : C.green }}>{openIssues.length}</div>
                    <div style={{ fontSize: 11, color: C.muted }}>Requires response</div>
                </Card>
            </div>

            {/* ═══════ REVENUE MODAL ═══════ */}
            {showRevenueModal && (
                <>
                    <div style={{
                        position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
                        backgroundColor: 'rgba(0,0,0,0.6)', zIndex: 999, backdropFilter: 'blur(4px)',
                    }} onClick={() => setShowRevenueModal(false)} />
                    <div style={{
                        position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
                        backgroundColor: '#1a1b1e', border: '1px solid #2c2e33', borderRadius: 12,
                        width: '90%', maxWidth: 800, maxHeight: '80vh', overflow: 'hidden', zIndex: 1000,
                        display: 'flex', flexDirection: 'column', boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
                    }}>
                        <div style={{ padding: '20px 24px', borderBottom: '1px solid #2c2e33', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <div>
                                <h3 style={{ margin: 0, color: '#fff' }}>Revenue Breakdown</h3>
                                <div style={{ fontSize: 13, color: C.muted, marginTop: 4 }}>This Week's fulfilled orders</div>
                            </div>
                            <button onClick={() => setShowRevenueModal(false)} style={{ background: 'none', border: 'none', color: C.muted, fontSize: 22, cursor: 'pointer', padding: '4px 8px', borderRadius: 6 }}>✕</button>
                        </div>
                        <div style={{ overflowY: 'auto', flex: 1 }}>
                            <table style={{ margin: 0, width: '100%', borderCollapse: 'collapse' }}>
                                <thead style={{ backgroundColor: 'rgba(255,255,255,0.02)' }}>
                                    <tr>
                                        {['Order ID', 'Date', 'Status', 'Total'].map(h => (
                                            <th key={h} style={{ padding: '12px 24px', textAlign: h === 'Total' ? 'right' : h === 'Status' ? 'center' : 'left', borderBottom: '1px solid #2c2e33', color: C.muted, fontSize: 13 }}>{h}</th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody>
                                    {(kpiData?.revenueDetails || []).length === 0 ? (
                                        <tr><td colSpan="4" style={{ textAlign: 'center', padding: 32, color: C.muted }}>No revenue data for this timeframe.</td></tr>
                                    ) : (
                                        <>
                                            {(kpiData?.revenueDetails || []).map((row, i) => (
                                                <tr key={row.id || i} style={{ cursor: 'pointer', borderBottom: '1px solid #2c2e33', transition: 'background 0.2s' }}
                                                    onMouseEnter={e => e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.02)'}
                                                    onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}
                                                    onClick={() => { setShowRevenueModal(false); navigate(`/orders?orderId=${row.id}`); }}>
                                                    <td style={{ padding: '16px 24px', fontWeight: 600, fontSize: 13, color: '#fff' }}>{row.orderGroupId}</td>
                                                    <td style={{ padding: '16px 24px', fontSize: 13, color: C.muted }}>
                                                        {row.createdAt?.toDate ? row.createdAt.toDate().toLocaleDateString() : 'N/A'}
                                                    </td>
                                                    <td style={{ padding: '16px 24px', textAlign: 'center' }}>
                                                        <span style={{ display: 'inline-block', padding: '3px 10px', borderRadius: 6, background: `${C.green}15`, color: C.green, fontSize: 11, fontWeight: 700 }}>
                                                            {row.status?.replace(/_/g, ' ') || 'unknown'}
                                                        </span>
                                                    </td>
                                                    <td style={{ padding: '16px 24px', textAlign: 'right', fontWeight: 600, color: C.blue }}>{fmt(row.total)}</td>
                                                </tr>
                                            ))}
                                            <tr style={{ backgroundColor: 'rgba(255,255,255,0.01)' }}>
                                                <td colSpan="3" style={{ padding: '16px 24px', fontWeight: 700, color: '#fff' }}>Total ({(kpiData?.revenueDetails || []).length} orders)</td>
                                                <td style={{ padding: '16px 24px', textAlign: 'right', fontWeight: 700, color: C.blue, fontSize: 16 }}>{fmt(kpiData?.currentRev || 0)}</td>
                                            </tr>
                                        </>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </>
            )}
        </div>
    );
}
