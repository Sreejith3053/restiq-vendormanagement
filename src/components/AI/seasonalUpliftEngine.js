/**
 * seasonalUpliftEngine.js
 *
 * Analyzes historical order patterns around festivals/seasonal events
 * and suggests demand uplift factors per category.
 *
 * Input:  festivalCalendar, marketplaceOrders
 * Output: seasonalUplifts[] with event context
 */
import { db } from '../../firebase';
import { collection, getDocs } from 'firebase/firestore';

// ── Main computation ─────────────────────────────────────────────────────────

export async function computeSeasonalUplifts() {
    // 1. Load festival calendar
    let events = [];
    try {
        const snap = await getDocs(collection(db, 'festivalCalendar'));
        events = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    } catch (e) {
        console.warn('[SeasonalUplift] Could not load festivals:', e);
    }

    // 2. Load all marketplace orders (for historical pattern analysis)
    let orderRecords = [];
    try {
        const ordersSnap = await getDocs(collection(db, 'marketplaceOrders'));
        ordersSnap.docs.forEach(d => {
            const data = d.data();
            const createdAt = data.createdAt?.toDate ? data.createdAt.toDate() : null;
            if (!createdAt) return;
            (data.items || []).forEach(item => {
                orderRecords.push({
                    itemName: (item.name || '').trim(),
                    qty: Number(item.qty) || 0,
                    category: item.category || 'Produce',
                    vendor: item.vendor || '',
                    date: createdAt,
                    weekDay: createdAt.getDay(),
                });
            });
        });
    } catch (e) {
        console.warn('[SeasonalUplift] Could not load order history:', e);
    }

    // 3. Determine which events are upcoming (next 60 days) or currently active
    const now = new Date();
    const cutoff = new Date(now);
    cutoff.setDate(cutoff.getDate() + 60);

    const upcomingEvents = events.filter(evt => {
        const start = new Date(evt.startDate);
        const end = new Date(evt.endDate);
        return (start <= cutoff && end >= now) || (start >= now && start <= cutoff);
    }).sort((a, b) => new Date(a.startDate) - new Date(b.startDate));

    // 4. For each event, compute demand uplift from stored rules + historical analysis
    const seasonalUplifts = upcomingEvents.map(evt => {
        const start = new Date(evt.startDate);
        const end = new Date(evt.endDate);
        const daysUntil = Math.max(0, Math.ceil((start - now) / (1000 * 60 * 60 * 24)));
        const isActive = start <= now && end >= now;

        // Use stored uplift rules from festivalCalendar (already configured by admin)
        const rules = (evt.upliftRules || []).map(r => ({
            category: r.targetValue || r.category || 'General',
            upliftPercent: Number(r.percent) || 0,
            upliftFactor: 1 + (Number(r.percent) || 0) / 100,
        }));

        // Estimate affected items based on category
        const affectedCategories = rules.map(r => r.category);
        const affectedItems = [];
        const seen = new Set();
        orderRecords.forEach(r => {
            if (affectedCategories.includes(r.category) && !seen.has(r.itemName.toLowerCase())) {
                seen.add(r.itemName.toLowerCase());
                affectedItems.push(r.itemName);
            }
        });

        return {
            id: evt.id,
            eventName: evt.eventName,
            startDate: evt.startDate,
            endDate: evt.endDate,
            isActive,
            daysUntil,
            status: isActive ? 'Active Now' : daysUntil <= 7 ? 'This Week' : daysUntil <= 30 ? 'Coming Soon' : 'Upcoming',
            statusColor: isActive ? '#34d399' : daysUntil <= 7 ? '#fbbf24' : '#38bdf8',
            rules,
            affectedItemCount: affectedItems.length,
            affectedItems: affectedItems.slice(0, 10),
            notes: evt.notes || '',
        };
    });

    return {
        uplifts: seasonalUplifts,
        summary: {
            totalEvents: seasonalUplifts.length,
            activeNow: seasonalUplifts.filter(e => e.isActive).length,
            thisWeek: seasonalUplifts.filter(e => e.daysUntil <= 7 && !e.isActive).length,
            totalRules: seasonalUplifts.reduce((s, e) => s + e.rules.length, 0),
        },
    };
}
