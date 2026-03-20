/**
 * PlatformAdminPage.js
 *
 * Consolidated page absorbing:
 *   - All Restaurants / AdminRestaurantsPage
 *   - Master Restaurants / ManageRestaurantsPage
 *   - Users & Roles / UserManagementPage
 *   - Role Permissions / RolePermissionsPage
 *   - Migration Tools / MigrationAdminPage
 *
 * Old routes redirect here via ?tab= parameter.
 */

import React, { useMemo, useState, useEffect } from 'react';
import TabbedPageShell from './TabbedPageShell';
import KPIStatsRow from './KPIStatsRow';

import AdminRestaurantsPage from '../Admin/AdminRestaurantsPage';
import UserManagementPage from '../Users/UserManagementPage';
import RolePermissionsPage from '../Settings/RolePermissionsPage';
import MigrationAdminPage from '../Admin/MigrationAdminPage';
import AuditLogPage from '../Admin/AuditLogPage';
import MarketplaceResetUtility from '../Admin/MarketplaceResetUtility';

import { db } from '../../firebase';
import { collection, getDocs } from 'firebase/firestore';

export default function PlatformAdminPage() {
    const [kpi, setKpi] = useState({ restaurants: 0, active: 0, onHold: 0, users: 0 });

    useEffect(() => {
        (async () => {
            try {
                // Restaurants
                const restSnap = await getDocs(collection(db, 'restaurants'));
                let active = 0, onHold = 0;
                restSnap.docs.forEach(d => {
                    const s = (d.data().status || '').toLowerCase();
                    if (s === 'active') active++;
                    else if (s === 'on hold' || s === 'onhold') onHold++;
                });

                // Users (try users collection)
                let userCount = 0;
                try {
                    const usersSnap = await getDocs(collection(db, 'users'));
                    userCount = usersSnap.size;
                } catch (e) { /* may not exist */ }

                setKpi({ restaurants: restSnap.size, active, onHold, users: userCount });
            } catch (err) {
                console.error('[PlatformAdminKPI] Failed:', err);
            }
        })();
    }, []);

    const kpiStats = useMemo(() => [
        { label: 'Total Restaurants', value: kpi.restaurants, icon: '🏪', color: '#38bdf8' },
        { label: 'Active', value: kpi.active, icon: '✅', color: '#34d399' },
        { label: 'On Hold', value: kpi.onHold, icon: '⏸️', color: kpi.onHold > 0 ? '#f59e0b' : '#94a3b8' },
        { label: 'Total Users', value: kpi.users, icon: '👥', color: '#a78bfa' },
    ], [kpi]);

    const tabs = useMemo(() => [
        {
            key: 'restaurants',
            label: 'Restaurants',
            icon: '🏪',
            content: <AdminRestaurantsPage embedded />,
        },
        {
            key: 'users',
            label: 'Users & Roles',
            icon: '👥',
            content: <UserManagementPage embedded />,
        },
        {
            key: 'permissions',
            label: 'Permissions',
            icon: '⚙️',
            content: <RolePermissionsPage embedded />,
        },
        {
            key: 'migration',
            label: 'Migration Tools',
            icon: '🔧',
            content: <MigrationAdminPage embedded />,
        },
        {
            key: 'audit-logs',
            label: 'Audit Logs',
            icon: '📋',
            content: <AuditLogPage />,
        },
        {
            key: 'reset',
            label: 'Reset',
            icon: '🔴',
            content: <MarketplaceResetUtility />,
        },
    ], []);

    return (
        <TabbedPageShell
            title="Platform Admin"
            subtitle="Manage restaurants, users, roles, permissions, migration tools, audit logs, and system reset."
            icon="🔧"
            tabs={tabs}
            defaultTab="restaurants"
            kpiRow={<KPIStatsRow stats={kpiStats} />}
        />
    );
}
