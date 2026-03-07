import React from 'react';

// Trend Badge
export const TrendBadge = ({ trend }) => {
    let color = '#f59f00'; // Stable
    let bg = 'rgba(245, 159, 0, 0.1)';
    let icon = '→';

    if (trend === 'Increasing') {
        color = '#4ade80';
        bg = 'rgba(74, 222, 128, 0.1)';
        icon = '↑';
    } else if (trend === 'Decreasing') {
        color = '#ff6b7a';
        bg = 'rgba(255, 107, 122, 0.1)';
        icon = '↓';
    } else if (trend === 'Irregular') {
        color = '#a0aec0';
        bg = 'rgba(160, 174, 192, 0.1)';
        icon = '↭';
    }

    return (
        <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 4,
            padding: '2px 8px', borderRadius: 12, fontSize: 12, fontWeight: 500,
            color, background: bg
        }}>
            {icon} {trend || 'Stable'}
        </span>
    );
};

// Confidence Badge
export const ConfidenceBadge = ({ confidence }) => {
    let color = '#4ade80'; // High
    let bg = 'rgba(74, 222, 128, 0.1)';

    if (confidence === 'Medium') {
        color = '#f59f00';
        bg = 'rgba(245, 159, 0, 0.1)';
    } else if (confidence === 'Low') {
        color = '#ff6b7a';
        bg = 'rgba(255, 107, 122, 0.1)';
    }

    return (
        <span style={{
            padding: '2px 8px', borderRadius: 4, fontSize: 12, fontWeight: 500,
            border: `1px solid ${color}`, color, background: bg
        }}>
            {confidence || 'Medium'}
        </span>
    );
};

// Card Widget
export const ForecastSummaryCard = ({ title, value, subtitle, icon, color = '#4dabf7' }) => {
    return (
        <div className="ui-card" style={{ padding: 20, display: 'flex', alignItems: 'center', gap: 16 }}>
            <div style={{
                width: 48, height: 48, borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: `${color}15`, color: color, fontSize: 24
            }}>
                {icon}
            </div>
            <div>
                <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{title}</div>
                <div style={{ fontSize: 24, fontWeight: 700, margin: '2px 0' }}>{value}</div>
                {subtitle && <div style={{ fontSize: 12, color: 'var(--muted)' }}>{subtitle}</div>}
            </div>
        </div>
    );
};

// Insight Panel
export const ForecastInsightPanel = ({ title, content, type = 'info' }) => {
    let accent = '#4dabf7';
    let bg = 'rgba(77, 171, 247, 0.05)';
    if (type === 'warning') {
        accent = '#f59f00';
        bg = 'rgba(245, 159, 0, 0.05)';
    } else if (type === 'success') {
        accent = '#4ade80';
        bg = 'rgba(74, 222, 128, 0.05)';
    }

    return (
        <div style={{
            padding: 16, borderRadius: 8, background: bg, borderLeft: `3px solid ${accent}`,
            marginTop: 12, marginBottom: 12
        }}>
            <h5 style={{ margin: '0 0 4px 0', color: accent, fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}>
                ✨ {title}
            </h5>
            <p style={{ margin: 0, fontSize: 13, color: 'var(--text-primary)', lineHeight: 1.5 }}>
                {content}
            </p>
        </div>
    );
};
