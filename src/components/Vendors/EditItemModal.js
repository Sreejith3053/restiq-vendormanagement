// src/components/Vendors/EditItemModal.js
import React, { useState, useContext, useEffect } from 'react';
import { UserContext } from '../../contexts/UserContext';
import { db, storage } from '../../firebase';
import { doc, updateDoc, collection, addDoc, getDocs, serverTimestamp } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { toast } from 'react-toastify';
import PricingIntelligencePanel from './PricingIntelligencePanel';
import CompetitivenessScorePanel from './CompetitivenessScorePanel';
import { matchCatalogItem } from '../../utils/catalogUtils';

const ITEM_CATEGORIES = ['Spices', 'Meat', 'Produce', 'Dairy', 'Seafood', 'Grains', 'Beverages', 'Packaging', 'Cleaning', 'Other'];
const UNITS = ['kg', 'lb', 'g', 'oz', 'L', 'mL', 'unit', 'dozen', 'case', 'packet', 'bag', 'bundle', 'box'];

export default function EditItemModal({ item, vendorId, vendorName, onClose, onItemUpdated, logAudit }) {
    const { isSuperAdmin, userId, displayName } = useContext(UserContext);

    const [form, setForm] = useState({
        name: item.name || '',
        brand: item.brand || '',
        category: item.category || '',
        unit: item.unit || 'kg',
        packQuantity: item.packQuantity || 1,
        itemSize: item.itemSize || '',
        vendorPrice: item.vendorPrice ?? item.price ?? '',
        sku: item.sku || '',
        description: item.description || '',
        notes: item.notes || '',
        taxable: !!item.taxable,
    });

    // New Actions
    const [requestType, setRequestType] = useState('edit'); // 'edit' or 'deactivate'
    const [proofFiles, setProofFiles] = useState([]);
    const proofInputRef = React.useRef(null);

    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const [catalogItems, setCatalogItems] = useState([]);
    const [catalogMatch, setCatalogMatch] = useState(null);

    // Load catalog items for matching
    useEffect(() => {
        getDocs(collection(db, 'catalogItems')).then(snap => {
            setCatalogItems(snap.docs.map(d => ({ id: d.id, ...d.data() })));
        }).catch(() => {});
    }, []);

    // Auto-match catalog item as name changes
    useEffect(() => {
        if (item.catalogItemId) {
            const found = catalogItems.find(c => c.catalogItemId === item.catalogItemId);
            if (found) { setCatalogMatch({ catalogItemId: found.catalogItemId, canonicalName: found.canonicalName, matchType: 'linked' }); return; }
        }
        if (!form.name.trim() || catalogItems.length === 0) { setCatalogMatch(null); return; }
        setCatalogMatch(matchCatalogItem(form.name.trim(), catalogItems));
    }, [form.name, catalogItems, item.catalogItemId]);

    const handleProofChange = (e) => {
        const files = Array.from(e.target.files || []);
        if (files.length === 0) return;
        const validTypes = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];

        const validFiles = [];
        for (const file of files) {
            if (!validTypes.includes(file.type)) { toast.warn(`${file.name} must be a PDF or Image`); continue; }
            if (file.size > 10 * 1024 * 1024) { toast.warn(`${file.name} must be under 10MB`); continue; }
            validFiles.push(file);
        }
        setProofFiles(prev => [...prev, ...validFiles]);
    };

    const handleChange = (field, value) => {
        setForm(prev => ({ ...prev, [field]: value }));
    };

    // Check if anything actually changed
    const hasChanges = () => {
        if (requestType !== 'edit') return true; // Deactivation is always a change

        return (
            form.name.trim() !== (item.name || '') ||
            form.brand.trim() !== (item.brand || '') ||
            form.category !== (item.category || '') ||
            form.unit !== (item.unit || 'kg') ||
            Number(form.packQuantity) !== (item.packQuantity || 1) ||
            form.itemSize.trim() !== (item.itemSize || '') ||
            String(form.vendorPrice) !== String(item.vendorPrice ?? item.price ?? '') ||
            form.sku.trim() !== (item.sku || '') ||
            form.description.trim() !== (item.description || '') ||
            form.notes.trim() !== (item.notes || '') ||
            form.taxable !== !!item.taxable
        );
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');

        if (requestType === 'edit') {
            if (!form.name.trim()) { setError('Item name is required.'); return; }
            if (!form.category) { setError('Select a category.'); return; }
        }
        if (!hasChanges()) { setError('No changes detected.'); return; }

        setSaving(true);
        try {
            let uploadedProofUrls = [];
            if (proofFiles.length > 0 && !isSuperAdmin) {
                try {
                    for (const file of proofFiles) {
                        const ext = file.name.split('.').pop() || 'pdf';
                        const storageRef = ref(storage, `proofs/${vendorId}/${item.id}_update_${Date.now()}_${Math.random().toString(36).substring(7)}.${ext}`);
                        await uploadBytes(storageRef, file);
                        const url = await getDownloadURL(storageRef);
                        uploadedProofUrls.push({ url, name: file.name });
                    }
                } catch (proofErr) {
                    console.error('Proof upload failed:', proofErr);
                    toast.warn('Some proof uploads failed, but continuing with request submission...');
                }
            }
            const proposedData = {
                name: form.name.trim(),
                brand: form.brand.trim(),
                category: form.category,
                unit: form.unit,
                packQuantity: Number(form.packQuantity) || 1,
                itemSize: form.itemSize.trim(),
                vendorPrice: Number(form.vendorPrice) || 0,
                sku: form.sku.trim(),
                description: form.description.trim(),
                notes: form.notes.trim(),
                taxable: !!form.taxable,
            };

            const originalData = {
                name: item.name || '',
                brand: item.brand || '',
                category: item.category || '',
                unit: item.unit || 'kg',
                packQuantity: item.packQuantity || 1,
                itemSize: item.itemSize || '',
                vendorPrice: Number(item.vendorPrice ?? item.price ?? 0),
                sku: item.sku || '',
                description: item.description || '',
                notes: item.notes || '',
                taxable: !!item.taxable,
            };

            if (isSuperAdmin) {
                // Super admin → direct update, always active unless deactivating
                const newStatus = requestType === 'deactivate' ? 'inactive' : 'active';
                const payload = requestType === 'deactivate' ? { status: newStatus } : { ...proposedData, status: newStatus };

                const itemRef = doc(db, `vendors/${vendorId}/items`, item.id);
                await updateDoc(itemRef, {
                    ...payload,
                    rejectionComment: '',
                    updatedAt: serverTimestamp(),
                    ...(catalogMatch ? { catalogItemId: catalogMatch.catalogItemId } : {}),
                });
                toast.success(`Item ${requestType === 'deactivate' ? 'deactivated' : 'updated'}!`);
                onItemUpdated({ ...item, ...payload, rejectionComment: '' });
                // Audit log
                if (logAudit) {
                    await logAudit(vendorId, item.id, requestType === 'deactivate' ? 'deactivated_direct' : 'edited_direct', {
                        itemName: proposedData.name,
                        originalData,
                        proposedData: requestType === 'deactivate' ? { status: 'inactive' } : proposedData,
                    });
                }
            } else {
                // Vendor admin/user → store review data directly on the item
                const reviewFields = {
                    status: 'in-review',
                    rejectionComment: '',
                    changeType: requestType === 'deactivate' ? 'deactivate' : 'edit',
                    proposedData: requestType === 'deactivate' ? { status: 'inactive' } : proposedData,
                    originalData,
                    requestedBy: userId,
                    requestedByName: displayName || 'Unknown',
                    requestedAt: serverTimestamp(),
                    ...(uploadedProofUrls.length > 0 && { proofUrls: uploadedProofUrls })
                };

                const itemRef = doc(db, `vendors/${vendorId}/items`, item.id);
                await updateDoc(itemRef, reviewFields);

                // Create Notification for Superadmins
                await addDoc(collection(db, 'notifications'), {
                    type: 'vendor_to_admin',
                    entityId: 'superadmin', // target group
                    title: requestType === 'deactivate' ? 'Deactivation Request' : 'Item Edit Request',
                    message: `${displayName || 'Vendor'} requested to ${requestType === 'deactivate' ? 'deactivate' : 'edit'} item "${item.name}".`,
                    isRead: false,
                    createdAt: serverTimestamp(),
                    metadata: { vendorId, itemId: item.id, changeType: requestType === 'deactivate' ? 'deactivate' : 'edit' }
                });

                toast.info(`✅ ${requestType === 'deactivate' ? 'Deactivation request' : 'Changes'} submitted for review!`);
                onItemUpdated({ ...item, ...reviewFields });
                // Audit log
                if (logAudit) {
                    await logAudit(vendorId, item.id, requestType === 'deactivate' ? 'deactivate_requested' : 'edit_requested', {
                        itemName: item.name,
                        proposedData: reviewFields.proposedData,
                        originalData,
                        ...(proofFiles.length > 0 && { proofFileCount: proofFiles.length })
                    });
                }
            }

            onClose();
        } catch (err) {
            console.error('Error saving item:', err);
            setError('Failed to save. Please try again.');
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="modalBackdrop" onClick={onClose}>
            <div className="modal" onClick={(e) => e.stopPropagation()}>
                <div className="modalHeader">
                    <h3>Edit Item</h3>
                </div>

                <div className="modalBody">
                    {/* Show rejection comments if item was rejected */}
                    {item.status === 'rejected' && item.rejectionComment && (
                        <div style={{ marginBottom: 12, fontSize: 13, background: 'rgba(255,77,106,0.08)', border: '1px solid rgba(255,77,106,0.2)', padding: '10px 14px', borderRadius: 8, color: '#ff6b7a' }}>
                            <strong>❌ Rejected:</strong> {item.rejectionComment}
                        </div>
                    )}
                    {!isSuperAdmin && (
                        <div style={{ marginBottom: 12, fontSize: 12, color: '#5a6f8a', background: 'rgba(0,200,255,0.06)', padding: '8px 12px', borderRadius: 6 }}>
                            ℹ️ Changes will be submitted for super admin review before being applied.
                        </div>
                    )}

                    {/* Catalog Item Mapping */}
                    {catalogMatch && (
                        <div style={{ marginBottom: 12, padding: '8px 14px', background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.2)', borderRadius: 8, display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
                            <span style={{ fontWeight: 700, color: '#10b981' }}>✓ Catalog:</span>
                            <span style={{ color: '#f8fafc', fontWeight: 600 }}>{catalogMatch.canonicalName}</span>
                            <span style={{ fontSize: 10, color: '#64748b', background: 'rgba(255,255,255,0.05)', padding: '1px 6px', borderRadius: 4 }}>{catalogMatch.matchType}</span>
                        </div>
                    )}

                    <div style={{ marginBottom: 20, display: 'flex', gap: 12 }}>
                        <button
                            type="button"
                            onClick={() => setRequestType('edit')}
                            className={`ui-btn small ${requestType === 'edit' ? 'primary' : 'ghost'}`}
                        >
                            ✏️ Edit Details
                        </button>
                        <button
                            type="button"
                            onClick={() => setRequestType('deactivate')}
                            className={`ui-btn small ${requestType === 'deactivate' ? 'danger' : 'ghost'}`}
                            style={requestType === 'deactivate' ? {} : { color: '#ef4444' }}
                        >
                            🚫 Request Deactivation
                        </button>
                    </div>

                    <form onSubmit={handleSubmit}>
                        {requestType === 'edit' ? (
                            <>
                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16 }}>
                                    <div><label className="ui-label">Item Name *</label><input className="ui-input" value={form.name} onChange={e => handleChange('name', e.target.value)} placeholder="e.g. Turmeric Powder" /></div>
                                    <div><label className="ui-label">Brand</label><input className="ui-input" value={form.brand} onChange={e => handleChange('brand', e.target.value)} placeholder="e.g. Eastern, Sakthi, MTR…" /></div>
                                    <div><label className="ui-label">Category *</label>
                                        <select className="ui-input" value={form.category} onChange={e => handleChange('category', e.target.value)}>
                                            <option value="">Select...</option>
                                            {ITEM_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                                        </select>
                                    </div>
                                </div>
                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 16, marginTop: 16 }}>
                                    <div><label className="ui-label">Pricing Unit</label>
                                        <select className="ui-input" value={form.unit} onChange={e => handleChange('unit', e.target.value)}>
                                            {UNITS.map(u => <option key={u} value={u}>{u}</option>)}
                                        </select>
                                    </div>
                                    <div><label className="ui-label">Qty per Unit</label><input className="ui-input" type="number" min="1" placeholder="e.g. 1" value={form.packQuantity} onChange={e => handleChange('packQuantity', e.target.value)} /></div>
                                    <div><label className="ui-label">Size per Qty</label><input className="ui-input" placeholder="e.g. 500g, 100mL" value={form.itemSize} onChange={e => handleChange('itemSize', e.target.value)} /></div>
                                    <div><label className="ui-label">Vendor Price ($)</label><input className="ui-input" type="number" step="0.01" value={form.vendorPrice} onChange={e => handleChange('vendorPrice', e.target.value)} placeholder="0.00" /></div>
                                </div>

                                {/* Marketplace Intelligence Panel */}
                                <PricingIntelligencePanel
                                    itemName={form.name}
                                    category={form.category}
                                    vendorPrice={form.vendorPrice}
                                    originalPrice={item.vendorPrice ?? item.price ?? 0}
                                    isEdit={true}
                                    onApplyPrice={(price) => handleChange('vendorPrice', String(price))}
                                />
                                {/* Vendor Competitiveness Score */}
                                <CompetitivenessScorePanel
                                    itemName={form.name}
                                    vendorPrice={form.vendorPrice}
                                    vendorId={vendorId}
                                    category={form.category}
                                />
                                <div style={{ marginTop: 16 }}><label className="ui-label">SKU</label><input className="ui-input" value={form.sku} onChange={e => handleChange('sku', e.target.value)} placeholder="Optional SKU or product code" /></div>
                                <div style={{ marginTop: 16 }}><label className="ui-label">Description</label><textarea className="ui-input" style={{ height: 60 }} value={form.description} onChange={e => handleChange('description', e.target.value)} placeholder="Public item description" /></div>
                                <div style={{ marginTop: 16 }}><label className="ui-label">Private Notes</label><input className="ui-input" value={form.notes} onChange={e => handleChange('notes', e.target.value)} placeholder="Internal notes" /></div>
                                <div style={{ marginTop: 16, display: 'flex', alignItems: 'center', gap: 12 }}>
                                    <label className="ui-label" style={{ margin: 0, cursor: 'pointer' }}>Taxable</label>
                                    <div
                                        className={`idp-toggle ${form.taxable ? 'active' : ''}`}
                                        onClick={() => handleChange('taxable', !form.taxable)}
                                        role="switch"
                                        aria-checked={!!form.taxable}
                                    >
                                        <div className="idp-toggle__knob" />
                                    </div>
                                    <span style={{ fontSize: 12, color: 'var(--muted)' }}>{form.taxable ? 'This item is subject to tax' : 'Not taxable'}</span>
                                </div>

                                {!isSuperAdmin && (
                                    <div style={{ marginTop: 20, padding: 16, background: 'rgba(255,255,255,0.02)', border: '1px solid var(--border)', borderRadius: 8 }}>
                                        <label className="ui-label" style={{ marginBottom: 4 }}>Supporting Documents (Optional)</label>
                                        <p style={{ fontSize: 12, color: 'var(--muted)', margin: '0 0 12px 0' }}>Upload invoices, quotations, product images, or packaging images.</p>
                                        <input type="file" ref={proofInputRef} accept=".pdf,image/*" multiple style={{ display: 'none' }} onChange={handleProofChange} />
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                                            <div>
                                                <button type="button" className="ui-btn small ghost" onClick={() => proofInputRef.current?.click()}>
                                                    📄 {proofFiles.length > 0 ? 'Add More Files' : 'Select Files'}
                                                </button>
                                            </div>
                                            {proofFiles.length > 0 && (
                                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                                                    {proofFiles.map((f, i) => (
                                                        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, background: 'rgba(255,255,255,0.05)', padding: '4px 8px', borderRadius: 4 }}>
                                                            <span style={{ color: '#4ade80' }}>✓ {f.name}</span>
                                                            <button type="button" onClick={() => setProofFiles(prev => prev.filter((_, idx) => idx !== i))} style={{ background: 'none', border: 'none', color: '#ff6b7a', cursor: 'pointer', padding: 0 }}>✕</button>
                                                        </div>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                )}
                            </>
                        ) : (
                            <div style={{ padding: 24, textAlign: 'center', background: 'rgba(239, 68, 68, 0.05)', border: '1px solid rgba(239, 68, 68, 0.2)', borderRadius: 12 }}>
                                <h4 style={{ margin: '0 0 12px 0', color: '#ef4444' }}>Deactivate this item?</h4>
                                <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: 13 }}>
                                    This will hide the item from the marketplace. {isSuperAdmin ? 'The action will be immediate.' : 'The Superadmin will review your request.'}
                                </p>
                            </div>
                        )}

                        {error && <div style={{ marginTop: 12, color: '#ff4d6a', fontSize: 13 }}>{error}</div>}

                        <div style={{ marginTop: 20, display: 'flex', justifyContent: 'flex-end', gap: 12 }}>
                            <button type="button" className="ui-btn ghost" onClick={onClose}>Cancel</button>
                            {hasChanges() && (
                                <button type="submit" className="ui-btn primary" disabled={saving}>
                                    {saving ? 'Saving…' : isSuperAdmin ? '💾 Update Item' : '📩 Submit for Review'}
                                </button>
                            )}
                        </div>
                    </form>
                </div>
            </div>
        </div>
    );
}
