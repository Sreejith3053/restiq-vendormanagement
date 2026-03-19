import React, { useState, useEffect, useCallback, useContext } from 'react';
import { db } from '../../firebase';
import { collection, getDocs, doc, getDoc, setDoc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { UserContext } from '../../contexts/UserContext';
import { generateCatalogItemId, normalizeItemKey, validateCatalogItem } from '../../utils/catalogUtils';
import { migrateCatalogItems } from '../../utils/migrateCatalogItems';
import { logAdminChange } from '../../utils/adminAuditLogger';
import { toast } from 'react-toastify';
import CatalogMergeModal from '../CatalogReview/CatalogMergeModal';

const CATEGORIES = ['Produce', 'Meat', 'Seafood', 'Dairy', 'Spices', 'Grains', 'Beverages', 'Packaging', 'Cleaning', 'Other'];
const UNITS = ['kg', 'lb', 'g', 'bag', 'bunch', 'box', 'case', 'unit', 'dozen', 'packet', 'L', 'mL'];
const STORAGE_TYPES = ['ambient', 'refrigerated', 'frozen', 'dry'];

export default function ManageCatalogPage() {
    const { displayName } = useContext(UserContext);

    const [catalogItems, setCatalogItems] = useState([]);
    const [vendorItemsMap, setVendorItemsMap] = useState({});
    const [unmappedItems, setUnmappedItems] = useState([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [catFilter, setCatFilter] = useState('all');
    const [statusFilter, setStatusFilter] = useState('all');

    // Modals
    const [showModal, setShowModal] = useState(false);
    const [editingId, setEditingId] = useState(null);
    const [form, setForm] = useState(getEmptyForm());
    const [showMapModal, setShowMapModal] = useState(null);
    const [detailId, setDetailId] = useState(null);

    // Bulk
    const [selected, setSelected] = useState(new Set());
    const [showBulkConfirm, setShowBulkConfirm] = useState(null);
    const [bulkCategory, setBulkCategory] = useState('');

    // Migration
    const [migrating, setMigrating] = useState(false);
    const [migrationLog, setMigrationLog] = useState([]);
    const [showMergeModal, setShowMergeModal] = useState(false);

    function getEmptyForm() {
        return {
            catalogItemId: '', canonicalName: '', normalizedKey: '', category: 'Produce',
            subCategory: '', baseUnit: 'kg', packReference: '', defaultPackSize: '',
            defaultStorageType: 'ambient', aliases: '', searchKeywords: '',
            description: '', imageUrl: '', status: 'active',
        };
    }

    const fetchData = useCallback(async () => {
        setLoading(true);
        try {
            const catSnap = await getDocs(collection(db, 'catalogItems'));
            const catData = catSnap.docs.map(d => ({ id: d.id, ...d.data() }));
            setCatalogItems(catData.sort((a, b) => (a.canonicalName || '').localeCompare(b.canonicalName || '')));

            const vendorsSnap = await getDocs(collection(db, 'vendors'));
            const viMap = {};
            const unmapped = [];

            for (const vDoc of vendorsSnap.docs) {
                const vendorName = vDoc.data().name || vDoc.data().companyName || vDoc.id;
                const itemsSnap = await getDocs(collection(db, `vendors/${vDoc.id}/items`));
                itemsSnap.docs.forEach(iDoc => {
                    const item = iDoc.data();
                    const itemName = item.itemName || item.name || '';     // v2-first
                    const cid = item.catalogItemId;
                    const entry = {
                        vendorId: vDoc.id, vendorName, itemDocId: iDoc.id, itemName,
                        price: item.vendorPrice ?? item.price ?? 0,         // v2-first
                        unit:  item.baseUnit || item.unit || '',            // v2-first
                        packSize: item.packQuantity || '',
                    };
                    if (cid) { if (!viMap[cid]) viMap[cid] = []; viMap[cid].push(entry); }
                    else if (itemName) unmapped.push(entry);
                });
            }
            setVendorItemsMap(viMap);
            setUnmappedItems(unmapped);
        } catch (err) { toast.error('Failed to load catalog'); }
        setLoading(false);
    }, []);

    useEffect(() => { fetchData(); }, [fetchData]);

    // ---------- SAVE ----------
    const handleSave = async () => {
        const cid = form.catalogItemId || generateCatalogItemId(form.canonicalName);
        const aliases = form.aliases.split(',').map(a => a.trim()).filter(Boolean);
        const aliasNormalized = aliases.map(a => a.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim());
        const searchKeywords = form.searchKeywords.split(',').map(a => a.trim()).filter(Boolean);
        const canonicalNameNormalized = (form.canonicalName || '').toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
        const docData = {
            ...form, catalogItemId: cid,
            normalizedKey: normalizeItemKey(form.canonicalName),
            canonicalNameNormalized,
            aliases,
            aliasNormalized,
            searchKeywords,
        };
        const { valid, errors } = validateCatalogItem(docData);
        if (!valid) { toast.warn(errors[0]); return; }

        try {
            if (editingId) {
                await updateDoc(doc(db, 'catalogItems', editingId), { ...docData, updatedAt: serverTimestamp() });
                await logAdminChange({ entityType: 'catalogItem', entityId: editingId, action: 'updated', changedBy: displayName });
                toast.success('Catalog item updated');
            } else {
                const existing = await getDoc(doc(db, 'catalogItems', cid));
                if (existing.exists()) { toast.warn('Catalog item ID already exists'); return; }
                await setDoc(doc(db, 'catalogItems', cid), { ...docData, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
                await logAdminChange({ entityType: 'catalogItem', entityId: cid, action: 'created', changedBy: displayName });
                toast.success('Catalog item created');
            }
            setShowModal(false); setEditingId(null); setForm(getEmptyForm()); fetchData();
        } catch (err) { toast.error('Save failed: ' + err.message); }
    };

    const handleEdit = (item) => {
        setForm({
            catalogItemId: item.catalogItemId || item.id, canonicalName: item.canonicalName || '',
            normalizedKey: item.normalizedKey || '', category: item.category || 'Produce',
            subCategory: item.subCategory || '', baseUnit: item.baseUnit || 'kg',
            packReference: item.packReference || '', defaultPackSize: item.defaultPackSize || '',
            defaultStorageType: item.defaultStorageType || 'ambient',
            aliases: (item.aliases || []).join(', '), searchKeywords: (item.searchKeywords || []).join(', '),
            description: item.description || '', imageUrl: item.imageUrl || '',
            status: item.status || 'active',
        });
        setEditingId(item.id); setShowModal(true);
    };

    const handleToggleStatus = async (item) => {
        const n = item.status === 'active' ? 'inactive' : 'active';
        try {
            await updateDoc(doc(db, 'catalogItems', item.id), { status: n, updatedAt: serverTimestamp() });
            await logAdminChange({ entityType: 'catalogItem', entityId: item.id, action: 'status_changed', changedBy: displayName, changedFields: { status: { from: item.status, to: n } } });
            toast.success(`${item.canonicalName} → ${n}`); fetchData();
        } catch (err) { toast.error(err.message); }
    };

    const handleLinkVendorItem = async (vendorItem, catalogItemId) => {
        try {
            await updateDoc(doc(db, `vendors/${vendorItem.vendorId}/items`, vendorItem.itemDocId), { catalogItemId, updatedAt: serverTimestamp() });
            await logAdminChange({ entityType: 'vendorItem', entityId: vendorItem.itemDocId, action: 'mapped', changedBy: displayName, metadata: { catalogItemId, vendorId: vendorItem.vendorId } });
            toast.success(`Linked "${vendorItem.itemName}" → ${catalogItemId}`); fetchData();
        } catch (err) { toast.error(err.message); }
    };

    // ---------- BULK ----------
    const handleBulkAction = async (action) => {
        const ids = [...selected];
        try {
            if (action === 'activate' || action === 'deactivate') {
                const ns = action === 'activate' ? 'active' : 'inactive';
                for (const id of ids) await updateDoc(doc(db, 'catalogItems', id), { status: ns, updatedAt: serverTimestamp() });
                await logAdminChange({ entityType: 'catalogItem', entityId: 'bulk', action: 'bulk_update', changedBy: displayName, metadata: { ids, action: ns } });
                toast.success(`${ids.length} items → ${ns}`);
            } else if (action === 'category' && bulkCategory) {
                for (const id of ids) await updateDoc(doc(db, 'catalogItems', id), { category: bulkCategory, updatedAt: serverTimestamp() });
                await logAdminChange({ entityType: 'catalogItem', entityId: 'bulk', action: 'bulk_update', changedBy: displayName, metadata: { ids, category: bulkCategory } });
                toast.success(`${ids.length} items → ${bulkCategory}`);
            }
            setSelected(new Set()); setShowBulkConfirm(null); setBulkCategory(''); fetchData();
        } catch (err) { toast.error(err.message); }
    };

    const handleMigrate = async () => {
        setMigrating(true); setMigrationLog([]);
        try {
            const result = await migrateCatalogItems((msg) => setMigrationLog(prev => [...prev, msg]));
            toast.success(`Migration: ${result.catalogCreated} created, ${result.vendorItemsLinked} linked`); fetchData();
        } catch (err) { toast.error('Migration error: ' + err.message); }
        setMigrating(false);
    };

    const toggleSelect = (id) => { setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; }); };
    const toggleSelectAll = () => { if (selected.size === filtered.length) setSelected(new Set()); else setSelected(new Set(filtered.map(r => r.id))); };

    const filtered = catalogItems.filter(item => {
        if (catFilter !== 'all' && item.category !== catFilter) return false;
        if (statusFilter !== 'all' && item.status !== statusFilter) return false;
        if (search) {
            const q = search.toLowerCase();
            return (item.canonicalName || '').toLowerCase().includes(q) || (item.catalogItemId || '').toLowerCase().includes(q) || (item.normalizedKey || '').toLowerCase().includes(q) || (item.aliases || []).some(a => a.toLowerCase().includes(q));
        }
        return true;
    });

    const detailItem = detailId ? catalogItems.find(c => c.id === detailId) : null;
    const detailVendors = detailId ? (vendorItemsMap[detailItem?.catalogItemId] || []) : [];
    const catColors = { Produce: '#34d399', Meat: '#f87171', Seafood: '#38bdf8', Dairy: '#fbbf24', Spices: '#fb923c', Packaging: '#818cf8', Cleaning: '#a78bfa', Grains: '#f59e0b', Beverages: '#22d3ee', Other: '#94a3b8' };

    return (
        <div style={{ padding: '24px 32px', maxWidth: 1500, margin: '0 auto', color: '#f8fafc' }}>
            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
                <div>
                    <h2 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>📦 Catalog Items</h2>
                    <p style={{ margin: '4px 0 0', fontSize: 13, color: '#94a3b8' }}>{catalogItems.length} items • {unmappedItems.length} unmapped vendor items</p>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                    <button onClick={handleMigrate} disabled={migrating} style={{ padding: '8px 14px', borderRadius: 8, background: 'rgba(56,189,248,0.1)', color: '#38bdf8', border: '1px solid rgba(56,189,248,0.2)', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
                        {migrating ? '⏳ Migrating...' : '🔄 Auto-Populate from Vendors'}
                    </button>
                    <button onClick={() => setShowMergeModal(true)} style={{ padding: '8px 14px', borderRadius: 8, background: 'rgba(168,85,247,0.1)', color: '#a855f7', border: '1px solid rgba(168,85,247,0.2)', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
                        🔀 Merge Items
                    </button>
                    <button onClick={() => { setForm(getEmptyForm()); setEditingId(null); setShowModal(true); }} style={{ padding: '8px 14px', borderRadius: 8, background: '#10b981', color: '#fff', border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>+ Add Catalog Item</button>
                </div>
            </div>

            {/* Migration Log */}
            {migrationLog.length > 0 && (
                <div style={{ background: 'rgba(56,189,248,0.05)', border: '1px solid rgba(56,189,248,0.15)', borderRadius: 10, padding: 14, marginBottom: 16, maxHeight: 120, overflowY: 'auto' }}>
                    {migrationLog.map((msg, i) => <div key={i} style={{ fontSize: 11, color: '#94a3b8', marginBottom: 1 }}>→ {msg}</div>)}
                </div>
            )}

            {/* Unmapped Alert */}
            {unmappedItems.length > 0 && (
                <div style={{ background: 'rgba(251,191,36,0.06)', border: '1px solid rgba(251,191,36,0.15)', borderRadius: 10, padding: 14, marginBottom: 16 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: '#fbbf24', marginBottom: 6 }}>⚠️ {unmappedItems.length} Unmapped Vendor Items</div>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', maxHeight: 50, overflowY: 'auto' }}>
                        {unmappedItems.slice(0, 15).map((vi, i) => (
                            <span key={i} style={{ fontSize: 10, padding: '2px 6px', borderRadius: 5, background: 'rgba(251,191,36,0.1)', color: '#fbbf24', fontWeight: 600 }}>{vi.vendorName}: {vi.itemName}</span>
                        ))}
                        {unmappedItems.length > 15 && <span style={{ fontSize: 10, color: '#94a3b8' }}>+{unmappedItems.length - 15} more</span>}
                    </div>
                </div>
            )}

            {/* Filters & Bulk */}
            <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
                <input placeholder="Search name, ID, alias..." value={search} onChange={e => setSearch(e.target.value)} style={inputStyle} />
                <button onClick={() => setCatFilter('all')} style={pillStyle(catFilter === 'all', '#38bdf8')}>All</button>
                {CATEGORIES.filter(c => catalogItems.some(i => i.category === c)).map(c => (
                    <button key={c} onClick={() => setCatFilter(catFilter === c ? 'all' : c)} style={pillStyle(catFilter === c, catColors[c])}>{c}</button>
                ))}
                <button onClick={() => setStatusFilter(statusFilter === 'active' ? 'inactive' : statusFilter === 'inactive' ? 'all' : 'active')}
                    style={pillStyle(statusFilter !== 'all', statusFilter === 'active' ? '#10b981' : '#94a3b8')}>
                    {statusFilter === 'all' ? 'Any status' : statusFilter}
                </button>
                <span style={{ fontSize: 12, color: '#64748b' }}>{filtered.length} showing</span>
                {selected.size > 0 && (
                    <div style={{ display: 'flex', gap: 6, marginLeft: 'auto', alignItems: 'center' }}>
                        <span style={{ fontSize: 12, color: '#38bdf8', fontWeight: 600 }}>{selected.size} selected</span>
                        <button onClick={() => setShowBulkConfirm('activate')} style={bulkBtnStyle('#10b981')}>Bulk Activate</button>
                        <button onClick={() => setShowBulkConfirm('deactivate')} style={bulkBtnStyle('#f43f5e')}>Bulk Deactivate</button>
                        <button onClick={() => setShowBulkConfirm('category')} style={bulkBtnStyle('#a78bfa')}>Bulk Category</button>
                    </div>
                )}
            </div>

            {/* Table + Detail */}
            <div style={{ display: 'flex', gap: 16 }}>
                <div style={{ flex: detailId ? '0 0 65%' : '1 1 100%', background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 12, overflow: 'hidden', transition: 'flex 0.2s' }}>
                    {loading ? <div style={{ padding: 60, textAlign: 'center', color: '#94a3b8' }}>Loading...</div> : (
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                            <thead><tr style={{ background: 'rgba(255,255,255,0.04)', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                                <th style={{ padding: '8px 10px', width: 30 }}><input type="checkbox" checked={selected.size === filtered.length && filtered.length > 0} onChange={toggleSelectAll} style={{ cursor: 'pointer' }} /></th>
                                {['Item', 'ID', 'Category', 'Unit', 'Aliases', 'Vendors', 'Status', 'Actions'].map(h => (
                                    <th key={h} style={{ padding: '8px 12px', textAlign: 'left', fontSize: 11, color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase' }}>{h}</th>
                                ))}
                            </tr></thead>
                            <tbody>
                                {filtered.map(item => {
                                    const linked = vendorItemsMap[item.catalogItemId] || [];
                                    return (
                                        <tr key={item.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)', background: detailId === item.id ? 'rgba(56,189,248,0.05)' : 'transparent', cursor: 'pointer' }}
                                            onClick={() => setDetailId(detailId === item.id ? null : item.id)}>
                                            <td style={{ padding: '8px 10px' }} onClick={e => e.stopPropagation()}><input type="checkbox" checked={selected.has(item.id)} onChange={() => toggleSelect(item.id)} style={{ cursor: 'pointer' }} /></td>
                                            <td style={{ padding: '8px 12px', fontWeight: 600, color: '#f8fafc' }}>{item.canonicalName}</td>
                                            <td style={{ padding: '8px 12px', fontFamily: 'monospace', fontSize: 11, color: '#64748b' }}>{item.catalogItemId}</td>
                                            <td style={{ padding: '8px 12px' }}><span style={{ fontSize: 10, fontWeight: 600, padding: '2px 6px', borderRadius: 5, background: (catColors[item.category] || '#94a3b8') + '18', color: catColors[item.category] || '#94a3b8' }}>{item.category}</span></td>
                                            <td style={{ padding: '8px 12px', color: '#94a3b8' }}>{item.baseUnit}</td>
                                            <td style={{ padding: '8px 12px', maxWidth: 160 }}>
                                                <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
                                                    {(item.aliases || []).slice(0, 3).map((a, i) => <span key={i} style={{ fontSize: 9, padding: '1px 5px', borderRadius: 3, background: 'rgba(255,255,255,0.05)', color: '#64748b' }}>{a}</span>)}
                                                    {(item.aliases || []).length > 3 && <span style={{ fontSize: 9, color: '#64748b' }}>+{item.aliases.length - 3}</span>}
                                                </div>
                                            </td>
                                            <td style={{ padding: '8px 12px' }} onClick={e => e.stopPropagation()}>
                                                <button onClick={() => setShowMapModal(item.catalogItemId)} style={{ padding: '2px 7px', borderRadius: 5, fontSize: 11, fontWeight: 700, cursor: 'pointer', background: linked.length > 0 ? 'rgba(56,189,248,0.1)' : 'rgba(255,255,255,0.04)', color: linked.length > 0 ? '#38bdf8' : '#64748b', border: 'none' }}>
                                                    {linked.length} vendor{linked.length !== 1 ? 's' : ''}
                                                </button>
                                            </td>
                                            <td style={{ padding: '8px 12px' }}><span style={{ fontSize: 11, fontWeight: 700, color: item.status === 'active' ? '#10b981' : '#94a3b8' }}>● {item.status || 'active'}</span></td>
                                            <td style={{ padding: '8px 12px' }} onClick={e => e.stopPropagation()}>
                                                <div style={{ display: 'flex', gap: 4 }}>
                                                    <button onClick={() => handleEdit(item)} style={{ padding: '3px 8px', borderRadius: 5, fontSize: 10, cursor: 'pointer', background: 'rgba(56,189,248,0.1)', color: '#38bdf8', border: '1px solid rgba(56,189,248,0.2)', fontWeight: 600 }}>Edit</button>
                                                    <button onClick={() => handleToggleStatus(item)} style={{ padding: '3px 8px', borderRadius: 5, fontSize: 10, cursor: 'pointer', background: 'rgba(255,255,255,0.04)', color: '#94a3b8', border: '1px solid rgba(255,255,255,0.08)', fontWeight: 600 }}>{item.status === 'active' ? 'Deactivate' : 'Activate'}</button>
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })}
                                {filtered.length === 0 && <tr><td colSpan={9} style={{ padding: 40, textAlign: 'center', color: '#64748b' }}>{catalogItems.length === 0 ? 'No catalog items. Run Auto-Populate or add manually.' : 'No items match.'}</td></tr>}
                            </tbody>
                        </table>
                    )}
                </div>

                {/* Detail Panel */}
                {detailItem && (
                    <div style={{ flex: '0 0 33%', background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 12, padding: 20, maxHeight: 'calc(100vh - 220px)', overflowY: 'auto' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
                            <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>{detailItem.canonicalName}</h3>
                            <button onClick={() => setDetailId(null)} style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', fontSize: 16 }}>✕</button>
                        </div>
                        <div style={{ display: 'grid', gap: 8 }}>
                            {[
                                ['Catalog ID', detailItem.catalogItemId], ['Normalized Key', detailItem.normalizedKey],
                                ['Category', detailItem.category], ['Sub-Category', detailItem.subCategory],
                                ['Base Unit', detailItem.baseUnit], ['Pack Ref', detailItem.packReference],
                                ['Pack Size', detailItem.defaultPackSize], ['Storage', detailItem.defaultStorageType],
                                ['Status', detailItem.status],
                            ].map(([l, v]) => (
                                <div key={l} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, borderBottom: '1px solid rgba(255,255,255,0.04)', paddingBottom: 4 }}>
                                    <span style={{ color: '#94a3b8' }}>{l}</span>
                                    <span style={{ color: '#f8fafc', fontWeight: 500 }}>{v || '—'}</span>
                                </div>
                            ))}
                        </div>
                        {(detailItem.aliases || []).length > 0 && (
                            <div style={{ marginTop: 12 }}>
                                <div style={{ fontSize: 11, fontWeight: 600, color: '#94a3b8', marginBottom: 4 }}>Aliases</div>
                                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                                    {detailItem.aliases.map((a, i) => <span key={i} style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4, background: 'rgba(255,255,255,0.05)', color: '#94a3b8' }}>{a}</span>)}
                                </div>
                            </div>
                        )}
                        {/* Linked Vendors */}
                        <div style={{ marginTop: 16, padding: 14, background: 'rgba(56,189,248,0.05)', border: '1px solid rgba(56,189,248,0.1)', borderRadius: 8 }}>
                            <div style={{ fontSize: 11, fontWeight: 700, color: '#38bdf8', marginBottom: 8 }}>🏷️ Linked Vendors ({detailVendors.length})</div>
                            {detailVendors.length > 0 ? detailVendors.map((vi, i) => (
                                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '5px 0', borderBottom: i < detailVendors.length - 1 ? '1px solid rgba(56,189,248,0.08)' : 'none' }}>
                                    <div><strong style={{ color: '#f8fafc' }}>{vi.vendorName}</strong><span style={{ color: '#64748b', marginLeft: 6, fontSize: 11 }}>{vi.itemName}</span></div>
                                    <div style={{ color: '#10b981', fontWeight: 700 }}>${vi.price}{vi.unit ? `/${vi.unit}` : ''}</div>
                                </div>
                            )) : <div style={{ fontSize: 12, color: '#64748b' }}>No vendor items linked yet</div>}
                        </div>
                        {detailItem.description && <div style={{ marginTop: 10, fontSize: 12, color: '#64748b', fontStyle: 'italic' }}>📝 {detailItem.description}</div>}
                    </div>
                )}
            </div>

            {/* Add/Edit Modal */}
            {showModal && (
                <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => setShowModal(false)}>
                    <div onClick={e => e.stopPropagation()} style={{ background: '#0f172a', borderRadius: 16, padding: 28, width: 600, maxHeight: '88vh', overflowY: 'auto', border: '1px solid rgba(255,255,255,0.1)' }}>
                        <h3 style={{ margin: '0 0 18px', fontSize: 18, fontWeight: 700 }}>{editingId ? '✏️ Edit Catalog Item' : '➕ Add Catalog Item'}</h3>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                            <div><label style={lbl}>Canonical Name *</label><input value={form.canonicalName} onChange={e => setForm(f => ({ ...f, canonicalName: e.target.value, catalogItemId: editingId ? f.catalogItemId : generateCatalogItemId(e.target.value), normalizedKey: normalizeItemKey(e.target.value) }))} style={inp} /></div>
                            <div><label style={lbl}>Catalog ID</label><input value={form.catalogItemId} readOnly style={{ ...inp, color: '#64748b', background: 'rgba(255,255,255,0.02)' }} /></div>
                            <div><label style={lbl}>Category *</label><select value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))} style={sel}>{CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}</select></div>
                            <div><label style={lbl}>Sub-Category</label><input value={form.subCategory} onChange={e => setForm(f => ({ ...f, subCategory: e.target.value }))} style={inp} placeholder="e.g. Root Vegetables" /></div>
                            <div><label style={lbl}>Base Unit</label><select value={form.baseUnit} onChange={e => setForm(f => ({ ...f, baseUnit: e.target.value }))} style={sel}>{UNITS.map(u => <option key={u} value={u}>{u}</option>)}</select></div>
                            <div><label style={lbl}>Default Pack Size</label><input value={form.defaultPackSize} onChange={e => setForm(f => ({ ...f, defaultPackSize: e.target.value }))} style={inp} placeholder="e.g. 50lb" /></div>
                            <div><label style={lbl}>Pack Reference</label><input value={form.packReference} onChange={e => setForm(f => ({ ...f, packReference: e.target.value }))} style={inp} placeholder="e.g. 50lb bag" /></div>
                            <div><label style={lbl}>Storage Type</label><select value={form.defaultStorageType} onChange={e => setForm(f => ({ ...f, defaultStorageType: e.target.value }))} style={sel}>{STORAGE_TYPES.map(s => <option key={s} value={s}>{s}</option>)}</select></div>
                            <div><label style={lbl}>Status</label><select value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))} style={sel}><option value="active">active</option><option value="inactive">inactive</option></select></div>
                        </div>
                        <div style={{ marginTop: 12 }}><label style={lbl}>Aliases (comma-separated)</label><input value={form.aliases} onChange={e => setForm(f => ({ ...f, aliases: e.target.value }))} style={inp} placeholder="Cooking Onion, Yellow Onion" /></div>
                        <div style={{ marginTop: 12 }}><label style={lbl}>Search Keywords (comma-separated)</label><input value={form.searchKeywords} onChange={e => setForm(f => ({ ...f, searchKeywords: e.target.value }))} style={inp} placeholder="onion, produce, root" /></div>
                        <div style={{ marginTop: 12 }}><label style={lbl}>Description</label><textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} rows={2} style={{ ...inp, resize: 'vertical' }} /></div>
                        <div style={{ marginTop: 12 }}><label style={lbl}>Image URL</label><input value={form.imageUrl} onChange={e => setForm(f => ({ ...f, imageUrl: e.target.value }))} style={inp} placeholder="https://..." /></div>
                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 20, paddingTop: 14, borderTop: '1px solid rgba(255,255,255,0.08)' }}>
                            <button onClick={() => setShowModal(false)} style={cancelBtn}>Cancel</button>
                            <button onClick={handleSave} style={saveBtn}>{editingId ? '💾 Update' : '💾 Create'}</button>
                        </div>
                    </div>
                </div>
            )}

            {/* Vendor Map Modal */}
            {showMapModal && (
                <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => setShowMapModal(null)}>
                    <div onClick={e => e.stopPropagation()} style={{ background: '#0f172a', borderRadius: 16, padding: 28, width: 580, maxHeight: '85vh', overflowY: 'auto', border: '1px solid rgba(255,255,255,0.1)' }}>
                        <h3 style={{ margin: '0 0 6px', fontSize: 16, fontWeight: 700 }}>🔗 Vendor Item Mapping</h3>
                        <p style={{ fontSize: 12, color: '#94a3b8', margin: '0 0 16px' }}>Catalog: <strong style={{ color: '#38bdf8' }}>{showMapModal}</strong></p>
                        <div style={{ marginBottom: 16 }}>
                            <div style={{ fontSize: 12, fontWeight: 600, color: '#10b981', marginBottom: 6 }}>✓ Linked ({(vendorItemsMap[showMapModal] || []).length})</div>
                            {(vendorItemsMap[showMapModal] || []).map((vi, i) => (
                                <div key={i} style={{ padding: '6px 10px', background: 'rgba(16,185,129,0.06)', border: '1px solid rgba(16,185,129,0.12)', borderRadius: 6, marginBottom: 4, fontSize: 12, display: 'flex', justifyContent: 'space-between' }}>
                                    <span><strong>{vi.vendorName}</strong> → {vi.itemName}</span>
                                    <span style={{ color: '#10b981', fontWeight: 700 }}>${vi.price}</span>
                                </div>
                            ))}
                            {(vendorItemsMap[showMapModal] || []).length === 0 && <div style={{ fontSize: 12, color: '#64748b' }}>No linked items</div>}
                        </div>
                        {unmappedItems.length > 0 && (
                            <div>
                                <div style={{ fontSize: 12, fontWeight: 600, color: '#fbbf24', marginBottom: 6 }}>Unmapped — Click to Link</div>
                                <div style={{ maxHeight: 200, overflowY: 'auto' }}>
                                    {unmappedItems.map((vi, i) => (
                                        <div key={i} style={{ padding: '6px 10px', background: 'rgba(251,191,36,0.04)', border: '1px solid rgba(251,191,36,0.08)', borderRadius: 6, marginBottom: 3, fontSize: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                            <span><strong>{vi.vendorName}</strong> → {vi.itemName}</span>
                                            <button onClick={() => handleLinkVendorItem(vi, showMapModal)} style={{ padding: '3px 8px', borderRadius: 5, fontSize: 10, fontWeight: 700, cursor: 'pointer', background: 'rgba(16,185,129,0.15)', color: '#10b981', border: '1px solid rgba(16,185,129,0.3)' }}>Link</button>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 14 }}>
                            <button onClick={() => setShowMapModal(null)} style={cancelBtn}>Close</button>
                        </div>
                    </div>
                </div>
            )}

            {/* Bulk Confirm */}
            {showBulkConfirm && (
                <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <div style={{ background: '#0f172a', borderRadius: 14, padding: 28, width: 400, border: '1px solid rgba(255,255,255,0.1)', textAlign: 'center' }}>
                        <h3 style={{ margin: '0 0 10px' }}>{showBulkConfirm === 'category' ? '📂 Bulk Category Update' : showBulkConfirm === 'activate' ? '✅ Bulk Activate' : '⛔ Bulk Deactivate'}</h3>
                        <p style={{ fontSize: 13, color: '#94a3b8' }}>{selected.size} items selected</p>
                        {showBulkConfirm === 'category' && (
                            <select value={bulkCategory} onChange={e => setBulkCategory(e.target.value)} style={{ ...sel, marginTop: 10, maxWidth: 200 }}>
                                <option value="">Select category...</option>
                                {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                            </select>
                        )}
                        <div style={{ display: 'flex', gap: 10, justifyContent: 'center', marginTop: 20 }}>
                            <button onClick={() => { setShowBulkConfirm(null); setBulkCategory(''); }} style={cancelBtn}>Cancel</button>
                            <button onClick={() => handleBulkAction(showBulkConfirm)} disabled={showBulkConfirm === 'category' && !bulkCategory} style={{ ...saveBtn, background: showBulkConfirm === 'deactivate' ? '#f43f5e' : '#10b981' }}>Confirm</button>
                        </div>
                    </div>
                </div>
            )}

            {/* Merge Modal */}
            {showMergeModal && (
                <CatalogMergeModal
                    onClose={() => setShowMergeModal(false)}
                    onMerged={() => { setShowMergeModal(false); fetchData(); }}
                />
            )}
        </div>
    );
}

const inputStyle = { padding: '8px 14px', borderRadius: 8, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: '#f8fafc', outline: 'none', fontSize: 13, width: 220 };
const lbl = { fontSize: 11, color: '#94a3b8', display: 'block', marginBottom: 4, fontWeight: 600 };
const inp = { width: '100%', padding: '8px 12px', borderRadius: 8, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: '#f8fafc', outline: 'none', fontSize: 13, boxSizing: 'border-box' };
const sel = { width: '100%', padding: '8px 12px', borderRadius: 8, background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(255,255,255,0.1)', color: '#f8fafc', outline: 'none', fontSize: 13, boxSizing: 'border-box' };
const cancelBtn = { padding: '8px 18px', borderRadius: 8, background: 'rgba(255,255,255,0.05)', color: '#94a3b8', border: '1px solid rgba(255,255,255,0.08)', cursor: 'pointer', fontSize: 13 };
const saveBtn = { padding: '8px 18px', borderRadius: 8, background: '#10b981', color: '#fff', border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600 };
function pillStyle(active, color) {
    return { padding: '5px 10px', borderRadius: 14, fontSize: 11, fontWeight: 600, cursor: 'pointer', border: active ? `1px solid ${color}` : '1px solid rgba(255,255,255,0.08)', background: active ? `${color}18` : 'transparent', color: active ? color : '#94a3b8' };
}
function bulkBtnStyle(c) {
    return { padding: '4px 10px', borderRadius: 6, fontSize: 11, cursor: 'pointer', background: `${c}18`, color: c, border: `1px solid ${c}33`, fontWeight: 600 };
}
