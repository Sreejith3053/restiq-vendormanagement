import React, { useEffect, useState, useContext, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { UserContext } from '../contexts/UserContext';
import { db } from '../firebase';
import { collection, getDocs, doc, getDoc, query, where } from 'firebase/firestore';

export default function Dashboard() {
    const navigate = useNavigate();
    const { vendorId, vendorName, isSuperAdmin } = useContext(UserContext);
    const [stats, setStats] = useState({ items: 0, users: 0, categories: 0 });
    const [vendorData, setVendorData] = useState(null);
    const [loading, setLoading] = useState(true);

    // Filter state
    const [timeFilter, setTimeFilter] = useState('This Week');

    // Data state
    const [allOrders, setAllOrders] = useState([]);
    const [vendorItemsMap, setVendorItemsMap] = useState({});

    // Derived state for Dashboard widgets
    const kpiData = useMemo(() => {
        const now = new Date();
        const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const sevenDaysAgo = new Date(now.getTime() - (7 * 24 * 60 * 60 * 1000));
        const fourteenDaysAgo = new Date(now.getTime() - (14 * 24 * 60 * 60 * 1000));

        let currentRev = 0;
        let prevRev = 0;
        let pending = 0;
        let fulfilled = 0;

        allOrders.forEach(order => {
            const orderDate = order.createdAt?.toDate ? order.createdAt.toDate() : new Date(order.createdAt);

            // Revenue calc
            if (order.status !== 'rejected') {
                if (orderDate >= sevenDaysAgo) {
                    currentRev += (order.total || 0);
                } else if (orderDate >= fourteenDaysAgo && orderDate < sevenDaysAgo) {
                    prevRev += (order.total || 0);
                }
            }

            // Status counters
            if (['pending_confirmation', 'pending_customer_approval', 'pending_fulfillment', 'delivery_in_route'].includes(order.status)) {
                pending++;
            }
            if (order.status === 'fulfilled') {
                fulfilled++;
            }
        });

        let revChange = 0;
        if (prevRev > 0) {
            revChange = ((currentRev - prevRev) / prevRev) * 100;
        } else if (currentRev > 0) {
            revChange = 100;
        }

        return { currentRev, prevRev, revChange, pending, fulfilled };
    }, [allOrders]);

    const derivedData = useMemo(() => {
        const now = new Date();
        const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());

        let startDate = new Date(0); // Default to beginning of time
        let endDate = new Date('9999-12-31'); // Default to end of time

        if (timeFilter === 'This Week') {
            // Last 7 days including today
            startDate = new Date(now.getTime() - (7 * 24 * 60 * 60 * 1000));
            endDate = now;
        } else if (timeFilter === 'This Month') {
            // First day of current month
            startDate = new Date(now.getFullYear(), now.getMonth(), 1);
            endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59); // Last day of current month
        } else if (timeFilter === 'Last Month') {
            // First day of last month
            startDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
            // Last day of last month
            endDate = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);
        }

        // Filter orders based on selected time range
        const filteredOrders = allOrders.filter(order => {
            const orderDate = order.createdAt?.toDate ? order.createdAt.toDate() : new Date(order.createdAt);
            return orderDate >= startDate && orderDate <= endDate;
        });

        // 1. Recent Orders
        const recent = filteredOrders.slice(0, 5);

        // 2. Most Selling Items
        const itemCounts = {};
        filteredOrders.forEach(order => {
            if (order.status !== 'rejected' && order.items && Array.isArray(order.items)) {
                order.items.forEach(item => {
                    const resolvedId = item.id || vendorItemsMap[item.name?.toLowerCase()?.trim()];
                    const itemKey = resolvedId || item.name;
                    if (!itemCounts[itemKey]) {
                        itemCounts[itemKey] = {
                            id: resolvedId,
                            name: item.name,
                            category: item.category || 'N/A',
                            price: item.price,
                            quantity: 0
                        };
                    }
                    itemCounts[itemKey].quantity += (item.qty || 0);
                });
            }
        });

        const topItems = Object.values(itemCounts)
            .sort((a, b) => b.quantity - a.quantity)
            .slice(0, 5);

        return { recentOrders: recent, mostSellingItems: topItems };

    }, [timeFilter, allOrders, vendorItemsMap]);

    useEffect(() => {
        (async () => {
            try {
                if (isSuperAdmin) return; // Super admin doesn't see this dashboard

                // 1. Fetch vendor profile
                if (vendorId) {
                    const vendorSnap = await getDoc(doc(db, 'vendors', vendorId));
                    if (vendorSnap.exists()) {
                        setVendorData({ id: vendorSnap.id, ...vendorSnap.data() });
                    }
                }

                // 2. Count items & categories for this vendor
                let totalItems = 0;
                const categorySet = new Set();
                const fetchedVendorItems = {};
                if (vendorId) {
                    try {
                        const itemSnap = await getDocs(collection(db, `vendors/${vendorId}/items`));
                        totalItems = itemSnap.size;
                        itemSnap.docs.forEach(d => {
                            const data = d.data();
                            if (data.category) categorySet.add(data.category);
                            if (data.name) fetchedVendorItems[data.name.toLowerCase().trim()] = d.id;
                        });
                        setVendorItemsMap(fetchedVendorItems);
                    } catch { /* skip */ }
                }

                // 3. Count users for this vendor
                let totalUsers = 0;
                try {
                    const usersQ = query(
                        collection(db, 'login'),
                        where('vendorId', '==', vendorId)
                    );
                    const usersSnap = await getDocs(usersQ);
                    totalUsers = usersSnap.size;
                } catch { /* skip */ }

                setStats({
                    items: totalItems,
                    users: totalUsers,
                    categories: categorySet.size,
                });

                // 4. Fetch ALL marketplaceOrders for the vendor
                if (vendorId) {
                    try {
                        const ordersQ = query(
                            collection(db, 'marketplaceOrders'),
                            where('vendorId', '==', vendorId)
                        );
                        const ordersSnap = await getDocs(ordersQ);
                        let fetchedOrders = ordersSnap.docs.map(d => ({ id: d.id, ...d.data() }));

                        // Sort globally descending by default
                        fetchedOrders.sort((a, b) => {
                            const dateA = a.createdAt?.toDate ? a.createdAt.toDate() : new Date(a.createdAt);
                            const dateB = b.createdAt?.toDate ? b.createdAt.toDate() : new Date(b.createdAt);
                            return dateB - dateA;
                        });

                        setAllOrders(fetchedOrders);

                        // KPI data is now calculated entirely via useMemo (kpiData) based on fetchedOrders


                    } catch (err) {
                        console.error("Error fetching orders for dashboard:", err);
                    }
                }

            } catch (err) {
                console.error('Dashboard load error:', err);
            } finally {
                setLoading(false);
            }
        })();
    }, [vendorId, isSuperAdmin]);

    const formatCurrency = (amount) => {
        return new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' }).format(amount || 0);
    };

    const formatDate = (timestamp) => {
        if (!timestamp) return 'N/A';
        const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
        return date.toLocaleDateString();
    };

    const timeAgo = (dateInput) => {
        if (!dateInput) return '';
        const date = dateInput.toDate ? dateInput.toDate() : new Date(dateInput);
        const seconds = Math.floor((new Date() - date) / 1000);
        let interval = seconds / 31536000;
        if (interval > 1) return Math.floor(interval) + " years ago";
        interval = seconds / 2592000;
        if (interval > 1) return Math.floor(interval) + " months ago";
        interval = seconds / 86400;
        if (interval > 1) return Math.floor(interval) + " days ago";
        interval = seconds / 3600;
        if (interval > 1) return Math.floor(interval) + " hours ago";
        interval = seconds / 60;
        if (interval > 1) return Math.floor(interval) + " mins ago";
        return "just now";
    };

    if (loading) {
        return (
            <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>
                Loading dashboard...
            </div>
        );
    }

    return (
        <div>
            <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
                <div>
                    <h2>Welcome, {vendorName || 'Vendor'}</h2>
                    <p className="subtitle" style={{ margin: 0, marginTop: '4px', color: 'var(--text-secondary)' }}>Here's what's happening today.</p>
                </div>

                {/* Time Filter Dropdown */}
                <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                    <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Data range:</span>
                    <select
                        value={timeFilter}
                        onChange={(e) => setTimeFilter(e.target.value)}
                        style={{
                            padding: '8px 12px',
                            borderRadius: '8px',
                            background: 'rgba(255, 255, 255, 0.05)',
                            border: '1px solid rgba(255, 255, 255, 0.1)',
                            color: 'var(--text-primary)',
                            fontSize: '14px',
                            cursor: 'pointer',
                            outline: 'none',
                        }}
                    >
                        <option value="This Week" style={{ background: '#0a192f', color: '#fff' }}>Past 7 Days</option>
                        <option value="This Month" style={{ background: '#0a192f', color: '#fff' }}>This Month</option>
                        <option value="Last Month" style={{ background: '#0a192f', color: '#fff' }}>Last Month</option>
                    </select>
                </div>
            </div>

            {/* Top Row: General Stats & Revenue */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '20px', marginBottom: '32px' }}>

                {/* 1. Weekly Revenue */}
                <div className="ui-card" style={{ display: 'flex', flexDirection: 'column', padding: '24px', background: '#1E1E1E', border: '1px solid #2A2A2A', transition: 'transform 0.2s', ':hover': { transform: 'translateY(-2px)' } }}>
                    <div style={{ fontSize: '14px', color: 'var(--text-secondary)', fontWeight: 600 }}>Weekly Revenue</div>
                    <div style={{ fontSize: '32px', fontWeight: 700, margin: '8px 0', color: 'var(--text-primary)' }}>{formatCurrency(kpiData.currentRev)}</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '14px' }}>
                        {kpiData.revChange >= 0 ? (
                            <span style={{ color: '#4ade80', display: 'flex', alignItems: 'center', fontWeight: 600 }}><span style={{ fontSize: '16px', marginRight: '4px' }}>↑</span> {Math.max(0.1, kpiData.revChange).toFixed(0)}%</span>
                        ) : (
                            <span style={{ color: '#ef4444', display: 'flex', alignItems: 'center', fontWeight: 600 }}><span style={{ fontSize: '16px', marginRight: '4px' }}>↓</span> {Math.abs(kpiData.revChange).toFixed(0)}%</span>
                        )}
                        <span style={{ color: 'var(--text-secondary)' }}>vs last week</span>
                    </div>
                </div>

                {/* 2. Pending Orders */}
                <div className="ui-card" onClick={() => navigate('/orders')} style={{ display: 'flex', flexDirection: 'column', padding: '24px', cursor: 'pointer', background: '#1E1E1E', border: '1px solid #2A2A2A', transition: 'transform 0.2s', ':hover': { transform: 'translateY(-2px)' } }}>
                    <div style={{ fontSize: '14px', color: 'var(--text-secondary)', fontWeight: 600 }}>Pending Orders</div>
                    <div style={{ fontSize: '32px', fontWeight: 700, margin: '8px 0', color: 'var(--text-primary)' }}>{kpiData.pending}</div>
                    <div style={{ fontSize: '14px', color: 'var(--text-secondary)' }}>Requires action</div>
                </div>

                {/* 3. Total Items */}
                <div className="ui-card" onClick={() => navigate('/items')} style={{ display: 'flex', flexDirection: 'column', padding: '24px', cursor: 'pointer', background: '#1E1E1E', border: '1px solid #2A2A2A', transition: 'transform 0.2s', ':hover': { transform: 'translateY(-2px)' } }}>
                    <div style={{ fontSize: '14px', color: 'var(--text-secondary)', fontWeight: 600 }}>Total Items</div>
                    <div style={{ fontSize: '32px', fontWeight: 700, margin: '8px 0', color: 'var(--text-primary)' }}>{stats.items}</div>
                    <div style={{ fontSize: '14px', color: 'var(--text-secondary)' }}>Live in catalog</div>
                </div>

                {/* 4. Fulfilled Orders */}
                <div className="ui-card" onClick={() => navigate('/orders')} style={{ display: 'flex', flexDirection: 'column', padding: '24px', cursor: 'pointer', background: '#1E1E1E', border: '1px solid #2A2A2A', transition: 'transform 0.2s', ':hover': { transform: 'translateY(-2px)' } }}>
                    <div style={{ fontSize: '14px', color: 'var(--text-secondary)', fontWeight: 600 }}>Fulfilled Orders</div>
                    <div style={{ fontSize: '32px', fontWeight: 700, margin: '8px 0', color: 'var(--text-primary)' }}>{kpiData.fulfilled}</div>
                    <div style={{ fontSize: '14px', color: 'var(--text-secondary)' }}>All-time delivered</div>
                </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 1fr)', gap: '24px', alignItems: 'start' }}>
                {/* Left Column */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                    {/* Most Selling Items */}
                    <div className="ui-card" style={{ background: '#1E1E1E', border: '1px solid #2A2A2A', padding: '24px' }}>
                        <div className="ui-card-title" style={{ fontSize: '18px', fontWeight: 600, marginBottom: '20px' }}>Most Selling Items ({timeFilter})</div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                            {derivedData.mostSellingItems.length === 0 ? (
                                <div style={{ color: 'var(--text-secondary)', textAlign: 'center', padding: '20px' }}>No sales history found for {timeFilter.toLowerCase()}</div>
                            ) : (
                                derivedData.mostSellingItems.map((item, idx) => {
                                    const maxQty = derivedData.mostSellingItems[0].quantity || 1;
                                    const percentage = (item.quantity / maxQty) * 100;
                                    return (
                                        <div
                                            key={idx}
                                            onClick={item.id ? () => navigate(`/vendors/${vendorId}/items/${item.id}`) : undefined}
                                            style={{
                                                display: 'flex',
                                                alignItems: 'center',
                                                justifyContent: 'space-between',
                                                padding: '14px 16px',
                                                background: 'rgba(255,255,255,0.02)',
                                                borderRadius: '8px',
                                                cursor: item.id ? 'pointer' : 'default',
                                                border: '1px solid rgba(255,255,255,0.05)',
                                                transition: 'background 0.2s',
                                            }}
                                            onMouseEnter={(e) => { if (item.id) e.currentTarget.style.background = 'rgba(255,255,255,0.05)' }}
                                            onMouseLeave={(e) => { if (item.id) e.currentTarget.style.background = 'rgba(255,255,255,0.02)' }}
                                        >
                                            <div style={{ flex: 1, paddingRight: '16px' }}>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                                                    <span style={{ fontWeight: 600, fontSize: '15px', color: 'var(--text-primary)' }}>{item.name}</span>
                                                    {item.category && item.category !== 'N/A' && (
                                                        <span style={{ padding: '2px 8px', borderRadius: '12px', background: 'rgba(0, 200, 255, 0.1)', color: '#00c8ff', fontSize: '11px', fontWeight: 600, textTransform: 'uppercase' }}>{item.category}</span>
                                                    )}
                                                </div>
                                                <div style={{ display: 'flex', gap: '16px', fontSize: '13px', color: 'var(--text-secondary)' }}>
                                                    <span>{formatCurrency(item.price)} / unit</span>
                                                    <span>Revenue: <strong style={{ color: 'var(--text-primary)' }}>{formatCurrency(item.quantity * item.price)}</strong></span>
                                                </div>
                                            </div>
                                            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', width: '100px', flexShrink: 0 }}>
                                                <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '8px' }}>Qty: {item.quantity}</div>
                                                <div style={{ width: '100%', height: '6px', background: 'rgba(255,255,255,0.1)', borderRadius: '3px', overflow: 'hidden' }}>
                                                    <div style={{ width: `${percentage}%`, height: '100%', background: '#00c8ff', borderRadius: '3px' }} />
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })
                            )}
                        </div>
                    </div>
                </div>

                {/* Right Column */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                    {/* Recent Orders */}
                    <div className="ui-card" style={{ background: '#1E1E1E', border: '1px solid #2A2A2A', padding: '24px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                            <div className="ui-card-title" style={{ margin: 0, fontSize: '18px', fontWeight: 600 }}>Recent Orders</div>
                            <button className="ui-btn ghost" style={{ fontSize: '13px', padding: '6px 14px' }} onClick={() => navigate('/orders')}>View All</button>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                            {derivedData.recentOrders.length === 0 ? (
                                <div style={{ color: 'var(--text-secondary)', textAlign: 'center', padding: '20px 0' }}>No orders found</div>
                            ) : (
                                derivedData.recentOrders.map(order => {
                                    let badgeColor = 'rgba(255,255,255,0.1)';
                                    let badgeText = '#fff';
                                    const lowerStatus = (order.status || '').toLowerCase();

                                    if (lowerStatus.includes('reject')) {
                                        badgeColor = 'rgba(239, 68, 68, 0.15)';
                                        badgeText = '#ef4444';
                                    } else if (lowerStatus.includes('fulfill') || lowerStatus === 'delivered') {
                                        badgeColor = 'rgba(74, 222, 128, 0.15)';
                                        badgeText = '#4ade80';
                                    } else if (lowerStatus.includes('pending') || lowerStatus.includes('review') || lowerStatus.includes('route')) {
                                        badgeColor = 'rgba(250, 204, 21, 0.15)';
                                        badgeText = '#facc15';
                                    }

                                    return (
                                        <div
                                            key={order.id}
                                            onClick={() => navigate('/orders')}
                                            style={{
                                                display: 'flex',
                                                flexDirection: 'column',
                                                padding: '16px',
                                                background: 'rgba(255,255,255,0.02)',
                                                border: '1px solid rgba(255,255,255,0.05)',
                                                borderRadius: '8px',
                                                cursor: 'pointer',
                                                transition: 'background 0.2s ease'
                                            }}
                                            onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.05)'}
                                            onMouseLeave={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.02)'}
                                        >
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                                    <span style={{ fontFamily: 'monospace', fontWeight: 600, fontSize: '15px', color: 'var(--text-primary)' }}>{order.orderGroupId || order.id.slice(0, 8)}</span>
                                                    <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>• {timeAgo(order.createdAt)}</span>
                                                </div>
                                                <span style={{ fontWeight: 700, fontSize: '16px', color: 'var(--text-primary)' }}>{formatCurrency(order.total)}</span>
                                            </div>
                                            <div>
                                                <span style={{
                                                    display: 'inline-block',
                                                    padding: '4px 12px',
                                                    borderRadius: '6px',
                                                    fontSize: '11px',
                                                    fontWeight: 700,
                                                    textTransform: 'uppercase',
                                                    letterSpacing: '0.5px',
                                                    background: badgeColor,
                                                    color: badgeText
                                                }}>
                                                    {order.status?.replace(/_/g, ' ') || 'unknown'}
                                                </span>
                                            </div>
                                        </div>
                                    );
                                })
                            )}
                        </div>
                    </div>

                    {/* Vendor Profile Card */}
                    <div className="ui-card">
                        <div className="ui-card-title">Vendor Profile</div>
                        {vendorData ? (
                            <div style={{ padding: '8px 0' }}>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', fontSize: 13, color: 'var(--text-secondary)' }}>
                                    <div>
                                        <div style={{ fontSize: 11, color: '#5a6f8a', fontWeight: 700, textTransform: 'uppercase', marginBottom: 4 }}>Business Name</div>
                                        <span style={{ color: 'var(--text-primary)' }}>{vendorData.name || vendorData.businessName || '—'}</span>
                                    </div>
                                    <div>
                                        <div style={{ fontSize: 11, color: '#5a6f8a', fontWeight: 700, textTransform: 'uppercase', marginBottom: 4 }}>Category</div>
                                        <span className="badge blue">{vendorData.category || 'General'}</span>
                                    </div>
                                    <div>
                                        <div style={{ fontSize: 11, color: '#5a6f8a', fontWeight: 700, textTransform: 'uppercase', marginBottom: 4 }}>Contact</div>
                                        <span style={{ color: 'var(--text-primary)' }}>{vendorData.contactPhone || vendorData.contactEmail || '—'}</span>
                                    </div>
                                    <div>
                                        <div style={{ fontSize: 11, color: '#5a6f8a', fontWeight: 700, textTransform: 'uppercase', marginBottom: 4 }}>Status</div>
                                        <span className={`badge ${vendorData.status === 'active' ? 'green' : 'gray'}`}>
                                            {vendorData.status || 'active'}
                                        </span>
                                    </div>
                                </div>
                            </div>
                        ) : (
                            <div style={{ color: 'var(--text-secondary)', fontSize: 13 }}>No profile data available</div>
                        )}
                    </div>
                </div>
            </div>

            {/* Smart Alerts */}
            <div className="ui-card" style={{ marginTop: '32px', padding: '24px', background: 'rgba(255, 215, 0, 0.03)', border: '1px solid rgba(255, 215, 0, 0.15)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '20px' }}>
                    <span style={{ fontSize: '20px' }}>💡</span>
                    <div className="ui-card-title" style={{ margin: 0, fontSize: '18px', fontWeight: 600, color: '#facc15' }}>Smart Insights</div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '20px' }}>

                    {kpiData.pending > 0 && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '16px', background: 'rgba(255,255,255,0.02)', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.05)' }}>
                            <div style={{ padding: '8px', background: 'rgba(250, 204, 21, 0.15)', borderRadius: '50%', color: '#facc15', width: '36px', height: '36px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                ⚠
                            </div>
                            <div style={{ fontSize: '14px', color: 'var(--text-primary)' }}>
                                You have <strong style={{ color: '#facc15' }}>{kpiData.pending} pending orders</strong> that require immediate fulfillment.
                            </div>
                        </div>
                    )}

                    {derivedData.mostSellingItems.length > 0 && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '16px', background: 'rgba(255,255,255,0.02)', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.05)' }}>
                            <div style={{ padding: '8px', background: 'rgba(74, 222, 128, 0.15)', borderRadius: '50%', color: '#4ade80', width: '36px', height: '36px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                📈
                            </div>
                            <div style={{ fontSize: '14px', color: 'var(--text-primary)' }}>
                                Top demand item this {timeFilter.split(' ')[1]?.toLowerCase() || 'period'}: <strong style={{ color: '#4ade80' }}>{derivedData.mostSellingItems[0].name}</strong>
                            </div>
                        </div>
                    )}

                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '16px', background: 'rgba(255,255,255,0.02)', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.05)' }}>
                        <div style={{ padding: '8px', background: 'rgba(96, 165, 250, 0.15)', borderRadius: '50%', color: '#60a5fa', width: '36px', height: '36px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            ℹ
                        </div>
                        <div style={{ fontSize: '14px', color: 'var(--text-primary)' }}>
                            Keep your catalog up to date to maximize visibility on the RestIQ marketplace.
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
