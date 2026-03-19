/**
 * VendorAvailabilityCalendar.js
 * 
 * Allows vendors to mark closed/holiday/blackout dates.
 * Stored in vendors/{vendorId}/availability/{year-month} docs.
 */
import React, { useState, useEffect, useContext } from 'react';
import { UserContext } from '../../contexts/UserContext';
import { db } from '../../firebase';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { toast } from 'react-toastify';

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const AVAILABILITY_TYPES = {
    available: { label: 'Available', color: '#10b981', bg: 'rgba(16,185,129,0.1)' },
    closed: { label: 'Closed', color: '#f43f5e', bg: 'rgba(244,63,94,0.12)' },
    holiday: { label: 'Holiday', color: '#f59e0b', bg: 'rgba(245,158,11,0.12)' },
    reduced: { label: 'Reduced Capacity', color: '#a855f7', bg: 'rgba(168,85,247,0.12)' },
    no_delivery: { label: 'No Delivery', color: '#64748b', bg: 'rgba(100,116,139,0.12)' },
};

function getMonthDays(year, month) {
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const days = [];
    for (let i = 0; i < firstDay; i++) days.push(null);
    for (let d = 1; d <= daysInMonth; d++) days.push(d);
    return days;
}

export default function VendorAvailabilityCalendar() {
    const { vendorId } = useContext(UserContext);
    const [currentDate, setCurrentDate] = useState(new Date());
    const [dayStatuses, setDayStatuses] = useState({}); // { '2026-03-19': 'closed', ... }
    const [saving, setSaving] = useState(false);
    const [selectedType, setSelectedType] = useState('closed');

    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    const monthKey = `${year}-${String(month + 1).padStart(2, '0')}`;
    const monthName = currentDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    const days = getMonthDays(year, month);
    const today = new Date();
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

    useEffect(() => {
        if (!vendorId) return;
        (async () => {
            try {
                const ref = doc(db, `vendors/${vendorId}/availability`, monthKey);
                const snap = await getDoc(ref);
                if (snap.exists()) {
                    setDayStatuses(snap.data().days || {});
                } else {
                    setDayStatuses({});
                }
            } catch (err) {
                console.error('Error loading availability:', err);
            }
        })();
    }, [vendorId, monthKey]);

    const toggleDay = (day) => {
        if (!day) return;
        const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        // Don't allow marking past dates
        if (new Date(dateStr) < new Date(todayStr)) return;

        setDayStatuses(prev => {
            const next = { ...prev };
            if (next[dateStr] === selectedType) {
                delete next[dateStr];
            } else {
                next[dateStr] = selectedType;
            }
            return next;
        });
    };

    const handleSave = async () => {
        if (!vendorId) return;
        setSaving(true);
        try {
            const ref = doc(db, `vendors/${vendorId}/availability`, monthKey);
            await setDoc(ref, {
                vendorId,
                month: monthKey,
                days: dayStatuses,
                updatedAt: serverTimestamp(),
            }, { merge: true });
            toast.success(`Availability saved for ${monthName}`);
        } catch (err) {
            console.error('Error saving availability:', err);
            toast.error('Failed to save availability');
        } finally {
            setSaving(false);
        }
    };

    const prevMonth = () => setCurrentDate(new Date(year, month - 1, 1));
    const nextMonth = () => setCurrentDate(new Date(year, month + 1, 1));

    const closedCount = Object.values(dayStatuses).filter(v => v === 'closed').length;
    const holidayCount = Object.values(dayStatuses).filter(v => v === 'holiday').length;
    const reducedCount = Object.values(dayStatuses).filter(v => v === 'reduced').length;
    const noDeliveryCount = Object.values(dayStatuses).filter(v => v === 'no_delivery').length;

    return (
        <div style={{ padding: '24px 32px', maxWidth: 900, margin: '0 auto', color: '#f8fafc' }}>
            <div style={{ marginBottom: 24 }}>
                <h1 style={{ fontSize: 24, fontWeight: 700, margin: '0 0 8px' }}>📅 Availability Calendar</h1>
                <p style={{ color: '#94a3b8', fontSize: 14, margin: 0 }}>Mark closed dates, holidays, and reduced capacity days. This influences dispatch expectations.</p>
            </div>

            {/* Type Selector */}
            <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
                {Object.entries(AVAILABILITY_TYPES).filter(([k]) => k !== 'available').map(([key, cfg]) => (
                    <button key={key} onClick={() => setSelectedType(key)} style={{
                        padding: '6px 16px', borderRadius: 6, fontSize: 12, fontWeight: 600,
                        border: `1px solid ${selectedType === key ? cfg.color : 'rgba(255,255,255,0.1)'}`,
                        background: selectedType === key ? cfg.bg : 'transparent',
                        color: selectedType === key ? cfg.color : '#94a3b8',
                        cursor: 'pointer',
                    }}>{cfg.label}</button>
                ))}
            </div>

            {/* Month Navigation */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                <button onClick={prevMonth} style={{ padding: '6px 14px', borderRadius: 6, border: '1px solid rgba(255,255,255,0.1)', background: 'transparent', color: '#94a3b8', cursor: 'pointer', fontSize: 14 }}>← Prev</button>
                <div style={{ fontSize: 18, fontWeight: 700 }}>{monthName}</div>
                <button onClick={nextMonth} style={{ padding: '6px 14px', borderRadius: 6, border: '1px solid rgba(255,255,255,0.1)', background: 'transparent', color: '#94a3b8', cursor: 'pointer', fontSize: 14 }}>Next →</button>
            </div>

            {/* Calendar Grid */}
            <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 12, overflow: 'hidden', marginBottom: 20 }}>
                {/* Day Headers */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                    {DAY_NAMES.map(d => (
                        <div key={d} style={{ padding: '10px 0', textAlign: 'center', fontSize: 12, fontWeight: 700, color: '#64748b', textTransform: 'uppercase' }}>{d}</div>
                    ))}
                </div>
                {/* Days */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)' }}>
                    {days.map((day, i) => {
                        if (!day) return <div key={`empty-${i}`} style={{ padding: 12 }} />;
                        const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                        const status = dayStatuses[dateStr];
                        const cfg = AVAILABILITY_TYPES[status] || AVAILABILITY_TYPES.available;
                        const isToday = dateStr === todayStr;
                        const isPast = new Date(dateStr) < new Date(todayStr);

                        return (
                            <div key={day}
                                onClick={() => toggleDay(day)}
                                style={{
                                    padding: '10px 4px', textAlign: 'center',
                                    background: status ? cfg.bg : 'transparent',
                                    cursor: isPast ? 'default' : 'pointer',
                                    opacity: isPast ? 0.4 : 1,
                                    border: isToday ? '2px solid #38bdf8' : '1px solid rgba(255,255,255,0.03)',
                                    transition: 'all 0.15s',
                                }}
                            >
                                <div style={{ fontSize: 15, fontWeight: isToday ? 800 : 500, color: status ? cfg.color : '#e2e8f0', marginBottom: 2 }}>{day}</div>
                                {status && <div style={{ fontSize: 9, color: cfg.color, fontWeight: 700, textTransform: 'uppercase' }}>{cfg.label}</div>}
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* Summary + Save */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', gap: 16, fontSize: 12, color: '#94a3b8' }}>
                    {closedCount > 0 && <span>🔴 {closedCount} Closed</span>}
                    {holidayCount > 0 && <span>🟡 {holidayCount} Holiday</span>}
                    {reducedCount > 0 && <span>🟣 {reducedCount} Reduced</span>}
                    {noDeliveryCount > 0 && <span>⚫ {noDeliveryCount} No Delivery</span>}
                    {closedCount + holidayCount + reducedCount + noDeliveryCount === 0 && <span>All days available</span>}
                </div>
                <button onClick={handleSave} disabled={saving} style={{
                    padding: '10px 24px', borderRadius: 8, border: 'none',
                    background: '#10b981', color: '#fff', fontSize: 14, fontWeight: 700,
                    cursor: 'pointer', opacity: saving ? 0.6 : 1,
                }}>
                    {saving ? 'Saving...' : '💾 Save Availability'}
                </button>
            </div>

            <div style={{ marginTop: 20, fontSize: 12, color: '#475569', fontStyle: 'italic', textAlign: 'center' }}>
                Click a date to mark it. Click again to remove. Past dates cannot be modified. Availability is saved per month.
            </div>
        </div>
    );
}
