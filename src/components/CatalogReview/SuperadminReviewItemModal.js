/**
 * SuperadminReviewItemModal.js
 *
 * Full-screen overlay modal for reviewing a single catalogReviewQueue item.
 *
 * Sections:
 *   A — Proposed vendor item data
 *   B — Current vs proposed comparison (for updates)
 *   C — Suggested master catalog matches
 *   D — Suggested vendor item matches (duplicates)
 *   E — Risk flags
 *   F — Review action history
 *
 * Actions (7):
 *   1. Approve & Map to existing catalog item
 *   2. Approve & Create new catalog item
 *   3. Merge into existing vendor item
 *   4. Approve high-risk update
 *   5. Edit before approving
 *   6. Hold
 *   7. Reject
 */

import React, { useState, useEffect, useContext } from 'react';
import { UserContext } from '../../contexts/UserContext';
import RiskFlagsPanel from './RiskFlagsPanel';
import VendorItemComparisonCard from './VendorItemComparisonCard';
import CatalogMatchSuggestions from './CatalogMatchSuggestions';
import CatalogItemCreateEditForm from './CatalogItemCreateEditForm';
import ReviewHistoryTimeline from './ReviewHistoryTimeline';
import {
    approveAndMapToCatalogItem,
    approveAndCreateCatalogItem,
    approveHighRiskUpdate,
    mergeWithExistingVendorItem,
    rejectCatalogReviewItem,
    holdCatalogReviewItem,
    getReviewHistory,
} from './reviewQueueService';
import {
    getSuggestedCatalogMatches,
    getSuggestedVendorMatches,
} from './catalogMatchService';

// ── Status badge ───────────────────────────────────────────────────────────────

const TYPE_CONFIG = {
    new_item:           { label: 'New Item',          color: '#4ade80', bg: 'rgba(74,222,128,0.1)',   emoji: '✨' },
    possible_duplicate: { label: 'Possible Duplicate',color: '#fb923c', bg: 'rgba(251,146,60,0.1)',   emoji: '⚠️' },
    high_risk_update:   { label: 'High Risk Update',  color: '#f97316', bg: 'rgba(249,115,22,0.12)',  emoji: '🚨' },
    mapping_review:     { label: 'Mapping Review',    color: '#a78bfa', bg: 'rgba(167,139,250,0.1)',  emoji: '🔗' },
};

function TypeBadge({ type }) {
    const c = TYPE_CONFIG[type] || { label: type, color: '#94a3b8', bg: 'rgba(148,163,184,0.1)', emoji: '📋' };
    return (
        <span style={{ padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 700, background: c.bg, color: c.color }}>
            {c.emoji} {c.label}
        </span>
    );
}

// ── SectionHeader ──────────────────────────────────────────────────────────────

function SectionHeader({ title, subtitle }) {
    return (
        <div style={{ marginBottom: 12 }}>
            <div style={{ fontWeight: 800, fontSize: 14, color: '#f8fafc' }}>{title}</div>
            {subtitle && <div style={{ fontSize: 11, color: '#475569', marginTop: 2 }}>{subtitle}</div>}
        </div>
    );
}

// ── Main Modal ─────────────────────────────────────────────────────────────────

export default function SuperadminReviewItemModal({ reviewItem, onClose, onResolved }) {
    const { currentUser } = useContext(UserContext);
    const reviewerInfo = { userId: currentUser?.uid, displayName: currentUser?.displayName || currentUser?.email || 'Admin' };

    // Suggested matches loaded async
    const [catalogMatches, setCatalogMatches] = useState([]);
    const [vendorMatches,  setVendorMatches]  = useState([]);
    const [history,        setHistory]         = useState([]);
    const [matchesLoading, setMatchesLoading]  = useState(true);

    // Selection state
    const [selectedCatalogItem, setSelectedCatalogItem] = useState(null);
    const [selectedVendorItem,  setSelectedVendorItem]  = useState(null);

    // UI state
    const [activeTab,        setActiveTab]        = useState('overview');  // overview | comparison | matches | history
    const [showCreateForm,   setShowCreateForm]   = useState(false);
    const [showRejectInput,  setShowRejectInput]  = useState(false);
    const [showHoldInput,    setShowHoldInput]    = useState(false);
    const [addAlias,         setAddAlias]         = useState(true);
    const [rejectReason,     setRejectReason]     = useState('');
    const [holdNotes,        setHoldNotes]        = useState('');
    const [busy,             setBusy]             = useState(false);
    const [error,            setError]            = useState('');
    const [successMsg,       setSuccessMsg]       = useState('');

    const { proposedData = {}, existingVendorItemData = {}, riskFlags = [], reviewType } = reviewItem || {};
    const itemName = proposedData.itemName || '';

    // Load suggestions + history
    useEffect(() => {
        if (!reviewItem) return;
        let mounted = true;
        setMatchesLoading(true);

        Promise.all([
            getSuggestedCatalogMatches(itemName, proposedData.category),
            getSuggestedVendorMatches(reviewItem.vendorId, itemName),
            getReviewHistory(reviewItem.id),
        ]).then(([cm, vm, hist]) => {
            if (!mounted) return;
            // Merge in any pre-loaded suggestions from the queue entry
            const extra = reviewItem.suggestedCatalogMatches || [];
            const merged = [...extra, ...cm].filter((v, i, a) => a.findIndex(x => x.id === v.id) === i);
            setCatalogMatches(merged.slice(0, 5));
            setVendorMatches(vm);
            setHistory(hist);
            setMatchesLoading(false);
        }).catch(err => {
            if (mounted) setMatchesLoading(false);
            console.error('[ReviewModal] load error', err);
        });

        return () => { mounted = false; };
    }, [reviewItem?.id]);

    // ── Action handlers ──────────────────────────────────────────────────────

    const doAction = async (fn, successText) => {
        setBusy(true);
        setError('');
        try {
            await fn();
            setSuccessMsg(successText);
            setTimeout(() => { onResolved(); onClose(); }, 1200);
        } catch (e) {
            setError(e.message || 'An error occurred');
            setBusy(false);
        }
    };

    const handleMapToExisting = () => {
        if (!selectedCatalogItem) { setError('Please select a catalog item first.'); return; }
        doAction(
            () => approveAndMapToCatalogItem(reviewItem.id, selectedCatalogItem.id, { addAlias, aliasName: itemName }, reviewerInfo),
            'Mapped to catalog item successfully!'
        );
    };

    const handleCreateAndApprove = (formData) => {
        doAction(
            () => approveAndCreateCatalogItem(reviewItem.id, { ...formData, itemName: formData.itemName || itemName }, reviewerInfo),
            'New catalog item created and approved!'
        );
    };

    const handleMerge = () => {
        if (!selectedVendorItem) { setError('Please select a vendor item to merge into.'); return; }
        doAction(
            () => mergeWithExistingVendorItem(reviewItem.id, selectedVendorItem.id, addAlias, reviewerInfo),
            'Merged into existing item!'
        );
    };

    const handleApproveHighRisk = () => {
        doAction(
            () => approveHighRiskUpdate(reviewItem.id, 'Approved by superadmin after review', reviewerInfo),
            'High-risk update approved!'
        );
    };

    const handleReject = () => {
        if (!rejectReason.trim()) { setError('Please enter a rejection reason.'); return; }
        doAction(
            () => rejectCatalogReviewItem(reviewItem.id, rejectReason.trim(), reviewerInfo),
            'Review item rejected.'
        );
    };

    const handleHold = () => {
        doAction(
            () => holdCatalogReviewItem(reviewItem.id, holdNotes.trim() || 'Held for later review', reviewerInfo),
            'Item placed on hold.'
        );
    };

    // ── Overlay ──────────────────────────────────────────────────────────────

    if (!reviewItem) return null;

    const tabStyle = (active) => ({
        padding: '6px 14px', borderRadius: 20, fontSize: 11.5, fontWeight: 600, cursor: 'pointer',
        border: active ? '1px solid #38bdf8' : '1px solid rgba(255,255,255,0.08)',
        background: active ? 'rgba(56,189,248,0.1)' : 'transparent',
        color: active ? '#38bdf8' : '#64748b',
    });

    const panelStyle = {
        background: '#1e293b', borderRadius: 12, border: '1px solid rgba(255,255,255,0.07)', padding: 18, marginBottom: 16,
    };

    return (
        <div style={{
            position: 'fixed', inset: 0, zIndex: 9500,
            background: 'rgba(2,8,23,0.88)', display: 'flex', alignItems: 'center', justifyContent: 'center',
            backdropFilter: 'blur(4px)',
        }}
            onClick={e => { if (e.target === e.currentTarget) onClose(); }}
        >
            <div style={{
                width: '96vw', maxWidth: 960, maxHeight: '92vh',
                background: '#0f172a', borderRadius: 16, border: '1px solid rgba(255,255,255,0.1)',
                boxShadow: '0 24px 80px rgba(0,0,0,0.7)',
                display: 'flex', flexDirection: 'column', overflow: 'hidden',
            }}>
                {/* Header */}
                <div style={{ padding: '18px 24px', borderBottom: '1px solid rgba(255,255,255,0.07)', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
                    <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                            <TypeBadge type={reviewType} />
                            {riskFlags.length > 0 && (
                                <span style={{ fontSize: 10, color: '#f97316', background: 'rgba(249,115,22,0.1)', padding: '2px 8px', borderRadius: 10, fontWeight: 700 }}>
                                    {riskFlags.length} risk flag{riskFlags.length !== 1 ? 's' : ''}
                                </span>
                            )}
                        </div>
                        <div style={{ fontSize: 20, fontWeight: 800, color: '#f8fafc' }}>{itemName || '—'}</div>
                        <div style={{ fontSize: 12, color: '#475569', marginTop: 3 }}>
                            Vendor: <span style={{ color: '#94a3b8' }}>{reviewItem.vendorName}</span>
                            {proposedData.category && <> · <span style={{ color: '#64748b' }}>{proposedData.category}</span></>}
                        </div>
                    </div>
                    <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#475569', cursor: 'pointer', fontSize: 22, lineHeight: 1 }}>✕</button>
                </div>

                {/* Tabs */}
                <div style={{ padding: '10px 24px', borderBottom: '1px solid rgba(255,255,255,0.06)', display: 'flex', gap: 6 }}>
                    {[
                        { key: 'overview',    label: 'Overview' },
                        { key: 'comparison',  label: 'Comparison' },
                        { key: 'matches',     label: `Matches (${catalogMatches.length})` },
                        { key: 'history',     label: `History (${history.length})` },
                    ].map(t => (
                        <button key={t.key} style={tabStyle(activeTab === t.key)} onClick={() => setActiveTab(t.key)}>{t.label}</button>
                    ))}
                </div>

                {/* Body */}
                <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px' }}>

                    {/* Success / Error */}
                    {successMsg && (
                        <div style={{ marginBottom: 14, padding: '10px 16px', borderRadius: 8, background: 'rgba(74,222,128,0.1)', border: '1px solid rgba(74,222,128,0.25)', color: '#4ade80', fontSize: 13, fontWeight: 700 }}>
                            ✅ {successMsg}
                        </div>
                    )}
                    {error && (
                        <div style={{ marginBottom: 14, padding: '10px 16px', borderRadius: 8, background: 'rgba(244,63,94,0.08)', border: '1px solid rgba(244,63,94,0.25)', color: '#f87171', fontSize: 13 }}>
                            ❌ {error}
                            <button onClick={() => setError('')} style={{ marginLeft: 12, background: 'none', border: 'none', color: '#f87171', cursor: 'pointer', fontSize: 12 }}>Dismiss</button>
                        </div>
                    )}

                    {/* ── Overview Tab ── */}
                    {activeTab === 'overview' && (
                        <>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                                {/* Section A — Proposed Data */}
                                <div style={panelStyle}>
                                    <SectionHeader title="A — Proposed Item Data" subtitle="What the vendor uploaded" />
                                    {[
                                        ['Item Name', proposedData.itemName],
                                        ['Category', proposedData.category],
                                        ['Brand', proposedData.brand],
                                        ['Pack Size', proposedData.packSize],
                                        ['Unit', proposedData.unit],
                                        ['Price', proposedData.price ? `$${Number(proposedData.price).toFixed(2)} ${proposedData.currency || 'CAD'}` : '—'],
                                        ['Vendor SKU', proposedData.vendorSKU],
                                        ['Min Order Qty', proposedData.minOrderQty],
                                        ['Status', proposedData.status],
                                        ['Notes', proposedData.notes],
                                    ].map(([label, val]) => val ? (
                                        <div key={label} style={{ display: 'flex', gap: 8, marginBottom: 5 }}>
                                            <span style={{ fontSize: 11, color: '#475569', minWidth: 90, fontWeight: 600 }}>{label}</span>
                                            <span style={{ fontSize: 12, color: '#94a3b8' }}>{val}</span>
                                        </div>
                                    ) : null)}
                                </div>

                                {/* Section E — Risk Flags */}
                                <div style={panelStyle}>
                                    <SectionHeader title="E — Risk Flags" />
                                    <RiskFlagsPanel flags={riskFlags} />
                                    {reviewItem.reviewReason && (
                                        <div style={{ marginTop: 12, fontSize: 12, color: '#64748b', padding: '8px 10px', background: 'rgba(255,255,255,0.02)', borderRadius: 6 }}>
                                            <strong>Review Reason:</strong> {reviewItem.reviewReason}
                                        </div>
                                    )}
                                </div>
                            </div>
                        </>
                    )}

                    {/* ── Comparison Tab ── */}
                    {activeTab === 'comparison' && (
                        <div style={panelStyle}>
                            <SectionHeader title="B — Current vs Proposed" subtitle="What will change if approved" />
                            <VendorItemComparisonCard existingItem={existingVendorItemData} proposedData={proposedData} />
                        </div>
                    )}

                    {/* ── Matches Tab ── */}
                    {activeTab === 'matches' && (
                        <div style={panelStyle}>
                            <SectionHeader title="C & D — Suggested Matches" subtitle="Master catalog items and existing vendor items" />
                            <CatalogMatchSuggestions
                                catalogMatches={catalogMatches}
                                vendorMatches={vendorMatches}
                                selectedCatalogItem={selectedCatalogItem}
                                selectedVendorItem={selectedVendorItem}
                                onSelectCatalog={setSelectedCatalogItem}
                                onSelectVendor={setSelectedVendorItem}
                                loading={matchesLoading}
                            />
                        </div>
                    )}

                    {/* ── History Tab ── */}
                    {activeTab === 'history' && (
                        <div style={panelStyle}>
                            <SectionHeader title="F — Review History" subtitle="All actions taken on this item" />
                            <ReviewHistoryTimeline history={history} loading={matchesLoading} />
                        </div>
                    )}

                    {/* Create Form */}
                    {showCreateForm && (
                        <div style={{ ...panelStyle, border: '1px solid rgba(56,189,248,0.25)' }}>
                            <SectionHeader title="Create New Master Catalog Item" subtitle="This will be added to the global clean catalog" />
                            <CatalogItemCreateEditForm
                                initial={{ ...proposedData, itemName: itemName }}
                                onSubmit={handleCreateAndApprove}
                                onCancel={() => setShowCreateForm(false)}
                                loading={busy}
                            />
                        </div>
                    )}

                    {/* Reject input */}
                    {showRejectInput && (
                        <div style={{ ...panelStyle, border: '1px solid rgba(244,63,94,0.2)' }}>
                            <SectionHeader title="Reject this item" subtitle="Enter a reason for the vendor record" />
                            <textarea
                                value={rejectReason}
                                onChange={e => setRejectReason(e.target.value)}
                                placeholder="e.g. Duplicate of existing Tomato item. Please use the existing SKU."
                                rows={3}
                                style={{ width: '100%', padding: '8px 10px', borderRadius: 7, border: '1px solid rgba(255,255,255,0.1)', background: '#0f172a', color: '#f8fafc', fontSize: 13, resize: 'vertical', boxSizing: 'border-box' }}
                            />
                            <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                                <button onClick={handleReject} disabled={!rejectReason.trim() || busy}
                                    style={{ padding: '7px 16px', borderRadius: 7, fontSize: 12, fontWeight: 700, background: '#f43f5e', border: 'none', color: '#fff', cursor: 'pointer' }}>
                                    ❌ Confirm Rejection
                                </button>
                                <button onClick={() => setShowRejectInput(false)}
                                    style={{ padding: '7px 12px', borderRadius: 7, fontSize: 12, background: 'transparent', border: '1px solid rgba(255,255,255,0.08)', color: '#475569', cursor: 'pointer' }}>
                                    Cancel
                                </button>
                            </div>
                        </div>
                    )}

                    {/* Hold input */}
                    {showHoldInput && (
                        <div style={{ ...panelStyle, border: '1px solid rgba(251,191,36,0.2)' }}>
                            <SectionHeader title="Hold for later" />
                            <input
                                type="text"
                                value={holdNotes}
                                onChange={e => setHoldNotes(e.target.value)}
                                placeholder="Optional notes..."
                                style={{ width: '100%', padding: '8px 10px', borderRadius: 7, border: '1px solid rgba(255,255,255,0.1)', background: '#0f172a', color: '#f8fafc', fontSize: 13, boxSizing: 'border-box' }}
                            />
                            <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                                <button onClick={handleHold} disabled={busy}
                                    style={{ padding: '7px 16px', borderRadius: 7, fontSize: 12, fontWeight: 700, background: '#fbbf24', border: 'none', color: '#0f172a', cursor: 'pointer' }}>
                                    🕐 Confirm Hold
                                </button>
                                <button onClick={() => setShowHoldInput(false)}
                                    style={{ padding: '7px 12px', borderRadius: 7, fontSize: 12, background: 'transparent', border: '1px solid rgba(255,255,255,0.08)', color: '#475569', cursor: 'pointer' }}>
                                    Cancel
                                </button>
                            </div>
                        </div>
                    )}
                </div>

                {/* Footer action bar */}
                <div style={{ padding: '14px 24px', borderTop: '1px solid rgba(255,255,255,0.07)', display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', background: 'rgba(0,0,0,0.2)' }}>

                    {/* Primary actions */}
                    <button onClick={handleMapToExisting} disabled={busy || !selectedCatalogItem}
                        title={!selectedCatalogItem ? 'Select a catalog item from the Matches tab first' : 'Map vendor item to selected catalog item'}
                        style={{ padding: '8px 14px', borderRadius: 8, fontSize: 12, fontWeight: 700, background: selectedCatalogItem ? '#38bdf8' : 'rgba(56,189,248,0.2)', border: 'none', color: selectedCatalogItem ? '#0f172a' : '#38bdf8', cursor: busy || !selectedCatalogItem ? 'not-allowed' : 'pointer' }}>
                        🔗 Map to Catalog Item
                    </button>

                    <button onClick={() => { setShowCreateForm(true); setActiveTab('overview'); }} disabled={busy}
                        style={{ padding: '8px 14px', borderRadius: 8, fontSize: 12, fontWeight: 700, background: 'rgba(74,222,128,0.12)', border: '1px solid rgba(74,222,128,0.3)', color: '#4ade80', cursor: busy ? 'not-allowed' : 'pointer' }}>
                        ✨ Create New Catalog Item
                    </button>

                    {(reviewType === 'possible_duplicate') && (
                        <button onClick={handleMerge} disabled={busy || !selectedVendorItem}
                            title={!selectedVendorItem ? 'Select a vendor item from Matches tab' : 'Merge into this existing item'}
                            style={{ padding: '8px 14px', borderRadius: 8, fontSize: 12, fontWeight: 700, background: selectedVendorItem ? 'rgba(167,139,250,0.15)' : 'rgba(167,139,250,0.06)', border: '1px solid rgba(167,139,250,0.3)', color: '#a78bfa', cursor: busy || !selectedVendorItem ? 'not-allowed' : 'pointer' }}>
                            🔀 Merge Into Existing
                        </button>
                    )}

                    {(reviewType === 'high_risk_update') && (
                        <button onClick={handleApproveHighRisk} disabled={busy}
                            style={{ padding: '8px 14px', borderRadius: 8, fontSize: 12, fontWeight: 700, background: 'rgba(249,115,22,0.12)', border: '1px solid rgba(249,115,22,0.35)', color: '#f97316', cursor: busy ? 'not-allowed' : 'pointer' }}>
                            🚨 Approve High-Risk Update
                        </button>
                    )}

                    {/* Alias option */}
                    {selectedCatalogItem && (
                        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#64748b', cursor: 'pointer' }}>
                            <input type="checkbox" checked={addAlias} onChange={e => setAddAlias(e.target.checked)} style={{ accentColor: '#38bdf8' }} />
                            Add "{itemName}" as alias
                        </label>
                    )}

                    <div style={{ flex: 1 }} />

                    {/* Secondary actions */}
                    <button onClick={() => { setShowHoldInput(true); setShowRejectInput(false); }} disabled={busy}
                        style={{ padding: '7px 12px', borderRadius: 8, fontSize: 12, border: '1px solid rgba(251,191,36,0.25)', background: 'transparent', color: '#fbbf24', cursor: busy ? 'not-allowed' : 'pointer' }}>
                        🕐 Hold
                    </button>
                    <button onClick={() => { setShowRejectInput(true); setShowHoldInput(false); }} disabled={busy}
                        style={{ padding: '7px 12px', borderRadius: 8, fontSize: 12, border: '1px solid rgba(244,63,94,0.25)', background: 'transparent', color: '#f43f5e', cursor: busy ? 'not-allowed' : 'pointer' }}>
                        ❌ Reject
                    </button>
                </div>
            </div>
        </div>
    );
}
