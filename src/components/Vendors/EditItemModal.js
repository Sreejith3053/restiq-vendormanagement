// src/components/Vendors/EditItemModal.js
import React, { useState, useContext } from 'react';
import { UserContext } from '../../contexts/UserContext';
import { db } from '../../firebase';
import { doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { toast } from 'react-toastify';

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
        price: item.price || '',
        sku: item.sku || '',
        notes: item.notes || '',
        taxable: !!item.taxable,
    });
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');

    const handleChange = (field, value) => {
        setForm(prev => ({ ...prev, [field]: value }));
    };

    // Check if anything actually changed
    const hasChanges = () => {
        return (
            form.name.trim() !== (item.name || '') ||
            form.brand.trim() !== (item.brand || '') ||
            form.category !== (item.category || '') ||
            form.unit !== (item.unit || 'kg') ||
            Number(form.packQuantity) !== (item.packQuantity || 1) ||
            form.itemSize.trim() !== (item.itemSize || '') ||
            String(form.price) !== String(item.price || '') ||
            form.sku.trim() !== (item.sku || '') ||
            form.notes.trim() !== (item.notes || '') ||
            form.taxable !== !!item.taxable
        );
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');

        if (!form.name.trim()) { setError('Item name is required.'); return; }
        if (!form.brand.trim()) { setError('Brand is required.'); return; }
        if (!form.category) { setError('Select a category.'); return; }
        if (!hasChanges()) { setError('No changes detected.'); return; }

        setSaving(true);
        try {
            const proposedData = {
                name: form.name.trim(),
                brand: form.brand.trim(),
                category: form.category,
                unit: form.unit,
                packQuantity: Number(form.packQuantity) || 1,
                itemSize: form.itemSize.trim(),
                price: Number(form.price) || 0,
                sku: form.sku.trim(),
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
                price: Number(item.price) || 0,
                sku: item.sku || '',
                notes: item.notes || '',
                taxable: !!item.taxable,
            };

            if (isSuperAdmin) {
                // Super admin → direct update, always active
                const itemRef = doc(db, `vendors/${vendorId}/items`, item.id);
                await updateDoc(itemRef, {
                    ...proposedData,
                    status: 'active',
                    rejectionComment: '',
                    updatedAt: new Date().toISOString(),
                });
                toast.success('Item updated!');
                onItemUpdated({ ...item, ...proposedData, status: 'active', rejectionComment: '' });
                // Audit log
                if (logAudit) {
                    await logAudit(vendorId, item.id, 'edited_direct', {
                        itemName: proposedData.name,
                        originalData,
                        proposedData,
                    });
                }
            } else {
                // Vendor admin/user → store review data directly on the item
                const itemRef = doc(db, `vendors/${vendorId}/items`, item.id);
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

                toast.info('✅ Changes submitted for review!');
                onItemUpdated({ ...item, status: 'in-review', rejectionComment: '', changeType: 'edit', proposedData, originalData, requestedBy: userId, requestedByName: displayName || 'Unknown' });
                // Audit log
                if (logAudit) {
                    await logAudit(vendorId, item.id, 'edit_requested', {
                        itemName: item.name,
                        proposedData,
                        originalData,
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
                    <form onSubmit={handleSubmit}>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16 }}>
                            <div><label className="ui-label">Item Name *</label><input className="ui-input" value={form.name} onChange={e => handleChange('name', e.target.value)} placeholder="e.g. Turmeric Powder" /></div>
                            <div><label className="ui-label">Brand *</label><input className="ui-input" value={form.brand} onChange={e => handleChange('brand', e.target.value)} placeholder="e.g. Eastern, Sakthi, MTR…" /></div>
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
                            <div><label className="ui-label">Price ($)</label><input className="ui-input" type="number" step="0.01" value={form.price} onChange={e => handleChange('price', e.target.value)} placeholder="0.00" /></div>
                        </div>
                        <div style={{ marginTop: 16 }}><label className="ui-label">SKU</label><input className="ui-input" value={form.sku} onChange={e => handleChange('sku', e.target.value)} placeholder="Optional SKU or product code" /></div>
                        <div style={{ marginTop: 16 }}><label className="ui-label">Notes</label><input className="ui-input" value={form.notes} onChange={e => handleChange('notes', e.target.value)} placeholder="Optional notes" /></div>
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
