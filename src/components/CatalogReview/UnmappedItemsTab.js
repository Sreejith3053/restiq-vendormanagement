/**
 * UnmappedItemsTab.js
 *
 * Tab content showing vendor items that lack a catalogItemId or have
 * mappingStatus = unmapped / pending_review. Allows inline mapping,
 * creating new catalog items, and sending to the review queue.
 */

import React, { useState, useEffect, useCallback, useContext } from 'react';
import { UserContext } from '../../contexts/UserContext';
import {
    getUnmappedVendorItems,
    mapUnmappedVendorItem,
    sendVendorItemToReviewQueue,
} from './reviewQueueService';
import { getSuggestedCatalogMatches } from './catalogMatchService';
import { db } from '../../firebase';
import { collection, getDocs, addDoc, serverTimestamp } from 'firebase/firestore';
import { normalizeText, normalizePackSize } from '../BulkImport/importMatching';

// ── Styles ──────────────────────────────────────────────────────────────────────

const thStyle = {
    padding: '8px 10px', textAlign: 'left', fontSize: 10, fontWeight: 700,
    color: '#475569', textTransform: 'uppercase', letterSpacing: 0.5,
    borderBottom: '1px solid rgba(255,255,255,0.06)', whiteSpace: 'nowrap',
};
const tdStyle = {
    padding: '9px 10px', fontSize: 12, borderBottom: '1px solid rgba(255,255,255,0.04)',
    verticalAlign: 'middle',
};
const btnStyle = (color) => ({
    padding: '4px 10px', borderRadius: 6, fontSize: 10, fontWeight: 600,
    background: `${color}12`, border: `1px solid ${color}30`, color,
    cursor: 'pointer', whiteSpace: 'nowrap',
});
const selectStyle = {
    padding: '7px 10px', borderRadius: 7, border: '1px solid rgba(255,255,255,0.1)',
    background: '#1e293b', color: '#94a3b8', fontSize: 12, cursor: 'pointer',
};

// ── Status badge ────────────────────────────────────────────────────────────────

function MappingBadge({ status }) {
    const colors = {
        unmapped: { label: 'Unmapped', color: '#f59e0b', bg: 'rgba(245,158,11,0.1)' },
        pending_review: { label: 'Pending Review', color: '#fbbf24', bg: 'rgba(251,191,36,0.1)' },
        mapped: { label: 'Mapped', color: '#10b981', bg: 'rgba(16,185,129,0.1)' },
    };
    const c = colors[status] || { label: status || 'Unknown', color: '#94a3b8', bg: 'rgba(148,163,184,0.1)' };
    return (
        <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 6, background: c.bg, color: c.color }}>
            {c.label}
        </span>
    );
}

// ── Main Component ──────────────────────────────────────────────────────────────

export default function UnmappedItemsTab({ vendorFilter, categoryFilter, searchFilter, onItemAction }) {
    const { currentUser } = useContext(UserContext);
    const reviewerInfo = { userId: currentUser?.uid, displayName: currentUser?.displayName || currentUser?.email || 'Admin' };

    const [items, setItems] = useState([]);
    const [catalogItems, setCatalogItems] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [actionBusy, setActionBusy] = useState(null); // itemId being processed
    const [successMsg, setSuccessMsg] = useState('');

    // Inline create form state
    const [createForItem, setCreateForItem] = useState(null);
    const [createForm, setCreateForm] = useState({ canonicalName: '', category: 'Produce', baseUnit: 'kg' });

    // Suggestions state
    const [suggestionsFor, setSuggestionsFor] = useState(null);
    const [suggestions, setSuggestions] = useState([]);
    const [suggestionsLoading, setSuggestionsLoading] = useState(false);

    // Pagination
    const PAGE_SIZE = 25;
    const [page, setPage] = useState(0);

    const load = useCallback(async () => {
        setLoading(true);
        setError('');
        try {
            const [unmapped, catSnap] = await Promise.all([
                getUnmappedVendorItems({ vendorId: vendorFilter, category: categoryFilter }),
                getDocs(collection(db, 'catalogItems')),
            ]);
            setItems(unmapped);
            setCatalogItems(catSnap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => (a.canonicalName || a.itemName || '').localeCompare(b.canonicalName || b.itemName || '')));
        } catch (e) {
            console.error('[UnmappedItemsTab]', e);
            setError('Failed to load unmapped items: ' + e.message);
        }
        setLoading(false);
    }, [vendorFilter, categoryFilter]);

    useEffect(() => { load(); }, [load]);

    // Client-side search
    const filtered = items.filter(item => {
        if (!searchFilter) return true;
        const s = searchFilter.toLowerCase();
        return (item.itemName || '').toLowerCase().includes(s) || (item.vendorName || '').toLowerCase().includes(s);
    });

    const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
    const pageItems = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

    // ── Actions ─────────────────────────────────────────────────────────────────

    const handleMapToExisting = async (item, catalogItemId) => {
        setActionBusy(item.itemId);
        try {
            await mapUnmappedVendorItem(item.vendorId, item.itemId, catalogItemId, reviewerInfo);
            setSuccessMsg(`Mapped "${item.itemName}" → catalog item`);
            setTimeout(() => setSuccessMsg(''), 3000);
            load();
            if (onItemAction) onItemAction();
        } catch (e) {
            setError('Map failed: ' + e.message);
        }
        setActionBusy(null);
    };

    const handleCreateAndMap = async (item) => {
        if (!createForm.canonicalName.trim()) { setError('Enter a canonical name'); return; }
        setActionBusy(item.itemId);
        try {
            const catalogPayload = {
                itemName: createForm.canonicalName.trim(),
                itemNameNormalized: normalizeText(createForm.canonicalName.trim()),
                canonicalName: createForm.canonicalName.trim(),
                canonicalNameNormalized: normalizeText(createForm.canonicalName.trim()),
                category: createForm.category || item.category || '',
                baseUnit: createForm.baseUnit || item.unit || '',
                orderUnit: createForm.baseUnit || item.unit || '',
                aliases: [item.itemName],
                status: 'active',
                source: 'superadmin',
                approved: true,
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp(),
                createdBy: reviewerInfo.displayName || reviewerInfo.userId,
            };
            const ref = await addDoc(collection(db, 'catalogItems'), catalogPayload);
            await mapUnmappedVendorItem(item.vendorId, item.itemId, ref.id, reviewerInfo);
            setSuccessMsg(`Created "${createForm.canonicalName}" and mapped "${item.itemName}"`);
            setCreateForItem(null);
            setTimeout(() => setSuccessMsg(''), 3000);
            load();
            if (onItemAction) onItemAction();
        } catch (e) {
            setError('Create failed: ' + e.message);
        }
        setActionBusy(null);
    };

    const handleSendToReview = async (item) => {
        setActionBusy(item.itemId);
        try {
            await sendVendorItemToReviewQueue({
                vendorId: item.vendorId,
                vendorName: item.vendorName,
                vendorItemId: item.itemId,
                item: {
                    itemName: item.itemName, name: item.itemName, category: item.category,
                    unit: item.unit, vendorPrice: item.price, packSize: item.packSize,
                    status: item.status, catalogItemId: item.catalogItemId,
                },
                issueFlags: ['unmapped_item'],
                primaryReason: 'unmapped',
                reviewedBy: reviewerInfo,
            });
            setSuccessMsg(`"${item.itemName}" sent to review queue`);
            setTimeout(() => setSuccessMsg(''), 3000);
            load();
            if (onItemAction) onItemAction();
        } catch (e) {
            setError('Send to review failed: ' + e.message);
        }
        setActionBusy(null);
    };

    const handleShowSuggestions = async (item) => {
        if (suggestionsFor === item.itemId) { setSuggestionsFor(null); return; }
        setSuggestionsFor(item.itemId);
        setSuggestionsLoading(true);
        try {
            const matches = await getSuggestedCatalogMatches(item.itemName, item.category);
            setSuggestions(matches.slice(0, 5));
        } catch (e) {
            setSuggestions([]);
        }
        setSuggestionsLoading(false);
    };

    // ── Render ──────────────────────────────────────────────────────────────────

    return (
        <div>
            {/* Feedback */}
            {error && (
                <div style={{ marginBottom: 12, padding: '8px 14px', borderRadius: 8, background: 'rgba(244,63,94,0.08)', border: '1px solid rgba(244,63,94,0.2)', color: '#f87171', fontSize: 12 }}>
                    ❌ {error}
                    <button onClick={() => setError('')} style={{ marginLeft: 12, background: 'none', border: 'none', color: '#f87171', cursor: 'pointer', fontSize: 11 }}>Dismiss</button>
                </div>
            )}
            {successMsg && (
                <div style={{ marginBottom: 12, padding: '8px 14px', borderRadius: 8, background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.2)', color: '#10b981', fontSize: 12, fontWeight: 600 }}>
                    ✅ {successMsg}
                </div>
            )}

            {/* Info bar */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <span style={{ fontSize: 12, color: '#64748b' }}>{filtered.length} unmapped vendor item{filtered.length !== 1 ? 's' : ''}</span>
                <button onClick={load} style={{ padding: '5px 12px', borderRadius: 7, border: '1px solid rgba(255,255,255,0.1)', background: 'transparent', color: '#64748b', cursor: 'pointer', fontSize: 11 }}>
                    🔄 Refresh
                </button>
            </div>

            {/* Table */}
            <div style={{ overflowX: 'auto', borderRadius: 11, border: '1px solid rgba(255,255,255,0.07)', background: 'rgba(10,18,38,0.95)' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                        <tr style={{ background: 'rgba(255,255,255,0.015)' }}>
                            <th style={{ ...thStyle, minWidth: 180 }}>Item Name</th>
                            <th style={{ ...thStyle, minWidth: 120 }}>Vendor</th>
                            <th style={thStyle}>Price</th>
                            <th style={thStyle}>Pack / Unit</th>
                            <th style={thStyle}>Category</th>
                            <th style={thStyle}>Mapping Status</th>
                            <th style={{ ...thStyle, minWidth: 280 }}>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {loading && (
                            <tr><td colSpan={7} style={{ ...tdStyle, textAlign: 'center', padding: 36, color: '#334155' }}>Loading unmapped items...</td></tr>
                        )}
                        {!loading && pageItems.length === 0 && (
                            <tr><td colSpan={7} style={{ ...tdStyle, textAlign: 'center', padding: 36, color: '#334155' }}>
                                🎉 No unmapped vendor items found!
                            </td></tr>
                        )}
                        {!loading && pageItems.map(item => {
                            const isBusy = actionBusy === item.itemId;
                            return (
                                <React.Fragment key={`${item.vendorId}-${item.itemId}`}>
                                    <tr style={{ opacity: isBusy ? 0.5 : 1, transition: 'opacity 0.2s' }}>
                                        <td style={{ ...tdStyle, fontWeight: 700, color: '#f8fafc', fontSize: 13 }}>
                                            {item.itemName}
                                        </td>
                                        <td style={{ ...tdStyle, fontWeight: 600, color: '#94a3b8', fontSize: 12 }}>
                                            {item.vendorName}
                                        </td>
                                        <td style={{ ...tdStyle, color: item.price > 0 ? '#10b981' : '#f87171', fontWeight: 700 }}>
                                            {item.price > 0 ? `$${item.price.toFixed(2)}` : '—'}
                                        </td>
                                        <td style={{ ...tdStyle, fontSize: 11, color: '#64748b' }}>
                                            {[item.packSize, item.unit].filter(Boolean).join(' · ') || '—'}
                                        </td>
                                        <td style={{ ...tdStyle, fontSize: 11, color: '#64748b' }}>
                                            {item.category || '—'}
                                        </td>
                                        <td style={tdStyle}><MappingBadge status={item.mappingStatus} /></td>
                                        <td style={tdStyle}>
                                            <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                                                {/* Map to existing — dropdown */}
                                                <select
                                                    disabled={isBusy}
                                                    onChange={e => { if (e.target.value) handleMapToExisting(item, e.target.value); e.target.value = ''; }}
                                                    defaultValue=""
                                                    style={{ ...selectStyle, fontSize: 10, padding: '4px 6px', maxWidth: 130 }}
                                                >
                                                    <option value="">Map to…</option>
                                                    {catalogItems.map(c => (
                                                        <option key={c.id} value={c.id}>{c.canonicalName || c.itemName}</option>
                                                    ))}
                                                </select>

                                                {/* Suggestions button */}
                                                <button
                                                    onClick={() => handleShowSuggestions(item)}
                                                    disabled={isBusy}
                                                    style={btnStyle('#38bdf8')}
                                                >
                                                    {suggestionsFor === item.itemId ? '▾ Hide' : '💡 Suggest'}
                                                </button>

                                                {/* Create new */}
                                                <button
                                                    onClick={() => {
                                                        setCreateForItem(createForItem === item.itemId ? null : item.itemId);
                                                        setCreateForm({ canonicalName: item.itemName, category: item.category || 'Produce', baseUnit: item.unit || 'kg' });
                                                    }}
                                                    disabled={isBusy}
                                                    style={btnStyle('#4ade80')}
                                                >
                                                    ✨ Create
                                                </button>

                                                {/* Send to review */}
                                                <button
                                                    onClick={() => handleSendToReview(item)}
                                                    disabled={isBusy}
                                                    style={btnStyle('#a78bfa')}
                                                >
                                                    📋 To Review
                                                </button>
                                            </div>
                                        </td>
                                    </tr>

                                    {/* Suggestions row */}
                                    {suggestionsFor === item.itemId && (
                                        <tr>
                                            <td colSpan={7} style={{ padding: '8px 16px 12px', background: 'rgba(56,189,248,0.03)', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                                                <div style={{ fontSize: 10, fontWeight: 700, color: '#38bdf8', marginBottom: 6 }}>
                                                    💡 Suggested Catalog Matches for "{item.itemName}"
                                                </div>
                                                {suggestionsLoading ? (
                                                    <span style={{ fontSize: 11, color: '#475569' }}>Loading...</span>
                                                ) : suggestions.length === 0 ? (
                                                    <span style={{ fontSize: 11, color: '#475569' }}>No close matches found. Consider creating a new catalog item.</span>
                                                ) : (
                                                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                                                        {suggestions.map(s => (
                                                            <button
                                                                key={s.id}
                                                                onClick={() => handleMapToExisting(item, s.id)}
                                                                disabled={isBusy}
                                                                style={{
                                                                    padding: '5px 12px', borderRadius: 7, fontSize: 11, fontWeight: 600,
                                                                    background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.2)',
                                                                    color: '#10b981', cursor: 'pointer',
                                                                }}
                                                            >
                                                                {s.canonicalName || s.itemName}
                                                                {s.confidence && <span style={{ marginLeft: 6, fontSize: 9, color: '#475569' }}>{Math.round(s.confidence * 100)}%</span>}
                                                            </button>
                                                        ))}
                                                    </div>
                                                )}
                                            </td>
                                        </tr>
                                    )}

                                    {/* Inline create form row */}
                                    {createForItem === item.itemId && (
                                        <tr>
                                            <td colSpan={7} style={{ padding: '10px 16px 14px', background: 'rgba(74,222,128,0.03)', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                                                <div style={{ fontSize: 10, fontWeight: 700, color: '#4ade80', marginBottom: 8 }}>
                                                    ✨ Create New Catalog Item & Map "{item.itemName}"
                                                </div>
                                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, maxWidth: 600 }}>
                                                    <div>
                                                        <label style={{ fontSize: 9, color: '#94a3b8', display: 'block', marginBottom: 2 }}>Canonical Name *</label>
                                                        <input
                                                            value={createForm.canonicalName}
                                                            onChange={e => setCreateForm(f => ({ ...f, canonicalName: e.target.value }))}
                                                            style={{ ...selectStyle, width: '100%', boxSizing: 'border-box' }}
                                                        />
                                                    </div>
                                                    <div>
                                                        <label style={{ fontSize: 9, color: '#94a3b8', display: 'block', marginBottom: 2 }}>Category</label>
                                                        <select
                                                            value={createForm.category}
                                                            onChange={e => setCreateForm(f => ({ ...f, category: e.target.value }))}
                                                            style={{ ...selectStyle, width: '100%', boxSizing: 'border-box' }}
                                                        >
                                                            {['Produce', 'Meat', 'Seafood', 'Dairy', 'Spices', 'Grains', 'Beverages', 'Packaging', 'Cleaning', 'Other'].map(c => (
                                                                <option key={c} value={c}>{c}</option>
                                                            ))}
                                                        </select>
                                                    </div>
                                                    <div>
                                                        <label style={{ fontSize: 9, color: '#94a3b8', display: 'block', marginBottom: 2 }}>Base Unit</label>
                                                        <select
                                                            value={createForm.baseUnit}
                                                            onChange={e => setCreateForm(f => ({ ...f, baseUnit: e.target.value }))}
                                                            style={{ ...selectStyle, width: '100%', boxSizing: 'border-box' }}
                                                        >
                                                            {['kg', 'lb', 'g', 'bag', 'bunch', 'box', 'case', 'unit', 'dozen', 'packet', 'L', 'mL'].map(u => (
                                                                <option key={u} value={u}>{u}</option>
                                                            ))}
                                                        </select>
                                                    </div>
                                                </div>
                                                <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                                                    <button
                                                        onClick={() => handleCreateAndMap(item)}
                                                        disabled={!createForm.canonicalName.trim() || isBusy}
                                                        style={{ padding: '6px 14px', borderRadius: 7, fontSize: 11, fontWeight: 700, background: '#10b981', border: 'none', color: '#fff', cursor: 'pointer' }}
                                                    >
                                                        ✨ Create & Map
                                                    </button>
                                                    <button
                                                        onClick={() => setCreateForItem(null)}
                                                        style={{ padding: '6px 14px', borderRadius: 7, fontSize: 11, background: 'transparent', border: '1px solid rgba(255,255,255,0.08)', color: '#475569', cursor: 'pointer' }}
                                                    >
                                                        Cancel
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                    )}
                                </React.Fragment>
                            );
                        })}
                    </tbody>
                </table>
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 10, fontSize: 12 }}>
                    <span style={{ color: '#64748b' }}>
                        {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, filtered.length)} of {filtered.length}
                    </span>
                    <div style={{ display: 'flex', gap: 8 }}>
                        <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}
                            style={{ padding: '3px 12px', borderRadius: 7, fontSize: 11, border: '1px solid rgba(255,255,255,0.09)', background: 'transparent', color: page === 0 ? '#1e293b' : '#64748b', cursor: page === 0 ? 'not-allowed' : 'pointer' }}>
                            ← Prev
                        </button>
                        <span style={{ color: '#64748b', lineHeight: '26px' }}>{page + 1}/{totalPages}</span>
                        <button onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1}
                            style={{ padding: '3px 12px', borderRadius: 7, fontSize: 11, border: '1px solid rgba(255,255,255,0.09)', background: 'transparent', color: page >= totalPages - 1 ? '#1e293b' : '#64748b', cursor: page >= totalPages - 1 ? 'not-allowed' : 'pointer' }}>
                            Next →
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
