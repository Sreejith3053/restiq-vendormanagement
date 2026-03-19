/**
 * OrdersFulfillmentPage.js
 *
 * Consolidated page absorbing:
 *   - All Orders / OrdersPage
 *   - Submitted Orders / SubmittedOrdersPage
 *   - Dispatch Confirmations / DispatchConfirmationsPage
 *   - Delivery Status / DeliveryStatusPage
 *   - Issues & Disputes / IssuesDisputesPage
 *
 * Old routes redirect here via ?tab= parameter.
 */

import React, { useMemo } from 'react';
import TabbedPageShell from './TabbedPageShell';

// Embed existing page components as tab content
import OrdersPage from '../Orders/OrdersPage';
import SubmittedOrdersPage from '../Forecast/SubmittedOrdersPage';
import DispatchConfirmationsPage from '../Forecast/DispatchConfirmationsPage';
import DeliveryStatusPage from '../Forecast/DeliveryStatusPage';
import IssuesDisputesPage from '../Forecast/IssuesDisputesPage';

export default function OrdersFulfillmentPage() {
    const tabs = useMemo(() => [
        {
            key: 'overview',
            label: 'Overview',
            icon: '📊',
            content: <OrdersPage embedded />,
        },
        {
            key: 'submitted',
            label: 'Submitted',
            icon: '✅',
            content: <SubmittedOrdersPage embedded />,
        },
        {
            key: 'dispatch',
            label: 'Dispatch',
            icon: '📋',
            content: <DispatchConfirmationsPage embedded />,
        },
        {
            key: 'delivery',
            label: 'Delivery',
            icon: '📍',
            content: <DeliveryStatusPage embedded />,
        },
        {
            key: 'issues',
            label: 'Issues',
            icon: '🚨',
            content: <IssuesDisputesPage embedded />,
        },
    ], []);

    return (
        <TabbedPageShell
            title="Orders & Fulfillment"
            subtitle="Manage submitted orders, dispatch, delivery, and resolve issues — all in one place."
            icon="⚙️"
            tabs={tabs}
            defaultTab="overview"
        />
    );
}
