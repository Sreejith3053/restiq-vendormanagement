import React, { useEffect, useState, useContext } from 'react';
import { useNavigate } from 'react-router-dom';
import { UserContext } from '../../contexts/UserContext';
import { db } from '../../firebase';
import { collection, getDocs } from 'firebase/firestore';
import { formatItemSize } from './VendorDetailPage';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import AddItemModal from './AddItemModal';

const CATEGORIES = ['All', 'Spices', 'Meat', 'Produce', 'Dairy', 'Seafood', 'Grains', 'Beverages', 'Packaging', 'Cleaning', 'Other'];

export default function ItemCatalogPage() {
    const navigate = useNavigate();
    const { vendorId, vendorName, isSuperAdmin, userId, displayName } = useContext(UserContext);
    const [allItems, setAllItems] = useState([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [categoryFilter, setCategoryFilter] = useState('All');
    const [isAddModalOpen, setIsAddModalOpen] = useState(false);

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

    const handleItemAdded = (newItem) => {
        setAllItems(prev => [...prev, newItem].sort((a, b) => (a.name || '').localeCompare(b.name || '')));
    };

    const handleExportPDF = () => {
        const doc = new jsPDF();

        doc.setFontSize(18);
        doc.text('Item Catalog', 14, 22);

        doc.setFontSize(11);
        doc.text(`Generated on: ${new Date().toLocaleDateString()}`, 14, 30);
        if (!isSuperAdmin) {
            doc.text(`Vendor: ${vendorName || 'My Vendor'}`, 14, 36);
        }

        const tableColumn = ["Item Name", "Category", "Unit", "Price", "Status", "SKU"];
        if (isSuperAdmin) {
            tableColumn.splice(2, 0, "Vendor");
        }

        const tableRows = [];

        filtered.forEach(item => {
            const statusText = item.disabled ? 'Disabled' : item.outOfStock ? 'Out of Stock' : item.status === 'in-review' ? 'In Review' : 'Active';
            const priceText = `$${Number(item.vendorPrice || item.price || 0).toFixed(2)}`;
            const unitText = formatItemSize(item.unit, item.packQuantity, item.itemSize);

            const rowData = [
                item.name,
                item.category || '—',
                unitText,
                priceText,
                statusText,
                item.sku || '—'
            ];

            if (isSuperAdmin) {
                rowData.splice(2, 0, item.vendorName || '—');
            }

            tableRows.push(rowData);
        });

        autoTable(doc, {
            head: [tableColumn],
            body: tableRows,
            startY: isSuperAdmin ? 40 : 44,
            theme: 'grid',
            styles: { fontSize: 9 },
            headStyles: { fillColor: [11, 18, 32] }
        });

        doc.save(`${vendorName ? vendorName.replace(/\s+/g, '_') + '_' : ''}Item_Catalog.pdf`);
    };

    return (
        <div>
            <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                    <h2>Item Catalog</h2>
                    <span className="muted">
                        {allItems.length} item{allItems.length !== 1 ? 's' : ''}
                        {!isSuperAdmin ? ` for ${vendorName || 'your vendor'}` : ' across all vendors'}
                    </span>
                </div>
                <div style={{ display: 'flex', gap: 12 }}>
                    <button className="ui-btn secondary" onClick={handleExportPDF}>
                        📄 Export PDF
                    </button>
                    {vendorId && (
                        <button className="ui-btn primary" onClick={() => setIsAddModalOpen(true)}>
                            + Add Item
                        </button>
                    )}
                </div>
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
                                <th style={{ width: 60 }}>Image</th>
                                <th>Item Name</th>
                                <th>Category</th>
                                {isSuperAdmin && <th>Vendor</th>}
                                <th>Unit</th>
                                <th>Price</th>
                                <th>Status</th>
                                <th>SKU</th>
                            </tr>
                        </thead>
                        <tbody>
                            {filtered.map(item => (
                                <tr
                                    key={`${item.vendorId}-${item.id}`}
                                    className="is-row"
                                    onClick={() => navigate(`/vendors/${item.vendorId}/items/${item.id}`)}
                                >
                                    <td data-label="Image">
                                        <div style={{
                                            width: 40, height: 40, borderRadius: 6,
                                            backgroundColor: 'var(--bg-lighter)',
                                            backgroundImage: item.imageUrl ? `url(${item.imageUrl})` : 'none',
                                            backgroundSize: 'cover', backgroundPosition: 'center',
                                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                                            flexShrink: 0
                                        }}>
                                            {!item.imageUrl && <span style={{ fontSize: 16 }}>📦</span>}
                                        </div>
                                    </td>
                                    <td data-label="Item" style={{ fontWeight: 600 }}>
                                        {item.name}
                                    </td>
                                    <td data-label="Category"><span className="badge blue">{item.category || '—'}</span></td>
                                    {isSuperAdmin && <td data-label="Vendor">{item.vendorName}</td>}
                                    <td data-label="Unit" style={{ textTransform: 'capitalize' }}>
                                        {formatItemSize(item.unit, item.packQuantity, item.itemSize)}
                                    </td>
                                    <td data-label="Price">${Number(item.vendorPrice || item.price || 0).toFixed(2)}</td>
                                    <td data-label="Status">
                                        {item.disabled ? (
                                            <span className="badge red" style={{ fontSize: 11 }}>Disabled</span>
                                        ) : item.outOfStock ? (
                                            <span className="badge amber" style={{ fontSize: 11 }}>Out of Stock</span>
                                        ) : item.status === 'in-review' ? (
                                            <span className="badge purple" style={{ fontSize: 11 }}>In Review</span>
                                        ) : (
                                            <span className="badge green" style={{ fontSize: 11 }}>Active</span>
                                        )}
                                    </td>
                                    <td data-label="SKU">{item.sku || '—'}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            {isAddModalOpen && (
                <AddItemModal
                    vendorId={vendorId}
                    isSuperAdmin={isSuperAdmin}
                    userId={userId}
                    displayName={displayName}
                    onClose={() => setIsAddModalOpen(false)}
                    onItemAdded={handleItemAdded}
                    logAudit={async (vId, itemId, action, details) => {
                        const { addDoc, collection, serverTimestamp } = await import('firebase/firestore');
                        try {
                            await addDoc(collection(db, `vendors/${vId}/items/${itemId}/auditLog`), {
                                action,
                                ...details,
                                performedBy: userId,
                                performedByName: displayName || 'Unknown',
                                timestamp: serverTimestamp()
                            });
                        } catch (e) {
                            console.error('Audit log failed', e);
                        }
                    }}
                />
            )}
        </div>
    );
}
