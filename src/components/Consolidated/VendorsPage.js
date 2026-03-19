/**
 * VendorsPage.js
 *
 * Consolidated page absorbing:
 *   - All Vendors / VendorListPage
 *   - Add Vendor / AddVendorPage
 *   - Vendor Competitiveness / VendorCompetitivenessDashboard
 *
 * This page replaces the old standalone sidebar entries for
 * Vendors and Add Vendor.
 *
 * Old routes redirect here via ?tab= parameter.
 */

import React, { useMemo } from 'react';
import TabbedPageShell from './TabbedPageShell';

import VendorListPage from '../Vendors/VendorListPage';
import AddVendorPage from '../Vendors/AddVendorPage';
import VendorCompetitivenessDashboard from '../Admin/VendorCompetitivenessDashboard';

export default function VendorsPage() {
    const tabs = useMemo(() => [
        {
            key: 'all',
            label: 'All Vendors',
            icon: '🏢',
            content: <VendorListPage />,
        },
        {
            key: 'onboarding',
            label: 'Onboarding / Add',
            icon: '➕',
            content: <AddVendorPage />,
        },
        {
            key: 'performance',
            label: 'Performance',
            icon: '🏆',
            content: <VendorCompetitivenessDashboard />,
        },
    ], []);

    return (
        <TabbedPageShell
            title="Vendors"
            subtitle="View all vendors, onboard new vendors, and track performance scores."
            icon="🏪"
            tabs={tabs}
            defaultTab="all"
        />
    );
}
