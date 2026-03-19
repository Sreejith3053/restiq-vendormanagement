/**
 * VendorNotificationCenter.js
 * 
 * In-app notification feed for vendor events:
 * dispatch requests, invoice generated, import results, issue raised, etc.
 * Reads from vendorNotifications/{vendorId}/notifications subcollection.
 * Falls back to computed notifications from existing data if no stored notifications exist.
 */
import React, { useState, useEffect, useContext, useMemo } from 'react';
import { UserContext } from '../../contexts/UserContext';
import { db } from '../../firebase';
import { collection, query, where, onSnapshot, orderBy, getDocs, limit } from 'firebase/firestore';
import { useNavigate } from 'react-router-dom';

const NOTIF_TYPES = {
    dispatch_new:      { icon: '📩', color: '#38bdf8', label: 'New Dispatch Request' },
    dispatch_updated:  { icon: '🔄', color: '#a855f7', label: 'Dispatch Updated' },
    issue_raised:      { icon: '🚨', color: '#f43f5e', label: 'Issue Raised' },
    invoice_generated: { icon: '💳', color: '#10b981', label: 'Invoice Generated' },
    payout_completed:  { icon: '💰', color: '#4ade80', label: 'Payout Completed' },
    import_failed:     { icon: '❌', color: '#f87171', label: 'Import Failed' },
    import_success:    { icon: '✅', color: '#10b981', label: 'Import Completed' },
    item_review:       { icon: '📋', color: '#f59e0b', label: 'Item Needs Review' },
    stale_price:       { icon: '⏰', color: '#fbbf24', label: 'Stale Price Alert' },
    capacity_gap:      { icon: '🛡️', color: '#e879f9', label: 'Capacity Below Forecast' },
};

export default function VendorNotificationCenter() {
    const { vendorId } = useContext(UserContext);
    const [notifications, setNotifications] = useState([]);
    const [loading, setLoading] = useState(true);
    const navigate = useNavigate();

    useEffect(() => {
        if (!vendorId) { setLoading(false); return; }

        // Build computed notifications from existing data
        let active = true;
        const computeNotifications = async () => {
            const notifs = [];
            const now = new Date();

            // 1. Pending dispatches
            try {
                const dq = query(collection(db, 'vendorDispatches'), where('vendorId', '==', vendorId), where('status', '==', 'Sent'));
                const dSnap = await getDocs(dq);
                dSnap.docs.forEach(d => {
                    const data = d.data();
                    notifs.push({
                        id: 'dispatch_' + d.id,
                        type: 'dispatch_new',
                        title: 'New dispatch request awaiting review',
                        description: `Restaurant: ${data.restaurantName || 'Unknown'} • Week: ${data.weekStart || ''}`,
                        timestamp: data.sentAt || data.createdAt,
                        link: `/dispatch-requests/${d.id}`,
                        read: false,
                    });
                });
            } catch (_) {}

            // 2. Open issues
            try {
                const iq = query(collection(db, 'issuesDisputes'), where('vendorId', '==', vendorId), where('status', '==', 'open'));
                const iSnap = await getDocs(iq);
                iSnap.docs.forEach(d => {
                    const data = d.data();
                    notifs.push({
                        id: 'issue_' + d.id,
                        type: 'issue_raised',
                        title: `Issue raised: ${data.issueType || 'Unknown'}`,
                        description: data.description || data.itemName || '',
                        timestamp: data.createdAt,
                        link: '/vendor/issues',
                        read: false,
                    });
                });
            } catch (_) {}

            // 3. Recent invoices (last 7 days)
            try {
                const invQ = query(collection(db, 'vendorInvoices'), where('vendorId', '==', vendorId), orderBy('createdAt', 'desc'), limit(5));
                const invSnap = await getDocs(invQ);
                invSnap.docs.forEach(d => {
                    const data = d.data();
                    const createdMs = data.createdAt?.toDate ? data.createdAt.toDate().getTime() : 0;
                    if (now.getTime() - createdMs < 7 * 24 * 60 * 60 * 1000) {
                        notifs.push({
                            id: 'invoice_' + d.id,
                            type: data.paymentStatus === 'PAID' ? 'payout_completed' : 'invoice_generated',
                            title: data.paymentStatus === 'PAID' ? 'Payout completed' : 'Invoice generated',
                            description: `Invoice #${data.invoiceNumber} — $${Number(data.totalVendorAmount || 0).toFixed(2)}`,
                            timestamp: data.createdAt,
                            link: `/vendor/invoices/${d.id}`,
                            read: true,
                        });
                    }
                });
            } catch (_) {}

            // 4. Stale items (items not updated in 30+ days)
            try {
                const itemSnap = await getDocs(collection(db, `vendors/${vendorId}/items`));
                let staleCount = 0;
                itemSnap.docs.forEach(d => {
                    const data = d.data();
                    const updMs = data.updatedAt?.toMillis?.() || (data.updatedAt?.seconds ? data.updatedAt.seconds * 1000 : 0);
                    if (updMs > 0 && (now.getTime() - updMs) > 30 * 24 * 60 * 60 * 1000) staleCount++;
                });
                if (staleCount > 0) {
                    notifs.push({
                        id: 'stale_prices',
                        type: 'stale_price',
                        title: `${staleCount} items have stale pricing`,
                        description: 'Prices not updated in 30+ days. Update to maintain competitiveness.',
                        timestamp: null,
                        link: '/items',
                        read: false,
                    });
                }
            } catch (_) {}

            // Sort by timestamp (most recent first), unread first
            notifs.sort((a, b) => {
                if (a.read !== b.read) return a.read ? 1 : -1;
                const ta = a.timestamp?.toDate ? a.timestamp.toDate().getTime() : (a.timestamp ? new Date(a.timestamp).getTime() : 0);
                const tb = b.timestamp?.toDate ? b.timestamp.toDate().getTime() : (b.timestamp ? new Date(b.timestamp).getTime() : 0);
                return tb - ta;
            });

            if (active) {
                setNotifications(notifs);
                setLoading(false);
            }
        };

        computeNotifications();
        return () => { active = false; };
    }, [vendorId]);

    const formatAge = (ts) => {
        if (!ts) return '';
        const d = ts.toDate ? ts.toDate() : new Date(ts);
        const sec = Math.floor((Date.now() - d.getTime()) / 1000);
        if (sec < 60) return 'just now';
        if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
        if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
        return `${Math.floor(sec / 86400)}d ago`;
    };

    const unreadCount = notifications.filter(n => !n.read).length;

    return (
        <div style={{ padding: '24px 32px', maxWidth: 900, margin: '0 auto', color: '#f8fafc' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
                <div>
                    <h1 style={{ fontSize: 24, fontWeight: 700, margin: '0 0 8px' }}>🔔 Notifications</h1>
                    <p style={{ color: '#94a3b8', fontSize: 14, margin: 0 }}>Stay updated on dispatches, issues, invoices, and actions needed.</p>
                </div>
                {unreadCount > 0 && (
                    <div style={{ background: 'rgba(244,63,94,0.12)', color: '#f43f5e', padding: '6px 14px', borderRadius: 8, fontSize: 13, fontWeight: 700 }}>
                        {unreadCount} new
                    </div>
                )}
            </div>

            {loading ? (
                <div style={{ textAlign: 'center', padding: 60, color: '#94a3b8' }}>Loading notifications...</div>
            ) : notifications.length === 0 ? (
                <div style={{ textAlign: 'center', padding: 60 }}>
                    <div style={{ fontSize: 40, marginBottom: 12 }}>✅</div>
                    <div style={{ color: '#94a3b8', fontSize: 16, fontWeight: 600, marginBottom: 4 }}>All caught up!</div>
                    <div style={{ color: '#64748b', fontSize: 14 }}>No pending notifications. Check back later.</div>
                </div>
            ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {notifications.map(n => {
                        const nt = NOTIF_TYPES[n.type] || { icon: '📌', color: '#94a3b8', label: 'Notification' };
                        return (
                            <div key={n.id}
                                onClick={() => n.link && navigate(n.link)}
                                style={{
                                    display: 'flex', gap: 14, padding: '14px 18px',
                                    background: n.read ? 'rgba(255,255,255,0.02)' : 'rgba(56,189,248,0.04)',
                                    border: `1px solid ${n.read ? 'rgba(255,255,255,0.06)' : 'rgba(56,189,248,0.15)'}`,
                                    borderRadius: 10, cursor: n.link ? 'pointer' : 'default',
                                    transition: 'background 0.2s',
                                }}
                                onMouseOver={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.05)'}
                                onMouseOut={(e) => e.currentTarget.style.background = n.read ? 'rgba(255,255,255,0.02)' : 'rgba(56,189,248,0.04)'}
                            >
                                <div style={{ fontSize: 24, flexShrink: 0, paddingTop: 2 }}>{nt.icon}</div>
                                <div style={{ flex: 1 }}>
                                    <div style={{ fontWeight: 600, fontSize: 14, color: n.read ? '#94a3b8' : '#f8fafc', marginBottom: 2 }}>{n.title}</div>
                                    {n.description && <div style={{ fontSize: 13, color: '#64748b' }}>{n.description}</div>}
                                </div>
                                <div style={{ fontSize: 12, color: '#475569', whiteSpace: 'nowrap', paddingTop: 2 }}>
                                    {formatAge(n.timestamp)}
                                </div>
                                {!n.read && <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#38bdf8', flexShrink: 0, marginTop: 6 }} />}
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
