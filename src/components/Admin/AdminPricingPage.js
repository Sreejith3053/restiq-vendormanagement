import React, { useState, useEffect, useContext, useMemo } from 'react';
import { db } from '../../firebase';
import { collection, getDocs, updateDoc, doc, query } from 'firebase/firestore';
import { UserContext } from '../../contexts/UserContext';
import { toast } from 'react-toastify';

// Consistent rounding helper
const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

export default function AdminPricingPage() {
    const { isSuperAdmin } = useContext(UserContext);
    const [vendors, setVendors] = useState([]);
    const [allItems, setAllItems] = useState([]);
    const [loading, setLoading] = useState(true);
    const [processingId, setProcessingId] = useState(null);

    // Filters
    const [search, setSearch] = useState('');
    const [vendorFilter, setVendorFilter] = useState('All');

    useEffect(() => {
        if (!isSuperAdmin) return;
        loadData();
    }, [isSuperAdmin]);

    const loadData = async () => {
        setLoading(true);
        try {
            // 1. Load Vendors
            const vendSnap = await getDocs(collection(db, 'vendors'));
            const vendList = vendSnap.docs.map(d => ({ id: d.id, ...d.data() }));
            setVendors(vendList);

            // 2. Load all active items across all vendors
            let itemsObj = [];
            for (const v of vendList) {
                const itemsRef = collection(db, `vendors/${v.id}/items`);
                const itemsSnap = await getDocs(itemsRef);
                itemsSnap.forEach(itemDoc => {
                    const data = itemDoc.data();
                    if (data.status !== 'rejected') {
                        itemsObj.push({
                            id: itemDoc.id,
                            vendorId: v.id,
                            vendorName: v.name || v.businessName || 'Unknown Vendor',
                            ...data
                        });
                    }
                });
            }
            setAllItems(itemsObj);
        } catch (err) {
            console.error('Failed to load pricing data:', err);
            toast.error('Failed to load item catalog.');
        } finally {
            setLoading(false);
        }
    };

    const handleUpdateField = async (item, field, value) => {
        setProcessingId(item.id + '_' + field);
        try {
            const itemRef = doc(db, `vendors/${item.vendorId}/items`, item.id);
            const updates = {
                [field]: value,
                updatedAt: new Date().toISOString()
            };

            await updateDoc(itemRef, updates);

            setAllItems(prev => prev.map(i => i.id === item.id ? { ...i, ...updates } : i));
            toast.success(`Updated ${field} for ${item.name}`);
        } catch (err) {
            console.error(`Failed to update ${field}:`, err);
            toast.error(`Failed to update ${field}.`);
        } finally {
            setProcessingId(null);
        }
    };

    const filteredItems = useMemo(() => {
        return allItems.filter(item => {
            const matchSearch = !search ||
                (item.name || '').toLowerCase().includes(search.toLowerCase()) ||
                (item.sku || '').toLowerCase().includes(search.toLowerCase());
            const matchVendor = vendorFilter === 'All' || item.vendorId === vendorFilter;
            return matchSearch && matchVendor;
        });
    }, [allItems, search, vendorFilter]);

    if (!isSuperAdmin) {
        return <div style={{ padding: 40, textAlign: 'center' }}>Access Denied</div>;
    }

    if (loading) {
        return <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>Loading pricing catalog...</div>;
    }

    return (
        <div>
            <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                    <h2>Marketplace Pricing & Tax</h2>
                    <div style={{ color: 'var(--muted)', fontSize: 13, marginTop: 4 }}>
                        Manage commissions and tax settings per item. Changes apply only to new future orders.
                    </div>
                </div>
                <button
                    className="ui-btn secondary"
                    onClick={async () => {
                        toast.info('Scanning orders for integrity...');
                        try {
                            const q = query(collection(db, 'marketplaceOrders'));
                            const snap = await getDocs(q);
                            let mismatchCount = 0;

                            for (const d of snap.docs) {
                                const order = d.data();
                                const items = order.items || [];
                                const calcSubtotal = items.reduce((sum, item) => sum + round2((item.vendorPrice ?? item.price ?? 0) * (item.qty || 1)), 0);
                                const calcTax = items.reduce((sum, item) => {
                                    const itemTaxRate = item.taxRate ?? order.taxRate ?? 0;
                                    const isItemTaxable = item.isTaxable !== undefined ? item.isTaxable : !!item.taxable;
                                    return sum + (isItemTaxable ? round2(round2((item.vendorPrice ?? item.price ?? 0) * (item.qty || 1)) * itemTaxRate) : 0);
                                }, 0);
                                const calcTotal = round2(calcSubtotal + calcTax);

                                const storedTotal = Number(order.grandTotalAfterTax ?? order.total ?? 1); // 1 to trigger check if missing

                                if (Math.abs(calcTotal - storedTotal) > 0.01) {
                                    mismatchCount++;
                                    await updateDoc(doc(db, 'marketplaceOrders', d.id), {
                                        taxIntegrityStatus: 'MISMATCH',
                                        taxMismatchReason: `Stored: ${storedTotal}, Calc: ${calcTotal}`
                                    });
                                } else if (order.taxIntegrityStatus === 'MISMATCH') {
                                    await updateDoc(doc(db, 'marketplaceOrders', d.id), {
                                        taxIntegrityStatus: 'OK'
                                    });
                                }
                            }

                            if (mismatchCount > 0) {
                                toast.warning(`Found and flagged ${mismatchCount} orders with mismatches.`);
                            } else {
                                toast.success('All orders passed integrity check.');
                            }
                        } catch (err) {
                            console.error('Integrity check failed:', err);
                            toast.error('Failed to run integrity check.');
                        }
                    }}
                >
                    🔍 Run Integrity Check
                </button>
            </div>

            <div className="ui-card" style={{ marginBottom: 20 }}>
                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                    <input
                        className="ui-input"
                        placeholder="🔍 Search items or SKU..."
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        style={{ maxWidth: 300, flex: 1 }}
                    />
                    <select
                        className="ui-input"
                        value={vendorFilter}
                        onChange={e => setVendorFilter(e.target.value)}
                        style={{ maxWidth: 200 }}
                    >
                        <option value="All">All Vendors</option>
                        {vendors.map(v => (
                            <option key={v.id} value={v.id}>{v.name}</option>
                        ))}
                    </select>
                </div>
            </div>

            <div className="ui-table-wrap">
                <table className="ui-table">
                    <thead>
                        <tr>
                            <th>Item Name</th>
                            <th>Vendor Price</th>
                            <th style={{ width: 100 }}>Tax Rate</th>
                            <th style={{ width: 100 }}>Total (w/ Tax)</th>
                        </tr>
                    </thead>
                    <tbody>
                        {filteredItems.length === 0 ? (
                            <tr><td colSpan="4" style={{ textAlign: 'center', color: 'var(--muted)', padding: 24 }}>No items found.</td></tr>
                        ) : (
                            filteredItems.map(item => {
                                const vendorPrice = Number(item.vendorPrice ?? item.price ?? 0);
                                const isTaxable = !!item.isTaxable; // Still calculate based on vendor's setting
                                const taxRate = Number(item.taxRate ?? 0.13); // fallback to 0.13 per requirements

                                const taxAmount = isTaxable ? round2(vendorPrice * taxRate) : 0;
                                const totalPrice = round2(vendorPrice + taxAmount);

                                return (
                                    <tr key={item.id} className="is-row">
                                        <td>
                                            <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{item.name}</div>
                                            <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                                                {item.vendorName} • {item.sku || 'No SKU'}
                                                {!isTaxable && <span style={{ marginLeft: 6, color: 'var(--muted)', fontStyle: 'italic' }}>(Non-Taxable)</span>}
                                            </div>
                                        </td>
                                        <td style={{ fontWeight: 600 }}>${vendorPrice.toFixed(2)}</td>
                                        <td>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                                <input
                                                    className="ui-input"
                                                    type="number"
                                                    step="0.01"
                                                    defaultValue={taxRate}
                                                    onBlur={(e) => {
                                                        const val = Number(e.target.value);
                                                        if (val !== taxRate) handleUpdateField(item, 'taxRate', val);
                                                    }}
                                                    style={{ width: 80, textAlign: 'center' }}
                                                />
                                            </div>
                                        </td>
                                        <td style={{ fontWeight: 700, color: '#4ade80' }}>
                                            ${totalPrice.toFixed(2)}
                                        </td>
                                    </tr>
                                );
                            })
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
