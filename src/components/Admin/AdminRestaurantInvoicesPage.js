import React, { useState, useEffect, useContext, useMemo } from 'react';
import { UserContext } from '../../contexts/UserContext';
import { db } from '../../firebase';
import { collection, query, orderBy, onSnapshot, doc, updateDoc, setDoc, serverTimestamp, getDocs, getDoc } from 'firebase/firestore';
import { toast } from 'react-toastify';
import { useNavigate } from 'react-router-dom';
import { getTaxRate } from '../../constants/taxRates';

export default function AdminRestaurantInvoicesPage() {
    const { isSuperAdmin, displayName } = useContext(UserContext);
    const [invoices, setInvoices] = useState([]);
    const [vendors, setVendors] = useState([]);
    const [loading, setLoading] = useState(true);
    const [scanning, setScanning] = useState(false);
    const [processingId, setProcessingId] = useState(null);
    const navigate = useNavigate();

    // Filters
    const [vendorFilter, setVendorFilter] = useState('All');
    const [restaurantFilter, setRestaurantFilter] = useState('All');
    const [statusFilter, setStatusFilter] = useState('All');
    const [search, setSearch] = useState('');

    useEffect(() => {
        if (!isSuperAdmin) return;

        // Load Vendors
        const loadVendors = async () => {
            const vSnap = await getDocs(collection(db, 'vendors'));
            setVendors(vSnap.docs.map(d => ({ id: d.id, ...d.data() })));
        };
        loadVendors();

        // Listen to Restaurant Invoices
        const q = query(collection(db, 'restaurantInvoices'), orderBy('createdAt', 'desc'));
        const unsubscribe = onSnapshot(q, (snapshot) => {
            setInvoices(snapshot.docs.map(d => ({ id: d.id, ...d.data() })));
            setLoading(false);
        }, (err) => {
            console.error('Error fetching restaurant invoices:', err);
            toast.error('Failed to load restaurant invoices.');
            setLoading(false);
        });

        return () => unsubscribe();
    }, [isSuperAdmin]);

    const handleGenerateInvoices = async () => {
        setScanning(true);
        let createdCount = 0;
        try {
            // 1. Fetch all FULFILLED orders
            const ordersReq = await getDocs(collection(db, 'marketplaceOrders'));
            const eligibleOrders = ordersReq.docs
                .map(d => ({ id: d.id, ...d.data() }))
                .filter(o => o.status === 'fulfilled');

            // 2. Check which orders are missing restaurant invoices
            const missingOrders = [];
            for (const order of eligibleOrders) {
                const invSnap = await getDoc(doc(db, 'restaurantInvoices', order.id));
                if (!invSnap.exists()) {
                    missingOrders.push(order);
                }
            }

            if (missingOrders.length === 0) {
                toast.info('All eligible orders already have restaurant invoices.');
                setScanning(false);
                return;
            }

            // 3. Create missing invoices
            const now = new Date();

            for (let i = 0; i < missingOrders.length; i++) {
                const order = missingOrders[i];

                // Fetch Vendor for tax rate
                const vendorSnap = await getDoc(doc(db, 'vendors', order.vendorId));
                const vData = vendorSnap.exists() ? vendorSnap.data() : {};
                const taxRate = getTaxRate(vData.country || 'Canada', vData.province);

                let subtotal = 0;
                let totalTax = 0;
                const formattedItems = (order.items || []).map(item => {
                    const price = Number(item.vendorPrice ?? item.price ?? 0);
                    const qty = item.qty || 1;
                    const lineTotal = item.lineSubtotal || Number((price * qty).toFixed(2));
                    const isTaxable = !!item.taxable;
                    const lineTax = isTaxable ? Number((lineTotal * (taxRate / 100)).toFixed(2)) : 0;
                    subtotal += lineTotal;
                    totalTax += lineTax;
                    return {
                        itemId: item.itemId,
                        itemName: item.itemName || item.name || 'Unknown Item',
                        unit: item.unit || 'unit',
                        qty,
                        price,
                        lineTotal,
                        isTaxable,
                        lineTax
                    };
                });

                subtotal = Number(subtotal.toFixed(2));
                totalTax = Number(totalTax.toFixed(2));
                const grandTotal = Number((subtotal + totalTax).toFixed(2));
                const invoiceNumber = `INV-C-${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(Date.now()).slice(-5)}${i}`;

                const invRef = doc(db, 'restaurantInvoices', order.id);
                await setDoc(invRef, {
                    orderId: order.id,
                    vendorId: order.vendorId,
                    vendorName: order.vendorName || vData.name || 'Unknown Vendor',
                    restaurantId: order.restaurantId || 'Unknown Restaurant',
                    invoiceNumber,
                    invoiceDate: serverTimestamp(),
                    dueDate: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString(),
                    paymentStatus: 'PENDING',
                    subtotal,
                    totalTax,
                    grandTotal,
                    items: formattedItems,
                    createdAt: serverTimestamp(),
                    updatedAt: serverTimestamp(),
                    adminNotes: 'Manually generated for restaurant'
                });
                createdCount++;
            }

            toast.success(`Successfully generated ${createdCount} missing restaurant invoice(s).`);

        } catch (err) {
            console.error('Failed scanning for restaurant invoices:', err);
            toast.error('Failed to generate missing restaurant invoices.');
        } finally {
            setScanning(false);
        }
    };

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

    // Unique restaurants for filter
    const uniqueRestaurants = useMemo(() => {
        return [...new Set(invoices.map(inv => inv.restaurantId).filter(Boolean))].sort();
    }, [invoices]);

    const filteredInvoices = useMemo(() => {
        return invoices.filter(inv => {
            const matchSearch = !search ||
                (inv.invoiceNumber || '').toLowerCase().includes(search.toLowerCase()) ||
                (inv.orderId || '').toLowerCase().includes(search.toLowerCase());
            const matchVendor = vendorFilter === 'All' || inv.vendorId === vendorFilter;
            const matchRestaurant = restaurantFilter === 'All' || inv.restaurantId === restaurantFilter;
            const matchStatus = statusFilter === 'All' || inv.paymentStatus === statusFilter;
            return matchSearch && matchVendor && matchRestaurant && matchStatus;
        });
    }, [invoices, search, vendorFilter, restaurantFilter, statusFilter]);

    if (!isSuperAdmin) {
        return <div style={{ padding: 40, textAlign: 'center' }}>Access Denied.</div>;
    }

    return (
        <div>
            <div className="page-header">
                <div>
                    <h2>Restaurant Invoices</h2>
                    <div style={{ color: 'var(--muted)', fontSize: 13, marginTop: 4 }}>
                        Manage invoices sent to restaurants for their marketplace orders.
                    </div>
                </div>
                <button
                    className="ui-btn primary"
                    onClick={handleGenerateInvoices}
                    disabled={scanning}
                >
                    {scanning ? '🔄 Scanning...' : '🧾 Scan & Generate Missing Invoices'}
                </button>
            </div>

            <div className="ui-card" style={{ marginBottom: 20 }}>
                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                    <input
                        className="ui-input"
                        placeholder="🔍 Search Invoice # or Order ID..."
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        style={{ maxWidth: 250, flex: 1 }}
                    />
                    <select
                        className="ui-input"
                        value={vendorFilter}
                        onChange={e => setVendorFilter(e.target.value)}
                        style={{ maxWidth: 200 }}
                    >
                        <option value="All">All Vendors</option>
                        {vendors.map(v => (
                            <option key={v.id} value={v.id}>{v.name}</option>
                        ))}
                    </select>
                    <select
                        className="ui-input"
                        value={restaurantFilter}
                        onChange={e => setRestaurantFilter(e.target.value)}
                        style={{ maxWidth: 200 }}
                    >
                        <option value="All">All Restaurants</option>
                        {uniqueRestaurants.map(r => (
                            <option key={r} value={r}>{r}</option>
                        ))}
                    </select>
                    <select
                        className="ui-input"
                        value={statusFilter}
                        onChange={e => setStatusFilter(e.target.value)}
                        style={{ maxWidth: 150 }}
                    >
                        <option value="All">All Status</option>
                        <option value="PENDING">Pending</option>
                        <option value="PAID">Paid</option>
                    </select>
                </div>
            </div>

            <div className="ui-table-wrap">
                <table className="ui-table">
                    <thead>
                        <tr>
                            <th>Invoice #</th>
                            <th>Order ID</th>
                            <th>Restaurant</th>
                            <th>Vendor</th>
                            <th>Date</th>
                            <th>Total</th>
                            <th>Status</th>
                            <th style={{ textAlign: 'right' }}>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {loading ? (
                            <tr><td colSpan="8" style={{ textAlign: 'center', padding: 24 }}>Loading invoices...</td></tr>
                        ) : filteredInvoices.length === 0 ? (
                            <tr><td colSpan="8" style={{ textAlign: 'center', color: 'var(--muted)', padding: 24 }}>No restaurant invoices found.</td></tr>
                        ) : (
                            filteredInvoices.map(inv => {
                                const v = vendors.find(x => x.id === inv.vendorId);
                                const vName = inv.vendorName || (v ? (v.name || v.businessName) : 'Unknown Vendor');
                                const isPending = inv.paymentStatus === 'PENDING';

                                return (
                                    <tr key={inv.id} className="is-row" style={{ cursor: 'pointer' }} onClick={() => navigate(`/admin/restaurant-invoices/${inv.id}`)}>
                                        <td style={{ fontWeight: 600 }}>{inv.invoiceNumber}</td>
                                        <td style={{ fontSize: 13, color: 'var(--muted)' }}>{inv.orderGroupId || inv.orderId.slice(-8).toUpperCase()}</td>
                                        <td>{inv.restaurantId}</td>
                                        <td>{vName}</td>
                                        <td>{formatDate(inv.invoiceDate)}</td>
                                        <td style={{ fontWeight: 600, color: '#4ade80' }}>
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
    );
}
