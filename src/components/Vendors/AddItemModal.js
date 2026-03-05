import React, { useState, useRef } from 'react';
import { db, storage } from '../../firebase';
import { addDoc, collection, serverTimestamp, updateDoc, doc } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { toast } from 'react-toastify';

const ITEM_CATEGORIES = ['Spices', 'Meat', 'Produce', 'Dairy', 'Seafood', 'Grains', 'Beverages', 'Packaging', 'Cleaning', 'Other'];
const UNITS = ['kg', 'lb', 'g', 'oz', 'L', 'mL', 'unit', 'dozen', 'case', 'packet', 'bag', 'bundle', 'box'];

export default function AddItemModal({ vendorId, isSuperAdmin, userId, displayName, onClose, onItemAdded, logAudit }) {
    const [itemForm, setItemForm] = useState({ name: '', brand: '', category: '', unit: 'kg', packQuantity: 1, itemSize: '', price: '', sku: '', notes: '', taxable: false });
    const [imageFile, setImageFile] = useState(null);
    const [uploadingImage, setUploadingImage] = useState(false);
    const [itemSaving, setItemSaving] = useState(false);
    const fileInputRef = useRef(null);

    const IMG_SIZE = 400;

    const resizeImage = (file) => {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                canvas.width = IMG_SIZE;
                canvas.height = IMG_SIZE;
                const ctx = canvas.getContext('2d');
                ctx.fillStyle = '#0b1220';
                ctx.fillRect(0, 0, IMG_SIZE, IMG_SIZE);
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

    const handleImageChange = (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        if (!file.type.startsWith('image/')) { toast.warn('Please select an image file'); return; }
        if (file.size > 10 * 1024 * 1024) { toast.warn('Image must be under 10MB'); return; }
        setImageFile(file);
    };

    const handleAddItem = async () => {
        if (!itemForm.name.trim()) { toast.warn('Item name is required'); return; }
        if (!itemForm.brand.trim()) { toast.warn('Brand is required'); return; }
        if (!itemForm.category) { toast.warn('Select a category'); return; }
        if (!itemForm.price || isNaN(itemForm.price)) { toast.warn('Valid price required'); return; }

        setItemSaving(true);
        try {
            const itemData = {
                name: itemForm.name.trim(),
                brand: itemForm.brand.trim(),
                category: itemForm.category,
                unit: itemForm.unit,
                packQuantity: Number(itemForm.packQuantity) || 1,
                itemSize: itemForm.itemSize.trim(),
                vendorPrice: Number(itemForm.price) || 0,
                commissionPercent: 0,
                sku: itemForm.sku.trim(),
                notes: itemForm.notes.trim(),
                taxable: !!itemForm.taxable,
                createdAt: new Date().toISOString(),
                imageUrl: ''
            };

            let docId = '';
            let finalItem = null;

            if (isSuperAdmin) {
                const docRef = await addDoc(collection(db, `vendors/${vendorId}/items`), { ...itemData, status: 'active' });
                docId = docRef.id;
                finalItem = { id: docId, ...itemData, status: 'active' };
                if (logAudit) await logAudit(vendorId, docId, 'created', { itemName: itemData.name });
            } else {
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
                docId = docRef.id;
                finalItem = { id: docId, ...itemData, status: 'in-review', ...reviewFields };
                if (logAudit) await logAudit(vendorId, docId, 'created_pending', { itemName: itemData.name });
            }

            // Upload image if selected
            if (imageFile && docId) {
                setUploadingImage(true);
                try {
                    const resized = await resizeImage(imageFile);
                    const storageRef = ref(storage, `items/${vendorId}/${docId}.webp`);
                    await uploadBytes(storageRef, resized, { contentType: 'image/webp' });
                    const url = await getDownloadURL(storageRef);
                    await updateDoc(doc(db, `vendors/${vendorId}/items`, docId), { imageUrl: url, updatedAt: new Date().toISOString() });
                    finalItem.imageUrl = url;
                    if (logAudit) await logAudit(vendorId, docId, 'image_uploaded', { itemName: itemData.name });
                } catch (imgErr) {
                    console.error('Image upload failed:', imgErr);
                    toast.error('Item created, but image upload failed');
                } finally {
                    setUploadingImage(false);
                }
            }

            toast.success(isSuperAdmin ? 'Item added successfully!' : '✅ New item submitted for review!');
            if (onItemAdded) onItemAdded(finalItem);
            onClose();

        } catch (err) {
            console.error('Failed to add item:', err);
            toast.error('Failed to add item');
        } finally {
            setItemSaving(false);
        }
    };

    return (
        <div className="modalBackdrop" onClick={onClose} style={{ zIndex: 9999 }}>
            <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 650, maxHeight: '90vh', overflowY: 'auto' }}>
                <div className="modalHeader" style={{ padding: '20px 24px', position: 'sticky', top: 0, background: 'var(--card-bg)', zIndex: 10 }}>
                    <h3 style={{ margin: 0 }}>Add New Item</h3>
                    <button className="modal-close" onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--muted)', fontSize: 22, cursor: 'pointer' }}>✕</button>
                </div>
                <div className="modalBody" style={{ padding: '0 24px 24px 24px' }}>

                    {/* Image Upload Area */}
                    <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 20 }}>
                        <input type="file" ref={fileInputRef} accept="image/*" style={{ display: 'none' }} onChange={handleImageChange} />
                        <div
                            style={{
                                width: 140, height: 140, borderRadius: 12, border: '2px dashed var(--border)',
                                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                                cursor: 'pointer', overflow: 'hidden', background: 'rgba(255,255,255,0.02)', position: 'relative'
                            }}
                            onClick={() => fileInputRef.current?.click()}
                        >
                            {imageFile ? (
                                <img src={URL.createObjectURL(imageFile)} alt="Preview" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                            ) : (
                                <>
                                    <span style={{ fontSize: 32, opacity: 0.5, marginBottom: 8 }}>📷</span>
                                    <span style={{ fontSize: 13, color: 'var(--muted)' }}>Upload Image</span>
                                </>
                            )}
                        </div>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16 }}>
                        <div><label className="ui-label">Item Name *</label><input className="ui-input" placeholder="e.g. Turmeric Powder" value={itemForm.name} onChange={e => setItemForm(p => ({ ...p, name: e.target.value }))} /></div>
                        <div><label className="ui-label">Brand *</label><input className="ui-input" placeholder="e.g. Eastern, Sakthi, MTR…" value={itemForm.brand} onChange={e => setItemForm(p => ({ ...p, brand: e.target.value }))} /></div>
                        <div><label className="ui-label">Category *</label>
                            <select className="ui-input" value={itemForm.category} onChange={e => setItemForm(p => ({ ...p, category: e.target.value }))}>
                                <option value="">Select...</option>
                                {ITEM_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                            </select>
                        </div>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 16, marginTop: 16 }}>
                        <div><label className="ui-label">Pricing Unit</label>
                            <select className="ui-input" value={itemForm.unit} onChange={e => setItemForm(p => ({ ...p, unit: e.target.value }))}>
                                {UNITS.map(u => <option key={u} value={u}>{u}</option>)}
                            </select>
                        </div>
                        <div><label className="ui-label">Qty per Unit</label><input className="ui-input" type="number" min="1" placeholder="e.g. 1" value={itemForm.packQuantity} onChange={e => setItemForm(p => ({ ...p, packQuantity: e.target.value }))} /></div>
                        <div><label className="ui-label">Size per Qty</label><input className="ui-input" placeholder="e.g. 500g, 100mL" value={itemForm.itemSize} onChange={e => setItemForm(p => ({ ...p, itemSize: e.target.value }))} /></div>
                        <div><label className="ui-label">Price ($) *</label><input className="ui-input" type="number" step="0.01" placeholder="0.00" value={itemForm.price} onChange={e => setItemForm(p => ({ ...p, price: e.target.value }))} /></div>
                    </div>
                    <div style={{ marginTop: 16 }}><label className="ui-label">SKU</label><input className="ui-input" placeholder="Optional SKU or product code" value={itemForm.sku} onChange={e => setItemForm(p => ({ ...p, sku: e.target.value }))} /></div>
                    <div style={{ marginTop: 16 }}><label className="ui-label">Notes</label><textarea className="ui-input" style={{ height: 60 }} placeholder="Optional notes" value={itemForm.notes} onChange={e => setItemForm(p => ({ ...p, notes: e.target.value }))} /></div>
                    <div style={{ marginTop: 16, display: 'flex', alignItems: 'center', gap: 12 }}>
                        <label className="ui-label" style={{ margin: 0, cursor: 'pointer' }}>Taxable</label>
                        <div
                            className={`idp-toggle ${itemForm.taxable ? 'active' : ''}`}
                            onClick={() => setItemForm(p => ({ ...p, taxable: !p.taxable }))}
                            role="switch"
                            style={{ width: 44, height: 24, borderRadius: 12, background: itemForm.taxable ? '#4dabf7' : 'rgba(255,255,255,0.1)', position: 'relative', cursor: 'pointer', transition: 'background 0.2s' }}
                        >
                            <div style={{ width: 20, height: 20, borderRadius: '50%', background: '#fff', position: 'absolute', top: 2, left: itemForm.taxable ? 22 : 2, transition: 'left 0.2s' }} />
                        </div>
                        <span style={{ fontSize: 13, color: 'var(--muted)' }}>{itemForm.taxable ? 'This item is subject to tax' : 'Not taxable'}</span>
                    </div>

                    <div style={{ marginTop: 24, display: 'flex', justifyContent: 'flex-end', gap: 12, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
                        <button className="ui-btn ghost" onClick={onClose} disabled={itemSaving || uploadingImage}>Cancel</button>
                        <button className="ui-btn primary" onClick={handleAddItem} disabled={itemSaving || uploadingImage}>
                            {itemSaving || uploadingImage ? 'Saving...' : isSuperAdmin ? '💾 Save Item' : '📩 Submit for Review'}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
