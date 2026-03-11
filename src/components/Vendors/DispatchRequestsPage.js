import React, { useState, useEffect, useContext } from 'react';
import { UserContext } from '../../contexts/UserContext';
import { db } from '../../firebase';
import { collection, query, where, orderBy, onSnapshot } from 'firebase/firestore';
import { toast } from 'react-toastify';
import { useNavigate } from 'react-router-dom';

export default function DispatchRequestsPage() {
    const { vendorId, isSuperAdmin } = useContext(UserContext);
    const [dispatches, setDispatches] = useState([]);
    const [loading, setLoading] = useState(true);
    const [statusFilter, setStatusFilter] = useState('All');
    const navigate = useNavigate();

    useEffect(() => {
        if (!isSuperAdmin && !vendorId) {
            setLoading(false);
            return;
        }

        let q;
        const dispatchesRef = collection(db, 'vendorDispatches');

        if (isSuperAdmin) {
            q = query(dispatchesRef);
        } else {
            q = query(dispatchesRef, where('vendorId', '==', vendorId));
        }

        const unsubscribe = onSnapshot(q, (snapshot) => {
            const fetched = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
            // Client-side sort to avoid requiring composite indexes for vendorId + weekStart
            fetched.sort((a, b) => {
                const wA = a.weekStart ? new Date(a.weekStart).getTime() : 0;
                const wB = b.weekStart ? new Date(b.weekStart).getTime() : 0;
                if (wA !== wB) return wB - wA;

                const sA = a.sentAt?.toDate ? a.sentAt.toDate().getTime() : new Date(a.sentAt || 0).getTime();
                const sB = b.sentAt?.toDate ? b.sentAt.toDate().getTime() : new Date(b.sentAt || 0).getTime();
                return sB - sA;
            });
            setDispatches(fetched);
            setLoading(false);
        }, (err) => {
            console.error('Error fetching dispatch requests:', err);
            // Ignore index errors as this is a new collection and requires composite indexes
            if (err.message.includes('index')) {
                setLoading(false);
                return;
            }
            toast.error('Failed to load dispatch requests.');
            setLoading(false);
        });

        return () => unsubscribe();
    }, [vendorId, isSuperAdmin]);

    const formatDate = (timestamp) => {
        if (!timestamp) return '';
        const d = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
        return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    };

    const formatCurrency = (amount) => {
        return new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' }).format(amount || 0);
    };

    const filteredDispatches = dispatches.filter(d => {
        if (statusFilter === 'All') return true;
        return d.status === statusFilter;
    });

    if (loading) {
        return <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-secondary)' }}>Loading dispatch requests...</div>;
    }

    return (
        <div style={{ padding: '24px 32px', maxWidth: 1200, margin: '0 auto', color: '#f8fafc' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
                <div>
                    <h1 style={{ fontSize: 24, fontWeight: 700, margin: '0 0 8px 0' }}>Dispatch Requests</h1>
                    <p style={{ color: '#94a3b8', margin: 0, fontSize: 14 }}>Manage your weekly supply planning dispatch confirmations.</p>
                </div>
            </div>

            <div style={{ display: 'flex', gap: 12, marginBottom: 20 }}>
                <select
                    className="ui-input"
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value)}
                    style={{ maxWidth: 220, background: 'rgba(0,0,0,0.3)', color: '#fff', border: '1px solid var(--border)', padding: '8px 12px', borderRadius: 8 }}
                >
                    <option value="All">All Statuses</option>
                    <option value="Sent">Sent</option>
                    <option value="Confirmed">Confirmed</option>
                    <option value="Partially Confirmed">Partially Confirmed</option>
                    <option value="Rejected">Rejected</option>
                    <option value="Delivered">Delivered</option>
                </select>
            </div>

            <div className="ui-table-wrap" style={{ background: 'rgba(255,255,255,0.02)', borderRadius: 12, border: '1px solid rgba(255,255,255,0.06)', overflow: 'hidden' }}>
                <table className="ui-table" style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                    <thead>
                        <tr style={{ background: 'rgba(0,0,0,0.3)' }}>
                            <th style={{ padding: '12px 16px', color: '#94a3b8', fontWeight: 600, fontSize: 13, textTransform: 'uppercase' }}>Dispatch ID</th>
                            <th style={{ padding: '12px 16px', color: '#94a3b8', fontWeight: 600, fontSize: 13, textTransform: 'uppercase' }}>Week</th>
                            <th style={{ padding: '12px 16px', color: '#94a3b8', fontWeight: 600, fontSize: 13, textTransform: 'uppercase' }}>Restaurant</th>
                            <th style={{ padding: '12px 16px', color: '#94a3b8', fontWeight: 600, fontSize: 13, textTransform: 'uppercase' }}>Status</th>
                            <th style={{ padding: '12px 16px', color: '#94a3b8', fontWeight: 600, fontSize: 13, textTransform: 'uppercase' }}>Mon Packs</th>
                            <th style={{ padding: '12px 16px', color: '#94a3b8', fontWeight: 600, fontSize: 13, textTransform: 'uppercase' }}>Thu Packs</th>
                            <th style={{ padding: '12px 16px', color: '#94a3b8', fontWeight: 600, fontSize: 13, textTransform: 'uppercase' }}>Payout</th>
                            <th style={{ padding: '12px 16px', textAlign: 'right' }}></th>
                        </tr>
                    </thead>
                    <tbody>
                        {filteredDispatches.length === 0 ? (
                            <tr>
                                <td colSpan={8} style={{ padding: 40, textAlign: 'center', color: '#94a3b8' }}>
                                    No dispatch requests found yet.
                                </td>
                            </tr>
                        ) : (
                            filteredDispatches.map(dispatch => {
                                let statusBg = 'rgba(255,255,255,0.1)';
                                let statusColor = '#94a3b8';

                                if (dispatch.status === 'Sent') {
                                    statusBg = 'rgba(56, 189, 248, 0.15)';
                                    statusColor = '#38bdf8';
                                } else if (dispatch.status === 'Confirmed' || dispatch.status === 'Delivered') {
                                    statusBg = 'rgba(16, 185, 129, 0.15)';
                                    statusColor = '#10b981';
                                } else if (dispatch.status === 'Partially Confirmed') {
                                    statusBg = 'rgba(245, 158, 11, 0.15)';
                                    statusColor = '#f59e0b';
                                } else if (dispatch.status === 'Rejected') {
                                    statusBg = 'rgba(244, 63, 94, 0.15)';
                                    statusColor = '#f43f5e';
                                }

                                return (
                                    <tr key={dispatch.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.06)', cursor: 'pointer', transition: 'background 0.2s' }} onClick={() => navigate(`/dispatch-requests/${dispatch.id}`)} onMouseOver={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.04)'} onMouseOut={(e) => e.currentTarget.style.background = 'transparent'}>
                                        <td style={{ padding: '16px', fontWeight: 600, fontFamily: 'monospace' }}>{dispatch.dispatchId || dispatch.id.slice(-8).toUpperCase()}</td>
                                        <td style={{ padding: '16px', color: '#e2e8f0', fontSize: 14 }}>
                                            {formatDate(dispatch.weekStart)} - {formatDate(dispatch.weekEnd)}
                                        </td>
                                        <td style={{ padding: '16px', fontWeight: 500 }}>{dispatch.restaurantName}</td>
                                        <td style={{ padding: '16px' }}>
                                            <span style={{ background: statusBg, color: statusColor, padding: '4px 8px', borderRadius: 4, fontSize: 11, fontWeight: 700, textTransform: 'uppercase' }}>
                                                {dispatch.status}
                                            </span>
                                        </td>
                                        <td style={{ padding: '16px', color: '#94a3b8', fontSize: 14 }}>{dispatch.mondayTotalPacks || 0}</td>
                                        <td style={{ padding: '16px', color: '#94a3b8', fontSize: 14 }}>{dispatch.thursdayTotalPacks || 0}</td>
                                        <td style={{ padding: '16px', fontWeight: 600, color: '#fbbf24' }}>
                                            {formatCurrency(dispatch.vendorPayout)}
                                        </td>
                                        <td style={{ padding: '16px', textAlign: 'right' }}>
                                            <button className="ui-btn ghost" style={{ padding: '6px 12px', fontSize: 13 }} onClick={(e) => { e.stopPropagation(); navigate(`/dispatch-requests/${dispatch.id}`); }}>
                                                View
                                            </button>
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
