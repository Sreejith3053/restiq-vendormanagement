import React, { useState, useEffect, useContext, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { UserContext } from '../../contexts/UserContext';
import { db } from '../../firebase';
import { collection, query, getDocs } from 'firebase/firestore';
import { toast } from 'react-toastify';
import {
    LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer
} from 'recharts';

// Date utility helpers
const getStartOfDay = (date = new Date()) => {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    return d;
};
const getStartOfWeek = (date = new Date()) => {
    const d = new Date(date);
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    d.setDate(diff);
    d.setHours(0, 0, 0, 0);
    return d;
};
const getStartOfMonth = (date = new Date()) => {
    const d = new Date(date);
    d.setDate(1);
    d.setHours(0, 0, 0, 0);
    return d;
};

export default function SuperAdminDashboard() {
    const { isSuperAdmin } = useContext(UserContext);
    const navigate = useNavigate();

    // Timeframe: 'today', 'week', 'month'
    const [timeframe, setTimeframe] = useState('month');

    // Loading states
    const [loadingStats, setLoadingStats] = useState(true);

    // Commission modal
    const [showCommissionModal, setShowCommissionModal] = useState(false);

    // Revenue modal
    const [showRevenueModal, setShowRevenueModal] = useState(false);

    // Top Items History state
    const [topItemsWithHistory, setTopItemsWithHistory] = useState([]);
    const [loadingHistory, setLoadingHistory] = useState(false);

    // Raw Data
    const [orders, setOrders] = useState([]);
    const [invoices, setInvoices] = useState([]);
    const [vendors, setVendors] = useState([]);

    // ─── Data Fetching ───
    useEffect(() => {
        if (!isSuperAdmin) return;

        const fetchDashboardData = async () => {
            setLoadingStats(true);
            try {
                // Determine the earliest date we need based on timeframe
                // For simplicity and caching, we'll fetch the whole current month
                // In a massive production app, we'd use server-side aggregation.
                const startDate = getStartOfMonth();

                // 1. Fetch Orders created this month
                // Assuming createdAt is stored as a Firebase Timestamp or ISO string.
                // If it's a timestamp, we can query it directly.
                const ordersQ = query(collection(db, 'marketplaceOrders'));
                // We'll fetch all active/recent ones. If large, we need to index `createdAt`.
                // For now, let's fetch all and filter in memory since we lack guaranteed indexes.
                const oSnap = await getDocs(ordersQ);
                const allOrders = oSnap.docs.map(d => ({ id: d.id, ...d.data() }));

                // 2. Fetch Invoices this month
                const invSnap = await getDocs(collection(db, 'vendorInvoices'));
                const allInvoices = invSnap.docs.map(d => ({ id: d.id, ...d.data() }));

                // 3. Fetch Vendors for names
                const vSnap = await getDocs(collection(db, 'vendors'));
                const allVendors = vSnap.docs.map(d => ({ id: d.id, ...d.data() }));

                setOrders(allOrders);
                setInvoices(allInvoices);
                setVendors(allVendors);

            } catch (err) {
                console.error("Dashboard dataload error:", err);
                toast.error("Failed to load dashboard data");
            } finally {
                setLoadingStats(false);
            }
        };

        fetchDashboardData();
    }, [isSuperAdmin]);

    // ─── Analytics Computations ───
    const stats = useMemo(() => {
        let startTime;
        const now = new Date();
        if (timeframe === 'today') startTime = getStartOfDay(now);
        else if (timeframe === 'week') startTime = getStartOfWeek(now);
        else startTime = getStartOfMonth(now);

        const isWithinTimeframe = (timestamp) => {
            if (!timestamp) return false;
            const d = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
            return d >= startTime;
        };

        // Filter valid orders and invoices
        const tfOrders = orders.filter(o => isWithinTimeframe(o.createdAt || o.orderDate));
        const tfInvoices = invoices.filter(i => isWithinTimeframe(i.createdAt || i.invoiceDate));

        // Metics
        let totalRevenue = 0; // grandTotalAfterTax of completed/fulfilled orders
        let ordersToday = 0;
        let newOrdersCount = 0;
        let cancelledToday = 0;

        const todayStart = getStartOfDay();

        tfOrders.forEach(o => {
            const status = (o.status || '').toLowerCase();
            // Count today's metrics
            const d = (o.createdAt || o.orderDate)?.toDate ? (o.createdAt || o.orderDate).toDate() : new Date(o.createdAt || o.orderDate);
            if (d && d >= todayStart) {
                ordersToday++;
                if (['cancelled', 'rejected'].includes(status)) cancelledToday++;
            }
            if (['new', 'pending', 'pending_confirmation', 'pending_customer_approval', 'pending_fulfillment'].includes(status)) newOrdersCount++;

            // Revenue
            if (['fulfilled', 'completed', 'accepted', 'delivery_in_route'].includes(status)) {
                totalRevenue += Number(o.grandTotalAfterTax || o.total || 0);
            }
        });

        // Invoice Metrics
        let totalPendingPayout = 0;
        let totalCommission = 0;
        let pendingInvoicesCount = 0;
        let totalVendorGross = 0;

        tfInvoices.forEach(inv => {
            totalCommission += Number(inv.commissionAmount || 0);
            totalVendorGross += Number(inv.grossVendorAmount || inv.subtotalVendorAmount || 0);

            if (inv.paymentStatus === 'PENDING') {
                totalPendingPayout += Number(inv.netVendorPayable || 0) + Number(inv.totalTaxAmount || 0);
                pendingInvoicesCount++;
            }
        });

        // Vendor Performance Data (Top 5)
        const vendorAgg = {};
        tfOrders.forEach(o => {
            if (!vendorAgg[o.vendorId]) {
                vendorAgg[o.vendorId] = { id: o.vendorId, orders: 0, revenue: 0, cancelled: 0 };
            }
            vendorAgg[o.vendorId].orders++;
            if (o.status === 'CANCELLED') vendorAgg[o.vendorId].cancelled++;
            if (o.status === 'FULFILLED' || o.status === 'ACCEPTED') {
                vendorAgg[o.vendorId].revenue += Number(o.grandTotalAfterTax || o.total || 0);
            }
        });

        tfInvoices.forEach(inv => {
            if (!vendorAgg[inv.vendorId]) {
                vendorAgg[inv.vendorId] = { id: inv.vendorId, orders: 0, revenue: 0, cancelled: 0 };
            }
            vendorAgg[inv.vendorId].commission = (vendorAgg[inv.vendorId].commission || 0) + Number(inv.commissionAmount || 0);
            if (inv.paymentStatus === 'PENDING') {
                vendorAgg[inv.vendorId].pending = (vendorAgg[inv.vendorId].pending || 0) + Number(inv.netVendorPayable || 0) + Number(inv.totalTaxAmount || 0);
            }
        });

        let topVendors = Object.values(vendorAgg).map(v => {
            const vendorRef = vendors.find(x => x.id === v.id);
            return {
                ...v,
                name: vendorRef ? (vendorRef.name || vendorRef.businessName) : 'Unknown Vendor',
                cancellationRate: v.orders > 0 ? (v.cancelled / v.orders) * 100 : 0
            };
        }).sort((a, b) => b.revenue - a.revenue).slice(0, 5);

        // Chart Data (Daily breakdown within timeframe)
        // Group tfInvoices and tfOrders by date
        const chartDataMap = {};

        tfOrders.forEach(o => {
            if (o.status === 'FULFILLED' || o.status === 'ACCEPTED') {
                const dt = (o.createdAt || o.orderDate)?.toDate ? (o.createdAt || o.orderDate).toDate() : new Date(o.createdAt || o.orderDate);
                if (!dt) return;
                const dStr = dt.toISOString().split('T')[0];
                if (!chartDataMap[dStr]) chartDataMap[dStr] = { date: dStr, Revenue: 0, Payout: 0, Commission: 0 };
                chartDataMap[dStr].Revenue += Number(o.grandTotalAfterTax || o.total || 0);
            }
        });

        tfInvoices.forEach(inv => {
            const dt = (inv.createdAt || inv.invoiceDate)?.toDate ? (inv.createdAt || inv.invoiceDate).toDate() : new Date(inv.createdAt || inv.invoiceDate);
            if (!dt) return;
            const dStr = dt.toISOString().split('T')[0];
            if (!chartDataMap[dStr]) chartDataMap[dStr] = { date: dStr, Revenue: 0, Payout: 0, Commission: 0 };
            chartDataMap[dStr].Payout += Number(inv.netVendorPayable || 0) + Number(inv.totalTaxAmount || 0);
            chartDataMap[dStr].Commission += Number(inv.commissionAmount || 0);
        });

        const chartData = Object.values(chartDataMap).sort((a, b) => a.date.localeCompare(b.date));

        // Commission breakdown per invoice (for modal)
        const commissionDetails = tfInvoices
            .filter(inv => Number(inv.commissionAmount || 0) > 0)
            .map(inv => {
                const vendorRef = vendors.find(x => x.id === inv.vendorId);
                return {
                    id: inv.id,
                    invoiceNumber: inv.invoiceNumber || inv.id.slice(-8).toUpperCase(),
                    orderGroupId: inv.orderGroupId || inv.orderId?.slice(-8).toUpperCase() || '—',
                    vendorName: vendorRef ? (vendorRef.name || vendorRef.businessName) : 'Unknown Vendor',
                    grossAmount: Number(inv.grossVendorAmount || inv.subtotalVendorAmount || 0),
                    commissionPercent: Number(inv.commissionPercent || 0),
                    commissionAmount: Number(inv.commissionAmount || 0),
                    paymentStatus: inv.paymentStatus
                };
            })
            .sort((a, b) => b.commissionAmount - a.commissionAmount);

        // Revenue breakdown per order (for modal)
        const revenueDetails = tfOrders
            .filter(o => ['fulfilled', 'completed', 'accepted', 'delivery_in_route'].includes((o.status || '').toLowerCase()))
            .map(o => {
                return {
                    id: o.id,
                    orderGroupId: o.orderGroupId || o.id.slice(-8).toUpperCase(),
                    vendorName: o.vendorName || 'Unknown Vendor',
                    restaurantId: o.restaurantId || '—',
                    status: o.status,
                    total: Number(o.grandTotalAfterTax || o.total || 0)
                };
            })
            .sort((a, b) => b.total - a.total);

        // Top Selling Items by Category
        const categoryItemMap = {};
        const fulfilledOrders = orders.filter(o => ['fulfilled', 'completed', 'accepted', 'delivery_in_route'].includes((o.status || '').toLowerCase()));

        fulfilledOrders.forEach(o => {
            (o.items || []).forEach(item => {
                const cat = item.category || 'Uncategorized';
                const itemIdKey = item.id || `${item.name}_${o.vendorId}`;

                if (!categoryItemMap[cat]) categoryItemMap[cat] = {};
                if (!categoryItemMap[cat][itemIdKey]) {
                    categoryItemMap[cat][itemIdKey] = {
                        id: item.id || '',
                        name: item.name,
                        category: cat,
                        vendorId: o.vendorId,
                        vendorName: o.vendorName,
                        qtySold: 0,
                        revenue: 0,
                        currentPrice: Number(item.vendorPrice ?? item.price ?? 0),
                    };
                }
                categoryItemMap[cat][itemIdKey].qtySold += Number(item.qty || 0);
                categoryItemMap[cat][itemIdKey].revenue += Number(item.qty || 0) * Number(item.vendorPrice ?? item.price ?? 0);
            });
        });

        const topItemsByCategory = Object.keys(categoryItemMap).map(cat => {
            const items = Object.values(categoryItemMap[cat]);
            items.sort((a, b) => b.qtySold - a.qtySold);
            return items[0]; // Get the top #1 item for this category
        }).filter(Boolean).sort((a, b) => b.qtySold - a.qtySold);

        return {
            totalRevenue,
            ordersToday,
            newOrdersCount,
            cancelledToday,
            totalPendingPayout,
            totalCommission,
            pendingInvoicesCount,
            totalVendorGross,
            topVendors,
            chartData,
            commissionDetails,
            revenueDetails,
            topItemsByCategory
        };
    }, [orders, invoices, vendors, timeframe]);


    // Fetch Last Price Change for top items asynchronously
    useEffect(() => {
        const fetchHistory = async () => {
            if (!stats.topItemsByCategory || stats.topItemsByCategory.length === 0) return;
            setLoadingHistory(true);
            try {
                const itemsWithLog = await Promise.all(stats.topItemsByCategory.map(async (item) => {
                    if (!item.id || !item.vendorId) return { ...item, lastPriceChange: '—' };
                    // Fetch audit log for this item
                    const snap = await getDocs(collection(db, `vendors/${item.vendorId}/items/${item.id}/auditLog`));
                    const logs = snap.docs.map(d => d.data());
                    logs.sort((a, b) => {
                        const tA = a.timestamp?.toMillis?.() || a.timestamp?.seconds * 1000 || 0;
                        const tB = b.timestamp?.toMillis?.() || b.timestamp?.seconds * 1000 || 0;
                        return tB - tA;
                    });

                    // Find the most recent price change in the audit log
                    const lastChangeLog = logs.find(log => {
                        const oldP = log.originalData?.vendorPrice ?? log.originalData?.price;
                        const newP = log.proposedData?.vendorPrice ?? log.proposedData?.price;
                        return oldP !== undefined && newP !== undefined && Number(oldP) !== Number(newP);
                    });

                    let lastPriceChange = '—';
                    if (lastChangeLog && lastChangeLog.timestamp) {
                        const d = lastChangeLog.timestamp.toDate ? lastChangeLog.timestamp.toDate() : new Date(lastChangeLog.timestamp.seconds * 1000);
                        lastPriceChange = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
                    }
                    return { ...item, lastPriceChange };
                }));
                setTopItemsWithHistory(itemsWithLog);
            } catch (error) {
                console.error("Failed to fetch price history for top items", error);
                setTopItemsWithHistory(stats.topItemsByCategory);
            } finally {
                setLoadingHistory(false);
            }
        };
        fetchHistory();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [stats.topItemsByCategory]);

    if (!isSuperAdmin) {
        return <div style={{ padding: 40, textAlign: 'center' }}>Access Denied</div>;
    }

    if (loadingStats) {
        return <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>Calculating marketplace metrics...</div>;
    }

    return (
        <div>
            <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                    <h2>Marketplace Control Center</h2>
                    <div style={{ color: 'var(--muted)', fontSize: 13, marginTop: 4 }}>
                        Platform health, revenue, and pending vendor operations.
                    </div>
                </div>

                <div style={{ display: 'flex', gap: 8 }}>
                    {['today', 'week', 'month'].map(tf => (
                        <button
                            key={tf}
                            className={`ui-btn small ${timeframe === tf ? 'primary' : 'ghost'}`}
                            onClick={() => setTimeframe(tf)}
                            style={{ textTransform: 'capitalize' }}
                        >
                            {tf}
                        </button>
                    ))}
                </div>
            </div>

            {/* SECTION 1 - Top KPI Cards */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16, marginBottom: 24 }}>
                <div className="ui-card stat-card" style={{ padding: 20, cursor: 'pointer' }} onClick={() => setShowRevenueModal(true)}>
                    <div className="stat-label">Total Revenue</div>
                    <div className="stat-value" style={{ color: '#4dabf7' }}>${stats.totalRevenue.toFixed(2)}</div>
                    <div className="stat-context" style={{ fontSize: 11, color: 'var(--muted)' }}>Click for breakdown</div>
                </div>
                <div className="ui-card stat-card" style={{ padding: 20, cursor: 'pointer' }} onClick={() => navigate('/admin/invoices?status=PENDING')}>
                    <div className="stat-label">Vendor Payouts (Pending)</div>
                    <div className="stat-value" style={{ color: '#f59e0b' }}>${stats.totalPendingPayout.toFixed(2)}</div>
                    <div className="stat-context">{stats.pendingInvoicesCount} invoices waiting</div>
                </div>
                <div className="ui-card stat-card" style={{ padding: 20, cursor: 'pointer' }} onClick={() => setShowCommissionModal(true)}>
                    <div className="stat-label">Total Commission Earned</div>
                    <div className="stat-value" style={{ color: '#4ade80' }}>${stats.totalCommission.toFixed(2)}</div>
                    <div className="stat-context" style={{ fontSize: 11, color: 'var(--muted)' }}>Click for breakdown</div>
                </div>
                <div className="ui-card stat-card" style={{ padding: 20, cursor: 'pointer' }} onClick={() => navigate('/orders')}>
                    <div className="stat-label">Orders (Today)</div>
                    <div className="stat-value">{stats.ordersToday}</div>
                </div>
                <div className="ui-card stat-card" style={{ padding: 20, cursor: 'pointer' }} onClick={() => navigate('/orders?status=pending_confirmation')}>
                    <div className="stat-label">Pending Action</div>
                    <div className="stat-value">{stats.newOrdersCount}</div>
                    <div className="stat-context">Unaccepted orders</div>
                </div>
                <div className="ui-card stat-card" style={{ padding: 20, cursor: 'pointer' }} onClick={() => navigate('/orders?status=rejected')}>
                    <div className="stat-label">Cancelled (Today)</div>
                    <div className="stat-value" style={{ color: '#ff6b7a' }}>{stats.cancelledToday}</div>
                </div>
            </div>

            {/* SECTION 2 & 5 - Graph and Mini Summary */}
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 24, marginBottom: 24 }}>
                <div className="ui-card" style={{ padding: 20 }}>
                    <h3 style={{ marginBottom: 16 }}>Revenue & Commission Flow</h3>
                    <div style={{ height: 300 }}>
                        <ResponsiveContainer width="100%" height="100%">
                            <LineChart data={stats.chartData} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
                                <CartesianGrid strokeDasharray="3 3" stroke="#2c2e33" />
                                <XAxis dataKey="date" stroke="#909296" fontSize={12} tickFormatter={(tick) => tick.slice(5)} />
                                <YAxis stroke="#909296" fontSize={12} tickFormatter={(val) => `$${val}`} />
                                <Tooltip
                                    contentStyle={{ backgroundColor: '#1a1b1e', borderColor: '#2c2e33', borderRadius: 8 }}
                                    itemStyle={{ color: '#e9ecef' }}
                                />
                                <Legend />
                                <Line type="monotone" dataKey="Revenue" stroke="#4dabf7" strokeWidth={2} dot={false} />
                                <Line type="monotone" dataKey="Payout" stroke="#f59e0b" strokeWidth={2} dot={false} />
                                <Line type="monotone" dataKey="Commission" stroke="#4ade80" strokeWidth={2} dot={false} />
                            </LineChart>
                        </ResponsiveContainer>
                    </div>
                </div>

                <div className="ui-card" style={{ padding: 20 }}>
                    <h3 style={{ marginBottom: 16 }}>Most Selling Items by Category</h3>
                    {loadingHistory ? (
                        <div style={{ textAlign: 'center', padding: 40, color: 'var(--muted)' }}>Loading top items...</div>
                    ) : topItemsWithHistory.length === 0 ? (
                        <div style={{ textAlign: 'center', padding: 40, color: 'var(--muted)' }}>No sales data available.</div>
                    ) : (
                        <div style={{ overflowX: 'auto', maxHeight: '300px' }}>
                            <table className="ui-table" style={{ margin: 0, fontSize: 13 }}>
                                <thead style={{ position: 'sticky', top: 0, backgroundColor: 'var(--card-bg, #1a1b1e)', zIndex: 1 }}>
                                    <tr>
                                        <th>Category</th>
                                        <th>Name</th>
                                        <th style={{ textAlign: 'right' }}>Qty Sold</th>
                                        <th style={{ textAlign: 'right' }}>Revenue</th>
                                        <th style={{ textAlign: 'right' }}>Current Price</th>
                                        <th style={{ textAlign: 'right' }}>Last Price Change</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {topItemsWithHistory.map((item, i) => (
                                        <tr key={i}>
                                            <td style={{ fontWeight: 600 }}>{item.category}</td>
                                            <td>
                                                <div style={{ fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '120px' }}>{item.name}</div>
                                                <div style={{ fontSize: 11, color: 'var(--muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '120px' }}>{item.vendorName}</div>
                                            </td>
                                            <td style={{ textAlign: 'right', fontWeight: 600, color: '#4dabf7' }}>{item.qtySold}</td>
                                            <td style={{ textAlign: 'right', color: '#4ade80' }}>${item.revenue.toFixed(2)}</td>
                                            <td style={{ textAlign: 'right' }}>${item.currentPrice.toFixed(2)}</td>
                                            <td style={{ textAlign: 'right', color: 'var(--muted)', fontSize: 12 }}>{item.lastPriceChange}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            </div>

            {/* SECTION 3 - Vendor Performance Table */}
            <div className="ui-card" style={{ overflow: 'hidden' }}>
                <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)' }}>
                    <h3 style={{ margin: 0 }}>Top 5 Vendors (Revenue)</h3>
                </div>
                <div className="ui-table-wrap">
                    <table className="ui-table" style={{ margin: 0 }}>
                        <thead>
                            <tr>
                                <th>Vendor Name</th>
                                <th>Total Orders</th>
                                <th style={{ textAlign: 'right' }}>Total Revenue</th>
                                <th style={{ textAlign: 'right' }}>Commission</th>
                                <th style={{ textAlign: 'right' }}>Pending Payout</th>
                                <th style={{ textAlign: 'center' }}>Cancel Rate</th>
                            </tr>
                        </thead>
                        <tbody>
                            {stats.topVendors.length === 0 ? (
                                <tr><td colSpan="6" style={{ textAlign: 'center', padding: 24, color: 'var(--muted)' }}>No vendor data found for this timeframe.</td></tr>
                            ) : (
                                stats.topVendors.map(v => (
                                    <tr key={v.id} className="is-row">
                                        <td style={{ fontWeight: 600 }}>{v.name}</td>
                                        <td>{v.orders}</td>
                                        <td style={{ textAlign: 'right', fontWeight: 600, color: '#4ade80' }}>${v.revenue.toFixed(2)}</td>
                                        <td style={{ textAlign: 'right', color: 'var(--muted)' }}>${(v.commission || 0).toFixed(2)}</td>
                                        <td style={{ textAlign: 'right', color: '#f59e0b' }}>
                                            {v.pending > 0 ? `$${v.pending.toFixed(2)}` : '—'}
                                        </td>
                                        <td style={{ textAlign: 'center' }}>
                                            <span className={`badge ${v.cancellationRate > 10 ? 'red' : 'green'}`} style={{ width: 60, display: 'inline-block' }}>
                                                {v.cancellationRate.toFixed(1)}%
                                            </span>
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* ── Commission Breakdown Modal ── */}
            {showCommissionModal && (
                <>
                    <div style={{
                        position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
                        backgroundColor: 'rgba(0,0,0,0.6)', zIndex: 999,
                        backdropFilter: 'blur(4px)'
                    }} onClick={() => setShowCommissionModal(false)} />
                    <div style={{
                        position: 'fixed', top: '50%', left: '50%',
                        transform: 'translate(-50%, -50%)',
                        backgroundColor: 'var(--card-bg, #1a1b1e)',
                        border: '1px solid var(--border, #2c2e33)',
                        borderRadius: 12, padding: 0,
                        width: '90%', maxWidth: 800, maxHeight: '80vh',
                        overflow: 'hidden', zIndex: 1000,
                        display: 'flex', flexDirection: 'column',
                        boxShadow: '0 20px 60px rgba(0,0,0,0.5)'
                    }}>
                        <div style={{
                            padding: '20px 24px', borderBottom: '1px solid var(--border, #2c2e33)',
                            display: 'flex', justifyContent: 'space-between', alignItems: 'center'
                        }}>
                            <div>
                                <h3 style={{ margin: 0 }}>Commission Breakdown</h3>
                                <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 4 }}>
                                    {timeframe === 'today' ? "Today's" : timeframe === 'week' ? "This Week's" : "This Month's"} commissions per invoice
                                </div>
                            </div>
                            <button
                                onClick={() => setShowCommissionModal(false)}
                                style={{
                                    background: 'none', border: 'none', color: 'var(--muted)',
                                    fontSize: 22, cursor: 'pointer', padding: '4px 8px',
                                    borderRadius: 6, lineHeight: 1
                                }}
                                onMouseEnter={e => e.target.style.color = '#fff'}
                                onMouseLeave={e => e.target.style.color = 'var(--muted)'}
                            >
                                ✕
                            </button>
                        </div>
                        <div style={{ overflowY: 'auto', flex: 1 }}>
                            <table className="ui-table" style={{ margin: 0 }}>
                                <thead>
                                    <tr>
                                        <th>Invoice #</th>
                                        <th>Order</th>
                                        <th>Vendor</th>
                                        <th style={{ textAlign: 'right' }}>Gross Amount</th>
                                        <th style={{ textAlign: 'center' }}>Rate</th>
                                        <th style={{ textAlign: 'right' }}>Commission</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {stats.commissionDetails.length === 0 ? (
                                        <tr>
                                            <td colSpan="6" style={{ textAlign: 'center', padding: 32, color: 'var(--muted)' }}>
                                                No commission data for this timeframe.
                                            </td>
                                        </tr>
                                    ) : (
                                        <>
                                            {stats.commissionDetails.map(row => (
                                                <tr key={row.id} className="is-row" style={{ cursor: 'pointer' }} onClick={() => { setShowCommissionModal(false); navigate(`/admin/invoices/${row.id}`); }}>
                                                    <td style={{ fontWeight: 600, fontSize: 13 }}>{row.invoiceNumber}</td>
                                                    <td style={{ fontSize: 13, color: 'var(--muted)' }}>{row.orderGroupId}</td>
                                                    <td>{row.vendorName}</td>
                                                    <td style={{ textAlign: 'right' }}>${row.grossAmount.toFixed(2)}</td>
                                                    <td style={{ textAlign: 'center' }}>
                                                        <span className="badge green" style={{ minWidth: 44, display: 'inline-block' }}>
                                                            {row.commissionPercent}%
                                                        </span>
                                                    </td>
                                                    <td style={{ textAlign: 'right', fontWeight: 600, color: '#4ade80' }}>
                                                        ${row.commissionAmount.toFixed(2)}
                                                    </td>
                                                </tr>
                                            ))}
                                            <tr style={{ borderTop: '2px solid var(--border, #2c2e33)' }}>
                                                <td colSpan="3" style={{ fontWeight: 700 }}>Total ({stats.commissionDetails.length} invoices)</td>
                                                <td style={{ textAlign: 'right', fontWeight: 600 }}>
                                                    ${stats.commissionDetails.reduce((s, r) => s + r.grossAmount, 0).toFixed(2)}
                                                </td>
                                                <td></td>
                                                <td style={{ textAlign: 'right', fontWeight: 700, color: '#4ade80', fontSize: 16 }}>
                                                    ${stats.totalCommission.toFixed(2)}
                                                </td>
                                            </tr>
                                        </>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </>
            )}

            {/* ── Revenue Breakdown Modal ── */}
            {showRevenueModal && (
                <>
                    <div style={{
                        position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
                        backgroundColor: 'rgba(0,0,0,0.6)', zIndex: 999,
                        backdropFilter: 'blur(4px)'
                    }} onClick={() => setShowRevenueModal(false)} />
                    <div style={{
                        position: 'fixed', top: '50%', left: '50%',
                        transform: 'translate(-50%, -50%)',
                        backgroundColor: 'var(--card-bg, #1a1b1e)',
                        border: '1px solid var(--border, #2c2e33)',
                        borderRadius: 12, padding: 0,
                        width: '90%', maxWidth: 800, maxHeight: '80vh',
                        overflow: 'hidden', zIndex: 1000,
                        display: 'flex', flexDirection: 'column',
                        boxShadow: '0 20px 60px rgba(0,0,0,0.5)'
                    }}>
                        <div style={{
                            padding: '20px 24px', borderBottom: '1px solid var(--border, #2c2e33)',
                            display: 'flex', justifyContent: 'space-between', alignItems: 'center'
                        }}>
                            <div>
                                <h3 style={{ margin: 0 }}>Revenue Breakdown</h3>
                                <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 4 }}>
                                    {timeframe === 'today' ? "Today's" : timeframe === 'week' ? "This Week's" : "This Month's"} fulfilled orders
                                </div>
                            </div>
                            <button
                                onClick={() => setShowRevenueModal(false)}
                                style={{
                                    background: 'none', border: 'none', color: 'var(--muted)',
                                    fontSize: 22, cursor: 'pointer', padding: '4px 8px',
                                    borderRadius: 6, lineHeight: 1
                                }}
                                onMouseEnter={e => e.target.style.color = '#fff'}
                                onMouseLeave={e => e.target.style.color = 'var(--muted)'}
                            >
                                ✕
                            </button>
                        </div>
                        <div style={{ overflowY: 'auto', flex: 1 }}>
                            <table className="ui-table" style={{ margin: 0 }}>
                                <thead>
                                    <tr>
                                        <th>Order ID</th>
                                        <th>Restaurant</th>
                                        <th>Vendor</th>
                                        <th style={{ textAlign: 'center' }}>Status</th>
                                        <th style={{ textAlign: 'right' }}>Total</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {stats.revenueDetails.length === 0 ? (
                                        <tr>
                                            <td colSpan="5" style={{ textAlign: 'center', padding: 32, color: 'var(--muted)' }}>
                                                No revenue data for this timeframe.
                                            </td>
                                        </tr>
                                    ) : (
                                        <>
                                            {stats.revenueDetails.map(row => (
                                                <tr key={row.id} className="is-row" style={{ cursor: 'pointer' }} onClick={() => { setShowRevenueModal(false); navigate(`/orders?orderId=${row.id}`); }}>
                                                    <td style={{ fontWeight: 600, fontSize: 13 }}>{row.orderGroupId}</td>
                                                    <td>{row.restaurantId}</td>
                                                    <td>{row.vendorName}</td>
                                                    <td style={{ textAlign: 'center' }}>
                                                        <span className={`badge ${row.status?.toLowerCase() === 'cancelled' || row.status?.toLowerCase() === 'rejected' ? 'red' : 'green'}`} style={{ display: 'inline-block' }}>
                                                            {row.status?.replace(/_/g, ' ') || 'unknown'}
                                                        </span>
                                                    </td>
                                                    <td style={{ textAlign: 'right', fontWeight: 600, color: '#4dabf7' }}>
                                                        ${row.total.toFixed(2)}
                                                    </td>
                                                </tr>
                                            ))}
                                            <tr style={{ borderTop: '2px solid var(--border, #2c2e33)' }}>
                                                <td colSpan="4" style={{ fontWeight: 700 }}>Total ({stats.revenueDetails.length} orders)</td>
                                                <td style={{ textAlign: 'right', fontWeight: 700, color: '#4dabf7', fontSize: 16 }}>
                                                    ${stats.totalRevenue.toFixed(2)}
                                                </td>
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
