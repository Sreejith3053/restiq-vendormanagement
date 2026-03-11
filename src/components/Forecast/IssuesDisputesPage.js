import React, { useState, useEffect, useRef } from 'react';
import { db } from '../../firebase';
import { collection, onSnapshot, doc, updateDoc, addDoc, serverTimestamp } from 'firebase/firestore';

const ISSUE_TYPES = ['Missing Item', 'Incorrect Item', 'Damaged Item', 'Replacement Requested', 'Short Quantity', 'Wrong Pack Size'];

const STATUS_CONFIG = {
    'Open': { color: '#f43f5e', bg: 'rgba(244,63,94,0.10)', icon: '🔴' },
    'Vendor Reviewing': { color: '#fbbf24', bg: 'rgba(251,191,36,0.10)', icon: '🟡' },
    'Replacement Approved': { color: '#38bdf8', bg: 'rgba(56,189,248,0.10)', icon: '🔵' },
    'Resolved': { color: '#34d399', bg: 'rgba(52,211,153,0.10)', icon: '🟢' },
    'Closed': { color: '#64748b', bg: 'rgba(100,116,139,0.10)', icon: '⚫' },
};

const TYPE_ICON = {
    'Missing Item': '📭',
    'Incorrect Item': '❌',
    'Damaged Item': '💔',
    'Replacement Requested': '🔄',
    'Short Quantity': '📉',
    'Wrong Pack Size': '📦',
};

const ALL_STATUSES = Object.keys(STATUS_CONFIG);

function StatusBadge({ status }) {
    const cfg = STATUS_CONFIG[status] || STATUS_CONFIG['Open'];
    return (
        <span style={{ background: cfg.bg, color: cfg.color, padding: '3px 11px', borderRadius: 12, fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap' }}>
            {cfg.icon} {status}
        </span>
    );
}

function fmt(ts) {
    if (!ts) return '—';
    const d = ts?.toDate ? ts.toDate() : new Date(ts);
    return isNaN(d) ? '—' : d.toLocaleString('en-CA', { dateStyle: 'medium', timeStyle: 'short' });
}

// ── Raise Dispute Modal ────────────────────────────────────────────────────────
function RaiseDisputeModal({ onClose, onSubmit }) {
    const [form, setForm] = useState({
        issueType: ISSUE_TYPES[0],
        restaurantName: '',
        vendorName: '',
        itemName: '',
        deliveryDay: 'Monday',
        description: '',
        submittedOrderId: '',
        dispatchId: '',
    });
    const [submitting, setSubmitting] = useState(false);

    const handleSubmit = async () => {
        if (!form.restaurantName || !form.itemName || !form.description) {
            alert('Please fill in Restaurant, Item, and Description.');
            return;
        }
        setSubmitting(true);
        try {
            await onSubmit(form);
            onClose();
        } catch (e) { console.error(e); }
        setSubmitting(false);
    };

    const fieldStyle = {
        width: '100%', padding: '9px 14px', borderRadius: 8,
        background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.1)',
        color: '#f8fafc', fontSize: 13, outline: 'none', boxSizing: 'border-box',
    };

    return (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 24 }}>
            <div style={{ width: '100%', maxWidth: 540, background: '#0f172a', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 14, overflow: 'hidden' }}>
                <div style={{ padding: '16px 24px', borderBottom: '1px solid rgba(255,255,255,0.07)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700 }}>🚨 Raise Issue / Dispute</h3>
                    <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#94a3b8', fontSize: 22, cursor: 'pointer' }}>×</button>
                </div>
                <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 14 }}>
                    <div>
                        <label style={{ fontSize: 12, color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase', display: 'block', marginBottom: 6 }}>Issue Type</label>
                        <select value={form.issueType} onChange={e => setForm(f => ({ ...f, issueType: e.target.value }))} style={fieldStyle}>
                            {ISSUE_TYPES.map(t => <option key={t}>{t}</option>)}
                        </select>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                        <div>
                            <label style={{ fontSize: 12, color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase', display: 'block', marginBottom: 6 }}>Restaurant *</label>
                            <input value={form.restaurantName} onChange={e => setForm(f => ({ ...f, restaurantName: e.target.value }))} placeholder="Oruma Takeout" style={fieldStyle} />
                        </div>
                        <div>
                            <label style={{ fontSize: 12, color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase', display: 'block', marginBottom: 6 }}>Vendor</label>
                            <input value={form.vendorName} onChange={e => setForm(f => ({ ...f, vendorName: e.target.value }))} placeholder="ON Thyme" style={fieldStyle} />
                        </div>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                        <div>
                            <label style={{ fontSize: 12, color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase', display: 'block', marginBottom: 6 }}>Item Name *</label>
                            <input value={form.itemName} onChange={e => setForm(f => ({ ...f, itemName: e.target.value }))} placeholder="Onion - Cooking" style={fieldStyle} />
                        </div>
                        <div>
                            <label style={{ fontSize: 12, color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase', display: 'block', marginBottom: 6 }}>Delivery Day</label>
                            <select value={form.deliveryDay} onChange={e => setForm(f => ({ ...f, deliveryDay: e.target.value }))} style={fieldStyle}>
                                <option>Monday</option>
                                <option>Thursday</option>
                            </select>
                        </div>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                        <div>
                            <label style={{ fontSize: 12, color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase', display: 'block', marginBottom: 6 }}>Order ID (optional)</label>
                            <input value={form.submittedOrderId} onChange={e => setForm(f => ({ ...f, submittedOrderId: e.target.value }))} placeholder="sug_..." style={fieldStyle} />
                        </div>
                        <div>
                            <label style={{ fontSize: 12, color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase', display: 'block', marginBottom: 6 }}>Dispatch ID (optional)</label>
                            <input value={form.dispatchId} onChange={e => setForm(f => ({ ...f, dispatchId: e.target.value }))} placeholder="disp_..." style={fieldStyle} />
                        </div>
                    </div>
                    <div>
                        <label style={{ fontSize: 12, color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase', display: 'block', marginBottom: 6 }}>Description *</label>
                        <textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="Describe the issue clearly..." rows={3}
                            style={{ ...fieldStyle, resize: 'vertical', fontFamily: 'inherit' }} />
                    </div>
                    <div style={{ display: 'flex', gap: 12, marginTop: 4 }}>
                        <button onClick={handleSubmit} disabled={submitting}
                            style={{ flex: 1, padding: '11px 0', borderRadius: 8, background: '#f43f5e', color: '#fff', border: 'none', fontWeight: 700, fontSize: 14, cursor: 'pointer', opacity: submitting ? 0.7 : 1 }}>
                            {submitting ? 'Submitting...' : '🚨 Submit Issue'}
                        </button>
                        <button onClick={onClose}
                            style={{ padding: '11px 20px', borderRadius: 8, background: 'rgba(255,255,255,0.05)', color: '#94a3b8', border: '1px solid rgba(255,255,255,0.1)', cursor: 'pointer', fontWeight: 600 }}>
                            Cancel
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function IssuesDisputesPage() {
    const [disputes, setDisputes] = useState([]);
    const [loading, setLoading] = useState(true);
    const [activeStatus, setActiveStatus] = useState('All');
    const [activeType, setActiveType] = useState('All');
    const [search, setSearch] = useState('');
    const [showModal, setShowModal] = useState(false);
    const [updating, setUpdating] = useState(null);
    const unsubRef = useRef(null);

    useEffect(() => {
        unsubRef.current = onSnapshot(collection(db, 'issuesDisputes'), snap => {
            const docs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
            docs.sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
            setDisputes(docs);
            setLoading(false);
        }, () => setLoading(false));
        return () => unsubRef.current?.();
    }, []);

    // KPI counts
    const counts = {};
    ['All', ...ALL_STATUSES].forEach(s => {
        counts[s] = s === 'All' ? disputes.length : disputes.filter(d => d.status === s).length;
    });

    const filtered = disputes.filter(d => {
        if (activeStatus !== 'All' && d.status !== activeStatus) return false;
        if (activeType !== 'All' && d.issueType !== activeType) return false;
        if (search) {
            const q = search.toLowerCase();
            return (d.restaurantName || '').toLowerCase().includes(q)
                || (d.itemName || '').toLowerCase().includes(q)
                || (d.vendorName || '').toLowerCase().includes(q);
        }
        return true;
    });

    const advanceStatus = async (dispute) => {
        const statusOrder = ALL_STATUSES;
        const idx = statusOrder.indexOf(dispute.status);
        if (idx < 0 || idx >= statusOrder.length - 1) return;
        const nextStatus = statusOrder[idx + 1];
        setUpdating(dispute.id);
        try {
            await updateDoc(doc(db, 'issuesDisputes', dispute.id), {
                status: nextStatus,
                updatedAt: serverTimestamp(),
                ...(nextStatus === 'Resolved' ? { resolvedAt: serverTimestamp() } : {}),
                ...(nextStatus === 'Closed' ? { closedAt: serverTimestamp() } : {}),
            });
        } catch (e) { console.error(e); }
        setUpdating(null);
    };

    const handleRaiseDispute = async (form) => {
        const dispute = {
            issueType: form.issueType,
            restaurantName: form.restaurantName,
            restaurantId: form.restaurantName.toLowerCase().replace(/\s+/g, '_'),
            vendorName: form.vendorName,
            vendorId: form.vendorName.toLowerCase().replace(/\s+/g, '_'),
            itemName: form.itemName,
            itemId: form.itemName.toLowerCase().replace(/\s+/g, '_'),
            deliveryDay: form.deliveryDay,
            description: form.description,
            submittedOrderId: form.submittedOrderId || null,
            dispatchId: form.dispatchId || null,
            dispatchItemId: null,
            status: 'Open',
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
        };
        await addDoc(collection(db, 'issuesDisputes'), dispute);
    };

    return (
        <div style={{ padding: '24px 32px', maxWidth: 1400, margin: '0 auto', color: '#f8fafc', paddingBottom: 80 }}>
            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
                <div>
                    <h1 style={{ fontSize: 26, fontWeight: 700, margin: '0 0 6px 0', background: 'linear-gradient(90deg,#f8fafc,#94a3b8)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
                        Issues & Disputes
                    </h1>
                    <p style={{ color: '#94a3b8', fontSize: 14, margin: 0 }}>
                        Manage delivery disputes — missing items, damaged items, short quantities, replacements, and incorrect deliveries.
                    </p>
                </div>
                <button onClick={() => setShowModal(true)}
                    style={{ padding: '10px 20px', borderRadius: 10, background: '#f43f5e', color: '#fff', border: 'none', fontWeight: 700, fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}>
                    🚨 Raise Issue
                </button>
            </div>

            {/* Status KPI Strip */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6,1fr)', gap: 10, marginBottom: 18 }}>
                {['All', ...ALL_STATUSES].map(s => {
                    const cfg = STATUS_CONFIG[s] || {};
                    const active = activeStatus === s;
                    return (
                        <div key={s} onClick={() => setActiveStatus(s)}
                            style={{ background: active ? (cfg.bg || 'rgba(255,255,255,0.08)') : 'rgba(255,255,255,0.02)', border: `1px solid ${active ? (cfg.color || '#f8fafc') : 'rgba(255,255,255,0.06)'}`, borderRadius: 10, padding: '12px 14px', cursor: 'pointer', transition: 'all 0.2s' }}>
                            <div style={{ fontSize: 22, fontWeight: 700, color: cfg.color || '#f8fafc' }}>{counts[s] || 0}</div>
                            <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 3, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.3, lineHeight: 1.3 }}>{s}</div>
                        </div>
                    );
                })}
            </div>

            {/* Issue Type Filters */}
            <div style={{ display: 'flex', gap: 8, marginBottom: 18, flexWrap: 'wrap' }}>
                {['All', ...ISSUE_TYPES].map(t => (
                    <button key={t} onClick={() => setActiveType(t)}
                        style={{ padding: '5px 14px', borderRadius: 20, fontSize: 12, fontWeight: 600, cursor: 'pointer', border: '1px solid rgba(255,255,255,0.1)', background: activeType === t ? 'rgba(244,63,94,0.15)' : 'rgba(255,255,255,0.03)', color: activeType === t ? '#f43f5e' : '#94a3b8', transition: 'all 0.2s' }}>
                        {t !== 'All' ? TYPE_ICON[t] + ' ' : ''}{t}
                    </button>
                ))}
            </div>

            {/* Search */}
            <div style={{ marginBottom: 18 }}>
                <input placeholder="Search restaurant, item, or vendor..."
                    value={search} onChange={e => setSearch(e.target.value)}
                    style={{ padding: '8px 14px', borderRadius: 8, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: '#f8fafc', outline: 'none', fontSize: 13, width: 320 }} />
            </div>

            {/* Table */}
            <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 12, overflow: 'hidden' }}>
                {loading ? (
                    <div style={{ padding: 48, textAlign: 'center', color: '#94a3b8' }}>⏳ Loading disputes...</div>
                ) : filtered.length === 0 ? (
                    <div style={{ padding: 60, textAlign: 'center', color: '#94a3b8' }}>
                        <div style={{ fontSize: 40, marginBottom: 12 }}>✅</div>
                        <div style={{ fontSize: 15, fontWeight: 600, color: '#f8fafc', marginBottom: 6 }}>No issues found</div>
                        <div style={{ fontSize: 13 }}>
                            {activeStatus !== 'All' || activeType !== 'All' || search
                                ? 'No disputes match your current filters.'
                                : 'No issues or disputes have been raised yet. Use the "Raise Issue" button to report a problem.'}
                        </div>
                    </div>
                ) : (
                    <div style={{ overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                            <thead>
                                <tr style={{ background: 'rgba(255,255,255,0.04)', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                                    {['Issue Type', 'Restaurant', 'Vendor', 'Item', 'Day', 'Status', 'Raised At', 'Description', 'Action'].map(h => (
                                        <th key={h} style={{ padding: '12px 14px', textAlign: 'left', fontSize: 11, color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.4, whiteSpace: 'nowrap' }}>{h}</th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {filtered.map(d => {
                                    const statusIdx = ALL_STATUSES.indexOf(d.status);
                                    const canAdvance = statusIdx >= 0 && statusIdx < ALL_STATUSES.length - 1;
                                    const nextStatus = canAdvance ? ALL_STATUSES[statusIdx + 1] : null;
                                    const isUpdating = updating === d.id;

                                    return (
                                        <tr key={d.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}
                                            onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.03)'}
                                            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                                            <td style={{ padding: '13px 14px', whiteSpace: 'nowrap' }}>
                                                <span style={{ fontWeight: 700, color: '#f8fafc' }}>{TYPE_ICON[d.issueType] || '⚠️'} {d.issueType || '—'}</span>
                                            </td>
                                            <td style={{ padding: '13px 14px', fontWeight: 600, color: '#e2e8f0' }}>{d.restaurantName || '—'}</td>
                                            <td style={{ padding: '13px 14px', color: '#94a3b8' }}>{d.vendorName || '—'}</td>
                                            <td style={{ padding: '13px 14px', color: '#e2e8f0', fontWeight: 600 }}>{d.itemName || '—'}</td>
                                            <td style={{ padding: '13px 14px' }}>
                                                {d.deliveryDay
                                                    ? <span style={{ background: d.deliveryDay === 'Monday' ? 'rgba(129,140,248,0.12)' : 'rgba(167,139,250,0.12)', color: d.deliveryDay === 'Monday' ? '#818cf8' : '#a78bfa', padding: '2px 10px', borderRadius: 10, fontSize: 11, fontWeight: 700 }}>{d.deliveryDay}</span>
                                                    : '—'}
                                            </td>
                                            <td style={{ padding: '13px 14px' }}><StatusBadge status={d.status || 'Open'} /></td>
                                            <td style={{ padding: '13px 14px', color: '#94a3b8', fontSize: 12, whiteSpace: 'nowrap' }}>{fmt(d.createdAt)}</td>
                                            <td style={{ padding: '13px 14px', color: '#94a3b8', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={d.description}>{d.description || '—'}</td>
                                            <td style={{ padding: '13px 14px' }}>
                                                {canAdvance ? (
                                                    <button disabled={isUpdating} onClick={() => advanceStatus(d)}
                                                        style={{ padding: '5px 12px', borderRadius: 8, fontSize: 11, fontWeight: 700, cursor: 'pointer', background: 'rgba(52,211,153,0.1)', color: '#34d399', border: '1px solid rgba(52,211,153,0.25)', opacity: isUpdating ? 0.5 : 1, whiteSpace: 'nowrap' }}>
                                                        {isUpdating ? '...' : `→ ${nextStatus}`}
                                                    </button>
                                                ) : (
                                                    <span style={{ color: '#4ade80', fontSize: 12, fontWeight: 700 }}>✓ Closed</span>
                                                )}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {/* Raise Dispute Modal */}
            {showModal && <RaiseDisputeModal onClose={() => setShowModal(false)} onSubmit={handleRaiseDispute} />}
        </div>
    );
}
