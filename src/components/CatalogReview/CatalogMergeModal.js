/**
 * CatalogMergeModal.js
 *
 * Modal to merge two master catalog items.
 * - User picks survivor and losing item
 * - On confirm: aliases merged, vendor items remapped, loser marked mergedInto
 * - Uses mergeCatalogItems() from reviewQueueService
 *
 * Architecture: touches only catalogItems and vendors/.../items — no extra collections.
 */
import React, { useState, useContext, useEffect } from 'react';
import { toast } from 'react-toastify';
import { UserContext } from '../../contexts/UserContext';
import { mergeCatalogItems, getCatalogItems } from '../../components/CatalogReview/reviewQueueService';

export default function CatalogMergeModal({ onClose, onMerged, preselectedLoser = null }) {
    const { userId, displayName } = useContext(UserContext);

    const [catalogItems, setCatalogItems] = useState([]);
    const [loading, setLoading]     = useState(true);
    const [survivorId, setSurvivorId] = useState('');
    const [losingId, setLosingId]   = useState(preselectedLoser?.id || '');
    const [merging, setMerging]     = useState(false);
    const [preview, setPreview]     = useState(null);   // computed merge preview

    useEffect(() => {
        getCatalogItems('', 500)
            .then(items => {
                // Exclude already-merged items
                setCatalogItems(items.filter(i => i.status !== 'merged'));
                setLoading(false);
            })
            .catch(err => {
                toast.error('Could not load catalog items: ' + err.message);
                setLoading(false);
            });
    }, []);

    // Compute merge preview whenever both selections change
    useEffect(() => {
        if (!survivorId || !losingId || survivorId === losingId) {
            setPreview(null);
            return;
        }
        const survivor = catalogItems.find(i => i.id === survivorId);
        const loser    = catalogItems.find(i => i.id === losingId);
        if (!survivor || !loser) { setPreview(null); return; }

        const mergedAliases = [...new Set([
            ...(survivor.aliases || []),
            ...(loser.aliases || []),
            loser.canonicalName || loser.itemName || '',
        ].filter(Boolean))];

        setPreview({ survivor, loser, mergedAliases });
    }, [survivorId, losingId, catalogItems]);

    const handleMerge = async () => {
        if (!survivorId || !losingId) { toast.warn('Select both items.'); return; }
        if (survivorId === losingId) { toast.warn('Survivor and losing item must be different.'); return; }

        setMerging(true);
        try {
            const result = await mergeCatalogItems(survivorId, losingId, { userId, displayName });
            toast.success(`Merged! ${result.vendorItemsRemapped} vendor item(s) remapped to survivor.`);
            if (onMerged) onMerged({ survivorId, losingId, vendorItemsRemapped: result.vendorItemsRemapped });
            onClose();
        } catch (err) {
            toast.error('Merge failed: ' + err.message);
        } finally {
            setMerging(false);
        }
    };

    const survivor = catalogItems.find(i => i.id === survivorId);
    const loser    = catalogItems.find(i => i.id === losingId);

    // ── Styles ──────────────────────────────────────────────────────────────────
    const overlay = {
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 16,
    };
    const modal = {
        background: '#1A1A2E', border: '1px solid rgba(255,255,255,0.1)',
        borderRadius: 14, maxWidth: 640, width: '100%',
        maxHeight: '90vh', overflowY: 'auto', padding: 28,
    };
    const label = { display: 'block', fontWeight: 700, color: '#94a3b8', fontSize: 12, marginBottom: 6, letterSpacing: 0.5, textTransform: 'uppercase' };
    const select = {
        width: '100%', padding: '10px 14px', borderRadius: 8,
        border: '1px solid rgba(255,255,255,0.12)', background: '#0f172a',
        color: '#f8fafc', fontSize: 14, marginBottom: 16,
    };

    return (
        <div style={overlay} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
            <div style={modal}>
                {/* Header */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
                    <div>
                        <h2 style={{ fontSize: 20, fontWeight: 800, color: '#f8fafc', margin: 0 }}>🔀 Merge Catalog Items</h2>
                        <p style={{ color: '#64748b', fontSize: 13, marginTop: 4 }}>
                            The losing item's aliases and vendor mappings will be transferred to the survivor.
                        </p>
                    </div>
                    <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#64748b', fontSize: 22, cursor: 'pointer' }}>×</button>
                </div>

                {loading ? (
                    <div style={{ textAlign: 'center', padding: 40, color: '#64748b' }}>Loading catalog items…</div>
                ) : (
                    <>
                        {/* Survivor picker */}
                        <label style={label}>✅ Survivor (keep this one)</label>
                        <select
                            value={survivorId}
                            onChange={e => setSurvivorId(e.target.value)}
                            style={select}
                        >
                            <option value="">— Select the catalog item to keep —</option>
                            {catalogItems
                                .filter(i => i.id !== losingId)
                                .map(i => (
                                    <option key={i.id} value={i.id}>
                                        {i.canonicalName || i.itemName} — {i.category || 'No category'}
                                    </option>
                                ))}
                        </select>

                        {/* Loser picker */}
                        <label style={label}>❌ Losing Item (will be marked as merged)</label>
                        <select
                            value={losingId}
                            onChange={e => setLosingId(e.target.value)}
                            style={select}
                        >
                            <option value="">— Select the catalog item to retire —</option>
                            {catalogItems
                                .filter(i => i.id !== survivorId)
                                .map(i => (
                                    <option key={i.id} value={i.id}>
                                        {i.canonicalName || i.itemName} — {i.category || 'No category'}
                                    </option>
                                ))}
                        </select>

                        {/* Merge Preview */}
                        {preview && (
                            <div style={{ padding: '16px', borderRadius: 10, background: 'rgba(56,189,248,0.05)', border: '1px solid rgba(56,189,248,0.2)', marginBottom: 20 }}>
                                <div style={{ fontWeight: 700, color: '#38bdf8', fontSize: 13, marginBottom: 12 }}>📋 Merge Preview</div>

                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
                                    <div style={{ padding: 12, borderRadius: 8, background: 'rgba(74,222,128,0.06)', border: '1px solid rgba(74,222,128,0.2)' }}>
                                        <div style={{ fontSize: 11, color: '#4ade80', fontWeight: 700, marginBottom: 4 }}>SURVIVOR</div>
                                        <div style={{ fontWeight: 700, color: '#f8fafc' }}>{preview.survivor.canonicalName || preview.survivor.itemName}</div>
                                        <div style={{ fontSize: 12, color: '#64748b' }}>{preview.survivor.category}</div>
                                        <div style={{ fontSize: 11, color: '#64748b', marginTop: 4 }}>
                                            Current aliases: {(preview.survivor.aliases || []).length}
                                        </div>
                                    </div>
                                    <div style={{ padding: 12, borderRadius: 8, background: 'rgba(248,113,113,0.06)', border: '1px solid rgba(248,113,113,0.2)' }}>
                                        <div style={{ fontSize: 11, color: '#f87171', fontWeight: 700, marginBottom: 4 }}>RETIRING</div>
                                        <div style={{ fontWeight: 700, color: '#f8fafc' }}>{preview.loser.canonicalName || preview.loser.itemName}</div>
                                        <div style={{ fontSize: 12, color: '#64748b' }}>{preview.loser.category}</div>
                                        <div style={{ fontSize: 11, color: '#64748b', marginTop: 4 }}>
                                            Aliases to transfer: {(preview.loser.aliases || []).length}
                                        </div>
                                    </div>
                                </div>

                                <div>
                                    <div style={{ fontSize: 11, color: '#94a3b8', fontWeight: 700, marginBottom: 6 }}>MERGED ALIASES</div>
                                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                                        {preview.mergedAliases.map((a, i) => (
                                            <span key={i} style={{ padding: '2px 8px', borderRadius: 20, background: 'rgba(56,189,248,0.1)', color: '#38bdf8', fontSize: 11, border: '1px solid rgba(56,189,248,0.2)' }}>
                                                {a}
                                            </span>
                                        ))}
                                        {preview.mergedAliases.length === 0 && (
                                            <span style={{ color: '#64748b', fontSize: 12 }}>No aliases</span>
                                        )}
                                    </div>
                                </div>

                                <div style={{ marginTop: 12, fontSize: 12, color: '#fbbf24' }}>
                                    ⚠️ All vendor items currently pointing to <strong>{preview.loser.canonicalName || preview.loser.itemName}</strong> will be remapped to the survivor. This cannot be undone.
                                </div>
                            </div>
                        )}

                        {/* Actions */}
                        <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
                            <button className="ui-btn ghost" onClick={onClose} disabled={merging}>Cancel</button>
                            <button
                                className="ui-btn primary"
                                onClick={handleMerge}
                                disabled={merging || !survivorId || !losingId || survivorId === losingId}
                                style={{ minWidth: 160 }}
                            >
                                {merging ? '⏳ Merging…' : '🔀 Confirm Merge'}
                            </button>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}
