/**
 * VendorExpectedAllocation.js
 *
 * Vendor-facing expected allocation view.
 * Shows the vendor's expected marketplace demand share, allocated quantities
 * per item and delivery day, and tips to increase share.
 */
import React, { useState } from 'react';
import {
    FiRefreshCw, FiTrendingUp, FiTrendingDown, FiPackage, FiPieChart,
} from 'react-icons/fi';
import { toast } from 'react-toastify';
import { UserContext } from '../../contexts/UserContext';
import { generateMockAllocations, supplyStabilityScore } from './vendorAllocationEngine';
import { scoreLabel } from './vendorCompetitivenessEngine';

const C = { green: '#34d399', red: '#f87171', amber: '#fbbf24', blue: '#38bdf8', purple: '#a78bfa', cyan: '#22d3ee', muted: '#94a3b8', fg: '#f8fafc' };

export default function VendorExpectedAllocation() {
    const { vendorId, vendorName } = React.useContext(UserContext);
    const [refreshKey, setRefreshKey] = useState(0);

    // Generate all allocations and filter to this vendor
    const allAllocations = generateMockAllocations();
    const vId = vendorId || 'v1';

    // Group by item
    const itemMap = {};
    allAllocations.forEach(a => {
        a.allocations.forEach(va => {
            if (va.vendorId === vId) {
                const key = a.comparableGroup;
                if (!itemMap[key]) {
                    itemMap[key] = {
                        itemName: a.itemName,
                        comparableGroup: a.comparableGroup,
                        days: [],
                        totalDemand: 0,
                        totalAllocated: 0,
                    };
                }
                itemMap[key].days.push({
                    day: a.deliveryDay,
                    demand: a.totalDemand,
                    allocated: va.allocatedQuantity,
                    share: va.allocationShare,
                    score: va.competitivenessScore,
                    price: va.price,
                    reason: va.allocationReason,
                });
                itemMap[key].totalDemand += a.totalDemand;
                itemMap[key].totalAllocated += va.allocatedQuantity;
            }
        });
    });

    const items = Object.values(itemMap);
    const totalUnits = items.reduce((s, i) => s + i.totalAllocated, 0);
    const totalDemandAll = items.reduce((s, i) => s + i.totalDemand, 0);
    const avgShare = totalDemandAll > 0 ? Math.round((totalUnits / totalDemandAll) * 100) : 0;

    return (
        <div style={{ padding: 24, paddingBottom: 100 }}>
            {/* HEADER */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 16, marginBottom: 24 }}>
                <div>
                    <h1 style={{ margin: 0, fontSize: 24, fontWeight: 800, color: C.fg }}>📦 Expected Allocation</h1>
                    <p style={{ margin: '4px 0 0', color: C.muted, fontSize: 13 }}>
                        Your expected marketplace demand share based on competitiveness score, pricing, and reliability.
                    </p>
                </div>
                <button onClick={() => { setRefreshKey(k => k + 1); toast.success('Allocation refreshed'); }} style={{
                    padding: '8px 16px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.1)',
                    background: 'rgba(255,255,255,0.04)', color: C.fg, fontSize: 13, cursor: 'pointer',
                    display: 'flex', alignItems: 'center', gap: 6,
                }}>
                    <FiRefreshCw size={14} /> Refresh
                </button>
            </div>

            {/* SUMMARY CARDS */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginBottom: 24 }}>
                <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 12, padding: '16px 18px' }}>
                    <div style={{ color: C.blue, marginBottom: 6 }}><FiPackage size={16} /></div>
                    <div style={{ fontSize: 28, fontWeight: 800, color: C.blue, lineHeight: 1 }}>{totalUnits}</div>
                    <div style={{ fontSize: 11, color: C.muted, marginTop: 6 }}>Total Allocated Units</div>
                </div>
                <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 12, padding: '16px 18px' }}>
                    <div style={{ color: C.green, marginBottom: 6 }}><FiPieChart size={16} /></div>
                    <div style={{ fontSize: 28, fontWeight: 800, color: C.green, lineHeight: 1 }}>{avgShare}%</div>
                    <div style={{ fontSize: 11, color: C.muted, marginTop: 6 }}>Avg Demand Share</div>
                </div>
                <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 12, padding: '16px 18px' }}>
                    <div style={{ color: C.purple, marginBottom: 6 }}><FiTrendingUp size={16} /></div>
                    <div style={{ fontSize: 28, fontWeight: 800, color: C.purple, lineHeight: 1 }}>{items.length}</div>
                    <div style={{ fontSize: 11, color: C.muted, marginTop: 6 }}>Items Allocated</div>
                </div>
                <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 12, padding: '16px 18px' }}>
                    <div style={{ color: C.amber, marginBottom: 6 }}><FiTrendingUp size={16} /></div>
                    <div style={{ fontSize: 28, fontWeight: 800, color: C.amber, lineHeight: 1 }}>{totalDemandAll}</div>
                    <div style={{ fontSize: 11, color: C.muted, marginTop: 6 }}>Total Marketplace Demand</div>
                </div>
            </div>

            {/* ITEM ALLOCATION CARDS */}
            {items.length === 0 ? (
                <div style={{ textAlign: 'center', padding: 40, color: C.muted, fontSize: 14 }}>
                    No allocations found for your items. This may update as demand and scores are recalculated.
                </div>
            ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                    {items.map((item, idx) => {
                        const overallShare = item.totalDemand > 0 ? Math.round((item.totalAllocated / item.totalDemand) * 100) : 0;
                        const shareColor = overallShare >= 40 ? C.green : overallShare >= 25 ? C.blue : C.amber;
                        return (
                            <div key={idx} style={{
                                background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)',
                                borderRadius: 12, overflow: 'hidden',
                            }}>
                                {/* Item header */}
                                <div style={{
                                    padding: '16px 20px', borderBottom: '1px solid rgba(255,255,255,0.06)',
                                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                                }}>
                                    <div>
                                        <div style={{ fontSize: 15, fontWeight: 700, color: C.fg }}>{item.itemName}</div>
                                        <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>{item.comparableGroup}</div>
                                    </div>
                                    <div style={{ textAlign: 'right' }}>
                                        <div style={{ fontSize: 13, color: C.muted }}>
                                            Marketplace demand: <strong style={{ color: C.fg }}>{item.totalDemand} units</strong>
                                        </div>
                                        <div style={{ fontSize: 13, color: C.muted, marginTop: 2 }}>
                                            Your share: <strong style={{ color: shareColor }}>{overallShare}%</strong>
                                        </div>
                                        <div style={{ fontSize: 13, color: C.muted, marginTop: 2 }}>
                                            Expected allocation: <strong style={{ color: C.fg }}>{item.totalAllocated} units</strong>
                                        </div>
                                    </div>
                                </div>

                                {/* Share bar */}
                                <div style={{ padding: '0 20px', marginTop: 12, marginBottom: 6 }}>
                                    <div style={{ height: 10, borderRadius: 5, background: 'rgba(255,255,255,0.06)', overflow: 'hidden' }}>
                                        <div style={{ height: '100%', width: `${overallShare}%`, background: shareColor, borderRadius: 5, transition: 'width 0.4s' }} />
                                    </div>
                                </div>

                                {/* Delivery day breakdown */}
                                <div style={{ padding: '12px 20px 16px' }}>
                                    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${item.days.length}, 1fr)`, gap: 12 }}>
                                        {item.days.map((d, di) => {
                                            const sl = scoreLabel(d.score);
                                            return (
                                                <div key={di} style={{
                                                    padding: '12px 14px', background: 'rgba(255,255,255,0.02)',
                                                    border: '1px solid rgba(255,255,255,0.05)', borderRadius: 8,
                                                }}>
                                                    <div style={{ fontSize: 12, fontWeight: 700, color: C.blue, marginBottom: 6 }}>{d.day}</div>
                                                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
                                                        <span style={{ color: C.muted }}>Day demand</span>
                                                        <span style={{ color: C.fg, fontWeight: 600 }}>{d.demand}</span>
                                                    </div>
                                                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
                                                        <span style={{ color: C.muted }}>Your allocation</span>
                                                        <span style={{ color: C.green, fontWeight: 700 }}>{d.allocated} units</span>
                                                    </div>
                                                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
                                                        <span style={{ color: C.muted }}>Your share</span>
                                                        <span style={{ color: C.blue, fontWeight: 600 }}>{Math.round(d.share * 100)}%</span>
                                                    </div>
                                                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                                                        <span style={{ color: C.muted }}>Score</span>
                                                        <span style={{ color: sl.color, fontWeight: 700 }}>{d.score}</span>
                                                    </div>
                                                    {d.reason && d.reason !== 'Standard score-based allocation' && (
                                                        <div style={{ fontSize: 11, color: C.amber, marginTop: 6, fontStyle: 'italic' }}>⚠ {d.reason}</div>
                                                    )}
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            {/* HOW TO INCREASE SHARE */}
            <div style={{
                marginTop: 24, padding: '18px 20px', background: 'rgba(167,139,250,0.04)',
                border: '1px solid rgba(167,139,250,0.15)', borderRadius: 12,
            }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: C.purple, marginBottom: 10 }}>💡 How to Increase Your Allocation Share</div>
                {[
                    { icon: '💰', text: 'Lower your price — vendors with better pricing receive higher allocation' },
                    { icon: '🛡️', text: 'Improve reliability — confirm dispatches faster, reduce disputes and short shipments' },
                    { icon: '📦', text: 'Increase capacity — vendors who can fulfill more demand get larger shares' },
                    { icon: '🔗', text: 'Add companion items — bundle completeness improves your competitiveness score' },
                    { icon: '⚡', text: 'Respond faster — quick dispatch confirmations and issue responses boost your score' },
                ].map((t, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 8 }}>
                        <span style={{ fontSize: 16, flexShrink: 0 }}>{t.icon}</span>
                        <span style={{ fontSize: 13, color: C.fg, lineHeight: 1.4 }}>{t.text}</span>
                    </div>
                ))}
            </div>

            <div style={{ marginTop: 16, fontSize: 12, color: '#475569', fontStyle: 'italic', textAlign: 'center' }}>
                Allocations are recalculated on price changes, dispatch confirmations, deliveries, and weekly schedules. No competitor identities are disclosed.
            </div>
        </div>
    );
}
