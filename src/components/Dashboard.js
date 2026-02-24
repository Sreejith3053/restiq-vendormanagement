import React, { useEffect, useState, useContext } from 'react';
import { useNavigate } from 'react-router-dom';
import { UserContext } from '../contexts/UserContext';
import { db } from '../firebase';
import { collection, getDocs, doc, getDoc, query, where, orderBy, limit } from 'firebase/firestore';

export default function Dashboard() {
    const navigate = useNavigate();
    const { vendorId, vendorName, isSuperAdmin } = useContext(UserContext);
    const [stats, setStats] = useState({ items: 0, users: 0, categories: 0 });
    const [vendorData, setVendorData] = useState(null);
    const [loading, setLoading] = useState(true);

    // New State for Dashboard widgets
    const [weeklyRevenue, setWeeklyRevenue] = useState(0);
    const [recentOrders, setRecentOrders] = useState([]);
    const [mostSellingItems, setMostSellingItems] = useState([]);

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
                if (vendorId) {
                    try {
                        const itemSnap = await getDocs(collection(db, `vendors/${vendorId}/items`));
                        totalItems = itemSnap.size;
                        itemSnap.docs.forEach(d => {
                            const cat = d.data().category;
                            if (cat) categorySet.add(cat);
                        });
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

                // 4. Fetch marketplaceOrders for the vendor
                if (vendorId) {
                    try {
                        const ordersQ = query(
                            collection(db, 'marketplaceOrders'),
                            where('vendorId', '==', vendorId)
                            // We will fetch all and process them client-side since we need history for most-selling items
                        );
                        const ordersSnap = await getDocs(ordersQ);
                        const allOrders = ordersSnap.docs.map(d => ({ id: d.id, ...d.data() }));

                        // Process Weekly Revenue (last 7 days)
                        const now = new Date();
                        const sevenDaysAgo = new Date(now.getTime() - (7 * 24 * 60 * 60 * 1000));
                        let revenue = 0;

                        // Sort orders by date descending
                        allOrders.sort((a, b) => {
                            const dateA = a.createdAt?.toDate ? a.createdAt.toDate() : new Date(a.createdAt);
                            const dateB = b.createdAt?.toDate ? b.createdAt.toDate() : new Date(b.createdAt);
                            return dateB - dateA;
                        });

                        // Last 5 Orders
                        setRecentOrders(allOrders.slice(0, 5));

                        // Aggregate Most Selling Items
                        const itemCounts = {};

                        allOrders.forEach(order => {
                            const orderDate = order.createdAt?.toDate ? order.createdAt.toDate() : new Date(order.createdAt);
                            if (orderDate >= sevenDaysAgo && order.status !== 'rejected') {
                                revenue += (order.total || 0);
                            }

                            if (order.status !== 'rejected' && order.items && Array.isArray(order.items)) {
                                order.items.forEach(item => {
                                    if (!itemCounts[item.id]) {
                                        itemCounts[item.id] = {
                                            id: item.id,
                                            name: item.name,
                                            category: item.category || 'N/A',
                                            price: item.price,
                                            quantity: 0
                                        };
                                    }
                                    itemCounts[item.id].quantity += (item.qty || 0);
                                });
                            }
                        });

                        setWeeklyRevenue(revenue);

                        // Convert to array and sort by quantity desc, take top 8
                        const topItems = Object.values(itemCounts)
                            .sort((a, b) => b.quantity - a.quantity)
                            .slice(0, 8);
                        setMostSellingItems(topItems);

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
            </div>

            {/* Top Row: General Stats & Revenue */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '20px', marginBottom: '24px' }}>
                <div className="ui-card" style={{ display: 'flex', flexDirection: 'column', padding: '20px', background: 'linear-gradient(135deg, rgba(0, 200, 255, 0.1) 0%, rgba(0, 200, 255, 0.02) 100%)', border: '1px solid rgba(0, 200, 255, 0.2)' }}>
                    <div style={{ fontSize: '13px', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px', fontWeight: 600 }}>Weekly Revenue</div>
                    <div style={{ fontSize: '32px', fontWeight: 700, marginTop: '8px', color: '#00c8ff' }}>{formatCurrency(weeklyRevenue)}</div>
                    <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '4px' }}>Last 7 days (Excl. rejected)</div>
                </div>

                <div className="ui-card" onClick={() => navigate('/items')} style={{ display: 'flex', flexDirection: 'column', padding: '20px', cursor: 'pointer', transition: 'all 0.2s ease', ':hover': { transform: 'translateY(-2px)' } }}>
                    <div style={{ fontSize: '13px', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px', fontWeight: 600 }}>Total Items</div>
                    <div style={{ fontSize: '32px', fontWeight: 700, marginTop: '8px', color: 'var(--text-primary)' }}>{stats.items}</div>
                </div>

                <div className="ui-card" onClick={() => navigate('/users')} style={{ display: 'flex', flexDirection: 'column', padding: '20px', cursor: 'pointer', transition: 'all 0.2s ease' }}>
                    <div style={{ fontSize: '13px', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px', fontWeight: 600 }}>Team Members</div>
                    <div style={{ fontSize: '32px', fontWeight: 700, marginTop: '8px', color: 'var(--text-primary)' }}>{stats.users}</div>
                </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 1fr)', gap: '24px', alignItems: 'start' }}>
                {/* Left Column */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                    {/* Most Selling Items */}
                    <div className="ui-card">
                        <div className="ui-card-title">Most Selling Items</div>
                        <div className="orders-table-wrapper" style={{ margin: '0 -20px -20px -20px', borderRadius: '0 0 12px 12px' }}>
                            <table className="orders-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
                                <thead>
                                    <tr>
                                        <th style={{ padding: '12px 20px', textAlign: 'left', borderBottom: '1px solid var(--border-color)', color: 'var(--text-secondary)', fontSize: '12px', textTransform: 'uppercase' }}>Item Name</th>
                                        <th style={{ padding: '12px 20px', textAlign: 'left', borderBottom: '1px solid var(--border-color)', color: 'var(--text-secondary)', fontSize: '12px', textTransform: 'uppercase' }}>Category</th>
                                        <th style={{ padding: '12px 20px', textAlign: 'right', borderBottom: '1px solid var(--border-color)', color: 'var(--text-secondary)', fontSize: '12px', textTransform: 'uppercase' }}>Price</th>
                                        <th style={{ padding: '12px 20px', textAlign: 'right', borderBottom: '1px solid var(--border-color)', color: 'var(--text-secondary)', fontSize: '12px', textTransform: 'uppercase' }}>Qty Sold</th>
                                        <th style={{ padding: '12px 20px', textAlign: 'right', borderBottom: '1px solid var(--border-color)', color: 'var(--text-secondary)', fontSize: '12px', textTransform: 'uppercase' }}>Total</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {mostSellingItems.length === 0 ? (
                                        <tr>
                                            <td colSpan={5} style={{ textAlign: 'center', padding: '30px', color: 'var(--text-secondary)' }}>No sales history found</td>
                                        </tr>
                                    ) : (
                                        mostSellingItems.map((item, idx) => (
                                            <tr
                                                key={idx}
                                                onClick={() => navigate(`/vendors/${vendorId}/items/${item.id}`)}
                                                style={{
                                                    borderBottom: '1px solid rgba(255,255,255,0.05)',
                                                    cursor: 'pointer',
                                                    transition: 'background 0.2s ease',
                                                }}
                                                onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.03)'}
                                                onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                                            >
                                                <td style={{ padding: '16px 20px', fontWeight: 500, color: 'var(--text-primary)' }}>{item.name}</td>
                                                <td style={{ padding: '16px 20px', color: 'var(--text-secondary)' }}><span className="badge blue" style={{ fontSize: '11px' }}>{item.category}</span></td>
                                                <td style={{ padding: '16px 20px', textAlign: 'right', color: 'var(--text-primary)' }}>{formatCurrency(item.price)}</td>
                                                <td style={{ padding: '16px 20px', textAlign: 'right', fontWeight: 600, color: '#4ade80' }}>{item.quantity}</td>
                                                <td style={{ padding: '16px 20px', textAlign: 'right', fontWeight: 600, color: '#00c8ff' }}>{formatCurrency(item.price * item.quantity)}</td>
                                            </tr>
                                        ))
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>

                {/* Right Column */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                    {/* Recent Orders */}
                    <div className="ui-card">
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                            <div className="ui-card-title" style={{ margin: 0 }}>Recent Orders</div>
                            <button className="ui-btn ghost" style={{ fontSize: '13px', padding: '4px 12px' }} onClick={() => navigate('/orders')}>View All</button>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                            {recentOrders.length === 0 ? (
                                <div style={{ color: 'var(--text-secondary)', textAlign: 'center', padding: '20px 0' }}>No recent orders</div>
                            ) : (
                                recentOrders.map(order => (
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
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                                            <span style={{ fontFamily: 'monospace', fontWeight: 600, color: 'var(--text-primary)' }}>{order.orderGroupId || order.id.slice(0, 8)}</span>
                                            <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>{formatDate(order.createdAt)}</span>
                                        </div>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                            <span className={`status-badge ${order.status?.toLowerCase()}`} style={{ fontSize: '11px', padding: '2px 8px' }}>
                                                {order.status?.replace(/_/g, ' ') || 'unknown'}
                                            </span>
                                            <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{formatCurrency(order.total)}</span>
                                        </div>
                                    </div>
                                ))
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
                            <div style={{ padding: 20, textAlign: 'center', color: 'var(--muted)' }}>
                                Vendor profile not found.
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
