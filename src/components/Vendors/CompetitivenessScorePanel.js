/**
 * CompetitivenessScorePanel.js
 *
 * Vendor-facing insight panel showing their Competitiveness Score
 * and actionable improvement suggestions. No competitor names exposed.
 *
 * Props:
 *   itemName       — item name string
 *   vendorPrice    — current vendor price
 *   vendorId       — vendor's ID
 *   vendorItemNames — array of all item names this vendor has (for bundle check)
 */
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { db } from '../../firebase';
import { collection, getDocs } from 'firebase/firestore';
import {
    calculateCompetitivenessScore,
    scoreLabel,
    getImprovementSuggestions,
} from './vendorCompetitivenessEngine';
import { getMarketBenchmark } from './marketplaceIntelligence';
import { FiAward, FiChevronDown, FiChevronUp } from 'react-icons/fi';

const C = {
    green: '#34d399', red: '#f87171', amber: '#fbbf24', blue: '#38bdf8',
    purple: '#a78bfa', fg: '#f8fafc', muted: '#94a3b8',
};

export default function CompetitivenessScorePanel({
    itemName = '',
    vendorPrice = 0,
    vendorId = '',
    vendorItemNames = [],
    category = '',
}) {
    const [scoreRecord, setScoreRecord] = useState(null);
    const [suggestions, setSuggestions] = useState([]);
    const [loading, setLoading] = useState(false);
    const [expanded, setExpanded] = useState(false);
    const [allItems, setAllItems] = useState([]);
    const [fetched, setFetched] = useState(false);
    const debounceRef = useRef(null);

    const fetchItems = useCallback(async () => {
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
                } catch (_) {}
            }
            setAllItems(items);
            setFetched(true);
        } catch (err) { console.warn('CompetitivenessScorePanel: fetch failed', err); }
        finally { setLoading(false); }
    }, [fetched]);

    useEffect(() => {
        if (debounceRef.current) clearTimeout(debounceRef.current);
        const name = (itemName || '').trim();
        const price = parseFloat(vendorPrice) || 0;
        if (!name || price <= 0) { setScoreRecord(null); return; }

        debounceRef.current = setTimeout(async () => {
            if (!fetched) await fetchItems();
            const bm = getMarketBenchmark(name, category, allItems);
            if (!bm || bm.supplierCount === 0) { setScoreRecord(null); return; }

            const record = calculateCompetitivenessScore({
                vendorId,
                itemName: name,
                comparableGroup: name,
                normalizedPrice: price,
                lowestPrice: bm.lowest,
                medianPrice: bm.median,
                highestPrice: bm.highest,
                vendorItemNames,
                // Use default mock stats for demo — will be replaced with live data
            });
            setScoreRecord(record);
            setSuggestions(getImprovementSuggestions(record));
        }, 700);

        return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
    }, [itemName, vendorPrice, category, vendorId, vendorItemNames, allItems, fetched, fetchItems]);

    useEffect(() => {
        const name = (itemName || '').trim();
        const price = parseFloat(vendorPrice) || 0;
        if (name && price > 0 && !fetched) fetchItems();
    }, [itemName, vendorPrice, fetched, fetchItems]);

    if (!scoreRecord && !loading) return null;

    const label = scoreRecord ? scoreLabel(scoreRecord.finalScore) : null;
    const fb = scoreRecord?.factorBreakdown;

    const barStyle = (value, max, color) => ({
        height: 6, borderRadius: 3, background: 'rgba(255,255,255,0.06)',
        position: 'relative', overflow: 'hidden', flex: 1,
    });

    const fillStyle = (value, max, color) => ({
        position: 'absolute', top: 0, left: 0, bottom: 0,
        width: `${Math.min(100, (value / max) * 100)}%`,
        background: color, borderRadius: 3,
    });

    return (
        <div style={{
            marginTop: 12, background: 'rgba(167,139,250,0.04)', border: '1px solid rgba(167,139,250,0.15)',
            borderRadius: 12, overflow: 'hidden',
        }}>
            {/* Header */}
            <div
                style={{
                    padding: '12px 16px', background: 'rgba(167,139,250,0.08)',
                    borderBottom: '1px solid rgba(167,139,250,0.12)',
                    display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer',
                }}
                onClick={() => setExpanded(!expanded)}
            >
                <FiAward size={15} color="#a78bfa" />
                <span style={{ fontSize: 13, fontWeight: 700, color: '#a78bfa' }}>Your Competitiveness Score</span>
                {scoreRecord && (
                    <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
                        <span style={{ fontSize: 20, fontWeight: 800, color: label.color }}>{scoreRecord.finalScore}</span>
                        <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 6, background: `${label.color}22`, color: label.color }}>
                            {label.text}
                        </span>
                        {expanded ? <FiChevronUp size={16} color={C.muted} /> : <FiChevronDown size={16} color={C.muted} />}
                    </div>
                )}
                {loading && <span style={{ fontSize: 11, color: C.muted, marginLeft: 'auto' }}>Calculating…</span>}
            </div>

            {/* Expanded content */}
            {expanded && scoreRecord && (
                <div style={{ padding: '14px 16px' }}>
                    {/* Factor breakdown bars */}
                    <div style={{ fontSize: 11, fontWeight: 700, color: C.blue, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 }}>
                        Score Breakdown
                    </div>
                    {[
                        { label: 'Price Position',      value: fb.price,        max: 40, color: C.green },
                        { label: 'Reliability',          value: fb.reliability,  max: 25, color: C.blue },
                        { label: 'Demand Match',         value: fb.demandMatch,  max: 15, color: C.amber },
                        { label: 'Availability',         value: fb.availability, max: 10, color: C.green },
                        { label: 'Bundle Completeness',  value: fb.bundle,       max: 5,  color: C.purple },
                        { label: 'Response Speed',       value: fb.response,     max: 5,  color: C.blue },
                    ].map(f => (
                        <div key={f.label} style={{ marginBottom: 8 }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 3 }}>
                                <span style={{ color: C.muted }}>{f.label}</span>
                                <span style={{ fontWeight: 700, color: f.color }}>{f.value}/{f.max}</span>
                            </div>
                            <div style={barStyle(f.value, f.max, f.color)}>
                                <div style={fillStyle(f.value, f.max, f.color)} />
                            </div>
                        </div>
                    ))}

                    {/* Improvement suggestions */}
                    {suggestions.length > 0 && (
                        <div style={{ marginTop: 16, borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: 14 }}>
                            <div style={{ fontSize: 11, fontWeight: 700, color: C.amber, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 }}>
                                💡 Improve Your Score
                            </div>
                            {suggestions.slice(0, 3).map((s, i) => (
                                <div key={i} style={{
                                    display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 8,
                                    padding: '8px 12px', background: 'rgba(255,255,255,0.02)', borderRadius: 8,
                                    border: '1px solid rgba(255,255,255,0.05)',
                                }}>
                                    <span style={{ fontSize: 16, flexShrink: 0 }}>{s.icon}</span>
                                    <div style={{ flex: 1 }}>
                                        <div style={{ fontSize: 12, color: C.fg, lineHeight: 1.4 }}>{s.text}</div>
                                        <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>
                                            Potential gain: <span style={{ color: C.green, fontWeight: 700 }}>{s.potential}</span>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}

                    {/* Privacy note */}
                    <div style={{ fontSize: 11, color: '#64748b', marginTop: 12, fontStyle: 'italic' }}>
                        Score based on anonymous marketplace data. No competitor identities are disclosed.
                    </div>
                </div>
            )}
        </div>
    );
}
