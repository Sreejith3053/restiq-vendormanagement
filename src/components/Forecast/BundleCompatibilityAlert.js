/**
 * BundleCompatibilityAlert.js
 *
 * Dismissible alert banner for SuggestedOrderReview.
 * Shown when order contains a cup/container but is missing its matching lid.
 *
 * Props:
 *   missingPairs   — Array<{ item, missingMatch, ratio, bundleType }>
 *   onAddItem      — callback(matchItemName) to add the missing item to the order
 */
import React, { useState } from 'react';
import { FiAlertCircle, FiPlus, FiX } from 'react-icons/fi';

export default function BundleCompatibilityAlert({ missingPairs = [], onAddItem }) {
    const [dismissed, setDismissed] = useState([]);

    const visible = missingPairs.filter(p => !dismissed.includes(p.item));
    if (visible.length === 0) return null;

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 20 }}>
            {visible.map((pair, i) => (
                <div key={i} style={{
                    background: 'rgba(251,191,36,0.06)',
                    border: '1px solid rgba(251,191,36,0.2)',
                    borderRadius: 10,
                    padding: '14px 18px',
                    display: 'flex',
                    gap: 14,
                    alignItems: 'flex-start',
                    position: 'relative',
                }}>
                    {/* Icon */}
                    <div style={{
                        width: 38, height: 38, borderRadius: 8,
                        background: 'rgba(251,191,36,0.12)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        flexShrink: 0, color: '#fbbf24', fontSize: 18,
                    }}>
                        <FiAlertCircle />
                    </div>

                    {/* Content */}
                    <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 12, fontWeight: 700, color: '#fbbf24', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 4 }}>
                            🔗 Bundle Check
                        </div>
                        <div style={{ fontSize: 13, color: '#e2e8f0', lineHeight: 1.6, marginBottom: 4 }}>
                            You added <strong>{pair.item}</strong> but <strong>{pair.missingMatch}</strong> {pair.bundleType === 'lid' ? 'lids are' : 'is'} not in your order.
                        </div>
                        <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 10 }}>
                            Customers usually purchase both together (ratio: {pair.ratio}).
                        </div>
                        <div style={{ display: 'flex', gap: 8 }}>
                            {onAddItem && (
                                <button onClick={() => onAddItem(pair.missingMatch)} style={{
                                    fontSize: 12, fontWeight: 600, padding: '5px 14px', borderRadius: 6,
                                    background: 'rgba(52,211,153,0.1)', color: '#34d399',
                                    border: '1px solid rgba(52,211,153,0.2)', cursor: 'pointer',
                                    display: 'flex', alignItems: 'center', gap: 4,
                                }}>
                                    <FiPlus size={12} /> Add matching {pair.bundleType === 'lid' ? 'lids' : 'item'}
                                </button>
                            )}
                        </div>
                    </div>

                    {/* Dismiss */}
                    <button onClick={() => setDismissed(prev => [...prev, pair.item])} style={{
                        position: 'absolute', top: 8, right: 8,
                        background: 'transparent', border: 'none', color: '#64748b', cursor: 'pointer', padding: 4,
                    }}>
                        <FiX size={14} />
                    </button>
                </div>
            ))}
        </div>
    );
}
