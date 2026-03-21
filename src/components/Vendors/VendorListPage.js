import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { db } from '../../firebase';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { getRegionsForCountry } from '../../constants/taxRates';

const CATEGORIES = ['All', 'Spices', 'Meat', 'Produce', 'Dairy', 'Seafood', 'Grains', 'Beverages', 'Packaging', 'Other'];

export default function VendorListPage() {
    const navigate = useNavigate();
    const [vendors, setVendors] = useState([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [categoryFilter, setCategoryFilter] = useState('All');
    const [pendingCounts, setPendingCounts] = useState({}); // { vendorId: count }

    useEffect(() => {
        (async () => {
            try {
                const snap = await getDocs(collection(db, 'vendors'));
                const list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
                setVendors(list.sort((a, b) => (a.name || '').localeCompare(b.name || '')));

                // Load pending review counts per vendor
                const counts = {};
                await Promise.all(list.map(async (v) => {
                    try {
                        const q = query(
                            collection(db, 'vendors', v.id, 'items'),
                            where('status', 'in', ['Pending Review', 'in-review'])
                        );
                        const itemSnap = await getDocs(q);
                        if (itemSnap.size > 0) counts[v.id] = itemSnap.size;
                    } catch { /* skip */ }
                }));
                setPendingCounts(counts);
            } catch (err) {
                console.error('Failed to load vendors:', err);
            } finally {
                setLoading(false);
            }
        })();
    }, []);

    const totalPending = Object.values(pendingCounts).reduce((s, n) => s + n, 0);

    const filtered = vendors.filter(v => {
        const matchSearch = !search ||
            (v.name || '').toLowerCase().includes(search.toLowerCase()) ||
            (v.contactName || '').toLowerCase().includes(search.toLowerCase());
        const matchCat = categoryFilter === 'All' || v.category === categoryFilter;
        return matchSearch && matchCat;
    });

    return (
        <div>
            {/* Pending Review Banner */}
            {totalPending > 0 && (
                <div style={{
                    padding: '12px 18px', marginBottom: 16, borderRadius: 10,
                    background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.25)',
                    display: 'flex', alignItems: 'center', gap: 10,
                }}>
                    <span style={{ fontSize: 18 }}>🔔</span>
                    <span style={{ fontSize: 14, color: '#fbbf24', fontWeight: 600 }}>
                        {totalPending} item{totalPending !== 1 ? 's' : ''} pending review across {Object.keys(pendingCounts).length} vendor{Object.keys(pendingCounts).length !== 1 ? 's' : ''}
                    </span>
                </div>
            )}

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
                                    <td data-label="Vendor Name" style={{ fontWeight: 600 }}>
                                        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                            {v.name || '—'}
                                            {pendingCounts[v.id] > 0 && (
                                                <span style={{
                                                    background: '#f59e0b', color: '#0f172a',
                                                    fontSize: 10, fontWeight: 800, padding: '2px 7px',
                                                    borderRadius: 10, minWidth: 18, textAlign: 'center',
                                                }}>
                                                    {pendingCounts[v.id]}
                                                </span>
                                            )}
                                        </span>
                                    </td>
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

