import React, { useState, useEffect, useContext, useMemo } from 'react';
import { UserContext } from '../../contexts/UserContext';
import { db } from '../../firebase';
import { collection, query, where, orderBy, onSnapshot } from 'firebase/firestore';
import { toast } from 'react-toastify';
import { useNavigate } from 'react-router-dom';
import StatusChip from '../ui/StatusChip';
import GuidanceText, { pendingDuration } from '../ui/GuidanceText';

const STATUS_COLORS = {
    PENDING:  { bg: 'rgba(245,158,11,0.12)', color: '#f59e0b', label: 'Pending' },
    PAID:     { bg: 'rgba(16,185,129,0.12)',  color: '#10b981', label: 'Paid' },
    OVERDUE:  { bg: 'rgba(244,63,94,0.12)',   color: '#f43f5e', label: 'Overdue' },
    PARTIAL:  { bg: 'rgba(168,85,247,0.12)',   color: '#a855f7', label: 'Partial' },
    VOIDED:   { bg: 'rgba(100,116,139,0.12)',  color: '#94a3b8', label: 'Voided' },
};

export default function VendorInvoicesPage() {
    const { vendorId } = useContext(UserContext);
    const [invoices, setInvoices] = useState([]);
    const [loading, setLoading] = useState(true);
    const [statusFilter, setStatusFilter] = useState('All');
    const navigate = useNavigate();

    useEffect(() => {
        if (!vendorId) { setLoading(false); return; }

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

    const formatCurrency = (amount) => {
        return new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' }).format(amount || 0);
    };

    const getInvoiceAmount = (inv) => {
        if (inv.commissionModel === 'VENDOR_FLAT_PERCENT') {
            return (inv.netVendorPayable || 0) + (inv.totalTaxAmount || 0);
        }
        return inv.totalVendorAmount || 0;
    };

    // ── KPI Computations ────────────────────────────────────────────────
    const kpis = useMemo(() => {
        let totalPending = 0, totalPaid = 0, totalOverdue = 0, paidThisMonth = 0;
        let lastPaidDate = null;

        const now = new Date();
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

        invoices.forEach(inv => {
            const amount = getInvoiceAmount(inv);
            const s = (inv.paymentStatus || '').toUpperCase();

            if (s === 'PAID') {
                totalPaid += amount;
                const paidAt = inv.paidAt?.toDate ? inv.paidAt.toDate() : (inv.paidAt ? new Date(inv.paidAt) : null);
                if (paidAt) {
                    if (!lastPaidDate || paidAt > lastPaidDate) lastPaidDate = paidAt;
                    if (paidAt >= monthStart) paidThisMonth += amount;
                }
            } else if (s === 'OVERDUE') {
                totalOverdue += amount;
            } else if (s === 'PENDING') {
                totalPending += amount;
            }
        });

        return { totalPending, totalPaid, totalOverdue, paidThisMonth, lastPaidDate };
    }, [invoices]);

    const filteredInvoices = invoices.filter(inv => {
        if (statusFilter === 'All') return true;
        return (inv.paymentStatus || '').toUpperCase() === statusFilter;
    });

    if (loading) {
        return <div style={{ padding: 40, textAlign: 'center', color: '#94a3b8' }}>Loading invoices...</div>;
    }

    return (
        <div style={{ padding: '24px 32px', maxWidth: 1200, margin: '0 auto', color: '#f8fafc' }}>
            {/* Header */}
            <div style={{ marginBottom: 24 }}>
                <h1 style={{ fontSize: 24, fontWeight: 700, margin: '0 0 8px 0' }}>💰 Payouts</h1>
                <p style={{ color: '#94a3b8', margin: 0, fontSize: 14 }}>Track your payout invoices, payment status, and total earnings.</p>
            </div>

            {/* Guidance */}
            {kpis.totalOverdue > 0 && (
                <GuidanceText text={`${formatCurrency(kpis.totalOverdue)} overdue — contact support if payment is delayed`} type="danger" style={{ marginBottom: 16 }} />
            )}
            {kpis.totalPending > 0 && kpis.totalOverdue === 0 && (
                <GuidanceText text={`${formatCurrency(kpis.totalPending)} pending payout — payouts are processed after order fulfillment`} type="warning" style={{ marginBottom: 16 }} />
            )}
            {invoices.length === 0 && (
                <GuidanceText text="Payouts will appear after you fulfill your first order" type="info" style={{ marginBottom: 16 }} />
            )}

            {/* KPI Cards */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginBottom: 24 }}>
                <div style={{ background: 'rgba(245,158,11,0.06)', border: '1px solid rgba(245,158,11,0.2)', borderRadius: 12, padding: '16px 18px' }}>
                    <div style={{ fontSize: 11, color: '#f59e0b', fontWeight: 700, textTransform: 'uppercase', marginBottom: 6 }}>⏳ Pending Payout</div>
                    <div style={{ fontSize: 24, fontWeight: 800, color: '#f59e0b' }}>{formatCurrency(kpis.totalPending)}</div>
                </div>
                <div style={{ background: 'rgba(16,185,129,0.06)', border: '1px solid rgba(16,185,129,0.2)', borderRadius: 12, padding: '16px 18px' }}>
                    <div style={{ fontSize: 11, color: '#10b981', fontWeight: 700, textTransform: 'uppercase', marginBottom: 6 }}>✅ Paid This Month</div>
                    <div style={{ fontSize: 24, fontWeight: 800, color: '#10b981' }}>{formatCurrency(kpis.paidThisMonth)}</div>
                </div>
                <div style={{ background: 'rgba(244,63,94,0.06)', border: '1px solid rgba(244,63,94,0.2)', borderRadius: 12, padding: '16px 18px' }}>
                    <div style={{ fontSize: 11, color: '#f43f5e', fontWeight: 700, textTransform: 'uppercase', marginBottom: 6 }}>🚨 Overdue</div>
                    <div style={{ fontSize: 24, fontWeight: 800, color: kpis.totalOverdue > 0 ? '#f43f5e' : '#475569' }}>{formatCurrency(kpis.totalOverdue)}</div>
                </div>
                <div style={{ background: 'rgba(56,189,248,0.06)', border: '1px solid rgba(56,189,248,0.2)', borderRadius: 12, padding: '16px 18px' }}>
                    <div style={{ fontSize: 11, color: '#38bdf8', fontWeight: 700, textTransform: 'uppercase', marginBottom: 6 }}>💰 Total Paid</div>
                    <div style={{ fontSize: 24, fontWeight: 800, color: '#38bdf8' }}>{formatCurrency(kpis.totalPaid)}</div>
                    {kpis.lastPaidDate && (
                        <div style={{ fontSize: 11, color: '#64748b', marginTop: 4 }}>Last: {formatDate(kpis.lastPaidDate)}</div>
                    )}
                </div>
            </div>

            {/* Status Filter */}
            <div style={{ display: 'flex', gap: 8, marginBottom: 20, alignItems: 'center' }}>
                {['All', 'PENDING', 'PAID', 'OVERDUE'].map(s => (
                    <button key={s} onClick={() => setStatusFilter(s)} style={{
                        padding: '6px 16px', borderRadius: 6,
                        border: `1px solid ${statusFilter === s ? '#38bdf8' : 'rgba(255,255,255,0.1)'}`,
                        background: statusFilter === s ? 'rgba(56,189,248,0.1)' : 'transparent',
                        color: statusFilter === s ? '#38bdf8' : '#94a3b8',
                        fontSize: 13, fontWeight: 600, cursor: 'pointer',
                    }}>{s === 'All' ? 'All' : (STATUS_COLORS[s]?.label || s)}</button>
                ))}
                <span style={{ fontSize: 13, color: '#64748b', marginLeft: 8 }}>{filteredInvoices.length} invoice{filteredInvoices.length !== 1 ? 's' : ''}</span>
            </div>

            {/* Invoice Table */}
            <div style={{ background: 'rgba(255,255,255,0.02)', borderRadius: 12, border: '1px solid rgba(255,255,255,0.06)', overflow: 'hidden' }}>
                <table className="ui-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                        <tr style={{ background: 'rgba(0,0,0,0.3)' }}>
                            <th style={{ padding: '12px 16px', color: '#94a3b8', fontWeight: 600, fontSize: 12, textTransform: 'uppercase', textAlign: 'left' }}>Invoice #</th>
                            <th style={{ padding: '12px 16px', color: '#94a3b8', fontWeight: 600, fontSize: 12, textTransform: 'uppercase', textAlign: 'left' }}>Order / Dispatch</th>
                            <th style={{ padding: '12px 16px', color: '#94a3b8', fontWeight: 600, fontSize: 12, textTransform: 'uppercase', textAlign: 'left' }}>Date</th>
                            <th style={{ padding: '12px 16px', color: '#94a3b8', fontWeight: 600, fontSize: 12, textTransform: 'uppercase', textAlign: 'right' }}>Amount</th>
                            <th style={{ padding: '12px 16px', color: '#94a3b8', fontWeight: 600, fontSize: 12, textTransform: 'uppercase', textAlign: 'center' }}>Status</th>
                            <th style={{ padding: '12px 16px', textAlign: 'right' }}></th>
                        </tr>
                    </thead>
                    <tbody>
                        {filteredInvoices.length === 0 ? (
                            <tr>
                                <td colSpan={6} style={{ padding: 48, textAlign: 'center' }}>
                                    <div style={{ fontSize: 32, marginBottom: 12 }}>💰</div>
                                    <div style={{ color: '#f8fafc', fontSize: 15, fontWeight: 600, marginBottom: 4 }}>
                                        {statusFilter === 'All' ? 'No payouts yet' : `No ${(STATUS_COLORS[statusFilter]?.label || statusFilter).toLowerCase()} payouts`}
                                    </div>
                                    <div style={{ color: '#64748b', fontSize: 13, maxWidth: 360, margin: '0 auto', lineHeight: 1.6 }}>
                                        {statusFilter === 'All'
                                            ? 'Payouts will appear after you fulfill dispatch orders. Confirm and deliver your orders to receive payouts.'
                                            : 'Try changing the filter to see other payouts.'}
                                    </div>
                                </td>
                            </tr>
                        ) : (
                            filteredInvoices.map(inv => {
                                const amount = getInvoiceAmount(inv);
                                const ps = (inv.paymentStatus || 'PENDING').toUpperCase();
                                const sc = STATUS_COLORS[ps] || STATUS_COLORS.PENDING;

                                return (
                                    <tr key={inv.id}
                                        onClick={() => navigate(`/vendor/invoices/${inv.id}`)}
                                        style={{ borderBottom: '1px solid rgba(255,255,255,0.06)', cursor: 'pointer', transition: 'background 0.2s' }}
                                        onMouseOver={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.04)'}
                                        onMouseOut={(e) => e.currentTarget.style.background = 'transparent'}
                                    >
                                        <td style={{ padding: '14px 16px', fontWeight: 600, fontFamily: 'monospace' }}>{inv.invoiceNumber}</td>
                                        <td style={{ padding: '14px 16px', fontSize: 13, color: '#94a3b8' }}>
                                            {inv.orderGroupId || inv.dispatchId || (inv.orderId ? inv.orderId.slice(-8).toUpperCase() : '—')}
                                        </td>
                                        <td style={{ padding: '14px 16px', fontSize: 14 }}>
                                            {formatDate(inv.invoiceDate || inv.createdAt)}
                                            {ps === 'PENDING' && inv.createdAt && (() => {
                                                const dur = pendingDuration(inv.createdAt);
                                                return dur ? (
                                                    <span style={{ marginLeft: 8, fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 10, background: dur.level === 'danger' ? 'rgba(244,63,94,0.12)' : dur.level === 'warning' ? 'rgba(245,158,11,0.12)' : 'rgba(56,189,248,0.08)', color: dur.level === 'danger' ? '#f43f5e' : dur.level === 'warning' ? '#f59e0b' : '#38bdf8' }}>
                                                        ⏱ {dur.text}
                                                    </span>
                                                ) : null;
                                            })()}
                                        </td>
                                        <td style={{ padding: '14px 16px', textAlign: 'right', fontWeight: 700, color: '#4ade80', fontSize: 15 }}>
                                            {formatCurrency(amount)}
                                        </td>
                                        <td style={{ padding: '14px 16px', textAlign: 'center' }}>
                                            <StatusChip status={sc.label} size="sm" />
                                        </td>
                                        <td style={{ padding: '14px 16px', textAlign: 'right' }}>
                                            <button className="ui-btn ghost" style={{ padding: '6px 12px', fontSize: 13 }}
                                                onClick={(e) => { e.stopPropagation(); navigate(`/vendor/invoices/${inv.id}`); }}>
                                                View
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
