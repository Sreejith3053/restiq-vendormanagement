import React, { useState, useEffect, useContext } from 'react';
import { UserContext } from '../../contexts/UserContext';
import { db } from '../../firebase';
import { collection, query, where, orderBy, onSnapshot } from 'firebase/firestore';
import { toast } from 'react-toastify';
import { useNavigate } from 'react-router-dom';

export default function VendorInvoicesPage() {
    const { vendorId } = useContext(UserContext);
    const [invoices, setInvoices] = useState([]);
    const [loading, setLoading] = useState(true);
    const navigate = useNavigate();

    useEffect(() => {
        if (!vendorId) {
            setLoading(false);
            return;
        }

        const q = query(
            collection(db, 'vendorInvoices'),
            where('vendorId', '==', vendorId),
            orderBy('createdAt', 'desc')
        );

        const unsubscribe = onSnapshot(q, (snapshot) => {
            setInvoices(snapshot.docs.map(d => ({ id: d.id, ...d.data() })));
            setLoading(false);
        }, (err) => {
            console.error('Error fetching vendor invoices:', err);
            toast.error('Failed to load invoices.');
            setLoading(false);
        });

        return () => unsubscribe();
    }, [vendorId]);

    const formatDate = (timestamp) => {
        if (!timestamp) return 'N/A';
        const d = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
        return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    };

    if (loading) {
        return <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>Loading invoices...</div>;
    }

    return (
        <div>
            <div className="page-header">
                <div>
                    <h2>My Invoices</h2>
                    <div style={{ color: 'var(--muted)', fontSize: 13, marginTop: 4 }}>
                        View your generated payout invoices automatically tied to fulfilled orders.
                    </div>
                </div>
            </div>

            <div className="ui-table-wrap">
                <table className="ui-table">
                    <thead>
                        <tr>
                            <th>Invoice #</th>
                            <th>Order ID</th>
                            <th>Date generated</th>
                            <th>Total Amount</th>
                            <th>Payment Status</th>
                            <th style={{ textAlign: 'right' }}>Action</th>
                        </tr>
                    </thead>
                    <tbody>
                        {invoices.length === 0 ? (
                            <tr><td colSpan="6" style={{ textAlign: 'center', color: 'var(--muted)', padding: 24 }}>No invoices found. Check back once orders are accepted.</td></tr>
                        ) : (
                            invoices.map(inv => {
                                const isPending = inv.paymentStatus === 'PENDING';
                                return (
                                    <tr key={inv.id} className="is-row" onClick={() => navigate(`/vendor/invoices/${inv.id}`)} style={{ cursor: 'pointer' }}>
                                        <td style={{ fontWeight: 600 }}>{inv.invoiceNumber}</td>
                                        <td style={{ fontSize: 13, color: 'var(--muted)' }}>{inv.orderId.slice(-8).toUpperCase()}</td>
                                        <td>{formatDate(inv.invoiceDate)}</td>
                                        <td style={{ fontWeight: 600, color: '#4ade80' }}>
                                            ${inv.commissionModel === 'VENDOR_FLAT_PERCENT'
                                                ? Number((inv.netVendorPayable || 0) + (inv.totalTaxAmount || 0)).toFixed(2)
                                                : Number(inv.totalVendorAmount || 0).toFixed(2)}
                                        </td>
                                        <td>
                                            <span className={`badge ${isPending ? 'amber' : 'green'}`}>
                                                {inv.paymentStatus}
                                            </span>
                                        </td>
                                        <td style={{ textAlign: 'right' }}>
                                            <button
                                                className="ui-btn small ghost"
                                                onClick={(e) => { e.stopPropagation(); navigate(`/vendor/invoices/${inv.id}`); }}
                                            >
                                                View Details
                                            </button>
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
