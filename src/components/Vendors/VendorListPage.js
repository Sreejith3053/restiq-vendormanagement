import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { db } from '../../firebase';
import { collection, getDocs } from 'firebase/firestore';
import { getRegionsForCountry } from '../../constants/taxRates';

const CATEGORIES = ['All', 'Spices', 'Meat', 'Produce', 'Dairy', 'Seafood', 'Grains', 'Beverages', 'Packaging', 'Other'];

export default function VendorListPage() {
    const navigate = useNavigate();
    const [vendors, setVendors] = useState([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [categoryFilter, setCategoryFilter] = useState('All');

    useEffect(() => {
        (async () => {
            try {
                const snap = await getDocs(collection(db, 'vendors'));
                const list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
                setVendors(list.sort((a, b) => (a.name || '').localeCompare(b.name || '')));
            } catch (err) {
                console.error('Failed to load vendors:', err);
            } finally {
                setLoading(false);
            }
        })();
    }, []);

    const filtered = vendors.filter(v => {
        const matchSearch = !search ||
            (v.name || '').toLowerCase().includes(search.toLowerCase()) ||
            (v.contactName || '').toLowerCase().includes(search.toLowerCase());
        const matchCat = categoryFilter === 'All' || v.category === categoryFilter;
        return matchSearch && matchCat;
    });

    return (
        <div>
            <div className="page-header">
                <h2>Vendors</h2>
                <button className="ui-btn primary" onClick={() => navigate('/vendors/add')}>
                    + Add Vendor
                </button>
            </div>

            {/* Filters */}
            <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
                <input
                    className="ui-input"
                    placeholder="🔍  Search vendors..."
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    style={{ maxWidth: 300 }}
                />
                <select
                    className="ui-input"
                    value={categoryFilter}
                    onChange={e => setCategoryFilter(e.target.value)}
                    style={{ maxWidth: 180 }}
                >
                    {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
            </div>

            {loading ? (
                <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>Loading vendors...</div>
            ) : filtered.length === 0 ? (
                <div className="ui-card" style={{ textAlign: 'center', padding: 40 }}>
                    <div style={{ fontSize: 40, marginBottom: 12 }}>📦</div>
                    <div style={{ color: 'var(--muted)', marginBottom: 12 }}>
                        {vendors.length === 0 ? 'No vendors yet' : 'No vendors match your search'}
                    </div>
                    {vendors.length === 0 && (
                        <button className="ui-btn primary" onClick={() => navigate('/vendors/add')}>
                            Add Your First Vendor
                        </button>
                    )}
                </div>
            ) : (
                <div className="ui-table-wrap">
                    <table className="ui-table">
                        <thead>
                            <tr>
                                <th>Vendor Name</th>
                                <th>Category</th>
                                <th>Province / State</th>
                                <th>Contact Name</th>
                                <th>Phone</th>
                                <th>Status</th>
                            </tr>
                        </thead>
                        <tbody>
                            {filtered.map(v => (
                                <tr key={v.id} className="is-row" onClick={() => navigate(`/vendors/${v.id}`)}>
                                    <td data-label="Vendor Name" style={{ fontWeight: 600 }}>{v.name || '—'}</td>
                                    <td data-label="Category">
                                        <span className="badge blue">{v.category || 'General'}</span>
                                    </td>
                                    <td data-label="Province / State">{(() => { const r = getRegionsForCountry(v.country || 'Canada').find(r => r.code === v.province); return r ? r.name : v.province || '—'; })()}</td>
                                    <td data-label="Contact">{v.contactName || '—'}</td>
                                    <td data-label="Phone">{v.contactPhone || '—'}</td>
                                    <td data-label="Status">
                                        <span className={`badge ${v.status === 'inactive' ? 'red' : 'green'}`}>
                                            {v.status || 'active'}
                                        </span>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}
