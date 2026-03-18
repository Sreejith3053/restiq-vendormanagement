/**
 * ImportSummaryCards.js — v3
 * Updated for: Auto Updates, Review Recommended, High Risk Review, Needs Review, Possible Duplicates
 */
import React from 'react';

const CARDS = [
    { key: 'total',             label: 'Total Rows',         emoji: '📋', color: '#94a3b8', bg: 'rgba(148,163,184,0.07)',  border: 'rgba(148,163,184,0.18)' },
    { key: 'newItems',          label: 'New Items',          emoji: '✨', color: '#4ade80', bg: 'rgba(74,222,128,0.07)',   border: 'rgba(74,222,128,0.22)' },
    { key: 'updatesHigh',       label: 'Auto Updates',       emoji: '✅', color: '#38bdf8', bg: 'rgba(56,189,248,0.07)',   border: 'rgba(56,189,248,0.22)' },
    { key: 'updatesMedium',     label: 'Recommend Review',   emoji: '⚡', color: '#fbbf24', bg: 'rgba(251,191,36,0.07)',   border: 'rgba(251,191,36,0.22)' },
    { key: 'highRiskReview',    label: 'High Risk',          emoji: '🚨', color: '#f97316', bg: 'rgba(249,115,22,0.07)',   border: 'rgba(249,115,22,0.25)' },
    { key: 'needsReview',       label: 'Needs Review',       emoji: '🔍', color: '#a78bfa', bg: 'rgba(167,139,250,0.07)',  border: 'rgba(167,139,250,0.22)' },
    { key: 'possibleDuplicates',label: 'Poss. Duplicate',    emoji: '⚠️', color: '#fb923c', bg: 'rgba(251,146,60,0.07)',   border: 'rgba(251,146,60,0.22)' },
    { key: 'unchanged',         label: 'Unchanged',          emoji: '➖', color: '#64748b', bg: 'rgba(100,116,139,0.05)',  border: 'rgba(100,116,139,0.14)' },
    { key: 'errors',            label: 'Errors',             emoji: '❌', color: '#f43f5e', bg: 'rgba(244,63,94,0.07)',    border: 'rgba(244,63,94,0.22)' },
];

export default function ImportSummaryCards({ summary = {} }) {
    return (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: 9, marginBottom: 22 }}>
            {CARDS.map(card => {
                const count = summary[card.key] ?? 0;
                return (
                    <div key={card.key} style={{
                        padding: '11px 12px', borderRadius: 10,
                        background: card.bg, border: '1px solid ' + card.border, textAlign: 'center',
                    }}>
                        <div style={{ fontSize: 18, marginBottom: 3 }}>{card.emoji}</div>
                        <div style={{ fontSize: 22, fontWeight: 800, color: card.color, lineHeight: 1 }}>{count}</div>
                        <div style={{ fontSize: 9.5, color: '#94a3b8', marginTop: 4, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4 }}>
                            {card.label}
                        </div>
                    </div>
                );
            })}
        </div>
    );
}
