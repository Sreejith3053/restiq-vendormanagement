import React, { useState, useEffect, useContext, useMemo } from 'react';
import { UserContext } from '../../contexts/UserContext';
import { db } from '../../firebase';
import { collection, query, getDocs, orderBy } from 'firebase/firestore';
import { toast } from 'react-toastify';
import { useNavigate } from 'react-router-dom';

export default function AdminRestaurantsPage() {
    const { isSuperAdmin } = useContext(UserContext);
    const [restaurants, setRestaurants] = useState([]);
    const [orders, setOrders] = useState([]);
    const [invoices, setInvoices] = useState([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [statusFilter, setStatusFilter] = useState('all');
    const navigate = useNavigate();

    useEffect(() => {
        if (!isSuperAdmin) return;

        const fetchData = async () => {
            try {
                // 1. Primary source: restaurants collection
                const restSnap = await getDocs(collection(db, 'restaurants'));
                const restDocs = restSnap.docs.map(d => ({ id: d.id, ...d.data() }));
                setRestaurants(restDocs);

                // 2. Enrich with order stats
                const qOrders = query(collection(db, 'marketplaceOrders'), orderBy('createdAt', 'desc'));
                const oSnap = await getDocs(qOrders).catch(() => ({ docs: [] }));
                setOrders(oSnap.docs.map(d => ({ id: d.id, ...d.data() })));

                // 3. Enrich with invoice stats
                const iSnap = await getDocs(collection(db, 'restaurantInvoices')).catch(() => ({ docs: [] }));
                setInvoices(iSnap.docs.map(d => ({ id: d.id, ...d.data() })));
            } catch (error) {
                console.error("Error fetching restaurant data:", error);
                toast.error("Failed to load restaurant data.");
            } finally {
                setLoading(false);
            }
        };

        fetchData();
    }, [isSuperAdmin]);

    // Build order & invoice stats per restaurant
    const statsMap = useMemo(() => {
        const map = {};
        orders.forEach(o => {
            const rId = o.restaurantId;
            if (!rId) return;
            if (!map[rId]) map[rId] = { orderCount: 0, revenue: 0, billed: 0, paid: 0, pending: 0, invoiceCount: 0 };
            map[rId].orderCount++;
            const status = (o.status || '').toLowerCase();
            if (['fulfilled', 'completed', 'delivered'].includes(status)) {
                map[rId].revenue += Number(o.grandTotalAfterTax || o.total || 0);
            }
        });
        invoices.forEach(inv => {
            const rId = inv.restaurantId;
            if (!rId) return;
            if (!map[rId]) map[rId] = { orderCount: 0, revenue: 0, billed: 0, paid: 0, pending: 0, invoiceCount: 0 };
            const amount = Number(inv.grandTotal || 0);
            map[rId].invoiceCount++;
            map[rId].billed += amount;
            if (inv.paymentStatus === 'PAID') map[rId].paid += amount;
            else if (inv.paymentStatus === 'PENDING') map[rId].pending += amount;
        });
        return map;
    }, [orders, invoices]);

    // Merge restaurants with stats
    const merged = useMemo(() => {
        return restaurants.map(r => {
            const rid = r.restaurantId || r.id;
            const s = statsMap[rid] || { orderCount: 0, revenue: 0, billed: 0, paid: 0, pending: 0, invoiceCount: 0 };
            return { ...r, ...s, restaurantId: rid };
        });
    }, [restaurants, statsMap]);

    const filtered = useMemo(() => {
        return merged.filter(r => {
            if (statusFilter !== 'all' && (r.status || 'active') !== statusFilter) return false;
            if (search) {
                const q = search.toLowerCase();
                return (r.name || '').toLowerCase().includes(q)
                    || (r.restaurantId || '').toLowerCase().includes(q)
                    || (r.city || '').toLowerCase().includes(q)
                    || (r.code || '').toLowerCase().includes(q);
            }
            return true;
        }).sort((a, b) => b.revenue - a.revenue);
    }, [merged, search, statusFilter]);

    const statusColors = { active: '#4ade80', hold: '#fbbf24', inactive: '#94a3b8' };

    if (!isSuperAdmin) {
        return <div style={{ padding: 40, textAlign: 'center' }}>Access Denied.</div>;
    }

    return (
        <div>
            <div className="page-header">
                <div>
                    <h2>All Restaurants</h2>
                    <div style={{ color: 'var(--muted)', fontSize: 13, marginTop: 4 }}>
                        Restaurant directory with order volume and invoice health — sourced from <strong>restaurants</strong> collection.
                    </div>
                </div>
            </div>

            <div className="ui-card" style={{ marginBottom: 20 }}>
                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
                    <input
                        className="ui-input"
                        placeholder="🔍 Search name, ID, city..."
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        style={{ maxWidth: 300, flex: 1 }}
                    />
                    {['all', 'active', 'hold', 'inactive'].map(s => (
                        <button key={s} onClick={() => setStatusFilter(s)}
                            style={{
                                padding: '5px 12px', borderRadius: 14, fontSize: 11, fontWeight: 600, cursor: 'pointer',
                                border: statusFilter === s ? `1px solid ${statusColors[s] || '#38bdf8'}` : '1px solid rgba(255,255,255,0.08)',
                                background: statusFilter === s ? (statusColors[s] || '#38bdf8') + '18' : 'transparent',
                                color: statusFilter === s ? (statusColors[s] || '#38bdf8') : '#94a3b8',
                            }}>
                            {s === 'all' ? 'All' : s.charAt(0).toUpperCase() + s.slice(1)}
                        </button>
                    ))}
                    <span style={{ fontSize: 12, color: '#64748b' }}>{filtered.length} of {restaurants.length}</span>
                </div>
            </div>

            <div className="ui-table-wrap">
                <table className="ui-table">
                    <thead>
                        <tr>
                            <th>Restaurant</th>
                            <th>Type</th>
                            <th>City</th>
                            <th>Status</th>
                            <th style={{ textAlign: 'right' }}>Total Orders</th>
                            <th style={{ textAlign: 'right' }}>Revenue</th>
                            <th style={{ textAlign: 'right' }}>Invoices</th>
                            <th style={{ textAlign: 'right' }}>Billed</th>
                            <th style={{ textAlign: 'right' }}>Paid</th>
                            <th style={{ textAlign: 'right' }}>Pending</th>
                        </tr>
                    </thead>
                    <tbody>
                        {loading ? (
                            <tr><td colSpan="10" style={{ textAlign: 'center', padding: 24 }}>Loading restaurants...</td></tr>
                        ) : filtered.length === 0 ? (
                            <tr><td colSpan="10" style={{ textAlign: 'center', color: 'var(--muted)', padding: 24 }}>
                                {restaurants.length === 0 ? 'No restaurants found. Add them from Manage Restaurants or run a migration backfill.' : 'No results match your filter.'}
                            </td></tr>
                        ) : (
                            filtered.map(r => (
                                <tr
                                    key={r.id}
                                    className="is-row"
                                    style={{ cursor: 'pointer' }}
                                    onClick={() => navigate(`/admin/restaurants/${encodeURIComponent(r.restaurantId || r.id)}`)}
                                    title={`View details for ${r.name || r.restaurantId}`}
                                >
                                    <td style={{ fontWeight: 600 }}>
                                        {r.name || r.restaurantId || <em style={{ color: 'var(--muted)' }}>Unnamed</em>}
                                        {r.code && <div style={{ fontSize: 10, color: '#64748b', fontFamily: 'monospace' }}>{r.code}</div>}
                                    </td>
                                    <td>
                                        <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4, background: 'rgba(167,139,250,0.1)', color: '#a78bfa', fontWeight: 600 }}>
                                            {r.branchType || 'restaurant'}
                                        </span>
                                    </td>
                                    <td style={{ color: '#94a3b8', fontSize: 12 }}>{r.city || '—'}</td>
                                    <td>
                                        <span style={{ fontSize: 11, fontWeight: 700, color: statusColors[r.status] || '#94a3b8' }}>
                                            ● {r.status || 'active'}
                                        </span>
                                    </td>
                                    <td style={{ textAlign: 'right' }}>{r.orderCount}</td>
                                    <td style={{ textAlign: 'right', fontWeight: 600, color: '#4dabf7' }}>
                                        ${r.revenue.toFixed(2)}
                                    </td>
                                    <td style={{ textAlign: 'right' }}>{r.invoiceCount}</td>
                                    <td style={{ textAlign: 'right', fontWeight: 600 }}>
                                        ${r.billed.toFixed(2)}
                                    </td>
                                    <td style={{ textAlign: 'right', color: '#4ade80' }}>
                                        ${r.paid.toFixed(2)}
                                    </td>
                                    <td style={{ textAlign: 'right', color: r.pending > 0 ? '#f06595' : 'inherit' }}>
                                        ${r.pending.toFixed(2)}
                                    </td>
                                </tr>
                            ))
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
