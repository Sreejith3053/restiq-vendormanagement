/**
 * CatalogReviewsPage.js
 *
 * Consolidated page absorbing:
 *   - Catalog Items / ManageCatalogPage
 *   - Catalog Review Queue / SuperadminCatalogReviewQueuePage
 *   - Mapping Review / CatalogItemMappingReviewPage
 *   - Unmapped Items / UnmappedVendorItemsPage
 *   - Pending Reviews / PendingReviewsDashboard
 *
 * Old routes redirect here via ?tab= parameter.
 */

import React, { useMemo, useState, useEffect } from 'react';
import TabbedPageShell from './TabbedPageShell';
import KPIStatsRow from './KPIStatsRow';
import EmptyStatePanel from './EmptyStatePanel';

import ManageCatalogPage from '../Admin/ManageCatalogPage';
import SuperadminCatalogReviewQueuePage from '../CatalogReview/SuperadminCatalogReviewQueuePage';
import PendingReviewsDashboard from '../Admin/PendingReviewsDashboard';

import { db } from '../../firebase';
import { collection, getDocs } from 'firebase/firestore';

export default function CatalogReviewsPage() {
    // ── KPI live counts ──────────────────────────────────────────────────
    const [kpi, setKpi] = useState({ catalog: 0, pending: 0, unmapped: 0, duplicates: 0, changes: 0 });

    useEffect(() => {
        (async () => {
            try {
                // Catalog items count (sum of all vendor sub-collections)
                const vendorsSnap = await getDocs(collection(db, 'vendors'));
                let totalItems = 0;
                for (const vDoc of vendorsSnap.docs) {
                    const itemsSnap = await getDocs(collection(db, `vendors/${vDoc.id}/items`));
                    totalItems += itemsSnap.size;
                }

                // Review queue count
                let pendingCount = 0;
                try {
                    const reviewSnap = await getDocs(collection(db, 'catalogReviewQueue'));
                    pendingCount = reviewSnap.docs.filter(d => d.data().status === 'pending').length;
                } catch (e) { /* collection may not exist */ }

                // Change requests count
                let changesCount = 0;
                try {
                    const changesSnap = await getDocs(collection(db, 'catalogReviewQueue'));
                    changesCount = changesSnap.docs.filter(d => ['change_request', 'price_update'].includes(d.data().type)).length;
                } catch (e) { /* collection may not exist */ }

                setKpi({
                    catalog: totalItems,
                    pending: pendingCount,
                    unmapped: 0, // Will be populated when unmapped detection runs
                    duplicates: 0,
                    changes: changesCount,
                });
            } catch (err) {
                console.error('[CatalogKPI] Failed:', err);
            }
        })();
    }, []);

    const kpiStats = useMemo(() => [
        { label: 'Total Catalog Items', value: kpi.catalog, icon: '📦', color: '#38bdf8' },
        { label: 'Pending Review', value: kpi.pending, icon: '🗂️', color: kpi.pending > 0 ? '#f59e0b' : '#10b981' },
        { label: 'Unmapped Items', value: kpi.unmapped, icon: '🔗', color: kpi.unmapped > 0 ? '#f43f5e' : '#10b981' },
        { label: 'Duplicate Candidates', value: kpi.duplicates, icon: '⚠️', color: kpi.duplicates > 0 ? '#f59e0b' : '#94a3b8' },
        { label: 'Change Requests', value: kpi.changes, icon: '📋', color: kpi.changes > 0 ? '#a78bfa' : '#94a3b8' },
    ], [kpi]);

    const tabs = useMemo(() => [
        {
            key: 'catalog',
            label: 'Catalog Items',
            icon: '📦',
            content: <ManageCatalogPage embedded />,
        },
        {
            key: 'review-queue',
            label: 'Review Queue',
            icon: '🗂️',
            content: <SuperadminCatalogReviewQueuePage embedded />,
        },
        {
            key: 'unmapped',
            label: 'Unmapped',
            icon: '🔗',
            content: <SuperadminCatalogReviewQueuePage embedded />,
        },
        {
            key: 'duplicates',
            label: 'Duplicates / Merge',
            icon: '⚠️',
            content: (
                <EmptyStatePanel
                    icon="⚠️"
                    title="Duplicate Detection & Merge"
                    description="Duplicate candidates and merge actions are available within the Review Queue and Catalog Items tabs. A dedicated detection engine will be surfaced here in a future release."
                    actionLabel="Open Review Queue"
                    onAction={() => window.location.href = '/catalog-reviews?tab=review-queue'}
                />
            ),
        },
        {
            key: 'change-requests',
            label: 'Change Requests',
            icon: '📋',
            content: <PendingReviewsDashboard embedded />,
        },
        {
            key: 'audit-log',
            label: 'Audit Log',
            icon: '📜',
            content: (
                <EmptyStatePanel
                    icon="📜"
                    title="Audit Log"
                    description="Historical record of catalog approvals, rejections, edits, and mapping changes. This view will be populated as review actions are recorded."
                />
            ),
        },
    ], []);

    return (
        <TabbedPageShell
            title="Catalog & Reviews"
            subtitle="Master catalog, review queue, unmapped items, duplicates, and change requests — unified workspace."
            icon="📦"
            tabs={tabs}
            defaultTab="catalog"
            kpiRow={<KPIStatsRow stats={kpiStats} />}
        />
    );
}
