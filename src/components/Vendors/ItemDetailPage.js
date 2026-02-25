// src/components/Vendors/ItemDetailPage.js
import React, { useEffect, useState, useContext } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { db } from '../../firebase';
import { doc, getDoc, updateDoc, collection, getDocs, addDoc, deleteDoc, serverTimestamp } from 'firebase/firestore';
import { storage } from '../../firebase';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { UserContext } from '../../contexts/UserContext';
import { toast } from 'react-toastify';
import { getTaxRate } from '../../constants/taxRates';
import { formatItemSize } from './VendorDetailPage';
import './ItemDetailPage.css';

const ITEM_CATEGORIES = ['Spices', 'Meat', 'Produce', 'Dairy', 'Seafood', 'Grains', 'Beverages', 'Packaging', 'Cleaning', 'Other'];
const UNITS = ['kg', 'lb', 'g', 'oz', 'L', 'mL', 'unit', 'dozen', 'case', 'packet', 'bag', 'bundle', 'box'];

export default function ItemDetailPage() {
    const { vendorId: urlVendorId, itemId } = useParams();
    const navigate = useNavigate();
    const { isSuperAdmin, isAdmin, userId, displayName, vendorId: ctxVendorId, permissions } = useContext(UserContext);

    // Use URL param vendorId, fallback to context vendorId for vendor users
    const vendorId = urlVendorId || ctxVendorId;

    const [vendor, setVendor] = useState(null);
    const [item, setItem] = useState(null);
    const [loading, setLoading] = useState(true);
    const [activeTab, setActiveTab] = useState('details');

    // Edit state
    const [editing, setEditing] = useState(false);
    const [editForm, setEditForm] = useState({});
    const [saving, setSaving] = useState(false);

    // Audit log
    const [auditLog, setAuditLog] = useState([]);
    const [auditLoading, setAuditLoading] = useState(false);
    const [auditLoaded, setAuditLoaded] = useState(false);

    // Image upload
    const [uploadingImage, setUploadingImage] = useState(false);
    const fileInputRef = React.useRef(null);

    // Approval state
    const [processingAction, setProcessingAction] = useState(false);
    const [showRejectInput, setShowRejectInput] = useState(false);
    const [rejectComment, setRejectComment] = useState('');

    const canEdit = isSuperAdmin || isAdmin || (typeof permissions === 'object' && permissions?.canManageItems);

    // ─── Image resize + upload ───
    const IMG_SIZE = 400;

    const resizeImage = (file) => {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                canvas.width = IMG_SIZE;
                canvas.height = IMG_SIZE;
                const ctx = canvas.getContext('2d');
                // Fill white background
                ctx.fillStyle = '#0b1220';
                ctx.fillRect(0, 0, IMG_SIZE, IMG_SIZE);
                // Center-crop: pick the largest square from center
                const size = Math.min(img.width, img.height);
                const sx = (img.width - size) / 2;
                const sy = (img.height - size) / 2;
                ctx.drawImage(img, sx, sy, size, size, 0, 0, IMG_SIZE, IMG_SIZE);
                canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Canvas failed')), 'image/webp', 0.85);
            };
            img.onerror = reject;
            img.src = URL.createObjectURL(file);
        });
    };

    const handleImageUpload = async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        if (!file.type.startsWith('image/')) { toast.warn('Please select an image file'); return; }
        if (file.size > 10 * 1024 * 1024) { toast.warn('Image must be under 10MB'); return; }
        setUploadingImage(true);
        try {
            const resized = await resizeImage(file);
            const storageRef = ref(storage, `items/${vendorId}/${itemId}.webp`);
            await uploadBytes(storageRef, resized, { contentType: 'image/webp' });
            const url = await getDownloadURL(storageRef);
            // Save URL to item doc
            const itemRef = doc(db, `vendors/${vendorId}/items`, itemId);
            await updateDoc(itemRef, { imageUrl: url, updatedAt: new Date().toISOString() });
            setItem(prev => ({ ...prev, imageUrl: url }));
            await logAudit('image_uploaded', { itemName: item.name });
            toast.success('Image uploaded!');
        } catch (err) {
            console.error('Upload failed:', err);
            toast.error('Failed to upload image');
        } finally {
            setUploadingImage(false);
            if (fileInputRef.current) fileInputRef.current.value = '';
        }
    };

    // ─── Load vendor + item ───
    useEffect(() => {
        (async () => {
            setLoading(true);
            try {
                const [vendorSnap, itemSnap] = await Promise.all([
                    getDoc(doc(db, 'vendors', vendorId)),
                    getDoc(doc(db, `vendors/${vendorId}/items`, itemId)),
                ]);
                if (!vendorSnap.exists()) { toast.error('Vendor not found'); navigate(-1); return; }
                if (!itemSnap.exists()) { toast.error('Item not found'); navigate(-1); return; }
                setVendor({ id: vendorSnap.id, ...vendorSnap.data() });
                setItem({ id: itemSnap.id, ...itemSnap.data() });
            } catch (err) {
                console.error('Load error:', err);
                toast.error('Failed to load item');
            } finally {
                setLoading(false);
            }
        })();
    }, [vendorId, itemId, navigate]);

    // ─── Load audit log on tab switch ───
    useEffect(() => {
        if ((activeTab === 'activity' || activeTab === 'price') && !auditLoaded) {
            loadAuditLog();
        }
    }, [activeTab]);

    const loadAuditLog = async () => {
        setAuditLoading(true);
        try {
            const snap = await getDocs(collection(db, `vendors/${vendorId}/items/${itemId}/auditLog`));
            const logs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
            logs.sort((a, b) => {
                const tA = a.timestamp?.toMillis?.() || a.timestamp?.seconds * 1000 || 0;
                const tB = b.timestamp?.toMillis?.() || b.timestamp?.seconds * 1000 || 0;
                return tB - tA;
            });
            setAuditLog(logs);
            setAuditLoaded(true);
        } catch (err) {
            console.error('Failed to load audit log:', err);
        } finally {
            setAuditLoading(false);
        }
    };

    // ─── Audit logger ───
    const logAudit = async (action, details = {}) => {
        try {
            await addDoc(collection(db, `vendors/${vendorId}/items/${itemId}/auditLog`), {
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

    // ─── Check for changes ───
    const hasChanges = () => {
        if (!item || !editForm) return false;
        return (
            (editForm.name || '').trim() !== (item.name || '').trim() ||
            (editForm.brand || '').trim() !== (item.brand || '').trim() ||
            (editForm.category || '') !== (item.category || '') ||
            (editForm.unit || 'kg') !== (item.unit || 'kg') ||
            Number(editForm.packQuantity || 1) !== Number(item.packQuantity || 1) ||
            (editForm.itemSize || '').trim() !== (item.itemSize || '').trim() ||
            String(editForm.price || '') !== String(item.price || '') ||
            (editForm.sku || '').trim() !== (item.sku || '').trim() ||
            (editForm.notes || '').trim() !== (item.notes || '').trim() ||
            !!editForm.taxable !== !!item.taxable
        );
    };

    // ─── Save edit ───
    const handleSave = async () => {
        if (!editForm.name?.trim()) { toast.warn('Name is required'); return; }
        if (!editForm.brand?.trim()) { toast.warn('Brand is required'); return; }
        if (!editForm.price || isNaN(editForm.price)) { toast.warn('Valid price required'); return; }
        if (!hasChanges()) { toast.info('No changes detected.'); setEditing(false); return; }
        setSaving(true);
        try {
            const proposedData = {
                name: editForm.name.trim(),
                brand: editForm.brand.trim(),
                category: editForm.category || 'Other',
                unit: editForm.unit || 'kg',
                packQuantity: Number(editForm.packQuantity) || 1,
                itemSize: editForm.itemSize?.trim() || '',
                price: Number(editForm.price),
                sku: editForm.sku?.trim() || '',
                notes: editForm.notes?.trim() || '',
                taxable: !!editForm.taxable,
            };
            const originalData = {
                name: item.name, brand: item.brand || '', category: item.category, unit: item.unit,
                packQuantity: item.packQuantity || 1, itemSize: item.itemSize || '',
                price: item.price, sku: item.sku || '', notes: item.notes || '', taxable: !!item.taxable,
            };
            const itemRef = doc(db, `vendors/${vendorId}/items`, itemId);

            if (isSuperAdmin) {
                await updateDoc(itemRef, {
                    ...proposedData,
                    status: 'active',
                    rejectionComment: '',
                    updatedAt: new Date().toISOString(),
                });
                setItem(prev => ({ ...prev, ...proposedData, status: 'active', rejectionComment: '' }));
                await logAudit('edited_direct', { itemName: proposedData.name, originalData, proposedData });
                toast.success('Item updated!');
            } else {
                await updateDoc(itemRef, {
                    status: 'in-review',
                    rejectionComment: '',
                    changeType: 'edit',
                    proposedData,
                    originalData,
                    requestedBy: userId,
                    requestedByName: displayName || 'Unknown',
                    requestedAt: serverTimestamp(),
                });
                setItem(prev => ({ ...prev, status: 'in-review', rejectionComment: '', changeType: 'edit', proposedData, originalData }));
                await logAudit('edit_requested', { itemName: item.name, proposedData });
                toast.info('✅ Changes submitted for review!');
            }
            setEditing(false);
            // Refresh audit log if loaded
            if (auditLoaded) loadAuditLog();
        } catch (err) {
            console.error('Save error:', err);
            toast.error('Failed to save');
        } finally {
            setSaving(false);
        }
    };

    // ─── Delete item ───
    const handleDelete = async () => {
        if (isSuperAdmin) {
            if (!window.confirm('Permanently delete this item?')) return;
            try {
                await deleteDoc(doc(db, `vendors/${vendorId}/items`, itemId));
                toast.success('Item deleted');
                navigate(`/vendors/${vendorId}`);
            } catch (err) {
                toast.error('Failed to delete');
            }
        } else {
            if (!window.confirm('Request deletion? A super admin will review.')) return;
            try {
                const itemRef = doc(db, `vendors/${vendorId}/items`, itemId);
                const reviewFields = {
                    changeType: 'delete',
                    proposedData: null,
                    originalData: {
                        name: item.name, category: item.category, unit: item.unit,
                        price: Number(item.price), sku: item.sku || '', notes: item.notes || '',
                    },
                    requestedBy: userId,
                    requestedByName: displayName || 'Unknown',
                    requestedAt: serverTimestamp(),
                };
                await updateDoc(itemRef, { status: 'in-review', ...reviewFields });
                setItem(prev => ({ ...prev, status: 'in-review', ...reviewFields }));
                await logAudit('delete_requested', { itemName: item.name });
                toast.info('🗑️ Deletion request submitted for review!');
            } catch (err) {
                toast.error('Failed to submit deletion request');
            }
        }
    };

    // ─── Approve review (super admin) ───
    const handleApprove = async () => {
        setProcessingAction(true);
        try {
            const itemRef = doc(db, `vendors/${vendorId}/items`, itemId);
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
                setItem(prev => ({ ...prev, ...item.proposedData, ...clearFields }));
            } else if (item.changeType === 'delete') {
                await deleteDoc(itemRef);
                toast.success('✅ Deletion approved!');
                navigate(`/vendors/${vendorId}`);
                return;
            }

            await logAudit('approved', {
                itemName: item.proposedData?.name || item.name,
                proposedData: item.proposedData,
                requestedBy: item.requestedByName,
            });
            toast.success(`✅ ${item.changeType === 'add' ? 'New item' : 'Edit'} approved!`);
            if (auditLoaded) loadAuditLog();
        } catch (err) {
            console.error('Error approving:', err);
            toast.error('Failed to approve');
        } finally {
            setProcessingAction(false);
        }
    };

    // ─── Reject review (super admin) ───
    const handleReject = async () => {
        if (!rejectComment.trim()) {
            toast.warn('Please add a rejection comment.');
            return;
        }
        setProcessingAction(true);
        try {
            const itemRef = doc(db, `vendors/${vendorId}/items`, itemId);
            if (item.changeType === 'add') {
                await deleteDoc(itemRef);
                toast.info('❌ New item rejected and removed.');
                navigate(`/vendors/${vendorId}`);
                return;
            }
            await updateDoc(itemRef, {
                status: 'rejected',
                rejectionComment: rejectComment.trim(),
                changeType: '',
                proposedData: null,
                originalData: null,
            });
            setItem(prev => ({
                ...prev,
                status: 'rejected',
                rejectionComment: rejectComment.trim(),
                changeType: '',
                proposedData: null,
                originalData: null,
            }));
            await logAudit('rejected', {
                itemName: item.name,
                rejectionComment: rejectComment.trim(),
                requestedBy: item.requestedByName,
            });
            toast.info('❌ Change request rejected.');
            setShowRejectInput(false);
            setRejectComment('');
            if (auditLoaded) loadAuditLog();
        } catch (err) {
            console.error('Error rejecting:', err);
            toast.error('Failed to reject');
        } finally {
            setProcessingAction(false);
        }
    };

    // ─── Helpers ───
    const formatDate = (ts) => {
        if (!ts) return '—';
        const d = ts.toDate ? ts.toDate() : ts.seconds ? new Date(ts.seconds * 1000) : new Date(ts);
        return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    };

    const formatAction = (action) => {
        const map = {
            'created': '🆕 Created',
            'created_pending': '🆕 Created (Pending)',
            'edited_direct': '✏️ Direct Edit',
            'edit_requested': '📩 Edit Requested',
            'approved': '✅ Approved',
            'rejected': '❌ Rejected',
            'deleted': '🗑️ Deleted',
            'delete_requested': '🗑️ Delete Requested',
            'image_uploaded': '📷 Image Uploaded',
        };
        return map[action] || action;
    };

    const getTimelineDotClass = (action) => {
        if (action.includes('created')) return 'created';
        if (action.includes('edit')) return 'edited';
        if (action.includes('approv')) return 'approved';
        if (action.includes('reject')) return 'rejected';
        if (action.includes('delet')) return 'deleted';
        return 'pending';
    };

    const statusBadgeClass = (status) => {
        if (status === 'active') return 'green';
        if (status === 'in-review') return 'amber';
        if (status === 'rejected') return 'red';
        return 'gray';
    };

    const statusLabel = (status) => {
        if (status === 'active') return 'Active';
        if (status === 'in-review') return 'In Review';
        if (status === 'rejected') return 'Rejected';
        return status;
    };

    // ─── Price history from audit log ───
    const priceHistory = auditLog
        .filter(log => log.proposedData?.price !== undefined || log.originalData?.price !== undefined)
        .filter(log => {
            const oldP = log.originalData?.price;
            const newP = log.proposedData?.price;
            return oldP !== undefined && newP !== undefined && Number(oldP) !== Number(newP);
        })
        .map(log => ({
            id: log.id,
            oldPrice: Number(log.originalData.price),
            newPrice: Number(log.proposedData.price),
            timestamp: log.timestamp,
            performedByName: log.performedByName,
            action: log.action,
        }));

    // ─── Loading ───
    if (loading) {
        return (
            <div style={{ padding: 24 }}>
                <div className="idp-skeleton" style={{ height: 200, marginBottom: 20 }} />
                <div className="idp-stats">
                    {[1, 2, 3, 4].map(i => <div key={i} className="idp-skeleton" style={{ height: 90 }} />)}
                </div>
            </div>
        );
    }

    if (!item) return null;

    // ─── Render ───
    return (
        <div style={{ padding: '0 4px' }}>
            {/* Breadcrumb */}
            <div className="idp-breadcrumb">
                {isSuperAdmin ? (
                    <>
                        <Link to="/vendors">Vendors</Link>
                        <span className="sep">›</span>
                        <Link to={`/vendors/${vendorId}`}>{vendor?.name || 'Vendor'}</Link>
                    </>
                ) : (
                    <>
                        <Link to="/profile">Profile</Link>
                    </>
                )}
                <span className="sep">›</span>
                <span style={{ color: 'var(--text)' }}>{item.name}</span>
            </div>

            {/* Hidden file input */}
            <input type="file" ref={fileInputRef} accept="image/*" style={{ display: 'none' }} onChange={handleImageUpload} />

            {/* Hero Card */}
            <div className="idp-hero">
                <div className="idp-hero__top">
                    {/* Item Image */}
                    <div className="idp-hero__image" onClick={() => canEdit && fileInputRef.current?.click()} style={{ cursor: canEdit ? 'pointer' : 'default' }}>
                        {uploadingImage ? (
                            <div className="idp-hero__image-placeholder">
                                <div className="idp-skeleton" style={{ width: '100%', height: '100%', borderRadius: 12 }} />
                                <div style={{ position: 'absolute', color: '#4dabf7', fontSize: 13, fontWeight: 600 }}>Uploading…</div>
                            </div>
                        ) : item.imageUrl ? (
                            <>
                                <img src={item.imageUrl} alt={item.name} className="idp-hero__img" />
                                {canEdit && (
                                    <div className="idp-hero__image-overlay">
                                        📷 Change
                                    </div>
                                )}
                            </>
                        ) : (
                            <div className="idp-hero__image-placeholder">
                                <span style={{ fontSize: 36, opacity: .4 }}>📷</span>
                                {canEdit && <span style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>Upload Image</span>}
                            </div>
                        )}
                    </div>

                    <div className="idp-hero__info">
                        <h1 className="idp-hero__name">{item.name}</h1>
                        <div className="idp-hero__badges">
                            <span className={`badge ${statusBadgeClass(item.status)}`}>{statusLabel(item.status || 'active')}</span>
                            <span className="badge blue">{item.category || 'Other'}</span>
                            {item.brand && <span className="badge gray">{item.brand}</span>}
                            {item.sku && <span className="badge gray">SKU: {item.sku}</span>}
                            <span className={`badge ${item.taxable ? 'green' : 'gray'}`}>{item.taxable ? '💲 Taxable' : 'Non-Taxable'}</span>
                        </div>
                        <div className="idp-hero__meta">
                            <div className="idp-hero__meta-item">
                                <span className="idp-hero__meta-label">Price</span>
                                <span className="idp-hero__meta-value price">${Number(item.price || 0).toFixed(2)}</span>
                            </div>
                            {item.taxable && vendor && (() => {
                                const rate = getTaxRate(vendor.country || 'Canada', vendor.province);
                                const taxAmt = (Number(item.price || 0) * rate / 100);
                                return rate > 0 ? (
                                    <div className="idp-hero__meta-item">
                                        <span className="idp-hero__meta-label">Tax ({rate}%)</span>
                                        <span className="idp-hero__meta-value" style={{ color: '#f59e0b' }}>${taxAmt.toFixed(2)}</span>
                                    </div>
                                ) : null;
                            })()}
                            {item.taxable && vendor && (() => {
                                const rate = getTaxRate(vendor.country || 'Canada', vendor.province);
                                const total = Number(item.price || 0) * (1 + rate / 100);
                                return rate > 0 ? (
                                    <div className="idp-hero__meta-item">
                                        <span className="idp-hero__meta-label">Price + Tax</span>
                                        <span className="idp-hero__meta-value" style={{ color: '#4dabf7' }}>${total.toFixed(2)}</span>
                                    </div>
                                ) : null;
                            })()}
                            <div className="idp-hero__meta-item">
                                <span className="idp-hero__meta-label">Pricing Unit</span>
                                <span className="idp-hero__meta-value" style={{ textTransform: 'capitalize' }}>
                                    {formatItemSize(item.unit, item.packQuantity, item.itemSize)}
                                </span>
                            </div>
                            <div className="idp-hero__meta-item">
                                <span className="idp-hero__meta-label">Category</span>
                                <span className="idp-hero__meta-value">{item.category || '—'}</span>
                            </div>
                        </div>
                    </div>
                    <div className="idp-hero__actions">
                        {canEdit && item.status !== 'in-review' && (
                            <button className="ui-btn primary small" onClick={() => { setEditForm({ ...item }); setEditing(true); }}>
                                ✏️ Edit
                            </button>
                        )}
                        {canEdit && (
                            <button className="ui-btn danger small" onClick={handleDelete}>
                                🗑️ {isSuperAdmin ? 'Delete' : 'Request Delete'}
                            </button>
                        )}
                        <button className="ui-btn ghost small" onClick={() => navigate(-1)}>
                            ← Back
                        </button>
                    </div>
                </div>
            </div>

            {/* Stats */}
            <div className="idp-stats">
                <div className="idp-stat">
                    <div className="idp-stat__icon">💰</div>
                    <div className="idp-stat__label">Current Price</div>
                    <div className="idp-stat__value" style={{ color: '#4ade80' }}>${Number(item.price || 0).toFixed(2)}</div>
                </div>
                <div className="idp-stat">
                    <div className="idp-stat__icon">📦</div>
                    <div className="idp-stat__label">Unit</div>
                    <div className="idp-stat__value" style={{ textTransform: 'capitalize' }}>
                        {formatItemSize(item.unit, item.packQuantity, item.itemSize) || '—'}
                    </div>
                </div>
                <div className="idp-stat">
                    <div className="idp-stat__icon">📊</div>
                    <div className="idp-stat__label">Price Changes</div>
                    <div className="idp-stat__value">{auditLoaded ? priceHistory.length : '—'}</div>
                </div>
                <div className="idp-stat">
                    <div className="idp-stat__icon">🕐</div>
                    <div className="idp-stat__label">Last Updated</div>
                    <div className="idp-stat__value" style={{ fontSize: 14 }}>{item.updatedAt ? new Date(item.updatedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—'}</div>
                </div>
            </div>

            {/* Tabs */}
            <div className="idp-tabs">
                <button className={`idp-tab ${activeTab === 'details' ? 'active' : ''}`} onClick={() => setActiveTab('details')}>
                    📋 Details
                </button>
                <button className={`idp-tab ${activeTab === 'price' ? 'active' : ''}`} onClick={() => setActiveTab('price')}>
                    📊 Price History
                </button>
                <button className={`idp-tab ${activeTab === 'activity' ? 'active' : ''}`} onClick={() => setActiveTab('activity')}>
                    📜 Activity {auditLoaded && auditLog.length > 0 && <span className="badge blue" style={{ fontSize: 10, padding: '2px 6px' }}>{auditLog.length}</span>}
                </button>
            </div>

            {/* ── Tab: Details ── */}
            {activeTab === 'details' && (
                <div>
                    {/* Review banner */}
                    {item.status === 'in-review' && (
                        <div className="idp-review-banner">
                            <div style={{ fontWeight: 700, marginBottom: 6 }}>
                                🕐 This item is pending review
                            </div>
                            <div style={{ fontSize: 13, color: 'var(--muted)' }}>
                                {item.changeType === 'edit' ? 'An edit has been submitted for review.' :
                                    item.changeType === 'add' ? 'This new item is pending approval.' :
                                        'A deletion request is pending.'}
                                {item.requestedByName && <span> — by <strong>{item.requestedByName}</strong></span>}
                            </div>
                            {item.proposedData && item.changeType === 'edit' && (
                                <div style={{ marginTop: 12 }}>
                                    <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)', marginBottom: 6 }}>PROPOSED CHANGES</div>
                                    <div style={{ display: 'grid', gap: 6 }}>
                                        {Object.keys(item.proposedData).filter(f => f !== 'createdAt').map(field => {
                                            const orig = String(item.originalData?.[field] ?? '');
                                            const proposed = String(item.proposedData[field] ?? '');
                                            if (orig === proposed) return null;
                                            return (
                                                <div key={field} style={{ display: 'flex', gap: 8, fontSize: 13 }}>
                                                    <span style={{ fontWeight: 600, textTransform: 'capitalize', minWidth: 70 }}>{field}:</span>
                                                    <span style={{ color: '#ff6b7a', textDecoration: 'line-through' }}>{field === 'price' ? `$${Number(orig).toFixed(2)}` : orig || '—'}</span>
                                                    <span style={{ color: 'var(--muted)' }}>→</span>
                                                    <span style={{ color: '#4ade80' }}>{field === 'price' ? `$${Number(proposed).toFixed(2)}` : proposed || '—'}</span>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            )}
                            {/* Super admin approval actions */}
                            {isSuperAdmin && (
                                <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 10, borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: 12 }}>
                                    <div style={{ display: 'flex', gap: 8 }}>
                                        <button className="ui-btn primary small" onClick={handleApprove} disabled={processingAction}>
                                            {processingAction ? 'Processing…' : '✅ Approve'}
                                        </button>
                                        <button className="ui-btn danger small" onClick={() => setShowRejectInput(!showRejectInput)} disabled={processingAction}>
                                            ❌ Reject
                                        </button>
                                    </div>
                                    {showRejectInput && (
                                        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                                            <textarea
                                                className="ui-input"
                                                rows={2}
                                                placeholder="Rejection reason…"
                                                value={rejectComment}
                                                onChange={e => setRejectComment(e.target.value)}
                                                style={{ flex: 1, fontSize: 13 }}
                                            />
                                            <button className="ui-btn danger small" onClick={handleReject} disabled={processingAction || !rejectComment.trim()}>
                                                Send
                                            </button>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    )}

                    {item.status === 'rejected' && item.rejectionComment && (
                        <div className="idp-review-banner rejected">
                            <div style={{ fontWeight: 700, marginBottom: 4 }}>❌ Last change was rejected</div>
                            <div style={{ fontSize: 13 }}>{item.rejectionComment}</div>
                        </div>
                    )}

                    {/* Edit form or read-only fields */}
                    {editing ? (
                        <div className="ui-card" style={{ padding: 20 }}>
                            <h3 style={{ margin: '0 0 16px' }}>Edit Item</h3>
                            <div className="idp-details-grid">
                                <div>
                                    <label className="ui-label">Name *</label>
                                    <input className="ui-input" value={editForm.name || ''} onChange={e => setEditForm(prev => ({ ...prev, name: e.target.value }))} />
                                </div>
                                <div>
                                    <label className="ui-label">Brand *</label>
                                    <input className="ui-input" placeholder="e.g. Eastern, Sakthi, MTR…" value={editForm.brand || ''} onChange={e => setEditForm(prev => ({ ...prev, brand: e.target.value }))} />
                                </div>
                                <div>
                                    <label className="ui-label">Category</label>
                                    <select className="ui-input" value={editForm.category || 'Other'} onChange={e => setEditForm(prev => ({ ...prev, category: e.target.value }))}>
                                        {ITEM_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                                    </select>
                                </div>
                                <div>
                                    <label className="ui-label">Price *</label>
                                    <input className="ui-input" type="number" step="0.01" value={editForm.price || ''} onChange={e => setEditForm(prev => ({ ...prev, price: e.target.value }))} />
                                </div>
                                <div className="idp-detail-item">
                                    <span className="idp-detail-label">Pricing Unit</span>
                                    <select className="ui-input" value={editForm.unit || 'kg'} onChange={e => setEditForm({ ...editForm, unit: e.target.value })}>
                                        {UNITS.map(u => <option key={u} value={u}>{u}</option>)}
                                    </select>
                                </div>
                                <div className="idp-detail-item">
                                    <span className="idp-detail-label">Qty per Unit</span>
                                    <input className="ui-input" type="number" min="1" value={editForm.packQuantity || 1} onChange={e => setEditForm({ ...editForm, packQuantity: e.target.value })} />
                                </div>
                                <div className="idp-detail-item">
                                    <span className="idp-detail-label">Size per Qty</span>
                                    <input className="ui-input" placeholder="e.g. 500g" value={editForm.itemSize || ''} onChange={e => setEditForm({ ...editForm, itemSize: e.target.value })} />
                                </div>
                                <div>
                                    <label className="ui-label">SKU</label>
                                    <input className="ui-input" value={editForm.sku || ''} onChange={e => setEditForm(prev => ({ ...prev, sku: e.target.value }))} />
                                </div>
                                <div className="idp-field--full">
                                    <label className="ui-label">Notes</label>
                                    <textarea className="ui-input" rows={3} value={editForm.notes || ''} onChange={e => setEditForm(prev => ({ ...prev, notes: e.target.value }))} />
                                </div>
                                <div className="idp-field--full" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 0' }}>
                                    <label className="ui-label" style={{ margin: 0, cursor: 'pointer' }}>Taxable</label>
                                    <div
                                        className={`idp-toggle ${editForm.taxable ? 'active' : ''}`}
                                        onClick={() => setEditForm(prev => ({ ...prev, taxable: !prev.taxable }))}
                                        role="switch"
                                        aria-checked={!!editForm.taxable}
                                    >
                                        <div className="idp-toggle__knob" />
                                    </div>
                                    <span style={{ fontSize: 12, color: 'var(--muted)' }}>{editForm.taxable ? 'This item is subject to tax' : 'Not taxable'}</span>
                                </div>
                                {editForm.taxable && (() => {
                                    const rate = vendor ? getTaxRate(vendor.country || 'Canada', vendor.province) : 0;
                                    const price = Number(editForm.price || 0);
                                    const taxAmt = price * rate / 100;
                                    const total = price + taxAmt;
                                    if (!vendor?.province) {
                                        return (
                                            <div className="idp-field--full" style={{ padding: '10px 14px', borderRadius: 8, background: 'rgba(245, 158, 11, .08)', border: '1px solid rgba(245, 158, 11, .2)', fontSize: 13, color: '#f59e0b' }}>
                                                ⚠️ Set the vendor's province/state in the <a href={`/vendors/${vendorId}`} style={{ color: '#4dabf7', textDecoration: 'underline' }}>vendor page</a> to calculate tax.
                                            </div>
                                        );
                                    }
                                    return (
                                        <div className="idp-field--full" style={{ padding: '12px 16px', borderRadius: 10, background: 'rgba(74, 222, 128, .06)', border: '1px solid rgba(74, 222, 128, .15)' }}>
                                            <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', alignItems: 'center', fontSize: 14 }}>
                                                <span style={{ color: 'var(--muted)' }}>Tax Rate: <strong style={{ color: '#f59e0b' }}>{rate}%</strong></span>
                                                <span style={{ color: 'var(--muted)' }}>Tax: <strong style={{ color: '#f59e0b' }}>${taxAmt.toFixed(2)}</strong></span>
                                                <span style={{ color: 'var(--muted)' }}>Total: <strong style={{ color: '#4ade80', fontSize: 16 }}>${total.toFixed(2)}</strong> <span style={{ fontSize: 12 }}>/ {editForm.unit || 'unit'}</span></span>
                                            </div>
                                        </div>
                                    );
                                })()}
                            </div>
                            <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
                                {hasChanges() && (
                                    <button className="ui-btn primary small" onClick={handleSave} disabled={saving}>
                                        {saving ? 'Saving…' : isSuperAdmin ? '💾 Save' : '📩 Submit for Review'}
                                    </button>
                                )}
                                <button className="ui-btn ghost small" onClick={() => setEditing(false)} disabled={saving}>Cancel</button>
                            </div>
                        </div>
                    ) : (
                        <div className="idp-details-grid">
                            <div className="idp-field">
                                <div className="idp-field__label">Name</div>
                                <div className="idp-field__value">{item.name}</div>
                            </div>
                            <div className="idp-field">
                                <div className="idp-field__label">Brand</div>
                                <div className="idp-field__value">{item.brand || '—'}</div>
                            </div>
                            <div className="idp-field">
                                <div className="idp-field__label">Category</div>
                                <div className="idp-field__value">{item.category || '—'}</div>
                            </div>
                            <div className="idp-field">
                                <div className="idp-field__label">Price</div>
                                <div className="idp-field__value" style={{ color: '#4ade80', fontSize: 18, fontWeight: 700 }}>${Number(item.price || 0).toFixed(2)} <span style={{ fontSize: 13, color: 'var(--muted)', fontWeight: 400 }}>/ {item.unit || '—'}</span></div>
                            </div>
                            <div className="idp-field">
                                <div className="idp-field__label">Pricing Unit</div>
                                <div className="idp-field__value" style={{ textTransform: 'capitalize' }}>{item.unit || '—'}</div>
                            </div>
                            <div className="idp-field">
                                <div className="idp-field__label">Qty per Unit</div>
                                <div className="idp-field__value">{item.packQuantity || 1}</div>
                            </div>
                            <div className="idp-field">
                                <div className="idp-field__label">Size per Qty</div>
                                <div className="idp-field__value">{item.itemSize || '—'}</div>
                            </div>
                            <div className="idp-field">
                                <div className="idp-field__label">SKU</div>
                                <div className="idp-field__value">{item.sku || '—'}</div>
                            </div>
                            <div className="idp-field">
                                <div className="idp-field__label">Taxable</div>
                                <div className="idp-field__value" style={{ color: item.taxable ? '#4ade80' : 'var(--muted)' }}>{item.taxable ? '✅ Yes' : 'No'}</div>
                            </div>
                            {item.taxable && vendor && (() => {
                                const rate = getTaxRate(vendor.country || 'Canada', vendor.province);
                                const taxAmt = (Number(item.price || 0) * rate / 100);
                                const total = Number(item.price || 0) + taxAmt;
                                return rate > 0 ? (
                                    <div className="idp-field idp-field--full" style={{ background: 'rgba(245, 158, 11, .06)', borderColor: 'rgba(245, 158, 11, .15)' }}>
                                        <div className="idp-field__label">Tax Breakdown</div>
                                        <div className="idp-field__value" style={{ display: 'flex', gap: 24, flexWrap: 'wrap', alignItems: 'center' }}>
                                            <span>Rate: <strong style={{ color: '#f59e0b' }}>{rate}%</strong></span>
                                            <span>Tax: <strong style={{ color: '#f59e0b' }}>${taxAmt.toFixed(2)}</strong></span>
                                            <span>Total: <strong style={{ color: '#4dabf7' }}>${total.toFixed(2)}</strong> <span style={{ fontSize: 12, color: 'var(--muted)' }}>/ {item.unit || '—'}</span></span>
                                        </div>
                                    </div>
                                ) : null;
                            })()}
                            {item.notes && (
                                <div className="idp-field idp-field--full">
                                    <div className="idp-field__label">Notes</div>
                                    <div className="idp-field__value" style={{ whiteSpace: 'pre-wrap' }}>{item.notes}</div>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            )}

            {/* ── Tab: Price History ── */}
            {activeTab === 'price' && (
                <div>
                    {auditLoading ? (
                        <div className="idp-empty"><div className="idp-skeleton" style={{ height: 200 }} /></div>
                    ) : priceHistory.length === 0 ? (
                        <div className="idp-empty">
                            <div className="idp-empty__icon">📊</div>
                            <div>No price changes recorded yet</div>
                            <div style={{ fontSize: 12, marginTop: 4 }}>Price history will appear here when edits are made.</div>
                        </div>
                    ) : (
                        <div>
                            {priceHistory.map((entry, idx) => {
                                const diff = entry.newPrice - entry.oldPrice;
                                const pct = entry.oldPrice > 0 ? ((diff / entry.oldPrice) * 100).toFixed(1) : '—';
                                const isUp = diff > 0;
                                return (
                                    <div key={entry.id} className="idp-price-row">
                                        <div style={{ fontSize: 20, marginRight: 4 }}>
                                            {isUp ? '📈' : '📉'}
                                        </div>
                                        <div className="idp-price-change">
                                            <span className="idp-price-old">${entry.oldPrice.toFixed(2)}</span>
                                            <span className="idp-price-arrow">→</span>
                                            <span className="idp-price-new">${entry.newPrice.toFixed(2)}</span>
                                        </div>
                                        <span className={`badge ${isUp ? 'red' : 'green'}`} style={{ fontSize: 11 }}>
                                            {isUp ? '+' : ''}{pct}%
                                        </span>
                                        <div className="idp-price-meta">
                                            <div>{entry.performedByName}</div>
                                            <div>{formatDate(entry.timestamp)}</div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            )}

            {/* ── Tab: Activity ── */}
            {activeTab === 'activity' && (
                <div>
                    {auditLoading ? (
                        <div className="idp-empty"><div className="idp-skeleton" style={{ height: 200 }} /></div>
                    ) : auditLog.length === 0 ? (
                        <div className="idp-empty">
                            <div className="idp-empty__icon">📜</div>
                            <div>No activity recorded yet</div>
                        </div>
                    ) : (
                        <div className="idp-timeline">
                            {auditLog.map(log => (
                                <div key={log.id} className="idp-timeline-item">
                                    <div className={`idp-timeline-dot ${getTimelineDotClass(log.action)}`} />
                                    <div className="idp-timeline-header">
                                        <span className="idp-timeline-action">{formatAction(log.action)}</span>
                                        <span className="idp-timeline-time">{formatDate(log.timestamp)}</span>
                                    </div>
                                    <div className="idp-timeline-performer">
                                        by <strong>{log.performedByName || 'System'}</strong>
                                    </div>
                                    {/* Show details if available */}
                                    {(log.rejectionComment || log.proposedData) && (
                                        <div className="idp-timeline-details">
                                            {log.rejectionComment && (
                                                <div>💬 <strong>Reason:</strong> {log.rejectionComment}</div>
                                            )}
                                            {log.proposedData && log.originalData && (
                                                <div style={{ marginTop: log.rejectionComment ? 8 : 0 }}>
                                                    {Object.keys(log.proposedData).filter(f => f !== 'createdAt').map(field => {
                                                        const orig = String(log.originalData?.[field] ?? '');
                                                        const proposed = String(log.proposedData[field] ?? '');
                                                        if (orig === proposed) return null;
                                                        return (
                                                            <div key={field} style={{ marginBottom: 2 }}>
                                                                <span style={{ textTransform: 'capitalize', fontWeight: 600 }}>{field}</span>:{' '}
                                                                <span style={{ color: '#ff6b7a', textDecoration: 'line-through' }}>{field === 'price' ? `$${Number(orig).toFixed(2)}` : orig || '—'}</span>
                                                                {' → '}
                                                                <span style={{ color: '#4ade80' }}>{field === 'price' ? `$${Number(proposed).toFixed(2)}` : proposed || '—'}</span>
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
