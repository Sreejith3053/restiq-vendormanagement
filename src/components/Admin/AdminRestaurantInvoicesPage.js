import React, { useState, useEffect, useContext, useMemo } from 'react';
import { UserContext } from '../../contexts/UserContext';
import { db } from '../../firebase';
import { collection, query, orderBy, onSnapshot, doc, updateDoc, setDoc, addDoc, serverTimestamp, getDocs, getDoc } from 'firebase/firestore';
import { toast } from 'react-toastify';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { getTaxRate } from '../../constants/taxRates';

export default function AdminRestaurantInvoicesPage() {
    const { isSuperAdmin, displayName } = useContext(UserContext);
    const [invoices, setInvoices] = useState([]);
    const [vendors, setVendors] = useState([]);
    const [loading, setLoading] = useState(true);
    const [scanning, setScanning] = useState(false);
    const [processingId, setProcessingId] = useState(null);
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();

    // Filters
    const [vendorFilter, setVendorFilter] = useState('All');
    const [restaurantFilter, setRestaurantFilter] = useState('All');
    const [statusFilter, setStatusFilter] = useState(searchParams.get('status') || 'All');
    const [search, setSearch] = useState('');

    // Payment modal state
    const [showPaymentModal, setShowPaymentModal] = useState(false);
    const [selectedInvoice, setSelectedInvoice] = useState(null);
    const [paymentMethod, setPaymentMethod] = useState('');
    const [paymentFields, setPaymentFields] = useState({});

    useEffect(() => {
        if (!isSuperAdmin) return;

        const loadVendors = async () => {
            const vSnap = await getDocs(collection(db, 'vendors'));
            setVendors(vSnap.docs.map(d => ({ id: d.id, ...d.data() })));
        };
        loadVendors();

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
            const ordersReq = await getDocs(collection(db, 'marketplaceOrders'));
            const eligibleOrders = ordersReq.docs
                .map(d => ({ id: d.id, ...d.data() }))
                .filter(o => o.status === 'fulfilled');

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

            const now = new Date();

            for (let i = 0; i < missingOrders.length; i++) {
                const order = missingOrders[i];

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

    // Open payment modal instead of direct mark-paid
    const handleMarkPaidClick = (inv, e) => {
        e.stopPropagation();
        setSelectedInvoice(inv);
        setPaymentMethod('');
        setPaymentFields({});
        setShowPaymentModal(true);
    };

    const handlePaymentFieldChange = (field, value) => {
        setPaymentFields(prev => ({ ...prev, [field]: value }));
    };

    const handleConfirmPayment = async () => {
        if (!paymentMethod) {
            toast.error('Please select a payment method.');
            return;
        }

        // Validate required fields per method
        if (paymentMethod === 'Card Terminal') {
            if (!paymentFields.transactionNumber || !paymentFields.collectedBy || !paymentFields.paymentDate) {
                toast.error('Please fill in all required Card Terminal fields.');
                return;
            }
        } else if (paymentMethod === 'Cheque') {
            if (!paymentFields.chequeNumber || !paymentFields.collectedBy || !paymentFields.chequeDepositDate) {
                toast.error('Please fill in all required Cheque fields.');
                return;
            }
        } else if (paymentMethod === 'E-Transfer') {
            if (!paymentFields.validatedBy || !paymentFields.paymentDate) {
                toast.error('Please fill in all required E-Transfer fields.');
                return;
            }
        } else if (paymentMethod === 'Cash') {
            if (!paymentFields.receivedBy || !paymentFields.paymentDate) {
                toast.error('Please fill in all required Cash fields.');
                return;
            }
        }

        setProcessingId(selectedInvoice.id);
        try {
            // 1. Save to RestaurantPaymentHistory collection
            await addDoc(collection(db, 'RestaurantPaymentHistory'), {
                invoiceId: selectedInvoice.id,
                invoiceNumber: selectedInvoice.invoiceNumber || '',
                orderId: selectedInvoice.orderId || '',
                orderGroupId: selectedInvoice.orderGroupId || '',
                restaurantId: selectedInvoice.restaurantId || '',
                restaurantName: selectedInvoice.restaurantName || selectedInvoice.restaurantId || '',
                vendorName: selectedInvoice.vendorName || '',
                amount: Number(selectedInvoice.grandTotal || 0),
                paymentMethod: paymentMethod,
                ...paymentFields,
                recordedBy: displayName || 'Admin',
                createdAt: serverTimestamp()
            });

            // 2. Update the invoice status to PAID
            await updateDoc(doc(db, 'restaurantInvoices', selectedInvoice.id), {
                paymentStatus: 'PAID',
                paymentMethod: paymentMethod,
                paidAt: serverTimestamp(),
                updatedAt: serverTimestamp(),
                paidByAdminName: displayName || 'Admin'
            });

            toast.success('Payment recorded & invoice marked as PAID.');
            setShowPaymentModal(false);
            setSelectedInvoice(null);
        } catch (err) {
            console.error('Failed to record payment:', err);
            toast.error('Failed to record payment.');
        } finally {
            setProcessingId(null);
        }
    };

    const formatDate = (timestamp) => {
        if (!timestamp) return 'N/A';
        const d = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
        return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    };

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

    // Shared modal styles
    const inputStyle = {
        width: '100%', padding: '10px 12px', borderRadius: 8,
        border: '1px solid var(--border)', background: 'var(--bg-card)',
        color: 'var(--text)', fontSize: 14, fontFamily: 'inherit', boxSizing: 'border-box'
    };
    const labelStyle = { display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--muted)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '.5px' };
    const fieldGroup = { marginBottom: 16 };

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
                                                    onClick={(e) => handleMarkPaidClick(inv, e)}
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

            {/* ─── Payment Collection Modal ─── */}
            {showPaymentModal && selectedInvoice && (
                <div style={{
                    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 1000,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    backdropFilter: 'blur(4px)'
                }} onClick={() => setShowPaymentModal(false)}>
                    <div style={{
                        background: 'var(--bg-card)', borderRadius: 16, padding: 32,
                        width: '100%', maxWidth: 520, maxHeight: '90vh', overflowY: 'auto',
                        border: '1px solid var(--border)',
                        boxShadow: '0 20px 60px rgba(0,0,0,0.4)'
                    }} onClick={e => e.stopPropagation()}>
                        {/* Modal Header */}
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
                            <div>
                                <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>💳 Record Payment</h3>
                                <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 4 }}>
                                    {selectedInvoice.invoiceNumber} • <span style={{ color: '#4ade80', fontWeight: 600 }}>${Number(selectedInvoice.grandTotal || 0).toFixed(2)}</span>
                                </div>
                            </div>
                            <button onClick={() => setShowPaymentModal(false)} style={{
                                background: 'none', border: 'none', color: 'var(--muted)',
                                fontSize: 20, cursor: 'pointer', padding: 4
                            }}>✕</button>
                        </div>

                        {/* Payment Method Selector */}
                        <div style={fieldGroup}>
                            <label style={labelStyle}>Payment Method *</label>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                                {['Card Terminal', 'Cheque', 'E-Transfer', 'Cash'].map(method => (
                                    <button
                                        key={method}
                                        onClick={() => { setPaymentMethod(method); setPaymentFields({}); }}
                                        style={{
                                            padding: '12px 16px', borderRadius: 10,
                                            border: paymentMethod === method ? '2px solid #4dabf7' : '1px solid var(--border)',
                                            background: paymentMethod === method ? 'rgba(77, 171, 247, 0.1)' : 'var(--bg)',
                                            color: paymentMethod === method ? '#4dabf7' : 'var(--text)',
                                            fontWeight: 600, fontSize: 13, cursor: 'pointer',
                                            transition: 'all .15s ease', fontFamily: 'inherit'
                                        }}
                                    >
                                        {method === 'Card Terminal' && '💳 '}
                                        {method === 'Cheque' && '📝 '}
                                        {method === 'E-Transfer' && '📲 '}
                                        {method === 'Cash' && '💵 '}
                                        {method}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* Conditional Fields */}
                        {paymentMethod === 'Card Terminal' && (
                            <div>
                                <div style={fieldGroup}>
                                    <label style={labelStyle}>Transaction # *</label>
                                    <input type="text" placeholder="Enter transaction number" style={inputStyle}
                                        value={paymentFields.transactionNumber || ''}
                                        onChange={e => handlePaymentFieldChange('transactionNumber', e.target.value)} />
                                </div>
                                <div style={fieldGroup}>
                                    <label style={labelStyle}>Collected By *</label>
                                    <input type="text" placeholder="Name of person who collected payment" style={inputStyle}
                                        value={paymentFields.collectedBy || ''}
                                        onChange={e => handlePaymentFieldChange('collectedBy', e.target.value)} />
                                </div>
                                <div style={fieldGroup}>
                                    <label style={labelStyle}>Payment Date *</label>
                                    <input type="date" style={inputStyle}
                                        value={paymentFields.paymentDate || ''}
                                        onChange={e => handlePaymentFieldChange('paymentDate', e.target.value)} />
                                </div>
                            </div>
                        )}

                        {paymentMethod === 'Cheque' && (
                            <div>
                                <div style={fieldGroup}>
                                    <label style={labelStyle}>Cheque Number *</label>
                                    <input type="text" placeholder="Enter cheque number" style={inputStyle}
                                        value={paymentFields.chequeNumber || ''}
                                        onChange={e => handlePaymentFieldChange('chequeNumber', e.target.value)} />
                                </div>
                                <div style={fieldGroup}>
                                    <label style={labelStyle}>Collected By *</label>
                                    <input type="text" placeholder="Name of person who collected cheque" style={inputStyle}
                                        value={paymentFields.collectedBy || ''}
                                        onChange={e => handlePaymentFieldChange('collectedBy', e.target.value)} />
                                </div>
                                <div style={fieldGroup}>
                                    <label style={labelStyle}>Cheque Date to Deposit *</label>
                                    <input type="date" style={inputStyle}
                                        value={paymentFields.chequeDepositDate || ''}
                                        onChange={e => handlePaymentFieldChange('chequeDepositDate', e.target.value)} />
                                </div>
                            </div>
                        )}

                        {paymentMethod === 'E-Transfer' && (
                            <div>
                                <div style={fieldGroup}>
                                    <label style={labelStyle}>Validated By *</label>
                                    <input type="text" placeholder="Name of person who validated the e-transfer" style={inputStyle}
                                        value={paymentFields.validatedBy || ''}
                                        onChange={e => handlePaymentFieldChange('validatedBy', e.target.value)} />
                                </div>
                                <div style={fieldGroup}>
                                    <label style={labelStyle}>Payment Date *</label>
                                    <input type="date" style={inputStyle}
                                        value={paymentFields.paymentDate || ''}
                                        onChange={e => handlePaymentFieldChange('paymentDate', e.target.value)} />
                                </div>
                            </div>
                        )}

                        {paymentMethod === 'Cash' && (
                            <div>
                                <div style={fieldGroup}>
                                    <label style={labelStyle}>Received By *</label>
                                    <input type="text" placeholder="Name of person who received cash" style={inputStyle}
                                        value={paymentFields.receivedBy || ''}
                                        onChange={e => handlePaymentFieldChange('receivedBy', e.target.value)} />
                                </div>
                                <div style={fieldGroup}>
                                    <label style={labelStyle}>Payment Date *</label>
                                    <input type="date" style={inputStyle}
                                        value={paymentFields.paymentDate || ''}
                                        onChange={e => handlePaymentFieldChange('paymentDate', e.target.value)} />
                                </div>
                            </div>
                        )}

                        {/* Confirm / Cancel */}
                        {paymentMethod && (
                            <div style={{ display: 'flex', gap: 12, marginTop: 24 }}>
                                <button
                                    onClick={() => setShowPaymentModal(false)}
                                    style={{
                                        flex: 1, padding: '12px', borderRadius: 10,
                                        border: '1px solid var(--border)', background: 'var(--bg)',
                                        color: 'var(--muted)', fontWeight: 600, fontSize: 14,
                                        cursor: 'pointer', fontFamily: 'inherit'
                                    }}
                                >
                                    Cancel
                                </button>
                                <button
                                    onClick={handleConfirmPayment}
                                    disabled={processingId === selectedInvoice.id}
                                    style={{
                                        flex: 2, padding: '12px', borderRadius: 10,
                                        border: 'none', background: 'linear-gradient(135deg, #4ade80, #22c55e)',
                                        color: '#fff', fontWeight: 700, fontSize: 14,
                                        cursor: processingId ? 'not-allowed' : 'pointer',
                                        opacity: processingId ? 0.7 : 1, fontFamily: 'inherit',
                                        boxShadow: '0 4px 16px rgba(74, 222, 128, 0.3)'
                                    }}
                                >
                                    {processingId === selectedInvoice.id ? '⏳ Recording...' : `✅ Confirm Payment — $${Number(selectedInvoice.grandTotal || 0).toFixed(2)}`}
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
