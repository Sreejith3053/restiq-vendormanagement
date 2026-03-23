/**
 * FinancePage.js
 *
 * Consolidated page absorbing:
 *   - Restaurant Invoices / AdminRestaurantInvoicesPage
 *   - Vendor Invoices / AdminInvoicesPage
 *   - Commission Summary (derived from invoice data)
 *   - Payment Tracking (derived from invoice data)
 *
 * Old routes redirect here via ?tab= parameter.
 */

import React, { useMemo, useState, useEffect } from 'react';
import TabbedPageShell from './TabbedPageShell';
import KPIStatsRow from './KPIStatsRow';
import EmptyStatePanel from './EmptyStatePanel';

import AdminRestaurantInvoicesPage from '../Admin/AdminRestaurantInvoicesPage';
import AdminInvoicesPage from '../Admin/AdminInvoicesPage';

import { db } from '../../firebase';
import { collection, getDocs } from 'firebase/firestore';

// ── Commission Summary ──────────────────────────────────────────────────────
function CommissionSummaryTab({ financials }) {
    if (!financials.totalBilled) {
        return (
            <EmptyStatePanel
                icon="💵"
                title="Commission Summary"
                description="Commission data will appear here once restaurant invoices are generated. Check the Restaurant Invoices tab for current billing activity."
                actionLabel="View Restaurant Invoices"
                onAction={() => window.location.href = '/finance?tab=restaurant-invoices'}
            />
        );
    }
    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 14 }}>
                {[
                    { label: 'Total Billed', value: `$${financials.totalBilled.toFixed(2)}`, color: '#38bdf8' },
                    { label: 'Total Vendor Payout (90%)', value: `$${(financials.totalBilled * 0.9).toFixed(2)}`, color: '#fbbf24' },
                    { label: 'Platform Commission (10%)', value: `$${(financials.totalBilled * 0.1).toFixed(2)}`, color: '#34d399' },
                ].map(k => (
                    <div key={k.label} style={{ background: k.color + '08', border: `1px solid ${k.color}22`, borderRadius: 10, padding: 18, textAlign: 'center' }}>
                        <div style={{ fontSize: 24, fontWeight: 700, color: k.color, marginBottom: 4 }}>{k.value}</div>
                        <div style={{ fontSize: 11, color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase' }}>{k.label}</div>
                    </div>
                ))}
            </div>
            <div style={{ background: 'rgba(56,189,248,0.06)', border: '1px solid rgba(56,189,248,0.1)', borderRadius: 8, padding: '10px 16px', fontSize: 12, color: '#64748b' }}>
                💡 Commission rate is 10% of total restaurant billing. Vendor payout is 90%. These values are calculated from all generated invoices.
            </div>
        </div>
    );
}

// ── Payment Tracking ──────────────────────────────────────────────────────
function PaymentTrackingTab({ financials }) {
    if (!financials.totalInvoices) {
        return (
            <EmptyStatePanel
                icon="📊"
                title="Payment Tracking"
                description="Payment status data will appear here once invoices have been generated and payment statuses are recorded."
            />
        );
    }
    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 14 }}>
                {[
                    { label: 'Total Invoices', value: financials.totalInvoices, color: '#38bdf8' },
                    { label: 'Paid', value: financials.paid, color: '#34d399' },
                    { label: 'Pending', value: financials.pending, color: '#fbbf24' },
                    { label: 'Overdue', value: financials.overdue, color: '#f43f5e' },
                ].map(k => (
                    <div key={k.label} style={{ background: k.color + '08', border: `1px solid ${k.color}22`, borderRadius: 10, padding: 18, textAlign: 'center' }}>
                        <div style={{ fontSize: 24, fontWeight: 700, color: k.color, marginBottom: 4 }}>{k.value}</div>
                        <div style={{ fontSize: 11, color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase' }}>{k.label}</div>
                    </div>
                ))}
            </div>
        </div>
    );
}

export default function FinancePage() {
    const [financials, setFinancials] = useState({
        totalBilled: 0, vendorPayout: 0, commission: 0,
        totalInvoices: 0, paid: 0, pending: 0, overdue: 0,
    });

    useEffect(() => {
        (async () => {
            try {
                // ── Restaurant invoices → totalBilled + payment status ────────
                // Field name confirmed from Firestore: `grandTotal`
                const [restSnap, vendorInvSnap] = await Promise.all([
                    getDocs(collection(db, 'restaurantInvoices')),
                    getDocs(collection(db, 'vendorInvoices')),
                ]);

                let totalBilled = 0, paid = 0, pending = 0, overdue = 0;
                restSnap.docs.forEach(d => {
                    const data = d.data();
                    // grandTotal is the canonical field; fall back to alternatives defensively
                    const amt = parseFloat(
                        data.grandTotal ?? data.totalAmount ?? data.total ?? data.amount ?? 0
                    );
                    totalBilled += isNaN(amt) ? 0 : amt;

                    const status = (data.paymentStatus || data.status || '').toLowerCase();
                    if (status === 'paid') paid++;
                    else if (status === 'overdue') overdue++;
                    else pending++;
                });

                // ── Vendor invoices → actual payout + commission ──────────────
                let vendorPayout = 0, commission = 0;
                vendorInvSnap.docs.forEach(d => {
                    const data = d.data();
                    vendorPayout += parseFloat(data.netVendorPayable   ?? data.vendorPayout    ?? 0) || 0;
                    commission   += parseFloat(data.commissionAmount    ?? data.commission      ?? 0) || 0;
                });

                // If vendorInvoices are empty, derive from restaurantInvoices (10% platform fee)
                if (vendorPayout === 0 && totalBilled > 0) vendorPayout = totalBilled * 0.9;
                if (commission   === 0 && totalBilled > 0) commission   = totalBilled * 0.1;

                setFinancials({
                    totalBilled, vendorPayout, commission,
                    totalInvoices: restSnap.size,
                    paid, pending, overdue,
                });
            } catch (err) {
                console.error('[FinanceKPI] Failed:', err);
            }
        })();
    }, []);

    const kpiStats = useMemo(() => [
        { label: 'Total Billed',       value: `$${financials.totalBilled.toFixed(2)}`,  icon: '🧾', color: '#38bdf8' },
        { label: 'Vendor Payout',      value: `$${financials.vendorPayout.toFixed(2)}`, icon: '💰', color: '#fbbf24' },
        { label: 'Platform Commission',value: `$${financials.commission.toFixed(2)}`,   icon: '💵', color: '#34d399' },
        { label: 'Pending Payments',   value: financials.pending, icon: '⏳', color: financials.pending > 0 ? '#f59e0b' : '#10b981' },
    ], [financials]);

    const tabs = useMemo(() => [
        {
            key: 'restaurant-invoices',
            label: 'Restaurant Invoices',
            icon: '🧾',
            content: <AdminRestaurantInvoicesPage embedded />,
        },
        {
            key: 'vendor-invoices',
            label: 'Vendor Invoices',
            icon: '🧾',
            content: <AdminInvoicesPage embedded />,
        },
        {
            key: 'commission',
            label: 'Commission Summary',
            icon: '💵',
            content: <CommissionSummaryTab financials={financials} />,
        },
        {
            key: 'payments',
            label: 'Payment Tracking',
            icon: '📊',
            content: <PaymentTrackingTab financials={financials} />,
        },
    ], [financials]);

    return (
        <TabbedPageShell
            title="Finance"
            subtitle="Restaurant invoices, vendor invoices, commissions, and payment tracking."
            icon="💰"
            tabs={tabs}
            defaultTab="restaurant-invoices"
            kpiRow={<KPIStatsRow stats={kpiStats} />}
        />
    );
}
