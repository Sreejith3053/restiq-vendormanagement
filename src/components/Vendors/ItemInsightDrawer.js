/**
 * ItemInsightDrawer.js
 *
 * Right-side drawer showing a vendor's full anonymous market benchmark
 * for a single item. Opened from the benchmark table "View Insight" action.
 *
 * PRIVACY: Only anonymous market aggregates are shown — never competitor names.
 */
import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

const C = {
    bg:     '#0d1520',
    card:   '#131d2e',
    border: 'rgba(255,255,255,0.07)',
    fg:     '#f8fafc',
    muted:  '#64748b',
    sub:    '#94a3b8',
    green:  '#34d399',
    blue:   '#38bdf8',
    amber:  '#fbbf24',
    red:    '#f87171',
    purple: '#a78bfa',
    orange: '#f97316',
};

// ── Mini components ───────────────────────────────────────────────────────────
function Card({ children, style = {} }) {
    return (
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: '16px 18px', ...style }}>
            {children}
        </div>
    );
}

function SectionLabel({ children, color = C.blue }) {
    return (
        <div style={{ fontSize: 11, fontWeight: 700, color, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 12 }}>
            {children}
        </div>
    );
}

function ScoreBar({ value, max = 1, color = C.blue, label, pctLabel }) {
    const pct = Math.min(100, Math.max(0, (value / max) * 100));
    return (
        <div style={{ marginBottom: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: C.sub, marginBottom: 4 }}>
                <span>{label}</span>
                <span style={{ color, fontWeight: 700 }}>{pctLabel || `${Math.round(pct)}%`}</span>
            </div>
            <div style={{ height: 6, background: 'rgba(255,255,255,0.06)', borderRadius: 3, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${pct}%`, background: color, borderRadius: 3, transition: 'width 0.4s' }} />
            </div>
        </div>
    );
}

function RecCard({ rec }) {
    const typeColor = rec.type === 'error' ? C.red : rec.type === 'warning' ? C.amber : rec.type === 'success' ? C.green : C.blue;
    const typeBg    = rec.type === 'error' ? 'rgba(248,113,113,0.07)' : rec.type === 'warning' ? 'rgba(251,191,36,0.07)' : rec.type === 'success' ? 'rgba(52,211,153,0.07)' : 'rgba(56,189,248,0.07)';
    return (
        <div style={{
            padding: '10px 14px', borderRadius: 10,
            background: typeBg, border: `1px solid ${typeColor}22`,
            marginBottom: 8,
        }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                <span style={{ fontSize: 17, flexShrink: 0, marginTop: 1 }}>{rec.icon}</span>
                <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, color: typeColor, fontWeight: 600, lineHeight: 1.4 }}>{rec.text}</div>
                    {rec.detail && <div style={{ fontSize: 12, color: C.sub, marginTop: 4, lineHeight: 1.4 }}>{rec.detail}</div>}
                </div>
                {rec.impact && rec.impact !== 'info' && (
                    <span style={{
                        fontSize: 10, fontWeight: 700, color: typeColor,
                        background: typeBg, border: `1px solid ${typeColor}33`,
                        borderRadius: 5, padding: '2px 6px', flexShrink: 0,
                    }}>
                        {rec.impact.toUpperCase()}
                    </span>
                )}
            </div>
        </div>
    );
}

function StatBlock({ label, value, color = C.fg, sub }) {
    return (
        <div style={{ background: 'rgba(255,255,255,0.03)', borderRadius: 8, padding: '10px 12px', textAlign: 'center' }}>
            <div style={{ fontSize: 11, color: C.muted, marginBottom: 4 }}>{label}</div>
            <div style={{ fontSize: 17, fontWeight: 800, color }}>{value}</div>
            {sub && <div style={{ fontSize: 11, color: C.sub, marginTop: 2 }}>{sub}</div>}
        </div>
    );
}

// ── Main drawer ───────────────────────────────────────────────────────────────
export default function ItemInsightDrawer({ record, onClose }) {
    const navigate = useNavigate();

    useEffect(() => {
        const handler = e => { if (e.key === 'Escape') onClose(); };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [onClose]);

    if (!record) return null;

    const {
        itemName, itemDocId, category, baseUnit,
        vendorUnitPrice, marketBest, marketMedian,
        deltaBest, deltaMedian, absBest, absMedian,
        positionBand, confidence, percentile,
        confidencePct, priceRank, totalVendors,
        monthlyUsage, demandTier,
        availabilityScore, responseScore, reliabilityScore, capacityScore,
        hasFreshPrice, hasPackSize,
        recommendations, demandGain,
        isComparable,
    } = record;

    const fmtDelta = (pct, abs) => {
        if (pct === null) return '—';
        const sign = pct >= 0 ? '+' : '';
        const absStr = abs !== null ? ` ($${Math.abs(abs).toFixed(4)}/${baseUnit || 'unit'})` : '';
        return `${sign}${pct}%${absStr}`;
    };

    const demandColor = demandTier === 'high' ? C.green : demandTier === 'medium' ? C.blue : C.muted;

    return (
        <>
            {/* Backdrop */}
            <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000 }} />

            {/* Drawer */}
            <div style={{
                position: 'fixed', top: 0, right: 0, bottom: 0,
                width: Math.min(680, window.innerWidth * 0.92),
                background: C.bg, borderLeft: `1px solid ${C.border}`,
                zIndex: 1001, overflowY: 'auto',
                padding: '28px 26px 80px',
                display: 'flex', flexDirection: 'column', gap: 18,
            }}>

                {/* ── Header ── */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 6 }}>
                            <h2 style={{ margin: 0, fontSize: 19, fontWeight: 800, color: C.fg }}>{itemName}</h2>
                            <span style={{
                                fontSize: 11, fontWeight: 700, color: positionBand.color,
                                background: positionBand.bg, border: `1px solid ${positionBand.color}33`,
                                borderRadius: 6, padding: '2px 9px',
                            }}>
                                {positionBand.icon} {positionBand.label}
                            </span>
                        </div>
                        <div style={{ fontSize: 12, color: C.muted, display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                            <span>📂 {category || '—'}</span>
                            {baseUnit && <span>📐 Per {baseUnit}</span>}
                            <span style={{ color: confidence.color }}>
                                🎯 {confidence.label} confidence ({confidencePct}%)
                            </span>
                            {demandTier && (
                                <span style={{ color: demandColor }}>
                                    📈 {demandTier.charAt(0).toUpperCase() + demandTier.slice(1)} demand
                                </span>
                            )}
                        </div>
                    </div>
                    <button onClick={onClose} style={{
                        background: 'rgba(255,255,255,0.06)', border: `1px solid ${C.border}`,
                        borderRadius: 8, color: C.muted, fontSize: 18, cursor: 'pointer', padding: '4px 10px', flexShrink: 0,
                    }}>✕</button>
                </div>

                {/* ── Price Position Block ── */}
                <Card>
                    <SectionLabel color={C.blue}>Price Position</SectionLabel>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 14 }}>
                        <StatBlock label="Your Price" value={vendorUnitPrice != null ? `$${vendorUnitPrice.toFixed(4)}` : '—'}
                            sub={baseUnit ? `per ${baseUnit}` : undefined} />
                        <StatBlock label="Market Best (Anonymous)" color={C.green}
                            value={marketBest != null ? `$${marketBest.toFixed(4)}` : '—'}
                            sub={deltaMedian !== null ? fmtDelta(deltaBest, absBest) : undefined} />
                        <StatBlock label="Market Median (Anonymous)" color={C.amber}
                            value={marketMedian != null ? `$${marketMedian.toFixed(4)}` : '—'}
                            sub={deltaMedian !== null ? fmtDelta(deltaMedian, absMedian) : undefined} />
                    </div>

                    {/* Visual position bar */}
                    {isComparable && marketBest != null && marketMedian != null && vendorUnitPrice != null && (
                        <div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: C.muted, marginBottom: 3 }}>
                                <span>Market Best</span>
                                <span>Market Median</span>
                            </div>
                            <div style={{ height: 10, background: 'rgba(255,255,255,0.06)', borderRadius: 5, position: 'relative', overflow: 'hidden' }}>
                                <div style={{ position: 'absolute', top: 0, left: 0, bottom: 0, width: '50%', background: 'linear-gradient(90deg, rgba(52,211,153,0.35), rgba(251,191,36,0.35)', borderRadius: '5px 0 0 5px' }} />
                                {(() => {
                                    const span    = Math.max(0.0001, (marketMedian - marketBest) * 2);
                                    const rawPct  = Math.max(0, Math.min(100, ((vendorUnitPrice - marketBest) / span) * 100));
                                    const dotColor = positionBand.color;
                                    return (
                                        <div title="Your price" style={{
                                            position: 'absolute', top: '50%', left: `${rawPct}%`,
                                            transform: 'translate(-50%, -50%)',
                                            width: 14, height: 14, borderRadius: '50%',
                                            background: dotColor, border: '2px solid #0d1520',
                                        }} />
                                    );
                                })()}
                            </div>
                            <div style={{ fontSize: 10, color: C.muted, marginTop: 4 }}>{positionBand.description}</div>
                        </div>
                    )}
                </Card>

                {/* ── Market Position Block ── */}
                {percentile && (
                    <Card>
                        <SectionLabel color={C.purple}>Market Position</SectionLabel>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px',
                            background: percentile.positive ? 'rgba(52,211,153,0.07)' : 'rgba(248,113,113,0.07)',
                            border: `1px solid ${percentile.positive ? 'rgba(52,211,153,0.2)' : 'rgba(248,113,113,0.2)'}`,
                            borderRadius: 10 }}>
                            <span style={{ fontSize: 22 }}>{percentile.icon}</span>
                            <div>
                                <div style={{ fontSize: 14, fontWeight: 700, color: percentile.positive ? C.green : C.amber }}>
                                    {percentile.label}
                                </div>
                                {priceRank && totalVendors && (
                                    <div style={{ fontSize: 12, color: C.sub, marginTop: 2 }}>
                                        Ranked #{priceRank} out of {totalVendors} market suppliers (anonymous)
                                    </div>
                                )}
                            </div>
                        </div>
                        {demandTier && (
                            <div style={{ marginTop: 10, fontSize: 12, color: C.sub }}>
                                Demand tier: <span style={{ color: demandColor, fontWeight: 700 }}>
                                    {demandTier.charAt(0).toUpperCase() + demandTier.slice(1)}
                                </span>
                                {monthlyUsage > 0 && <span> — ~{Math.round(monthlyUsage)} units/month across marketplace</span>}
                            </div>
                        )}
                    </Card>
                )}

                {/* ── Anonymous Performance Block ── */}
                {(reliabilityScore !== null || responseScore !== null || availabilityScore !== null) && (
                    <Card>
                        <SectionLabel color={C.blue}>Your Operational Performance</SectionLabel>
                        {reliabilityScore !== null && (
                            <ScoreBar label="Reliability" value={reliabilityScore}
                                color={reliabilityScore >= 0.8 ? C.green : reliabilityScore >= 0.6 ? C.amber : C.red}
                                pctLabel={`${(reliabilityScore * 100).toFixed(0)}%`} />
                        )}
                        {availabilityScore !== null && (
                            <ScoreBar label="Availability Consistency" value={availabilityScore}
                                color={availabilityScore >= 0.85 ? C.green : availabilityScore >= 0.65 ? C.amber : C.red}
                                pctLabel={`${(availabilityScore * 100).toFixed(0)}%`} />
                        )}
                        {responseScore !== null && (
                            <ScoreBar label="Response Speed" value={responseScore}
                                color={responseScore >= 0.8 ? C.green : responseScore >= 0.6 ? C.amber : C.red}
                                pctLabel={`${(responseScore * 100).toFixed(0)}%`} />
                        )}
                        {capacityScore === null && (
                            <div style={{ marginTop: 6, fontSize: 12, color: C.muted, fontStyle: 'italic' }}>
                                📋 No capacity data — update weekly capacity to improve allocation readiness
                            </div>
                        )}
                    </Card>
                )}

                {/* ── Recommendations ── */}
                {recommendations.length > 0 && (
                    <Card>
                        <SectionLabel color={C.amber}>Actionable Recommendations</SectionLabel>
                        {recommendations.map((rec, i) => <RecCard key={i} rec={rec} />)}
                    </Card>
                )}

                {/* ── Demand Gain / Potential Impact ── */}
                {demandGain?.available && (
                    <Card>
                        <SectionLabel color={C.green}>Potential Opportunity</SectionLabel>
                        <div style={{
                            padding: '12px 14px', borderRadius: 10,
                            background: demandGain.type === 'strong' ? 'rgba(52,211,153,0.08)' : demandGain.type === 'risk' ? 'rgba(248,113,113,0.08)' : 'rgba(56,189,248,0.08)',
                            border: `1px solid ${demandGain.type === 'strong' ? 'rgba(52,211,153,0.2)' : demandGain.type === 'risk' ? 'rgba(248,113,113,0.2)' : 'rgba(56,189,248,0.2)'}`,
                        }}>
                            <div style={{ fontSize: 14, fontWeight: 700, color: demandGain.type === 'strong' ? C.green : demandGain.type === 'risk' ? C.red : C.blue }}>
                                {demandGain.type === 'strong' ? '✅' : demandGain.type === 'risk' ? '⚠️' : '💡'} {demandGain.message}
                            </div>
                            {demandGain.subtext && (
                                <div style={{ fontSize: 12, color: C.sub, marginTop: 6 }}>{demandGain.subtext}</div>
                            )}
                            {demandGain.savingsAtBest > 0 && (
                                <div style={{ marginTop: 10, display: 'flex', gap: 10 }}>
                                    <div style={{ background: 'rgba(52,211,153,0.1)', borderRadius: 8, padding: '8px 14px', textAlign: 'center' }}>
                                        <div style={{ fontSize: 16, fontWeight: 800, color: C.green }}>${demandGain.savingsAtBest.toFixed(2)}</div>
                                        <div style={{ fontSize: 10, color: C.muted, marginTop: 2 }}>Monthly opportunity</div>
                                    </div>
                                    <div style={{ background: 'rgba(52,211,153,0.1)', borderRadius: 8, padding: '8px 14px', textAlign: 'center' }}>
                                        <div style={{ fontSize: 16, fontWeight: 800, color: C.green }}>${(demandGain.savingsAtBest * 12).toFixed(0)}</div>
                                        <div style={{ fontSize: 10, color: C.muted, marginTop: 2 }}>Annual opportunity</div>
                                    </div>
                                </div>
                            )}
                        </div>
                        <div style={{ marginTop: 10, fontSize: 11, color: C.muted, fontStyle: 'italic' }}>
                            These are estimates based on current market data. Actual demand change may vary.
                        </div>
                    </Card>
                )}

                {/* ── Warnings Block ── */}
                {(!hasPackSize || hasFreshPrice === false || !isComparable) && (
                    <Card>
                        <SectionLabel color={C.orange}>Data Quality Warnings</SectionLabel>
                        {!hasPackSize && (
                            <WarningRow icon="📦" text="Pack size not specified" detail="Add pack size to enable accurate unit-level comparison" />
                        )}
                        {hasFreshPrice === false && (
                            <WarningRow icon="🕐" text="Price may be stale" detail="Update your price to maintain market trust and score accuracy" />
                        )}
                        {!isComparable && (
                            <WarningRow icon="🔍" text="Low or no comparison data" detail="This item may not yet have enough market data for reliable benchmarking" />
                        )}
                        {capacityScore === null && (
                            <WarningRow icon="📋" text="Missing capacity data" detail="Add weekly capacity to improve allocation eligibility" />
                        )}
                    </Card>
                )}

                {/* ── CTAs ── */}
                <Card>
                    <SectionLabel>Quick Actions</SectionLabel>
                    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                        <CTAButton label="✏️ Edit Item" color={C.blue}
                            onClick={() => navigate(`/dispatcher?editItem=${itemDocId}`)} />
                        <CTAButton label="📦 Open Catalog" color={C.purple}
                            onClick={() => navigate(`/dashboard?tab=catalog`)} />
                        <CTAButton label="🛡️ Update Capacity" color={C.amber}
                            onClick={() => navigate(`/dashboard?tab=capacity`)} />
                        <CTAButton label="🏆 My Score" color={C.green}
                            onClick={() => { onClose(); }} />
                    </div>
                </Card>

                {/* ── Privacy notice ── */}
                <div style={{ fontSize: 11, color: '#374151', fontStyle: 'italic', textAlign: 'center', marginTop: 4 }}>
                    All market data is anonymous. No competitor names, item lists, or vendor identities are shown.
                </div>
            </div>
        </>
    );
}

function WarningRow({ icon, text, detail }) {
    return (
        <div style={{ display: 'flex', gap: 10, padding: '8px 12px', marginBottom: 8,
            background: 'rgba(249,115,22,0.06)', border: '1px solid rgba(249,115,22,0.15)',
            borderRadius: 8 }}>
            <span style={{ fontSize: 16, flexShrink: 0 }}>{icon}</span>
            <div>
                <div style={{ fontSize: 13, color: '#f97316', fontWeight: 600 }}>{text}</div>
                {detail && <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 2 }}>{detail}</div>}
            </div>
        </div>
    );
}

function CTAButton({ label, color, onClick }) {
    return (
        <button onClick={onClick} style={{
            padding: '9px 16px', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer',
            background: `${color}15`, color, border: `1px solid ${color}33`,
        }}
        onMouseEnter={e => { e.currentTarget.style.background = `${color}25`; }}
        onMouseLeave={e => { e.currentTarget.style.background = `${color}15`; }}>
            {label}
        </button>
    );
}
