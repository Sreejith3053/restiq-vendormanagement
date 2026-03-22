import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { db } from '../../firebase';
import { collection, addDoc, getDocs, query, where, limit, doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { toast } from 'react-toastify';
import { COUNTRIES, getRegionsForCountry, getRegionLabel, getTaxRate } from '../../constants/taxRates';

const CATEGORIES = ['Spices', 'Meat', 'Produce', 'Dairy', 'Seafood', 'Grains', 'Beverages', 'Packaging', 'Cleaning', 'Other'];
const VENDOR_TYPES = ['Distributor', 'Direct Supplier', 'Broker', 'Wholesaler', 'Manufacturer', 'Farmer / Local', 'Import Specialist', 'Other'];
const STATUS_OPTIONS = ['Active', 'Onboarding', 'On Hold', 'Inactive'];
const PAYMENT_TERMS = ['COD', 'Net 7', 'Net 15', 'Net 30'];
const DELIVERY_TYPES = ['Delivery', 'Pickup', 'Both'];
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

// ── Styles ─────────────────────────────────────────────────────────────────────

const sectionStyle = {
    marginBottom: 28,
    padding: '22px 26px',
    borderRadius: 14,
    background: 'rgba(255,255,255,0.015)',
    border: '1px solid rgba(255,255,255,0.06)',
};

const sectionHeaderStyle = {
    display: 'flex', alignItems: 'center', gap: 10,
    marginBottom: 18, paddingBottom: 12,
    borderBottom: '1px solid rgba(255,255,255,0.06)',
};

const sectionTitleStyle = { fontSize: 16, fontWeight: 800, color: '#f8fafc', margin: 0 };
const sectionSubtitleStyle = { fontSize: 11, color: '#475569', marginTop: 2 };
const emojiStyle = { fontSize: 20 };

const gridStyle = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16 };
const fieldStyle = {};
const labelStyle = {
    display: 'block', fontSize: 11, fontWeight: 700, color: '#94a3b8',
    marginBottom: 5, textTransform: 'uppercase', letterSpacing: 0.5,
};
const inputStyle = {
    width: '100%', padding: '9px 13px', borderRadius: 8,
    border: '1px solid rgba(255,255,255,0.1)', background: '#1e293b',
    color: '#f8fafc', fontSize: 13, outline: 'none', boxSizing: 'border-box',
    transition: 'border-color 0.15s',
};
const selectInputStyle = { ...inputStyle, cursor: 'pointer' };
const checkboxLabelStyle = {
    display: 'flex', alignItems: 'center', gap: 8,
    fontSize: 13, color: '#94a3b8', cursor: 'pointer', padding: '4px 0',
};
const dayBtnStyle = (active) => ({
    padding: '6px 12px', borderRadius: 7, fontSize: 11, fontWeight: 700, cursor: 'pointer',
    border: active ? '2px solid #38bdf8' : '1px solid rgba(255,255,255,0.08)',
    background: active ? 'rgba(56,189,248,0.12)' : 'transparent',
    color: active ? '#38bdf8' : '#475569',
    transition: 'all 0.15s', marginRight: 4,
});

// ── SectionHeader helper ────────────────────────────────────────────────────────

function SectionHeader({ emoji, title, subtitle }) {
    return (
        <div style={sectionHeaderStyle}>
            <span style={emojiStyle}>{emoji}</span>
            <div>
                <h3 style={sectionTitleStyle}>{title}</h3>
                {subtitle && <div style={sectionSubtitleStyle}>{subtitle}</div>}
            </div>
        </div>
    );
}

// ── Main Component ──────────────────────────────────────────────────────────────

export default function AddVendorPage() {
    const navigate = useNavigate();
    const [saving, setSaving] = useState(false);

    const [form, setForm] = useState({
        // Basic Info
        name: '',
        category: '',
        vendorType: '',
        // Contact & Location
        contactName: '',
        contactPhone: '',
        contactEmail: '',
        address: '',
        country: 'Canada',
        province: '',
        // Business Settings
        commissionPercent: 10,
        status: 'Active',
        taxRate: 13,
        hstNumber: '',
        paymentTerms: 'Net 30',
        taxIncluded: false,
        // Operations
        deliveryDays: [],
        deliveryType: 'Delivery',
        minOrderValue: '',
        leadTimeDays: '',
        // Notes
        notes: '',
    });

    const regions = getRegionsForCountry(form.country);
    const regionLabel = getRegionLabel(form.country);
    const selectedRegion = regions.find(r => r.code === form.province);

    const update = (field, value) => setForm(prev => ({ ...prev, [field]: value }));

    const toggleDay = (day) => {
        setForm(prev => ({
            ...prev,
            deliveryDays: prev.deliveryDays.includes(day)
                ? prev.deliveryDays.filter(d => d !== day)
                : [...prev.deliveryDays, day],
        }));
    };

    // Password generator
    const generatePassword = () => {
        const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$%';
        let pw = '';
        for (let i = 0; i < 12; i++) pw += chars.charAt(Math.floor(Math.random() * chars.length));
        return pw;
    };

    // Validation
    const validateForm = () => {
        if (!form.name.trim()) { toast.warn('Vendor name is required.'); return false; }
        if (!form.category) { toast.warn('Please select a category.'); return false; }
        if (!form.contactEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.contactEmail)) {
            toast.warn('A valid email address is required for vendor login.'); return false;
        }
        if (form.contactPhone && !/^[\d\s\-+().]{7,}$/.test(form.contactPhone)) {
            toast.warn('Please enter a valid phone number.'); return false;
        }
        if (!form.hstNumber.trim()) { toast.warn('HST Number is required.'); return false; }
        return true;
    };

    const handleSave = async () => {
        if (!validateForm()) return;

        setSaving(true);
        try {
            const payload = {
                // Basic
                name: form.name.trim(),
                category: form.category,
                vendorType: form.vendorType || '',
                // Contact
                contactName: form.contactName.trim(),
                contactPhone: form.contactPhone.trim(),
                contactEmail: form.contactEmail.trim(),
                address: form.address.trim(),
                country: form.country,
                province: form.province,
                // Business
                commissionPercent: parseFloat(form.commissionPercent) || 10,
                status: form.status || 'Active',
                taxRate: selectedRegion ? selectedRegion.rate : (parseFloat(form.taxRate) || 13),
                paymentTerms: form.paymentTerms || 'Net 30',
                taxIncluded: form.taxIncluded || false,
                hstNumber: form.hstNumber.trim(),
                // Operations
                deliveryDays: form.deliveryDays || [],
                deliveryType: form.deliveryType || 'Delivery',
                minOrderValue: parseFloat(form.minOrderValue) || 0,
                leadTimeDays: parseInt(form.leadTimeDays) || 0,
                // Notes
                notes: form.notes.trim(),
                // Stats (initialized — populated by system later)
                stats: {
                    totalItems: 0,
                    activeItems: 0,
                    avgPriceVariance: 0,
                    reliabilityScore: 0,
                },
                // Timestamps
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp(),
            };

            const docRef = await addDoc(collection(db, 'vendors'), payload);

            // ── Auto-create login account ────────────────────────────────
            const vendorEmail = form.contactEmail.trim();
            const username = form.name.trim().toLowerCase().replace(/[^a-z0-9]/g, '') || docRef.id;
            const tempPassword = generatePassword();

            // Check if username already exists
            let finalUsername = username;
            const existingQ = query(collection(db, 'login'), where('username', '==', username), limit(1));
            const existingSnap = await getDocs(existingQ);
            if (!existingSnap.empty) {
                finalUsername = username + Math.floor(Math.random() * 999);
            }

            const loginPayload = {
                displayName: form.contactName.trim() || form.name.trim(),
                username: finalUsername,
                email: vendorEmail,
                password: tempPassword,
                role: 'admin',
                vendorId: docRef.id,
                vendorName: form.name.trim(),
                active: true,
                mustChangePassword: true,
                createdBy: 'system-onboarding',
                createdAt: serverTimestamp(),
            };

            const loginRef = await addDoc(collection(db, 'login'), loginPayload);

            // Mirror to users collection
            try {
                await setDoc(doc(db, 'users', loginRef.id), {
                    ...loginPayload,
                    updatedAt: serverTimestamp(),
                });
            } catch (syncErr) {
                console.warn('[AddVendor] users sync failed (non-fatal):', syncErr);
            }

            // ── Send welcome email via Cloud Function ────────────────────
            try {
                const functions = getFunctions();
                const sendWelcome = httpsCallable(functions, 'sendVendorWelcomeEmailFn');
                await sendWelcome({
                    vendorName: form.name.trim(),
                    contactName: form.contactName.trim() || form.name.trim(),
                    toEmail: vendorEmail,
                    username: finalUsername,
                    tempPassword: tempPassword,
                });
                toast.success(`Welcome email sent to ${vendorEmail}`);
            } catch (emailErr) {
                console.warn('[AddVendor] Welcome email failed (non-fatal):', emailErr);
                toast.warn('Vendor created but welcome email failed. Share credentials manually.');
            }

            toast.success(`Vendor "${form.name}" created with login account!`);
            toast.info(`Username: ${finalUsername}`, { autoClose: 10000 });
            navigate(`/vendors/${docRef.id}`);
        } catch (err) {
            console.error('Failed to add vendor:', err);
            toast.error('Failed to add vendor. Please try again.');
        } finally {
            setSaving(false);
        }
    };

    return (
        <div style={{ maxWidth: 820, margin: '0 auto', padding: '28px 20px' }}>
            {/* Page header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 28 }}>
                <div>
                    <h1 style={{ fontSize: 24, fontWeight: 800, color: '#f8fafc', margin: 0 }}>➕ Add New Vendor</h1>
                    <div style={{ fontSize: 13, color: '#475569', marginTop: 4 }}>Create a new vendor profile with contact, business, and operational details.</div>
                </div>
                <button className="ui-btn ghost" onClick={() => navigate('/vendors')}>← Back to Vendors</button>
            </div>

            {/* ── 1. BASIC INFO ── */}
            <div style={sectionStyle}>
                <SectionHeader emoji="📋" title="Basic Info" subtitle="Name, category, and type" />
                <div style={gridStyle}>
                    <div style={fieldStyle}>
                        <label style={labelStyle}>Vendor Name <span style={{ color: '#f87171' }}>*</span></label>
                        <input
                            style={inputStyle}
                            placeholder="e.g. Fresh Farms Ltd"
                            value={form.name}
                            onChange={e => update('name', e.target.value)}
                        />
                    </div>
                    <div style={fieldStyle}>
                        <label style={labelStyle}>Category <span style={{ color: '#f87171' }}>*</span></label>
                        <select style={selectInputStyle} value={form.category} onChange={e => update('category', e.target.value)}>
                            <option value="">Select category...</option>
                            {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                        </select>
                    </div>
                    <div style={fieldStyle}>
                        <label style={labelStyle}>Vendor Type</label>
                        <select style={selectInputStyle} value={form.vendorType} onChange={e => update('vendorType', e.target.value)}>
                            <option value="">Select type...</option>
                            {VENDOR_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                        </select>
                    </div>
                </div>
            </div>

            {/* ── 2. CONTACT & LOCATION ── */}
            <div style={sectionStyle}>
                <SectionHeader emoji="📍" title="Contact & Location" subtitle="Contact person, phone, email, and address" />
                <div style={gridStyle}>
                    <div style={fieldStyle}>
                        <label style={labelStyle}>Contact Name</label>
                        <input style={inputStyle} placeholder="John Doe" value={form.contactName} onChange={e => update('contactName', e.target.value)} />
                    </div>
                    <div style={fieldStyle}>
                        <label style={labelStyle}>Phone</label>
                        <input style={inputStyle} placeholder="+1 (555) 123-4567" value={form.contactPhone} onChange={e => update('contactPhone', e.target.value)} />
                    </div>
                    <div style={fieldStyle}>
                        <label style={labelStyle}>Email</label>
                        <input style={inputStyle} type="email" placeholder="vendor@example.com (required for login)" value={form.contactEmail} onChange={e => update('contactEmail', e.target.value)} />
                    </div>
                </div>

                <div style={{ ...gridStyle, marginTop: 16 }}>
                    <div style={fieldStyle}>
                        <label style={labelStyle}>Country</label>
                        <select style={selectInputStyle} value={form.country} onChange={e => { update('country', e.target.value); update('province', ''); }}>
                            {COUNTRIES.map(c => <option key={c} value={c}>{c}</option>)}
                        </select>
                    </div>
                    <div style={fieldStyle}>
                        <label style={labelStyle}>{regionLabel}</label>
                        <select style={selectInputStyle} value={form.province} onChange={e => update('province', e.target.value)}>
                            <option value="">Select {regionLabel.toLowerCase()}...</option>
                            {regions.map(r => <option key={r.code} value={r.code}>{r.name}</option>)}
                        </select>
                    </div>
                </div>

                {selectedRegion && (
                    <div style={{ marginTop: 10 }}>
                        <span style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 6, background: 'rgba(74,222,128,0.1)', color: '#4ade80' }}>
                            Tax Rate: {selectedRegion.rate}%{selectedRegion.type ? ` (${selectedRegion.type})` : ''}
                        </span>
                    </div>
                )}

                <div style={{ marginTop: 16 }}>
                    <label style={labelStyle}>Address</label>
                    <input style={inputStyle} placeholder="123 Main St, City, Province" value={form.address} onChange={e => update('address', e.target.value)} />
                </div>
            </div>

            {/* ── 3. BUSINESS SETTINGS ── */}
            <div style={sectionStyle}>
                <SectionHeader emoji="💼" title="Business Settings" subtitle="Commission, payment terms, and tax configuration" />
                <div style={gridStyle}>
                    <div style={fieldStyle}>
                        <label style={labelStyle}>Status</label>
                        <select style={selectInputStyle} value={form.status} onChange={e => update('status', e.target.value)}>
                            {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
                        </select>
                    </div>
                    <div style={fieldStyle}>
                        <label style={labelStyle}>Commission %</label>
                        <input
                            style={inputStyle} type="number" min="0" max="100" step="0.5"
                            placeholder="10" value={form.commissionPercent}
                            onChange={e => update('commissionPercent', e.target.value)}
                        />
                    </div>
                    <div style={fieldStyle}>
                        <label style={labelStyle}>Payment Terms</label>
                        <select style={selectInputStyle} value={form.paymentTerms} onChange={e => update('paymentTerms', e.target.value)}>
                            {PAYMENT_TERMS.map(t => <option key={t} value={t}>{t}</option>)}
                        </select>
                    </div>
                    <div style={fieldStyle}>
                        <label style={labelStyle}>HST Number <span style={{ color: '#f87171' }}>*</span></label>
                        <input
                            style={inputStyle}
                            placeholder="e.g. 123456789RT0001"
                            value={form.hstNumber}
                            onChange={e => update('hstNumber', e.target.value)}
                        />
                    </div>
                </div>
                <div style={{ ...gridStyle, marginTop: 16 }}>
                    <div style={fieldStyle}>
                        <label style={labelStyle}>Tax Rate %</label>
                        <input
                            style={inputStyle} type="number" min="0" max="30" step="0.1"
                            placeholder="13" value={selectedRegion ? selectedRegion.rate : form.taxRate}
                            disabled={!!selectedRegion}
                            onChange={e => update('taxRate', e.target.value)}
                        />
                        {selectedRegion && (
                            <span style={{ fontSize: 10, color: '#475569', marginTop: 4, display: 'block' }}>Auto-set from province</span>
                        )}
                    </div>
                    <div style={{ ...fieldStyle, display: 'flex', alignItems: 'flex-end', paddingBottom: 4 }}>
                        <label style={checkboxLabelStyle}>
                            <input
                                type="checkbox"
                                checked={form.taxIncluded}
                                onChange={e => update('taxIncluded', e.target.checked)}
                                style={{ accentColor: '#38bdf8', width: 16, height: 16 }}
                            />
                            Prices include tax
                        </label>
                    </div>
                </div>
            </div>

            {/* ── 4. OPERATIONS ── */}
            <div style={sectionStyle}>
                <SectionHeader emoji="🚚" title="Operations" subtitle="Delivery schedule, lead times, and order minimums" />
                <div style={gridStyle}>
                    <div style={fieldStyle}>
                        <label style={labelStyle}>Delivery Type</label>
                        <select style={selectInputStyle} value={form.deliveryType} onChange={e => update('deliveryType', e.target.value)}>
                            {DELIVERY_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                        </select>
                    </div>
                    <div style={fieldStyle}>
                        <label style={labelStyle}>Min Order Value ($)</label>
                        <input
                            style={inputStyle} type="number" min="0" step="1" placeholder="0"
                            value={form.minOrderValue}
                            onChange={e => update('minOrderValue', e.target.value)}
                        />
                    </div>
                    <div style={fieldStyle}>
                        <label style={labelStyle}>Lead Time (days)</label>
                        <input
                            style={inputStyle} type="number" min="0" max="30" step="1" placeholder="0"
                            value={form.leadTimeDays}
                            onChange={e => update('leadTimeDays', e.target.value)}
                        />
                    </div>
                </div>

                <div style={{ marginTop: 16 }}>
                    <label style={labelStyle}>Delivery Days</label>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
                        {WEEKDAYS.map(day => (
                            <button key={day} type="button" style={dayBtnStyle(form.deliveryDays.includes(day))} onClick={() => toggleDay(day)}>
                                {day}
                            </button>
                        ))}
                    </div>
                    {form.deliveryDays.length > 0 && (
                        <div style={{ marginTop: 6, fontSize: 11, color: '#475569' }}>
                            Selected: {form.deliveryDays.join(', ')}
                        </div>
                    )}
                </div>
            </div>

            {/* ── 5. NOTES ── */}
            <div style={sectionStyle}>
                <SectionHeader emoji="📝" title="Notes" subtitle="Internal notes about this vendor" />
                <textarea
                    style={{ ...inputStyle, height: 80, resize: 'vertical' }}
                    placeholder="Any additional notes about this vendor..."
                    value={form.notes}
                    onChange={e => update('notes', e.target.value)}
                />
            </div>

            {/* ── Action bar ── */}
            <div style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: '16px 0', borderTop: '1px solid rgba(255,255,255,0.06)',
            }}>
                <span style={{ fontSize: 11, color: '#334155' }}>
                    Fields marked with <span style={{ color: '#f87171' }}>*</span> are required
                </span>
                <div style={{ display: 'flex', gap: 12 }}>
                    <button className="ui-btn ghost" onClick={() => navigate('/vendors')}>Cancel</button>
                    <button
                        onClick={handleSave}
                        disabled={saving}
                        style={{
                            padding: '10px 28px', borderRadius: 10, fontSize: 14, fontWeight: 700,
                            border: 'none', cursor: saving ? 'not-allowed' : 'pointer',
                            background: saving ? 'rgba(56,189,248,0.3)' : 'linear-gradient(135deg, #38bdf8, #818cf8)',
                            color: '#fff', boxShadow: saving ? 'none' : '0 4px 16px rgba(56,189,248,0.25)',
                            transition: 'all 0.2s',
                        }}
                    >
                        {saving ? '⏳ Saving...' : '💾 Save Vendor'}
                    </button>
                </div>
            </div>
        </div>
    );
}
