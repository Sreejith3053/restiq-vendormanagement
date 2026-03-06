import React, { useState, useEffect, useContext } from 'react';
import { db } from '../../firebase';
import { collection, collectionGroup, getDocs, query, orderBy } from 'firebase/firestore';
import { toast } from 'react-toastify';
import { UserContext } from '../../contexts/UserContext';
import ItemAnalyticsModal from '../Vendors/ItemAnalyticsModal';
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

    const handleViewAnalytics = (item) => {
        setAnalyticsItem(item);
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

            // Filter out logs that don't have price changes using chronological reconstruction
            const priceLogs = [];
            let lastKnownPrice = null;

            [...logs]
                .sort((a, b) => {
                    const tA = a.timestamp?.toMillis?.() || a.timestamp?.seconds * 1000 || 0;
                    const tB = b.timestamp?.toMillis?.() || b.timestamp?.seconds * 1000 || 0;
                    return tA - tB;
                })
                .forEach(log => {
                    const proposedPrice = log.proposedData?.vendorPrice ?? log.proposedData?.price ?? log.newData?.vendorPrice ?? log.newData?.price ?? log.newPrice;
                    const originalPrice = log.originalData?.vendorPrice ?? log.originalData?.price ?? log.oldData?.vendorPrice ?? log.oldData?.price ?? log.oldPrice;

                    if (proposedPrice !== undefined) {
                        const numericNewPrice = Number(proposedPrice);
                        if (lastKnownPrice === null) {
                            lastKnownPrice = numericNewPrice;
                            if (originalPrice !== undefined && Number(originalPrice) !== numericNewPrice) {
                                // Re-inject original data fields for the UI to read
                                priceLogs.push({ ...log, originalData: { vendorPrice: Number(originalPrice) }, proposedData: { vendorPrice: numericNewPrice } });
                            }
                        } else if (numericNewPrice !== lastKnownPrice) {
                            priceLogs.push({ ...log, originalData: { vendorPrice: lastKnownPrice }, proposedData: { vendorPrice: numericNewPrice } });
                            lastKnownPrice = numericNewPrice;
                        }
                    }
                });

            // Reverse for display (newest first)
            priceLogs.reverse();

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
                <ItemAnalyticsModal
                    item={analyticsItem}
                    onClose={() => setAnalyticsItem(null)}
                    onViewHistory={(item) => handleViewHistory(item)}
                />
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
                                        const oldP = log.originalData?.vendorPrice ?? log.originalData?.price ?? log.oldData?.vendorPrice ?? log.oldData?.price ?? log.oldPrice ?? 0;
                                        const newP = log.proposedData?.vendorPrice ?? log.proposedData?.price ?? log.newData?.vendorPrice ?? log.newData?.price ?? log.newPrice ?? 0;
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
