import React, { useState, useEffect } from 'react';
import { ForecastSummaryCard } from './ForecastComponents';
import { fetchOrderHistory, getRestaurantList, buildRestaurantForecast } from './forecastHelpers';
import {
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer
} from 'recharts';

export default function ForecastOverviewPage() {
    const [loading, setLoading] = useState(true);
    const [stats, setStats] = useState({
        totalMon: 0, totalThu: 0, totalWeekly: 0, activeEvents: 0, totalItems: 0
    });
    const [chartData, setChartData] = useState([]);

    const fetchOverview = async () => {
        setLoading(true);
        try {
            const records = await fetchOrderHistory(12);
            if (records.length === 0) {
                setStats({ totalMon: 0, totalThu: 0, totalWeekly: 0, activeEvents: 0, totalItems: 0 });
                setChartData([]);
                setLoading(false);
                return;
            }

            const restaurants = getRestaurantList(records);
            let tMon = 0, tThu = 0, tWeek = 0, tItems = 0;
            const catMap = {};
            const seenItems = new Set();

            for (const rest of restaurants) {
                const forecast = buildRestaurantForecast(records, rest);
                forecast.forEach(item => {
                    const mondayQty = item.mondayQty || 0;
                    const thursdayQty = item.thursdayQty || 0;
                    const total = mondayQty + thursdayQty;
                    if (total <= 0) return;

                    if (!seenItems.has(item.itemName)) {
                        seenItems.add(item.itemName);
                        tItems++;
                    }
                    tMon += mondayQty;
                    tThu += thursdayQty;
                    tWeek += total;

                    const cat = item.category || 'Other';
                    if (!catMap[cat]) catMap[cat] = { name: cat, Monday: 0, Thursday: 0 };
                    catMap[cat].Monday += mondayQty;
                    catMap[cat].Thursday += thursdayQty;
                });
            }

            setStats({ totalMon: tMon, totalThu: tThu, totalWeekly: tWeek, totalItems: tItems, activeEvents: 0 });
            setChartData(Object.values(catMap).sort((a, b) => (b.Monday + b.Thursday) - (a.Monday + a.Thursday)).slice(0, 10));
        } catch (err) {
            console.error('ForecastOverviewPage load error', err);
        }
        setLoading(false);
    };

    useEffect(() => { fetchOverview(); }, []);

    if (loading) return <div className="page-padding loader-text">Generating Forecast Engine Data...</div>;

    return (
        <div className="forecast-dashboard fade-in">
            <div className="flex-between" style={{ marginBottom: 24 }}>
                <div>
                    <h2>AI Delivery Forecast Overview</h2>
                    <p className="text-muted">Predicting next week's demand and logistics load from live Firestore order history.</p>
                </div>
                <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
                    <button className="ui-btn secondary" onClick={fetchOverview} disabled={loading}>
                        <span className="link-icon">↻</span> Refresh Data
                    </button>
                    <button className="ui-btn primary" disabled={loading}>
                        <span className="link-icon">✅</span> Engine Synced
                    </button>
                </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 20, marginBottom: 24 }}>
                <ForecastSummaryCard title="Monday Delivery Total" value={`${stats.totalMon.toLocaleString()} units`} subtitle="Across all regions" icon="📦" color="#4dabf7" />
                <ForecastSummaryCard title="Thursday Delivery Total" value={`${stats.totalThu.toLocaleString()} units`} subtitle="Weekend prep load" icon="🚚" color="#845ef7" />
                <ForecastSummaryCard title="Total Weekly Volume" value={`${stats.totalWeekly.toLocaleString()} units`} subtitle={`Forecasted for ${stats.totalItems} items`} icon="📈" color="#4ade80" />
                <ForecastSummaryCard title="Active Events/Festivals" value={stats.activeEvents} subtitle="Impacting next week's demand" icon="🎉" color="#ff6b7a" />
            </div>

            <div className="ui-card" style={{ padding: 24, paddingBottom: 40 }}>
                <h3 style={{ marginTop: 0, marginBottom: 20 }}>Forecasted Category Demand Split</h3>
                <div style={{ height: 400, width: '100%' }}>
                    <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={chartData} margin={{ top: 10, right: 30, left: 0, bottom: 20 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                            <XAxis dataKey="name" stroke="var(--text-secondary)" tick={{ fill: 'var(--text-secondary)' }} angle={-45} textAnchor="end" height={60} />
                            <YAxis stroke="var(--text-secondary)" tick={{ fill: 'var(--text-secondary)' }} />
                            <Tooltip contentStyle={{ backgroundColor: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text-primary)' }} />
                            <Legend verticalAlign="top" height={36} />
                            <Bar dataKey="Monday" stackId="a" fill="#4dabf7" radius={[0, 0, 4, 4]} />
                            <Bar dataKey="Thursday" stackId="a" fill="#845ef7" radius={[4, 4, 0, 0]} />
                        </BarChart>
                    </ResponsiveContainer>
                </div>
            </div>
        </div>
    );
}
