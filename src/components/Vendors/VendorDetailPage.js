import React, { useEffect, useState, useContext } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { db } from '../../firebase';
import { doc, getDoc, updateDoc, collection, getDocs, addDoc, deleteDoc, serverTimestamp } from 'firebase/firestore';
import { UserContext } from '../../contexts/UserContext';
import { toast } from 'react-toastify';
import EditItemModal from './EditItemModal';

const ITEM_CATEGORIES = ['Spices', 'Meat', 'Produce', 'Dairy', 'Seafood', 'Grains', 'Beverages', 'Packaging', 'Cleaning', 'Other'];
const UNITS = ['kg', 'lb', 'g', 'oz', 'L', 'mL', 'unit', 'dozen', 'case', 'bag', 'box'];

export default function VendorDetailPage() {
    const { vendorId: urlVendorId } = useParams();
    const navigate = useNavigate();
    const { role, vendorId: ctxVendorId, isSuperAdmin, isAdmin, userId, displayName } = useContext(UserContext);

    // Super admin uses URL param; vendor admin/user uses their context vendorId
    const vendorId = isSuperAdmin ? urlVendorId : ctxVendorId;

    const [vendor, setVendor] = useState(null);
    const [items, setItems] = useState([]);
    const [loading, setLoading] = useState(true);

    // Filters
    const [search, setSearch] = useState('');
    const [categoryFilter, setCategoryFilter] = useState('All');
    const [statusFilter, setStatusFilter] = useState('All');

    // Edit vendor
    const [editing, setEditing] = useState(false);
    const [editForm, setEditForm] = useState({});

    // Add item modal
    const [itemModalOpen, setItemModalOpen] = useState(false);
    const [itemForm, setItemForm] = useState({ name: '', category: '', unit: 'kg', price: '', sku: '', notes: '' });
    const [itemSaving, setItemSaving] = useState(false);

    // Edit item modal
    const [editingItem, setEditingItem] = useState(null);

    // Review UI state (super admin)
    const [reviewFilter, setReviewFilter] = useState('in-review');
    const [processingReviewId, setProcessingReviewId] = useState(null);
    const [rejectingId, setRejectingId] = useState(null);
    const [rejectComment, setRejectComment] = useState('');

    // Audit log viewer
    const [auditLogItemId, setAuditLogItemId] = useState(null);
    const [auditLogData, setAuditLogData] = useState([]);
    const [auditLogLoading, setAuditLogLoading] = useState(false);

    const canEdit = isSuperAdmin || isAdmin;

    // Audit log helper
    const logAudit = async (vid, itemId, action, details = {}) => {
        try {
            await addDoc(collection(db, `vendors/${vid}/items/${itemId}/auditLog`), {
                action,
                ...details,
                performedBy: userId,
                performedByName: displayName || 'Unknown',
                timestamp: serverTimestamp(),
            });
        } catch (err) {
            console.error('Audit log failed:', err);
        }
    };

    useEffect(() => {
        (async () => {
            try {
                const vendorSnap = await getDoc(doc(db, 'vendors', vendorId));
                if (!vendorSnap.exists()) {
                    toast.error('Vendor not found');
                    navigate('/vendors');
                    return;
                }
                const vData = { id: vendorSnap.id, ...vendorSnap.data() };
                setVendor(vData);
                setEditForm(vData);

                // Load items
                const itemSnap = await getDocs(collection(db, `vendors/${vendorId}/items`));
                setItems(itemSnap.docs.map(d => ({ id: d.id, ...d.data() })));
            } catch (err) {
                console.error('Failed to load vendor:', err);
                toast.error('Failed to load vendor');
            } finally {
                setLoading(false);
            }
        })();
    }, [vendorId, navigate]);



    // Filter items
    const filteredItems = items.filter(item => {
        const matchSearch = !search ||
            (item.name || '').toLowerCase().includes(search.toLowerCase()) ||
            (item.sku || '').toLowerCase().includes(search.toLowerCase());
        const matchCat = categoryFilter === 'All' || item.category === categoryFilter;
        const matchStatus = statusFilter === 'All' || (item.status || 'active') === statusFilter;
        return matchSearch && matchCat && matchStatus;
    });

    // Save vendor edits
    const handleSaveVendor = async () => {
        try {
            const ref = doc(db, 'vendors', vendorId);
            const patch = {
                name: editForm.name?.trim() || '',
                category: editForm.category || '',
                contactName: editForm.contactName?.trim() || '',
                contactPhone: editForm.contactPhone?.trim() || '',
                contactEmail: editForm.contactEmail?.trim() || '',
                address: editForm.address?.trim() || '',
                notes: editForm.notes?.trim() || '',
                status: editForm.status || 'active',
                updatedAt: new Date().toISOString(),
            };
            await updateDoc(ref, patch);
            setVendor(prev => ({ ...prev, ...patch }));
            setEditing(false);
            toast.success('Vendor updated!');
        } catch (err) {
            console.error(err);
            toast.error('Failed to update vendor');
        }
    };

    // Add item
    const handleAddItem = async () => {
        if (!itemForm.name.trim()) { toast.warn('Item name is required'); return; }
        if (!itemForm.category) { toast.warn('Select a category'); return; }

        setItemSaving(true);
        try {
            const itemData = {
                name: itemForm.name.trim(),
                category: itemForm.category,
                unit: itemForm.unit,
                price: Number(itemForm.price) || 0,
                sku: itemForm.sku.trim(),
                notes: itemForm.notes.trim(),
                createdAt: new Date().toISOString(),
            };

            if (isSuperAdmin) {
                // Super admin → add directly as active
                const docRef = await addDoc(collection(db, `vendors/${vendorId}/items`), {
                    ...itemData,
                    status: 'active',
                });
                setItems(prev => [...prev, { id: docRef.id, ...itemData, status: 'active' }]);
                await logAudit(vendorId, docRef.id, 'created', { itemName: itemData.name });
                toast.success('Item added!');
            } else {
                // Vendor user → create item as in-review with review data on the item
                const reviewFields = {
                    changeType: 'add',
                    proposedData: itemData,
                    originalData: null,
                    requestedBy: userId,
                    requestedByName: displayName || 'Unknown',
                    requestedAt: serverTimestamp(),
                };
                const docRef = await addDoc(collection(db, `vendors/${vendorId}/items`), {
                    ...itemData,
                    status: 'in-review',
                    ...reviewFields,
                });
                setItems(prev => [...prev, { id: docRef.id, ...itemData, status: 'in-review', ...reviewFields }]);
                await logAudit(vendorId, docRef.id, 'created_pending', { itemName: itemData.name });
                toast.info('✅ New item submitted for review!');
            }

            setItemModalOpen(false);
            setItemForm({ name: '', category: '', unit: 'kg', price: '', sku: '', notes: '' });
        } catch (err) {
            console.error(err);
            toast.error('Failed to add item');
        } finally {
            setItemSaving(false);
        }
    };

    // Delete item — super admin deletes directly, vendor admin/user submits for review
    const handleDeleteItem = async (item) => {
        if (isSuperAdmin) {
            if (!window.confirm('Delete this item?')) return;
            try {
                await deleteDoc(doc(db, `vendors/${vendorId}/items`, item.id));
                setItems(prev => prev.filter(i => i.id !== item.id));
                toast.success('Item deleted');
            } catch (err) {
                console.error(err);
                toast.error('Failed to delete item');
            }
        } else {
            if (!window.confirm('Request deletion of this item? A super admin will review.')) return;
            try {
                const reviewFields = {
                    changeType: 'delete',
                    proposedData: null,
                    originalData: {
                        name: item.name || '',
                        category: item.category || '',
                        unit: item.unit || '',
                        price: Number(item.price) || 0,
                        sku: item.sku || '',
                        notes: item.notes || '',
                    },
                    requestedBy: userId,
                    requestedByName: displayName || 'Unknown',
                    requestedAt: serverTimestamp(),
                };
                const itemRef = doc(db, `vendors/${vendorId}/items`, item.id);
                await updateDoc(itemRef, { status: 'in-review', ...reviewFields });
                setItems(prev => prev.map(i => i.id === item.id ? { ...i, status: 'in-review', ...reviewFields } : i));
                await logAudit(vendorId, item.id, 'delete_requested', { itemName: item.name });
                toast.info('🗑️ Deletion request submitted for review!');
            } catch (err) {
                console.error(err);
                toast.error('Failed to submit deletion request');
            }
        }
    };

    // Handle item updated from edit modal
    const handleItemUpdated = (updatedItem) => {
        setItems(prev => prev.map(i => i.id === updatedItem.id ? updatedItem : i));
    };

    // ─── Review handlers (super admin) ───
    // "review" here is the item itself (which has review fields on it)
    const handleApproveReview = async (item) => {
        setProcessingReviewId(item.id);
        try {
            const itemRef = doc(db, `vendors/${vendorId}/items`, item.id);
            const clearFields = {
                status: 'active',
                rejectionComment: '',
                changeType: '',
                proposedData: null,
                originalData: null,
                requestedBy: '',
                requestedByName: '',
                requestedAt: null,
                updatedAt: new Date().toISOString(),
            };

            if ((item.changeType === 'edit' || item.changeType === 'add') && item.proposedData) {
                await updateDoc(itemRef, { ...item.proposedData, ...clearFields });
                setItems(prev => prev.map(i => i.id === item.id ? { ...i, ...item.proposedData, ...clearFields } : i));
            } else if (item.changeType === 'delete') {
                await deleteDoc(itemRef);
                setItems(prev => prev.filter(i => i.id !== item.id));
            }

            // Audit log
            if (item.changeType !== 'delete') {
                await logAudit(vendorId, item.id, 'approved', {
                    itemName: item.proposedData?.name || item.name,
                    proposedData: item.proposedData,
                    requestedBy: item.requestedByName,
                });
            }
            toast.success(`✅ ${item.changeType === 'delete' ? 'Deletion' : item.changeType === 'add' ? 'New item' : 'Edit'} approved!`);
        } catch (err) {
            console.error('Error approving review:', err);
            toast.error('Failed to approve');
        } finally {
            setProcessingReviewId(null);
        }
    };

    const handleRejectReview = async (item) => {
        if (!rejectComment.trim()) {
            toast.warn('Please add a rejection comment.');
            return;
        }
        setProcessingReviewId(item.id);
        try {
            const itemRef = doc(db, `vendors/${vendorId}/items`, item.id);
            if (item.changeType === 'add') {
                // Rejecting a new item → remove it entirely
                await deleteDoc(itemRef);
                setItems(prev => prev.filter(i => i.id !== item.id));
            } else {
                await updateDoc(itemRef, {
                    status: 'rejected',
                    rejectionComment: rejectComment.trim(),
                    changeType: '',
                    proposedData: null,
                    originalData: null,
                });
                setItems(prev => prev.map(i => i.id === item.id ? { ...i, status: 'rejected', rejectionComment: rejectComment.trim(), changeType: '', proposedData: null, originalData: null } : i));
            }
            setRejectingId(null);
            setRejectComment('');
            // Audit log
            if (item.changeType !== 'add') {
                await logAudit(vendorId, item.id, 'rejected', {
                    itemName: item.name,
                    rejectionComment: rejectComment.trim(),
                    requestedBy: item.requestedByName,
                });
            }
            toast.info('❌ Change request rejected.');
        } catch (err) {
            console.error('Error rejecting review:', err);
            toast.error('Failed to reject');
        } finally {
            setProcessingReviewId(null);
        }
    };

    const formatReviewDate = (ts) => {
        if (!ts) return '—';
        const d = ts.toDate ? ts.toDate() : new Date(ts.seconds * 1000);
        return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    };

    // Derive review items from items list (items with non-active status that have review data)
    const reviewItems = items.filter(i => i.status === 'in-review' || i.status === 'rejected');
    const filteredReviewItems = reviewFilter === 'all' ? reviewItems : reviewItems.filter(i => i.status === reviewFilter);
    const inReviewCount = items.filter(i => i.status === 'in-review').length;

    // Load audit log for a specific item
    const toggleAuditLog = async (itemId) => {
        if (auditLogItemId === itemId) {
            setAuditLogItemId(null);
            setAuditLogData([]);
            return;
        }
        setAuditLogItemId(itemId);
        setAuditLogLoading(true);
        try {
            const snap = await getDocs(collection(db, `vendors/${vendorId}/items/${itemId}/auditLog`));
            const logs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
            logs.sort((a, b) => {
                const tA = a.timestamp?.toMillis?.() || a.timestamp?.seconds * 1000 || 0;
                const tB = b.timestamp?.toMillis?.() || b.timestamp?.seconds * 1000 || 0;
                return tB - tA;
            });
            setAuditLogData(logs);
        } catch (err) {
            console.error('Failed to load audit log:', err);
            setAuditLogData([]);
        } finally {
            setAuditLogLoading(false);
        }
    };

    const formatAuditAction = (action) => {
        const map = {
            'created': '🆕 Created',
            'created_pending': '🆕 New Item (Pending Review)',
            'edited_direct': '✏️ Edited (Direct)',
            'edit_requested': '📩 Edit Submitted for Review',
            'approved': '✅ Approved',
            'rejected': '❌ Rejected',
            'delete_requested': '🗑️ Delete Requested',
            'deleted': '❌ Deleted',
            'delete_approved': '✅ Delete Approved',
        };
        return map[action] || action;
    };

    if (loading) {
        return <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>Loading vendor...</div>;
    }

    if (!vendor) return null;

    // Unique categories from loaded items for filter
    const itemCategories = ['All', ...new Set(items.map(i => i.category).filter(Boolean))];

    return (
        <div>
            {/* Header */}
            <div className="page-header">
                <h2>{vendor.name}</h2>
                <div style={{ display: 'flex', gap: 10 }}>
                    <button className="ui-btn ghost" onClick={() => navigate(isSuperAdmin ? '/vendors' : '/')}>← Back</button>
                    {canEdit && !editing && (
                        <button className="ui-btn small" onClick={() => setEditing(true)}>✏️ Edit</button>
                    )}
                </div>
            </div>

            {/* Vendor Info Card */}
            <div className="ui-card" style={{ marginBottom: 20 }}>
                {editing ? (
                    <>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: 16 }}>
                            <div><label className="ui-label">Name</label><input className="ui-input" value={editForm.name || ''} onChange={e => setEditForm(p => ({ ...p, name: e.target.value }))} /></div>
                            <div><label className="ui-label">Category</label>
                                <select className="ui-input" value={editForm.category || ''} onChange={e => setEditForm(p => ({ ...p, category: e.target.value }))}>
                                    <option value="">Select...</option>
                                    {ITEM_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                                </select>
                            </div>
                            <div><label className="ui-label">Contact Name</label><input className="ui-input" value={editForm.contactName || ''} onChange={e => setEditForm(p => ({ ...p, contactName: e.target.value }))} /></div>
                            <div><label className="ui-label">Phone</label><input className="ui-input" value={editForm.contactPhone || ''} onChange={e => setEditForm(p => ({ ...p, contactPhone: e.target.value }))} /></div>
                            <div><label className="ui-label">Email</label><input className="ui-input" value={editForm.contactEmail || ''} onChange={e => setEditForm(p => ({ ...p, contactEmail: e.target.value }))} /></div>
                            <div><label className="ui-label">Status</label>
                                <select className="ui-input" value={editForm.status || 'active'} onChange={e => setEditForm(p => ({ ...p, status: e.target.value }))}>
                                    <option value="active">Active</option>
                                    <option value="inactive">Inactive</option>
                                </select>
                            </div>
                        </div>
                        <div style={{ marginTop: 16 }}><label className="ui-label">Address</label><input className="ui-input" value={editForm.address || ''} onChange={e => setEditForm(p => ({ ...p, address: e.target.value }))} /></div>
                        <div style={{ marginTop: 16 }}><label className="ui-label">Notes</label><textarea className="ui-input" style={{ height: 60 }} value={editForm.notes || ''} onChange={e => setEditForm(p => ({ ...p, notes: e.target.value }))} /></div>
                        <div style={{ marginTop: 16, display: 'flex', justifyContent: 'flex-end', gap: 12 }}>
                            <button className="ui-btn ghost" onClick={() => { setEditing(false); setEditForm(vendor); }}>Cancel</button>
                            <button className="ui-btn primary" onClick={handleSaveVendor}>💾 Save</button>
                        </div>
                    </>
                ) : (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
                        <div><span className="muted small">Category</span><div><span className="badge blue">{vendor.category || 'General'}</span></div></div>
                        <div><span className="muted small">Contact</span><div>{vendor.contactName || '—'}</div></div>
                        <div><span className="muted small">Phone</span><div>{vendor.contactPhone || '—'}</div></div>
                        <div><span className="muted small">Email</span><div>{vendor.contactEmail || '—'}</div></div>
                        <div><span className="muted small">Address</span><div>{vendor.address || '—'}</div></div>
                        <div><span className="muted small">Status</span><div><span className={`badge ${vendor.status === 'inactive' ? 'red' : 'green'}`}>{vendor.status || 'active'}</span></div></div>
                        {vendor.notes && <div style={{ gridColumn: '1 / -1' }}><span className="muted small">Notes</span><div>{vendor.notes}</div></div>}
                    </div>
                )}
            </div>

            {/* Items Section Header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                <h3 style={{ margin: 0 }}>Items ({filteredItems.length}{filteredItems.length !== items.length ? ` of ${items.length}` : ''})</h3>
                {canEdit && (
                    <button className="ui-btn primary small" onClick={() => setItemModalOpen(true)}>
                        + Add Item
                    </button>
                )}
            </div>

            {/* Filters */}
            {items.length > 0 && (
                <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
                    <input
                        className="ui-input"
                        placeholder="🔍  Search items or SKU..."
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        style={{ maxWidth: 300, flex: 1 }}
                    />
                    <select
                        className="ui-input"
                        value={categoryFilter}
                        onChange={e => setCategoryFilter(e.target.value)}
                        style={{ maxWidth: 180 }}
                    >
                        {itemCategories.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                    <select
                        className="ui-input"
                        value={statusFilter}
                        onChange={e => setStatusFilter(e.target.value)}
                        style={{ maxWidth: 160 }}
                    >
                        <option value="All">All Statuses</option>
                        <option value="active">Active</option>
                        <option value="in-review">In Review</option>
                        <option value="rejected">Rejected</option>
                    </select>
                </div>
            )}

            {items.length === 0 ? (
                <div className="ui-card" style={{ textAlign: 'center', padding: 32, color: 'var(--muted)' }}>
                    No items yet. {canEdit && <span style={{ color: 'var(--accent-1)', cursor: 'pointer' }} onClick={() => setItemModalOpen(true)}>Add the first item →</span>}
                </div>
            ) : filteredItems.length === 0 ? (
                <div className="ui-card" style={{ textAlign: 'center', padding: 32, color: 'var(--muted)' }}>
                    No items match your filters.
                </div>
            ) : (
                <div className="ui-table-wrap">
                    <table className="ui-table">
                        <thead>
                            <tr>
                                <th>Item Name</th>
                                <th>Category</th>
                                <th>Unit</th>
                                <th>Price</th>
                                <th>SKU</th>
                                <th>Status</th>
                                {canEdit && <th>Actions</th>}
                            </tr>
                        </thead>
                        <tbody>
                            {filteredItems.map(item => {
                                const itemStatus = item.status || 'active';
                                const statusColor = itemStatus === 'active' ? 'green' : itemStatus === 'in-review' ? 'yellow' : 'red';
                                const statusLabel = itemStatus === 'active' ? 'Active' : itemStatus === 'in-review' ? 'In Review' : 'Rejected';
                                return (
                                    <React.Fragment key={item.id}>
                                        <tr className="is-row" onClick={() => navigate(`/vendors/${vendorId}/items/${item.id}`)} style={{ cursor: 'pointer' }}>
                                            <td data-label="Name" style={{ fontWeight: 600, color: '#4dabf7' }}>
                                                {item.name}
                                                {itemStatus === 'rejected' && item.rejectionComment && (
                                                    <div style={{ fontSize: 11, color: '#ff6b7a', fontWeight: 400, marginTop: 2 }}>
                                                        ❌ {item.rejectionComment}
                                                    </div>
                                                )}
                                            </td>
                                            <td data-label="Category"><span className="badge blue">{item.category || '—'}</span></td>
                                            <td data-label="Unit">{item.unit || '—'}</td>
                                            <td data-label="Price">${Number(item.price || 0).toFixed(2)}</td>
                                            <td data-label="SKU">{item.sku || '—'}</td>
                                            <td data-label="Status"><span className={`badge ${statusColor}`}>{statusLabel}</span></td>
                                            {canEdit && (
                                                <td onClick={e => e.stopPropagation()}>
                                                    <div style={{ display: 'flex', gap: 6 }}>
                                                        <button className="ui-btn mini" onClick={() => setEditingItem(item)}>✏️</button>
                                                        <button className="ui-btn mini danger" onClick={() => handleDeleteItem(item)}>🗑️</button>
                                                        <button className={`ui-btn mini ${auditLogItemId === item.id ? 'primary' : 'ghost'}`} onClick={() => toggleAuditLog(item.id)} title="View History">📜</button>
                                                    </div>
                                                </td>
                                            )}
                                        </tr>
                                        {/* Expandable audit log */}
                                        {auditLogItemId === item.id && (
                                            <tr>
                                                <td colSpan={canEdit ? 7 : 6} style={{ padding: 0 }}>
                                                    <div style={{ background: 'rgba(0,200,255,0.03)', borderTop: '1px solid rgba(255,255,255,0.06)', padding: '12px 16px' }}>
                                                        <div style={{ fontWeight: 600, marginBottom: 8, fontSize: 13 }}>📜 History for {item.name}</div>
                                                        {auditLogLoading ? (
                                                            <div style={{ color: 'var(--muted)', fontSize: 12 }}>Loading...</div>
                                                        ) : auditLogData.length === 0 ? (
                                                            <div style={{ color: 'var(--muted)', fontSize: 12 }}>No audit history yet.</div>
                                                        ) : (
                                                            <div style={{ maxHeight: 260, overflowY: 'auto' }}>
                                                                {auditLogData.map(log => (
                                                                    <div key={log.id} style={{ display: 'flex', gap: 12, alignItems: 'flex-start', padding: '6px 0', borderBottom: '1px solid rgba(255,255,255,0.04)', fontSize: 13 }}>
                                                                        <div style={{ minWidth: 170, color: 'var(--muted)', fontSize: 11 }}>
                                                                            {formatReviewDate(log.timestamp)}
                                                                        </div>
                                                                        <div style={{ flex: 1 }}>
                                                                            <div>
                                                                                <span style={{ fontWeight: 600 }}>{formatAuditAction(log.action)}</span>
                                                                                <span style={{ color: 'var(--muted)', marginLeft: 8 }}>by {log.performedByName}</span>
                                                                            </div>
                                                                            {log.rejectionComment && (
                                                                                <div style={{ fontSize: 11, color: '#ff6b7a', marginTop: 2 }}>💬 {log.rejectionComment}</div>
                                                                            )}
                                                                            {log.proposedData && (
                                                                                <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
                                                                                    Changes: {Object.keys(log.proposedData).filter(k => {
                                                                                        const orig = log.originalData ? String(log.originalData[k] ?? '') : '';
                                                                                        return String(log.proposedData[k] ?? '') !== orig;
                                                                                    }).map(k => (
                                                                                        <span key={k} style={{ marginRight: 8 }}>
                                                                                            <strong>{k}</strong>: {log.originalData ? `${log.originalData[k]} → ` : ''}{log.proposedData[k]}
                                                                                        </span>
                                                                                    ))}
                                                                                </div>
                                                                            )}
                                                                        </div>
                                                                    </div>
                                                                ))}
                                                            </div>
                                                        )}
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
            )}

            {/* Add Item Modal */}
            {
                itemModalOpen && (
                    <div className="modalBackdrop" onClick={() => setItemModalOpen(false)}>
                        <div className="modal" onClick={e => e.stopPropagation()}>
                            <div className="modalHeader"><h3>Add Item to {vendor.name}</h3></div>
                            <div className="modalBody">
                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16 }}>
                                    <div><label className="ui-label">Item Name *</label><input className="ui-input" placeholder="e.g. Turmeric Powder" value={itemForm.name} onChange={e => setItemForm(p => ({ ...p, name: e.target.value }))} /></div>
                                    <div><label className="ui-label">Category *</label>
                                        <select className="ui-input" value={itemForm.category} onChange={e => setItemForm(p => ({ ...p, category: e.target.value }))}>
                                            <option value="">Select...</option>
                                            {ITEM_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                                        </select>
                                    </div>
                                </div>
                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16, marginTop: 16 }}>
                                    <div><label className="ui-label">Unit</label>
                                        <select className="ui-input" value={itemForm.unit} onChange={e => setItemForm(p => ({ ...p, unit: e.target.value }))}>
                                            {UNITS.map(u => <option key={u} value={u}>{u}</option>)}
                                        </select>
                                    </div>
                                    <div><label className="ui-label">Price ($)</label><input className="ui-input" type="number" step="0.01" placeholder="0.00" value={itemForm.price} onChange={e => setItemForm(p => ({ ...p, price: e.target.value }))} /></div>
                                </div>
                                <div style={{ marginTop: 16 }}><label className="ui-label">SKU</label><input className="ui-input" placeholder="Optional SKU or product code" value={itemForm.sku} onChange={e => setItemForm(p => ({ ...p, sku: e.target.value }))} /></div>
                                <div style={{ marginTop: 16 }}><label className="ui-label">Notes</label><textarea className="ui-input" style={{ height: 60 }} placeholder="Optional notes" value={itemForm.notes} onChange={e => setItemForm(p => ({ ...p, notes: e.target.value }))} /></div>
                                <div style={{ marginTop: 20, display: 'flex', justifyContent: 'flex-end', gap: 12 }}>
                                    <button className="ui-btn ghost" onClick={() => setItemModalOpen(false)}>Cancel</button>
                                    <button className="ui-btn primary" onClick={handleAddItem} disabled={itemSaving}>{itemSaving ? 'Saving...' : isSuperAdmin ? '💾 Save Item' : '📩 Submit for Review'}</button>
                                </div>
                            </div>
                        </div>
                    </div>
                )
            }

            {/* Edit Item Modal */}
            {
                editingItem && (
                    <EditItemModal
                        item={editingItem}
                        vendorId={vendorId}
                        vendorName={vendor?.name}
                        onClose={() => setEditingItem(null)}
                        onItemUpdated={handleItemUpdated}
                        logAudit={logAudit}
                    />
                )
            }

            {/* ── Reviews Section (Super Admin) ── */}
            {
                isSuperAdmin && reviewItems.length > 0 && (
                    <div style={{ marginTop: 32 }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                            <h3 style={{ margin: 0 }}>
                                Items for Review {inReviewCount > 0 && <span className="badge yellow" style={{ marginLeft: 8, fontSize: 12 }}>{inReviewCount}</span>}
                            </h3>
                        </div>

                        {/* Review filter tabs */}
                        <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
                            {['in-review', 'rejected', 'all'].map(f => (
                                <button
                                    key={f}
                                    className={`ui-btn mini ${reviewFilter === f ? 'primary' : 'ghost'}`}
                                    onClick={() => setReviewFilter(f)}
                                >
                                    {f === 'in-review' && '🕐 '}{f === 'rejected' && '❌ '}{f === 'all' && '📋 '}
                                    {f === 'in-review' ? 'Pending' : f.charAt(0).toUpperCase() + f.slice(1)}
                                    {f === 'in-review' && inReviewCount > 0 && ` (${inReviewCount})`}
                                </button>
                            ))}
                        </div>

                        {filteredReviewItems.length === 0 ? (
                            <div className="ui-card" style={{ textAlign: 'center', padding: 24, color: 'var(--muted)' }}>
                                {reviewFilter === 'in-review' ? '🎉 No items pending review!' : `No ${reviewFilter} items.`}
                            </div>
                        ) : (
                            filteredReviewItems.map(item => (
                                <div key={item.id} className="ui-card" style={{ marginBottom: 12, padding: 16 }}>
                                    {/* Review header */}
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 8 }}>
                                        <div>
                                            <span className={`badge ${item.changeType === 'edit' ? 'blue' : item.changeType === 'add' ? 'green' : 'red'}`} style={{ marginRight: 8 }}>
                                                {item.changeType === 'edit' ? '✏️ Edit' : item.changeType === 'add' ? '🆕 New Item' : '🗑️ Delete'}
                                            </span>
                                            <span className={`badge ${item.status === 'in-review' ? 'yellow' : 'red'}`}>
                                                {item.status === 'in-review' ? 'Pending' : 'Rejected'}
                                            </span>
                                            <div style={{ marginTop: 6, fontWeight: 600 }}>{item.proposedData?.name || item.name || 'Unknown Item'}</div>
                                            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
                                                By <strong>{item.requestedByName}</strong> · {formatReviewDate(item.requestedAt)}
                                            </div>
                                        </div>
                                    </div>

                                    {/* Diff view for edits / detail view for adds */}
                                    {(item.changeType === 'edit' || item.changeType === 'add') && item.proposedData && (
                                        <div style={{ marginTop: 12, overflowX: 'auto' }}>
                                            <table className="ui-table" style={{ fontSize: 13 }}>
                                                <thead><tr><th>Field</th><th>Current</th><th>Proposed</th></tr></thead>
                                                <tbody>
                                                    {Object.keys(item.proposedData).filter(f => f !== 'createdAt').map(field => {
                                                        const orig = String(item.originalData?.[field] ?? '');
                                                        const proposed = String(item.proposedData[field] ?? '');
                                                        if (orig === proposed) return null;
                                                        return (
                                                            <tr key={field}>
                                                                <td style={{ fontWeight: 600, textTransform: 'capitalize' }}>{field}</td>
                                                                <td style={{ color: '#ff6b7a', textDecoration: 'line-through' }}>{field === 'price' ? `$${Number(orig).toFixed(2)}` : orig || '—'}</td>
                                                                <td style={{ color: '#4ade80' }}>{field === 'price' ? `$${Number(proposed).toFixed(2)}` : proposed || '—'}</td>
                                                            </tr>
                                                        );
                                                    })}
                                                </tbody>
                                            </table>
                                        </div>
                                    )}

                                    {/* Delete summary */}
                                    {item.changeType === 'delete' && item.originalData && (
                                        <div style={{ marginTop: 10, fontSize: 13, color: '#ff6b7a', background: 'rgba(255,77,106,0.06)', padding: '8px 12px', borderRadius: 6 }}>
                                            ⚠️ Delete <strong>{item.originalData.name}</strong> ({item.originalData.category}, ${Number(item.originalData.price).toFixed(2)}/{item.originalData.unit})
                                        </div>
                                    )}

                                    {/* Rejection comment display */}
                                    {item.status === 'rejected' && item.rejectionComment && (
                                        <div style={{ marginTop: 10, fontSize: 13, color: '#ff6b7a', background: 'rgba(255,77,106,0.06)', padding: '8px 12px', borderRadius: 6 }}>
                                            <strong>Rejection reason:</strong> {item.rejectionComment}
                                        </div>
                                    )}

                                    {/* Actions */}
                                    {item.status === 'in-review' && (
                                        <div style={{ marginTop: 12 }}>
                                            {rejectingId === item.id ? (
                                                <div>
                                                    <textarea
                                                        className="ui-input"
                                                        placeholder="Explain why this is being rejected..."
                                                        value={rejectComment}
                                                        onChange={e => setRejectComment(e.target.value)}
                                                        style={{ height: 60, marginBottom: 10, fontSize: 13 }}
                                                        autoFocus
                                                    />
                                                    <div style={{ display: 'flex', gap: 8 }}>
                                                        <button className="ui-btn danger small" onClick={() => handleRejectReview(item)} disabled={processingReviewId === item.id}>
                                                            {processingReviewId === item.id ? 'Rejecting…' : '❌ Confirm Rejection'}
                                                        </button>
                                                        <button className="ui-btn ghost small" onClick={() => { setRejectingId(null); setRejectComment(''); }}>Cancel</button>
                                                    </div>
                                                </div>
                                            ) : (
                                                <div style={{ display: 'flex', gap: 8 }}>
                                                    <button className="ui-btn primary small" onClick={() => handleApproveReview(item)} disabled={processingReviewId === item.id}>
                                                        {processingReviewId === item.id ? 'Processing…' : '✅ Approve'}
                                                    </button>
                                                    <button className="ui-btn danger small" onClick={() => { setRejectingId(item.id); setRejectComment(''); }} disabled={processingReviewId === item.id}>
                                                        ❌ Reject
                                                    </button>
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                            ))
                        )}
                    </div>
                )
            }
        </div >
    );
}
