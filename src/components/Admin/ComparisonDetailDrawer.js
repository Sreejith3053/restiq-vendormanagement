/**
 * ComparisonDetailDrawer.js
 *
 * Right-side drawer showing detailed per-item vendor comparison.
 * Opens when SuperAdmin clicks "View Comparison" in the comparison table.
 * Lazy-loads data only when opened.
 */
import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { BADGE_CONFIG, calcSavings } from '../Vendors/vendorComparisonEngine';

const C = {
    bg:      '#0d1520',
    card:    '#131d2e',
    border:  'rgba(255,255,255,0.07)',
    fg:      '#f8fafc',
    muted:   '#64748b',
    sub:     '#94a3b8',
    green:   '#34d399',
    blue:    '#38bdf8',
    amber:   '#fbbf24',
    red:     '#f87171',
    purple:  '#a78bfa',
};

// ── Reusable mini-components ──────────────────────────────────────────────────

function Card({ children, style = {} }) {
    return (
        <div style={{
            background: C.card, border: `1px solid ${C.border}`,
            borderRadius: 12, padding: '16px 18px', ...style,
        }}>
            {children}
        </div>
    );
}

function SectionLabel({ children, color = C.blue }) {
    return (
        <div style={{ fontSize: 11, fontWeight: 700, color, textTransform: 'uppercase',
            letterSpacing: 0.8, marginBottom: 12 }}>
            {children}
        </div>
    );
}

function Badge({ badge }) {
    const cfg = BADGE_CONFIG[badge] || { label: badge, color: C.muted, bg: 'rgba(100,116,139,0.12)' };
    return (
        <span style={{
            fontSize: 11, fontWeight: 700, color: cfg.color,
            background: cfg.bg, border: `1px solid ${cfg.color}33`,
            borderRadius: 6, padding: '2px 8px',
        }}>
            {cfg.label}
        </span>
    );
}

function ScoreBar({ value, max = 1, color = C.blue }) {
    const pct = Math.min(100, Math.max(0, (value / max) * 100));
    return (
        <div style={{ height: 6, background: 'rgba(255,255,255,0.06)', borderRadius: 3, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${pct}%`, background: color, borderRadius: 3, transition: 'width 0.3s' }} />
        </div>
    );
}

function WarningTag({ text }) {
    return (
        <div style={{
            display: 'flex', alignItems: 'flex-start', gap: 8,
            padding: '8px 12px', borderRadius: 8,
            background: 'rgba(251,191,36,0.06)', border: '1px solid rgba(251,191,36,0.15)',
            fontSize: 12, color: C.amber, marginBottom: 8,
        }}>
            <span style={{ flexShrink: 0 }}>⚠️</span>
            <span>{text}</span>
        </div>
    );
}

function SummaryBlock({ icon, label, value, sub, color = C.fg }) {
    return (
        <div style={{
            background: 'rgba(255,255,255,0.03)', border: `1px solid ${C.border}`,
            borderRadius: 10, padding: '12px 14px',
        }}>
            <div style={{ fontSize: 18, marginBottom: 2 }}>{icon}</div>
            <div style={{ fontSize: 11, color: C.muted, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</div>
            <div style={{ fontSize: 16, fontWeight: 800, color, marginTop: 4 }}>{value}</div>
            {sub && <div style={{ fontSize: 11, color: C.sub, marginTop: 2 }}>{sub}</div>}
        </div>
    );
}

// ── Main Drawer ───────────────────────────────────────────────────────────────

export default function ComparisonDetailDrawer({ group, onClose, benchmarkMode = 'median' }) {
    const navigate = useNavigate();
    const [bMode, setBMode] = useState(benchmarkMode);
    const drawerRef = useRef(null);

    // Close on Escape
    useEffect(() => {
        const handler = (e) => { if (e.key === 'Escape') onClose(); };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [onClose]);

    if (!group) return null;

    const { itemName, baseUnit, comparability, vendors = [], stats, savings, monthlyUsage } = group;

    const benchmarkPrice = bMode === 'median' ? stats?.median : stats?.highest;
    const bestVendor     = vendors.find(v => v.rank === 1);
    const cheapestVendor = [...vendors].sort((a, b) => (a.normalizedUnitPrice || 0) - (b.normalizedUnitPrice || 0))[0];
    const reliableVendor = [...vendors].sort((a, b) => (b.reliabilityScore || 0) - (a.reliabilityScore || 0))[0];

    const modeSavings = benchmarkPrice
        ? calcSavings(benchmarkPrice, stats?.lowest || 0, monthlyUsage || 0)
        : savings;

    // Build warnings
    const warnings = [];
    if (comparability.status === 'needs-review') warnings.push(comparability.reason);
    vendors.forEach(v => {
        if (!v.packSize) warnings.push(`${v.vendorName}: pack size not specified`);
        if (v.updatedAt) {
            const ageDays = (Date.now() - new Date(v.updatedAt).getTime()) / (1000 * 60 * 60 * 24);
            if (ageDays > 60) warnings.push(`${v.vendorName}: price may be stale (${Math.round(ageDays)} days old)`);
        }
        if (!v.capacityScore) warnings.push(`${v.vendorName}: capacity data not available`);
    });

    return (
        <>
            {/* Backdrop */}
            <div onClick={onClose} style={{
                position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000,
            }} />

            {/* Drawer panel */}
            <div ref={drawerRef} style={{
                position: 'fixed', top: 0, right: 0, bottom: 0,
                width: Math.min(720, window.innerWidth * 0.9),
                background: C.bg, borderLeft: `1px solid ${C.border}`,
                zIndex: 1001, overflowY: 'auto', padding: '28px 28px 60px',
                display: 'flex', flexDirection: 'column', gap: 20,
            }}>

                {/* ── Header ── */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                            <h2 style={{ margin: 0, fontSize: 20, fontWeight: 800, color: C.fg }}>{itemName}</h2>
                            <Badge badge={comparability.status === 'comparable' ? 'best-value' : 'needs-review'} />
                        </div>
                        <div style={{ marginTop: 6, fontSize: 13, color: C.muted, display: 'flex', gap: 16 }}>
                            <span>📂 {group.category || '—'}</span>
                            <span>📐 Base unit: <strong style={{ color: C.fg }}>{baseUnit || '—'}</strong></span>
                            <span>📦 Est. monthly usage: <strong style={{ color: C.fg }}>{monthlyUsage ? `${monthlyUsage.toFixed(0)} ${baseUnit}` : 'Unknown'}</strong></span>
                        </div>
                        <div style={{ marginTop: 4, fontSize: 12, color: C.muted }}>
                            Confidence: <span style={{ color: comparability.confidence >= 80 ? C.green : comparability.confidence >= 50 ? C.amber : C.red, fontWeight: 700 }}>
                                {comparability.confidence}%
                            </span> — {comparability.reason}
                        </div>
                    </div>
                    <button onClick={onClose} style={{
                        background: 'rgba(255,255,255,0.06)', border: `1px solid ${C.border}`,
                        borderRadius: 8, color: C.muted, fontSize: 18, cursor: 'pointer',
                        padding: '4px 10px', flexShrink: 0,
                    }}>✕</button>
                </div>

                {/* ── Benchmark mode toggle ── */}
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <span style={{ fontSize: 12, color: C.muted }}>Savings benchmark:</span>
                    {['median', 'highest'].map(m => (
                        <button key={m} onClick={() => setBMode(m)} style={{
                            padding: '5px 12px', borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: 'pointer',
                            background: bMode === m ? 'rgba(56,189,248,0.15)' : 'rgba(255,255,255,0.04)',
                            color: bMode === m ? C.blue : C.muted,
                            border: `1px solid ${bMode === m ? `${C.blue}44` : 'rgba(255,255,255,0.08)'}`,
                        }}>
                            {m === 'median' ? 'Market Median' : 'Highest Price'}
                        </button>
                    ))}
                </div>

                {/* ── Summary blocks ── */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10 }}>
                    <SummaryBlock icon="💸" label="Cheapest Vendor"    color={C.green}
                        value={cheapestVendor?.vendorName || '—'}
                        sub={cheapestVendor?.normalizedUnitPrice != null ? `$${cheapestVendor.normalizedUnitPrice.toFixed(4)}/${baseUnit}` : ''} />
                    <SummaryBlock icon="⭐" label="Best Value Vendor"  color={C.blue}
                        value={bestVendor?.vendorName || '—'}
                        sub={`Score: ${bestVendor?.comparisonScore ?? '—'}/100`} />
                    <SummaryBlock icon="🛡️" label="Most Reliable"     color={C.purple}
                        value={reliableVendor?.vendorName || '—'}
                        sub={reliableVendor?.reliabilityScore != null ? `${(reliableVendor.reliabilityScore * 100).toFixed(0)}% reliability` : ''} />
                    <SummaryBlock icon="💰" label="Monthly Savings Potential" color={C.green}
                        value={modeSavings?.monthly > 0 ? `$${modeSavings.monthly.toFixed(2)}` : '$0'}
                        sub={modeSavings?.annual > 0 ? `$${modeSavings.annual.toFixed(0)}/yr potential` : 'No savings vs benchmark'} />
                </div>

                {/* ── Vendor comparison table ── */}
                <Card>
                    <SectionLabel>Vendor Comparison</SectionLabel>
                    <div style={{ overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                            <thead>
                                <tr style={{ borderBottom: `1px solid ${C.border}` }}>
                                    {['Rank', 'Vendor', 'Pack Size', 'Listed Price', 'Unit Price', 'Reliability', 'Availability', 'Response', 'Score', 'Badge'].map(h => (
                                        <th key={h} style={{ padding: '6px 8px', textAlign: 'left', color: C.muted, fontWeight: 600, fontSize: 11, whiteSpace: 'nowrap' }}>{h}</th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {vendors.map((v, i) => (
                                    <tr key={v.vendorId} style={{ borderBottom: `1px solid rgba(255,255,255,0.04)` }}>
                                        <td style={{ padding: '8px 8px', color: v.rank === 1 ? C.green : C.sub, fontWeight: 700 }}>#{v.rank}</td>
                                        <td style={{ padding: '8px 8px', color: C.fg, fontWeight: 600, whiteSpace: 'nowrap' }}>{v.vendorName}</td>
                                        <td style={{ padding: '8px 8px', color: C.sub }}>{v.packSize || '—'}</td>
                                        <td style={{ padding: '8px 8px', color: C.sub }}>${(v.price || 0).toFixed(2)}</td>
                                        <td style={{ padding: '8px 8px', fontWeight: 700, color: v.normalizedUnitPrice === stats?.lowest ? C.green : C.fg }}>
                                            {v.normalizedUnitPrice != null ? `$${v.normalizedUnitPrice.toFixed(4)}/${baseUnit}` : '—'}
                                        </td>
                                        <td style={{ padding: '8px 8px', minWidth: 80 }}>
                                            <div style={{ fontSize: 12, color: C.fg, marginBottom: 2 }}>{v.reliabilityScore != null ? `${(v.reliabilityScore * 100).toFixed(0)}%` : '—'}</div>
                                            <ScoreBar value={v.reliabilityScore || 0} color={C.purple} />
                                        </td>
                                        <td style={{ padding: '8px 8px', minWidth: 80 }}>
                                            <div style={{ fontSize: 12, color: C.fg, marginBottom: 2 }}>{v.availabilityScore != null ? `${(v.availabilityScore * 100).toFixed(0)}%` : '—'}</div>
                                            <ScoreBar value={v.availabilityScore || 0} color={C.green} />
                                        </td>
                                        <td style={{ padding: '8px 8px', minWidth: 80 }}>
                                            <div style={{ fontSize: 12, color: C.fg, marginBottom: 2 }}>{v.responseScore != null ? `${(v.responseScore * 100).toFixed(0)}%` : '—'}</div>
                                            <ScoreBar value={v.responseScore || 0} color={C.blue} />
                                        </td>
                                        <td style={{ padding: '8px 8px' }}>
                                            <span style={{ fontWeight: 800, color: v.comparisonScore >= 75 ? C.green : v.comparisonScore >= 55 ? C.amber : C.red }}>
                                                {v.comparisonScore ?? '—'}
                                            </span>
                                        </td>
                                        <td style={{ padding: '8px 8px' }}>
                                            {v.badge && <Badge badge={v.badge} />}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </Card>

                {/* ── Market stats ── */}
                {stats && (
                    <Card>
                        <SectionLabel>Market Spread</SectionLabel>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
                            {[
                                { label: 'Lowest', value: `$${stats.lowest.toFixed(4)}`, color: C.green },
                                { label: 'Median', value: `$${stats.median.toFixed(4)}`, color: C.amber },
                                { label: 'Highest', value: `$${stats.highest.toFixed(4)}`, color: C.red },
                                { label: 'Spread', value: `${stats.spread}%`, color: C.blue },
                            ].map(s => (
                                <div key={s.label} style={{ textAlign: 'center' }}>
                                    <div style={{ fontSize: 20, fontWeight: 800, color: s.color }}>{s.value}</div>
                                    <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>{s.label}</div>
                                </div>
                            ))}
                        </div>
                    </Card>
                )}

                {/* ── Savings detail ── */}
                {modeSavings && modeSavings.monthly > 0 && (
                    <Card>
                        <SectionLabel color={C.green}>Savings Potential</SectionLabel>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, textAlign: 'center' }}>
                            {[
                                { label: 'Weekly', value: `$${modeSavings.weekly.toFixed(2)}` },
                                { label: 'Monthly', value: `$${modeSavings.monthly.toFixed(2)}` },
                                { label: 'Annual', value: `$${modeSavings.annual.toFixed(0)}` },
                            ].map(s => (
                                <div key={s.label}>
                                    <div style={{ fontSize: 22, fontWeight: 800, color: C.green }}>{s.value}</div>
                                    <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>{s.label}</div>
                                </div>
                            ))}
                        </div>
                        <div style={{ marginTop: 12, fontSize: 12, color: C.muted }}>
                            Based on switching from <strong style={{ color: C.fg }}>{bMode === 'median' ? 'market median' : 'highest price'}</strong> to cheapest vendor at estimated {monthlyUsage?.toFixed(0) || '?'} {baseUnit}/month.
                        </div>
                    </Card>
                )}

                {/* ── Warnings ── */}
                {warnings.length > 0 && (
                    <Card>
                        <SectionLabel color={C.amber}>Warnings</SectionLabel>
                        {warnings.slice(0, 8).map((w, i) => <WarningTag key={i} text={w} />)}
                    </Card>
                )}

                {/* ── CTAs ── */}
                <Card>
                    <SectionLabel>Actions</SectionLabel>
                    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                        {bestVendor?.vendorId && (
                            <button onClick={() => navigate(`/vendors/${bestVendor.vendorId}`)} style={{
                                padding: '9px 16px', borderRadius: 8, fontSize: 13, fontWeight: 600,
                                background: 'rgba(56,189,248,0.12)', color: C.blue,
                                border: `1px solid ${C.blue}33`, cursor: 'pointer',
                            }}>
                                🏭 Open Best Vendor Profile
                            </button>
                        )}
                        <button onClick={() => navigate(`/catalog-reviews?tab=catalog`)} style={{
                            padding: '9px 16px', borderRadius: 8, fontSize: 13, fontWeight: 600,
                            background: 'rgba(167,139,250,0.10)', color: C.purple,
                            border: `1px solid ${C.purple}33`, cursor: 'pointer',
                        }}>
                            📦 View Catalog Item
                        </button>
                        <button onClick={() => navigate(`/orders-fulfillment?tab=submitted`)} style={{
                            padding: '9px 16px', borderRadius: 8, fontSize: 13, fontWeight: 600,
                            background: 'rgba(52,211,153,0.10)', color: C.green,
                            border: `1px solid ${C.green}33`, cursor: 'pointer',
                        }}>
                            📋 View Orders Using This Item
                        </button>
                    </div>
                </Card>
            </div>
        </>
    );
}
