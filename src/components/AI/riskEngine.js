/**
 * riskEngine.js
 *
 * Detects operational supply risks across the marketplace.
 * Risk types: Supply Shortage, Single Vendor Dependency, Vendor Reliability.
 *
 * Input:  vendors/{id}/items, submittedOrders, vendorDispatchRoutes, issuesDisputes
 * Output: riskAlerts[] sorted by severity
 */
import { db } from '../../firebase';
import { collection, getDocs } from 'firebase/firestore';

// ── Risk levels ──────────────────────────────────────────────────────────────
const RISK = { HIGH: 'HIGH', MEDIUM: 'MEDIUM', LOW: 'LOW' };
const RISK_PRIORITY = { HIGH: 3, MEDIUM: 2, LOW: 1 };

// ── Helpers ──────────────────────────────────────────────────────────────────

function getActiveWeekStart() {
    const now = new Date();
    const day = now.getDay();
    const diff = now.getDate() - day + (day === 0 ? -6 : 1);
    const monday = new Date(now.setDate(diff));
    return monday.toISOString().slice(0, 10);
}

function daysAgo(n) {
    const d = new Date();
    d.setDate(d.getDate() - n);
    return d;
}

// ── Main computation ─────────────────────────────────────────────────────────

export async function computeRiskAlerts() {
    const weekStart = getActiveWeekStart();
    const alerts = [];

    // 1. Load vendor catalog — track which vendors supply which items
    const vendorsSnap = await getDocs(collection(db, 'vendors'));
    const vendors = vendorsSnap.docs.map(d => ({ id: d.id, ...d.data() }));

    const itemVendorMap = {}; // groupingKey → Set of vendorNames
    const vendorNames = {};   // vendorId → name
    for (const v of vendors) {
        vendorNames[v.id] = v.name || 'Unknown';
        try {
            const itemSnap = await getDocs(collection(db, `vendors/${v.id}/items`));
            itemSnap.docs.forEach(d => {
                const data = d.data();
                const name = (data.name || '').trim().toLowerCase();
                if (!name) return;
                // Prefer catalogItemId for grouping, fallback to lowercase name
                const key = data.catalogItemId || name;
                if (!itemVendorMap[key]) itemVendorMap[key] = { vendors: new Set(), displayName: (data.name || '').trim() };
                itemVendorMap[key].vendors.add(v.name || 'Unknown');
            });
        } catch (e) { /* skip */ }
    }

    // 2. Load submitted orders for current week demand
    let weekDemand = {}; // itemName(lower) → totalQty
    try {
        const soSnap = await getDocs(collection(db, 'submittedOrders'));
        soSnap.docs.forEach(d => {
            const data = d.data();
            if (data.weekStart !== weekStart) return;
            (data.items || []).forEach(line => {
                const name = (line.itemName || '').trim().toLowerCase();
                if (!name) return;
                weekDemand[name] = (weekDemand[name] || 0) + (Number(line.finalQty) || 0);
            });
        });
    } catch (e) {
        console.warn('[RiskEngine] Could not load submitted orders:', e);
    }

    // 3. RISK TYPE 1 — Single Vendor Dependency
    Object.entries(itemVendorMap).forEach(([itemKey, entry]) => {
        if (entry.vendors.size === 1) {
            const vendor = [...entry.vendors][0];
            const demand = weekDemand[itemKey] || 0;
            const displayName = entry.displayName || itemKey.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
            alerts.push({
                id: `svd_${itemKey}`,
                type: 'Single Vendor Dependency',
                risk: demand > 0 ? RISK.HIGH : RISK.MEDIUM,
                icon: '🔗',
                itemName: displayName,
                vendor,
                demand,
                detail: `Only 1 vendor (${vendor}) supplies this item${demand > 0 ? ` — ${demand} units ordered this week` : ''}`,
            });
        }
    });

    // 4. RISK TYPE 2 — Supply Shortage (high demand vs few vendors)
    Object.entries(weekDemand).forEach(([itemName, totalQty]) => {
        const mapEntry = itemVendorMap[itemName];
        const vendorCount = mapEntry?.vendors?.size || 0;
        // Heuristic: if demand > 15 per vendor, flag as shortage risk
        const capacityPerVendor = 15;
        const totalCapacity = vendorCount * capacityPerVendor;
        if (totalQty > totalCapacity && vendorCount > 0) {
            const displayName = (mapEntry?.displayName) || itemName.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
            alerts.push({
                id: `shortage_${itemName}`,
                type: 'Supply Shortage',
                risk: totalQty > totalCapacity * 1.5 ? RISK.HIGH : RISK.MEDIUM,
                icon: '📦',
                itemName: displayName,
                demand: totalQty,
                estimatedCapacity: totalCapacity,
                vendorCount,
                detail: `Demand (${totalQty}) exceeds estimated capacity (${totalCapacity}) across ${vendorCount} vendor${vendorCount > 1 ? 's' : ''}`,
            });
        }
    });

    // 5. RISK TYPE 3 — Vendor Reliability (issues in last 30 days)
    let vendorIssues = {}; // vendorName → count
    try {
        const cutoff = daysAgo(30);
        const issuesSnap = await getDocs(collection(db, 'issuesDisputes'));
        issuesSnap.docs.forEach(d => {
            const data = d.data();
            const createdAt = data.createdAt?.toDate ? data.createdAt.toDate() : null;
            if (createdAt && createdAt < cutoff) return;
            const vendor = data.vendorName || 'Unknown';
            vendorIssues[vendor] = (vendorIssues[vendor] || 0) + 1;
        });
    } catch (e) {
        console.warn('[RiskEngine] Could not load issues:', e);
    }

    Object.entries(vendorIssues).forEach(([vendorName, issueCount]) => {
        // Reliability score: 100 - (issues * 5), clamped to 0-100
        const reliabilityScore = Math.max(0, Math.min(100, 100 - issueCount * 5));
        let risk = RISK.LOW;
        if (reliabilityScore < 60) risk = RISK.HIGH;
        else if (reliabilityScore < 80) risk = RISK.MEDIUM;

        if (reliabilityScore < 90) {
            alerts.push({
                id: `reliability_${vendorName}`,
                type: 'Vendor Reliability',
                risk,
                icon: '⚡',
                vendor: vendorName,
                reliabilityScore,
                issueCount,
                detail: `${vendorName} — reliability score ${reliabilityScore}/100 (${issueCount} issue${issueCount > 1 ? 's' : ''} in last 30 days)`,
            });
        }
    });

    // Sort by risk severity descending
    alerts.sort((a, b) => (RISK_PRIORITY[b.risk] || 0) - (RISK_PRIORITY[a.risk] || 0));

    return {
        alerts,
        summary: {
            total: alerts.length,
            high: alerts.filter(a => a.risk === RISK.HIGH).length,
            medium: alerts.filter(a => a.risk === RISK.MEDIUM).length,
            low: alerts.filter(a => a.risk === RISK.LOW).length,
        },
    };
}
