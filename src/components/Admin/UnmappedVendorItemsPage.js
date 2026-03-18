/**
 * UnmappedVendorItemsPage.js
 * Route: /admin/unmapped-items
 *
 * Superadmin view of all vendor items with mappingStatus == 'unmapped' or 'pending_review'.
 * Allows quick-map to an existing catalog item or sends to catalogReviewQueue.
 *
 * Architecture: Uses only vendors/{vId}/items + catalogItems + catalogReviewQueue.
 */
import React, { useEffect, useState, useContext, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { UserContext } from '../../contexts/UserContext';
import { toast } from 'react-toastify';
import { db } from '../../firebase';
import {
    collection,
    getDocs,
    query,
    where,
    limit,
    collectionGroup,
    updateDoc,
    doc,
    serverTimestamp,
} from 'firebase/firestore';
import {
    getCatalogItems,
    createCatalogReviewQueueEntry,
    writeVendorItemHistory,
} from '../CatalogReview/reviewQueueService';

const STATUS_CONFIG = {
    unmapped:       { label: 'Unmapped',       color: '#f87171', bg: 'rgba(248,113,113,0.1)' },
    pending_review: { label: 'Pending Review',  color: '#fbbf24', bg: 'rgba(251,191,36,0.1)' },
};

export default function UnmappedVendorItemsPage() {
    const navigate = useNavigate();
    const { userId, displayName } = useContext(UserContext);

    const [items, setItems]             = useState([]);
    const [loading, setLoading]         = useState(true);
    const [catalogItems, setCatalogItems] = useState([]);
    const [search, setSearch]           = useState('');
    const [statusFilter, setStatusFilter] = useState('');
    const [mapping, setMapping]         = useState({}); // { itemRowKey: catalogItemId }
    const [saving, setSaving]           = useState(null);
    const [sendingToQueue, setSendingToQueue] = useState(null);

    // ── Load unmapped vendor items (cross-vendor collectionGroup) ─────────────
    useEffect(() => {
        (async () => {
            try {
                const constraints = [
                    where('mappingStatus', 'in', ['unmapped', 'pending_review']),
                    limit(300),
                ];
                const snap = await getDocs(query(collectionGroup(db, 'items'), ...constraints));
                const rows = snap.docs.map(d => ({
                    _id:      d.id,
                    vendorId: d.ref.parent.parent.id,
                    ...d.data(),
                }));
                setItems(rows);
            } catch (err) {
                console.error('[UnmappedItems] load error:', err);
                toast.error('Failed to load unmapped items: ' + err.message);
            } finally {
                setLoading(false);
            }
        })();
    }, []);

    // ── Load catalog items for quick-map dropdown ─────────────────────────────
    useEffect(() => {
        getCatalogItems('', 300)
            .then(setCatalogItems)
            .catch(err => console.error('[UnmappedItems] catalog load:', err));
    }, []);

    // ── Quick-map: set catalogItemId on vendor item ───────────────────────────
    const handleQuickMap = async (item, catalogItemId) => {
        if (!catalogItemId) { toast.warn('Select a catalog item first.'); return; }
        const key = `${item.vendorId}_${item._id}`;
        setSaving(key);
        try {
            const ref = doc(db, 'vendors', item.vendorId, 'items', item._id);
            await updateDoc(ref, {
                catalogItemId,
                mappingStatus:    'mapped',
                mappingSource:    'manual',
                mappingConfidence: 1.0,
                updatedAt:        serverTimestamp(),
                updatedBy:        displayName || userId,
            });
            await writeVendorItemHistory(item.vendorId, item._id, {
                changedBy:    displayName || userId,
                changeSource: 'manual_mapping',
                oldValues:    { catalogItemId: null, mappingStatus: item.mappingStatus },
                newValues:    { catalogItemId, mappingStatus: 'mapped' },
                changedFields: ['catalogItemId', 'mappingStatus'],
                notes:        'Quick-mapped from Unmapped Items page',
            });
            setItems(prev => prev.filter(r => r._id !== item._id || r.vendorId !== item.vendorId));
            toast.success(`Mapped "${item.itemName}" ✅`);
        } catch (err) {
            toast.error('Map failed: ' + err.message);
        } finally {
            setSaving(null);
        }
    };

    // ── Send to Review Queue ──────────────────────────────────────────────────
    const handleSendToQueue = async (item) => {
        const key = `${item.vendorId}_${item._id}`;
        setSendingToQueue(key);
        try {
            await createCatalogReviewQueueEntry({
                vendorId:    item.vendorId,
                vendorName:  item.vendorName || item.vendorId,
                vendorItemId: item._id,
                importBatchId: item.lastImportBatchId || '',
                importRowId:  '',
                reviewType:   'mapping_review',
                proposedData: {
                    itemName:  item.itemName,
                    category:  item.category,
                    brand:     item.brand,
                    packSize:  item.packSize,
                    unit:      item.unit,
                    price:     item.vendorPrice,
                    currency:  item.currency || 'CAD',
                    vendorSKU: item.vendorSKU,
                },
                existingVendorItemData: {},
                suggestedCatalogMatches: [],
                suggestedVendorMatches:  [],
                matchConfidence: null,
                riskFlags: [],
                reviewReason: 'Sent to queue from Unmapped Items page for manual review',
                createdBy: displayName || userId,
            });
            await updateDoc(doc(db, 'vendors', item.vendorId, 'items', item._id), {
                mappingStatus: 'pending_review',
                updatedAt:     serverTimestamp(),
                updatedBy:     displayName || userId,
            });
            setItems(prev => prev.map(r =>
                r._id === item._id && r.vendorId === item.vendorId
                    ? { ...r, mappingStatus: 'pending_review' }
                    : r
            ));
            toast.success('Sent to Review Queue');
        } catch (err) {
            toast.error('Failed: ' + err.message);
        } finally {
            setSendingToQueue(null);
        }
    };

    // ── Filter ────────────────────────────────────────────────────────────────
    const filtered = items.filter(r => {
        const name = (r.itemName || r.name || '').toLowerCase();
        const matchSearch = !search || name.includes(search.toLowerCase());
        const matchStatus = !statusFilter || r.mappingStatus === statusFilter;
        return matchSearch && matchStatus;
    });

    // ── Render ────────────────────────────────────────────────────────────────
    return (
        <div style={{ maxWidth: 1200, margin: '0 auto', padding: '24px 16px' }}>
            {/* Header */}
            <div style={{ marginBottom: 24 }}>
                <button className="ui-btn ghost small" onClick={() => navigate('/admin')} style={{ marginBottom: 8 }}>
                    ← Back
                </button>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
                    <div>
                        <h1 style={{ fontSize: 24, fontWeight: 800, color: '#f8fafc', margin: 0 }}>
                            🔗 Unmapped Vendor Items
                        </h1>
                        <p style={{ color: '#94a3b8', marginTop: 4, fontSize: 13 }}>
                            Items with no master catalog mapping. Quick-map or send to review queue.
                        </p>
                    </div>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        <span style={{ padding: '4px 12px', borderRadius: 20, background: 'rgba(248,113,113,0.1)', color: '#f87171', fontSize: 13, fontWeight: 700 }}>
                            {items.length} total unmapped
                        </span>
                        <button className="ui-btn primary small" onClick={() => navigate('/admin/catalog-review')}>
                            → Review Queue
                        </button>
                    </div>
                </div>
            </div>

            {/* Filters */}
            <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
                <input
                    type="text"
                    placeholder="Search by item name…"
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    style={{ padding: '8px 14px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.04)', color: '#f8fafc', fontSize: 13, minWidth: 220 }}
                />
                <select
                    value={statusFilter}
                    onChange={e => setStatusFilter(e.target.value)}
                    style={{ padding: '8px 14px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.1)', background: '#1A1A2E', color: '#f8fafc', fontSize: 13 }}
                >
                    <option value="">All Statuses</option>
                    <option value="unmapped">Unmapped</option>
                    <option value="pending_review">Pending Review</option>
                </select>
            </div>

            {/* Table */}
            {loading ? (
                <div style={{ textAlign: 'center', padding: 60, color: '#64748b' }}>Loading unmapped items…</div>
            ) : filtered.length === 0 ? (
                <div style={{ textAlign: 'center', padding: 60 }}>
                    <div style={{ fontSize: 48, marginBottom: 16 }}>🎉</div>
                    <div style={{ fontSize: 18, color: '#4ade80', fontWeight: 700 }}>All vendor items are mapped!</div>
                    <div style={{ fontSize: 13, color: '#64748b', marginTop: 8 }}>No unmapped items found with current filters.</div>
                </div>
            ) : (
                <div style={{ borderRadius: 12, border: '1px solid rgba(255,255,255,0.08)', overflow: 'hidden', background: '#1A1A2E' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                        <thead>
                            <tr style={{ background: 'rgba(255,255,255,0.03)', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                                {['Item Name', 'Vendor', 'Category', 'Pack / Unit', 'Price', 'Status', 'Map To', 'Actions'].map(h => (
                                    <th key={h} style={{ padding: '10px 14px', textAlign: 'left', color: '#64748b', fontWeight: 700, whiteSpace: 'nowrap' }}>{h}</th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {filtered.map((item) => {
                                const key = `${item.vendorId}_${item._id}`;
                                const statusCfg = STATUS_CONFIG[item.mappingStatus] || STATUS_CONFIG.unmapped;
                                const isSaving = saving === key;
                                const isSendingQ = sendingToQueue === key;

                                return (
                                    <tr key={key} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                                        <td style={{ padding: '10px 14px', fontWeight: 600, color: '#f8fafc' }}>
                                            {item.itemName || item.name || '—'}
                                        </td>
                                        <td style={{ padding: '10px 14px', color: '#94a3b8' }}>
                                            {item.vendorId}
                                        </td>
                                        <td style={{ padding: '10px 14px', color: '#94a3b8' }}>
                                            {item.category || '—'}
                                        </td>
                                        <td style={{ padding: '10px 14px', color: '#94a3b8' }}>
                                            {item.packSize || '—'} / {item.unit || '—'}
                                        </td>
                                        <td style={{ padding: '10px 14px', color: '#4ade80', fontWeight: 600 }}>
                                            {item.vendorPrice != null ? `$${parseFloat(item.vendorPrice).toFixed(2)}` : '—'}
                                        </td>
                                        <td style={{ padding: '10px 14px' }}>
                                            <span style={{ padding: '2px 8px', borderRadius: 20, fontSize: 11, fontWeight: 700, background: statusCfg.bg, color: statusCfg.color }}>
                                                {statusCfg.label}
                                            </span>
                                        </td>
                                        <td style={{ padding: '10px 14px' }}>
                                            <select
                                                value={mapping[key] || ''}
                                                onChange={e => setMapping(prev => ({ ...prev, [key]: e.target.value }))}
                                                style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid rgba(255,255,255,0.12)', background: '#0f172a', color: '#f8fafc', fontSize: 12, minWidth: 180, maxWidth: 220 }}
                                            >
                                                <option value="">— Select catalog item —</option>
                                                {catalogItems.map(ci => (
                                                    <option key={ci.id} value={ci.id}>
                                                        {ci.canonicalName || ci.itemName}
                                                    </option>
                                                ))}
                                            </select>
                                        </td>
                                        <td style={{ padding: '10px 14px' }}>
                                            <div style={{ display: 'flex', gap: 6 }}>
                                                <button
                                                    className="ui-btn primary small"
                                                    style={{ padding: '4px 10px', fontSize: 11 }}
                                                    disabled={isSaving || !mapping[key]}
                                                    onClick={() => handleQuickMap(item, mapping[key])}
                                                >
                                                    {isSaving ? '…' : '✓ Map'}
                                                </button>
                                                <button
                                                    className="ui-btn ghost small"
                                                    style={{ padding: '4px 10px', fontSize: 11 }}
                                                    disabled={isSendingQ || item.mappingStatus === 'pending_review'}
                                                    onClick={() => handleSendToQueue(item)}
                                                >
                                                    {isSendingQ ? '…' : '→ Queue'}
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                    {filtered.length < items.length && (
                        <div style={{ textAlign: 'center', padding: 8, color: '#64748b', fontSize: 12 }}>
                            Showing {filtered.length} of {items.length} items (filtered)
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
