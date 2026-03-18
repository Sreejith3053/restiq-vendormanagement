/**
 * CatalogItemCreateEditForm.js
 *
 * Form for superadmin to create or edit a master catalog item.
 * Used inside SuperadminReviewItemModal when approving a new item.
 */
import React, { useState } from 'react';

const CATEGORIES = [
    'Produce', 'Dairy', 'Meat & Poultry', 'Seafood', 'Dry Goods', 'Bakery',
    'Beverages', 'Frozen', 'Condiments & Sauces', 'Packaging',
    'Cleaning Supplies', 'Other',
];

const UNITS = ['lb', 'kg', 'g', 'oz', 'l', 'ml', 'case', 'box', 'bag', 'each', 'pcs', 'unit', 'dozen', 'tray', 'bundle'];

export default function CatalogItemCreateEditForm({ initial = {}, onSubmit, onCancel, loading = false }) {
    const [form, setForm] = useState({
        canonicalName: initial.canonicalName || initial.itemName || '',
        itemName:      initial.itemName || initial.canonicalName || '',
        category:      initial.category || '',
        subcategory:   initial.subcategory || '',
        brand:         initial.brand || '',
        packSize:      initial.packSize || '',
        baseUnit:      initial.baseUnit || initial.unit || '',
        orderUnit:     initial.orderUnit || initial.unit || '',
        aliases:       (initial.aliases || []).join(', '),
    });

    const set = (key) => (e) => setForm(f => ({ ...f, [key]: e.target.value }));

    const handleSubmit = () => {
        const aliasArr = form.aliases
            .split(',')
            .map(a => a.trim())
            .filter(Boolean);

        onSubmit({
            ...form,
            aliases: aliasArr,
        });
    };

    const inputStyle = {
        width: '100%', padding: '8px 10px', borderRadius: 7,
        border: '1px solid rgba(255,255,255,0.1)', background: '#0f172a',
        color: '#f8fafc', fontSize: 13, boxSizing: 'border-box',
    };
    const labelStyle = { fontSize: 11, color: '#64748b', fontWeight: 700, marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.4 };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {/* Canonical Name */}
            <div>
                <div style={labelStyle}>Canonical Name *</div>
                <input style={inputStyle} value={form.canonicalName} onChange={set('canonicalName')} placeholder="e.g. Coriander Leaves" />
                <div style={{ fontSize: 10, color: '#475569', marginTop: 3 }}>The clean, standardized name used across the platform</div>
            </div>

            {/* Item Name (vendor-facing) */}
            <div>
                <div style={labelStyle}>Item Name (vendor-facing)</div>
                <input style={inputStyle} value={form.itemName} onChange={set('itemName')} placeholder="e.g. Coriander" />
            </div>

            {/* Category + Subcategory */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div>
                    <div style={labelStyle}>Category *</div>
                    <select style={inputStyle} value={form.category} onChange={set('category')}>
                        <option value="">— Select —</option>
                        {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                </div>
                <div>
                    <div style={labelStyle}>Subcategory</div>
                    <input style={inputStyle} value={form.subcategory} onChange={set('subcategory')} placeholder="e.g. Herbs" />
                </div>
            </div>

            {/* Brand */}
            <div>
                <div style={labelStyle}>Brand</div>
                <input style={inputStyle} value={form.brand} onChange={set('brand')} placeholder="Optional" />
            </div>

            {/* Pack Size + Units */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
                <div>
                    <div style={labelStyle}>Pack Size</div>
                    <input style={inputStyle} value={form.packSize} onChange={set('packSize')} placeholder="e.g. 25lb" />
                </div>
                <div>
                    <div style={labelStyle}>Base Unit</div>
                    <select style={inputStyle} value={form.baseUnit} onChange={set('baseUnit')}>
                        <option value="">—</option>
                        {UNITS.map(u => <option key={u} value={u}>{u}</option>)}
                    </select>
                </div>
                <div>
                    <div style={labelStyle}>Order Unit</div>
                    <select style={inputStyle} value={form.orderUnit} onChange={set('orderUnit')}>
                        <option value="">—</option>
                        {UNITS.map(u => <option key={u} value={u}>{u}</option>)}
                    </select>
                </div>
            </div>

            {/* Aliases */}
            <div>
                <div style={labelStyle}>Aliases (comma-separated)</div>
                <input style={inputStyle} value={form.aliases} onChange={set('aliases')} placeholder="e.g. Coriander, Fresh Coriander, Cilantro" />
                <div style={{ fontSize: 10, color: '#475569', marginTop: 3 }}>Aliases help future import matching. Vendor item names are automatically added.</div>
            </div>

            {/* Actions */}
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 6 }}>
                <button onClick={onCancel} disabled={loading}
                    style={{ padding: '8px 18px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.1)', background: 'transparent', color: '#64748b', cursor: 'pointer', fontSize: 13 }}>
                    Cancel
                </button>
                <button onClick={handleSubmit} disabled={!form.canonicalName || !form.category || loading}
                    style={{
                        padding: '8px 20px', borderRadius: 8, fontWeight: 700, fontSize: 13,
                        background: !form.canonicalName || !form.category || loading ? 'rgba(56,189,248,0.3)' : '#38bdf8',
                        border: 'none', color: '#0f172a', cursor: !form.canonicalName || !form.category || loading ? 'not-allowed' : 'pointer',
                    }}>
                    {loading ? 'Saving...' : '✓ Create Catalog Item'}
                </button>
            </div>
        </div>
    );
}
