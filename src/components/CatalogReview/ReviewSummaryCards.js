/**
 * ReviewSummaryCards.js
 * Top summary stat cards for the Superadmin Catalog Review Queue.
 */
import React from 'react';

const CARDS = [
    { key: 'totalPending',         label: 'Total Pending',      emoji: '📋', color: '#94a3b8', bg: 'rgba(148,163,184,0.07)',   border: 'rgba(148,163,184,0.18)' },
    { key: 'pendingNewItems',      label: 'New Items',          emoji: '✨', color: '#4ade80', bg: 'rgba(74,222,128,0.07)',    border: 'rgba(74,222,128,0.22)' },
    { key: 'pendingDuplicates',    label: 'Possible Dupl.',     emoji: '⚠️', color: '#fb923c', bg: 'rgba(251,146,60,0.07)',    border: 'rgba(251,146,60,0.22)' },
    { key: 'pendingHighRisk',      label: 'High Risk',          emoji: '🚨', color: '#f97316', bg: 'rgba(249,115,22,0.07)',    border: 'rgba(249,115,22,0.25)' },
    { key: 'pendingMappingReview', label: 'Mapping Review',     emoji: '🔗', color: '#a78bfa', bg: 'rgba(167,139,250,0.07)',   border: 'rgba(167,139,250,0.22)' },
    { key: 'held',                 label: 'Held',               emoji: '🕐', color: '#fbbf24', bg: 'rgba(251,191,36,0.07)',    border: 'rgba(251,191,36,0.22)' },
    { key: 'approvedToday',        label: 'Approved Today',     emoji: '✅', color: '#38bdf8', bg: 'rgba(56,189,248,0.07)',    border: 'rgba(56,189,248,0.22)' },
    { key: 'rejectedToday',        label: 'Rejected Today',     emoji: '❌', color: '#f43f5e', bg: 'rgba(244,63,94,0.07)',     border: 'rgba(244,63,94,0.22)' },
];

export default function ReviewSummaryCards({ summary = {}, loading = false }) {
    return (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: 10, marginBottom: 24 }}>
            {CARDS.map(card => (
                <div key={card.key} style={{
                    padding: '13px 14px', borderRadius: 11,
                    background: card.bg, border: '1px solid ' + card.border,
                    textAlign: 'center',
                    opacity: loading ? 0.5 : 1,
                    transition: 'opacity 0.2s',
                }}>
                    <div style={{ fontSize: 20, marginBottom: 4 }}>{card.emoji}</div>
                    <div style={{ fontSize: 26, fontWeight: 800, color: card.color, lineHeight: 1 }}>
                        {loading ? '—' : (summary[card.key] ?? 0)}
                    </div>
                    <div style={{ fontSize: 9.5, color: '#94a3b8', marginTop: 5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                        {card.label}
                    </div>
                </div>
            ))}
        </div>
    );
}
