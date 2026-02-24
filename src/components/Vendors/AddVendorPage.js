import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { db } from '../../firebase';
import { collection, addDoc } from 'firebase/firestore';
import { toast } from 'react-toastify';

const CATEGORIES = ['Spices', 'Meat', 'Produce', 'Dairy', 'Seafood', 'Grains', 'Beverages', 'Packaging', 'Other'];

export default function AddVendorPage() {
    const navigate = useNavigate();
    const [saving, setSaving] = useState(false);

    const [form, setForm] = useState({
        name: '',
        category: '',
        contactName: '',
        contactPhone: '',
        contactEmail: '',
        address: '',
        notes: '',
        status: 'active',
    });

    const update = (field, value) => setForm(prev => ({ ...prev, [field]: value }));

    const handleSave = async () => {
        if (!form.name.trim()) {
            toast.warn('Vendor name is required.');
            return;
        }
        if (!form.category) {
            toast.warn('Please select a category.');
            return;
        }

        setSaving(true);
        try {
            const docRef = await addDoc(collection(db, 'vendors'), {
                ...form,
                name: form.name.trim(),
                contactName: form.contactName.trim(),
                contactPhone: form.contactPhone.trim(),
                contactEmail: form.contactEmail.trim(),
                address: form.address.trim(),
                notes: form.notes.trim(),
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
            });
            toast.success('Vendor added successfully!');
            navigate(`/vendors/${docRef.id}`);
        } catch (err) {
            console.error('Failed to add vendor:', err);
            toast.error('Failed to add vendor. Please try again.');
        } finally {
            setSaving(false);
        }
    };

    return (
        <div>
            <div className="page-header">
                <h2>Add New Vendor</h2>
                <button className="ui-btn ghost" onClick={() => navigate('/vendors')}>
                    ← Back to Vendors
                </button>
            </div>

            <div className="ui-card" style={{ maxWidth: 700 }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: 16 }}>
                    <div>
                        <label className="ui-label">Vendor Name *</label>
                        <input className="ui-input" placeholder="e.g. Fresh Farms Ltd" value={form.name} onChange={e => update('name', e.target.value)} />
                    </div>
                    <div>
                        <label className="ui-label">Category *</label>
                        <select className="ui-input" value={form.category} onChange={e => update('category', e.target.value)}>
                            <option value="">Select category...</option>
                            {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                        </select>
                    </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: 16, marginTop: 16 }}>
                    <div>
                        <label className="ui-label">Contact Name</label>
                        <input className="ui-input" placeholder="John Doe" value={form.contactName} onChange={e => update('contactName', e.target.value)} />
                    </div>
                    <div>
                        <label className="ui-label">Phone</label>
                        <input className="ui-input" placeholder="+1 (555) 123-4567" value={form.contactPhone} onChange={e => update('contactPhone', e.target.value)} />
                    </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: 16, marginTop: 16 }}>
                    <div>
                        <label className="ui-label">Email</label>
                        <input className="ui-input" type="email" placeholder="vendor@example.com" value={form.contactEmail} onChange={e => update('contactEmail', e.target.value)} />
                    </div>
                    <div>
                        <label className="ui-label">Status</label>
                        <select className="ui-input" value={form.status} onChange={e => update('status', e.target.value)}>
                            <option value="active">Active</option>
                            <option value="inactive">Inactive</option>
                        </select>
                    </div>
                </div>

                <div style={{ marginTop: 16 }}>
                    <label className="ui-label">Address</label>
                    <input className="ui-input" placeholder="123 Main St, City, Province" value={form.address} onChange={e => update('address', e.target.value)} />
                </div>

                <div style={{ marginTop: 16 }}>
                    <label className="ui-label">Notes</label>
                    <textarea
                        className="ui-input"
                        style={{ height: 80, resize: 'vertical' }}
                        placeholder="Any additional notes about this vendor..."
                        value={form.notes}
                        onChange={e => update('notes', e.target.value)}
                    />
                </div>

                <div style={{ marginTop: 24, display: 'flex', justifyContent: 'flex-end', gap: 12 }}>
                    <button className="ui-btn ghost" onClick={() => navigate('/vendors')}>Cancel</button>
                    <button className="ui-btn primary" onClick={handleSave} disabled={saving}>
                        {saving ? 'Saving...' : '💾 Save Vendor'}
                    </button>
                </div>
            </div>
        </div>
    );
}
