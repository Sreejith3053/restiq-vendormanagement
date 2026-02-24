import React, { useEffect, useState, useContext } from 'react';
import { useNavigate } from 'react-router-dom';
import { UserContext } from '../../contexts/UserContext';
import { db } from '../../firebase';
import { collection, getDocs } from 'firebase/firestore';
import { formatItemSize } from './VendorDetailPage';

const CATEGORIES = ['All', 'Spices', 'Meat', 'Produce', 'Dairy', 'Seafood', 'Grains', 'Beverages', 'Packaging', 'Cleaning', 'Other'];

export default function ItemCatalogPage() {
    const navigate = useNavigate();
    const { vendorId, vendorName, isSuperAdmin } = useContext(UserContext);
    const [allItems, setAllItems] = useState([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [categoryFilter, setCategoryFilter] = useState('All');

    useEffect(() => {
        (async () => {
            try {
                const items = [];

                if (isSuperAdmin) {
                    // Super admin: load items across all vendors
                    const vendorSnap = await getDocs(collection(db, 'vendors'));
                    const vendors = vendorSnap.docs.map(d => ({ id: d.id, ...d.data() }));
                    for (const v of vendors) {
                        try {
                            const itemSnap = await getDocs(collection(db, `vendors/${v.id}/items`));
                            itemSnap.docs.forEach(d => {
                                items.push({
                                    id: d.id,
                                    ...d.data(),
                                    vendorId: v.id,
                                    vendorName: v.name || 'Unknown',
                                });
                            });
                        } catch { /* skip */ }
                    }
                } else if (vendorId) {
                    // Vendor user: load only their vendor's items
                    try {
                        const itemSnap = await getDocs(collection(db, `vendors/${vendorId}/items`));
                        itemSnap.docs.forEach(d => {
                            items.push({
                                id: d.id,
                                ...d.data(),
                                vendorId,
                                vendorName: vendorName || 'My Vendor',
                            });
                        });
                    } catch { /* skip */ }
                }

                setAllItems(items.sort((a, b) => (a.name || '').localeCompare(b.name || '')));
            } catch (err) {
                console.error('Failed to load items:', err);
            } finally {
                setLoading(false);
            }
        })();
    }, [vendorId, vendorName, isSuperAdmin]);

    const filtered = allItems.filter(item => {
        const matchSearch = !search ||
            (item.name || '').toLowerCase().includes(search.toLowerCase()) ||
            (item.vendorName || '').toLowerCase().includes(search.toLowerCase()) ||
            (item.sku || '').toLowerCase().includes(search.toLowerCase());
        const matchCat = categoryFilter === 'All' || item.category === categoryFilter;
        return matchSearch && matchCat;
    });

    return (
        <div>
            <div className="page-header">
                <h2>Item Catalog</h2>
                <span className="muted">
                    {allItems.length} item{allItems.length !== 1 ? 's' : ''}
                    {!isSuperAdmin ? ` for ${vendorName || 'your vendor'}` : ' across all vendors'}
                </span>
            </div>

            {/* Filters */}
            <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
                <input
                    className="ui-input"
                    placeholder="🔍  Search items or SKU..."
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    style={{ maxWidth: 350 }}
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
                <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>Loading items...</div>
            ) : filtered.length === 0 ? (
                <div className="ui-card" style={{ textAlign: 'center', padding: 40 }}>
                    <div style={{ fontSize: 40, marginBottom: 12 }}>📋</div>
                    <div style={{ color: 'var(--muted)' }}>
                        {allItems.length === 0
                            ? 'No items yet. Add items to your vendor profile to see them here.'
                            : 'No items match your search.'}
                    </div>
                </div>
            ) : (
                <div className="ui-table-wrap">
                    <table className="ui-table">
                        <thead>
                            <tr>
                                <th>Item Name</th>
                                <th>Category</th>
                                {isSuperAdmin && <th>Vendor</th>}
                                <th>Unit</th>
                                <th>Price</th>
                                <th>SKU</th>
                            </tr>
                        </thead>
                        <tbody>
                            {filtered.map(item => (
                                <tr
                                    key={`${item.vendorId}-${item.id}`}
                                    className="is-row"
                                    onClick={() => navigate(isSuperAdmin ? `/vendors/${item.vendorId}` : '/profile')}
                                >
                                    <td data-label="Item" style={{ fontWeight: 600 }}>{item.name}</td>
                                    <td data-label="Category"><span className="badge blue">{item.category || '—'}</span></td>
                                    {isSuperAdmin && <td data-label="Vendor">{item.vendorName}</td>}
                                    <td data-label="Unit" style={{ textTransform: 'capitalize' }}>
                                        {formatItemSize(item.unit, item.packQuantity, item.itemSize)}
                                    </td>
                                    <td data-label="Price">${Number(item.price || 0).toFixed(2)}</td>
                                    <td data-label="SKU">{item.sku || '—'}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}
