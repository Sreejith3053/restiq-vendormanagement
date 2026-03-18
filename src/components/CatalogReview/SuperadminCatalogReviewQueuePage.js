/**
 * SuperadminCatalogReviewQueuePage.js
 *
 * Main superadmin page for reviewing vendor import catalog items.
 *
 * Layout:
 *   - Top summary cards (pending by type, held, approved/rejected today)
 *   - Filters bar (type, status, vendor, search)
 *   - Items table with bulk select, pagination
 *   - Review modal on row click
 *   - Bulk actions bar when rows selected
 */

import React, { useState, useEffect, useContext, useCallback } from 'react';
import { UserContext } from '../../contexts/UserContext';
import ReviewSummaryCards from './ReviewSummaryCards';
import BulkReviewActionsBar from './BulkReviewActionsBar';
import SuperadminReviewItemModal from './SuperadminReviewItemModal';
import {
    getPendingCatalogReviewItems,
    getReviewQueueSummary,
    bulkHoldReviewItems,
    bulkRejectReviewItems,
    holdCatalogReviewItem,
    rejectCatalogReviewItem,
    revertCatalogMapping,
} from './reviewQueueService';

// ── Config ─────────────────────────────────────────────────────────────────────

const PAGE_SIZE = 25;

const STATUS_OPTIONS = [
    { value: '',          label: 'Pending + Held' },
    { value: 'pending',   label: 'Pending' },
    { value: 'held',      label: 'Held' },
    { value: 'approved',  label: 'Approved' },
    { value: 'rejected',  label: 'Rejected' },
    { value: 'merged',    label: 'Merged' },
];

const TYPE_OPTIONS = [
    { value: '',                   label: 'All Types' },
    { value: 'new_item',           label: '✨ New Item' },
    { value: 'possible_duplicate', label: '⚠️ Possible Duplicate' },
    { value: 'high_risk_update',   label: '🚨 High Risk Update' },
    { value: 'mapping_review',     label: '🔗 Mapping Review' },
    { value: 'needs_review',       label: '🔍 Needs Review' },
];

const TYPE_CONFIG = {
    new_item:           { label: 'New Item',          color: '#4ade80', emoji: '✨' },
    possible_duplicate: { label: 'Possible Dup.',     color: '#fb923c', emoji: '⚠️' },
    high_risk_update:   { label: 'High Risk',         color: '#f97316', emoji: '🚨' },
    mapping_review:     { label: 'Mapping Review',    color: '#a78bfa', emoji: '🔗' },
    needs_review:       { label: 'Needs Review',      color: '#38bdf8', emoji: '🔍' },
};

const STATUS_CONFIG = {
    pending:  { label: 'Pending',  color: '#fbbf24', bg: 'rgba(251,191,36,0.1)' },
    held:     { label: 'Held',     color: '#fb923c', bg: 'rgba(251,146,60,0.1)' },
    approved: { label: 'Approved', color: '#4ade80', bg: 'rgba(74,222,128,0.1)' },
    rejected: { label: 'Rejected', color: '#f43f5e', bg: 'rgba(244,63,94,0.1)' },
    merged:   { label: 'Merged',   color: '#a78bfa', bg: 'rgba(167,139,250,0.1)' },
};

// ── Helpers ─────────────────────────────────────────────────────────────────────

function fmt(ts) {
    if (!ts) return '—';
    try {
        const d = ts.toDate ? ts.toDate() : new Date(ts);
        return d.toLocaleDateString('en-CA', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    } catch { return '—'; }
}

function TypeBadge({ type }) {
    const c = TYPE_CONFIG[type] || { label: type, color: '#94a3b8', emoji: '?' };
    return (
        <span style={{ fontSize: 10, fontWeight: 700, color: c.color, whiteSpace: 'nowrap' }}>
            {c.emoji} {c.label}
        </span>
    );
}

function StatusBadge({ status }) {
    const c = STATUS_CONFIG[status] || { label: status, color: '#64748b', bg: 'rgba(100,116,139,0.1)' };
    return (
        <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 6, background: c.bg, color: c.color }}>
            {c.label}
        </span>
    );
}

// ── Main Page ──────────────────────────────────────────────────────────────────

export default function SuperadminCatalogReviewQueuePage() {
    const { currentUser } = useContext(UserContext);
    const reviewerInfo = { userId: currentUser?.uid, displayName: currentUser?.displayName || currentUser?.email || 'Admin' };

    // Data
    const [items,   setItems]   = useState([]);
    const [summary, setSummary] = useState({});
    const [loading, setLoading] = useState(true);
    const [error,   setError]   = useState('');

    // Filters
    const [filterType,   setFilterType]   = useState('');
    const [filterStatus, setFilterStatus] = useState('');
    const [filterSearch, setFilterSearch] = useState('');
    const [page,         setPage]         = useState(0);

    // Selection
    const [selectedIds, setSelectedIds] = useState([]);

    // Modal
    const [reviewItem, setReviewItem] = useState(null);

    // Load data
    const load = useCallback(async () => {
        setLoading(true);
        setError('');
        try {
            const [fetchedItems, fetchedSummary] = await Promise.all([
                getPendingCatalogReviewItems({
                    status:     filterStatus || undefined,
                    reviewType: filterType   || undefined,
                    pageSize:   200,
                }),
                getReviewQueueSummary(),
            ]);
            setItems(fetchedItems);
            setSummary(fetchedSummary);
        } catch (e) {
            console.error('[ReviewQueue]', e);
            setError('Failed to load review queue. ' + e.message);
        }
        setLoading(false);
    }, [filterType, filterStatus]);

    useEffect(() => { load(); }, [load]);

    // Client-side search filter
    const filtered = items.filter(item => {
        if (!filterSearch) return true;
        const s = filterSearch.toLowerCase();
        return (
            (item.proposedData?.itemName || '').toLowerCase().includes(s) ||
            (item.vendorName || '').toLowerCase().includes(s)
        );
    });

    const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
    const pageItems  = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

    // Selection
    const toggleSelect = (id) => setSelectedIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
    const toggleSelectAll = () => {
        if (selectedIds.length === pageItems.length) setSelectedIds([]);
        else setSelectedIds(pageItems.map(i => i.id));
    };

    // Quick actions
    const quickHold = async (id) => {
        await holdCatalogReviewItem(id, 'Quick hold by admin', reviewerInfo);
        load();
    };
    const quickReject = async (id, reason = 'Rejected via quick action') => {
        await rejectCatalogReviewItem(id, reason, reviewerInfo);
        load();
    };
    const quickRevert = async (id) => {
        if (!window.confirm('Revert this mapping? This will clear the catalogItemId from the vendor item and reset the review to Pending.')) return;
        try {
            await revertCatalogMapping(id, 'Reverted by admin', reviewerInfo);
            load();
        } catch (e) {
            setError('Revert failed: ' + e.message);
        }
    };

    // Bulk actions
    const handleBulkHold = async (ids, notes) => {
        await bulkHoldReviewItems(ids, notes, reviewerInfo);
        setSelectedIds([]);
        load();
    };
    const handleBulkReject = async (ids, reason) => {
        await bulkRejectReviewItems(ids, reason, reviewerInfo);
        setSelectedIds([]);
        load();
    };

    // Table styles
    const thStyle = { padding: '8px 10px', textAlign: 'left', fontSize: 10, fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: 0.5, borderBottom: '1px solid rgba(255,255,255,0.06)', whiteSpace: 'nowrap' };
    const tdStyle = { padding: '9px 10px', fontSize: 12, borderBottom: '1px solid rgba(255,255,255,0.04)', verticalAlign: 'middle' };

    return (
        <div style={{ padding: '28px 32px', maxWidth: 1400, margin: '0 auto' }}>
            {/* Page header */}
            <div style={{ marginBottom: 24 }}>
                <h1 style={{ fontSize: 24, fontWeight: 800, color: '#f8fafc', margin: 0 }}>🗂️ Catalog Review Queue</h1>
                <div style={{ fontSize: 13, color: '#475569', marginTop: 4 }}>
                    Review vendor import items before they reach the master catalog.
                </div>
            </div>

            {/* Error */}
            {error && (
                <div style={{ marginBottom: 16, padding: '10px 16px', borderRadius: 8, background: 'rgba(244,63,94,0.08)', border: '1px solid rgba(244,63,94,0.2)', color: '#f87171', fontSize: 13 }}>
                    ❌ {error}
                </div>
            )}

            {/* Summary cards */}
            <ReviewSummaryCards summary={summary} loading={loading} />

            {/* Filters */}
            <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
                <select
                    value={filterType}
                    onChange={e => { setFilterType(e.target.value); setPage(0); }}
                    style={selectStyle}
                >
                    {TYPE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>

                <select
                    value={filterStatus}
                    onChange={e => { setFilterStatus(e.target.value); setPage(0); }}
                    style={selectStyle}
                >
                    {STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>

                <input
                    type="text"
                    placeholder="Search by item name or vendor..."
                    value={filterSearch}
                    onChange={e => { setFilterSearch(e.target.value); setPage(0); }}
                    style={{ ...selectStyle, minWidth: 220, flex: 1 }}
                />

                <button onClick={load} style={{ padding: '7px 14px', borderRadius: 7, border: '1px solid rgba(255,255,255,0.1)', background: 'transparent', color: '#64748b', cursor: 'pointer', fontSize: 12 }}>
                    🔄 Refresh
                </button>

                <span style={{ fontSize: 12, color: '#334155', marginLeft: 'auto' }}>{filtered.length} item{filtered.length !== 1 ? 's' : ''}</span>
            </div>

            {/* Table */}
            <div style={{ overflowX: 'auto', borderRadius: 11, border: '1px solid rgba(255,255,255,0.07)', background: 'rgba(10,18,38,0.95)' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                        <tr style={{ background: 'rgba(255,255,255,0.015)' }}>
                            <th style={{ ...thStyle, width: 40 }}>
                                <input type="checkbox"
                                    checked={selectedIds.length === pageItems.length && pageItems.length > 0}
                                    onChange={toggleSelectAll}
                                    style={{ accentColor: '#38bdf8' }}
                                />
                            </th>
                            <th style={{ ...thStyle, width: 140 }}>Created</th>
                            <th style={thStyle}>Review Type</th>
                            <th style={{ ...thStyle, minWidth: 160 }}>Vendor</th>
                            <th style={{ ...thStyle, minWidth: 180 }}>Item Name</th>
                            <th style={thStyle}>Price</th>
                            <th style={thStyle}>Pack / Unit</th>
                            <th style={thStyle}>Risk Flags</th>
                            <th style={thStyle}>Status</th>
                            <th style={{ ...thStyle, minWidth: 160 }}>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {loading && (
                            <tr><td colSpan={10} style={{ ...tdStyle, textAlign: 'center', padding: 36, color: '#334155' }}>Loading...</td></tr>
                        )}
                        {!loading && pageItems.length === 0 && (
                            <tr><td colSpan={10} style={{ ...tdStyle, textAlign: 'center', padding: 36, color: '#334155' }}>
                                No review items found for the current filters.
                            </td></tr>
                        )}
                        {!loading && pageItems.map(item => {
                            const proposed = item.proposedData || {};
                            const isSelected = selectedIds.includes(item.id);
                            const flagCount = (item.riskFlags || []).length;

                            return (
                                <tr key={item.id}
                                    style={{ background: isSelected ? 'rgba(56,189,248,0.04)' : 'transparent', transition: 'background 0.1s' }}
                                >
                                    <td style={tdStyle}>
                                        <input type="checkbox" checked={isSelected} onChange={() => toggleSelect(item.id)} style={{ accentColor: '#38bdf8' }} />
                                    </td>

                                    <td style={{ ...tdStyle, color: '#475569', fontSize: 11 }}>{fmt(item.createdAt)}</td>

                                    <td style={tdStyle}><TypeBadge type={item.reviewType} /></td>

                                    <td style={{ ...tdStyle, fontWeight: 600, color: '#94a3b8', fontSize: 12 }}>
                                        {item.vendorName || item.vendorId || '—'}
                                    </td>

                                    <td style={{ ...tdStyle, fontWeight: 700, color: '#f8fafc', fontSize: 13 }}>
                                        {proposed.itemName || '—'}
                                        {proposed.category && <div style={{ fontSize: 10, color: '#475569', fontWeight: 400 }}>{proposed.category}</div>}
                                    </td>

                                    <td style={{ ...tdStyle, color: '#fbbf24', fontWeight: 700 }}>
                                        {proposed.price ? `$${Number(proposed.price).toFixed(2)}` : '—'}
                                    </td>

                                    <td style={{ ...tdStyle, fontSize: 11, color: '#64748b' }}>
                                        {[proposed.packSize, proposed.unit].filter(Boolean).join(' · ') || '—'}
                                    </td>

                                    <td style={tdStyle}>
                                        {flagCount > 0 ? (
                                            <span style={{ fontSize: 10, color: '#f97316', background: 'rgba(249,115,22,0.1)', padding: '2px 7px', borderRadius: 6, fontWeight: 700 }}>
                                                🚨 {flagCount}
                                            </span>
                                        ) : (
                                            <span style={{ fontSize: 10, color: '#334155' }}>—</span>
                                        )}
                                    </td>

                                    <td style={tdStyle}><StatusBadge status={item.status} /></td>

                                    <td style={{ ...tdStyle }}>
                                        <div style={{ display: 'flex', gap: 5 }}>
                                            <button
                                                onClick={() => setReviewItem(item)}
                                                style={{ padding: '4px 10px', borderRadius: 6, fontSize: 11, fontWeight: 600, background: 'rgba(56,189,248,0.1)', border: '1px solid rgba(56,189,248,0.3)', color: '#38bdf8', cursor: 'pointer' }}
                                            >
                                                Review
                                            </button>
                                            {item.status === 'pending' && (
                                                <>
                                                    <button
                                                        onClick={() => quickHold(item.id)}
                                                        style={{ padding: '4px 8px', borderRadius: 6, fontSize: 10, background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.2)', color: '#fbbf24', cursor: 'pointer' }}
                                                    >
                                                        🕐
                                                    </button>
                                                    <button
                                                        onClick={() => quickReject(item.id)}
                                                        style={{ padding: '4px 8px', borderRadius: 6, fontSize: 10, background: 'rgba(244,63,94,0.08)', border: '1px solid rgba(244,63,94,0.2)', color: '#f43f5e', cursor: 'pointer' }}
                                                    >
                                                        ❌
                                                    </button>
                                                </>
                                            )}
                                            {(item.status === 'approved' && item.resolutionAction === 'mapped_to_catalog_item') && (
                                                <button
                                                    onClick={() => quickRevert(item.id)}
                                                    title="Undo this mapping — clears catalogItemId from vendor item and resets to Pending"
                                                    style={{ padding: '4px 9px', borderRadius: 6, fontSize: 10, fontWeight: 700, background: 'rgba(249,115,22,0.1)', border: '1px solid rgba(249,115,22,0.3)', color: '#fb923c', cursor: 'pointer', whiteSpace: 'nowrap' }}
                                                >
                                                    ↩️ Revert
                                                </button>
                                            )}
                                        </div>
                                    </td>
                                </tr>
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
                        <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0} style={paginBtnStyle(page === 0)}>← Prev</button>
                        <span style={{ color: '#64748b', lineHeight: '26px' }}>{page + 1}/{totalPages}</span>
                        <button onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1} style={paginBtnStyle(page >= totalPages - 1)}>Next →</button>
                    </div>
                </div>
            )}

            {/* Bulk actions bar */}
            <BulkReviewActionsBar
                selectedIds={selectedIds}
                onBulkHold={handleBulkHold}
                onBulkReject={handleBulkReject}
                onClearSelection={() => setSelectedIds([])}
            />

            {/* Review modal */}
            {reviewItem && (
                <SuperadminReviewItemModal
                    reviewItem={reviewItem}
                    onClose={() => setReviewItem(null)}
                    onResolved={() => { setReviewItem(null); load(); }}
                />
            )}
        </div>
    );
}

const selectStyle = {
    padding: '7px 10px', borderRadius: 7, border: '1px solid rgba(255,255,255,0.1)',
    background: '#1e293b', color: '#94a3b8', fontSize: 12, cursor: 'pointer',
};

const paginBtnStyle = (disabled) => ({
    padding: '3px 12px', borderRadius: 7, fontSize: 11,
    border: '1px solid rgba(255,255,255,0.09)', background: 'transparent',
    color: disabled ? '#1e293b' : '#64748b', cursor: disabled ? 'not-allowed' : 'pointer',
});
