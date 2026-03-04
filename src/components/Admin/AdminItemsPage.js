import React, { useState, useEffect, useContext } from 'react';
import { db } from '../../firebase';
import { collection, collectionGroup, getDocs, query, orderBy } from 'firebase/firestore';
import { toast } from 'react-toastify';
import { UserContext } from '../../contexts/UserContext';
import './AdminItemsPage.css';

const AdminItemsPage = () => {
    const { isSuperAdmin } = useContext(UserContext);
    const [items, setItems] = useState([]);
    const [loading, setLoading] = useState(true);
    const [selectedCategory, setSelectedCategory] = useState('All');
    const [categories, setCategories] = useState(['All']);
    const [selectedVendor, setSelectedVendor] = useState('All');
    const [uniqueVendors, setUniqueVendors] = useState([]);

    // Analytics Modal State
    const [analyticsItem, setAnalyticsItem] = useState(null);
    const [analyticsData, setAnalyticsData] = useState(null);
    const [loadingAnalytics, setLoadingAnalytics] = useState(false);

    // History Modal State
    const [historyItem, setHistoryItem] = useState(null);
    const [historyLogs, setHistoryLogs] = useState([]);
    const [loadingHistory, setLoadingHistory] = useState(false);

    useEffect(() => {
        if (!isSuperAdmin) return;

        const fetchItems = async () => {
            setLoading(true);
            try {
                // 1. Fetch all items
                const itemsQuery = query(collectionGroup(db, 'items'));
                const snapshot = await getDocs(itemsQuery);

                // 2. Fetch all vendors for proper name mapping
                const vendorsSnap = await getDocs(collection(db, 'vendors'));
                const vendorsMap = {};
                vendorsSnap.docs.forEach(d => {
                    vendorsMap[d.id] = d.data().name || d.data().businessName || d.id;
                });

                const allItems = snapshot.docs.map(doc => {
                    const data = doc.data();
                    // Extract vendorId from the reference path
                    const vendorId = doc.ref.parent.parent.id;
                    return {
                        id: doc.id,
                        vendorId,
                        vendorName: vendorsMap[vendorId] || 'Unknown Vendor',
                        ...data
                    };
                });

                setItems(allItems);

                // Extract unique categories and vendors
                const cats = new Set(['All']);
                const vMap = new Map(); // vendorId -> Vendor Name

                allItems.forEach(item => {
                    if (item.category) cats.add(item.category);
                    if (item.vendorId) {
                        vMap.set(item.vendorId, item.vendorName);
                    }
                });

                setCategories(Array.from(cats).sort());
                setUniqueVendors(Array.from(vMap.entries()).map(([id, name]) => ({ id, name })));
            } catch (err) {
                console.error("Error fetching admin items:", err);
                toast.error("Failed to load items");
            } finally {
                setLoading(false);
            }
        };

        fetchItems();
    }, [isSuperAdmin]);

    const handleViewAnalytics = async (item) => {
        setAnalyticsItem(item);
        setAnalyticsData(null);
        setLoadingAnalytics(true);

        try {
            // 1. Fetch all orders for this vendor to calculate item's performance
            const ordersQuery = query(collection(db, 'marketplaceOrders'));
            const oSnap = await getDocs(ordersQuery);
            const allVendorOrders = oSnap.docs.map(d => d.data()).filter(o => o.vendorId === item.vendorId);

            let totalSold = 0;
            let totalRevenue = 0;

            allVendorOrders.forEach(o => {
                const status = (o.status || '').toLowerCase();
                if (['fulfilled', 'completed', 'delivered'].includes(status)) {
                    (o.items || []).forEach(orderItem => {
                        const isMatch = orderItem.id === item.id || (orderItem.name === item.name && orderItem.vendorId === item.vendorId);
                        if (isMatch) {
                            const qty = Number(orderItem.qty || 0);
                            const price = Number(orderItem.vendorPrice ?? orderItem.price ?? 0);
                            totalSold += qty;
                            totalRevenue += (qty * price);
                        }
                    });
                }
            });

            // 2. Fetch Audit Logs for Price Trend
            const auditRef = collection(db, `vendors/${item.vendorId}/items/${item.id}/auditLog`);
            const aSnap = await getDocs(auditRef);
            const logs = aSnap.docs.map(d => d.data());

            logs.sort((a, b) => {
                const tA = a.timestamp?.toMillis?.() || a.timestamp?.seconds * 1000 || 0;
                const tB = b.timestamp?.toMillis?.() || b.timestamp?.seconds * 1000 || 0;
                return tA - tB; // Ascending (oldest first)
            });

            const monthlyPrices = {};
            const itemCreationPrice = Number(item.vendorPrice ?? item.price ?? 0);

            // Group price by month (assuming logs sorted oldest to newest)
            logs.forEach(log => {
                const newP = log.proposedData?.vendorPrice ?? log.proposedData?.price ?? log.newData?.vendorPrice ?? log.newData?.price;
                if (newP !== undefined) {
                    const dt = log.timestamp?.toDate ? log.timestamp.toDate() : new Date(log.timestamp?.seconds * 1000);
                    const monthKey = dt.toLocaleString('en-US', { month: 'short', year: 'numeric' });
                    // Store the LATEST price for that month
                    monthlyPrices[monthKey] = Number(newP);
                }
            });

            // Ensure current month is always present even if no logs
            const currentMonthKey = new Date().toLocaleString('en-US', { month: 'short', year: 'numeric' });
            if (Object.keys(monthlyPrices).length === 0) {
                monthlyPrices[currentMonthKey] = itemCreationPrice;
            } else if (!monthlyPrices[currentMonthKey]) {
                // If there weren't changes this exact month, carry over the last known value
                monthlyPrices[currentMonthKey] = Number(Object.values(monthlyPrices).pop() || itemCreationPrice);
            }

            const monthKeys = Object.keys(monthlyPrices);
            const priceTrend = [];
            let previousPrice = null;

            monthKeys.forEach((month) => {
                const price = monthlyPrices[month];
                let percentChange = 0;
                if (previousPrice) {
                    percentChange = ((price - previousPrice) / previousPrice) * 100;
                }
                priceTrend.push({
                    month,
                    price,
                    percentChange: previousPrice ? percentChange : 0,
                });
                previousPrice = price;
            });

            // Calculate overall insight (first month vs latest month)
            const firstPrice = priceTrend[0].price;
            const lastPrice = priceTrend[priceTrend.length - 1].price;
            let overallChange = 0;
            if (firstPrice > 0) {
                overallChange = ((lastPrice - firstPrice) / firstPrice) * 100;
            }

            const estimatedCommission = totalRevenue * ((item.vendorCommission || 15) / 100);

            setAnalyticsData({
                totalSold,
                totalRevenue,
                estimatedCommission,
                priceTrend, // Ascending for horizontal scroll layout
                overallChange
            });

        } catch (error) {
            console.error("Error fetching analytics:", error);
            toast.error("Failed to load item analytics.");
        } finally {
            setLoadingAnalytics(false);
        }
    };

    const handleViewHistory = async (item) => {
        setHistoryItem(item);
        setHistoryLogs([]);
        setLoadingHistory(true);
        try {
            const auditRef = collection(db, `vendors/${item.vendorId}/items/${item.id}/auditLog`);
            const snap = await getDocs(auditRef);
            const logs = snap.docs.map(d => d.data());

            // Sort by timestamp descending
            logs.sort((a, b) => {
                const tA = a.timestamp?.toMillis?.() || a.timestamp?.seconds * 1000 || 0;
                const tB = b.timestamp?.toMillis?.() || b.timestamp?.seconds * 1000 || 0;
                return tB - tA;
            });

            // Filter out logs that don't have price changes
            const priceLogs = logs.filter(log => {
                const oldP = log.originalData?.vendorPrice ?? log.originalData?.price;
                const newP = log.proposedData?.vendorPrice ?? log.proposedData?.price;
                return oldP !== undefined && newP !== undefined && Number(oldP) !== Number(newP);
            });

            setHistoryLogs(priceLogs);
        } catch (error) {
            console.error("Error fetching item history:", error);
            toast.error("Failed to load price history");
        } finally {
            setLoadingHistory(false);
        }
    };

    if (!isSuperAdmin) {
        return <div style={{ padding: 40, textAlign: 'center' }}>Access Denied</div>;
    }

    const filteredItems = items.filter(item => {
        const matchCategory = selectedCategory === 'All' || item.category === selectedCategory;
        const matchVendor = selectedVendor === 'All' || item.vendorId === selectedVendor;
        return matchCategory && matchVendor;
    });

    return (
        <div className="admin-items-page" style={{ padding: 24, paddingBottom: 100 }}>
            <div style={{ marginBottom: 24 }}>
                <h1 style={{ margin: 0, fontSize: 24 }}>Marketplace Items</h1>
                <p style={{ margin: 0, color: 'var(--muted)', marginTop: 4 }}>View and track price changes across all items.</p>
            </div>

            {/* Category Filter */}
            <div style={{ display: 'flex', gap: 12, overflowX: 'auto', paddingBottom: 16 }}>
                {categories.map(cat => (
                    <button
                        key={cat}
                        onClick={() => setSelectedCategory(cat)}
                        style={{
                            padding: '8px 16px',
                            background: selectedCategory === cat ? '#4dabf7' : 'var(--card-bg, #1a1b1e)',
                            color: selectedCategory === cat ? '#fff' : 'inherit',
                            border: '1px solid',
                            borderColor: selectedCategory === cat ? '#4dabf7' : 'var(--border, #2c2e33)',
                            borderRadius: '20px',
                            cursor: 'pointer',
                            fontWeight: 500,
                            whiteSpace: 'nowrap'
                        }}
                    >
                        {cat}
                    </button>
                ))}
            </div>

            {/* Vendor Filter */}
            <div style={{ marginBottom: 20 }}>
                <select
                    className="ui-input"
                    value={selectedVendor}
                    onChange={e => setSelectedVendor(e.target.value)}
                    style={{ maxWidth: 250 }}
                >
                    <option value="All">All Vendors</option>
                    {uniqueVendors.sort((a, b) => a.name.localeCompare(b.name)).map(v => (
                        <option key={v.id} value={v.id}>{v.name}</option>
                    ))}
                </select>
            </div>

            {/* Items Grid */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                {loading ? (
                    <div style={{ textAlign: 'center', padding: 80, color: 'var(--muted)', background: 'var(--card-bg)', borderRadius: 12 }}>Loading items...</div>
                ) : filteredItems.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: 80, color: 'var(--muted)', background: 'var(--card-bg)', borderRadius: 12 }}>No items found.</div>
                ) : (
                    <div className="admin-items-grid">
                        {filteredItems.map(item => (
                            <div
                                key={`${item.vendorId}-${item.id}`}
                                className="admin-item-card"
                                onClick={() => handleViewAnalytics(item)}
                            >
                                <div className="admin-item-card__img-container">
                                    {item.imageUrl ? (
                                        <img src={item.imageUrl} alt={item.name} className="admin-item-card__img" />
                                    ) : (
                                        <div className="admin-item-card__no-img">No Img</div>
                                    )}
                                    <div className="admin-item-card__badges">
                                        {item.disabled && <span className="badge red shadow">Disabled</span>}
                                        {item.outOfStock && !item.disabled && <span className="badge amber shadow">Out of Stock</span>}
                                    </div>
                                </div>

                                <div className="admin-item-card__content">
                                    <div className="admin-item-card__header">
                                        <h3 className="admin-item-card__title">{item.name}</h3>
                                        <span className="admin-item-card__price">${Number(item.vendorPrice ?? item.price ?? 0).toFixed(2)}</span>
                                    </div>

                                    <div className="admin-item-card__meta">
                                        <span className="admin-item-card__vendor">🏬 {item.vendorName}</span>
                                        <span className="badge gray sm">{item.category || 'Uncategorized'}</span>
                                        {item.unit && <span className="badge ghost sm">{item.packQuantity || 1} {item.unit}</span>}
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Analytics Modal */}
            {analyticsItem && (
                <>
                    <div className="modal-backdrop" onClick={() => setAnalyticsItem(null)} />
                    <div className="modal-content analytics-modal">
                        <div className="modal-header">
                            <div>
                                <h3 style={{ margin: 0, fontSize: 20 }}>Item Analytics</h3>
                                <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 4 }}>
                                    {analyticsItem.name} — {analyticsItem.vendorName}
                                </div>
                            </div>
                            <button className="modal-close" onClick={() => setAnalyticsItem(null)}>✕</button>
                        </div>

                        <div className="modal-body" style={{ padding: 24, overflowY: 'auto' }}>
                            {loadingAnalytics ? (
                                <div style={{ textAlign: 'center', padding: 40, color: 'var(--muted)' }}>Loading analytics...</div>
                            ) : analyticsData ? (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
                                    {/* Stat Cards */}
                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 16 }}>
                                        <div className="ui-card stat-card" style={{ padding: 16 }}>
                                            <div className="stat-label">Total Sold</div>
                                            <div className="stat-value">{analyticsData.totalSold} <span style={{ fontSize: 14, fontWeight: 'normal' }}>{analyticsItem.unit || 'units'}</span></div>
                                            <div className="stat-context">All-time quantity</div>
                                        </div>
                                        <div className="ui-card stat-card" style={{ padding: 16 }}>
                                            <div className="stat-label">Total Revenue</div>
                                            <div className="stat-value" style={{ color: '#4dabf7' }}>${analyticsData.totalRevenue.toFixed(2)}</div>
                                            <div className="stat-context">Gross item sales</div>
                                        </div>
                                        <div className="ui-card stat-card" style={{ padding: 16 }}>
                                            <div className="stat-label">Est. Commission</div>
                                            <div className="stat-value" style={{ color: '#4ade80' }}>${analyticsData.estimatedCommission.toFixed(2)}</div>
                                            <div className="stat-context">Based on {analyticsItem.vendorCommission || 15}% rate</div>
                                        </div>
                                    </div>

                                    {/* Monthly Price Trend Cars */}
                                    <div>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, borderBottom: '1px solid var(--border)', paddingBottom: 8 }}>
                                            <h4 style={{ margin: 0, fontSize: 16 }}>Monthly Price Trend</h4>
                                            {analyticsData.priceTrend.length > 1 && (
                                                <div style={{ fontSize: 14, fontWeight: 500 }}>
                                                    Insight: Price {analyticsData.overallChange >= 0 ? 'increased' : 'decreased'} {' '}
                                                    <span style={{ color: analyticsData.overallChange > 0 ? '#fa5252' : analyticsData.overallChange < 0 ? '#4ade80' : 'var(--muted)' }}>
                                                        {Math.abs(analyticsData.overallChange).toFixed(1)}%
                                                    </span>
                                                </div>
                                            )}
                                        </div>

                                        <div style={{ display: 'flex', gap: 12, overflowX: 'auto', paddingBottom: 12 }}>
                                            {analyticsData.priceTrend.map((pt, idx) => (
                                                <div key={idx} className="ui-card" style={{ padding: 16, minWidth: 140, flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', background: 'rgba(255,255,255,0.02)' }}>
                                                    <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 8 }}>{pt.month}</div>
                                                    <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>${pt.price.toFixed(2)}</div>
                                                    <div>
                                                        {pt.percentChange === 0 ? (
                                                            <span style={{ color: 'var(--muted)', fontSize: 13, fontWeight: 500 }}>—</span>
                                                        ) : pt.percentChange > 0 ? (
                                                            <span style={{ color: '#fa5252', fontSize: 13, fontWeight: 500 }}>↑ +{pt.percentChange.toFixed(1)}%</span>
                                                        ) : (
                                                            <span style={{ color: '#4ade80', fontSize: 13, fontWeight: 500 }}>↓ {Math.abs(pt.percentChange).toFixed(1)}%</span>
                                                        )}
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>

                                    {/* Legacy History Button */}
                                    <div style={{ textAlign: 'right' }}>
                                        <button
                                            className="ui-btn ghost small"
                                            onClick={() => {
                                                setAnalyticsItem(null);
                                                handleViewHistory(analyticsItem);
                                            }}
                                        >
                                            View Raw Audit Log
                                        </button>
                                    </div>
                                </div>
                            ) : null}
                        </div>
                    </div>
                </>
            )}

            {/* Price History Modal */}
            {historyItem && (
                <>
                    <div style={{
                        position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
                        backgroundColor: 'rgba(0,0,0,0.6)', zIndex: 999, backdropFilter: 'blur(4px)'
                    }} onClick={() => setHistoryItem(null)} />
                    <div style={{
                        position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
                        backgroundColor: 'var(--card-bg, #1a1b1e)', border: '1px solid var(--border, #2c2e33)',
                        borderRadius: 12, padding: 0, width: '90%', maxWidth: 600, maxHeight: '80vh',
                        overflow: 'hidden', zIndex: 1000, display: 'flex', flexDirection: 'column',
                        boxShadow: '0 20px 60px rgba(0,0,0,0.5)'
                    }}>
                        <div style={{
                            padding: '20px 24px', borderBottom: '1px solid var(--border)',
                            display: 'flex', justifyContent: 'space-between', alignItems: 'center'
                        }}>
                            <div>
                                <h3 style={{ margin: 0 }}>Price History</h3>
                                <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 4 }}>
                                    {historyItem.name}
                                </div>
                            </div>
                            <button
                                onClick={() => setHistoryItem(null)}
                                style={{ background: 'none', border: 'none', color: 'var(--muted)', fontSize: 22, cursor: 'pointer' }}
                            >✕</button>
                        </div>

                        <div style={{ padding: '20px 24px', overflowY: 'auto', flex: 1 }}>
                            {loadingHistory ? (
                                <div style={{ textAlign: 'center', padding: 40, color: 'var(--muted)' }}>Loading history...</div>
                            ) : historyLogs.length === 0 ? (
                                <div style={{ textAlign: 'center', padding: 40, color: 'var(--muted)' }}>No historical price changes found.</div>
                            ) : (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                                    {historyLogs.map((log, idx) => {
                                        const dt = log.timestamp?.toDate ? log.timestamp.toDate() : new Date(log.timestamp?.seconds * 1000);
                                        const oldP = log.originalData?.vendorPrice ?? log.originalData?.price ?? 0;
                                        const newP = log.proposedData?.vendorPrice ?? log.proposedData?.price ?? 0;
                                        const up = Number(newP) > Number(oldP);

                                        return (
                                            <div key={idx} style={{
                                                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                                                padding: 16, backgroundColor: 'rgba(255,255,255,0.02)', borderRadius: 8,
                                                border: '1px solid var(--border)'
                                            }}>
                                                <div>
                                                    <div style={{ fontWeight: 600, marginBottom: 4 }}>
                                                        <span style={{ color: 'var(--muted)', textDecoration: 'line-through', marginRight: 8 }}>${Number(oldP).toFixed(2)}</span>
                                                        <span style={{ color: up ? '#ff6b7a' : '#4ade80' }}>${Number(newP).toFixed(2)}</span>
                                                    </div>
                                                    <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                                                        Changed by {log.changedBy || 'Unknown'} (Admin: {log.adminAction ? 'Yes' : 'No'})
                                                    </div>
                                                </div>
                                                <div style={{ fontSize: 12, color: 'var(--muted)', textAlign: 'right' }}>
                                                    <div>{dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</div>
                                                    <div>{dt.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}</div>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    </div>
                </>
            )}
        </div>
    );
};

export default AdminItemsPage;
