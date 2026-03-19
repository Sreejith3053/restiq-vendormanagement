/**
 * TabbedPageShell.js
 *
 * Reusable tabbed page wrapper used by all consolidated super-admin pages.
 * Syncs the active tab to the ?tab= URL query parameter so that
 * deep-links and redirects work (e.g. /orders-fulfillment?tab=dispatch).
 *
 * Props:
 *   title        — page heading (string)
 *   subtitle     — optional description line
 *   icon         — emoji string for the header
 *   tabs         — array of { key, label, icon, content }
 *   defaultTab   — fallback tab key if ?tab= is absent
 *   headerExtra  — optional JSX rendered to the right of the title
 */

import React, { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';

// ── Styles ─────────────────────────────────────────────────────────────────────

const shellStyle = { padding: '28px 32px', maxWidth: 1500, margin: '0 auto' };

const headerStyle = {
    display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
    marginBottom: 22, flexWrap: 'wrap', gap: 12,
};

const titleRowStyle = { display: 'flex', alignItems: 'center', gap: 10 };
const h1Style = { fontSize: 24, fontWeight: 800, color: '#f8fafc', margin: 0 };
const subtitleStyle = { fontSize: 13, color: '#475569', marginTop: 4 };
const iconStyle = { fontSize: 26 };

const tabBarStyle = {
    display: 'flex', gap: 4, marginBottom: 24,
    borderBottom: '1px solid rgba(255,255,255,0.06)',
    overflowX: 'auto', paddingBottom: 0,
};

const tabBtnStyle = (active) => ({
    padding: '10px 18px', fontSize: 13, fontWeight: active ? 700 : 500,
    color: active ? '#38bdf8' : '#64748b',
    background: 'transparent', border: 'none', cursor: 'pointer',
    borderBottom: active ? '2px solid #38bdf8' : '2px solid transparent',
    transition: 'all 0.15s', whiteSpace: 'nowrap',
    marginBottom: -1, // overlap border
});

// ── Component ──────────────────────────────────────────────────────────────────

export default function TabbedPageShell({ title, subtitle, icon, tabs = [], defaultTab, headerExtra, kpiRow }) {
    const [searchParams, setSearchParams] = useSearchParams();

    const activeKey = useMemo(() => {
        const fromUrl = searchParams.get('tab');
        if (fromUrl && tabs.some(t => t.key === fromUrl)) return fromUrl;
        return defaultTab || (tabs[0] && tabs[0].key) || '';
    }, [searchParams, tabs, defaultTab]);

    const setTab = (key) => {
        setSearchParams({ tab: key }, { replace: true });
    };

    const activeTab = tabs.find(t => t.key === activeKey);

    return (
        <div style={shellStyle}>
            {/* Header */}
            <div style={headerStyle}>
                <div>
                    <div style={titleRowStyle}>
                        {icon && <span style={iconStyle}>{icon}</span>}
                        <h1 style={h1Style}>{title}</h1>
                    </div>
                    {subtitle && <div style={subtitleStyle}>{subtitle}</div>}
                </div>
                {headerExtra && <div>{headerExtra}</div>}
            </div>

            {/* Tab bar */}
            <div style={tabBarStyle}>
                {tabs.map(tab => (
                    <button
                        key={tab.key}
                        style={tabBtnStyle(activeKey === tab.key)}
                        onClick={() => setTab(tab.key)}
                    >
                        {tab.icon && <span style={{ marginRight: 6 }}>{tab.icon}</span>}
                        {tab.label}
                    </button>
                ))}
            </div>
            {/* KPI Row (optional) */}
            {kpiRow && <div style={{ marginBottom: 18 }}>{kpiRow}</div>}

            {/* Tab content */}
            <div>
                {activeTab ? activeTab.content : (
                    <div style={{ padding: 40, textAlign: 'center', color: '#334155' }}>
                        Select a tab to view content.
                    </div>
                )}
            </div>
        </div>
    );
}
