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

    // History Modal State
    const [historyItem, setHistoryItem] = useState(null);
    const [historyLogs, setHistoryLogs] = useState([]);
    const [loadingHistory, setLoadingHistory] = useState(false);

    useEffect(() => {
        if (!isSuperAdmin) return;

        const fetchItems = async () => {
            setLoading(true);
            try {
                // Fetch all items from all vendors using collectionGroup
                const itemsQuery = query(collectionGroup(db, 'items'));
                const snapshot = await getDocs(itemsQuery);

                const allItems = snapshot.docs.map(doc => {
                    const data = doc.data();
                    // We need to extract vendorId from the reference path
                    const vendorId = doc.ref.parent.parent.id;
                    return {
                        id: doc.id,
                        vendorId,
                        ...data
                    };
                });

                setItems(allItems);

                // Extract unique categories
                const cats = new Set(['All']);
                allItems.forEach(item => {
                    if (item.category) cats.add(item.category);
                });
                setCategories(Array.from(cats).sort());
            } catch (err) {
                console.error("Error fetching admin items:", err);
                toast.error("Failed to load items");
            } finally {
                setLoading(false);
            }
        };

        fetchItems();
    }, [isSuperAdmin]);

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

    const filteredItems = selectedCategory === 'All'
        ? items
        : items.filter(item => item.category === selectedCategory);

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

            {/* Items Table */}
            <div className="ui-card" style={{ padding: 20 }}>
                {loading ? (
                    <div style={{ textAlign: 'center', padding: 40, color: 'var(--muted)' }}>Loading items...</div>
                ) : filteredItems.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: 40, color: 'var(--muted)' }}>No items found.</div>
                ) : (
                    <div style={{ overflowX: 'auto' }}>
                        <table className="ui-table" style={{ margin: 0 }}>
                            <thead>
                                <tr>
                                    <th>Image</th>
                                    <th>Item Name</th>
                                    <th>Vendor</th>
                                    <th>Category</th>
                                    <th>Price</th>
                                    <th style={{ textAlign: 'right' }}>Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {filteredItems.map(item => (
                                    <tr key={`${item.vendorId}-${item.id}`}>
                                        <td style={{ width: 60 }}>
                                            {item.imageUrl ? (
                                                <img src={item.imageUrl} alt={item.name} style={{ width: 40, height: 40, borderRadius: 6, objectFit: 'cover' }} />
                                            ) : (
                                                <div style={{ width: 40, height: 40, borderRadius: 6, backgroundColor: 'var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, color: 'var(--muted)' }}>No Img</div>
                                            )}
                                        </td>
                                        <td style={{ fontWeight: 500 }}>{item.name}</td>
                                        <td>{item.vendorInfo?.businessName || item.vendorId}</td>
                                        <td>{item.category || 'Uncategorized'}</td>
                                        <td style={{ fontWeight: 600 }}>${Number(item.vendorPrice ?? item.price ?? 0).toFixed(2)}</td>
                                        <td style={{ textAlign: 'right' }}>
                                            <button
                                                onClick={() => handleViewHistory(item)}
                                                style={{
                                                    padding: '6px 12px', background: 'rgba(77, 171, 247, 0.1)', color: '#4dabf7',
                                                    border: '1px solid rgba(77, 171, 247, 0.2)', borderRadius: 6, cursor: 'pointer',
                                                    fontSize: 13, fontWeight: 500
                                                }}
                                            >
                                                View History
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

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
