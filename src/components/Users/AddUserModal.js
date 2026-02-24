// src/components/Users/AddUserModal.js
import React, { useState, useEffect, useContext } from 'react';
import { UserContext } from '../../contexts/UserContext';
import { db } from '../../firebase';
import {
    collection,
    addDoc,
    getDocs,
    query,
    where,
    limit,
    serverTimestamp,
} from 'firebase/firestore';
import { toast } from 'react-toastify';

export default function AddUserModal({ onClose, onUserAdded }) {
    const { isSuperAdmin, userId, vendorId, vendorName } = useContext(UserContext);

    const [form, setForm] = useState({
        displayName: '',
        username: '',
        email: '',
        password: '',
        role: isSuperAdmin ? 'admin' : 'user',
        selectedVendorId: '',
        selectedVendorName: '',
    });
    const [vendors, setVendors] = useState([]);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');

    // Super admin needs a vendor list to assign the new user to
    useEffect(() => {
        if (!isSuperAdmin) return;
        (async () => {
            try {
                const snap = await getDocs(collection(db, 'vendors'));
                const list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
                setVendors(list);
            } catch (err) {
                console.error('Failed to load vendors:', err);
            }
        })();
    }, [isSuperAdmin]);

    const handleChange = (field, value) => {
        setForm(prev => {
            const updated = { ...prev, [field]: value };
            // Auto-fill vendor name when vendor is selected
            if (field === 'selectedVendorId') {
                const vendor = vendors.find(v => v.id === value);
                updated.selectedVendorName = vendor?.name || vendor?.businessName || '';
            }
            return updated;
        });
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');

        // Validation
        if (!form.displayName.trim()) {
            setError('Display name is required.');
            return;
        }
        if (!form.username.trim()) {
            setError('Username is required.');
            return;
        }
        if (!form.password.trim() || form.password.length < 4) {
            setError('Password must be at least 4 characters.');
            return;
        }
        if (isSuperAdmin && !form.selectedVendorId) {
            setError('Select a vendor to assign this user to.');
            return;
        }

        setSaving(true);
        try {
            // Check if username already exists
            const existingQ = query(
                collection(db, 'login'),
                where('username', '==', form.username.trim()),
                limit(1)
            );
            const existingSnap = await getDocs(existingQ);
            if (!existingSnap.empty) {
                setError('Username already taken.');
                setSaving(false);
                return;
            }

            const newUser = {
                displayName: form.displayName.trim(),
                username: form.username.trim().toLowerCase(),
                email: form.email.trim() || null,
                password: form.password,
                role: form.role,
                vendorId: isSuperAdmin ? form.selectedVendorId : vendorId,
                vendorName: isSuperAdmin ? form.selectedVendorName : vendorName,
                active: true,
                createdBy: userId,
                createdAt: serverTimestamp(),
            };

            await addDoc(collection(db, 'login'), newUser);
            toast.success(`User "${form.displayName}" created!`);
            onUserAdded();
            onClose();
        } catch (err) {
            console.error('Error creating user:', err);
            setError('Failed to create user. Please try again.');
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal-card" onClick={(e) => e.stopPropagation()}>
                <div className="modal-header">
                    <h2>Add New User</h2>
                    <button className="modal-close" onClick={onClose}>✕</button>
                </div>

                <form className="modal-form" onSubmit={handleSubmit}>
                    <div className="form-field">
                        <label>Display Name *</label>
                        <input
                            type="text"
                            value={form.displayName}
                            onChange={(e) => handleChange('displayName', e.target.value)}
                            placeholder="John Smith"
                        />
                    </div>

                    <div className="form-row">
                        <div className="form-field">
                            <label>Username *</label>
                            <input
                                type="text"
                                value={form.username}
                                onChange={(e) => handleChange('username', e.target.value)}
                                placeholder="johnsmith"
                            />
                        </div>
                        <div className="form-field">
                            <label>Email</label>
                            <input
                                type="email"
                                value={form.email}
                                onChange={(e) => handleChange('email', e.target.value)}
                                placeholder="john@company.com"
                            />
                        </div>
                    </div>

                    <div className="form-row">
                        <div className="form-field">
                            <label>Password *</label>
                            <input
                                type="text"
                                value={form.password}
                                onChange={(e) => handleChange('password', e.target.value)}
                                placeholder="Enter password"
                            />
                        </div>
                        <div className="form-field">
                            <label>Role</label>
                            <select
                                value={form.role}
                                onChange={(e) => handleChange('role', e.target.value)}
                            >
                                {isSuperAdmin ? (
                                    <>
                                        <option value="admin">Vendor Admin</option>
                                        <option value="user">User</option>
                                    </>
                                ) : (
                                    <option value="user">User</option>
                                )}
                            </select>
                        </div>
                    </div>

                    {/* Super admin picks a vendor */}
                    {isSuperAdmin && (
                        <div className="form-field">
                            <label>Assign to Vendor *</label>
                            <select
                                value={form.selectedVendorId}
                                onChange={(e) => handleChange('selectedVendorId', e.target.value)}
                            >
                                <option value="">— Select Vendor —</option>
                                {vendors.map(v => (
                                    <option key={v.id} value={v.id}>
                                        {v.name || v.businessName || v.id}
                                    </option>
                                ))}
                            </select>
                        </div>
                    )}

                    {/* Vendor admin sees their vendor (read-only) */}
                    {!isSuperAdmin && (
                        <div className="form-field">
                            <label>Vendor</label>
                            <input type="text" value={vendorName || 'Your Vendor'} readOnly className="readonly" />
                        </div>
                    )}

                    {error && <div className="form-error">{error}</div>}

                    <div className="modal-actions">
                        <button type="button" className="btn-cancel" onClick={onClose}>Cancel</button>
                        <button type="submit" className="btn-save" disabled={saving}>
                            {saving ? 'Creating…' : 'Create User'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
