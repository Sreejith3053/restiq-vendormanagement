import React, { useState } from 'react';

const TABS = [
    { key: 'accuracy', label: '🎯 Forecast Accuracy' },
    { key: 'correction', label: '🧠 Correction Intelligence' },
    { key: 'marketplace', label: '📊 Marketplace Intelligence' },
    { key: 'alerts', label: '🚨 Opportunity Alerts' },
    { key: 'festivals', label: '🎉 Festival Impact' },
    { key: 'engine', label: '⚙️ Engine Config' },
];

// ─── Accuracy Tab ─────────────────────────────────────────────────────────────
function AccuracyTab() {
    const weeks = [
        { week: 'Mar 3–9', accuracy: 91, correct: 38, over: 4, under: 2, items: 44 },
        { week: 'Feb 24–Mar 2', accuracy: 87, correct: 35, over: 3, under: 4, items: 42 },
        { week: 'Feb 17–23', accuracy: 89, correct: 34, over: 5, under: 1, items: 40 },
        { week: 'Feb 10–16', accuracy: 83, correct: 30, over: 6, under: 4, items: 40 },
    ];
    const [selected, setSelected] = useState(0);
    const w = weeks[selected];
    return (
        <div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 28 }}>
                {[
                    { label: 'Weekly Accuracy', value: `${w.accuracy}%`, color: w.accuracy >= 90 ? '#34d399' : w.accuracy >= 80 ? '#fbbf24' : '#f87171', icon: '🎯' },
                    { label: 'Accurate Predictions', value: w.correct, color: '#38bdf8', icon: '✅' },
                    { label: 'Over Predictions', value: w.over, color: '#fbbf24', icon: '📈' },
                    { label: 'Under Predictions', value: w.under, color: '#f87171', icon: '📉' },
                ].map(k => (
                    <div key={k.label} style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, padding: 20 }}>
                        <div style={{ fontSize: 22 }}>{k.icon}</div>
                        <div style={{ fontSize: 26, fontWeight: 700, color: k.color, margin: '6px 0 2px' }}>{k.value}</div>
                        <div style={{ fontSize: 12, color: '#94a3b8' }}>{k.label}</div>
                    </div>
                ))}
            </div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
                {weeks.map((wk, i) => (
                    <button key={i} onClick={() => setSelected(i)} style={{
                        padding: '7px 16px', borderRadius: 20, fontSize: 12, fontWeight: 600, cursor: 'pointer',
                        background: selected === i ? 'rgba(56,189,248,0.15)' : 'rgba(255,255,255,0.04)',
                        color: selected === i ? '#38bdf8' : '#94a3b8',
                        border: `1px solid ${selected === i ? 'rgba(56,189,248,0.3)' : 'rgba(255,255,255,0.08)'}`,
                    }}>{wk.week}</button>
                ))}
            </div>
            <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 12, overflow: 'hidden' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                    <thead>
                        <tr style={{ background: 'rgba(255,255,255,0.04)', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                            {['Week', 'Total Items', 'Accuracy', 'Correct', 'Over-predicted', 'Under-predicted'].map(h => (
                                <th key={h} style={{ padding: '11px 16px', textAlign: 'left', fontSize: 11, color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>{h}</th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {weeks.map((wk, i) => (
                            <tr key={i} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)', background: i === selected ? 'rgba(56,189,248,0.05)' : 'transparent' }}>
                                <td style={{ padding: '12px 16px', fontWeight: 600, color: '#f8fafc' }}>{wk.week}</td>
                                <td style={{ padding: '12px 16px', color: '#94a3b8' }}>{wk.items}</td>
                                <td style={{ padding: '12px 16px' }}>
                                    <span style={{ color: wk.accuracy >= 90 ? '#34d399' : wk.accuracy >= 80 ? '#fbbf24' : '#f87171', fontWeight: 700 }}>{wk.accuracy}%</span>
                                </td>
                                <td style={{ padding: '12px 16px', color: '#38bdf8', fontWeight: 600 }}>{wk.correct}</td>
                                <td style={{ padding: '12px 16px', color: '#fbbf24', fontWeight: 600 }}>{wk.over}</td>
                                <td style={{ padding: '12px 16px', color: '#f87171', fontWeight: 600 }}>{wk.under}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

// ─── Correction Intelligence Tab ──────────────────────────────────────────────
function CorrectionIntelligenceTab() {
    const summaryKpis = [
        { label: 'Learning Active Items', value: '11', icon: '🔁', color: '#38bdf8' },
        { label: 'Avg Correction Delta', value: '+0.8', icon: '📐', color: '#34d399' },
        { label: 'Most Corrected Item', value: 'Onion - Cooking', icon: '🥇', color: '#fbbf24' },
        { label: 'Most Consistently Increased', value: 'French Beans', icon: '📈', color: '#a78bfa' },
        { label: 'Most Consistently Reduced', value: 'Peeled Garlic', icon: '📉', color: '#f87171' },
        { label: 'Prediction Improvement %', value: '+12%', icon: '⬆️', color: '#34d399' },
        { label: 'Last Week Accuracy', value: '91%', icon: '🎯', color: '#34d399' },
    ];

    const correctionRows = [
        { item: 'Onion - Cooking', avgDelta: '+1', editFrequency: '4/4', direction: 'Increased', confidence: 'High', lastEditedWeek: 'Mar 3–9' },
        { item: 'French Beans', avgDelta: '+1', editFrequency: '4/4', direction: 'Increased', confidence: 'High', lastEditedWeek: 'Mar 3–9' },
        { item: 'Coriander Leaves', avgDelta: '+2', editFrequency: '3/4', direction: 'Increased', confidence: 'Medium', lastEditedWeek: 'Mar 3–9' },
        { item: 'Peeled Garlic', avgDelta: '-1', editFrequency: '3/4', direction: 'Reduced', confidence: 'Medium', lastEditedWeek: 'Feb 24–Mar 2' },
        { item: 'Tomato', avgDelta: '+1', editFrequency: '2/4', direction: 'Increased', confidence: 'Medium', lastEditedWeek: 'Mar 3–9' },
        { item: 'Okra', avgDelta: '-1', editFrequency: '2/4', direction: 'Reduced', confidence: 'Low', lastEditedWeek: 'Feb 17–23' },
        { item: 'Curry Leaves', avgDelta: '+1', editFrequency: '2/4', direction: 'Increased', confidence: 'Low', lastEditedWeek: 'Feb 17–23' },
        { item: 'Mint Leaves', avgDelta: '0', editFrequency: '1/4', direction: 'Unchanged', confidence: 'Low', lastEditedWeek: 'Feb 10–16' },
        { item: 'Carrot', avgDelta: '-1', editFrequency: '1/4', direction: 'Reduced', confidence: 'Low', lastEditedWeek: 'Feb 10–16' },
        { item: 'Ginger', avgDelta: '0', editFrequency: '0/4', direction: 'Unchanged', confidence: 'Low', lastEditedWeek: '—' },
        { item: 'Capsicum Green', avgDelta: '+1', editFrequency: '1/4', direction: 'Increased', confidence: 'Low', lastEditedWeek: 'Feb 24–Mar 2' },
    ];

    const dirColor = { Increased: '#34d399', Reduced: '#f87171', Unchanged: '#94a3b8' };
    const confColor = { High: '#34d399', Medium: '#fbbf24', Low: '#94a3b8' };

    return (
        <div>
            {/* KPI Grid */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginBottom: 28 }}>
                {summaryKpis.slice(0, 4).map(k => (
                    <div key={k.label} style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, padding: 18 }}>
                        <div style={{ fontSize: 20 }}>{k.icon}</div>
                        <div style={{ fontSize: 19, fontWeight: 700, color: k.color, margin: '6px 0 2px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{k.value}</div>
                        <div style={{ fontSize: 11, color: '#94a3b8' }}>{k.label}</div>
                    </div>
                ))}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14, marginBottom: 28 }}>
                {summaryKpis.slice(4).map(k => (
                    <div key={k.label} style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, padding: 18 }}>
                        <div style={{ fontSize: 20 }}>{k.icon}</div>
                        <div style={{ fontSize: 19, fontWeight: 700, color: k.color, margin: '6px 0 2px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{k.value}</div>
                        <div style={{ fontSize: 11, color: '#94a3b8' }}>{k.label}</div>
                    </div>
                ))}
            </div>

            {/* Learning note */}
            <div style={{ background: 'rgba(56,189,248,0.07)', border: '1px solid rgba(56,189,248,0.15)', borderRadius: 10, padding: '12px 18px', marginBottom: 20, fontSize: 13, color: '#94a3b8' }}>
                🧠 <strong style={{ color: '#38bdf8' }}>Correction Learning Active</strong> — The engine monitors how managers edit AI predictions each week. Items edited consistently in the same direction are flagged as learning candidates and future forecasts are auto-adjusted.
            </div>

            {/* Correction Table */}
            <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 12, overflow: 'hidden' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                    <thead>
                        <tr style={{ background: 'rgba(255,255,255,0.04)', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                            {['Item', 'Avg Delta', 'Edit Frequency', 'Direction', 'Confidence', 'Last Edited Week'].map(h => (
                                <th key={h} style={{ padding: '11px 16px', textAlign: 'left', fontSize: 11, color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>{h}</th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {correctionRows.map((row, i) => (
                            <tr key={i} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}
                                onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.03)'}
                                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                                <td style={{ padding: '12px 16px', fontWeight: 600, color: '#f8fafc' }}>{row.item}</td>
                                <td style={{ padding: '12px 16px', color: row.avgDelta.startsWith('+') ? '#34d399' : row.avgDelta.startsWith('-') ? '#f87171' : '#94a3b8', fontWeight: 700 }}>{row.avgDelta}</td>
                                <td style={{ padding: '12px 16px', color: '#94a3b8' }}>{row.editFrequency}</td>
                                <td style={{ padding: '12px 16px' }}>
                                    <span style={{ color: dirColor[row.direction], fontWeight: 600, fontSize: 12 }}>
                                        {row.direction === 'Increased' ? '▲' : row.direction === 'Reduced' ? '▼' : '—'} {row.direction}
                                    </span>
                                </td>
                                <td style={{ padding: '12px 16px' }}>
                                    <span style={{ color: confColor[row.confidence], fontWeight: 700, fontSize: 12 }}>● {row.confidence}</span>
                                </td>
                                <td style={{ padding: '12px 16px', color: '#94a3b8', fontSize: 12 }}>{row.lastEditedWeek}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

// ─── Alerts Tab ────────────────────────────────────────────────────────────────
function AlertsTab() {
    const alerts = [
        { type: 'Price Opportunity', item: 'Onion Cooking', message: 'ON Thyme price 18% below 8-week average. Consider bulk ordering.', urgency: 'High', saving: '$124' },
        { type: 'Demand Spike', item: 'Coriander Leaves', message: 'Demand up 34% vs. 4-week baseline across 3 restaurants.', urgency: 'Medium', saving: '—' },
        { type: 'Savings Opportunity', item: 'T28 Container', message: 'Order threshold for volume discount is 150 units. Current forecast: 142 units.', urgency: 'Low', saving: '$56' },
        { type: 'Price Opportunity', item: 'Mint Leaves', message: 'Seasonal surplus expected. Vendor quotes available 12% below last cycle.', urgency: 'Medium', saving: '$48' },
        { type: 'Unusual Growth', item: 'French Beans', message: 'Predicted demand 2.1× higher than 8-week average. Verify with restaurants before dispatch.', urgency: 'High', saving: '—' },
    ];
    const urgencyColor = { High: '#f87171', Medium: '#fbbf24', Low: '#34d399' };
    const typeColor = { 'Price Opportunity': '#38bdf8', 'Demand Spike': '#fb923c', 'Savings Opportunity': '#34d399', 'Unusual Growth': '#fbbf24' };
    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {alerts.map((a, i) => (
                <div key={i} style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, padding: 20, display: 'flex', gap: 18, alignItems: 'flex-start' }}>
                    <div style={{ width: 44, height: 44, borderRadius: 10, background: 'rgba(255,255,255,0.06)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, flexShrink: 0 }}>
                        {a.type === 'Price Opportunity' ? '💰' : a.type === 'Demand Spike' ? '📈' : a.type === 'Unusual Growth' ? '⚠️' : '💡'}
                    </div>
                    <div style={{ flex: 1 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                            <span style={{ color: typeColor[a.type] || '#94a3b8', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>{a.type}</span>
                            <span style={{ color: '#f8fafc', fontWeight: 600, fontSize: 14 }}>{a.item}</span>
                            <span style={{ marginLeft: 'auto', fontSize: 11, fontWeight: 700, color: urgencyColor[a.urgency] }}>● {a.urgency}</span>
                        </div>
                        <div style={{ color: '#94a3b8', fontSize: 13 }}>{a.message}</div>
                        {a.saving !== '—' && (
                            <div style={{ marginTop: 8, display: 'inline-flex', alignItems: 'center', gap: 6, background: 'rgba(52,211,153,0.1)', color: '#34d399', padding: '3px 10px', borderRadius: 8, fontSize: 12, fontWeight: 600 }}>
                                💰 Potential saving: {a.saving}
                            </div>
                        )}
                    </div>
                </div>
            ))}
        </div>
    );
}

// ─── Festival Tab ──────────────────────────────────────────────────────────────
function FestivalTab() {
    const festivals = [
        { name: 'Onam', date: 'Aug 26, 2026', uplift: '+38%', topItems: ['Banana', 'Coconut', 'Curry Leaves', 'Jackfruit'], status: 'Upcoming' },
        { name: 'Diwali', date: 'Oct 20, 2026', uplift: '+52%', topItems: ['Milk Powder', 'Sugar', 'Cardamom', 'T28 Containers'], status: 'Upcoming' },
        { name: 'Ramadan', date: 'Mar 1–30, 2026', uplift: '+28%', topItems: ['Onion Cooking', 'Coriander', 'Lemon', 'Dates'], status: 'Active' },
        { name: 'Christmas', date: 'Dec 25, 2026', uplift: '+21%', topItems: ['Cranberries', 'T34 Container', 'Cream', 'Rosemary'], status: 'Upcoming' },
    ];
    const statusColor = { Active: '#34d399', Upcoming: '#38bdf8' };
    return (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 16 }}>
            {festivals.map((f, i) => (
                <div key={i} style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 14, padding: 24 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
                        <div>
                            <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: '#f8fafc' }}>{f.name}</h3>
                            <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 2 }}>{f.date}</div>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
                            <span style={{ fontSize: 20, fontWeight: 700, color: '#34d399' }}>{f.uplift}</span>
                            <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 8, background: statusColor[f.status] + '22', color: statusColor[f.status], fontWeight: 600 }}>{f.status}</span>
                        </div>
                    </div>
                    <div style={{ color: '#94a3b8', fontSize: 12, marginBottom: 8 }}>High demand items:</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                        {f.topItems.map(t => (
                            <span key={t} style={{ background: 'rgba(255,255,255,0.07)', padding: '3px 10px', borderRadius: 20, fontSize: 12, color: '#f8fafc' }}>{t}</span>
                        ))}
                    </div>
                </div>
            ))}
        </div>
    );
}

// ─── Engine Config Tab ──────────────────────────────────────────────────────────
function EngineConfigTab() {
    const [config, setConfig] = useState({
        highConfThreshold: 85, medConfThreshold: 65, historyWeeks: 8,
        recentWeightPct: 40, spikeCapMultiplier: 1.8, spoilageBuffer: 10,
        monSplitPct: 60, correctionLearning: true, autoAlert: true,
    });
    const update = (key, val) => setConfig(prev => ({ ...prev, [key]: val }));
    const Row = ({ label, desc, children }) => (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 0', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
            <div>
                <div style={{ fontWeight: 600, color: '#f8fafc', fontSize: 14 }}>{label}</div>
                {desc && <div style={{ color: '#94a3b8', fontSize: 12, marginTop: 2 }}>{desc}</div>}
            </div>
            <div style={{ flexShrink: 0, marginLeft: 24 }}>{children}</div>
        </div>
    );
    const Slider = ({ k, min, max, suffix = '' }) => (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <input type="range" min={min} max={max} value={config[k]} onChange={e => update(k, Number(e.target.value))} style={{ width: 120 }} />
            <span style={{ color: '#38bdf8', fontWeight: 700, width: 40 }}>{config[k]}{suffix}</span>
        </div>
    );
    const Toggle = ({ k }) => (
        <button onClick={() => update(k, !config[k])} style={{ padding: '6px 18px', borderRadius: 20, fontWeight: 600, fontSize: 12, cursor: 'pointer', background: config[k] ? 'rgba(52,211,153,0.15)' : 'rgba(255,255,255,0.06)', color: config[k] ? '#34d399' : '#94a3b8', border: `1px solid ${config[k] ? 'rgba(52,211,153,0.3)' : 'rgba(255,255,255,0.1)'}` }}>
            {config[k] ? 'Enabled' : 'Disabled'}
        </button>
    );
    return (
        <div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
                <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 12, padding: '0 24px' }}>
                    <h4 style={{ fontSize: 13, color: '#38bdf8', fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase', paddingTop: 20, margin: '0 0 4px 0' }}>Confidence Thresholds</h4>
                    <Row label="High Confidence Threshold" desc="Min accuracy % to label as High"><Slider k="highConfThreshold" min={70} max={99} suffix="%" /></Row>
                    <Row label="Medium Confidence Threshold" desc="Min accuracy % to label as Medium"><Slider k="medConfThreshold" min={40} max={84} suffix="%" /></Row>
                    <Row label="History Window" desc="Number of weeks in rolling average"><Slider k="historyWeeks" min={4} max={16} suffix="w" /></Row>
                </div>
                <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 12, padding: '0 24px' }}>
                    <h4 style={{ fontSize: 13, color: '#845ef7', fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase', paddingTop: 20, margin: '0 0 4px 0' }}>Forecast Weights</h4>
                    <Row label="Recent Window Weight" desc="% weight for most recent 4 weeks"><Slider k="recentWeightPct" min={10} max={70} suffix="%" /></Row>
                    <Row label="Monday Delivery Split" desc="% of weekly order allocated to Monday"><Slider k="monSplitPct" min={40} max={80} suffix="%" /></Row>
                    <Row label="Spike Cap Multiplier" desc="Max allowed vs 8-week average"><Slider k="spikeCapMultiplier" min={1.2} max={3.0} /></Row>
                    <Row label="Spoilage Buffer" desc="% buffer added to perishables forecast"><Slider k="spoilageBuffer" min={0} max={30} suffix="%" /></Row>
                </div>
            </div>
            <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 12, padding: '0 24px', marginTop: 20 }}>
                <h4 style={{ fontSize: 13, color: '#34d399', fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase', paddingTop: 20, margin: '0 0 4px 0' }}>Learning & Automation</h4>
                <Row label="Correction Learning" desc="Auto-adjust future forecasts based on manager edits"><Toggle k="correctionLearning" /></Row>
                <Row label="Auto Opportunity Alerts" desc="Automatically surface price and demand alerts"><Toggle k="autoAlert" /></Row>
            </div>
            <button style={{ marginTop: 20, padding: '10px 28px', background: 'linear-gradient(135deg,#38bdf8,#818cf8)', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 700, cursor: 'pointer', fontSize: 14 }}>
                💾 Save Engine Configuration
            </button>
        </div>
    );
}

// ─── Marketplace Intelligence Tab ─────────────────────────────────────────────
function MarketplaceIntelligenceTab() {
    // Mock data representing marketplace-wide intelligence
    const priceOpportunities = [
        { item: 'Onion - Cooking', restaurant: 'Oruma Takeout', currentPrice: 19.50, marketLowest: 17.50, monthlySavings: 48 },
        { item: 'Coriander Leaves', restaurant: 'Oruma Takeout', currentPrice: 9.50, marketLowest: 8.00, monthlySavings: 60 },
        { item: 'Peeled Garlic', restaurant: 'Oruma Takeout', currentPrice: 22.00, marketLowest: 20.50, monthlySavings: 36 },
    ];

    const vendorCompetitiveness = [
        { vendor: 'Vendor A', items: 12, aboveMedian: 3, avgMarkup: '+8.2%', risk: 'Medium' },
        { vendor: 'ON Thyme', items: 18, aboveMedian: 1, avgMarkup: '+2.1%', risk: 'Low' },
        { vendor: 'Test Taas', items: 8, aboveMedian: 0, avgMarkup: '-3.5%', risk: 'Low' },
    ];

    const bundleMissRates = [
        { pair: '16oz Clear Container ↔ 16oz Clear Lid', missRate: '23%', weeklyMisses: 3, impact: 'High' },
        { pair: '8oz Soup Cup ↔ 8oz Soup Cup Lid', missRate: '15%', weeklyMisses: 2, impact: 'Medium' },
        { pair: 'T28 Container ↔ T28 Clear Lid', missRate: '8%', weeklyMisses: 1, impact: 'Low' },
    ];

    const riskColor = { Low: '#34d399', Medium: '#fbbf24', High: '#f87171' };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
            {/* KPI Strip */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14 }}>
                {[
                    { label: 'Savings Opportunities', value: priceOpportunities.length, icon: '💰', color: '#f59e0b' },
                    { label: 'Total Monthly Savings', value: `$${priceOpportunities.reduce((a, p) => a + p.monthlySavings, 0)}`, icon: '📈', color: '#34d399' },
                    { label: 'Vendors Above Median', value: vendorCompetitiveness.filter(v => v.aboveMedian > 0).length, icon: '⚠️', color: '#f87171' },
                    { label: 'Bundle Miss Rate', value: `${bundleMissRates.reduce((a, b) => a + b.weeklyMisses, 0)}/week`, icon: '🔗', color: '#fbbf24' },
                ].map(k => (
                    <div key={k.label} style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, padding: 18 }}>
                        <div style={{ fontSize: 20 }}>{k.icon}</div>
                        <div style={{ fontSize: 22, fontWeight: 700, color: k.color, margin: '6px 0 2px' }}>{k.value}</div>
                        <div style={{ fontSize: 11, color: '#94a3b8' }}>{k.label}</div>
                    </div>
                ))}
            </div>

            {/* Card 1: Price Opportunities */}
            <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 12, overflow: 'hidden' }}>
                <div style={{ padding: '14px 20px', borderBottom: '1px solid rgba(255,255,255,0.07)', display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 16 }}>💰</span>
                    <span style={{ fontSize: 14, fontWeight: 700, color: '#f8fafc' }}>Price Opportunities</span>
                    <span style={{ marginLeft: 'auto', fontSize: 11, color: '#94a3b8' }}>Items where restaurants pay more than the market minimum</span>
                </div>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                    <thead>
                        <tr style={{ background: 'rgba(255,255,255,0.04)', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                            {['Item', 'Restaurant', 'Current Price', 'Market Lowest', 'Savings/Unit', 'Est. Monthly Savings'].map(h => (
                                <th key={h} style={{ padding: '10px 16px', textAlign: 'left', fontSize: 11, color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>{h}</th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {priceOpportunities.map((row, i) => (
                            <tr key={i} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}
                                onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.03)'}
                                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                                <td style={{ padding: '12px 16px', fontWeight: 600, color: '#f8fafc' }}>{row.item}</td>
                                <td style={{ padding: '12px 16px', color: '#94a3b8' }}>{row.restaurant}</td>
                                <td style={{ padding: '12px 16px', color: '#f87171', fontWeight: 600 }}>${row.currentPrice.toFixed(2)}</td>
                                <td style={{ padding: '12px 16px', color: '#34d399', fontWeight: 600 }}>${row.marketLowest.toFixed(2)}</td>
                                <td style={{ padding: '12px 16px', color: '#fbbf24', fontWeight: 700 }}>${(row.currentPrice - row.marketLowest).toFixed(2)}</td>
                                <td style={{ padding: '12px 16px' }}>
                                    <span style={{ background: 'rgba(52,211,153,0.1)', color: '#34d399', padding: '3px 10px', borderRadius: 8, fontSize: 12, fontWeight: 700 }}>
                                        ${row.monthlySavings}
                                    </span>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            {/* Card 2: Vendor Competitiveness */}
            <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 12, overflow: 'hidden' }}>
                <div style={{ padding: '14px 20px', borderBottom: '1px solid rgba(255,255,255,0.07)', display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 16 }}>🏆</span>
                    <span style={{ fontSize: 14, fontWeight: 700, color: '#f8fafc' }}>Vendor Competitiveness</span>
                    <span style={{ marginLeft: 'auto', fontSize: 11, color: '#94a3b8' }}>Vendors priced above market median on their key items</span>
                </div>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                    <thead>
                        <tr style={{ background: 'rgba(255,255,255,0.04)', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                            {['Vendor', 'Active Items', 'Items Above Median', 'Avg Markup', 'Risk'].map(h => (
                                <th key={h} style={{ padding: '10px 16px', textAlign: 'left', fontSize: 11, color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>{h}</th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {vendorCompetitiveness.map((row, i) => (
                            <tr key={i} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}
                                onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.03)'}
                                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                                <td style={{ padding: '12px 16px', fontWeight: 600, color: '#f8fafc' }}>{row.vendor}</td>
                                <td style={{ padding: '12px 16px', color: '#94a3b8' }}>{row.items}</td>
                                <td style={{ padding: '12px 16px', color: row.aboveMedian > 0 ? '#f87171' : '#34d399', fontWeight: 700 }}>{row.aboveMedian}</td>
                                <td style={{ padding: '12px 16px', color: row.avgMarkup.startsWith('+') ? '#f87171' : '#34d399', fontWeight: 600 }}>{row.avgMarkup}</td>
                                <td style={{ padding: '12px 16px' }}>
                                    <span style={{ color: riskColor[row.risk], fontWeight: 700, fontSize: 12 }}>● {row.risk}</span>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            {/* Card 3: Bundle Miss Rate */}
            <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 12, overflow: 'hidden' }}>
                <div style={{ padding: '14px 20px', borderBottom: '1px solid rgba(255,255,255,0.07)', display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 16 }}>🔗</span>
                    <span style={{ fontSize: 14, fontWeight: 700, color: '#f8fafc' }}>Bundle Miss Rate</span>
                    <span style={{ marginLeft: 'auto', fontSize: 11, color: '#94a3b8' }}>Items commonly ordered without their matching counterpart</span>
                </div>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                    <thead>
                        <tr style={{ background: 'rgba(255,255,255,0.04)', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                            {['Pair', 'Miss Rate', 'Weekly Misses', 'Impact'].map(h => (
                                <th key={h} style={{ padding: '10px 16px', textAlign: 'left', fontSize: 11, color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>{h}</th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {bundleMissRates.map((row, i) => (
                            <tr key={i} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}
                                onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.03)'}
                                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                                <td style={{ padding: '12px 16px', fontWeight: 600, color: '#f8fafc' }}>{row.pair}</td>
                                <td style={{ padding: '12px 16px', color: riskColor[row.impact], fontWeight: 700 }}>{row.missRate}</td>
                                <td style={{ padding: '12px 16px', color: '#94a3b8', fontWeight: 600 }}>{row.weeklyMisses}</td>
                                <td style={{ padding: '12px 16px' }}>
                                    <span style={{ color: riskColor[row.impact], fontWeight: 700, fontSize: 12 }}>● {row.impact}</span>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

// ─── Main Page ──────────────────────────────────────────────────────────────────
export default function ForecastIntelligencePage() {
    const [activeTab, setActiveTab] = useState('accuracy');

    return (
        <div style={{ padding: '24px 32px', maxWidth: 1400, margin: '0 auto', color: '#f8fafc', paddingBottom: 80 }}>
            <div style={{ marginBottom: 28 }}>
                <h1 style={{ fontSize: 26, fontWeight: 700, margin: '0 0 6px 0', background: 'linear-gradient(90deg,#f8fafc,#94a3b8)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
                    Forecast Intelligence
                </h1>
                <p style={{ color: '#94a3b8', fontSize: 14, margin: 0 }}>
                    Accuracy tracking, correction learning, opportunity alerts, festival uplift, and engine configuration.
                </p>
            </div>

            {/* Tab Bar */}
            <div style={{ display: 'flex', gap: 4, marginBottom: 28, borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                {TABS.map(tab => (
                    <button key={tab.key} onClick={() => setActiveTab(tab.key)} style={{
                        padding: '10px 22px', borderRadius: '8px 8px 0 0', fontSize: 13, fontWeight: 600, cursor: 'pointer', transition: 'all 0.2s',
                        background: activeTab === tab.key ? 'rgba(56,189,248,0.12)' : 'transparent',
                        color: activeTab === tab.key ? '#38bdf8' : '#94a3b8',
                        border: 'none',
                        borderBottom: activeTab === tab.key ? '2px solid #38bdf8' : '2px solid transparent',
                    }}>
                        {tab.label}
                    </button>
                ))}
            </div>

            {activeTab === 'accuracy' && <AccuracyTab />}
            {activeTab === 'correction' && <CorrectionIntelligenceTab />}
            {activeTab === 'marketplace' && <MarketplaceIntelligenceTab />}
            {activeTab === 'alerts' && <AlertsTab />}
            {activeTab === 'festivals' && <FestivalTab />}
            {activeTab === 'engine' && <EngineConfigTab />}
        </div>
    );
}
