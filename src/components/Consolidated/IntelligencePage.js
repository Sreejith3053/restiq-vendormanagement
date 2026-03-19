/**
 * IntelligencePage.js
 *
 * Consolidated page absorbing:
 *   - AI Intelligence Hub / AIIntelligenceHub
 *   - Marketplace Intelligence / MarketplaceIntelligencePage
 *   - Vendor Allocation / VendorAllocationDashboard
 *   - Supply Capacity / SupplyCapacityDashboard
 *   - Festival Calendar / FestivalSeasonalityPage
 *
 * Old routes redirect here via ?tab= parameter.
 */

import React, { useMemo } from 'react';
import TabbedPageShell from './TabbedPageShell';

import AIIntelligenceHub from '../AI/AIIntelligenceHub';
import MarketplaceIntelligencePage from '../Admin/MarketplaceIntelligencePage';
import VendorAllocationDashboard from '../Admin/VendorAllocationDashboard';
import SupplyCapacityDashboard from '../Admin/SupplyCapacityDashboard';
import FestivalSeasonalityPage from '../Forecast/FestivalSeasonalityPage';

export default function IntelligencePage() {
    const tabs = useMemo(() => [
        {
            key: 'ai-summary',
            label: 'AI Summary',
            icon: '🤖',
            content: <AIIntelligenceHub embedded />,
        },
        {
            key: 'price-intelligence',
            label: 'Price Intelligence',
            icon: '📊',
            content: <MarketplaceIntelligencePage embedded />,
        },
        {
            key: 'allocation',
            label: 'Allocation',
            icon: '📦',
            content: <VendorAllocationDashboard embedded />,
        },
        {
            key: 'capacity',
            label: 'Capacity',
            icon: '🛡️',
            content: <SupplyCapacityDashboard embedded />,
        },
        {
            key: 'seasonality',
            label: 'Seasonality',
            icon: '🎄',
            content: <FestivalSeasonalityPage embedded />,
        },
    ], []);

    return (
        <TabbedPageShell
            title="Intelligence"
            subtitle="AI insights, price comparisons, vendor allocation, supply capacity, and seasonal planning."
            icon="🧠"
            tabs={tabs}
            defaultTab="ai-summary"
        />
    );
}
