/**
 * MarketBenchmarkBlock.js
 *
 * Privacy-safe anonymous market insight section for vendor-facing pages.
 * Shows vendor's own performance vs anonymous market benchmarks.
 *
 * RULES:
 * - Never exposes competitor names, IDs, or exact prices
 * - Only shows own price, market-best delta, market-median delta, and rank band
 */
import React from 'react';
import { getAnonymousRankBand, getAnonymousMarketInsight } from './vendorComparisonEngine';

const C = {
    card:   '#131d2e',
    border: 'rgba(255,255,255,0.07)',
    fg:     '#f8fafc',
    muted:  '#64748b',
    sub:    '#94a3b8',
    green:  '#34d399',
    amber:  '#fbbf24',
    red:    '#f87171',
    blue:   '#38bdf8',
};

/**
 * Props:
 *  - vendorUnitPrice  {number}  vendor's normalized unit price for this item
 *  - marketBest       {number}  anonymous lowest price in market
 *  - marketMedian     {number}  anonymous median price in market
 *  - baseUnit         {string}  e.g. 'lb', 'ea'
 *  - priceRank        {number}  vendor's rank (1 = cheapest)
 *  - totalVendors     {number}  total vendors for this item
 *  - itemName         {string}
 */
export default function MarketBenchmarkBlock({
    vendorUnitPrice,
    marketBest,
    marketMedian,
    baseUnit = 'unit',
    priceRank,
    totalVendors,
    itemName,
}) {
    if (!vendorUnitPrice || !marketBest || !marketMedian) return null;

    const rankBand = getAnonymousRankBand(priceRank, totalVendors);
    const insights = getAnonymousMarketInsight({ vendorUnitPrice, marketBest, marketMedian, baseUnit });
    const aboveBest = vendorUnitPrice - marketBest;
    const aboveMed  = vendorUnitPrice - marketMedian;
    const isCompetitive = vendorUnitPrice <= marketMedian;

    return (
        <div style={{
            background: C.card, border: `1px solid ${C.border}`,
            borderRadius: 12, padding: 20, marginTop: 20,
        }}>
            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                <div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: C.blue }}>📊 Anonymous Market Benchmark</div>
                    {itemName && <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>{itemName}</div>}
                </div>
                {rankBand && (
                    <span style={{
                        fontSize: 11, fontWeight: 700,
                        color: isCompetitive ? C.green : C.amber,
                        background: isCompetitive ? 'rgba(52,211,153,0.12)' : 'rgba(251,191,36,0.12)',
                        border: `1px solid ${isCompetitive ? 'rgba(52,211,153,0.3)' : 'rgba(251,191,36,0.3)'}`,
                        borderRadius: 6, padding: '3px 10px',
                    }}>
                        {rankBand}
                    </span>
                )}
            </div>

            {/* Price comparison blocks */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 14 }}>
                <div style={{ background: 'rgba(255,255,255,0.03)', borderRadius: 8, padding: '10px 12px', textAlign: 'center' }}>
                    <div style={{ fontSize: 11, color: C.muted, marginBottom: 4 }}>Your Price</div>
                    <div style={{ fontSize: 18, fontWeight: 800, color: C.fg }}>${vendorUnitPrice.toFixed(4)}<span style={{ fontSize: 11, fontWeight: 400, color: C.muted }}>/{baseUnit}</span></div>
                </div>
                <div style={{ background: 'rgba(255,255,255,0.03)', borderRadius: 8, padding: '10px 12px', textAlign: 'center' }}>
                    <div style={{ fontSize: 11, color: C.muted, marginBottom: 4 }}>Market Best</div>
                    <div style={{ fontSize: 18, fontWeight: 800, color: C.green }}>${marketBest.toFixed(4)}<span style={{ fontSize: 11, fontWeight: 400, color: C.muted }}>/{baseUnit}</span></div>
                    {aboveBest > 0.0001 && (
                        <div style={{ fontSize: 11, color: C.red, marginTop: 2 }}>+${aboveBest.toFixed(4)} above</div>
                    )}
                </div>
                <div style={{ background: 'rgba(255,255,255,0.03)', borderRadius: 8, padding: '10px 12px', textAlign: 'center' }}>
                    <div style={{ fontSize: 11, color: C.muted, marginBottom: 4 }}>Market Median</div>
                    <div style={{ fontSize: 18, fontWeight: 800, color: C.amber }}>${marketMedian.toFixed(4)}<span style={{ fontSize: 11, fontWeight: 400, color: C.muted }}>/{baseUnit}</span></div>
                    <div style={{ fontSize: 11, color: aboveMed > 0 ? C.amber : C.green, marginTop: 2 }}>
                        {aboveMed > 0 ? `+$${aboveMed.toFixed(4)} above` : `$${Math.abs(aboveMed).toFixed(4)} below`}
                    </div>
                </div>
            </div>

            {/* Visual position bar */}
            <div style={{ marginBottom: 14 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: C.muted, marginBottom: 4 }}>
                    <span>Market Best</span>
                    <span>Market Median</span>
                    <span>Market High</span>
                </div>
                {/* Simplified bar — shows position relative to spread if we had highest */}
                <div style={{ height: 8, background: 'rgba(255,255,255,0.06)', borderRadius: 4, position: 'relative' }}>
                    <div style={{
                        position: 'absolute', top: 0, bottom: 0,
                        left: 0, width: '50%',
                        background: 'linear-gradient(90deg, rgba(52,211,153,0.3), rgba(251,191,36,0.3))',
                        borderRadius: 4,
                    }} />
                    {/* Vendor marker */}
                    {(() => {
                        const pct = Math.min(100, Math.max(0, ((vendorUnitPrice - marketBest) / Math.max(0.0001, marketMedian - marketBest)) * 50));
                        return (
                            <div style={{
                                position: 'absolute', top: -3, left: `${pct}%`, transform: 'translateX(-50%)',
                                width: 14, height: 14, borderRadius: '50%',
                                background: isCompetitive ? C.green : C.amber,
                                border: '2px solid #0d1520',
                            }} title="Your position" />
                        );
                    })()}
                </div>
            </div>

            {/* Insight messages */}
            {insights.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {insights.map((msg, i) => (
                        <div key={i} style={{
                            padding: '8px 12px', borderRadius: 8, fontSize: 12,
                            background: i === 0 && aboveBest > 0 ? 'rgba(248,113,113,0.06)' : 'rgba(52,211,153,0.06)',
                            border: `1px solid ${i === 0 && aboveBest > 0 ? 'rgba(248,113,113,0.15)' : 'rgba(52,211,153,0.15)'}`,
                            color: i === 0 && aboveBest > 0 ? C.amber : C.green,
                        }}>
                            {i === 0 && aboveBest > 0 ? '⚠️' : '✅'} {msg}
                        </div>
                    ))}
                </div>
            )}

            {/* Privacy disclaimer */}
            <div style={{ marginTop: 12, fontSize: 11, color: '#334155', fontStyle: 'italic' }}>
                Market data is anonymous. No competitor names or identities are disclosed.
            </div>
        </div>
    );
}
