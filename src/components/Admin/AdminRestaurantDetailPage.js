import React, { useState, useEffect, useContext, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { UserContext } from '../../contexts/UserContext';
import { db } from '../../firebase';
import { collection, query, getDocs, orderBy, doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { toast } from 'react-toastify';
import { authFetch } from '../../utils/authFetch';

export default function AdminRestaurantDetailPage() {
    const { restaurantId } = useParams();
    const { isSuperAdmin, displayName } = useContext(UserContext);
    const navigate = useNavigate();

    const [orders, setOrders] = useState([]);
    const [invoices, setInvoices] = useState([]);
    const [vendors, setVendors] = useState([]);
    const [restaurantInfo, setRestaurantInfo] = useState(null);
    const [loading, setLoading] = useState(true);
    const [processingId, setProcessingId] = useState(null);

    // Filters for invoices table
    const [invoiceSearch, setInvoiceSearch] = useState('');
    const [statusFilter, setStatusFilter] = useState('All');

    const decodedId = decodeURIComponent(restaurantId);

    useEffect(() => {
        if (!isSuperAdmin) return;

        const fetchData = async () => {
            try {
                // Fetch all orders for this restaurant
                const qOrders = query(collection(db, 'marketplaceOrders'), orderBy('createdAt', 'desc'));
                const oSnap = await getDocs(qOrders);
                const allOrders = oSnap.docs
                    .map(d => ({ id: d.id, ...d.data() }))
                    .filter(o => o.restaurantId === decodedId);
                setOrders(allOrders);

                // Fetch all restaurant invoices for this restaurant
                const qInvoices = query(collection(db, 'restaurantInvoices'));
                const iSnap = await getDocs(qInvoices);
                const allInvoices = iSnap.docs
                    .map(d => ({ id: d.id, ...d.data() }))
                    .filter(inv => inv.restaurantId === decodedId);
                setInvoices(allInvoices);

                // Fetch vendors for name mapping
                const vSnap = await getDocs(collection(db, 'vendors'));
                setVendors(vSnap.docs.map(d => ({ id: d.id, ...d.data() })));

                // Fetch restaurant profile info from RMS
                try {
                    const res = await authFetch(`/api/restaurant-info/${decodedId}`);
                    if (res.ok) {
                        const info = await res.json();
                        setRestaurantInfo(info);
                    }
                } catch (fetchErr) {
                    console.warn('Could not fetch restaurant info from RMS:', fetchErr);
                }

            } catch (error) {
                console.error("Error fetching restaurant detail data:", error);
                toast.error("Failed to load restaurant details.");
            } finally {
                setLoading(false);
            }
        };

        fetchData();
    }, [isSuperAdmin, decodedId]);

    // ── KPI Aggregation ──
    const kpis = useMemo(() => {
        let totalOrders = orders.length;
        let revenue = 0;

        orders.forEach(o => {
            const status = (o.status || '').toLowerCase();
            if (['fulfilled', 'completed', 'delivered'].includes(status)) {
                revenue += Number(o.grandTotalAfterTax || o.total || 0);
            }
        });

        let invoiceCount = invoices.length;
        let billed = 0;
        let paid = 0;
        let pending = 0;

        invoices.forEach(inv => {
            const amount = Number(inv.grandTotal || 0);
            billed += amount;
            if (inv.paymentStatus === 'PAID') paid += amount;
            else if (inv.paymentStatus === 'PENDING') pending += amount;
        });

        return { totalOrders, revenue, invoiceCount, billed, paid, pending };
    }, [orders, invoices]);

    // ── Top Ordered Products (top 10 by qty) ──
    const topProducts = useMemo(() => {
        const productMap = {};
        const fulfilledOrders = orders.filter(o =>
            ['fulfilled', 'completed', 'delivered'].includes((o.status || '').toLowerCase())
        );

        fulfilledOrders.forEach(o => {
            (o.items || []).forEach(item => {
                const key = item.itemId || item.id || `${item.itemName || item.name}_${o.vendorId}`;
                if (!productMap[key]) {
                    productMap[key] = {
                        name: item.itemName || item.name || 'Unknown Item',       // v2-first
                        vendorName: o.vendorName || 'Unknown Vendor',
                        category: item.category || 'Uncategorized',
                        unit: item.baseUnit || item.unit || 'unit',               // v2-first
                        qtySold: 0,
                        revenue: 0,
                    };
                }
                const qty = Number(item.qty || 0);
                const price = Number(item.vendorPrice ?? item.price ?? 0);
                productMap[key].qtySold += qty;
                productMap[key].revenue += qty * price;
            });
        });

        return Object.values(productMap)
            .sort((a, b) => b.qtySold - a.qtySold)
            .slice(0, 10);
    }, [orders]);

    // ── Filtered Invoices ──
    const filteredInvoices = useMemo(() => {
        return invoices
            .filter(inv => {
                const matchSearch = !invoiceSearch ||
                    (inv.invoiceNumber || '').toLowerCase().includes(invoiceSearch.toLowerCase()) ||
                    (inv.orderId || '').toLowerCase().includes(invoiceSearch.toLowerCase());
                const matchStatus = statusFilter === 'All' || inv.paymentStatus === statusFilter;
                return matchSearch && matchStatus;
            })
            .sort((a, b) => {
                const tA = a.createdAt?.toMillis?.() || a.createdAt?.seconds * 1000 || 0;
                const tB = b.createdAt?.toMillis?.() || b.createdAt?.seconds * 1000 || 0;
                return tB - tA;
            });
    }, [invoices, invoiceSearch, statusFilter]);

    // ── Mark Paid ──
    const handleMarkPaid = async (invoiceId) => {
        if (!window.confirm('Mark this restaurant invoice as PAID?')) return;
        setProcessingId(invoiceId);
        try {
            await updateDoc(doc(db, 'restaurantInvoices', invoiceId), {
                paymentStatus: 'PAID',
                paidAt: serverTimestamp(),
                updatedAt: serverTimestamp(),
                paidByAdminName: displayName || 'Admin'
            });
            // Update local state
            setInvoices(prev => prev.map(inv =>
                inv.id === invoiceId ? { ...inv, paymentStatus: 'PAID' } : inv
            ));
            toast.success('Restaurant invoice marked as PAID.');
        } catch (err) {
            console.error('Failed to update restaurant invoice status:', err);
            toast.error('Failed to mark invoice as paid.');
        } finally {
            setProcessingId(null);
        }
    };

    const formatDate = (timestamp) => {
        if (!timestamp) return 'N/A';
        const d = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
        return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    };

    if (!isSuperAdmin) {
        return <div style={{ padding: 40, textAlign: 'center' }}>Access Denied.</div>;
    }

    if (loading) {
        return <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>Loading restaurant details...</div>;
    }

    return (
        <div>
            {/* ── Header ── */}
            <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                    <button
                        className="ui-btn ghost"
                        onClick={() => navigate('/admin/restaurants')}
                        style={{ padding: '6px 12px', fontSize: 18, lineHeight: 1 }}
                        title="Back to All Restaurants"
                    >
                        ←
                    </button>
                    <div>
                        <h2 style={{ margin: 0 }}>🏪 {decodedId}</h2>
                        <div style={{ color: 'var(--muted)', fontSize: 13, marginTop: 4 }}>
                            Restaurant overview — orders, products, and invoices
                        </div>
                    </div>
                </div>
                <button
                    className="ui-btn primary small"
                    onClick={() => navigate(`/admin/restaurant-invoices?status=All&restaurantId=${encodeURIComponent(decodedId)}`)}
                >
                    🧾 View All Invoices
                </button>
            </div>

            {/* ── Restaurant Details Card ── */}
            {restaurantInfo && (
                <div className="ui-card" style={{ marginBottom: 28, padding: 24 }}>
                    <h3 style={{ margin: '0 0 16px 0', fontSize: 16 }}>📋 Restaurant Details</h3>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16 }}>
                        {restaurantInfo.businessName && (
                            <div>
                                <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4 }}>Business Name</div>
                                <div style={{ fontWeight: 600, fontSize: 15 }}>{restaurantInfo.businessName}</div>
                            </div>
                        )}
                        {restaurantInfo.legalName && (
                            <div>
                                <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4 }}>Legal Name</div>
                                <div style={{ fontWeight: 500 }}>{restaurantInfo.legalName}</div>
                            </div>
                        )}
                        {restaurantInfo.email && (
                            <div>
                                <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4 }}>Email</div>
                                <div style={{ fontWeight: 500 }}>
                                    <a href={`mailto:${restaurantInfo.email}`} style={{ color: '#4dabf7', textDecoration: 'none' }}>{restaurantInfo.email}</a>
                                </div>
                            </div>
                        )}
                        {restaurantInfo.phone && (
                            <div>
                                <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4 }}>Phone</div>
                                <div style={{ fontWeight: 500 }}>
                                    <a href={`tel:${restaurantInfo.phone}`} style={{ color: '#4dabf7', textDecoration: 'none' }}>{restaurantInfo.phone}</a>
                                </div>
                            </div>
                        )}
                        {restaurantInfo.hstNumber && (
                            <div>
                                <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4 }}>HST Number</div>
                                <div style={{ fontWeight: 500 }}>{restaurantInfo.hstNumber}</div>
                            </div>
                        )}
                        {restaurantInfo.address && (
                            <div>
                                <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4 }}>Address</div>
                                <div style={{ fontWeight: 500 }}>{restaurantInfo.address}</div>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* ── KPI Cards ── */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 16, marginBottom: 28 }}>
                <div className="ui-card stat-card" style={{ padding: 20 }}>
                    <div className="stat-label">Total Orders</div>
                    <div className="stat-value">{kpis.totalOrders}</div>
                    <div className="stat-context">All-time orders placed</div>
                </div>
                <div className="ui-card stat-card" style={{ padding: 20 }}>
                    <div className="stat-label">Realized Revenue</div>
                    <div className="stat-value" style={{ color: '#4dabf7' }}>${kpis.revenue.toFixed(2)}</div>
                    <div className="stat-context">Fulfilled / completed orders</div>
                </div>
                <div className="ui-card stat-card" style={{ padding: 20 }}>
                    <div className="stat-label">Invoices Generated</div>
                    <div className="stat-value">{kpis.invoiceCount}</div>
                    <div className="stat-context">${kpis.billed.toFixed(2)} total billed</div>
                </div>
                <div className="ui-card stat-card" style={{ padding: 20 }}>
                    <div className="stat-label">Total Paid</div>
                    <div className="stat-value" style={{ color: '#4ade80' }}>${kpis.paid.toFixed(2)}</div>
                    <div className="stat-context">Settled invoices</div>
                </div>
                <div className="ui-card stat-card" style={{ padding: 20, borderLeft: kpis.pending > 0 ? '3px solid #f06595' : undefined }}>
                    <div className="stat-label">Total Pending</div>
                    <div className="stat-value" style={{ color: kpis.pending > 0 ? '#f06595' : 'inherit' }}>${kpis.pending.toFixed(2)}</div>
                    <div className="stat-context">Outstanding balance</div>
                </div>
            </div>

            {/* ── Top Ordered Products ── */}
            <div className="ui-card" style={{ marginBottom: 28, overflow: 'hidden' }}>
                <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)' }}>
                    <h3 style={{ margin: 0 }}>🏆 Top Ordered Products</h3>
                    <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>Based on fulfilled / completed orders</div>
                </div>

                {topProducts.length === 0 ? (
                    <div style={{ padding: 32, textAlign: 'center', color: 'var(--muted)' }}>No fulfilled orders found for this restaurant.</div>
                ) : (
                    <div className="ui-table-wrap">
                        <table className="ui-table" style={{ margin: 0 }}>
                            <thead>
                                <tr>
                                    <th style={{ width: 40 }}>#</th>
                                    <th>Product</th>
                                    <th>Vendor</th>
                                    <th>Category</th>
                                    <th style={{ textAlign: 'right' }}>Qty Sold</th>
                                    <th style={{ textAlign: 'right' }}>Revenue</th>
                                </tr>
                            </thead>
                            <tbody>
                                {topProducts.map((p, i) => (
                                    <tr key={i} className="is-row">
                                        <td style={{ fontWeight: 700, color: i < 3 ? '#f59e0b' : 'var(--muted)' }}>
                                            {i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : i + 1}
                                        </td>
                                        <td>
                                            <div style={{ fontWeight: 600 }}>{p.name}</div>
                                            <div style={{ fontSize: 11, color: 'var(--muted)' }}>{p.unit}</div>
                                        </td>
                                        <td style={{ fontSize: 13 }}>{p.vendorName}</td>
                                        <td><span className="badge ghost sm">{p.category}</span></td>
                                        <td style={{ textAlign: 'right', fontWeight: 600, color: '#4dabf7' }}>{p.qtySold}</td>
                                        <td style={{ textAlign: 'right', fontWeight: 600, color: '#4ade80' }}>${p.revenue.toFixed(2)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {/* ── Invoices Section ── */}
            <div className="ui-card" style={{ overflow: 'hidden' }}>
                <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
                    <h3 style={{ margin: 0 }}>🧾 Invoices</h3>
                    <div style={{ display: 'flex', gap: 10 }}>
                        <input
                            className="ui-input"
                            placeholder="🔍 Search Invoice # or Order ID..."
                            value={invoiceSearch}
                            onChange={e => setInvoiceSearch(e.target.value)}
                            style={{ maxWidth: 240, fontSize: 13 }}
                        />
                        <select
                            className="ui-input"
                            value={statusFilter}
                            onChange={e => setStatusFilter(e.target.value)}
                            style={{ maxWidth: 140, fontSize: 13 }}
                        >
                            <option value="All">All Status</option>
                            <option value="PENDING">Pending</option>
                            <option value="PAID">Paid</option>
                        </select>
                    </div>
                </div>

                <div className="ui-table-wrap">
                    <table className="ui-table" style={{ margin: 0 }}>
                        <thead>
                            <tr>
                                <th>Invoice #</th>
                                <th>Order ID</th>
                                <th>Vendor</th>
                                <th>Date</th>
                                <th style={{ textAlign: 'right' }}>Total</th>
                                <th>Status</th>
                                <th style={{ textAlign: 'right' }}>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {filteredInvoices.length === 0 ? (
                                <tr>
                                    <td colSpan="7" style={{ textAlign: 'center', color: 'var(--muted)', padding: 32 }}>
                                        No invoices found.
                                    </td>
                                </tr>
                            ) : (
                                filteredInvoices.map(inv => {
                                    const v = vendors.find(x => x.id === inv.vendorId);
                                    const vName = inv.vendorName || (v ? (v.name || v.businessName) : 'Unknown Vendor');
                                    const isPending = inv.paymentStatus === 'PENDING';

                                    return (
                                        <tr
                                            key={inv.id}
                                            className="is-row"
                                            style={{ cursor: 'pointer' }}
                                            onClick={() => navigate(`/admin/restaurant-invoices/${inv.id}`)}
                                        >
                                            <td style={{ fontWeight: 600 }}>{inv.invoiceNumber}</td>
                                            <td style={{ fontSize: 13, color: 'var(--muted)' }}>
                                                {inv.orderGroupId || inv.orderId?.slice(-8).toUpperCase() || '—'}
                                            </td>
                                            <td>{vName}</td>
                                            <td>{formatDate(inv.invoiceDate)}</td>
                                            <td style={{ textAlign: 'right', fontWeight: 600, color: '#4ade80' }}>
                                                ${Number(inv.grandTotal || 0).toFixed(2)}
                                            </td>
                                            <td>
                                                <span className={`badge ${isPending ? 'amber' : 'green'}`}>
                                                    {inv.paymentStatus}
                                                </span>
                                            </td>
                                            <td style={{ textAlign: 'right' }}>
                                                {isPending && (
                                                    <button
                                                        className="ui-btn small primary"
                                                        onClick={(e) => { e.stopPropagation(); handleMarkPaid(inv.id); }}
                                                        disabled={processingId === inv.id}
                                                    >
                                                        {processingId === inv.id ? 'Saving...' : 'Mark Paid'}
                                                    </button>
                                                )}
                                            </td>
                                        </tr>
                                    );
                                })
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}
