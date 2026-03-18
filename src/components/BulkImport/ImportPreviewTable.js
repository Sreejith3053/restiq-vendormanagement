/**
 * ImportPreviewTable.js — v3
 *
 * Additions:
 * - high_risk_review status (orange/red) with risk reasons
 * - % price change display (e.g. +1330%)
 * - Possible Duplicate defaults to "Create as new" not "Update"
 * - Naming variant display ("matched via naming variant")
 * - Better action dropdown wording
 */
import React, { useState } from 'react';

// ── Config ─────────────────────────────────────────────────────────────────────

const STATUS_CONFIG = {
    new_item:               { label: 'New Item',          color: '#4ade80', bg: 'rgba(74,222,128,0.1)',  emoji: '✨' },
    new_possible_duplicate: { label: 'Poss. Duplicate',   color: '#fb923c', bg: 'rgba(251,146,60,0.1)',  emoji: '⚠️' },
    update_high:            { label: 'Auto Update',       color: '#38bdf8', bg: 'rgba(56,189,248,0.1)',  emoji: '✅' },
    update_medium:          { label: 'Rec. Review',       color: '#fbbf24', bg: 'rgba(251,191,36,0.1)',  emoji: '⚡' },
    high_risk_review:       { label: 'High Risk',         color: '#f97316', bg: 'rgba(249,115,22,0.12)', emoji: '🚨' },
    needs_review:           { label: 'Needs Review',      color: '#a78bfa', bg: 'rgba(167,139,250,0.1)', emoji: '🔍' },
    unchanged:              { label: 'Unchanged',         color: '#64748b', bg: 'rgba(100,116,139,0.1)', emoji: '➖' },
    error:                  { label: 'Error',             color: '#f43f5e', bg: 'rgba(244,63,94,0.1)',   emoji: '❌' },
    skip:                   { label: 'Skipped',           color: '#475569', bg: 'rgba(71,85,105,0.07)',  emoji: '⏭️' },
};

const CONFIDENCE_CONFIG = {
    high:   { label: 'High',   color: '#4ade80' },
    medium: { label: 'Medium', color: '#fbbf24' },
    low:    { label: 'Low',    color: '#f87171' },
    'n/a':  { label: '—',      color: '#475569' },
};

// ── Helpers ────────────────────────────────────────────────────────────────────

function StatusBadge({ type }) {
    const cfg = STATUS_CONFIG[type] || { label: type, color: '#94a3b8', bg: 'rgba(148,163,184,0.1)', emoji: '?' };
    return (
        <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 4,
            padding: '3px 8px', borderRadius: 6,
            fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.3,
            background: cfg.bg, color: cfg.color, whiteSpace: 'nowrap',
        }}>
            {cfg.emoji} {cfg.label}
        </span>
    );
}

function ConfidencePill({ level }) {
    const cfg = CONFIDENCE_CONFIG[level] || CONFIDENCE_CONFIG['n/a'];
    return <span style={{ fontSize: 11, color: cfg.color, fontWeight: 600 }}>● {cfg.label}</span>;
}

function PriceDeltaChip({ pct }) {
    if (pct === null || pct === undefined || isNaN(pct)) return null;
    const isPositive = pct > 0;
    const isNeutral  = Math.abs(pct) < 0.1;
    const color = isNeutral ? '#64748b' : isPositive ? '#fbbf24' : '#4ade80';
    const bg    = isNeutral ? 'rgba(100,116,139,0.1)' : isPositive ? 'rgba(251,191,36,0.12)' : 'rgba(74,222,128,0.1)';
    const sign  = pct > 0 ? '+' : '';
    return (
        <span style={{ fontSize: 10, fontWeight: 700, color, background: bg, padding: '1px 6px', borderRadius: 4, marginLeft: 5 }}>
            {sign}{pct.toFixed(1)}%
        </span>
    );
}

function CompareCell({ label, oldVal, newVal, pct }) {
    if (!oldVal && !newVal) return null;
    const changed = oldVal && newVal && String(oldVal).trim() !== String(newVal).trim();
    return (
        <div style={{ marginBottom: 4 }}>
            <span style={{ fontSize: 10, color: '#64748b', marginRight: 4 }}>{label}:</span>
            {changed ? (
                <>
                    <span style={{ fontSize: 11, color: '#f87171', textDecoration: 'line-through' }}>{oldVal}</span>
                    <span style={{ color: '#64748b', margin: '0 3px', fontSize: 10 }}>→</span>
                    <span style={{ fontSize: 11, color: '#4ade80', fontWeight: 700 }}>{newVal}</span>
                    {pct !== undefined && <PriceDeltaChip pct={pct} />}
                </>
            ) : (
                <span style={{ fontSize: 11, color: '#94a3b8' }}>{newVal || oldVal}</span>
            )}
        </div>
    );
}

// ── Action Dropdown ────────────────────────────────────────────────────────────

function ActionDropdown({ row, onRowAction }) {
    const [showPicker, setShowPicker] = useState(false);
    const ar = row.actionResult;

    // Auto rows — no picker
    if (['error', 'unchanged', 'skip'].includes(ar)) {
        return <span style={{ fontSize: 10, color: '#334155' }}>Auto</span>;
    }
    if (ar === 'update_high') {
        return <span style={{ fontSize: 10, color: '#38bdf8' }}>Auto Update ✓</span>;
    }

    // Possible duplicate — default to "Create as new" not "Update"
    if (ar === 'new_possible_duplicate') {
        return (
            <select
                defaultValue="new_item"
                onChange={e => onRowAction(row._rowNumber, 'set_action', e.target.value)}
                style={selectStyle}
            >
                <option value="new_item">✨ Create as new</option>
                <option value="update_high">✅ Update similar item</option>
                <option value="skip">⏭️ Skip</option>
            </select>
        );
    }

    // High Risk — default to Skip (user must opt-in to apply)
    if (ar === 'high_risk_review') {
        return (
            <div>
                <select
                    defaultValue="skip"
                    onChange={e => onRowAction(row._rowNumber, 'set_action', e.target.value)}
                    style={{ ...selectStyle, borderColor: 'rgba(249,115,22,0.4)', color: '#f97316' }}
                >
                    <option value="skip">⏭️ Skip (safe default)</option>
                    <option value="update_high">⚠️ Apply anyway</option>
                </select>
                <div style={{ fontSize: 9, color: '#f97316', marginTop: 2 }}>
                    Uncheck to exclude, or review first
                </div>
            </div>
        );
    }

    // Ambiguous — show candidate picker
    if ((ar === 'needs_review' || ar === 'high_risk_review') && row.ambiguousCandidates) {
        return (
            <div style={{ position: 'relative' }}>
                <button
                    onClick={() => setShowPicker(p => !p)}
                    style={{ fontSize: 10, padding: '3px 8px', borderRadius: 6, border: '1px solid rgba(167,139,250,0.4)', background: 'rgba(167,139,250,0.08)', color: '#a78bfa', cursor: 'pointer' }}
                >
                    Select match ▾
                </button>
                {showPicker && (
                    <div style={{
                        position: 'absolute', right: 0, top: 26, zIndex: 100, minWidth: 230,
                        background: '#1e293b', border: '1px solid rgba(255,255,255,0.12)',
                        borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
                    }}>
                        <div style={{ padding: '5px 10px', fontSize: 9, color: '#64748b', fontWeight: 700, borderBottom: '1px solid rgba(255,255,255,0.06)', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                            Choose Existing Item
                        </div>
                        {row.ambiguousCandidates.map(c => (
                            <div key={c.id}
                                onClick={() => { onRowAction(row._rowNumber, 'match_to', c.id); setShowPicker(false); }}
                                style={{ padding: '7px 10px', cursor: 'pointer', borderBottom: '1px solid rgba(255,255,255,0.04)' }}
                                onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.04)'}
                                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                            >
                                <div style={{ fontWeight: 600, color: '#f8fafc', fontSize: 12 }}>{c.name}</div>
                                <div style={{ fontSize: 10, color: '#64748b' }}>
                                    {[c.packSize, c.unit].filter(Boolean).join(' · ')}
                                    {c.vendorPrice !== '' && ` · $${Number(c.vendorPrice).toFixed(2)}`}
                                </div>
                            </div>
                        ))}
                        <div style={{ padding: '7px 10px', cursor: 'pointer', color: '#4ade80', fontSize: 11 }}
                            onClick={() => { onRowAction(row._rowNumber, 'create_new'); setShowPicker(false); }}>
                            ✨ Create as new item
                        </div>
                        <div style={{ padding: '7px 10px', cursor: 'pointer', color: '#f87171', fontSize: 11 }}
                            onClick={() => { onRowAction(row._rowNumber, 'skip'); setShowPicker(false); }}>
                            ⏭️ Skip this row
                        </div>
                    </div>
                )}
            </div>
        );
    }

    // Medium / high-risk — simple dropdown
    return (
        <select
            value={row._userAction || ar}
            onChange={e => onRowAction(row._rowNumber, 'set_action', e.target.value)}
            style={selectStyle}
        >
            <option value="update_high">✅ Apply update</option>
            <option value="new_item">✨ Create as new</option>
            <option value="skip">⏭️ Skip</option>
        </select>
    );
}

const selectStyle = {
    fontSize: 10, padding: '3px 5px', borderRadius: 6,
    border: '1px solid rgba(255,255,255,0.1)', background: '#1e293b',
    color: '#94a3b8', cursor: 'pointer', maxWidth: 140,
};

// ── Filter options ─────────────────────────────────────────────────────────────

const FILTER_OPTIONS = [
    { value: 'all',                 label: 'All' },
    { value: 'new_item',            label: '✨ New' },
    { value: 'update_high',         label: '✅ Auto Update' },
    { value: 'update_medium',       label: '⚡ Rec. Review' },
    { value: 'high_risk_review',    label: '🚨 High Risk' },
    { value: 'needs_review',        label: '🔍 Needs Review' },
    { value: 'new_possible_duplicate', label: '⚠️ Poss. Dup.' },
    { value: 'unchanged',           label: '➖ Unchanged' },
    { value: 'error',               label: '❌ Errors' },
];

const PAGE_SIZE = 50;

// ── Main Table ──────────────────────────────────────────────────────────────────

export default function ImportPreviewTable({ rows = [], onToggleRow, onRowAction }) {
    const [filter, setFilter] = useState('all');
    const [page, setPage] = useState(0);

    const filtered = filter === 'all' ? rows : rows.filter(r => r.actionResult === filter);
    const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
    const pageRows = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

    const thStyle = {
        padding: '8px 10px', textAlign: 'left',
        fontSize: 10, fontWeight: 700, color: '#475569',
        textTransform: 'uppercase', letterSpacing: 0.5,
        borderBottom: '1px solid rgba(255,255,255,0.06)', whiteSpace: 'nowrap',
    };
    const tdStyle = { padding: '9px 10px', fontSize: 12, verticalAlign: 'top', borderBottom: '1px solid rgba(255,255,255,0.04)' };

    return (
        <div>
            {/* Filter tabs */}
            <div style={{ display: 'flex', gap: 5, marginBottom: 12, flexWrap: 'wrap' }}>
                {FILTER_OPTIONS.map(opt => {
                    const count = opt.value === 'all' ? rows.length : rows.filter(r => r.actionResult === opt.value).length;
                    if (opt.value !== 'all' && count === 0) return null;
                    const isActive = filter === opt.value;
                    return (
                        <button key={opt.value} onClick={() => { setFilter(opt.value); setPage(0); }}
                            style={{
                                padding: '3px 10px', borderRadius: 20,
                                border: isActive ? '1px solid #38bdf8' : '1px solid rgba(255,255,255,0.09)',
                                background: isActive ? 'rgba(56,189,248,0.1)' : 'transparent',
                                color: isActive ? '#38bdf8' : '#64748b',
                                cursor: 'pointer', fontSize: 10.5, fontWeight: 600, whiteSpace: 'nowrap',
                            }}
                        >
                            {opt.label} ({count})
                        </button>
                    );
                })}
            </div>

            {/* Table */}
            <div style={{ overflowX: 'auto', borderRadius: 10, border: '1px solid rgba(255,255,255,0.06)' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', background: 'rgba(10,18,38,0.9)' }}>
                    <thead>
                        <tr style={{ background: 'rgba(255,255,255,0.015)' }}>
                            <th style={{ ...thStyle, width: 32 }}>#</th>
                            <th style={{ ...thStyle, width: 140 }}>Status</th>
                            <th style={{ ...thStyle, width: 72 }}>Conf.</th>
                            <th style={{ ...thStyle, minWidth: 150 }}>Item</th>
                            <th style={{ ...thStyle, minWidth: 200 }}>Current → New</th>
                            <th style={{ ...thStyle, minWidth: 190 }}>Reason / Risk</th>
                            <th style={{ ...thStyle, width: 145 }}>Action</th>
                            <th style={{ ...thStyle, width: 52, textAlign: 'center' }}>Incl.</th>
                        </tr>
                    </thead>
                    <tbody>
                        {pageRows.length === 0 && (
                            <tr><td colSpan={8} style={{ ...tdStyle, textAlign: 'center', color: '#334155', padding: 28 }}>No rows for this filter.</td></tr>
                        )}
                        {pageRows.map((row, idx) => {
                            const excluded  = row._excluded;
                            const isAuto    = ['unchanged', 'error', 'skip'].includes(row.actionResult);
                            const isHighRisk= row.actionResult === 'high_risk_review';

                            const existingPrice = row.existingPrice;
                            const existingPack  = row.matchedItem?.packSize || '';
                            const existingUnit  = row.matchedItem?.unit || '';

                            const rowBg = isHighRisk
                                ? 'rgba(249,115,22,0.04)'
                                : row.actionResult === 'error' ? 'rgba(244,63,94,0.03)' : 'transparent';

                            return (
                                <tr key={row._rowNumber || idx} style={{ opacity: excluded ? 0.4 : 1, background: rowBg, transition: 'opacity 0.15s' }}>

                                    {/* # */}
                                    <td style={{ ...tdStyle, color: '#334155', fontFamily: 'monospace', fontSize: 10 }}>{row._rowNumber}</td>

                                    {/* Status */}
                                    <td style={{ ...tdStyle, paddingTop: 10 }}>
                                        <StatusBadge type={row.actionResult} />
                                    </td>

                                    {/* Confidence */}
                                    <td style={{ ...tdStyle, paddingTop: 10 }}>
                                        <ConfidencePill level={row.confidence} />
                                    </td>

                                    {/* Item name */}
                                    <td style={tdStyle}>
                                        <div style={{ fontWeight: 700, color: '#f8fafc', fontSize: 13 }}>
                                            {row.itemName || <span style={{ color: '#f87171' }}>—</span>}
                                        </div>
                                        {row.category && <div style={{ fontSize: 10, color: '#475569', marginTop: 1 }}>{row.category}</div>}
                                        {row.vendorSKU && <div style={{ fontSize: 10, color: '#475569' }}>SKU: {row.vendorSKU}</div>}
                                        {row.matchedItem && normName(row.matchedItem.name) !== normName(row.itemName) && row.matchedItem && (
                                            <div style={{ fontSize: 10, color: '#a78bfa', marginTop: 3 }}>
                                                ↳ matches: "{row.matchedItem.name}"
                                            </div>
                                        )}
                                    </td>

                                    {/* Current → New */}
                                    <td style={tdStyle}>
                                        {/* New items */}
                                        {(row.actionResult === 'new_item' || row.actionResult === 'new_possible_duplicate') && (
                                            <div>
                                                <div style={{ fontSize: 12, color: '#4ade80', fontWeight: 700 }}>${Number(row.price || 0).toFixed(2)}</div>
                                                <div style={{ fontSize: 10, color: '#64748b' }}>{[row.packSize, row.unit].filter(Boolean).join(' · ') || '—'}</div>
                                                {/* Similar items warning */}
                                                {row.similarItems?.length > 0 && (
                                                    <div style={{ marginTop: 5, padding: '4px 7px', borderRadius: 5, background: 'rgba(251,146,60,0.07)', border: '1px solid rgba(251,146,60,0.18)', fontSize: 10 }}>
                                                        <div style={{ color: '#fb923c', fontWeight: 700, marginBottom: 2 }}>Similar items:</div>
                                                        {row.similarItems.map(s => (
                                                            <div key={s.id} style={{ color: '#94a3b8' }}>• {s.name} <span style={{ color: '#475569' }}>({s.similarity}%)</span></div>
                                                        ))}
                                                    </div>
                                                )}
                                            </div>
                                        )}

                                        {/* Update rows */}
                                        {['update_high', 'update_medium', 'high_risk_review'].includes(row.actionResult) && (
                                            <div>
                                                <CompareCell
                                                    label="Price"
                                                    oldVal={existingPrice !== null && existingPrice !== '' ? `$${Number(existingPrice).toFixed(2)}` : null}
                                                    newVal={row.price !== '' ? `$${Number(row.price).toFixed(2)}` : null}
                                                    pct={row.priceDeltaPct}
                                                />
                                                <CompareCell label="Pack"  oldVal={existingPack} newVal={row.packSize} />
                                                <CompareCell label="Unit"  oldVal={existingUnit} newVal={row.unit} />
                                                {row.changedFields
                                                    .filter(f => !['Price', 'Pack Size', 'Unit'].includes(f))
                                                    .map(f => <CompareCell key={f} label={f} oldVal={row.oldValues[f]} newVal={row.newValues[f]} />)
                                                }
                                                {row.changedFields.length === 0 && (
                                                    <span style={{ fontSize: 10, color: '#475569' }}>No field changes</span>
                                                )}
                                            </div>
                                        )}

                                        {/* Ambiguous */}
                                        {row.actionResult === 'needs_review' && row.ambiguousCandidates && (
                                            <div style={{ fontSize: 10, color: '#a78bfa' }}>
                                                {row.ambiguousCandidates.length} candidates:
                                                {row.ambiguousCandidates.map(c => (
                                                    <div key={c.id} style={{ color: '#64748b', marginTop: 1 }}>• {c.name} {c.packSize} {c.unit}</div>
                                                ))}
                                            </div>
                                        )}

                                        {row.actionResult === 'unchanged' && (
                                            <span style={{ fontSize: 10, color: '#334155' }}>No changes detected</span>
                                        )}
                                    </td>

                                    {/* Reason / Risk */}
                                    <td style={tdStyle}>
                                        <div style={{ fontSize: 10, color: '#64748b', lineHeight: 1.5 }}>{row.reason || '—'}</div>
                                        {/* High risk reasons */}
                                        {row.riskReasons?.map((r, i) => (
                                            <div key={i} style={{ fontSize: 10, color: '#f97316', marginTop: 3, padding: '2px 6px', background: 'rgba(249,115,22,0.08)', borderRadius: 4 }}>
                                                🚨 {r}
                                            </div>
                                        ))}
                                        {(row.errors || []).map((e, i) => (
                                            <div key={i} style={{ fontSize: 10, color: '#f87171', marginTop: 2 }}>❌ {e}</div>
                                        ))}
                                        {(row.warnings || []).map((w, i) => (
                                            <div key={i} style={{ fontSize: 10, color: '#fbbf24', marginTop: 2 }}>⚠️ {w}</div>
                                        ))}
                                    </td>

                                    {/* Action */}
                                    <td style={{ ...tdStyle, paddingTop: 9 }}>
                                        {onRowAction && <ActionDropdown row={row} onRowAction={onRowAction} />}
                                    </td>

                                    {/* Include checkbox */}
                                    <td style={{ ...tdStyle, textAlign: 'center', paddingTop: 10 }}>
                                        {isAuto ? (
                                            <span style={{ fontSize: 10, color: '#334155' }}>—</span>
                                        ) : (
                                            <input type="checkbox" checked={!excluded}
                                                onChange={() => onToggleRow?.(row._rowNumber)}
                                                style={{ width: 14, height: 14, cursor: 'pointer', accentColor: '#38bdf8' }}
                                            />
                                        )}
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 10, fontSize: 11 }}>
                    <span style={{ color: '#64748b' }}>{page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, filtered.length)} of {filtered.length}</span>
                    <div style={{ display: 'flex', gap: 8 }}>
                        <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}
                            style={{ padding: '2px 10px', borderRadius: 7, border: '1px solid rgba(255,255,255,0.09)', background: 'transparent', color: page === 0 ? '#1e293b' : '#64748b', cursor: page === 0 ? 'not-allowed' : 'pointer' }}>
                            ← Prev
                        </button>
                        <span style={{ color: '#64748b', lineHeight: '26px' }}>{page + 1}/{totalPages}</span>
                        <button onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1}
                            style={{ padding: '2px 10px', borderRadius: 7, border: '1px solid rgba(255,255,255,0.09)', background: 'transparent', color: page >= totalPages - 1 ? '#1e293b' : '#64748b', cursor: page >= totalPages - 1 ? 'not-allowed' : 'pointer' }}>
                            Next →
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}

function normName(s) { return (s || '').trim().toLowerCase(); }
