/**
 * VendorScoreDashboard.js
 *
 * Vendor-facing simplified Competitiveness Score dashboard.
 * Shows the vendor's own scores, factor breakdown, trend, rank, and improvement tips.
 * No competitor names are exposed.
 */
import React, { useState, useEffect, useCallback } from 'react';
import { db } from '../../firebase';
import { collection, getDocs } from 'firebase/firestore';
import { UserContext } from '../../contexts/UserContext';
import {
    calculateCompetitivenessScore, scoreLabel, getImprovementSuggestions,
} from './vendorCompetitivenessEngine';
import { getMarketBenchmark } from './marketplaceIntelligence';
import {
    FiRefreshCw, FiAward, FiTrendingUp, FiTrendingDown, FiShield,
} from 'react-icons/fi';
import { toast } from 'react-toastify';

const C = { green: '#34d399', red: '#f87171', amber: '#fbbf24', blue: '#38bdf8', purple: '#a78bfa', cyan: '#22d3ee', muted: '#94a3b8', fg: '#f8fafc' };

export default function VendorScoreDashboard() {
    const { vendorId, vendorName } = React.useContext(UserContext);
    const [allItems, setAllItems] = useState([]);
    const [myItems, setMyItems] = useState([]);
    const [scores, setScores] = useState([]);
    const [loading, setLoading] = useState(true);
    const [selectedIdx, setSelectedIdx] = useState(0);

    const fetchData = useCallback(async () => {
        setLoading(true);
        try {
            const vendorsSnap = await getDocs(collection(db, 'vendors'));
            const items = [];
            let myIt = [];
            for (const vDoc of vendorsSnap.docs) {
                try {
                    const itemSnap = await getDocs(collection(db, `vendors/${vDoc.id}/items`));
                    itemSnap.docs.forEach(d => {
                        const data = d.data();
                        if (data.status === 'active' || !data.status) {
                            const entry = {
                                name: data.name || '',
                                vendorPrice: parseFloat(data.vendorPrice) || parseFloat(data.price) || 0,
                                category: data.category || '',
                                vendorId: vDoc.id,
                            };
                            items.push(entry);
                            if (vDoc.id === vendorId) myIt.push(entry);
                        }
                    });
                } catch (_) {}
            }
            setAllItems(items);
            setMyItems(myIt);

            // Calculate scores for my items
            const myScores = [];
            for (const item of myIt) {
                const bm = getMarketBenchmark(item.name, item.category, items);
                if (!bm || bm.supplierCount === 0) continue;
                const record = calculateCompetitivenessScore({
                    vendorId: vendorId || '',
                    vendorName: vendorName || '',
                    itemName: item.name,
                    comparableGroup: item.name,
                    normalizedPrice: item.vendorPrice,
                    lowestPrice: bm.lowest,
                    medianPrice: bm.median,
                    highestPrice: bm.highest,
                });
                // Compute rank
                const sameGroup = items.filter(i => i.name.trim().toLowerCase() === item.name.trim().toLowerCase()).sort((a, b) => a.vendorPrice - b.vendorPrice);
                const totalInGroup = sameGroup.length;
                const priceRank = sameGroup.findIndex(i => i.vendorId === vendorId) + 1;
                record._groupSize = totalInGroup;
                record._priceRank = priceRank;
                record._bm = bm;
                record.category = item.category;
                myScores.push(record);
            }
            myScores.sort((a, b) => b.finalScore - a.finalScore);
            setScores(myScores);
        } catch (err) { console.warn('VendorScoreDashboard: fetch failed', err); }
        finally { setLoading(false); }
    }, [vendorId, vendorName]);

    useEffect(() => { fetchData(); }, [fetchData]);

    if (loading) {
        return (
            <div style={{ padding: 24, textAlign: 'center', color: C.muted }}>
                <FiAward size={24} style={{ marginBottom: 8 }} /><br />Loading your competitiveness scores…
            </div>
        );
    }

    if (scores.length === 0) {
        return (
            <div style={{ padding: 24 }}>
                <h1 style={{ fontSize: 24, fontWeight: 800, color: C.fg, margin: '0 0 8px' }}>🏆 Competitiveness Score</h1>
                <p style={{ color: C.muted, fontSize: 14 }}>No comparable items found in the marketplace yet. Scores will appear as more vendors list similar items.</p>
            </div>
        );
    }

    const selected = scores[selectedIdx] || scores[0];
    const sl = scoreLabel(selected.finalScore);
    const suggestions = getImprovementSuggestions(selected);
    const fb = selected.factorBreakdown;
    const avgScore = Math.round(scores.reduce((a, r) => a + r.finalScore, 0) / scores.length);
    const avgSl = scoreLabel(avgScore);

    // Score trend — requires historical data collection over time
    const base = selected.finalScore;
    const trend = [
        { week: 'W1', score: base },
        { week: 'W2', score: base },
        { week: 'W3', score: base },
        { week: 'W4', score: base },
    ];
    const trendDelta = 0; // Will show real delta once vendorScores are collected over multiple weeks

    const factors = [
        { label: 'Price Competitiveness', value: fb.price, max: 40, color: C.green },
        { label: 'Reliability', value: fb.reliability, max: 25, color: C.blue },
        { label: 'Demand Match', value: fb.demandMatch, max: 15, color: C.amber },
        { label: 'Availability', value: fb.availability, max: 10, color: C.green },
        { label: 'Bundle Completeness', value: fb.bundle, max: 5, color: C.purple },
        { label: 'Response Speed', value: fb.response, max: 5, color: C.cyan },
    ];

    return (
        <div style={{ padding: 24, paddingBottom: 100 }}>
            {/* HEADER */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 16, marginBottom: 24 }}>
                <div>
                    <h1 style={{ margin: 0, fontSize: 24, fontWeight: 800, color: C.fg }}>🏆 Competitiveness Score</h1>
                    <p style={{ margin: '4px 0 0', color: C.muted, fontSize: 13 }}>
                        See how your items rank in the marketplace and how to improve.
                    </p>
                </div>
                <button onClick={() => { fetchData(); toast.success('Scores refreshed'); }} style={{
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
                    <div style={{ fontSize: 28, fontWeight: 800, color: avgSl.color, lineHeight: 1 }}>{avgScore}</div>
                    <div style={{ fontSize: 11, color: C.muted, marginTop: 6 }}>Your Avg Score</div>
                </div>
                <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 12, padding: '16px 18px' }}>
                    <div style={{ fontSize: 28, fontWeight: 800, color: C.green, lineHeight: 1 }}>{Math.max(...scores.map(s => s.finalScore))}</div>
                    <div style={{ fontSize: 11, color: C.muted, marginTop: 6 }}>Best Item Score</div>
                </div>
                <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 12, padding: '16px 18px' }}>
                    <div style={{ fontSize: 28, fontWeight: 800, color: scores.filter(s => s.finalScore >= 75).length > 0 ? C.blue : C.amber, lineHeight: 1 }}>{scores.filter(s => s.finalScore >= 75).length}</div>
                    <div style={{ fontSize: 11, color: C.muted, marginTop: 6 }}>Strong+ Items</div>
                </div>
                <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 12, padding: '16px 18px' }}>
                    <div style={{ fontSize: 28, fontWeight: 800, color: trendDelta >= 0 ? C.green : C.red, lineHeight: 1, display: 'flex', alignItems: 'center', gap: 4 }}>
                        {trendDelta >= 0 ? <FiTrendingUp size={22} /> : <FiTrendingDown size={22} />}
                        {trendDelta >= 0 ? '+' : ''}{trendDelta}
                    </div>
                    <div style={{ fontSize: 11, color: C.muted, marginTop: 6 }}>4-Week Change</div>
                </div>
            </div>

            {/* ITEM SELECTOR */}
            {scores.length > 1 && (
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 20 }}>
                    {scores.map((s, i) => {
                        const isl = scoreLabel(s.finalScore);
                        return (
                            <button key={i} onClick={() => setSelectedIdx(i)} style={{
                                padding: '8px 16px', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer',
                                background: selectedIdx === i ? `${isl.color}22` : 'rgba(255,255,255,0.04)',
                                color: selectedIdx === i ? isl.color : C.muted,
                                border: `1px solid ${selectedIdx === i ? `${isl.color}44` : 'rgba(255,255,255,0.1)'}`,
                            }}>
                                {s.itemName} — <strong>{s.finalScore}</strong>
                            </button>
                        );
                    })}
                </div>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
                {/* LEFT: Score + Trend */}
                <div>
                    {/* Overall Score */}
                    <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 12, padding: 24, textAlign: 'center', marginBottom: 20 }}>
                        <div style={{ fontSize: 64, fontWeight: 900, color: sl.color, lineHeight: 1 }}>{selected.finalScore}</div>
                        <div style={{ fontSize: 16, fontWeight: 700, color: sl.color, marginTop: 6 }}>{sl.text}</div>
                        <div style={{ fontSize: 13, color: C.muted, marginTop: 10 }}>
                            You are ranked <strong style={{ color: C.fg }}>{selected._priceRank} of {selected._groupSize} vendors</strong> for <strong style={{ color: C.fg }}>{selected.itemName}</strong>
                        </div>
                    </div>

                    {/* Score Trend */}
                    <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 12, padding: 20 }}>
                        <div style={{ fontSize: 13, fontWeight: 700, color: C.blue, marginBottom: 12 }}>📈 Score Trend</div>
                        <div style={{ display: 'flex', gap: 10 }}>
                            {trend.map((t, i) => {
                                const tsl = scoreLabel(t.score);
                                return (
                                    <div key={i} style={{ flex: 1, textAlign: 'center' }}>
                                        <div style={{
                                            height: 80, display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
                                            borderRadius: 8, overflow: 'hidden', background: 'rgba(255,255,255,0.03)',
                                        }}>
                                            <div style={{
                                                width: '100%', height: `${Math.max(10, t.score)}%`,
                                                background: `${tsl.color}44`, borderRadius: '6px 6px 0 0',
                                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                fontSize: 13, fontWeight: 700, color: tsl.color,
                                            }}>
                                                {t.score}
                                            </div>
                                        </div>
                                        <div style={{ fontSize: 11, color: C.muted, marginTop: 4 }}>{t.week}</div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                </div>

                {/* RIGHT: Factor Breakdown + Improvements */}
                <div>
                    {/* Factor Breakdown */}
                    <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 12, padding: 20, marginBottom: 20 }}>
                        <div style={{ fontSize: 13, fontWeight: 700, color: C.blue, marginBottom: 12 }}>🏆 Score Breakdown</div>
                        {factors.map(f => (
                            <div key={f.label} style={{ marginBottom: 12 }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 4 }}>
                                    <span style={{ color: C.muted }}>{f.label}</span>
                                    <span style={{ fontWeight: 700, color: f.color }}>{f.value} / {f.max}</span>
                                </div>
                                <div style={{ height: 8, borderRadius: 4, background: 'rgba(255,255,255,0.06)', position: 'relative', overflow: 'hidden' }}>
                                    <div style={{ position: 'absolute', top: 0, left: 0, bottom: 0, width: `${(f.value / f.max) * 100}%`, background: f.color, borderRadius: 4 }} />
                                </div>
                            </div>
                        ))}
                    </div>

                    {/* Improvement Suggestions */}
                    {suggestions.length > 0 && (
                        <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 12, padding: 20 }}>
                            <div style={{ fontSize: 13, fontWeight: 700, color: C.amber, marginBottom: 12 }}>💡 Improve Your Score</div>
                            {suggestions.map((s, i) => (
                                <div key={i} style={{
                                    display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 10,
                                    padding: '10px 14px', background: 'rgba(255,255,255,0.02)', borderRadius: 8,
                                    border: '1px solid rgba(255,255,255,0.05)',
                                }}>
                                    <span style={{ fontSize: 18, flexShrink: 0 }}>{s.icon}</span>
                                    <div style={{ flex: 1 }}>
                                        <div style={{ fontSize: 13, color: C.fg, lineHeight: 1.4 }}>{s.text}</div>
                                        <div style={{ fontSize: 12, color: C.muted, marginTop: 3 }}>
                                            Potential gain: <span style={{ color: C.green, fontWeight: 700 }}>{s.potential}</span>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}

                    {/* Market Position */}
                    {selected._bm && (
                        <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 12, padding: 20, marginTop: 20 }}>
                            <div style={{ fontSize: 13, fontWeight: 700, color: C.blue, marginBottom: 12 }}>📊 Market Position</div>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                                <div style={{ background: 'rgba(255,255,255,0.03)', padding: '10px 14px', borderRadius: 8 }}>
                                    <div style={{ fontSize: 11, color: C.muted, marginBottom: 4 }}>Your Price</div>
                                    <div style={{ fontSize: 20, fontWeight: 800, color: C.fg }}>${selected.normalizedPrice?.toFixed(2)}</div>
                                </div>
                                <div style={{ background: 'rgba(255,255,255,0.03)', padding: '10px 14px', borderRadius: 8 }}>
                                    <div style={{ fontSize: 11, color: C.muted, marginBottom: 4 }}>Market Median</div>
                                    <div style={{ fontSize: 20, fontWeight: 800, color: C.amber }}>${selected._bm.median?.toFixed(2)}</div>
                                </div>
                                <div style={{ background: 'rgba(255,255,255,0.03)', padding: '10px 14px', borderRadius: 8 }}>
                                    <div style={{ fontSize: 11, color: C.muted, marginBottom: 4 }}>Lowest</div>
                                    <div style={{ fontSize: 16, fontWeight: 700, color: C.green }}>${selected._bm.lowest?.toFixed(2)}</div>
                                </div>
                                <div style={{ background: 'rgba(255,255,255,0.03)', padding: '10px 14px', borderRadius: 8 }}>
                                    <div style={{ fontSize: 11, color: C.muted, marginBottom: 4 }}>Highest</div>
                                    <div style={{ fontSize: 16, fontWeight: 700, color: C.red }}>${selected._bm.highest?.toFixed(2)}</div>
                                </div>
                            </div>
                            {selected.normalizedPrice > selected._bm.median && (
                                <div style={{ marginTop: 12, padding: '10px 14px', background: 'rgba(248,113,113,0.06)', border: '1px solid rgba(248,113,113,0.15)', borderRadius: 8, fontSize: 13, color: C.red }}>
                                    ⚠️ Your price is <strong>${(selected.normalizedPrice - selected._bm.median).toFixed(2)}</strong> above market median. Consider adjusting to improve your allocation score.
                                </div>
                            )}
                            {selected.normalizedPrice <= selected._bm.median && (
                                <div style={{ marginTop: 12, padding: '10px 14px', background: 'rgba(52,211,153,0.06)', border: '1px solid rgba(52,211,153,0.15)', borderRadius: 8, fontSize: 13, color: C.green }}>
                                    ✅ Your price is at or below market median — strong competitive position.
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>

            {/* Privacy note */}
            <div style={{ marginTop: 24, fontSize: 12, color: '#475569', fontStyle: 'italic', textAlign: 'center' }}>
                Scores are based on anonymous marketplace data. No competitor identities are disclosed. Scores update on price changes, dispatch confirmations, and delivery completions.
            </div>
        </div>
    );
}
