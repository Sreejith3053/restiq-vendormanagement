import React, { useState, useEffect, useCallback, useContext } from 'react';
import { db } from '../../firebase';
import { collection, getDocs, doc, getDoc, setDoc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { UserContext } from '../../contexts/UserContext';
import { generateCatalogItemId, normalizeItemKey } from '../../utils/catalogUtils';
import { logAdminChange } from '../../utils/adminAuditLogger';
import { toast } from 'react-toastify';

const CATEGORIES = ['Produce', 'Meat', 'Seafood', 'Dairy', 'Spices', 'Grains', 'Beverages', 'Packaging', 'Cleaning', 'Other'];
const UNITS = ['kg', 'lb', 'g', 'bag', 'bunch', 'box', 'case', 'unit', 'dozen', 'packet', 'L', 'mL'];

export default function CatalogItemMappingReviewPage() {
    const { displayName } = useContext(UserContext);

    const [reviewItems, setReviewItems] = useState([]);
    const [catalogItems, setCatalogItems] = useState([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [statusFilter, setStatusFilter] = useState('pending');

    // Bulk
    const [selected, setSelected] = useState(new Set());
    const [showBulkMap, setShowBulkMap] = useState(false);
    const [bulkCatalogId, setBulkCatalogId] = useState('');

    // Inline create new catalog item
    const [showCreateFor, setShowCreateFor] = useState(null); // review item id
    const [newForm, setNewForm] = useState({ canonicalName: '', category: 'Produce', baseUnit: 'kg', aliases: '' });

    const fetchData = useCallback(async () => {
        setLoading(true);
        try {
            const [revSnap, catSnap] = await Promise.all([
                getDocs(collection(db, 'catalogItemMappingReview')),
                getDocs(collection(db, 'catalogItems')),
            ]);
            setReviewItems(revSnap.docs.map(d => ({ id: d.id, ...d.data() })));
            setCatalogItems(catSnap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => (a.canonicalName || '').localeCompare(b.canonicalName || '')));
        } catch (err) { toast.error('Failed to load'); }
        setLoading(false);
    }, []);

    useEffect(() => { fetchData(); }, [fetchData]);

    // ---------- ACTIONS ----------

    const handleMapExisting = async (review, catalogItemId) => {
        try {
            await updateDoc(doc(db, `vendors/${review.vendorId}/items`, review.itemId), { catalogItemId, updatedAt: serverTimestamp() });
            await updateDoc(doc(db, 'catalogItemMappingReview', review.id), { status: 'mapped', resolvedCatalogItemId: catalogItemId, resolvedAt: serverTimestamp() });
            await logAdminChange({ entityType: 'mappingReview', entityId: review.id, action: 'mapped', changedBy: displayName, metadata: { catalogItemId, vendorId: review.vendorId, itemName: review.itemName } });
            toast.success(`Mapped "${review.itemName}" → ${catalogItemId}`);
            fetchData();
        } catch (err) { toast.error(err.message); }
    };

    const handleCreateAndMap = async (review) => {
        const cid = generateCatalogItemId(newForm.canonicalName);
        if (!cid || !newForm.canonicalName.trim()) { toast.warn('Enter a canonical name'); return; }

        try {
            // Check if catalog item already exists
            const existing = await getDoc(doc(db, 'catalogItems', cid));
            if (existing.exists()) { toast.warn('Catalog item already exists. Map to it instead.'); return; }

            const aliases = newForm.aliases.split(',').map(a => a.trim()).filter(Boolean);
            if (!aliases.includes(review.itemName)) aliases.push(review.itemName);

            await setDoc(doc(db, 'catalogItems', cid), {
                catalogItemId: cid, canonicalName: newForm.canonicalName.trim(),
                normalizedKey: normalizeItemKey(newForm.canonicalName),
                category: newForm.category, baseUnit: newForm.baseUnit,
                packReference: '', aliases, status: 'active',
                createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
            });

            await updateDoc(doc(db, `vendors/${review.vendorId}/items`, review.itemId), { catalogItemId: cid, updatedAt: serverTimestamp() });
            await updateDoc(doc(db, 'catalogItemMappingReview', review.id), { status: 'mapped', resolvedCatalogItemId: cid, resolvedAt: serverTimestamp() });
            await logAdminChange({ entityType: 'mappingReview', entityId: review.id, action: 'mapped', changedBy: displayName, metadata: { catalogItemId: cid, action: 'created_and_mapped' } });

            toast.success(`Created "${newForm.canonicalName}" and mapped`);
            setShowCreateFor(null);
            setNewForm({ canonicalName: '', category: 'Produce', baseUnit: 'kg', aliases: '' });
            fetchData();
        } catch (err) { toast.error(err.message); }
    };

    const handleIgnore = async (review) => {
        try {
            await updateDoc(doc(db, 'catalogItemMappingReview', review.id), { status: 'ignored', resolvedAt: serverTimestamp() });
            await logAdminChange({ entityType: 'mappingReview', entityId: review.id, action: 'ignored', changedBy: displayName, metadata: { itemName: review.itemName } });
            toast.info('Ignored'); fetchData();
        } catch (err) { toast.error(err.message); }
    };

    // ---------- BULK ----------
    const handleBulkMap = async () => {
        if (!bulkCatalogId) { toast.warn('Select a catalog item'); return; }
        const ids = [...selected];
        try {
            for (const id of ids) {
                const r = reviewItems.find(ri => ri.id === id);
                if (!r) continue;
                await updateDoc(doc(db, `vendors/${r.vendorId}/items`, r.itemId), { catalogItemId: bulkCatalogId, updatedAt: serverTimestamp() });
                await updateDoc(doc(db, 'catalogItemMappingReview', id), { status: 'mapped', resolvedCatalogItemId: bulkCatalogId, resolvedAt: serverTimestamp() });
            }
            await logAdminChange({ entityType: 'mappingReview', entityId: 'bulk', action: 'bulk_update', changedBy: displayName, metadata: { ids, catalogItemId: bulkCatalogId } });
            toast.success(`${ids.length} items mapped to ${bulkCatalogId}`);
            setSelected(new Set()); setShowBulkMap(false); setBulkCatalogId(''); fetchData();
        } catch (err) { toast.error(err.message); }
    };

    const handleBulkIgnore = async () => {
        const ids = [...selected];
        try {
            for (const id of ids) await updateDoc(doc(db, 'catalogItemMappingReview', id), { status: 'ignored', resolvedAt: serverTimestamp() });
            await logAdminChange({ entityType: 'mappingReview', entityId: 'bulk', action: 'bulk_update', changedBy: displayName, metadata: { ids, action: 'ignored' } });
            toast.info(`${ids.length} items ignored`);
            setSelected(new Set()); fetchData();
        } catch (err) { toast.error(err.message); }
    };

    const toggleSelect = (id) => { setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; }); };

    // Suggest best catalog matches for a review item
    const getSuggestions = (review) => {
        const key = (review.suggestedNormalizedKey || '').toLowerCase();
        const cat = (review.category || '').toLowerCase();
        return catalogItems.filter(c => {
            if ((c.normalizedKey || '').includes(key) || key.includes(c.normalizedKey || '')) return true;
            if (cat && (c.category || '').toLowerCase() === cat) return true;
            if ((c.aliases || []).some(a => a.toLowerCase().includes(review.itemName?.toLowerCase() || ''))) return true;
            return false;
        }).slice(0, 5);
    };

    const filtered = reviewItems.filter(r => {
        if (statusFilter !== 'all' && r.status !== statusFilter) return false;
        if (search) {
            const q = search.toLowerCase();
            return (r.itemName || '').toLowerCase().includes(q) || (r.vendorName || '').toLowerCase().includes(q) || (r.suggestedNormalizedKey || '').toLowerCase().includes(q);
        }
        return true;
    });

    const statusCounts = { pending: 0, mapped: 0, ignored: 0 };
    reviewItems.forEach(r => { statusCounts[r.status] = (statusCounts[r.status] || 0) + 1; });

    return (
        <div style={{ padding: '24px 32px', maxWidth: 1500, margin: '0 auto', color: '#f8fafc' }}>
            {/* Header */}
            <div style={{ marginBottom: 20 }}>
                <h2 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>🔍 Item Mapping Review</h2>
                <p style={{ margin: '4px 0 0', fontSize: 13, color: '#94a3b8' }}>
                    Resolve vendor items that couldn't be auto-mapped to catalog items
                </p>
            </div>

            {/* Stats */}
            <div style={{ display: 'flex', gap: 12, marginBottom: 20 }}>
                {[
                    { label: 'Pending', value: statusCounts.pending, color: '#fbbf24', icon: '⏳' },
                    { label: 'Mapped', value: statusCounts.mapped, color: '#10b981', icon: '✅' },
                    { label: 'Ignored', value: statusCounts.ignored, color: '#94a3b8', icon: '🚫' },
                    { label: 'Catalog Items', value: catalogItems.length, color: '#38bdf8', icon: '📦' },
                ].map(s => (
                    <div key={s.label} style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 10, padding: '14px 20px', minWidth: 120 }}>
                        <div style={{ fontSize: 22, fontWeight: 700, color: s.color }}>{loading ? '…' : s.value}</div>
                        <div style={{ fontSize: 11, color: '#94a3b8' }}>{s.icon} {s.label}</div>
                    </div>
                ))}
            </div>

            {/* Filters & Bulk */}
            <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
                <input placeholder="Search vendor, item, key..." value={search} onChange={e => setSearch(e.target.value)}
                    style={{ padding: '8px 14px', borderRadius: 8, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: '#f8fafc', outline: 'none', fontSize: 13, width: 220 }} />
                {['pending', 'mapped', 'ignored', 'all'].map(s => (
                    <button key={s} onClick={() => setStatusFilter(s)}
                        style={{ padding: '5px 10px', borderRadius: 14, fontSize: 11, fontWeight: 600, cursor: 'pointer', border: statusFilter === s ? '1px solid #38bdf8' : '1px solid rgba(255,255,255,0.08)', background: statusFilter === s ? 'rgba(56,189,248,0.15)' : 'transparent', color: statusFilter === s ? '#38bdf8' : '#94a3b8' }}>
                        {s.charAt(0).toUpperCase() + s.slice(1)}
                    </button>
                ))}
                <span style={{ fontSize: 12, color: '#64748b' }}>{filtered.length} showing</span>
                {selected.size > 0 && (
                    <div style={{ display: 'flex', gap: 6, marginLeft: 'auto', alignItems: 'center' }}>
                        <span style={{ fontSize: 12, color: '#38bdf8', fontWeight: 600 }}>{selected.size} selected</span>
                        <button onClick={() => setShowBulkMap(true)} style={{ padding: '4px 10px', borderRadius: 6, fontSize: 11, cursor: 'pointer', background: 'rgba(16,185,129,0.15)', color: '#10b981', border: '1px solid rgba(16,185,129,0.3)', fontWeight: 600 }}>Bulk Map</button>
                        <button onClick={handleBulkIgnore} style={{ padding: '4px 10px', borderRadius: 6, fontSize: 11, cursor: 'pointer', background: 'rgba(255,255,255,0.04)', color: '#94a3b8', border: '1px solid rgba(255,255,255,0.08)', fontWeight: 600 }}>Bulk Ignore</button>
                    </div>
                )}
            </div>

            {/* Review Cards */}
            {loading ? (
                <div style={{ padding: 60, textAlign: 'center', color: '#94a3b8' }}>Loading...</div>
            ) : filtered.length === 0 ? (
                <div style={{ padding: 60, textAlign: 'center', color: '#64748b' }}>
                    <div style={{ fontSize: 32, marginBottom: 10 }}>{statusFilter === 'pending' ? '✅' : '📋'}</div>
                    <div>{statusFilter === 'pending' ? 'No pending items! All vendor items are resolved.' : 'No items match your filter.'}</div>
                </div>
            ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {filtered.map(r => {
                        const suggestions = r.status === 'pending' ? getSuggestions(r) : [];
                        const statusColor = r.status === 'mapped' ? '#10b981' : r.status === 'ignored' ? '#94a3b8' : '#fbbf24';
                        const isCreating = showCreateFor === r.id;

                        return (
                            <div key={r.id} style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 10, padding: 18 }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                                    {/* Left: item info */}
                                    <div style={{ display: 'flex', gap: 10, alignItems: 'center', flex: 1 }}>
                                        {r.status === 'pending' && (
                                            <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggleSelect(r.id)} style={{ cursor: 'pointer' }} />
                                        )}
                                        <div>
                                            <div style={{ fontWeight: 600, fontSize: 14, color: '#f8fafc' }}>{r.itemName}</div>
                                            <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 2 }}>
                                                <span style={{ color: '#64748b' }}>Vendor:</span> <strong>{r.vendorName}</strong>
                                                {r.category && <> • <span>{r.category}</span></>}
                                            </div>
                                            {r.suggestedNormalizedKey && (
                                                <div style={{ fontSize: 11, fontFamily: 'monospace', color: '#64748b', marginTop: 2 }}>Key: {r.suggestedNormalizedKey}</div>
                                            )}
                                        </div>
                                    </div>

                                    {/* Right: status + actions */}
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                                        <span style={{ fontSize: 11, fontWeight: 700, color: statusColor }}>● {r.status}</span>
                                        {r.status === 'pending' && (
                                            <>
                                                <select onChange={e => { if (e.target.value) handleMapExisting(r, e.target.value); }} defaultValue=""
                                                    style={{ padding: '5px 8px', borderRadius: 6, fontSize: 11, background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.1)', color: '#f8fafc', outline: 'none', maxWidth: 180 }}>
                                                    <option value="">Map to existing…</option>
                                                    {catalogItems.map(c => <option key={c.catalogItemId} value={c.catalogItemId}>{c.canonicalName}</option>)}
                                                </select>
                                                <button onClick={() => { setShowCreateFor(isCreating ? null : r.id); setNewForm({ canonicalName: r.itemName, category: r.category || 'Produce', baseUnit: 'kg', aliases: '' }); }}
                                                    style={{ padding: '5px 10px', borderRadius: 6, fontSize: 11, cursor: 'pointer', background: 'rgba(56,189,248,0.1)', color: '#38bdf8', border: '1px solid rgba(56,189,248,0.2)', fontWeight: 600 }}>
                                                    {isCreating ? 'Cancel' : '+ Create New'}
                                                </button>
                                                <button onClick={() => handleIgnore(r)} style={{ padding: '5px 10px', borderRadius: 6, fontSize: 11, cursor: 'pointer', background: 'rgba(255,255,255,0.04)', color: '#94a3b8', border: '1px solid rgba(255,255,255,0.08)', fontWeight: 600 }}>Ignore</button>
                                            </>
                                        )}
                                        {r.status === 'mapped' && r.resolvedCatalogItemId && (
                                            <span style={{ fontSize: 11, color: '#10b981', fontFamily: 'monospace' }}>→ {r.resolvedCatalogItemId}</span>
                                        )}
                                    </div>
                                </div>

                                {/* Suggestions strip */}
                                {suggestions.length > 0 && !isCreating && (
                                    <div style={{ marginTop: 10, display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                                        <span style={{ fontSize: 10, color: '#64748b' }}>Suggestions:</span>
                                        {suggestions.map(s => (
                                            <button key={s.catalogItemId} onClick={() => handleMapExisting(r, s.catalogItemId)}
                                                style={{ padding: '3px 8px', borderRadius: 5, fontSize: 10, cursor: 'pointer', background: 'rgba(16,185,129,0.08)', color: '#10b981', border: '1px solid rgba(16,185,129,0.15)', fontWeight: 600 }}>
                                                {s.canonicalName}
                                            </button>
                                        ))}
                                    </div>
                                )}

                                {/* Inline create form */}
                                {isCreating && (
                                    <div style={{ marginTop: 12, padding: 14, background: 'rgba(56,189,248,0.04)', border: '1px solid rgba(56,189,248,0.12)', borderRadius: 8 }}>
                                        <div style={{ fontSize: 12, fontWeight: 600, color: '#38bdf8', marginBottom: 10 }}>Create New Catalog Item & Map</div>
                                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
                                            <div><label style={{ fontSize: 10, color: '#94a3b8', display: 'block', marginBottom: 2 }}>Canonical Name *</label>
                                                <input value={newForm.canonicalName} onChange={e => setNewForm(f => ({ ...f, canonicalName: e.target.value }))} style={formInp} /></div>
                                            <div><label style={{ fontSize: 10, color: '#94a3b8', display: 'block', marginBottom: 2 }}>Category</label>
                                                <select value={newForm.category} onChange={e => setNewForm(f => ({ ...f, category: e.target.value }))} style={formSel}>
                                                    {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}</select></div>
                                            <div><label style={{ fontSize: 10, color: '#94a3b8', display: 'block', marginBottom: 2 }}>Base Unit</label>
                                                <select value={newForm.baseUnit} onChange={e => setNewForm(f => ({ ...f, baseUnit: e.target.value }))} style={formSel}>
                                                    {UNITS.map(u => <option key={u} value={u}>{u}</option>)}</select></div>
                                        </div>
                                        <div style={{ marginTop: 8 }}>
                                            <label style={{ fontSize: 10, color: '#94a3b8', display: 'block', marginBottom: 2 }}>Aliases (comma-separated)</label>
                                            <input value={newForm.aliases} onChange={e => setNewForm(f => ({ ...f, aliases: e.target.value }))} style={formInp} placeholder="Cooking Onion, Yellow Onion" />
                                        </div>
                                        <div style={{ display: 'flex', gap: 8, marginTop: 10, justifyContent: 'flex-end' }}>
                                            <button onClick={() => setShowCreateFor(null)} style={{ padding: '5px 12px', borderRadius: 6, fontSize: 11, background: 'rgba(255,255,255,0.05)', color: '#94a3b8', border: '1px solid rgba(255,255,255,0.08)', cursor: 'pointer' }}>Cancel</button>
                                            <button onClick={() => handleCreateAndMap(r)} style={{ padding: '5px 12px', borderRadius: 6, fontSize: 11, background: '#10b981', color: '#fff', border: 'none', cursor: 'pointer', fontWeight: 600 }}>Create & Map</button>
                                        </div>
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}

            {/* Bulk Map Modal */}
            {showBulkMap && (
                <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <div style={{ background: '#0f172a', borderRadius: 14, padding: 28, width: 400, border: '1px solid rgba(255,255,255,0.1)', textAlign: 'center' }}>
                        <h3 style={{ margin: '0 0 10px' }}>🔗 Bulk Map {selected.size} Items</h3>
                        <p style={{ fontSize: 13, color: '#94a3b8' }}>Select a catalog item to map all selected vendor items to:</p>
                        <select value={bulkCatalogId} onChange={e => setBulkCatalogId(e.target.value)}
                            style={{ width: '100%', padding: '8px 12px', borderRadius: 8, background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(255,255,255,0.1)', color: '#f8fafc', outline: 'none', fontSize: 13, marginTop: 12 }}>
                            <option value="">Select catalog item...</option>
                            {catalogItems.map(c => <option key={c.catalogItemId} value={c.catalogItemId}>{c.canonicalName} ({c.category})</option>)}
                        </select>
                        <div style={{ display: 'flex', gap: 10, justifyContent: 'center', marginTop: 20 }}>
                            <button onClick={() => { setShowBulkMap(false); setBulkCatalogId(''); }} style={{ padding: '8px 18px', borderRadius: 8, background: 'rgba(255,255,255,0.05)', color: '#94a3b8', border: '1px solid rgba(255,255,255,0.08)', cursor: 'pointer', fontSize: 13 }}>Cancel</button>
                            <button onClick={handleBulkMap} disabled={!bulkCatalogId} style={{ padding: '8px 18px', borderRadius: 8, background: '#10b981', color: '#fff', border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600, opacity: bulkCatalogId ? 1 : 0.5 }}>Confirm Map</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

const formInp = { width: '100%', padding: '6px 10px', borderRadius: 6, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: '#f8fafc', outline: 'none', fontSize: 12, boxSizing: 'border-box' };
const formSel = { width: '100%', padding: '6px 10px', borderRadius: 6, background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(255,255,255,0.1)', color: '#f8fafc', outline: 'none', fontSize: 12, boxSizing: 'border-box' };
