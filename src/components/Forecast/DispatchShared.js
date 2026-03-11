import React, { useState, useEffect, useRef } from 'react';
import { db } from '../../firebase';
import { collection, onSnapshot, addDoc, serverTimestamp } from 'firebase/firestore';

// ── Shared route-day badge ────────────────────────────────────────────────────
export function RouteDayBadge({ routeDay, size = 'normal' }) {
    const isMonday = routeDay === 'Monday';
    const pad = size === 'small' ? '2px 9px' : '3px 11px';
    return (
        <span style={{
            background: isMonday ? 'rgba(129,140,248,0.13)' : 'rgba(167,139,250,0.13)',
            color: isMonday ? '#818cf8' : '#a78bfa',
            padding: pad, borderRadius: 12, fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap',
        }}>
            {isMonday ? '📅 Monday' : '📅 Thursday'}
        </span>
    );
}

// ── Inline Raise Issue modal (reused across pages) ────────────────────────────
export function RaiseIssueModal({ defaults = {}, onClose }) {
    const ISSUE_TYPES = ['Missing Item', 'Incorrect Item', 'Damaged Item', 'Replacement Requested', 'Short Quantity', 'Wrong Pack Size'];
    const [form, setForm] = useState({
        issueType: ISSUE_TYPES[0],
        restaurantName: defaults.restaurantName || '',
        vendorName: defaults.vendorName || '',
        itemName: defaults.itemName || '',
        deliveryDay: defaults.routeDay || 'Monday',
        description: '',
        submittedOrderId: defaults.submittedOrderId || '',
        dispatchId: defaults.dispatchId || '',
        vendorId: defaults.vendorId || '',
        restaurantId: defaults.restaurantId || '',
    });
    const [submitting, setSubmitting] = useState(false);

    const fs = {
        width: '100%', padding: '8px 12px', borderRadius: 7,
        background: 'rgba(0,0,0,0.35)', border: '1px solid rgba(255,255,255,0.1)',
        color: '#f8fafc', fontSize: 13, outline: 'none', boxSizing: 'border-box',
    };

    const handleSubmit = async () => {
        if (!form.itemName || !form.description) { alert('Item and description are required.'); return; }
        setSubmitting(true);
        try {
            await addDoc(collection(db, 'issuesDisputes'), {
                ...form,
                status: 'Open',
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp(),
            });
            onClose();
        } catch (e) { console.error(e); }
        setSubmitting(false);
    };

    return (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2000, padding: 24 }}>
            <div style={{ width: '100%', maxWidth: 500, background: '#0f172a', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 14, overflow: 'hidden' }}>
                <div style={{ padding: '14px 22px', borderBottom: '1px solid rgba(255,255,255,0.07)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>🚨 Raise Dispute / Issue</h3>
                    <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#94a3b8', fontSize: 22, cursor: 'pointer', lineHeight: 1 }}>×</button>
                </div>
                <div style={{ padding: '18px 22px', display: 'flex', flexDirection: 'column', gap: 12 }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                        <div>
                            <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 4, fontWeight: 600, textTransform: 'uppercase' }}>Issue Type</div>
                            <select value={form.issueType} onChange={e => setForm(f => ({ ...f, issueType: e.target.value }))} style={fs}>
                                {ISSUE_TYPES.map(t => <option key={t}>{t}</option>)}
                            </select>
                        </div>
                        <div>
                            <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 4, fontWeight: 600, textTransform: 'uppercase' }}>Route Day</div>
                            <select value={form.deliveryDay} onChange={e => setForm(f => ({ ...f, deliveryDay: e.target.value }))} style={fs}>
                                <option>Monday</option><option>Thursday</option>
                            </select>
                        </div>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                        <div>
                            <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 4, fontWeight: 600, textTransform: 'uppercase' }}>Vendor</div>
                            <input value={form.vendorName} onChange={e => setForm(f => ({ ...f, vendorName: e.target.value }))} style={fs} placeholder="Vendor name" />
                        </div>
                        <div>
                            <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 4, fontWeight: 600, textTransform: 'uppercase' }}>Restaurant</div>
                            <input value={form.restaurantName} onChange={e => setForm(f => ({ ...f, restaurantName: e.target.value }))} style={fs} placeholder="Restaurant name" />
                        </div>
                    </div>
                    <div>
                        <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 4, fontWeight: 600, textTransform: 'uppercase' }}>Item Name *</div>
                        <input value={form.itemName} onChange={e => setForm(f => ({ ...f, itemName: e.target.value }))} style={fs} placeholder="Affected item" />
                    </div>
                    {(defaults.dispatchId) && (
                        <div style={{ background: 'rgba(56,189,248,0.06)', border: '1px solid rgba(56,189,248,0.12)', borderRadius: 7, padding: '8px 12px', fontSize: 12, color: '#94a3b8' }}>
                            📋 Pre-filled Dispatch ID: <code style={{ color: '#38bdf8' }}>{defaults.dispatchId}</code>
                        </div>
                    )}
                    <div>
                        <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 4, fontWeight: 600, textTransform: 'uppercase' }}>Description *</div>
                        <textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} rows={3} placeholder="Describe what went wrong..." style={{ ...fs, resize: 'vertical', fontFamily: 'inherit' }} />
                    </div>
                    <div style={{ display: 'flex', gap: 10 }}>
                        <button onClick={handleSubmit} disabled={submitting}
                            style={{ flex: 1, padding: '10px 0', background: '#f43f5e', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 700, fontSize: 14, cursor: 'pointer', opacity: submitting ? 0.7 : 1 }}>
                            {submitting ? 'Submitting...' : '🚨 Log Issue'}
                        </button>
                        <button onClick={onClose} style={{ padding: '10px 18px', background: 'rgba(255,255,255,0.05)', color: '#94a3b8', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, cursor: 'pointer', fontWeight: 600 }}>
                            Cancel
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
