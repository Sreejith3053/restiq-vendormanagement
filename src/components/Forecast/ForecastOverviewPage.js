import React, { useState, useEffect } from 'react';
import { collection, query, where, getDocs, orderBy, limit } from 'firebase/firestore';
import { db } from '../../firebase';
import { TrendBadge, ForecastSummaryCard } from './ForecastComponents';
import { runClientSideMockSeeder } from './mockSeeder';
import {
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer
} from 'recharts';

export default function ForecastOverviewPage() {
    const [loading, setLoading] = useState(true);
    const [stats, setStats] = useState({
        totalMon: 0, totalThu: 0, totalWeekly: 0, activeEvents: 0, totalItems: 0
    });
    const [chartData, setChartData] = useState([]);

    useEffect(() => {
        fetchOverview();
    }, []);

    const fetchOverview = async () => {
        setLoading(true);
        try {
            // Find current week start key
            const d = new Date();
            d.setHours(0, 0, 0, 0);
            d.setDate(d.getDate() + ((1 + 7 - d.getDay()) % 7));
            const yyyy = d.getFullYear();
            const mm = String(d.getMonth() + 1).padStart(2, '0');
            const dd = String(d.getDate()).padStart(2, '0');
            const weekKey = `${yyyy}-${mm}-${dd}`;

            // Aggregates
            const aggSnap = await getDocs(query(collection(db, 'aggregateItemForecasts'), where('weekStart', '==', weekKey)));
            let tMon = 0, tThu = 0, tWeek = 0, tItems = 0;
            const catMap = {};

            aggSnap.forEach(doc => {
                const data = doc.data();
                tItems++;
                tMon += data.totalPredictedMondayDeliveryQty || 0;
                tThu += data.totalPredictedThursdayDeliveryQty || 0;
                tWeek += data.totalPredictedWeeklyQty || 0;

                const cat = data.category || 'Other';
                if (!catMap[cat]) catMap[cat] = { name: cat, Monday: 0, Thursday: 0 };
                catMap[cat].Monday += data.totalPredictedMondayDeliveryQty || 0;
                catMap[cat].Thursday += data.totalPredictedThursdayDeliveryQty || 0;
            });

            // Events
            const eventsSnap = await getDocs(query(collection(db, 'festivalCalendar'), where('isActive', '==', true)));

            setStats({
                totalMon: tMon,
                totalThu: tThu,
                totalWeekly: tWeek,
                totalItems: tItems,
                activeEvents: eventsSnap.size
            });

            setChartData(Object.values(catMap).sort((a, b) => (b.Monday + b.Thursday) - (a.Monday + a.Thursday)).slice(0, 10));

        } catch (err) {
            console.error("Error fetching overview:", err);
        } finally {
            setLoading(false);
        }
    };

    if (loading) return <div className="page-padding loader-text">Generating Forecast Engine Data...</div>;

    const handleSeedData = async () => {
        await runClientSideMockSeeder(db);
        window.location.reload();
    };

    return (
        <div className="forecast-dashboard fade-in">
            <div className="flex-between" style={{ marginBottom: 24 }}>
                <div>
                    <h2>AI Delivery Forecast Overview</h2>
                    <p className="text-muted">Predicting next week's demand and logistics load.</p>
                </div>
                <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
                    {/* <button className="ui-btn secondary" onClick={handleSeedData}>
                        <span className="link-icon">⚙️</span> Run Mock Seeder
                    </button> */}
                    <button className="ui-btn primary ghost" onClick={fetchOverview}>
                        <span className="link-icon">↻</span> Refresh Data
                    </button>
                </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 20, marginBottom: 24 }}>
                <ForecastSummaryCard title="Monday Delivery Total" value={stats.totalMon.toLocaleString()} subtitle="Across all regions" icon="📦" color="#4dabf7" />
                <ForecastSummaryCard title="Thursday Delivery Total" value={stats.totalThu.toLocaleString()} subtitle="Weekend prep load" icon="🚚" color="#845ef7" />
                <ForecastSummaryCard title="Total Weekly Volume" value={stats.totalWeekly.toLocaleString()} subtitle={`Forecasted for ${stats.totalItems} items`} icon="📈" color="#4ade80" />
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
