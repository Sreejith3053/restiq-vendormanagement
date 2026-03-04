import React, { useState, useEffect, useContext, useMemo } from 'react';
import { UserContext } from '../../contexts/UserContext';
import { db } from '../../firebase';
import { collection, query, getDocs, orderBy } from 'firebase/firestore';
import { toast } from 'react-toastify';
import { useNavigate } from 'react-router-dom';

export default function AdminRestaurantsPage() {
    const { isSuperAdmin } = useContext(UserContext);
    const [orders, setOrders] = useState([]);
    const [invoices, setInvoices] = useState([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const navigate = useNavigate();

    useEffect(() => {
        if (!isSuperAdmin) return;

        const fetchData = async () => {
            try {
                // Fetch all Marketplace Orders to calculate total revenue per restaurant
                // We're fetching all for simplicity; in massive apps this should be paginated/aggregated
                const qOrders = query(collection(db, 'marketplaceOrders'), orderBy('createdAt', 'desc'));
                const oSnap = await getDocs(qOrders);
                const allOrders = oSnap.docs.map(d => ({ id: d.id, ...d.data() }));
                setOrders(allOrders);

                // Fetch all Restaurant Invoices to calculate billed/paid/pending amounts
                const qInvoices = query(collection(db, 'restaurantInvoices'));
                const iSnap = await getDocs(qInvoices);
                const allInvoices = iSnap.docs.map(d => ({ id: d.id, ...d.data() }));
                setInvoices(allInvoices);

            } catch (error) {
                console.error("Error fetching restaurant data:", error);
                toast.error("Failed to load restaurant data.");
            } finally {
                setLoading(false);
            }
        };

        fetchData();
    }, [isSuperAdmin]);

    // Aggregate data per unique restaurant
    const restaurantAgg = useMemo(() => {
        const agg = {};

        // Aggregate Orders
        orders.forEach(o => {
            const rId = o.restaurantId || 'Unknown';
            if (!agg[rId]) {
                agg[rId] = { id: rId, orderCount: 0, revenue: 0, billed: 0, paid: 0, pending: 0, invoiceCount: 0 };
            }
            agg[rId].orderCount++;

            // Only count revenue for fulfilled/completed/delivered
            const status = (o.status || '').toLowerCase();
            if (['fulfilled', 'completed', 'delivered'].includes(status)) {
                agg[rId].revenue += Number(o.grandTotalAfterTax || o.total || 0);
            }
        });

        // Aggregate Invoices
        invoices.forEach(inv => {
            const rId = inv.restaurantId || 'Unknown';
            if (!agg[rId]) {
                agg[rId] = { id: rId, orderCount: 0, revenue: 0, billed: 0, paid: 0, pending: 0, invoiceCount: 0 };
            }

            const amount = Number(inv.grandTotal || 0);
            agg[rId].invoiceCount++;
            agg[rId].billed += amount;

            if (inv.paymentStatus === 'PAID') {
                agg[rId].paid += amount;
            } else if (inv.paymentStatus === 'PENDING') {
                agg[rId].pending += amount;
            }
        });

        return Object.values(agg);
    }, [orders, invoices]);

    const filteredRestaurants = useMemo(() => {
        return restaurantAgg.filter(r =>
            !search || r.id.toLowerCase().includes(search.toLowerCase())
        ).sort((a, b) => b.revenue - a.revenue); // Sort by highest revenue by default
    }, [restaurantAgg, search]);

    if (!isSuperAdmin) {
        return <div style={{ padding: 40, textAlign: 'center' }}>Access Denied.</div>;
    }

    return (
        <div>
            <div className="page-header">
                <div>
                    <h2>All Restaurants</h2>
                    <div style={{ color: 'var(--muted)', fontSize: 13, marginTop: 4 }}>
                        A high-level summary of order volume and invoice health for every restaurant on the platform.
                    </div>
                </div>
            </div>

            <div className="ui-card" style={{ marginBottom: 20 }}>
                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                    <input
                        className="ui-input"
                        placeholder="🔍 Search Restaurant Name/ID..."
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        style={{ maxWidth: 300, flex: 1 }}
                    />
                </div>
            </div>

            <div className="ui-table-wrap">
                <table className="ui-table">
                    <thead>
                        <tr>
                            <th>Restaurant</th>
                            <th style={{ textAlign: 'right' }}>Total Orders</th>
                            <th style={{ textAlign: 'right' }}>Realized Revenue</th>
                            <th style={{ textAlign: 'right' }}>Invoices Generated</th>
                            <th style={{ textAlign: 'right' }}>Total Billed</th>
                            <th style={{ textAlign: 'right' }}>Total Paid</th>
                            <th style={{ textAlign: 'right' }}>Total Pending</th>
                        </tr>
                    </thead>
                    <tbody>
                        {loading ? (
                            <tr><td colSpan="7" style={{ textAlign: 'center', padding: 24 }}>Loading restaurants...</td></tr>
                        ) : filteredRestaurants.length === 0 ? (
                            <tr><td colSpan="7" style={{ textAlign: 'center', color: 'var(--muted)', padding: 24 }}>No restaurants found.</td></tr>
                        ) : (
                            filteredRestaurants.map(r => (
                                <tr
                                    key={r.id}
                                    className="is-row"
                                    style={{ cursor: 'pointer' }}
                                    onClick={() => navigate(`/admin/restaurant-invoices?status=All&restaurantId=${encodeURIComponent(r.id)}`)}
                                    title={`View invoices for ${r.id}`}
                                >
                                    <td style={{ fontWeight: 600 }}>{r.id === 'Unknown' ? <em style={{ color: 'var(--muted)' }}>Unknown / Unassigned</em> : r.id}</td>
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
