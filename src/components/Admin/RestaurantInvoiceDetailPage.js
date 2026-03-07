import React, { useState, useEffect, useContext } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { UserContext } from '../../contexts/UserContext';
import { db, storage } from '../../firebase';
import { doc, getDoc, updateDoc, serverTimestamp } from 'firebase/firestore';
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
    const [pdfUrl, setPdfUrl] = useState(null); // Storage download URL

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

                // Check if PDF URL exists on the invoice doc (new approach)
                if (data.pdfUrl) {
                    setPdfUrl(data.pdfUrl);
                } else {
                    // Legacy fallback: check subcollection
                    try {
                        const pdfSnap = await getDoc(doc(db, 'restaurantInvoices', invoiceId, 'pdfs', 'invoice'));
                        if (pdfSnap.exists() && pdfSnap.data().pdfBase64) {
                            setPdfUrl(pdfSnap.data().pdfBase64);
                        }
                    } catch (_) { /* ignore legacy check errors */ }
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
            // Fetch restaurant info from RMS via server API
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

            // Generate PDF (returns base64 data URI)
            const base64Pdf = await generateInvoicePDF(invoice, restaurantInfo, 'restaurant');

            // Convert data URI to Blob for Storage upload
            const byteString = atob(base64Pdf.split(',')[1]);
            const mimeString = base64Pdf.split(',')[0].split(':')[1].split(';')[0];
            const ab = new ArrayBuffer(byteString.length);
            const ia = new Uint8Array(ab);
            for (let i = 0; i < byteString.length; i++) ia[i] = byteString.charCodeAt(i);
            const blob = new Blob([ab], { type: mimeString });

            // Upload to Firebase Storage
            const storageRef = ref(storage, `invoices/restaurant/${invoiceId}.pdf`);
            await uploadBytes(storageRef, blob, { contentType: 'application/pdf' });
            const downloadUrl = await getDownloadURL(storageRef);

            // Save URL reference on the invoice document
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
        // If it's a data URI (legacy), open in iframe; if it's a URL, open directly
        if (pdfUrl.startsWith('data:')) {
            const newWindow = window.open();
            newWindow.document.write(`<iframe src="${pdfUrl}" style="width:100%;height:100%;border:none;" title="Invoice PDF"></iframe>`);
            newWindow.document.title = `Invoice ${invoice?.invoiceNumber || ''}`;
        } else {
            window.open(pdfUrl, '_blank');
        }
    };

    const handleMarkPaid = async () => {
        if (!isSuperAdmin) return;
        if (!window.confirm('Mark this restaurant invoice as PAID? This action is permanent.')) return;

        setProcessing(true);
        try {
            await updateDoc(doc(db, 'restaurantInvoices', invoiceId), {
                paymentStatus: 'PAID',
                paidAt: serverTimestamp(),
                updatedAt: serverTimestamp(),
                paidByAdminName: displayName || 'Admin'
            });
            toast.success('Restaurant invoice marked as PAID.');

            setInvoice(prev => ({
                ...prev,
                paymentStatus: 'PAID',
                paidAt: new Date()
            }));
        } catch (err) {
            console.error('Failed to mark paid:', err);
            toast.error('Failed to update invoice status.');
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
                            onClick={handleMarkPaid}
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
                                            ${Number(item.price || 0).toFixed(2)}
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
        </div>
    );
}
