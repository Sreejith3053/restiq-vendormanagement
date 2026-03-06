import React, { useState, useEffect } from 'react';
import { db } from '../../firebase';
import { collection, getDocs, query } from 'firebase/firestore';
import { toast } from 'react-toastify';
import './ItemAnalyticsModal.css';

export default function ItemAnalyticsModal({ item, onClose, onViewHistory }) {
    const [analyticsData, setAnalyticsData] = useState(null);
    const [loadingAnalytics, setLoadingAnalytics] = useState(true);

    useEffect(() => {
        if (!item) return;

        const fetchAnalytics = async () => {
            setLoadingAnalytics(true);
            try {
                // 1. Fetch all orders for this vendor to calculate item's performance
                const ordersQuery = query(collection(db, 'marketplaceOrders'));
                const oSnap = await getDocs(ordersQuery);
                const allVendorOrders = oSnap.docs.map(d => d.data()).filter(o => o.vendorId === item.vendorId);

                let totalSold = 0;
                let totalRevenue = 0;

                allVendorOrders.forEach(o => {
                    const status = (o.status || '').toLowerCase();
                    if (['fulfilled', 'completed', 'delivered'].includes(status)) {
                        (o.items || []).forEach(orderItem => {
                            const isMatch = orderItem.id === item.id || (orderItem.name === item.name && orderItem.vendorId === item.vendorId);
                            if (isMatch) {
                                const qty = Number(orderItem.qty || 0);
                                const price = Number(orderItem.vendorPrice ?? orderItem.price ?? 0);
                                totalSold += qty;
                                totalRevenue += (qty * price);
                            }
                        });
                    }
                });

                // 2. Fetch Audit Logs for Price Trend
                const auditRef = collection(db, `vendors/${item.vendorId}/items/${item.id}/auditLog`);
                const aSnap = await getDocs(auditRef);
                const logs = aSnap.docs.map(d => d.data());

                logs.sort((a, b) => {
                    const tA = a.timestamp?.toMillis?.() || a.timestamp?.seconds * 1000 || 0;
                    const tB = b.timestamp?.toMillis?.() || b.timestamp?.seconds * 1000 || 0;
                    return tA - tB; // Ascending (oldest first)
                });

                const monthlyPrices = {};
                const itemCreationPrice = Number(item.vendorPrice ?? item.price ?? 0);

                // Group price by month (assuming logs sorted oldest to newest)
                logs.forEach(log => {
                    const newP = log.proposedData?.vendorPrice ?? log.proposedData?.price ?? log.newData?.vendorPrice ?? log.newData?.price ?? log.newPrice;
                    if (newP !== undefined) {
                        let dt;
                        if (log.timestamp?.toDate) {
                            dt = log.timestamp.toDate();
                        } else if (log.timestamp?.seconds) {
                            dt = new Date(log.timestamp.seconds * 1000);
                        } else {
                            dt = new Date(); // fallback to current date if timestamp missing
                        }
                        const monthKey = dt.toLocaleString('en-US', { month: 'short', year: 'numeric' });
                        // Store the LATEST price for that month
                        monthlyPrices[monthKey] = Number(newP);
                    }
                });

                // Ensure current month is always present even if no logs
                const currentMonthKey = new Date().toLocaleString('en-US', { month: 'short', year: 'numeric' });
                if (Object.keys(monthlyPrices).length === 0) {
                    monthlyPrices[currentMonthKey] = itemCreationPrice;
                } else if (!monthlyPrices[currentMonthKey]) {
                    // If there weren't changes this exact month, carry over the last known value
                    monthlyPrices[currentMonthKey] = Number(Object.values(monthlyPrices).pop() || itemCreationPrice);
                }

                const monthKeys = Object.keys(monthlyPrices);
                const priceTrend = [];
                let previousPrice = null;

                monthKeys.forEach((month) => {
                    const price = monthlyPrices[month];
                    let percentChange = 0;
                    if (previousPrice) {
                        percentChange = ((price - previousPrice) / previousPrice) * 100;
                    }
                    priceTrend.push({
                        month,
                        price,
                        percentChange: previousPrice ? percentChange : 0,
                    });
                    previousPrice = price;
                });

                // Calculate overall insight (first month vs latest month)
                let overallChange = 0;
                if (priceTrend.length > 0) {
                    const firstPrice = priceTrend[0].price;
                    const lastPrice = priceTrend[priceTrend.length - 1].price;
                    if (firstPrice > 0) {
                        overallChange = ((lastPrice - firstPrice) / firstPrice) * 100;
                    }
                }

                const estimatedCommission = totalRevenue * ((item.vendorCommission || 15) / 100);

                setAnalyticsData({
                    totalSold,
                    totalRevenue,
                    estimatedCommission,
                    priceTrend, // Ascending for horizontal scroll layout
                    overallChange
                });

                console.log("[Analytics Debug] Data loaded successfully:", {
                    totalSold,
                    totalRevenue,
                    estimatedCommission,
                    priceTrendLength: priceTrend.length,
                    overallChange
                });

            } catch (error) {
                console.error("Error fetching analytics:", error);
                toast.error("Failed to load item analytics.");
            } finally {
                setLoadingAnalytics(false);
            }
        };

        fetchAnalytics();
    }, [item]);

    if (!item) return null;

    return (
        <>
            <div className="modal-backdrop" onClick={onClose} />
            <div className="modal-content analytics-modal">
                <div className="modal-header">
                    <div>
                        <h3 style={{ margin: 0, fontSize: 20 }}>Item Analytics</h3>
                        <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 4 }}>
                            {item.name} {item.vendorName ? `— ${item.vendorName}` : ''}
                        </div>
                    </div>
                    <button className="modal-close" onClick={onClose}>✕</button>
                </div>

                <div className="modal-body" style={{ padding: 24, overflowY: 'auto' }}>
                    {loadingAnalytics ? (
                        <div style={{ textAlign: 'center', padding: 40, color: 'var(--muted)' }}>Loading analytics...</div>
                    ) : analyticsData ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
                            {/* Stat Cards */}
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 16 }}>
                                <div className="ui-card stat-card" style={{ padding: 16 }}>
                                    <div className="stat-label">Total Sold</div>
                                    <div className="stat-value">{analyticsData.totalSold} <span style={{ fontSize: 14, fontWeight: 'normal' }}>{item.unit || 'units'}</span></div>
                                    <div className="stat-context">All-time quantity</div>
                                </div>
                                <div className="ui-card stat-card" style={{ padding: 16 }}>
                                    <div className="stat-label">Total Revenue</div>
                                    <div className="stat-value" style={{ color: '#4dabf7' }}>${analyticsData.totalRevenue.toFixed(2)}</div>
                                    <div className="stat-context">Gross item sales</div>
                                </div>
                                <div className="ui-card stat-card" style={{ padding: 16 }}>
                                    <div className="stat-label">Est. Commission</div>
                                    <div className="stat-value" style={{ color: '#4ade80' }}>${analyticsData.estimatedCommission.toFixed(2)}</div>
                                    <div className="stat-context">Based on {item.vendorCommission || 15}% rate</div>
                                </div>
                            </div>

                            {/* Monthly Price Trend Cars */}
                            <div>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, borderBottom: '1px solid var(--border)', paddingBottom: 8 }}>
                                    <h4 style={{ margin: 0, fontSize: 16 }}>Monthly Price Trend</h4>
                                    {analyticsData.priceTrend.length > 1 && (
                                        <div style={{ fontSize: 14, fontWeight: 500 }}>
                                            Insight: Price {analyticsData.overallChange >= 0 ? 'increased' : 'decreased'} {' '}
                                            <span style={{ color: analyticsData.overallChange > 0 ? '#fa5252' : analyticsData.overallChange < 0 ? '#4ade80' : 'var(--muted)' }}>
                                                {Math.abs(analyticsData.overallChange).toFixed(1)}%
                                            </span>
                                        </div>
                                    )}
                                </div>

                                <div style={{ display: 'flex', gap: 12, overflowX: 'auto', paddingBottom: 12 }}>
                                    {analyticsData.priceTrend.map((pt, idx) => (
                                        <div key={idx} className="ui-card" style={{ padding: 16, minWidth: 140, flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', background: 'rgba(255,255,255,0.02)' }}>
                                            <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 8 }}>{pt.month}</div>
                                            <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>${pt.price.toFixed(2)}</div>
                                            <div>
                                                {pt.percentChange === 0 ? (
                                                    <span style={{ color: 'var(--muted)', fontSize: 13, fontWeight: 500 }}>—</span>
                                                ) : pt.percentChange > 0 ? (
                                                    <span style={{ color: '#fa5252', fontSize: 13, fontWeight: 500 }}>↑ +{pt.percentChange.toFixed(1)}%</span>
                                                ) : (
                                                    <span style={{ color: '#4ade80', fontSize: 13, fontWeight: 500 }}>↓ {Math.abs(pt.percentChange).toFixed(1)}%</span>
                                                )}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            {/* Legacy History Button */}
                            {onViewHistory && (
                                <div style={{ textAlign: 'right' }}>
                                    <button
                                        className="ui-btn ghost small"
                                        onClick={() => {
                                            onClose();
                                            onViewHistory(item);
                                        }}
                                    >
                                        View Raw Audit Log
                                    </button>
                                </div>
                            )}
                        </div>
                    ) : null}
                </div>
            </div>
        </>
    );
}
