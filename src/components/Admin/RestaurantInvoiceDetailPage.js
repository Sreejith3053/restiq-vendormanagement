import React, { useState, useEffect, useContext } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { UserContext } from '../../contexts/UserContext';
import { db, storage } from '../../firebase';
import { doc, getDoc, updateDoc, addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { toast } from 'react-toastify';
import { generateInvoicePDF } from '../../utils/generateInvoicePDF';

export default function RestaurantInvoiceDetailPage() {
    const { invoiceId } = useParams();
    const { isSuperAdmin, displayName } = useContext(UserContext);
    const navigate = useNavigate();

    const [invoice, setInvoice] = useState(null);
    const [loading, setLoading] = useState(true);
    const [processing, setProcessing] = useState(false);
    const [generatingPdf, setGeneratingPdf] = useState(false);
    const [pdfUrl, setPdfUrl] = useState(null);

    // Payment modal state
    const [showPaymentModal, setShowPaymentModal] = useState(false);
    const [paymentMethod, setPaymentMethod] = useState('');
    const [paymentFields, setPaymentFields] = useState({});

    useEffect(() => {
        const fetchInvoice = async () => {
            try {
                const docRef = doc(db, 'restaurantInvoices', invoiceId);
                const snap = await getDoc(docRef);

                if (!snap.exists()) {
                    toast.error('Restaurant invoice not found.');
                    navigate(-1);
                    return;
                }

                const data = snap.data();

                if (!isSuperAdmin) {
                    toast.error('Unauthorized access.');
                    navigate('/');
                    return;
                }

                setInvoice({ id: snap.id, ...data });

                if (data.pdfUrl) {
                    setPdfUrl(data.pdfUrl);
                } else {
                    try {
                        const pdfSnap = await getDoc(doc(db, 'restaurantInvoices', invoiceId, 'pdfs', 'invoice'));
                        if (pdfSnap.exists() && pdfSnap.data().pdfBase64) {
                            setPdfUrl(pdfSnap.data().pdfBase64);
                        }
                    } catch (_) { }
                }
            } catch (err) {
                console.error('Failed to load restaurant invoice:', err);
                toast.error('Could not load invoice details.');
            } finally {
                setLoading(false);
            }
        };

        fetchInvoice();
    }, [invoiceId, isSuperAdmin, navigate]);

    const handleGeneratePDF = async () => {
        setGeneratingPdf(true);
        try {
            let restaurantInfo = {};
            if (invoice.restaurantId) {
                try {
                    const res = await fetch(`/api/restaurant-info/${invoice.restaurantId}`);
                    if (res.ok) {
                        restaurantInfo = await res.json();
                    }
                } catch (fetchErr) {
                    console.warn('Could not fetch restaurant info from RMS:', fetchErr);
                }
            }

            const base64Pdf = await generateInvoicePDF(invoice, restaurantInfo, 'restaurant');

            const byteString = atob(base64Pdf.split(',')[1]);
            const mimeString = base64Pdf.split(',')[0].split(':')[1].split(';')[0];
            const ab = new ArrayBuffer(byteString.length);
            const ia = new Uint8Array(ab);
            for (let i = 0; i < byteString.length; i++) ia[i] = byteString.charCodeAt(i);
            const blob = new Blob([ab], { type: mimeString });

            const storageRef = ref(storage, `invoices/restaurant/${invoiceId}.pdf`);
            await uploadBytes(storageRef, blob, { contentType: 'application/pdf' });
            const downloadUrl = await getDownloadURL(storageRef);

            await updateDoc(doc(db, 'restaurantInvoices', invoiceId), {
                pdfUrl: downloadUrl,
                pdfGeneratedAt: serverTimestamp(),
                pdfGeneratedBy: displayName || 'Admin'
            });

            setPdfUrl(downloadUrl);
            toast.success('Invoice PDF generated successfully!');
        } catch (err) {
            console.error('Failed to generate PDF:', err);
            toast.error('Failed to generate invoice PDF.');
        } finally {
            setGeneratingPdf(false);
        }
    };

    const handleViewPDF = () => {
        if (!pdfUrl) return;
        if (pdfUrl.startsWith('data:')) {
            const newWindow = window.open();
            newWindow.document.write(`<iframe src="${pdfUrl}" style="width:100%;height:100%;border:none;" title="Invoice PDF"></iframe>`);
            newWindow.document.title = `Invoice ${invoice?.invoiceNumber || ''}`;
        } else {
            window.open(pdfUrl, '_blank');
        }
    };

    // Open payment collection modal instead of directly marking as paid
    const handleMarkPaidClick = () => {
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

        setProcessing(true);
        try {
            // 1. Save to RestaurantPaymentHistory collection
            await addDoc(collection(db, 'RestaurantPaymentHistory'), {
                invoiceId: invoiceId,
                invoiceNumber: invoice.invoiceNumber || '',
                orderId: invoice.orderId || '',
                orderGroupId: invoice.orderGroupId || '',
                restaurantId: invoice.restaurantId || '',
                restaurantName: invoice.restaurantName || invoice.restaurantId || '',
                vendorName: invoice.vendorName || '',
                amount: Number(invoice.grandTotal || 0),
                paymentMethod: paymentMethod,
                ...paymentFields,
                recordedBy: displayName || 'Admin',
                createdAt: serverTimestamp()
            });

            // 2. Update the invoice status to PAID
            await updateDoc(doc(db, 'restaurantInvoices', invoiceId), {
                paymentStatus: 'PAID',
                paymentMethod: paymentMethod,
                paidAt: serverTimestamp(),
                updatedAt: serverTimestamp(),
                paidByAdminName: displayName || 'Admin'
            });

            toast.success('Payment recorded & invoice marked as PAID.');
            setShowPaymentModal(false);

            setInvoice(prev => ({
                ...prev,
                paymentStatus: 'PAID',
                paymentMethod: paymentMethod,
                paidAt: new Date()
            }));
        } catch (err) {
            console.error('Failed to record payment:', err);
            toast.error('Failed to record payment.');
        } finally {
            setProcessing(false);
        }
    };

    if (loading) return <div style={{ padding: 40, textAlign: 'center' }}>Loading invoice details...</div>;
    if (!invoice) return null;

    const isPending = invoice.paymentStatus === 'PENDING';

    const formatDate = (timestamp) => {
        if (!timestamp) return 'N/A';
        const d = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
        return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
    };

    // Shared modal input style
    const inputStyle = {
        width: '100%', padding: '10px 12px', borderRadius: 8,
        border: '1px solid var(--border)', background: 'var(--bg-card)',
        color: 'var(--text)', fontSize: 14, fontFamily: 'inherit', boxSizing: 'border-box'
    };
    const labelStyle = { display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--muted)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '.5px' };
    const fieldGroup = { marginBottom: 16 };

    return (
        <div>
            {/* Header & Breadcrumb */}
            <div className="idp-breadcrumb" style={{ marginBottom: 16 }}>
                <a href="/admin/restaurant-invoices" onClick={e => { e.preventDefault(); navigate(-1); }}>
                    ← Back to Restaurant Invoices
                </a>
                <span className="sep">›</span>
                <span style={{ color: 'var(--text)' }}>{invoice.invoiceNumber}</span>
            </div>

            <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                    <h2 style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        Invoice {invoice.invoiceNumber}
                        <span className={`badge ${isPending ? 'amber' : 'green'}`} style={{ fontSize: 13, textTransform: 'uppercase' }}>
                            {invoice.paymentStatus}
                        </span>
                    </h2>
                    <div style={{ color: 'var(--muted)', fontSize: 14, marginTop: 4 }}>
                        Linked to Order{' '}
                        <span
                            style={{ color: '#4dabf7', cursor: 'pointer', textDecoration: 'underline' }}
                            onClick={() => navigate(`/orders?orderId=${invoice.orderId}&search=${invoice.orderGroupId || invoice.orderId.slice(-8).toUpperCase()}`)}
                        >
                            {invoice.orderGroupId || invoice.orderId.slice(-8).toUpperCase()}
                        </span>
                        {' '}• Vendor: <strong>{invoice.vendorName || 'Unknown'}</strong>
                        {' '}• Generated on {formatDate(invoice.invoiceDate)}
                    </div>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                    {pdfUrl && (
                        <button className="ui-btn" onClick={handleViewPDF} style={{ background: 'rgba(74, 222, 128, 0.12)', color: '#4ade80', border: '1px solid rgba(74, 222, 128, 0.3)' }}>
                            📄 View Invoice PDF
                        </button>
                    )}
                    <button
                        className="ui-btn"
                        onClick={handleGeneratePDF}
                        disabled={generatingPdf}
                        style={{ background: 'rgba(14, 165, 233, 0.12)', color: '#0ea5e9', border: '1px solid rgba(14, 165, 233, 0.3)' }}
                    >
                        {generatingPdf ? '⏳ Generating...' : pdfUrl ? '🔄 Regenerate PDF' : '📄 Generate PDF'}
                    </button>
                    {isSuperAdmin && isPending && (
                        <button
                            className="ui-btn primary"
                            onClick={handleMarkPaidClick}
                            disabled={processing}
                        >
                            {processing ? 'Processing...' : '💳 Mark as Paid'}
                        </button>
                    )}
                </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 300px', gap: 24, alignItems: 'flex-start' }}>
                {/* Invoice Items Table */}
                <div className="ui-card" style={{ padding: 24 }}>
                    <h3 style={{ marginBottom: 16 }}>Invoice Items</h3>
                    <div className="ui-table-wrap">
                        <table className="ui-table">
                            <thead>
                                <tr>
                                    <th>Item</th>
                                    <th>Unit</th>
                                    <th>Qty</th>
                                    <th style={{ textAlign: 'right' }}>Tax</th>
                                    <th style={{ textAlign: 'right' }}>Price</th>
                                    <th style={{ textAlign: 'right' }}>Line Total</th>
                                </tr>
                            </thead>
                            <tbody>
                                {(invoice.items || []).map((item, idx) => (
                                    <tr key={idx} className="is-row">
                                        <td style={{ fontWeight: 600 }}>{item.itemName}</td>
                                        <td style={{ textTransform: 'capitalize' }}>{item.unit || 'unit'}</td>
                                        <td>{item.qty}</td>
                                        <td style={{ textAlign: 'right', fontSize: 12, color: 'var(--muted)' }}>
                                            {item.isTaxable ? (
                                                <span style={{ color: '#f59e0b' }}>${Number(item.lineTax || 0).toFixed(2)}</span>
                                            ) : '—'}
                                        </td>
                                        <td style={{ textAlign: 'right', color: 'var(--muted)' }}>
                                            ${Number(item.vendorPrice ?? item.price ?? 0).toFixed(2)}
                                        </td>
                                        <td style={{ textAlign: 'right', fontWeight: 600, color: 'var(--text-primary)' }}>
                                            ${Number(item.lineTotal || 0).toFixed(2)}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>

                {/* Invoice Summary Card */}
                <div className="ui-card" style={{ padding: 24 }}>
                    <h3 style={{ marginBottom: 16 }}>Summary</h3>

                    <div className="idp-field">
                        <div className="idp-field__label">Restaurant</div>
                        <div className="idp-field__value" style={{ fontSize: 14 }}>{invoice.restaurantId || 'N/A'}</div>
                    </div>

                    <div className="idp-field">
                        <div className="idp-field__label">Invoice Date</div>
                        <div className="idp-field__value" style={{ fontSize: 14 }}>{formatDate(invoice.invoiceDate)}</div>
                    </div>

                    <div className="idp-field">
                        <div className="idp-field__label">Due Date</div>
                        <div className="idp-field__value" style={{ fontSize: 14 }}>{formatDate(invoice.dueDate)}</div>
                    </div>

                    {!isPending && invoice.paidAt && (
                        <div className="idp-field" style={{ padding: '8px 12px', background: 'rgba(74, 222, 128, 0.08)', borderRadius: 8, border: '1px solid rgba(74, 222, 128, 0.2)' }}>
                            <div className="idp-field__label" style={{ color: '#4ade80' }}>Paid On</div>
                            <div className="idp-field__value" style={{ fontSize: 14 }}>{formatDate(invoice.paidAt)}</div>
                            {invoice.paymentMethod && (
                                <div className="idp-field__value" style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>via {invoice.paymentMethod}</div>
                            )}
                        </div>
                    )}

                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
                        <span style={{ color: 'var(--muted)' }}>Subtotal</span>
                        <span style={{ fontWeight: 600 }}>${Number(invoice.subtotal || 0).toFixed(2)}</span>
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
                        <span style={{ color: 'var(--muted)' }}>Tax Amount</span>
                        <span style={{ fontWeight: 600, color: '#f59e0b' }}>+ ${Number(invoice.totalTax || 0).toFixed(2)}</span>
                    </div>

                    <hr style={{ border: 'none', borderTop: '1px solid var(--border)', margin: '16px 0' }} />

                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontSize: 16, fontWeight: 600, color: 'var(--muted)' }}>Grand Total</span>
                        <span style={{ fontSize: 24, fontWeight: 700, color: '#4ade80' }}>
                            ${Number(invoice.grandTotal || 0).toFixed(2)}
                        </span>
                    </div>
                </div>
            </div>

            {/* ─── Payment Collection Modal ─── */}
            {showPaymentModal && (
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
                                    {invoice.invoiceNumber} • <span style={{ color: '#4ade80', fontWeight: 600 }}>${Number(invoice.grandTotal || 0).toFixed(2)}</span>
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

                        {/* Conditional Fields based on Payment Method */}
                        {paymentMethod === 'Card Terminal' && (
                            <div style={{ animation: 'fadeIn .2s ease' }}>
                                <div style={fieldGroup}>
                                    <label style={labelStyle}>Transaction # *</label>
                                    <input
                                        type="text"
                                        placeholder="Enter transaction number"
                                        style={inputStyle}
                                        value={paymentFields.transactionNumber || ''}
                                        onChange={e => handlePaymentFieldChange('transactionNumber', e.target.value)}
                                    />
                                </div>
                                <div style={fieldGroup}>
                                    <label style={labelStyle}>Collected By *</label>
                                    <input
                                        type="text"
                                        placeholder="Name of person who collected payment"
                                        style={inputStyle}
                                        value={paymentFields.collectedBy || ''}
                                        onChange={e => handlePaymentFieldChange('collectedBy', e.target.value)}
                                    />
                                </div>
                                <div style={fieldGroup}>
                                    <label style={labelStyle}>Payment Date *</label>
                                    <input
                                        type="date"
                                        style={inputStyle}
                                        value={paymentFields.paymentDate || ''}
                                        onChange={e => handlePaymentFieldChange('paymentDate', e.target.value)}
                                    />
                                </div>
                            </div>
                        )}

                        {paymentMethod === 'Cheque' && (
                            <div style={{ animation: 'fadeIn .2s ease' }}>
                                <div style={fieldGroup}>
                                    <label style={labelStyle}>Cheque Number *</label>
                                    <input
                                        type="text"
                                        placeholder="Enter cheque number"
                                        style={inputStyle}
                                        value={paymentFields.chequeNumber || ''}
                                        onChange={e => handlePaymentFieldChange('chequeNumber', e.target.value)}
                                    />
                                </div>
                                <div style={fieldGroup}>
                                    <label style={labelStyle}>Collected By *</label>
                                    <input
                                        type="text"
                                        placeholder="Name of person who collected cheque"
                                        style={inputStyle}
                                        value={paymentFields.collectedBy || ''}
                                        onChange={e => handlePaymentFieldChange('collectedBy', e.target.value)}
                                    />
                                </div>
                                <div style={fieldGroup}>
                                    <label style={labelStyle}>Cheque Date to Deposit *</label>
                                    <input
                                        type="date"
                                        style={inputStyle}
                                        value={paymentFields.chequeDepositDate || ''}
                                        onChange={e => handlePaymentFieldChange('chequeDepositDate', e.target.value)}
                                    />
                                </div>
                            </div>
                        )}

                        {paymentMethod === 'E-Transfer' && (
                            <div style={{ animation: 'fadeIn .2s ease' }}>
                                <div style={fieldGroup}>
                                    <label style={labelStyle}>Validated By *</label>
                                    <input
                                        type="text"
                                        placeholder="Name of person who validated the e-transfer"
                                        style={inputStyle}
                                        value={paymentFields.validatedBy || ''}
                                        onChange={e => handlePaymentFieldChange('validatedBy', e.target.value)}
                                    />
                                </div>
                                <div style={fieldGroup}>
                                    <label style={labelStyle}>Payment Date *</label>
                                    <input
                                        type="date"
                                        style={inputStyle}
                                        value={paymentFields.paymentDate || ''}
                                        onChange={e => handlePaymentFieldChange('paymentDate', e.target.value)}
                                    />
                                </div>
                            </div>
                        )}

                        {paymentMethod === 'Cash' && (
                            <div style={{ animation: 'fadeIn .2s ease' }}>
                                <div style={fieldGroup}>
                                    <label style={labelStyle}>Received By *</label>
                                    <input
                                        type="text"
                                        placeholder="Name of person who received cash"
                                        style={inputStyle}
                                        value={paymentFields.receivedBy || ''}
                                        onChange={e => handlePaymentFieldChange('receivedBy', e.target.value)}
                                    />
                                </div>
                                <div style={fieldGroup}>
                                    <label style={labelStyle}>Payment Date *</label>
                                    <input
                                        type="date"
                                        style={inputStyle}
                                        value={paymentFields.paymentDate || ''}
                                        onChange={e => handlePaymentFieldChange('paymentDate', e.target.value)}
                                    />
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
                                    disabled={processing}
                                    style={{
                                        flex: 2, padding: '12px', borderRadius: 10,
                                        border: 'none', background: 'linear-gradient(135deg, #4ade80, #22c55e)',
                                        color: '#fff', fontWeight: 700, fontSize: 14,
                                        cursor: processing ? 'not-allowed' : 'pointer',
                                        opacity: processing ? 0.7 : 1, fontFamily: 'inherit',
                                        boxShadow: '0 4px 16px rgba(74, 222, 128, 0.3)'
                                    }}
                                >
                                    {processing ? '⏳ Recording...' : `✅ Confirm Payment — $${Number(invoice.grandTotal || 0).toFixed(2)}`}
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
