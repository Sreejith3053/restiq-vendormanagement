/**
 * ItemCatalogPage.js — Enhanced Vendor Catalog
 *
 * Features:
 * - Sort by name, category, price, updatedAt
 * - Filter by status (Active/Inactive) and category
 * - Pagination (50 per page)
 * - Import Catalog, Export Catalog, Download Template buttons
 * - Import History link
 * - Add item, Edit item (via EditItemModal), Activate/Deactivate
 * - Source badge: manual / import / admin_reviewed_import
 * - Supplier view (SuperAdmin can see all vendors)
 */
import React, { useEffect, useState, useContext, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { UserContext } from '../../contexts/UserContext';
import { db } from '../../firebase';
import { collection, getDocs, doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { toast } from 'react-toastify';
import { formatItemSize } from './VendorDetailPage';
import AddItemModal from './AddItemModal';
import EditItemModal from './EditItemModal';
import { exportVendorCatalog, downloadTemplate } from '../BulkImport/importHelpers';
import GuidanceText from '../ui/GuidanceText';

const CATEGORIES = ['All', 'Spices', 'Meat', 'Produce', 'Dairy', 'Seafood', 'Grains', 'Beverages', 'Packaging', 'Cleaning', 'Other'];
const PAGE_SIZE = 50;

const SOURCE_LABELS = {
    manual:                 { label: 'Manual', color: '#94a3b8' },
    import:                 { label: 'Import',  color: '#38bdf8' },
    admin_reviewed_import:  { label: 'Admin Reviewed', color: '#a78bfa' },
};

function SourceBadge({ source }) {
    const cfg = SOURCE_LABELS[source] || { label: source || '—', color: '#64748b' };
    return (
        <span style={{ fontSize: 10, fontWeight: 700, color: cfg.color, opacity: 0.8 }}>
            {cfg.label}
        </span>
    );
}

function SortIcon({ field, sort }) {
    if (sort.field !== field) return <span style={{ color: '#475569', marginLeft: 4 }}>⇅</span>;
    return <span style={{ color: '#38bdf8', marginLeft: 4 }}>{sort.dir === 'asc' ? '↑' : '↓'}</span>;
}

export default function ItemCatalogPage() {
    const navigate = useNavigate();
    const { vendorId, vendorName, isSuperAdmin, userId, displayName } = useContext(UserContext);

    const [allItems, setAllItems] = useState([]);
    const [loading, setLoading] = useState(true);

    // Filters
    const [search, setSearch] = useState('');
    const [categoryFilter, setCategoryFilter] = useState('All');
    const [statusFilter, setStatusFilter] = useState('All');

    // Sort
    const [sort, setSort] = useState({ field: 'name', dir: 'asc' });

    // Pagination
    const [page, setPage] = useState(0);

    // Modals
    const [isAddModalOpen, setIsAddModalOpen] = useState(false);
    const [editingItem, setEditingItem] = useState(null);

    // Load items
    const loadItems = async () => {
        setLoading(true);
        try {
            const items = [];
            if (isSuperAdmin) {
                const vendorSnap = await getDocs(collection(db, 'vendors'));
                const vendors = vendorSnap.docs.map(d => ({ id: d.id, ...d.data() }));
                for (const v of vendors) {
                    try {
                        const itemSnap = await getDocs(collection(db, 'vendors', v.id, 'items'));
                        itemSnap.docs.forEach(d => {
                            items.push({ id: d.id, ...d.data(), vendorId: v.id, vendorName: v.name || 'Unknown' });
                        });
                    } catch { /* skip */ }
                }
            } else if (vendorId) {
                const itemSnap = await getDocs(collection(db, 'vendors', vendorId, 'items'));
                itemSnap.docs.forEach(d => {
                    items.push({ id: d.id, ...d.data(), vendorId, vendorName: vendorName || '' });
                });
            }
            setAllItems(items);
        } catch (err) {
            console.error('[ItemCatalogPage] load:', err);
            toast.error('Failed to load items');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { loadItems(); }, [vendorId, vendorName, isSuperAdmin]);

    // Toggle active/inactive
    const handleToggleActive = async (item) => {
        const newStatus = item.status === 'Inactive' ? 'Active' : 'Inactive';
        try {
            await updateDoc(doc(db, 'vendors', item.vendorId, 'items', item.id), {
                status: newStatus,
                updatedAt: serverTimestamp(),
                updatedBy: displayName || userId || 'Vendor',
                sourceLastUpdated: 'manual',
            });
            setAllItems(prev => prev.map(i => i.id === item.id ? { ...i, status: newStatus } : i));
            toast.success(item.name + ' is now ' + newStatus);
        } catch (err) {
            toast.error('Failed to update status: ' + err.message);
        }
    };

    // Derived audit log helper (reuse from logAudit pattern — no-op for now, EditItemModal handles)
    const logAudit = async () => {};

    // Handle item updated from EditItemModal
    const handleItemUpdated = (updatedItem) => {
        setAllItems(prev => prev.map(i => i.id === updatedItem.id ? { ...i, ...updatedItem } : i));
        setEditingItem(null);
    };

    // Handle item added from AddItemModal
    const handleItemAdded = (newItem) => {
        setAllItems(prev => [...prev, newItem]);
    };

    // Sort handler
    const handleSort = (field) => {
        setSort(prev => ({ field, dir: prev.field === field && prev.dir === 'asc' ? 'desc' : 'asc' }));
        setPage(0);
    };

    // Export
    const handleExport = async () => {
        const items = isSuperAdmin ? allItems : allItems.filter(i => i.vendorId === vendorId);
        if (items.length === 0) { toast.info('No items to export.'); return; }
        exportVendorCatalog(items, vendorName || 'Catalog');
        toast.success('Catalog exported!');
    };

    // ── Catalog Health Metrics ─────────────────────────────────────────────────
    const [healthFilter, setHealthFilter] = useState(null); // null | 'missingPack' | 'missingSKU' | 'stale14' | 'stale30' | 'suspectPrice' | 'missingCategory' | 'inactive'
    const [showHealthPanel, setShowHealthPanel] = useState(false);

    const catalogHealth = useMemo(() => {
        const now = Date.now();
        const day14 = 14 * 24 * 60 * 60 * 1000;
        const day30 = 30 * 24 * 60 * 60 * 1000;

        let active = 0, inactive = 0, missingPack = 0, missingSKU = 0, stale14 = 0, stale30 = 0, suspectPrice = 0, missingCategory = 0;

        allItems.forEach(item => {
            const status = (item.status || 'Active').toLowerCase();
            if (status === 'active') active++; else inactive++;
            if (!item.packSize && !item.packQuantity) missingPack++;
            if (!item.vendorSKU) missingSKU++;
            if (!item.category) missingCategory++;
            const price = parseFloat(item.vendorPrice ?? item.price ?? 0);
            if (price <= 0 || price > 5000) suspectPrice++;
            const updMs = item.updatedAt?.toMillis?.() || (item.updatedAt?.seconds ? item.updatedAt.seconds * 1000 : 0);
            if (updMs > 0) {
                const age = now - updMs;
                if (age > day30) stale30++;
                else if (age > day14) stale14++;
            }
        });

        return { active, inactive, missingPack, missingSKU, stale14, stale30, suspectPrice, missingCategory, total: allItems.length };
    }, [allItems]);

    // ── Filter + Sort + Paginate ───────────────────────────────────────────────
    const filtered = useMemo(() => {
        let items = allItems.filter(item => {
            const q = search.toLowerCase();
            const matchSearch = !search ||
                (item.name || item.itemName || '').toLowerCase().includes(q) ||
                (isSuperAdmin && (item.vendorName || '').toLowerCase().includes(q)) ||
                (item.vendorSKU || '').toLowerCase().includes(q) ||
                (item.brand || '').toLowerCase().includes(q);
            const matchCat = categoryFilter === 'All' || item.category === categoryFilter;
            const matchStatus = statusFilter === 'All' || (item.status || 'Active').toLowerCase() === statusFilter.toLowerCase();

            // Health filter
            if (healthFilter) {
                const now = Date.now();
                const day14 = 14 * 24 * 60 * 60 * 1000;
                const day30 = 30 * 24 * 60 * 60 * 1000;
                const updMs = item.updatedAt?.toMillis?.() || (item.updatedAt?.seconds ? item.updatedAt.seconds * 1000 : 0);
                const price = parseFloat(item.vendorPrice ?? item.price ?? 0);

                if (healthFilter === 'missingPack' && (item.packSize || item.packQuantity)) return false;
                if (healthFilter === 'missingSKU' && item.vendorSKU) return false;
                if (healthFilter === 'missingCategory' && item.category) return false;
                if (healthFilter === 'suspectPrice' && price > 0 && price <= 5000) return false;
                if (healthFilter === 'stale14' && (updMs === 0 || (now - updMs) <= day14)) return false;
                if (healthFilter === 'stale30' && (updMs === 0 || (now - updMs) <= day30)) return false;
                if (healthFilter === 'inactive' && (item.status || 'Active').toLowerCase() !== 'inactive') return false;
            }

            return matchSearch && matchCat && matchStatus;
        });

        // Sort
        items = [...items].sort((a, b) => {
            let aVal, bVal;
            if (sort.field === 'price') {
                aVal = parseFloat(a.vendorPrice ?? a.price ?? 0);
                bVal = parseFloat(b.vendorPrice ?? b.price ?? 0);
            } else if (sort.field === 'updatedAt') {
                aVal = a.updatedAt?.toMillis?.() || a.updatedAt?.seconds * 1000 || 0;
                bVal = b.updatedAt?.toMillis?.() || b.updatedAt?.seconds * 1000 || 0;
            } else {
                aVal = (a[sort.field] || '').toLowerCase();
                bVal = (b[sort.field] || '').toLowerCase();
            }
            if (aVal < bVal) return sort.dir === 'asc' ? -1 : 1;
            if (aVal > bVal) return sort.dir === 'asc' ? 1 : -1;
            return 0;
        });

        return items;
    }, [allItems, search, categoryFilter, statusFilter, sort, healthFilter]);

    const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
    const pageItems = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

    // Reset page when filters change
    const handleFilterChange = (setter) => (value) => { setter(value); setPage(0); };

    // Table header helper
    const Th = ({ field, label, width }) => (
        <th
            onClick={() => handleSort(field)}
            style={{
                padding: '10px 14px',
                textAlign: 'left',
                fontSize: 11,
                fontWeight: 700,
                color: '#94a3b8',
                textTransform: 'uppercase',
                letterSpacing: 0.5,
                borderBottom: '1px solid rgba(255,255,255,0.07)',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                width: width,
                userSelect: 'none',
            }}
        >
            {label}<SortIcon field={field} sort={sort} />
        </th>
    );

    const thStatic = {
        padding: '10px 14px',
        textAlign: 'left',
        fontSize: 11,
        fontWeight: 700,
        color: '#94a3b8',
        textTransform: 'uppercase',
        letterSpacing: 0.5,
        borderBottom: '1px solid rgba(255,255,255,0.07)',
        whiteSpace: 'nowrap',
    };

    const tdStyle = { padding: '11px 14px', fontSize: 13, verticalAlign: 'middle', borderBottom: '1px solid rgba(255,255,255,0.04)' };

    return (
        <div style={{ maxWidth: 1300, margin: '0 auto', padding: '24px 16px' }}>
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
                <div>
                    <h1 style={{ fontSize: 24, fontWeight: 800, color: '#f8fafc', margin: 0 }}>
                        📋 Catalog
                    </h1>
                    <p style={{ color: '#94a3b8', marginTop: 4, fontSize: 14 }}>
                        {allItems.length} items · {vendorName && <span style={{ color: '#38bdf8' }}>{vendorName}</span>}
                    </p>
                </div>
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                    {!isSuperAdmin && (
                        <>
                            <button className="ui-btn ghost small" onClick={() => downloadTemplate()}>📋 Template</button>
                            <button className="ui-btn ghost small" onClick={handleExport}>📤 Export</button>
                            <button className="ui-btn ghost small" onClick={() => navigate('/vendor/import?tab=history')}>🕐 Import History</button>
                            <button className="ui-btn primary small" onClick={() => navigate('/vendor/import')}>📥 Bulk Upload</button>
                        </>
                    )}
                    {isSuperAdmin && (
                        <button className="ui-btn ghost small" onClick={handleExport}>📤 Export</button>
                    )}
                    <button className="ui-btn primary small" onClick={() => setIsAddModalOpen(true)}>+ Add Item</button>
                </div>
            </div>

            {/* Catalog Guidance */}
            {allItems.length > 0 && (catalogHealth.missingPack + catalogHealth.suspectPrice + catalogHealth.stale30) > 0 && (
                <GuidanceText
                    text={`${catalogHealth.missingPack + catalogHealth.suspectPrice + catalogHealth.stale30} items may need review — fix data quality issues to improve allocation`}
                    type="warning"
                    style={{ marginBottom: 12 }}
                />
            )}

            {/* Catalog Health Panel */}
            {allItems.length > 0 && (
                <div style={{ marginBottom: 16 }}>
                    <button onClick={() => setShowHealthPanel(p => !p)} style={{
                        padding: '8px 16px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.08)',
                        background: 'rgba(255,255,255,0.02)', color: '#94a3b8', fontSize: 13, fontWeight: 600,
                        cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8,
                    }}>
                        {showHealthPanel ? '▾' : '▸'} Catalog Health
                        {(catalogHealth.missingPack + catalogHealth.suspectPrice + catalogHealth.stale30) > 0 && (
                            <span style={{ background: '#f59e0b', color: '#0f172a', padding: '2px 8px', borderRadius: 10, fontSize: 11, fontWeight: 700 }}>
                                {catalogHealth.missingPack + catalogHealth.suspectPrice + catalogHealth.stale30} issues
                            </span>
                        )}
                    </button>
                    {showHealthPanel && (
                        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', padding: '12px 16px', background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 10 }}>
                            {[
                                { key: null, label: `✅ Active: ${catalogHealth.active}`, color: '#4ade80', count: catalogHealth.active },
                                { key: 'inactive', label: `🚫 Inactive: ${catalogHealth.inactive}`, color: '#f87171', count: catalogHealth.inactive },
                                { key: 'missingPack', label: `📦 No Pack Size: ${catalogHealth.missingPack}`, color: '#f59e0b', count: catalogHealth.missingPack },
                                { key: 'missingSKU', label: `🏷️ No SKU: ${catalogHealth.missingSKU}`, color: '#94a3b8', count: catalogHealth.missingSKU },
                                { key: 'missingCategory', label: `📂 No Category: ${catalogHealth.missingCategory}`, color: '#f97316', count: catalogHealth.missingCategory },
                                { key: 'suspectPrice', label: `💰 Suspect Price: ${catalogHealth.suspectPrice}`, color: '#f43f5e', count: catalogHealth.suspectPrice },
                                { key: 'stale14', label: `⏰ Stale 14d: ${catalogHealth.stale14}`, color: '#fbbf24', count: catalogHealth.stale14 },
                                { key: 'stale30', label: `🚨 Stale 30d: ${catalogHealth.stale30}`, color: '#f43f5e', count: catalogHealth.stale30 },
                            ].filter(b => b.count > 0 || b.key === null).map(b => (
                                <button key={b.key || 'active'} onClick={() => { setHealthFilter(healthFilter === b.key ? null : b.key); setPage(0); }} style={{
                                    padding: '6px 14px', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: b.key ? 'pointer' : 'default',
                                    border: `1px solid ${healthFilter === b.key ? b.color : 'rgba(255,255,255,0.08)'}`,
                                    background: healthFilter === b.key ? `${b.color}15` : 'transparent',
                                    color: healthFilter === b.key ? b.color : '#94a3b8',
                                }}>{b.label}</button>
                            ))}
                            {healthFilter && (
                                <button onClick={() => { setHealthFilter(null); setPage(0); }} style={{
                                    padding: '6px 14px', borderRadius: 6, fontSize: 12, fontWeight: 600,
                                    border: '1px solid rgba(56,189,248,0.3)', background: 'rgba(56,189,248,0.1)',
                                    color: '#38bdf8', cursor: 'pointer',
                                }}>✕ Clear Filter</button>
                            )}
                        </div>
                    )}
                </div>
            )}

            {/* Filter bar */}
            <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
                <input
                    className="ui-input"
                    style={{ maxWidth: 280 }}
                    placeholder="Search items, SKU, brand…"
                    value={search}
                    onChange={e => { setSearch(e.target.value); setPage(0); }}
                />
                <select className="ui-input" style={{ maxWidth: 160 }} value={categoryFilter} onChange={e => handleFilterChange(setCategoryFilter)(e.target.value)}>
                    {CATEGORIES.map(c => <option key={c}>{c}</option>)}
                </select>
                <select className="ui-input" style={{ maxWidth: 140 }} value={statusFilter} onChange={e => handleFilterChange(setStatusFilter)(e.target.value)}>
                    <option value="All">All Status</option>
                    <option value="Active">Active</option>
                    <option value="Inactive">Inactive</option>
                    <option value="Pending Review">Pending Review</option>
                    <option value="in-review">In Review</option>
                </select>
                <span style={{ fontSize: 13, color: '#64748b', marginLeft: 'auto' }}>
                    {filtered.length} items{filtered.length !== allItems.length ? ' (filtered)' : ''}
                </span>
            </div>

            {/* Table */}
            {loading ? (
                <div style={{ textAlign: 'center', padding: 60, color: '#64748b' }}>Loading catalog…</div>
            ) : filtered.length === 0 ? (
                <div style={{ textAlign: 'center', padding: 60 }}>
                    <div style={{ fontSize: 40, marginBottom: 12 }}>📭</div>
                    <div style={{ color: '#64748b', fontSize: 15, marginBottom: 20 }}>
                        {allItems.length === 0 ? 'Your catalog is empty.' : 'No items match your filter.'}
                    </div>
                    {allItems.length === 0 && !isSuperAdmin && (
                        <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
                            <button className="ui-btn primary" onClick={() => navigate('/vendor/import')}>📥 Import Catalog</button>
                            <button className="ui-btn ghost" onClick={() => setIsAddModalOpen(true)}>+ Add Item</button>
                        </div>
                    )}
                </div>
            ) : (
                <div style={{ borderRadius: 10, border: '1px solid rgba(255,255,255,0.07)', overflow: 'hidden' }}>
                    <div style={{ overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', background: '#1A1A2E' }}>
                            <thead>
                                <tr>
                                    <Th field="name" label="Item Name" />
                                    <Th field="category" label="Category" />
                                    <th style={thStatic}>Brand</th>
                                    <th style={thStatic}>Pack / Unit</th>
                                    <Th field="price" label="Price" />
                                    <Th field="updatedAt" label="Last Updated" />
                                    <th style={thStatic}>Source</th>
                                    <th style={{ ...thStatic, textAlign: 'center' }}>Status</th>
                                    {isSuperAdmin && <th style={thStatic}>Vendor</th>}
                                    <th style={{ ...thStatic, textAlign: 'right' }}>Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {pageItems.map(item => {
                                    const price = parseFloat(item.vendorPrice ?? item.price ?? 0);
                                    const isInactive = (item.status || 'Active') === 'Inactive';
                                    const updatedDate = item.updatedAt?.toDate?.() || null;
                                    const updatedStr = updatedDate ? updatedDate.toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: '2-digit' }) : '—';

                                    return (
                                        <tr
                                            key={item.id}
                                            style={{ opacity: isInactive ? 0.6 : 1, transition: 'opacity 0.15s' }}
                                            onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.02)'}
                                            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                                        >
                                            <td style={tdStyle}>
                                                <div style={{ fontWeight: 600, color: '#f8fafc', cursor: 'pointer' }}
                                                    onClick={() => navigate('/vendors/' + item.vendorId + '/items/' + item.id)}>
                                                    {item.name || item.itemName || '—'}
                                                </div>
                                                <div style={{ fontSize: 10, color: '#475569', fontFamily: 'monospace', marginTop: 2 }}>
                                                    ID: {item.id}
                                                </div>
                                                {item.vendorSKU && (
                                                    <div style={{ fontSize: 11, color: '#475569' }}>SKU: {item.vendorSKU}</div>
                                                )}
                                            </td>
                                            <td style={{ ...tdStyle, color: '#94a3b8' }}>{item.category || '—'}</td>
                                            <td style={{ ...tdStyle, color: '#94a3b8' }}>{item.brand || '—'}</td>
                                            <td style={{ ...tdStyle, color: '#94a3b8', fontSize: 12 }}>
                                                {[item.packSize, formatItemSize(item.unit, item.packQuantity, item.itemSize)].filter(Boolean).join(' · ') || '—'}
                                            </td>
                                            <td style={{ ...tdStyle, fontWeight: 700, color: '#fbbf24' }}>
                                                ${price.toFixed(2)}
                                            </td>
                                            <td style={{ ...tdStyle, fontSize: 12, color: '#64748b' }}>{updatedStr}</td>
                                            <td style={tdStyle}>
                                                <SourceBadge source={item.sourceLastUpdated} />
                                            </td>
                                            <td style={{ ...tdStyle, textAlign: 'center' }}>
                                                {(() => {
                                                    const st = item.status || 'Active';
                                                    const isReview = st === 'Pending Review' || st === 'in-review';
                                                    const isInact = st === 'Inactive';
                                                    return (<span style={{
                                                        display: 'inline-block', padding: '2px 10px', borderRadius: 20,
                                                        fontSize: 11, fontWeight: 700,
                                                        background: isReview ? 'rgba(251,191,36,0.1)' : isInact ? 'rgba(244,63,94,0.1)' : 'rgba(74,222,128,0.1)',
                                                        color: isReview ? '#fbbf24' : isInact ? '#f87171' : '#4ade80',
                                                    }}>{st}</span>);
                                                })()}
                                            </td>
                                            {isSuperAdmin && (
                                                <td style={{ ...tdStyle, fontSize: 12, color: '#94a3b8' }}>{item.vendorName}</td>
                                            )}
                                            <td style={{ ...tdStyle, textAlign: 'right', whiteSpace: 'nowrap' }}>
                                                <button
                                                    className="ui-btn ghost small"
                                                    style={{ padding: '3px 10px', fontSize: 12, marginRight: 6 }}
                                                    onClick={() => setEditingItem(item)}
                                                >
                                                    ✏️
                                                </button>
                                                <button
                                                    className="ui-btn ghost small"
                                                    style={{ padding: '3px 10px', fontSize: 12, marginRight: 6, color: isInactive ? '#4ade80' : '#f87171' }}
                                                    onClick={() => handleToggleActive(item)}
                                                    title={isInactive ? 'Activate' : 'Deactivate'}
                                                >
                                                    {isInactive ? '✅' : '🚫'}
                                                </button>
                                                <button
                                                    className="ui-btn ghost small"
                                                    style={{ padding: '3px 10px', fontSize: 12 }}
                                                    onClick={() => navigate('/vendors/' + item.vendorId + '/items/' + item.id)}
                                                    title="View details"
                                                >
                                                    👁️
                                                </button>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>

                    {/* Pagination */}
                    {totalPages > 1 && (
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', borderTop: '1px solid rgba(255,255,255,0.06)', fontSize: 13 }}>
                            <span style={{ color: '#94a3b8' }}>
                                {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, filtered.length)} of {filtered.length}
                            </span>
                            <div style={{ display: 'flex', gap: 8 }}>
                                <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}
                                    className="ui-btn ghost small" style={{ padding: '3px 12px' }}>← Prev</button>
                                <span style={{ color: '#94a3b8', lineHeight: '28px' }}>Page {page + 1}/{totalPages}</span>
                                <button onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1}
                                    className="ui-btn ghost small" style={{ padding: '3px 12px' }}>Next →</button>
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* Modals */}
            {isAddModalOpen && (
                <AddItemModal
                    vendorId={vendorId}
                    vendorName={vendorName}
                    onClose={() => setIsAddModalOpen(false)}
                    onItemAdded={handleItemAdded}
                />
            )}
            {editingItem && (
                <EditItemModal
                    item={editingItem}
                    vendorId={editingItem.vendorId || vendorId}
                    vendorName={editingItem.vendorName || vendorName}
                    onClose={() => setEditingItem(null)}
                    onItemUpdated={handleItemUpdated}
                    logAudit={logAudit}
                />
            )}
        </div>
    );
}
