import React, { useEffect, useState, useContext } from 'react';
import { useNavigate } from 'react-router-dom';
import { UserContext } from '../contexts/UserContext';
import { db } from '../firebase';
import { collection, getDocs, doc, getDoc, query, where } from 'firebase/firestore';

export default function Dashboard() {
    const navigate = useNavigate();
    const { vendorId, vendorName, isSuperAdmin } = useContext(UserContext);
    const [stats, setStats] = useState({ items: 0, users: 0, categories: 0 });
    const [vendorData, setVendorData] = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        (async () => {
            try {
                if (isSuperAdmin) return; // Super admin doesn't see this dashboard

                // Fetch vendor profile
                if (vendorId) {
                    const vendorSnap = await getDoc(doc(db, 'vendors', vendorId));
                    if (vendorSnap.exists()) {
                        setVendorData({ id: vendorSnap.id, ...vendorSnap.data() });
                    }
                }

                // Count items for this vendor
                let totalItems = 0;
                const categorySet = new Set();
                if (vendorId) {
                    try {
                        const itemSnap = await getDocs(collection(db, `vendors/${vendorId}/items`));
                        totalItems = itemSnap.size;
                        itemSnap.docs.forEach(d => {
                            const cat = d.data().category;
                            if (cat) categorySet.add(cat);
                        });
                    } catch { /* skip */ }
                }

                // Count users for this vendor
                let totalUsers = 0;
                try {
                    const usersQ = query(
                        collection(db, 'login'),
                        where('vendorId', '==', vendorId)
                    );
                    const usersSnap = await getDocs(usersQ);
                    totalUsers = usersSnap.size;
                } catch { /* skip */ }

                setStats({
                    items: totalItems,
                    users: totalUsers,
                    categories: categorySet.size,
                });
            } catch (err) {
                console.error('Dashboard load error:', err);
            } finally {
                setLoading(false);
            }
        })();
    }, [vendorId, isSuperAdmin]);

    if (loading) {
        return (
            <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>
                Loading dashboard...
            </div>
        );
    }

    return (
        <div>
            <div className="page-header">
                <h2>Welcome, {vendorName || 'Vendor'}</h2>
            </div>

            {/* Stats */}
            <div className="ui-stats" style={{ marginBottom: 24 }}>
                <div className="ui-stat" onClick={() => navigate('/items')} style={{ cursor: 'pointer' }}>
                    <div className="ui-stat__label">Total Items</div>
                    <div className="ui-stat__value">{stats.items}</div>
                </div>
                <div className="ui-stat" onClick={() => navigate('/users')} style={{ cursor: 'pointer' }}>
                    <div className="ui-stat__label">Team Members</div>
                    <div className="ui-stat__value">{stats.users}</div>
                </div>
                <div className="ui-stat">
                    <div className="ui-stat__label">Categories</div>
                    <div className="ui-stat__value">{stats.categories}</div>
                </div>
            </div>

            {/* Vendor Profile Card */}
            <div className="ui-card">
                <div className="ui-card-title">Vendor Profile</div>
                {vendorData ? (
                    <div style={{ padding: '12px 0' }}>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px 24px', fontSize: 14, color: '#c8d6e5' }}>
                            <div>
                                <div style={{ fontSize: 11, color: '#5a6f8a', fontWeight: 700, textTransform: 'uppercase', marginBottom: 4 }}>Business Name</div>
                                {vendorData.name || vendorData.businessName || '—'}
                            </div>
                            <div>
                                <div style={{ fontSize: 11, color: '#5a6f8a', fontWeight: 700, textTransform: 'uppercase', marginBottom: 4 }}>Category</div>
                                <span className="badge blue">{vendorData.category || 'General'}</span>
                            </div>
                            <div>
                                <div style={{ fontSize: 11, color: '#5a6f8a', fontWeight: 700, textTransform: 'uppercase', marginBottom: 4 }}>Contact</div>
                                {vendorData.contactPhone || vendorData.contactEmail || '—'}
                            </div>
                            <div>
                                <div style={{ fontSize: 11, color: '#5a6f8a', fontWeight: 700, textTransform: 'uppercase', marginBottom: 4 }}>Status</div>
                                <span className={`badge ${vendorData.status === 'active' ? 'green' : 'gray'}`}>
                                    {vendorData.status || 'active'}
                                </span>
                            </div>
                        </div>
                    </div>
                ) : (
                    <div style={{ padding: 20, textAlign: 'center', color: 'var(--muted)' }}>
                        Vendor profile not found. Contact admin.
                    </div>
                )}
            </div>
        </div>
    );
}
