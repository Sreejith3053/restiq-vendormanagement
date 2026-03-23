/**
 * CatalogReviewsPage.js
 *
 * Consolidated Catalog & Review page.
 *
 * ════════════════════════════════════════════════════════════════
 * REVIEW WORKFLOW SOURCE OF TRUTH
 * ════════════════════════════════════════════════════════════════
 *
 * The Review Queue (SuperadminCatalogReviewQueuePage) reads from
 * `catalogReviewQueue` via reviewQueueService.
 *
 * The top KPI cards on this page use the EXACT same source
 * (reviewQueueService.getReviewQueueSummary) to guarantee the
 * "Pending Review" card matches the Review Queue table count.
 *
 * ── Count Definitions ───────────────────────────────────────────
 *   Pending Review   = catalogReviewQueue where status == "pending"
 *                      (matches what the table shows by default)
 *   Unmapped Items   = vendor items missing catalogItemId
 *   Total Catalog Items = catalogItems collection count
 *   Duplicate Candidates = catalogReviewQueue possible_duplicate count
 *
 * ════════════════════════════════════════════════════════════════
 */

import React, { useMemo, useState, useEffect } from 'react';
import TabbedPageShell from './TabbedPageShell';
import KPIStatsRow from './KPIStatsRow';
import EmptyStatePanel from './EmptyStatePanel';

import ManageCatalogPage from '../Admin/ManageCatalogPage';
import SuperadminCatalogReviewQueuePage from '../CatalogReview/SuperadminCatalogReviewQueuePage';

// The Review Queue table uses reviewQueueService — we must use the same source here
// so that the "Pending Review" KPI card matches the table count exactly.
import { getReviewQueueSummary } from '../CatalogReview/reviewQueueService';

import { db } from '../../firebase';
import { collection, getDocs } from 'firebase/firestore';

export default function CatalogReviewsPage() {
    const [kpi, setKpi] = useState({ catalog: 0, pending: 0, unmapped: 0, duplicates: 0 });

    useEffect(() => {
        (async () => {
            try {
                // ── A. Catalog Items count from `catalogItems` collection ──
                // = approved/mapped master catalog records.
                let catalogCount = 0;
                try {
                    const catSnap = await getDocs(collection(db, 'catalogItems'));
                    catalogCount = catSnap.size;
                } catch (e) {
                    catalogCount = 0; // catalogItems empty or doesn't exist yet
                }

                // ── B. Review Queue KPIs — uses SAME source as the table ──
                // Pending Review = catalogReviewQueue status == "pending" (lowercase)
                // This guarantees the card matches what the Review Queue table shows.
                const summary = await getReviewQueueSummary().catch(() => ({
                    totalPending: 0, held: 0, unmappedVendorItems: 0, pendingDuplicates: 0,
                }));

                setKpi({
                    catalog:    catalogCount,
                    // Pending Review = pending + held (all unresolved review items)
                    pending:    (summary.totalPending || 0) + (summary.held || 0),
                    // Unmapped is already computed by reviewQueueService (same definition)
                    unmapped:   summary.unmappedVendorItems || 0,
                    duplicates: summary.pendingDuplicates || 0,
                });
            } catch (err) {
                console.error('[CatalogKPI] Failed:', err);
            }
        })();
    }, []);

    const kpiStats = useMemo(() => [
        {
            label:   'Total Catalog Items',
            value:   kpi.catalog,
            icon:    '📦',
            color:   '#38bdf8',
            // Clicking opens Catalog Items tab
            onClick: () => window.location.href = '/catalog-reviews?tab=catalog',
        },
        {
            label:   'Pending Review',
            value:   kpi.pending,
            icon:    '🗂️',
            color:   kpi.pending > 0 ? '#f59e0b' : '#10b981',
            // = unresolved review queue items (pending + held). Matches Review Queue table.
            // Clicking opens Review Queue default view
            onClick: () => window.location.href = '/catalog-reviews?tab=review-queue',
        },
        {
            label:   'Unmapped Items',
            value:   kpi.unmapped,
            icon:    '🔗',
            color:   kpi.unmapped > 0 ? '#f43f5e' : '#10b981',
            // = vendor items not yet linked to master catalog
            // Unmapped items are managed INSIDE Review Queue (unmapped filter)
            // Clicking opens Review Queue with Unmapped filter pre-selected
            onClick: () => window.location.href = '/catalog-reviews?tab=review-queue&filter=unmapped',
        },
        {
            label:   'Duplicate Candidates',
            value:   kpi.duplicates,
            icon:    '⚠️',
            color:   kpi.duplicates > 0 ? '#f59e0b' : '#94a3b8',
            onClick: () => window.location.href = '/catalog-reviews?tab=duplicates',
        },
    ], [kpi]);

    // ── SINGLE REVIEW SYSTEM: Review Queue only. No "Change Requests" tab. ──
    // NOTE: "Unmapped" is NOT a separate tab — unmapped items are managed
    // INSIDE Review Queue via the Unmapped filter. This prevents duplication
    // and keeps all review actions in one operational workspace.
    const tabs = useMemo(() => [
        {
            key:     'catalog',
            label:   'Catalog Items',
            icon:    '📦',
            content: <ManageCatalogPage embedded />,
        },
        {
            key:     'review-queue',
            label:   'Review Queue',
            icon:    '🗂️',
            // defaultFilter from URL ?filter= parameter
            content: <SuperadminCatalogReviewQueuePage embedded />,
        },
        {
            key:     'duplicates',
            label:   'Duplicates / Merge',
            icon:    '⚠️',
            content: (
                <EmptyStatePanel
                    icon="⚠️"
                    title="Duplicate Detection & Merge"
                    description="Duplicate candidates can be reviewed in the Review Queue tab (⚠️ Duplicates filter)."
                    actionLabel="Open Review Queue"
                    onAction={() => window.location.href = '/catalog-reviews?tab=review-queue'}
                />
            ),
        },
        {
            key:     'audit-log',
            label:   'Audit Log',
            icon:    '📜',
            content: (
                <EmptyStatePanel
                    icon="📜"
                    title="Audit Log"
                    description="Historical record of catalog approvals, rejections, edits, and mapping changes."
                />
            ),
        },
    ], []);

    return (
        <TabbedPageShell
            title="Catalog & Reviews"
            subtitle={
                <>
                    Master catalog and unified review workspace.{' '}
                    <span style={{ fontSize: 11, color: '#334155' }}>
                        Unmapped items are managed within Review Queue.
                    </span>
                </>
            }
            icon="📦"
            tabs={tabs}
            defaultTab="catalog"
            kpiRow={<KPIStatsRow stats={kpiStats} />}
        />
    );
}
