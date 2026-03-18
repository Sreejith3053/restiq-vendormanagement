/**
 * VendorItemComparisonCard.js
 * Side-by-side current vs proposed values for an update review.
 */
import React from 'react';

function pct(oldVal, newVal) {
    const o = parseFloat(oldVal || 0);
    const n = parseFloat(newVal || 0);
    if (!o) return null;
    const p = ((n - o) / o) * 100;
    return p;
}

function PctChip({ pct: p }) {
    if (p === null || p === undefined || isNaN(p)) return null;
    const pos = p > 0;
    const neu = Math.abs(p) < 0.1;
    const c = neu ? '#64748b' : pos ? '#fbbf24' : '#4ade80';
    return (
        <span style={{ fontSize: 10, background: 'rgba(255,255,255,0.04)', color: c, fontWeight: 700, padding: '1px 5px', borderRadius: 4, marginLeft: 6 }}>
            {p > 0 ? '+' : ''}{p.toFixed(1)}%
        </span>
    );
}

function Row({ label, oldVal, newVal, isPrice }) {
    const changed = oldVal !== undefined && newVal !== undefined && String(oldVal) !== String(newVal) && String(newVal).trim() !== '';
    const deltaPct = isPrice ? pct(oldVal, newVal) : null;

    return (
        <tr>
            <td style={styles.label}>{label}</td>
            <td style={{ ...styles.cell, color: '#94a3b8' }}>
                {oldVal !== undefined && oldVal !== '' && oldVal !== null ? String(oldVal) : <span style={{ color: '#334155' }}>—</span>}
            </td>
            <td style={{ ...styles.cell, color: changed ? '#4ade80' : '#94a3b8', fontWeight: changed ? 700 : 400 }}>
                {newVal !== undefined && newVal !== '' && newVal !== null ? String(newVal) : <span style={{ color: '#334155' }}>—</span>}
                {changed && isPrice && <PctChip pct={deltaPct} />}
            </td>
            <td style={styles.cell}>
                {changed
                    ? <span style={{ fontSize: 11, color: '#fbbf24', background: 'rgba(251,191,36,0.08)', padding: '1px 7px', borderRadius: 4 }}>Changed</span>
                    : <span style={{ fontSize: 11, color: '#334155' }}>—</span>
                }
            </td>
        </tr>
    );
}

const styles = {
    label: { padding: '6px 10px', fontSize: 12, color: '#64748b', fontWeight: 600, whiteSpace: 'nowrap' },
    cell:  { padding: '6px 10px', fontSize: 12 },
};

export default function VendorItemComparisonCard({ existingItem = {}, proposedData = {} }) {
    const fields = [
        { label: 'Item Name',    oldKey: 'name',        newKey: 'itemName',    isPrice: false },
        { label: 'Price',        oldKey: 'vendorPrice',  newKey: 'price',       isPrice: true  },
        { label: 'Pack Size',    oldKey: 'packSize',     newKey: 'packSize',    isPrice: false },
        { label: 'Unit',         oldKey: 'unit',         newKey: 'unit',        isPrice: false },
        { label: 'Category',     oldKey: 'category',     newKey: 'category',    isPrice: false },
        { label: 'Brand',        oldKey: 'brand',        newKey: 'brand',       isPrice: false },
        { label: 'Vendor SKU',   oldKey: 'vendorSKU',    newKey: 'vendorSKU',   isPrice: false },
        { label: 'Status',       oldKey: 'status',       newKey: 'status',      isPrice: false },
        { label: 'Currency',     oldKey: 'currency',     newKey: 'currency',    isPrice: false },
    ];

    const hasExisting = Object.keys(existingItem).length > 0;

    return (
        <div style={{ overflowX: 'auto', borderRadius: 9, border: '1px solid rgba(255,255,255,0.07)' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', background: 'rgba(10,18,38,0.9)' }}>
                <thead>
                    <tr style={{ background: 'rgba(255,255,255,0.015)' }}>
                        <th style={{ ...styles.label, borderBottom: '1px solid rgba(255,255,255,0.07)' }}>Field</th>
                        <th style={{ ...styles.cell, borderBottom: '1px solid rgba(255,255,255,0.07)', color: '#475569', fontSize: 10, fontWeight: 700, textTransform: 'uppercase' }}>Current</th>
                        <th style={{ ...styles.cell, borderBottom: '1px solid rgba(255,255,255,0.07)', color: '#475569', fontSize: 10, fontWeight: 700, textTransform: 'uppercase' }}>Proposed</th>
                        <th style={{ ...styles.cell, borderBottom: '1px solid rgba(255,255,255,0.07)', color: '#475569', fontSize: 10, fontWeight: 700, textTransform: 'uppercase' }}>Change</th>
                    </tr>
                </thead>
                <tbody>
                    {fields.map(f => (
                        <Row
                            key={f.label}
                            label={f.label}
                            oldVal={hasExisting ? existingItem[f.oldKey] : undefined}
                            newVal={proposedData[f.newKey]}
                            isPrice={f.isPrice}
                        />
                    ))}
                </tbody>
            </table>
        </div>
    );
}
