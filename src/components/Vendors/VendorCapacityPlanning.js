/**
 * VendorCapacityPlanning.js
 *
 * Vendor-facing supply forecast view.
 * Shows upcoming marketplace demand, vendor's declared capacity,
 * supply opportunity, and allows declaring capacity changes.
 */
import React, { useState } from 'react';
import {
    FiRefreshCw, FiTrendingUp, FiPackage, FiEdit3, FiCheckCircle,
} from 'react-icons/fi';
import { toast } from 'react-toastify';
import { UserContext } from '../../contexts/UserContext';
import { generateMockCapacityForecast, supplyHealthLabel } from './supplyCapacityEngine';

const C = { green: '#34d399', red: '#f87171', amber: '#fbbf24', blue: '#38bdf8', purple: '#a78bfa', cyan: '#22d3ee', muted: '#94a3b8', fg: '#f8fafc' };

export default function VendorCapacityPlanning() {
    const { vendorId } = React.useContext(UserContext);
    const [refreshKey, setRefreshKey] = useState(0);

    const vId = vendorId || 'v1';
    const allForecasts = generateMockCapacityForecast();

    // Find items where this vendor has capacity
    const myItems = allForecasts
        .filter(f => f.vendorBreakdown.some(v => v.vendorId === vId))
        .map(f => {
            const myV = f.vendorBreakdown.find(v => v.vendorId === vId);
            const hl = supplyHealthLabel(f.capacityGapPct);
            const additionalDemand = f.shortageRiskQty > 0 ? f.shortageRiskQty : (f.excessCapacityQty > 0 ? 0 : Math.max(0, f.weeklyForecastDemand - f.weeklyCapacity));
            return { ...f, myVendor: myV, healthLabel: hl, additionalDemand };
        });

    const totalCapacity = myItems.reduce((s, i) => s + (i.myVendor?.weeklyCapacity || 0), 0);
    const totalMarketDemand = myItems.reduce((s, i) => s + i.weeklyForecastDemand, 0);
    const opportunities = myItems.filter(i => i.additionalDemand > 0).length;

    return (
        <div style={{ padding: 24, paddingBottom: 100 }}>
            {/* HEADER */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 16, marginBottom: 24 }}>
                <div>
                    <h1 style={{ margin: 0, fontSize: 24, fontWeight: 800, color: C.fg }}>🛡️ Capacity Planning</h1>
                    <p style={{ margin: '4px 0 0', color: C.muted, fontSize: 13 }}>
                        See next week's marketplace demand forecast and how your supply capacity compares. Update capacity to capture more demand.
                    </p>
                </div>
                <button onClick={() => { setRefreshKey(k => k + 1); toast.success('Forecast refreshed'); }} style={{
                    padding: '8px 16px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.1)',
                    background: 'rgba(255,255,255,0.04)', color: C.fg, fontSize: 13, cursor: 'pointer',
                    display: 'flex', alignItems: 'center', gap: 6,
                }}><FiRefreshCw size={14} /> Refresh</button>
            </div>

            {/* SUMMARY CARDS */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginBottom: 24 }}>
                <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 12, padding: '16px 18px' }}>
                    <div style={{ color: C.blue, marginBottom: 6 }}><FiPackage size={16} /></div>
                    <div style={{ fontSize: 28, fontWeight: 800, color: C.blue, lineHeight: 1 }}>{totalCapacity}</div>
                    <div style={{ fontSize: 11, color: C.muted, marginTop: 6 }}>Your Total Capacity</div>
                </div>
                <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 12, padding: '16px 18px' }}>
                    <div style={{ color: C.amber, marginBottom: 6 }}><FiTrendingUp size={16} /></div>
                    <div style={{ fontSize: 28, fontWeight: 800, color: C.amber, lineHeight: 1 }}>{totalMarketDemand}</div>
                    <div style={{ fontSize: 11, color: C.muted, marginTop: 6 }}>Marketplace Demand</div>
                </div>
                <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 12, padding: '16px 18px' }}>
                    <div style={{ color: C.purple, marginBottom: 6 }}><FiTrendingUp size={16} /></div>
                    <div style={{ fontSize: 28, fontWeight: 800, color: C.purple, lineHeight: 1 }}>{opportunities}</div>
                    <div style={{ fontSize: 11, color: C.muted, marginTop: 6 }}>Supply Opportunities</div>
                </div>
                <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 12, padding: '16px 18px' }}>
                    <div style={{ color: C.green, marginBottom: 6 }}><FiCheckCircle size={16} /></div>
                    <div style={{ fontSize: 28, fontWeight: 800, color: C.green, lineHeight: 1 }}>{myItems.length}</div>
                    <div style={{ fontSize: 11, color: C.muted, marginTop: 6 }}>Items You Supply</div>
                </div>
            </div>

            {/* ITEM CARDS */}
            {myItems.length === 0 ? (
                <div style={{ textAlign: 'center', padding: 40, color: C.muted }}>No capacity data found for your items.</div>
            ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                    {myItems.map((item, idx) => {
                        const mv = item.myVendor;
                        const hl = item.healthLabel;
                        const capShare = item.weeklyCapacity > 0 ? Math.round((mv.weeklyCapacity / item.weeklyCapacity) * 100) : 0;

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
                                        <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>{item.comparableGroup} • {item.category}</div>
                                    </div>
                                    <span style={{
                                        background: `${hl.color}22`, color: hl.color, padding: '4px 12px',
                                        borderRadius: 6, fontSize: 12, fontWeight: 700,
                                    }}>
                                        {hl.icon} {hl.text}
                                    </span>
                                </div>

                                <div style={{ padding: '16px 20px' }}>
                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
                                        {/* Demand vs your capacity */}
                                        <div>
                                            <div style={{ fontSize: 12, fontWeight: 700, color: C.blue, marginBottom: 8 }}>📊 Marketplace Demand Forecast</div>
                                            {[
                                                ['Next week demand', `${item.weeklyForecastDemand} units`, C.fg],
                                                ['Monday', `${item.mondayForecastDemand} units`, C.muted],
                                                ['Thursday', `${item.thursdayForecastDemand} units`, C.muted],
                                                ['Total marketplace capacity', `${item.weeklyCapacity} units`, C.blue],
                                                ['Active vendors', item.activeVendorCount, C.muted],
                                            ].map(([l, v, c], i) => (
                                                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
                                                    <span style={{ color: C.muted }}>{l}</span>
                                                    <span style={{ fontWeight: 600, color: c }}>{v}</span>
                                                </div>
                                            ))}
                                        </div>

                                        {/* Your capacity */}
                                        <div>
                                            <div style={{ fontSize: 12, fontWeight: 700, color: C.green, marginBottom: 8 }}>📦 Your Capacity</div>
                                            {[
                                                ['Weekly capacity', `${mv.weeklyCapacity} units`, C.green],
                                                ['Monday', `${mv.mondayCapacity} units`, C.muted],
                                                ['Thursday', `${mv.thursdayCapacity} units`, C.muted],
                                                ['Your share', `${capShare}%`, C.purple],
                                                ['Confidence', mv.capacityConfidence, C.muted],
                                            ].map(([l, v, c], i) => (
                                                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
                                                    <span style={{ color: C.muted }}>{l}</span>
                                                    <span style={{ fontWeight: 600, color: c }}>{v}</span>
                                                </div>
                                            ))}
                                        </div>
                                    </div>

                                    {/* Opportunity */}
                                    {item.additionalDemand > 0 && (
                                        <div style={{
                                            padding: '12px 16px', background: 'rgba(167,139,250,0.06)',
                                            border: '1px solid rgba(167,139,250,0.15)', borderRadius: 8, marginBottom: 12,
                                        }}>
                                            <div style={{ fontSize: 13, fontWeight: 700, color: C.purple, marginBottom: 4 }}>💰 Supply Opportunity</div>
                                            <div style={{ fontSize: 13, color: C.fg }}>
                                                Marketplace is short <strong style={{ color: C.purple }}>{item.additionalDemand} units</strong>.
                                                Increase your capacity to capture additional demand and improve your allocation share.
                                            </div>
                                        </div>
                                    )}

                                    {/* Capacity share bar */}
                                    <div>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: C.muted, marginBottom: 4 }}>
                                            <span>Your capacity share</span>
                                            <span>{capShare}%</span>
                                        </div>
                                        <div style={{ height: 8, borderRadius: 4, background: 'rgba(255,255,255,0.06)', overflow: 'hidden' }}>
                                            <div style={{ height: '100%', width: `${capShare}%`, background: C.green, borderRadius: 4 }} />
                                        </div>
                                    </div>

                                    {/* Actions */}
                                    <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
                                        <button onClick={() => toast.info('Capacity update — coming soon')} style={{
                                            padding: '8px 16px', borderRadius: 8, border: '1px solid rgba(52,211,153,0.3)',
                                            background: 'rgba(52,211,153,0.08)', color: C.green, fontSize: 12, fontWeight: 600,
                                            cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6,
                                        }}><FiEdit3 size={13} /> Update Capacity</button>
                                        <button onClick={() => toast.info('Temporary increase noted')} style={{
                                            padding: '8px 16px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.1)',
                                            background: 'rgba(255,255,255,0.04)', color: C.muted, fontSize: 12, fontWeight: 600,
                                            cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6,
                                        }}><FiTrendingUp size={13} /> Temp Increase</button>
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            <div style={{ marginTop: 24, fontSize: 12, color: '#475569', fontStyle: 'italic', textAlign: 'center' }}>
                Demand forecasts are based on marketplace history and may change. Update your capacity weekly to receive the best allocation.
            </div>
        </div>
    );
}
