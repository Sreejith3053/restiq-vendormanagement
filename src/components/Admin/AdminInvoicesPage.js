import React, { useState, useEffect, useContext, useMemo } from 'react';
import { UserContext } from '../../contexts/UserContext';
import { db } from '../../firebase';
import { collection, query, orderBy, onSnapshot, doc, writeBatch, getDocs, getDoc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { toast } from 'react-toastify';
import { useNavigate } from 'react-router-dom';
import { getTaxRate } from '../../constants/taxRates';

export default function AdminInvoicesPage() {
    const { isSuperAdmin, displayName } = useContext(UserContext);
    const [invoices, setInvoices] = useState([]);
    const [vendors, setVendors] = useState([]);
    const [loading, setLoading] = useState(true);
    const [scanning, setScanning] = useState(false);
    const [processingId, setProcessingId] = useState(null);
    const navigate = useNavigate();

    // Filters
    const [vendorFilter, setVendorFilter] = useState('All');
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

        // Listen to Invoices
        const q = query(collection(db, 'vendorInvoices'), orderBy('createdAt', 'desc'));
        const unsubscribe = onSnapshot(q, (snapshot) => {
            setInvoices(snapshot.docs.map(d => ({ id: d.id, ...d.data() })));
            setLoading(false);
        }, (err) => {
            console.error('Error fetching invoices:', err);
            toast.error('Failed to load invoices.');
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
                .filter(o => o.status === 'fulfilled'); // Only generate invoices for fulfilled orders

            // 2. Fetch all existing invoices
            const invReq = await getDocs(collection(db, 'vendorInvoices'));
            const existingOrderIds = new Set(invReq.docs.map(d => d.data().orderId));

            // 3. Find missing invoices
            const missingOrders = eligibleOrders.filter(o => !existingOrderIds.has(o.id));

            if (missingOrders.length === 0) {
                toast.info('All eligible orders already have invoices.');
                setScanning(false);
                return;
            }

            // 4. Batch create invoices
            const batch = writeBatch(db);
            const now = new Date();

            for (let i = 0; i < missingOrders.length; i++) {
                const order = missingOrders[i];
                const invRef = doc(collection(db, 'vendorInvoices'));

                // 4a. Check for Snapshot
                const hasSnapshot = order.subtotalBeforeTax !== undefined;

                let subtotalVendorAmount = 0;
                let totalTaxAmount = 0;
                let formattedItems = [];

                if (hasSnapshot) {
                    subtotalVendorAmount = order.subtotalBeforeTax;
                    totalTaxAmount = order.totalTax;
                    formattedItems = (order.items || []).map(item => ({
                        itemId: item.itemId,
                        itemName: item.itemName || item.name || 'Unknown Item',
                        unit: item.unit || 'unit',
                        qty: item.qty || 1,
                        vendorPrice: Number(item.vendorPrice ?? item.price ?? 0),
                        lineTotalVendor: item.lineSubtotal || Number((item.vendorPrice ?? item.price ?? 0) * (item.qty || 1)),
                        isTaxable: !!item.isTaxable,
                        lineTax: item.lineTax || 0
                    }));
                } else {
                    // Legacy Fallback
                    const vendorSnap = await getDoc(doc(db, 'vendors', order.vendorId));
                    const vData = vendorSnap.exists() ? vendorSnap.data() : {};
                    const taxRate = getTaxRate(vData.country || 'Canada', vData.province);

                    const itemsRef = collection(db, `vendors/${order.vendorId}/items`);
                    const itemsSnap = await getDocs(itemsRef);
                    const itemTaxMap = {};
                    itemsSnap.docs.forEach(d => {
                        itemTaxMap[d.id] = !!d.data().taxable;
                    });

                    formattedItems = (order.items || []).map(item => {
                        const price = Number(item.vendorPrice ?? item.price ?? 0);
                        const qty = Number(item.qty || 1);
                        const lineSubtotal = Number((price * qty).toFixed(2));

                        const isTaxable = item.itemId ? itemTaxMap[item.itemId] : !!item.taxable;
                        const lineTax = isTaxable ? Number((lineSubtotal * (taxRate / 100)).toFixed(2)) : 0;

                        subtotalVendorAmount += lineSubtotal;
                        totalTaxAmount += lineTax;

                        return {
                            itemId: item.itemId,
                            itemName: item.itemName || item.name || 'Unknown Item',
                            unit: item.unit || 'unit',
                            qty,
                            vendorPrice: price,
                            lineTotalVendor: lineSubtotal,
                            isTaxable,
                            lineTax
                        };
                    });
                }

                const totalVendorAmount = Number((subtotalVendorAmount + totalTaxAmount).toFixed(2));
                const invoiceNumber = `INV-${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(Date.now()).slice(-5)}${i}`;

                const invoiceData = {
                    orderId: order.id,
                    vendorId: order.vendorId,
                    restaurantId: order.restaurantId || 'Unknown Restaurant',
                    invoiceNumber,
                    invoiceDate: serverTimestamp(),
                    dueDate: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString(),
                    paymentStatus: 'PENDING',
                    subtotalVendorAmount: Number(subtotalVendorAmount.toFixed(2)),
                    totalTaxAmount: Number(totalTaxAmount.toFixed(2)),
                    totalVendorAmount: totalVendorAmount,
                    items: formattedItems,
                    createdAt: serverTimestamp(),
                    updatedAt: serverTimestamp(),
                    adminNotes: hasSnapshot ? 'Manually generated (Snapshot)' : 'Manually generated (Dynamic Fallback)'
                };

                batch.set(invRef, invoiceData);
                createdCount++;
            }

            await batch.commit();
            toast.success(`Successfully generated ${createdCount} missing invoice(s).`);

        } catch (err) {
            console.error('Failed scanning for invoices:', err);
            toast.error('Failed to generate missing invoices.');
        } finally {
            setScanning(false);
        }
    };

    const handleMarkPaid = async (invoiceId) => {
        if (!window.confirm('Mark this invoice as PAID? This action is permanent and visible to the vendor.')) return;

        setProcessingId(invoiceId);
        try {
            await updateDoc(doc(db, 'vendorInvoices', invoiceId), {
                paymentStatus: 'PAID',
                paidAt: serverTimestamp(),
                updatedAt: serverTimestamp(),
                paidByAdminName: displayName || 'Admin'
            });
            toast.success('Invoice marked as PAID.');
        } catch (err) {
            console.error('Failed to update invoice status:', err);
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

    const filteredInvoices = useMemo(() => {
        return invoices.filter(inv => {
            const matchSearch = !search ||
                (inv.invoiceNumber || '').toLowerCase().includes(search.toLowerCase()) ||
                (inv.orderId || '').toLowerCase().includes(search.toLowerCase());
            const matchVendor = vendorFilter === 'All' || inv.vendorId === vendorFilter;
            const matchStatus = statusFilter === 'All' || inv.paymentStatus === statusFilter;
            return matchSearch && matchVendor && matchStatus;
        });
    }, [invoices, search, vendorFilter, statusFilter]);

    if (!isSuperAdmin) {
        return <div style={{ padding: 40, textAlign: 'center' }}>Access Denied.</div>;
    }

    return (
        <div>
            <div className="page-header">
                <div>
                    <h2>Vendor Invoices</h2>
                    <div style={{ color: 'var(--muted)', fontSize: 13, marginTop: 4 }}>
                        Manage generated invoices, track vendor payments, and mark invoices as paid.
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
                            <th>Vendor</th>
                            <th>Date</th>
                            <th>Vendor Total</th>
                            <th>Status</th>
                            <th style={{ textAlign: 'right' }}>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {loading ? (
                            <tr><td colSpan="7" style={{ textAlign: 'center', padding: 24 }}>Loading invoices...</td></tr>
                        ) : filteredInvoices.length === 0 ? (
                            <tr><td colSpan="7" style={{ textAlign: 'center', color: 'var(--muted)', padding: 24 }}>No invoices found.</td></tr>
                        ) : (
                            filteredInvoices.map(inv => {
                                const v = vendors.find(x => x.id === inv.vendorId);
                                const vName = v ? (v.name || v.businessName) : 'Unknown Vendor';
                                const isPending = inv.paymentStatus === 'PENDING';

                                return (
                                    <tr key={inv.id} className="is-row" onClick={() => navigate(`/admin/invoices/${inv.id}`)} style={{ cursor: 'pointer' }}>
                                        <td style={{ fontWeight: 600 }}>{inv.invoiceNumber}</td>
                                        <td style={{ fontSize: 13, color: 'var(--muted)' }}>{inv.orderId.slice(-8).toUpperCase()}</td>
                                        <td>{vName}</td>
                                        <td>{formatDate(inv.invoiceDate)}</td>
                                        <td style={{ fontWeight: 600, color: '#4ade80' }}>
                                            ${Number(inv.totalVendorAmount || 0).toFixed(2)}
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
