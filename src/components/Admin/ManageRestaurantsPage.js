import React, { useState, useEffect, useCallback, useContext } from 'react';
import { db } from '../../firebase';
import { collection, getDocs, doc, getDoc, setDoc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { UserContext } from '../../contexts/UserContext';
import { generateRestaurantId, validateRestaurant } from '../../utils/catalogUtils';
import { migrateRestaurants } from '../../utils/migrateRestaurants';
import { logAdminChange } from '../../utils/adminAuditLogger';
import { toast } from 'react-toastify';

const STATUS_OPTIONS = ['active', 'hold', 'inactive'];
const BRANCH_TYPES = ['restaurant', 'cloud-kitchen', 'catering', 'franchise', 'ghost-kitchen', 'commissary'];
const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const PROVINCES = ['ON', 'BC', 'AB', 'QC', 'MB', 'SK', 'NS', 'NB', 'NL', 'PE', 'YT', 'NT', 'NU'];
const PLANS = ['marketplace-basic', 'marketplace-pro', 'enterprise', 'trial', 'custom'];

export default function ManageRestaurantsPage() {
    const { displayName } = useContext(UserContext);

    // Data
    const [restaurants, setRestaurants] = useState([]);
    const [orderStats, setOrderStats] = useState({}); // restaurantId → { totalOrders, lastOrderDate }
    const [loading, setLoading] = useState(true);

    // Filters
    const [search, setSearch] = useState('');
    const [statusFilter, setStatusFilter] = useState('all');
    const [branchFilter, setBranchFilter] = useState('all');

    // Modals
    const [showModal, setShowModal] = useState(false);
    const [editingId, setEditingId] = useState(null);
    const [form, setForm] = useState(getEmptyForm());
    const [detailId, setDetailId] = useState(null);

    // Bulk selection
    const [selected, setSelected] = useState(new Set());
    const [showBulkConfirm, setShowBulkConfirm] = useState(null); // 'activate' | 'deactivate' | null

    // Migration
    const [migrating, setMigrating] = useState(false);
    const [migrationLog, setMigrationLog] = useState([]);

    function getEmptyForm() {
        return {
            restaurantId: '', name: '', code: '', branchType: 'restaurant', status: 'active',
            phone: '', email: '', addressLine1: '', city: '', province: 'ON', postalCode: '',
            deliveryDays: [], preferredVendors: '', accountManager: '', notes: '',
            forecastEnabled: true, subscriptionPlan: 'marketplace-basic',
        };
    }

    const fetchData = useCallback(async () => {
        setLoading(true);
        try {
            const snap = await getDocs(collection(db, 'restaurants'));
            const data = snap.docs.map(d => ({ id: d.id, ...d.data() }));
            setRestaurants(data.sort((a, b) => (a.name || '').localeCompare(b.name || '')));

            // Compute quick order stats from submittedOrders
            const statsMap = {};
            try {
                const ordersSnap = await getDocs(collection(db, 'submittedOrders'));
                ordersSnap.docs.forEach(d => {
                    const o = d.data();
                    const rid = o.restaurantId;
                    if (!rid) return;
                    if (!statsMap[rid]) statsMap[rid] = { totalOrders: 0, lastOrderDate: null };
                    statsMap[rid].totalOrders++;
                    const ts = o.createdAt?.toDate ? o.createdAt.toDate() : o.createdAt ? new Date(o.createdAt) : null;
                    if (ts && (!statsMap[rid].lastOrderDate || ts > statsMap[rid].lastOrderDate)) {
                        statsMap[rid].lastOrderDate = ts;
                    }
                });
            } catch (e) { /* stats optional */ }
            setOrderStats(statsMap);
        } catch (err) { toast.error('Failed to load restaurants'); }
        setLoading(false);
    }, []);

    useEffect(() => { fetchData(); }, [fetchData]);

    // ---------- SAVE ----------
    const handleSave = async () => {
        const rid = form.restaurantId || generateRestaurantId(form.name);
        const docData = {
            ...form,
            restaurantId: rid,
            code: form.code || rid.replace(/_/g, '-'),
            deliveryDays: form.deliveryDays || [],
            preferredVendors: form.preferredVendors ? form.preferredVendors.split(',').map(v => v.trim()).filter(Boolean) : [],
        };
        const { valid, errors } = validateRestaurant(docData);
        if (!valid) { toast.warn(errors[0]); return; }

        try {
            if (editingId) {
                await updateDoc(doc(db, 'restaurants', editingId), { ...docData, updatedAt: serverTimestamp() });
                await logAdminChange({ entityType: 'restaurant', entityId: editingId, action: 'updated', changedBy: displayName });
                toast.success('Restaurant updated');
            } else {
                const existing = await getDoc(doc(db, 'restaurants', rid));
                if (existing.exists()) { toast.warn('Restaurant ID already exists'); return; }
                await setDoc(doc(db, 'restaurants', rid), { ...docData, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
                await logAdminChange({ entityType: 'restaurant', entityId: rid, action: 'created', changedBy: displayName });
                toast.success('Restaurant created');
            }
            setShowModal(false); setEditingId(null); setForm(getEmptyForm()); fetchData();
        } catch (err) { toast.error('Save failed: ' + err.message); }
    };

    const handleEdit = (item) => {
        setForm({
            restaurantId: item.restaurantId || item.id, name: item.name || '', code: item.code || '',
            branchType: item.branchType || 'restaurant', status: item.status || 'active',
            phone: item.phone || '', email: item.email || '', addressLine1: item.addressLine1 || '',
            city: item.city || '', province: item.province || 'ON', postalCode: item.postalCode || '',
            deliveryDays: item.deliveryDays || [],
            preferredVendors: Array.isArray(item.preferredVendors) ? item.preferredVendors.join(', ') : (item.preferredVendors || ''),
            accountManager: item.accountManager || '', notes: item.notes || '',
            forecastEnabled: item.forecastEnabled !== false, subscriptionPlan: item.subscriptionPlan || 'marketplace-basic',
        });
        setEditingId(item.id);
        setShowModal(true);
    };

    const handleToggleStatus = async (item) => {
        const next = item.status === 'active' ? 'hold' : item.status === 'hold' ? 'inactive' : 'active';
        try {
            await updateDoc(doc(db, 'restaurants', item.id), { status: next, updatedAt: serverTimestamp() });
            await logAdminChange({ entityType: 'restaurant', entityId: item.id, action: 'status_changed', changedBy: displayName, changedFields: { status: { from: item.status, to: next } } });
            toast.success(`${item.name} → ${next}`); fetchData();
        } catch (err) { toast.error(err.message); }
    };

    // ---------- BULK ----------
    const handleBulkAction = async (action) => {
        const ids = [...selected];
        if (ids.length === 0) return;
        const newStatus = action === 'activate' ? 'active' : 'inactive';
        try {
            for (const id of ids) {
                await updateDoc(doc(db, 'restaurants', id), { status: newStatus, updatedAt: serverTimestamp() });
            }
            await logAdminChange({ entityType: 'restaurant', entityId: 'bulk', action: 'bulk_update', changedBy: displayName, metadata: { ids, newStatus } });
            toast.success(`${ids.length} restaurants → ${newStatus}`);
            setSelected(new Set()); setShowBulkConfirm(null); fetchData();
        } catch (err) { toast.error(err.message); }
    };

    const handleMigrate = async () => {
        setMigrating(true); setMigrationLog([]);
        try {
            const result = await migrateRestaurants((msg) => setMigrationLog(prev => [...prev, msg]));
            toast.success(`Migration: ${result.created} created, ${result.skipped} skipped`);
            fetchData();
        } catch (err) { toast.error('Migration error: ' + err.message); }
        setMigrating(false);
    };

    const toggleDay = (day) => {
        setForm(f => ({ ...f, deliveryDays: f.deliveryDays.includes(day) ? f.deliveryDays.filter(d => d !== day) : [...f.deliveryDays, day] }));
    };

    const toggleSelect = (id) => {
        setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
    };

    const toggleSelectAll = () => {
        if (selected.size === filtered.length) setSelected(new Set());
        else setSelected(new Set(filtered.map(r => r.id)));
    };

    // ---------- FILTERS ----------
    const filtered = restaurants.filter(r => {
        if (statusFilter !== 'all' && r.status !== statusFilter) return false;
        if (branchFilter !== 'all' && r.branchType !== branchFilter) return false;
        if (search) {
            const q = search.toLowerCase();
            return (r.name || '').toLowerCase().includes(q) || (r.code || '').toLowerCase().includes(q) || (r.city || '').toLowerCase().includes(q) || (r.restaurantId || '').toLowerCase().includes(q);
        }
        return true;
    });

    const detailItem = detailId ? restaurants.find(r => r.id === detailId) : null;
    const detailStats = detailId ? (orderStats[detailId] || {}) : {};
    const statusColors = { active: '#10b981', hold: '#fbbf24', inactive: '#94a3b8' };

    return (
        <div style={{ padding: '24px 32px', maxWidth: 1500, margin: '0 auto', color: '#f8fafc' }}>
            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
                <div>
                    <h2 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>🏪 Master Restaurants</h2>
                    <p style={{ margin: '4px 0 0', fontSize: 13, color: '#94a3b8' }}>{restaurants.length} restaurants • {restaurants.filter(r => r.status === 'active').length} active</p>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                    <button onClick={handleMigrate} disabled={migrating}
                        style={{ padding: '8px 14px', borderRadius: 8, background: 'rgba(56,189,248,0.1)', color: '#38bdf8', border: '1px solid rgba(56,189,248,0.2)', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
                        {migrating ? '⏳ Migrating...' : '🔄 Auto-Populate from Orders'}
                    </button>
                    <button onClick={() => { setForm(getEmptyForm()); setEditingId(null); setShowModal(true); }}
                        style={{ padding: '8px 14px', borderRadius: 8, background: '#10b981', color: '#fff', border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
                        + Add Restaurant
                    </button>
                </div>
            </div>

            {/* Migration Log */}
            {migrationLog.length > 0 && (
                <div style={{ background: 'rgba(56,189,248,0.05)', border: '1px solid rgba(56,189,248,0.15)', borderRadius: 10, padding: 14, marginBottom: 16, maxHeight: 120, overflowY: 'auto' }}>
                    {migrationLog.map((msg, i) => <div key={i} style={{ fontSize: 11, color: '#94a3b8', marginBottom: 1 }}>→ {msg}</div>)}
                </div>
            )}

            {/* Filters & Bulk */}
            <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
                <input placeholder="Search name, code, city..." value={search} onChange={e => setSearch(e.target.value)}
                    style={{ padding: '8px 14px', borderRadius: 8, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: '#f8fafc', outline: 'none', fontSize: 13, width: 220 }} />
                {['all', ...STATUS_OPTIONS].map(s => (
                    <button key={s} onClick={() => setStatusFilter(s)}
                        style={{ padding: '5px 10px', borderRadius: 14, fontSize: 11, fontWeight: 600, cursor: 'pointer', border: statusFilter === s ? '1px solid ' + (statusColors[s] || '#38bdf8') : '1px solid rgba(255,255,255,0.08)', background: statusFilter === s ? (statusColors[s] || '#38bdf8') + '18' : 'transparent', color: statusFilter === s ? (statusColors[s] || '#38bdf8') : '#94a3b8' }}>
                        {s === 'all' ? 'All' : s.charAt(0).toUpperCase() + s.slice(1)}
                    </button>
                ))}
                <select value={branchFilter} onChange={e => setBranchFilter(e.target.value)}
                    style={{ padding: '5px 10px', borderRadius: 8, fontSize: 11, background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.08)', color: '#94a3b8', outline: 'none' }}>
                    <option value="all">All types</option>
                    {BRANCH_TYPES.map(b => <option key={b} value={b}>{b}</option>)}
                </select>
                <span style={{ fontSize: 12, color: '#64748b' }}>{filtered.length} showing</span>
                {selected.size > 0 && (
                    <div style={{ display: 'flex', gap: 6, marginLeft: 'auto' }}>
                        <span style={{ fontSize: 12, color: '#38bdf8', fontWeight: 600 }}>{selected.size} selected</span>
                        <button onClick={() => setShowBulkConfirm('activate')} style={{ padding: '4px 10px', borderRadius: 6, fontSize: 11, cursor: 'pointer', background: 'rgba(16,185,129,0.15)', color: '#10b981', border: '1px solid rgba(16,185,129,0.3)', fontWeight: 600 }}>Bulk Activate</button>
                        <button onClick={() => setShowBulkConfirm('deactivate')} style={{ padding: '4px 10px', borderRadius: 6, fontSize: 11, cursor: 'pointer', background: 'rgba(244,63,94,0.1)', color: '#f43f5e', border: '1px solid rgba(244,63,94,0.2)', fontWeight: 600 }}>Bulk Deactivate</button>
                    </div>
                )}
            </div>

            {/* Table + Detail Split */}
            <div style={{ display: 'flex', gap: 16 }}>
                {/* Table */}
                <div style={{ flex: detailId ? '0 0 65%' : '1 1 100%', background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 12, overflow: 'hidden', transition: 'flex 0.2s' }}>
                    {loading ? (
                        <div style={{ padding: 60, textAlign: 'center', color: '#94a3b8' }}>Loading...</div>
                    ) : (
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                            <thead>
                                <tr style={{ background: 'rgba(255,255,255,0.04)', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                                    <th style={{ padding: '8px 10px', width: 30 }}>
                                        <input type="checkbox" checked={selected.size === filtered.length && filtered.length > 0} onChange={toggleSelectAll} style={{ cursor: 'pointer' }} />
                                    </th>
                                    {['Name', 'Code', 'Type', 'City', 'Days', 'Orders', 'Status', 'Actions'].map(h => (
                                        <th key={h} style={{ padding: '8px 12px', textAlign: 'left', fontSize: 11, color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.3 }}>{h}</th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {filtered.map(r => {
                                    const stats = orderStats[r.id] || {};
                                    return (
                                        <tr key={r.id}
                                            style={{ borderBottom: '1px solid rgba(255,255,255,0.04)', background: detailId === r.id ? 'rgba(56,189,248,0.05)' : 'transparent', cursor: 'pointer' }}
                                            onClick={() => setDetailId(detailId === r.id ? null : r.id)}>
                                            <td style={{ padding: '8px 10px' }} onClick={e => e.stopPropagation()}>
                                                <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggleSelect(r.id)} style={{ cursor: 'pointer' }} />
                                            </td>
                                            <td style={{ padding: '8px 12px', fontWeight: 600, color: '#f8fafc' }}>{r.name}</td>
                                            <td style={{ padding: '8px 12px', fontFamily: 'monospace', fontSize: 11, color: '#64748b' }}>{r.code || '—'}</td>
                                            <td style={{ padding: '8px 12px' }}>
                                                <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4, background: 'rgba(167,139,250,0.1)', color: '#a78bfa', fontWeight: 600 }}>{r.branchType}</span>
                                            </td>
                                            <td style={{ padding: '8px 12px', color: '#94a3b8', fontSize: 12 }}>{r.city || '—'}</td>
                                            <td style={{ padding: '8px 12px' }}>
                                                <div style={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
                                                    {(r.deliveryDays || []).map(d => (
                                                        <span key={d} style={{ fontSize: 9, padding: '1px 4px', borderRadius: 3, background: 'rgba(56,189,248,0.1)', color: '#38bdf8', fontWeight: 700 }}>{d.slice(0, 3)}</span>
                                                    ))}
                                                    {(!r.deliveryDays || r.deliveryDays.length === 0) && <span style={{ color: '#64748b', fontSize: 11 }}>—</span>}
                                                </div>
                                            </td>
                                            <td style={{ padding: '8px 12px' }}>
                                                <span style={{ fontSize: 11, color: stats.totalOrders ? '#f8fafc' : '#64748b' }}>{stats.totalOrders || 0}</span>
                                            </td>
                                            <td style={{ padding: '8px 12px' }}>
                                                <span style={{ fontSize: 11, fontWeight: 700, color: statusColors[r.status] || '#94a3b8' }}>● {r.status || 'active'}</span>
                                            </td>
                                            <td style={{ padding: '8px 12px' }} onClick={e => e.stopPropagation()}>
                                                <div style={{ display: 'flex', gap: 4 }}>
                                                    <button onClick={() => handleEdit(r)} style={{ padding: '3px 8px', borderRadius: 5, fontSize: 10, cursor: 'pointer', background: 'rgba(56,189,248,0.1)', color: '#38bdf8', border: '1px solid rgba(56,189,248,0.2)', fontWeight: 600 }}>Edit</button>
                                                    <button onClick={() => handleToggleStatus(r)} style={{ padding: '3px 8px', borderRadius: 5, fontSize: 10, cursor: 'pointer', background: 'rgba(255,255,255,0.04)', color: '#94a3b8', border: '1px solid rgba(255,255,255,0.08)', fontWeight: 600 }}>
                                                        {r.status === 'active' ? 'Hold' : r.status === 'hold' ? 'Deactivate' : 'Activate'}
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })}
                                {filtered.length === 0 && <tr><td colSpan={9} style={{ padding: 40, textAlign: 'center', color: '#64748b' }}>{restaurants.length === 0 ? 'No restaurants. Run migration or add manually.' : 'No results match.'}</td></tr>}
                            </tbody>
                        </table>
                    )}
                </div>

                {/* Detail Panel */}
                {detailItem && (
                    <div style={{ flex: '0 0 33%', background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 12, padding: 20, maxHeight: 'calc(100vh - 220px)', overflowY: 'auto' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                            <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>{detailItem.name}</h3>
                            <button onClick={() => setDetailId(null)} style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', fontSize: 16 }}>✕</button>
                        </div>
                        <div style={{ display: 'grid', gap: 10 }}>
                            {[
                                ['ID', detailItem.restaurantId], ['Code', detailItem.code], ['Branch Type', detailItem.branchType],
                                ['Status', detailItem.status], ['Phone', detailItem.phone], ['Email', detailItem.email],
                                ['Address', detailItem.addressLine1], ['City', detailItem.city], ['Province', detailItem.province],
                                ['Postal Code', detailItem.postalCode], ['Account Mgr', detailItem.accountManager],
                                ['Plan', detailItem.subscriptionPlan], ['Forecast', detailItem.forecastEnabled ? 'Enabled' : 'Disabled'],
                            ].map(([label, val]) => (
                                <div key={label} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, borderBottom: '1px solid rgba(255,255,255,0.04)', paddingBottom: 6 }}>
                                    <span style={{ color: '#94a3b8' }}>{label}</span>
                                    <span style={{ color: '#f8fafc', fontWeight: 500, textAlign: 'right', maxWidth: '60%', wordBreak: 'break-word' }}>{val || '—'}</span>
                                </div>
                            ))}
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, borderBottom: '1px solid rgba(255,255,255,0.04)', paddingBottom: 6 }}>
                                <span style={{ color: '#94a3b8' }}>Delivery Days</span>
                                <span style={{ color: '#f8fafc' }}>{(detailItem.deliveryDays || []).join(', ') || '—'}</span>
                            </div>
                        </div>
                        {/* Quick Stats */}
                        <div style={{ marginTop: 16, padding: 14, background: 'rgba(56,189,248,0.05)', border: '1px solid rgba(56,189,248,0.1)', borderRadius: 8 }}>
                            <div style={{ fontSize: 11, fontWeight: 700, color: '#38bdf8', marginBottom: 8 }}>📊 Order Stats</div>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, fontSize: 12 }}>
                                <div><span style={{ color: '#94a3b8' }}>Total Orders</span><div style={{ fontWeight: 700, color: '#f8fafc', fontSize: 18 }}>{detailStats.totalOrders || 0}</div></div>
                                <div><span style={{ color: '#94a3b8' }}>Last Order</span><div style={{ fontWeight: 600, color: '#f8fafc', fontSize: 12 }}>{detailStats.lastOrderDate ? detailStats.lastOrderDate.toLocaleDateString() : '—'}</div></div>
                            </div>
                        </div>
                        {detailItem.notes && (
                            <div style={{ marginTop: 12, fontSize: 12, color: '#64748b', fontStyle: 'italic' }}>📝 {detailItem.notes}</div>
                        )}
                    </div>
                )}
            </div>

            {/* Add/Edit Modal */}
            {showModal && (
                <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => setShowModal(false)}>
                    <div onClick={e => e.stopPropagation()} style={{ background: '#0f172a', borderRadius: 16, padding: 28, width: 620, maxHeight: '88vh', overflowY: 'auto', border: '1px solid rgba(255,255,255,0.1)' }}>
                        <h3 style={{ margin: '0 0 18px', fontSize: 18, fontWeight: 700 }}>{editingId ? '✏️ Edit Restaurant' : '➕ Add Restaurant'}</h3>

                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                            <div><label style={labelStyle}>Name *</label><input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value, restaurantId: editingId ? f.restaurantId : generateRestaurantId(e.target.value), code: editingId ? f.code : e.target.value.toLowerCase().replace(/[^a-z0-9]/g, '-') }))} style={inputStyle} placeholder="e.g. Oruma Takeout" /></div>
                            <div><label style={labelStyle}>Restaurant ID</label><input value={form.restaurantId} readOnly style={{ ...inputStyle, color: '#64748b', background: 'rgba(255,255,255,0.02)' }} /></div>
                            <div><label style={labelStyle}>Code</label><input value={form.code} onChange={e => setForm(f => ({ ...f, code: e.target.value }))} style={inputStyle} placeholder="oruma-takeout" /></div>
                            <div><label style={labelStyle}>Branch Type</label><select value={form.branchType} onChange={e => setForm(f => ({ ...f, branchType: e.target.value }))} style={selectStyle}>{BRANCH_TYPES.map(b => <option key={b} value={b}>{b}</option>)}</select></div>
                            <div><label style={labelStyle}>Status</label><select value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))} style={selectStyle}>{STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}</select></div>
                            <div><label style={labelStyle}>Subscription Plan</label><select value={form.subscriptionPlan} onChange={e => setForm(f => ({ ...f, subscriptionPlan: e.target.value }))} style={selectStyle}>{PLANS.map(p => <option key={p} value={p}>{p}</option>)}</select></div>
                            <div><label style={labelStyle}>Phone</label><input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} style={inputStyle} placeholder="(416) 555-0100" /></div>
                            <div><label style={labelStyle}>Email</label><input value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} style={inputStyle} placeholder="contact@oruma.ca" /></div>
                            <div style={{ gridColumn: '1 / -1' }}><label style={labelStyle}>Address</label><input value={form.addressLine1} onChange={e => setForm(f => ({ ...f, addressLine1: e.target.value }))} style={inputStyle} placeholder="123 Main St" /></div>
                            <div><label style={labelStyle}>City</label><input value={form.city} onChange={e => setForm(f => ({ ...f, city: e.target.value }))} style={inputStyle} placeholder="Toronto" /></div>
                            <div><label style={labelStyle}>Province</label><select value={form.province} onChange={e => setForm(f => ({ ...f, province: e.target.value }))} style={selectStyle}>{PROVINCES.map(p => <option key={p} value={p}>{p}</option>)}</select></div>
                            <div><label style={labelStyle}>Postal Code</label><input value={form.postalCode} onChange={e => setForm(f => ({ ...f, postalCode: e.target.value }))} style={inputStyle} placeholder="M5V 2T6" /></div>
                            <div><label style={labelStyle}>Account Manager</label><input value={form.accountManager} onChange={e => setForm(f => ({ ...f, accountManager: e.target.value }))} style={inputStyle} /></div>
                        </div>

                        <div style={{ marginTop: 14 }}>
                            <label style={labelStyle}>Delivery Days</label>
                            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
                                {DAYS.map(d => (
                                    <button key={d} type="button" onClick={() => toggleDay(d)}
                                        style={{ padding: '5px 10px', borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: 'pointer', border: form.deliveryDays.includes(d) ? '1px solid #38bdf8' : '1px solid rgba(255,255,255,0.08)', background: form.deliveryDays.includes(d) ? 'rgba(56,189,248,0.15)' : 'transparent', color: form.deliveryDays.includes(d) ? '#38bdf8' : '#94a3b8' }}>
                                        {d.slice(0, 3)}
                                    </button>
                                ))}
                            </div>
                        </div>

                        <div style={{ marginTop: 14 }}><label style={labelStyle}>Preferred Vendors (comma-separated)</label>
                            <input value={form.preferredVendors} onChange={e => setForm(f => ({ ...f, preferredVendors: e.target.value }))} style={inputStyle} placeholder="ON Thyme, Fresh Direct" /></div>
                        <div style={{ marginTop: 14 }}><label style={labelStyle}>Notes</label>
                            <textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} rows={2} style={{ ...inputStyle, resize: 'vertical' }} placeholder="Internal notes" /></div>

                        <div style={{ marginTop: 14, display: 'flex', alignItems: 'center', gap: 10 }}>
                            <label style={{ ...labelStyle, margin: 0 }}>Forecast Enabled</label>
                            <div onClick={() => setForm(f => ({ ...f, forecastEnabled: !f.forecastEnabled }))} style={{ width: 38, height: 20, borderRadius: 10, background: form.forecastEnabled ? '#10b981' : '#334155', cursor: 'pointer', position: 'relative', transition: 'background 0.15s' }}>
                                <div style={{ width: 16, height: 16, borderRadius: '50%', background: '#fff', position: 'absolute', top: 2, left: form.forecastEnabled ? 20 : 2, transition: 'left 0.15s' }} />
                            </div>
                        </div>

                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 20, paddingTop: 14, borderTop: '1px solid rgba(255,255,255,0.08)' }}>
                            <button onClick={() => setShowModal(false)} style={cancelBtnStyle}>Cancel</button>
                            <button onClick={handleSave} style={saveBtnStyle}>{editingId ? '💾 Update' : '💾 Create'}</button>
                        </div>
                    </div>
                </div>
            )}

            {/* Bulk Confirm */}
            {showBulkConfirm && (
                <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <div style={{ background: '#0f172a', borderRadius: 14, padding: 28, width: 380, border: '1px solid rgba(255,255,255,0.1)', textAlign: 'center' }}>
                        <div style={{ fontSize: 28, marginBottom: 12 }}>{showBulkConfirm === 'activate' ? '✅' : '⛔'}</div>
                        <h3 style={{ margin: '0 0 8px' }}>{showBulkConfirm === 'activate' ? 'Activate' : 'Deactivate'} {selected.size} restaurants?</h3>
                        <p style={{ fontSize: 13, color: '#94a3b8' }}>This will set all selected restaurants to <strong>{showBulkConfirm === 'activate' ? 'active' : 'inactive'}</strong>.</p>
                        <div style={{ display: 'flex', gap: 10, justifyContent: 'center', marginTop: 20 }}>
                            <button onClick={() => setShowBulkConfirm(null)} style={cancelBtnStyle}>Cancel</button>
                            <button onClick={() => handleBulkAction(showBulkConfirm)} style={{ ...saveBtnStyle, background: showBulkConfirm === 'activate' ? '#10b981' : '#f43f5e' }}>Confirm</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

// Shared inline styles
const labelStyle = { fontSize: 11, color: '#94a3b8', display: 'block', marginBottom: 4, fontWeight: 600 };
const inputStyle = { width: '100%', padding: '8px 12px', borderRadius: 8, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: '#f8fafc', outline: 'none', fontSize: 13, boxSizing: 'border-box' };
const selectStyle = { width: '100%', padding: '8px 12px', borderRadius: 8, background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(255,255,255,0.1)', color: '#f8fafc', outline: 'none', fontSize: 13, boxSizing: 'border-box' };
const cancelBtnStyle = { padding: '8px 18px', borderRadius: 8, background: 'rgba(255,255,255,0.05)', color: '#94a3b8', border: '1px solid rgba(255,255,255,0.08)', cursor: 'pointer', fontSize: 13 };
const saveBtnStyle = { padding: '8px 18px', borderRadius: 8, background: '#10b981', color: '#fff', border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600 };
