/**
 * PricingIntelligencePanel.js
 *
 * Vendor Pricing Advisory Engine — shown inside AddItemModal and EditItemModal.
 *
 * Advisory states:
 *   1. Above Market   — vendor price > lowest; suggest competitive price + demand opportunity
 *   2. Competitive    — vendor price ≤ lowest; confirmation message
 *   3. Price Increase — vendor raised price on edit; loss warning
 *   4. Price Decrease — vendor lowered price on edit; gain estimate
 *   5. Bundle Advisory — item has compatibility match not yet listed; suggest adding
 *
 * Props:
 *   itemName      — item name string
 *   category      — category string
 *   vendorPrice   — current/proposed price (number or string)
 *   originalPrice — original price before edit (number, only for isEdit=true)
 *   isEdit        — boolean, controls whether Price Change Impact section shows
 *   onApplyPrice  — callback(price) when user clicks [Update Price]
 */
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { db } from '../../firebase';
import { collection, getDocs } from 'firebase/firestore';
import {
    getMarketBenchmark,
    getPriceRecommendations,
    estimateBilledVolumeImpact,
    getCompatibilityMatches,
} from './marketplaceIntelligence';
import {
    FiTrendingUp, FiTrendingDown, FiActivity, FiAlertTriangle,
    FiCheckCircle, FiInfo, FiPackage, FiDollarSign, FiShield,
} from 'react-icons/fi';

// ── Style tokens ──────────────────────────────────────────────────────────────
const S = {
    panel:        { marginTop: 16, background: 'rgba(56,189,248,0.04)', border: '1px solid rgba(56,189,248,0.15)', borderRadius: 12, overflow: 'hidden' },
    header:       { padding: '12px 16px', background: 'rgba(56,189,248,0.08)', borderBottom: '1px solid rgba(56,189,248,0.12)', display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 700, color: '#38bdf8' },
    section:      { padding: '14px 16px', borderBottom: '1px solid rgba(255,255,255,0.05)' },
    sectionTitle: { fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 },
    row:          { display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 13, marginBottom: 6 },
    muted:        { color: '#94a3b8' },
    msg:          { fontSize: 13, lineHeight: 1.65, marginBottom: 12 },
    badge:        (bg, color) => ({ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 6, background: bg, color }),
    primaryBtn:   { fontSize: 12, fontWeight: 700, padding: '8px 20px', borderRadius: 8, border: 'none', cursor: 'pointer', transition: 'all 0.15s' },
    ghostBtn:     { fontSize: 12, fontWeight: 600, padding: '8px 20px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.15)', background: 'transparent', color: '#94a3b8', cursor: 'pointer' },
};

const COL = { green: '#34d399', red: '#f87171', amber: '#fbbf24', blue: '#38bdf8', fg: '#f8fafc', muted: '#94a3b8' };
const volColor = { Low: COL.green, Medium: COL.amber, High: COL.red, None: COL.muted };

export default function PricingIntelligencePanel({
    itemName = '',
    category = '',
    vendorPrice = 0,
    originalPrice = 0,
    isEdit = false,
    onApplyPrice,
}) {
    const [benchmark, setBenchmark] = useState(null);
    const [recommendations, setRecommendations] = useState(null);
    const [impact, setImpact] = useState(null);
    const [loading, setLoading] = useState(false);
    const [allItems, setAllItems] = useState([]);
    const [fetched, setFetched] = useState(false);
    const [keepMyPrice, setKeepMyPrice] = useState(false);
    const [bundleDismissed, setBundleDismissed] = useState(false);
    const debounceRef = useRef(null);

    // ── Fetch all marketplace items once ──
    const fetchAllItems = useCallback(async () => {
        if (fetched) return;
        setLoading(true);
        try {
            const vendorsSnap = await getDocs(collection(db, 'vendors'));
            const items = [];
            for (const vDoc of vendorsSnap.docs) {
                try {
                    const itemSnap = await getDocs(collection(db, `vendors/${vDoc.id}/items`));
                    itemSnap.docs.forEach(d => {
                        const data = d.data();
                        if (data.status === 'active' || !data.status) {
                            items.push({
                                name: data.name || '',
                                vendorPrice: parseFloat(data.vendorPrice) || parseFloat(data.price) || 0,
                                category: data.category || '',
                                vendorId: vDoc.id,
                            });
                        }
                    });
                } catch (_) { /* skip inaccessible */ }
            }
            setAllItems(items);
            setFetched(true);
        } catch (err) {
            console.warn('PricingIntelligencePanel: fetch failed', err);
        } finally {
            setLoading(false);
        }
    }, [fetched]);

    // ── Re-compute on input change (debounced 600ms) ──
    useEffect(() => {
        if (debounceRef.current) clearTimeout(debounceRef.current);

        const name = (itemName || '').trim();
        const price = parseFloat(vendorPrice) || 0;
        if (!name || price <= 0) {
            setBenchmark(null); setRecommendations(null); setImpact(null);
            return;
        }

        setKeepMyPrice(false); // Reset on price/name change

        debounceRef.current = setTimeout(async () => {
            if (!fetched) await fetchAllItems();

            const bm = getMarketBenchmark(name, category, allItems);
            setBenchmark(bm);

            if (bm && bm.supplierCount > 0) {
                setRecommendations(getPriceRecommendations(price, bm));
                const cp = isEdit && originalPrice > 0 ? originalPrice : 0;
                setImpact(estimateBilledVolumeImpact(cp, price, bm));
            } else {
                setRecommendations(null);
                setImpact(null);
            }
        }, 600);

        return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
    }, [itemName, category, vendorPrice, originalPrice, isEdit, allItems, fetched, fetchAllItems]);

    // ── Trigger fetch on mount ──
    useEffect(() => {
        const name = (itemName || '').trim();
        const price = parseFloat(vendorPrice) || 0;
        if (name && price > 0 && !fetched) fetchAllItems();
    }, [itemName, vendorPrice, fetched, fetchAllItems]);

    // ── Don't render until there's data ──
    if (!benchmark && !loading) return null;

    const vp = parseFloat(vendorPrice) || 0;
    const op = parseFloat(originalPrice) || 0;
    const priceRaised  = isEdit && op > 0 && vp > op;
    const priceLowered = isEdit && op > 0 && vp < op;
    const isAboveMarket = benchmark && benchmark.supplierCount > 0 && vp > benchmark.lowest;
    const isCompetitive = benchmark && benchmark.supplierCount > 0 && vp <= benchmark.lowest;

    // Bundle advisory
    const compatMatches = getCompatibilityMatches(itemName);
    const hasBundleAdvisory = compatMatches && compatMatches.length > 0 && !bundleDismissed;

    // Demand opportunity estimate (monthly)
    const demandOpp = isAboveMarket && recommendations
        ? `$${Math.round(vp * 12 * 0.15 * 4)} to $${Math.round(vp * 12 * 0.25 * 4)}`
        : null;

    return (
        <div style={S.panel}>

            {/* ═══ HEADER ═══ */}
            <div style={S.header}>
                <FiActivity size={15} /> Marketplace Pricing Insight
                {loading && <span style={{ fontSize: 11, color: COL.muted, fontWeight: 400, marginLeft: 'auto' }}>Scanning marketplace…</span>}
            </div>

            {/* Loading */}
            {loading && !benchmark && (
                <div style={{ padding: 20, textAlign: 'center', color: COL.muted, fontSize: 13 }}>Analyzing market prices…</div>
            )}

            {/* No other suppliers */}
            {benchmark && benchmark.supplierCount === 0 && (
                <div style={{ ...S.section, color: COL.muted, fontSize: 13 }}>
                    <FiInfo size={14} style={{ marginRight: 6, verticalAlign: -2 }} />
                    No other marketplace suppliers found for this item. You'll be the first — set a competitive price!
                </div>
            )}

            {benchmark && benchmark.supplierCount > 0 && (
                <>
                    {/* ═══ STATE 1: ABOVE MARKET ═══ */}
                    {isAboveMarket && !keepMyPrice && !priceRaised && (
                        <div style={{ ...S.section, background: 'rgba(251,191,36,0.04)' }}>
                            <div style={{ ...S.sectionTitle, color: COL.amber }}>
                                <FiAlertTriangle size={14} /> Marketplace Pricing Insight
                            </div>
                            <div style={{ ...S.msg, color: '#cbd5e1' }}>
                                A similar item in the marketplace is currently offered at <strong style={{ color: COL.green }}>${benchmark.lowest.toFixed(2)}</strong>.
                            </div>
                            <div style={{ ...S.msg, color: '#cbd5e1' }}>
                                Reducing your price to <strong style={{ color: COL.blue }}>${recommendations?.matchPrice?.toFixed(2) || benchmark.lowest.toFixed(2)}</strong> may increase your chances of receiving more orders.
                            </div>
                            {demandOpp && (
                                <div style={{
                                    background: 'rgba(52,211,153,0.08)', border: '1px solid rgba(52,211,153,0.15)',
                                    borderRadius: 8, padding: '10px 14px', marginBottom: 14, fontSize: 13, color: COL.green,
                                }}>
                                    <FiDollarSign size={14} style={{ verticalAlign: -2, marginRight: 4 }} />
                                    Estimated additional demand opportunity: <strong>{demandOpp} per month</strong>
                                </div>
                            )}
                            <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
                                {onApplyPrice && (
                                    <button
                                        onClick={() => onApplyPrice(recommendations?.matchPrice || benchmark.lowest)}
                                        style={{ ...S.primaryBtn, background: COL.blue, color: '#0f172a' }}
                                    >
                                        Update Price
                                    </button>
                                )}
                                <button onClick={() => setKeepMyPrice(true)} style={S.ghostBtn}>
                                    Keep My Price
                                </button>
                            </div>
                        </div>
                    )}

                    {/* ═══ STATE 2: COMPETITIVE PRICING ═══ */}
                    {isCompetitive && !priceRaised && (
                        <div style={{ ...S.section, background: 'rgba(52,211,153,0.04)' }}>
                            <div style={{ ...S.sectionTitle, color: COL.green }}>
                                <FiCheckCircle size={14} /> Competitive Pricing
                            </div>
                            <div style={{ ...S.msg, color: '#cbd5e1' }}>
                                Your price is currently among the most competitive in the marketplace.
                            </div>
                            <div style={{ ...S.msg, color: '#cbd5e1', marginBottom: 0 }}>
                                You are likely to receive <strong style={{ color: COL.green }}>strong demand</strong> for this item.
                            </div>
                        </div>
                    )}

                    {/* ═══ STATE 3: PRICE INCREASE WARNING ═══ */}
                    {priceRaised && impact && (
                        <div style={{ ...S.section, background: 'rgba(244,63,94,0.04)' }}>
                            <div style={{ ...S.sectionTitle, color: COL.red }}>
                                <FiAlertTriangle size={14} /> Price Increase Notice
                            </div>
                            <div style={{ ...S.msg, color: '#cbd5e1' }}>
                                Your current price is <strong style={{ color: COL.fg }}>${op.toFixed(2)}</strong>.
                            </div>
                            <div style={{ ...S.msg, color: '#cbd5e1' }}>
                                Increasing to <strong style={{ color: COL.red }}>${vp.toFixed(2)}</strong> may reduce order volume.
                            </div>
                            {impact.monthlyLossRange && (
                                <div style={{
                                    background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.15)',
                                    borderRadius: 8, padding: '10px 14px', marginBottom: 14, fontSize: 13, color: COL.red,
                                }}>
                                    <FiAlertTriangle size={14} style={{ verticalAlign: -2, marginRight: 4 }} />
                                    Based on marketplace demand patterns you could lose approximately <strong>${impact.monthlyLossRange[0].toFixed(0)} to ${impact.monthlyLossRange[1].toFixed(0)} per month</strong> in potential orders.
                                </div>
                            )}
                            <div style={S.row}>
                                <span style={S.muted}>Current est. monthly billed</span>
                                <span style={{ fontWeight: 700, color: COL.fg }}>${impact.currentMonthly.toFixed(2)}</span>
                            </div>
                            <div style={S.row}>
                                <span style={S.muted}>Projected est. monthly billed</span>
                                <span style={{ fontWeight: 700, color: COL.red }}>${impact.projectedMonthly.toFixed(2)}</span>
                            </div>
                            <div style={S.row}>
                                <span style={S.muted}>Demand risk</span>
                                <span style={S.badge(`${COL.red}22`, COL.red)}>{impact.demandRisk}</span>
                            </div>
                            <div style={{ ...S.row, marginBottom: 0 }}>
                                <span style={S.muted}>Marketplace ranking</span>
                                <span style={{ fontSize: 12, fontWeight: 600, color: vp <= benchmark.lowest ? COL.green : vp <= benchmark.median ? COL.blue : COL.red }}>
                                    {impact.rankingImpact}
                                </span>
                            </div>
                            <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
                                {onApplyPrice && (
                                    <button
                                        onClick={() => onApplyPrice(op)}
                                        style={{ ...S.primaryBtn, background: COL.green, color: '#0f172a' }}
                                    >
                                        Revert to ${op.toFixed(2)}
                                    </button>
                                )}
                                <button onClick={() => {}} style={S.ghostBtn}>Keep New Price</button>
                            </div>
                        </div>
                    )}

                    {/* ═══ STATE 4: PRICE DECREASE (positive) ═══ */}
                    {priceLowered && impact && (
                        <div style={{ ...S.section, background: 'rgba(52,211,153,0.04)' }}>
                            <div style={{ ...S.sectionTitle, color: COL.green }}>
                                <FiCheckCircle size={14} /> Price Decrease — Demand Opportunity
                            </div>
                            <div style={{ ...S.msg, color: '#cbd5e1' }}>
                                Reducing from <strong style={{ color: COL.fg }}>${op.toFixed(2)}</strong> to <strong style={{ color: COL.green }}>${vp.toFixed(2)}</strong> may increase your order volume.
                            </div>
                            {impact.monthlyGainRange && (
                                <div style={{
                                    background: 'rgba(52,211,153,0.08)', border: '1px solid rgba(52,211,153,0.15)',
                                    borderRadius: 8, padding: '10px 14px', marginBottom: 14, fontSize: 13, color: COL.green,
                                }}>
                                    <FiTrendingUp size={14} style={{ verticalAlign: -2, marginRight: 4 }} />
                                    Estimated increase in billed volume: <strong>+${impact.monthlyGainRange[0].toFixed(0)} to +${impact.monthlyGainRange[1].toFixed(0)}/month</strong>
                                </div>
                            )}
                            <div style={S.row}>
                                <span style={S.muted}>Projected est. monthly billed</span>
                                <span style={{ fontWeight: 700, color: COL.green }}>${impact.projectedMonthly.toFixed(2)}</span>
                            </div>
                            <div style={{ ...S.row, marginBottom: 0 }}>
                                <span style={S.muted}>Marketplace ranking</span>
                                <span style={{ fontSize: 12, fontWeight: 600, color: vp <= benchmark.lowest ? COL.green : vp <= benchmark.median ? COL.blue : COL.red }}>
                                    {impact.rankingImpact}
                                </span>
                            </div>
                        </div>
                    )}

                    {/* ═══ MARKET RANGE (always visible) ═══ */}
                    <div style={S.section}>
                        <div style={{ ...S.sectionTitle, color: COL.blue }}>📊 Market Range</div>
                        <div style={S.row}>
                            <span style={S.muted}>Lowest active price</span>
                            <span style={{ fontWeight: 700, color: COL.green }}>${benchmark.lowest.toFixed(2)}</span>
                        </div>
                        <div style={S.row}>
                            <span style={S.muted}>Median active price</span>
                            <span style={{ fontWeight: 700, color: COL.fg }}>${benchmark.median.toFixed(2)}</span>
                        </div>
                        <div style={S.row}>
                            <span style={S.muted}>Highest active price</span>
                            <span style={{ fontWeight: 700, color: COL.red }}>${benchmark.highest.toFixed(2)}</span>
                        </div>
                        <div style={S.row}>
                            <span style={S.muted}>4-week movement</span>
                            <span style={{ fontWeight: 600, color: benchmark.trend4w >= 0 ? COL.green : COL.red, display: 'flex', alignItems: 'center', gap: 4 }}>
                                {benchmark.trend4w >= 0 ? <FiTrendingUp size={13} /> : <FiTrendingDown size={13} />}
                                {benchmark.trend4w >= 0 ? '+' : ''}{benchmark.trend4w}%
                            </span>
                        </div>
                        <div style={S.row}>
                            <span style={S.muted}>Volatility</span>
                            <span style={S.badge(`${volColor[benchmark.volatility]}22`, volColor[benchmark.volatility])}>
                                {benchmark.volatility}
                            </span>
                        </div>
                        <div style={{ fontSize: 11, color: '#64748b', marginTop: 4 }}>
                            {benchmark.supplierCount} active supplier{benchmark.supplierCount !== 1 ? 's' : ''} on marketplace
                        </div>
                    </div>

                    {/* ═══ NEW ITEM DEMAND ESTIMATE ═══ */}
                    {!isEdit && impact && vp > 0 && (
                        <div style={S.section}>
                            <div style={{ ...S.sectionTitle, color: COL.green }}>📈 Estimated Demand</div>
                            <div style={{ fontSize: 13, color: '#94a3b8', lineHeight: 1.6 }}>
                                At <strong style={{ color: COL.fg }}>${vp.toFixed(2)}</strong>, your estimated weekly billed volume is <strong style={{ color: COL.green }}>${impact.projectedMonthly > 0 ? (impact.projectedMonthly / 4).toFixed(2) : '—'}</strong>/week.
                                <br />Estimated monthly billed volume: <strong style={{ color: COL.green }}>${impact.projectedMonthly.toFixed(2)}</strong>
                            </div>
                            <div style={{ ...S.row, marginTop: 8, marginBottom: 0 }}>
                                <span style={S.muted}>Marketplace ranking</span>
                                <span style={{ fontSize: 12, fontWeight: 600, color: vp <= benchmark.lowest ? COL.green : vp <= benchmark.median ? COL.blue : COL.red }}>
                                    {impact.rankingImpact}
                                </span>
                            </div>
                        </div>
                    )}
                </>
            )}

            {/* ═══ BUNDLE ADVISORY ═══ */}
            {hasBundleAdvisory && (
                <div style={{ ...S.section, background: 'rgba(167,139,250,0.04)', borderBottom: 'none' }}>
                    <div style={{ ...S.sectionTitle, color: '#a78bfa' }}>
                        <FiPackage size={14} /> Bundle Opportunity
                    </div>
                    {compatMatches.map((m, i) => (
                        <div key={i} style={{ marginBottom: i < compatMatches.length - 1 ? 12 : 0 }}>
                            <div style={{ ...S.msg, color: '#cbd5e1', marginBottom: 8 }}>
                                Restaurants typically purchase <strong style={{ color: COL.fg }}>{m.matchItem}</strong> together with <strong style={{ color: COL.fg }}>{itemName}</strong>.
                            </div>
                            <div style={{ fontSize: 12, color: COL.muted, marginBottom: 8 }}>
                                Adding the compatible item may increase your order volume. Expected ratio: <strong style={{ color: '#a78bfa' }}>{m.ratio}</strong>
                            </div>
                        </div>
                    ))}
                    <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
                        <button style={{ ...S.primaryBtn, background: '#a78bfa', color: '#0f172a' }} onClick={() => setBundleDismissed(true)}>
                            <FiPackage size={12} style={{ verticalAlign: -2, marginRight: 4 }} /> I'll Add Matching Item
                        </button>
                        <button onClick={() => setBundleDismissed(true)} style={S.ghostBtn}>Dismiss</button>
                    </div>
                </div>
            )}
        </div>
    );
}
