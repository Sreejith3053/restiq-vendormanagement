/**
 * SavingsOpportunityBanner.js
 *
 * Inline savings alert shown per order line item in SuggestedOrderReview
 * when a cheaper marketplace supplier exists for that item.
 *
 * Props:
 *   itemName       — the item name
 *   currentPrice   — the price the restaurant currently pays
 *   cheaperPrice   — the lowest active marketplace price
 *   monthlyUsage   — estimated monthly units (from order history)
 *   onCompare      — callback when "Compare" is clicked
 *   onSwitch       — callback when "Switch next order" is clicked
 */
import React, { useState } from 'react';
import { FiDollarSign, FiArrowRight, FiX } from 'react-icons/fi';

export default function SavingsOpportunityBanner({
    itemName = '',
    currentPrice = 0,
    cheaperPrice = 0,
    monthlyUsage = 0,
    onCompare,
    onSwitch,
}) {
    const [dismissed, setDismissed] = useState(false);
    if (dismissed) return null;

    const savingsPerUnit = currentPrice - cheaperPrice;
    const monthlySavings = savingsPerUnit * monthlyUsage;

    if (savingsPerUnit <= 0) return null;

    return (
        <div style={{
            background: 'rgba(245,158,11,0.06)',
            border: '1px solid rgba(245,158,11,0.2)',
            borderRadius: 10,
            padding: '12px 16px',
            marginTop: 8,
            display: 'flex',
            gap: 14,
            alignItems: 'flex-start',
            position: 'relative',
        }}>
            {/* Icon */}
            <div style={{
                width: 36, height: 36, borderRadius: 8,
                background: 'rgba(245,158,11,0.12)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                flexShrink: 0, color: '#f59e0b', fontSize: 18,
            }}>
                <FiDollarSign />
            </div>

            {/* Content */}
            <div style={{ flex: 1 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#f59e0b', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 4 }}>
                    💰 Savings Opportunity
                </div>
                <div style={{ fontSize: 13, color: '#e2e8f0', lineHeight: 1.6, marginBottom: 8 }}>
                    A marketplace supplier is offering <strong>{itemName}</strong> at a lower price.
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginBottom: 10 }}>
                    <div>
                        <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 2 }}>Your price</div>
                        <div style={{ fontSize: 15, fontWeight: 700, color: '#f8fafc' }}>${currentPrice.toFixed(2)}</div>
                    </div>
                    <div>
                        <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 2 }}>Available price</div>
                        <div style={{ fontSize: 15, fontWeight: 700, color: '#34d399' }}>${cheaperPrice.toFixed(2)}</div>
                    </div>
                    <div>
                        <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 2 }}>Savings / unit</div>
                        <div style={{ fontSize: 15, fontWeight: 700, color: '#fbbf24' }}>${savingsPerUnit.toFixed(2)}</div>
                    </div>
                </div>

                {monthlyUsage > 0 && monthlySavings > 0 && (
                    <div style={{
                        display: 'inline-flex', alignItems: 'center', gap: 6,
                        background: 'rgba(52,211,153,0.1)', color: '#34d399',
                        padding: '4px 12px', borderRadius: 8, fontSize: 12, fontWeight: 600, marginBottom: 10,
                    }}>
                        Estimated monthly savings based on your usage: <strong>${monthlySavings.toFixed(2)}</strong>
                    </div>
                )}

                {/* Actions */}
                <div style={{ display: 'flex', gap: 8 }}>
                    {onCompare && (
                        <button onClick={onCompare} style={{
                            fontSize: 12, fontWeight: 600, padding: '5px 14px', borderRadius: 6,
                            background: 'rgba(56,189,248,0.1)', color: '#38bdf8',
                            border: '1px solid rgba(56,189,248,0.2)', cursor: 'pointer',
                        }}>
                            Compare
                        </button>
                    )}
                    {onSwitch && (
                        <button onClick={onSwitch} style={{
                            fontSize: 12, fontWeight: 600, padding: '5px 14px', borderRadius: 6,
                            background: 'rgba(52,211,153,0.1)', color: '#34d399',
                            border: '1px solid rgba(52,211,153,0.2)', cursor: 'pointer',
                            display: 'flex', alignItems: 'center', gap: 4,
                        }}>
                            Switch next order <FiArrowRight size={12} />
                        </button>
                    )}
                </div>
            </div>

            {/* Dismiss */}
            <button onClick={() => setDismissed(true)} style={{
                position: 'absolute', top: 8, right: 8,
                background: 'transparent', border: 'none', color: '#64748b', cursor: 'pointer', padding: 4,
            }}>
                <FiX size={14} />
            </button>
        </div>
    );
}
