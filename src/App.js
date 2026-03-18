// src/App.js
import React, { useContext, useEffect, useState } from 'react';
import { Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import { UserContext } from './contexts/UserContext';
import Login from './components/Login';
import Sidebar from './components/Sidebar';
import TopBar from './components/TopBar';

// Pages
import Dashboard from './components/Dashboard';
import VendorListPage from './components/Vendors/VendorListPage';
import VendorDetailPage from './components/Vendors/VendorDetailPage';
import ItemDetailPage from './components/Vendors/ItemDetailPage';
import AddVendorPage from './components/Vendors/AddVendorPage';
import ItemCatalogPage from './components/Vendors/ItemCatalogPage';
import UserManagementPage from './components/Users/UserManagementPage';
import OrdersPage from './components/Orders/OrdersPage';
import RolePermissionsPage from './components/Settings/RolePermissionsPage';
import AdminInvoicesPage from './components/Admin/AdminInvoicesPage';
import AdminRestaurantInvoicesPage from './components/Admin/AdminRestaurantInvoicesPage';
import RestaurantInvoiceDetailPage from './components/Admin/RestaurantInvoiceDetailPage';
import VendorInvoicesPage from './components/Vendors/VendorInvoicesPage';
import InvoiceDetailPage from './components/Vendors/InvoiceDetailPage';
import DispatchRequestsPage from './components/Vendors/DispatchRequestsPage';
import DispatchDetailPage from './components/Vendors/DispatchDetailPage';
import VendorScoreDashboard from './components/Vendors/VendorScoreDashboard';
import VendorExpectedAllocation from './components/Vendors/VendorExpectedAllocation';
import VendorCapacityPlanning from './components/Vendors/VendorCapacityPlanning';
import VendorImportPage from './components/BulkImport/VendorImportPage';
import VendorImportPreviewPage from './components/BulkImport/VendorImportPreviewPage';
import VendorImportHistoryPage from './components/BulkImport/VendorImportHistoryPage';
import useAdminNotificationSync from './hooks/useAdminNotificationSync';
import SuperAdminDashboard from './components/Admin/SuperAdminDashboard';

import AdminRestaurantsPage from './components/Admin/AdminRestaurantsPage';

import AdminRestaurantDetailPage from './components/Admin/AdminRestaurantDetailPage';
import MarketplaceIntelligencePage from './components/Admin/MarketplaceIntelligencePage';
import VendorCompetitivenessDashboard from './components/Admin/VendorCompetitivenessDashboard';
import VendorAllocationDashboard from './components/Admin/VendorAllocationDashboard';
import SupplyCapacityDashboard from './components/Admin/SupplyCapacityDashboard';

// Forecast Module (Super Admin Only)
import ForecastOverviewPage from './components/Forecast/ForecastOverviewPage';
import RestaurantForecastPage from './components/Forecast/RestaurantForecastPage';
import CombinedDemandPage from './components/Forecast/CombinedDemandPage';
import VendorPlanningPage from './components/Forecast/VendorPlanningPage';
import FestivalSeasonalityPage from './components/Forecast/FestivalSeasonalityPage';
import ForecastAccuracyPage from './components/Forecast/ForecastAccuracyPage';
import ForecastAlertsPage from './components/Forecast/ForecastAlertsPage';
import ForecastSettingsPage from './components/Forecast/ForecastSettingsPage';

// Main Dashboard
import GlobalSupplyControlTower from './components/Forecast/GlobalSupplyControlTower';
import SuggestedOrderReview from './components/Forecast/SuggestedOrderReview';
import SubmittedOrdersPage from './components/Forecast/SubmittedOrdersPage';

// New Unified Forecast Pages
import DemandForecastPage from './components/Forecast/DemandForecastPage';
import ForecastIntelligencePage from './components/Forecast/ForecastIntelligencePage';

// Dispatch & Logistics Pages
import DispatchConfirmationsPage from './components/Forecast/DispatchConfirmationsPage';
import WarehousePickListPage from './components/Forecast/WarehousePickListPage';
import DeliveryStatusPage from './components/Forecast/DeliveryStatusPage';
import IssuesDisputesPage from './components/Forecast/IssuesDisputesPage';

// AI Intelligence Layer
import AIIntelligenceHub from './components/AI/AIIntelligenceHub';

// Master Collections Admin
import ManageRestaurantsPage from './components/Admin/ManageRestaurantsPage';
import ManageCatalogPage from './components/Admin/ManageCatalogPage';
import MigrationAdminPage from './components/Admin/MigrationAdminPage';
import CatalogItemMappingReviewPage from './components/Admin/CatalogItemMappingReviewPage';
import PendingReviewsDashboard from './components/Admin/PendingReviewsDashboard';
import UnmappedVendorItemsPage from './components/Admin/UnmappedVendorItemsPage';
import SuperadminCatalogReviewQueuePage from './components/CatalogReview/SuperadminCatalogReviewQueuePage';



// Toasts
import { ToastContainer } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';

function App() {
    const { role, isSuperAdmin } = useContext(UserContext);
    const navigate = useNavigate();
    const location = useLocation();

    const normalizedRole = typeof role === 'string' ? role.trim().toLowerCase() : '';
    const isAdmin = normalizedRole === 'admin'; // Helper for vendor admin routes

    // Start background sync for admin notifications (runs efficiently if isSuperAdmin)
    useAdminNotificationSync();

    // Mobile sidebar
    const [showSidebar, setShowSidebar] = useState(false);

    // Persist last path
    useEffect(() => {
        if (normalizedRole) localStorage.setItem('vm_lastPath', location.pathname);
    }, [location.pathname, normalizedRole]);

    // Restore last path on refresh
    useEffect(() => {
        const savedRole = localStorage.getItem('vm_role');
        const savedPath = localStorage.getItem('vm_lastPath');
        if (savedRole && !normalizedRole) navigate(savedPath || '/');
    }, [normalizedRole, navigate]);

    // Close sidebar on route change (mobile)
    useEffect(() => {
        if (window.innerWidth < 1024) setShowSidebar(false);
    }, [location.pathname]);

    // Not logged in → show login
    if (!normalizedRole) {
        return <Login />;
    }

    return (
        <div className="app-container theme-neon">
            <Sidebar isOpen={showSidebar} onClose={() => setShowSidebar(false)} />

            <div className="main-content">
                <TopBar onMenuClick={() => setShowSidebar(true)} />

                <div className="page-content">
                    <Routes>
                        <Route path="/login" element={<Navigate to={isSuperAdmin ? "/vendors" : "/"} />} />

                        {/* ── Super Admin Routes ── */}
                        {isSuperAdmin && (
                            <>
                                <Route path="/admin/dashboard" element={<SuperAdminDashboard />} />
                                <Route path="/orders" element={<OrdersPage />} />
                                <Route path="/vendors" element={<VendorListPage />} />
                                <Route path="/vendors/add" element={<AddVendorPage />} />
                                <Route path="/vendors/:vendorId" element={<VendorDetailPage />} />
                                <Route path="/vendors/:vendorId/items/:itemId" element={<ItemDetailPage />} />
                                <Route path="/users" element={<UserManagementPage />} />
                                <Route path="/settings/permissions" element={<RolePermissionsPage />} />

                                <Route path="/admin/restaurants" element={<AdminRestaurantsPage />} />
                                <Route path="/admin/restaurants/:restaurantId" element={<AdminRestaurantDetailPage />} />
                                <Route path="/admin/pending-reviews" element={<PendingReviewsDashboard />} />

                                <Route path="/admin/marketplace-intelligence" element={<MarketplaceIntelligencePage />} />
                                <Route path="/admin/vendor-competitiveness" element={<VendorCompetitivenessDashboard />} />
                                <Route path="/admin/vendor-allocation" element={<VendorAllocationDashboard />} />
                                <Route path="/admin/supply-capacity" element={<SupplyCapacityDashboard />} />
                                <Route path="/admin/invoices" element={<AdminInvoicesPage />} />
                                <Route path="/admin/invoices/:invoiceId" element={<InvoiceDetailPage />} />
                                <Route path="/admin/restaurant-invoices" element={<AdminRestaurantInvoicesPage />} />
                                <Route path="/admin/restaurant-invoices/:invoiceId" element={<RestaurantInvoiceDetailPage />} />


                                <Route path="/admin/forecast/demand" element={<DemandForecastPage />} />
                                <Route path="/admin/forecast/intelligence" element={<ForecastIntelligencePage />} />
                                <Route path="/admin/forecast/restaurants" element={<RestaurantForecastPage />} />
                                <Route path="/admin/forecast/combined" element={<CombinedDemandPage />} />
                                <Route path="/admin/forecast/vendors" element={<VendorPlanningPage />} />
                                <Route path="/admin/forecast/festivals" element={<FestivalSeasonalityPage />} />
                                <Route path="/admin/forecast/accuracy" element={<ForecastAccuracyPage />} />
                                <Route path="/admin/forecast/alerts" element={<ForecastAlertsPage />} />
                                <Route path="/admin/forecast/settings" element={<ForecastSettingsPage />} />
                                <Route path="/admin/forecast/control-tower" element={<GlobalSupplyControlTower />} />
                                <Route path="/admin/forecast/suggested-order-review" element={<SuggestedOrderReview />} />
                                <Route path="/admin/forecast/submitted-orders" element={<SubmittedOrdersPage />} />

                                {/* Dispatch & Logistics */}
                                <Route path="/admin/dispatch/confirmations" element={<DispatchConfirmationsPage />} />
                                <Route path="/admin/dispatch/warehouse" element={<WarehousePickListPage />} />
                                <Route path="/admin/dispatch/delivery" element={<DeliveryStatusPage />} />
                                <Route path="/admin/dispatch/issues" element={<IssuesDisputesPage />} />

                                {/* AI Intelligence */}
                                <Route path="/admin/ai-intelligence" element={<AIIntelligenceHub />} />

                                {/* Master Collections */}
                                <Route path="/admin/manage-restaurants" element={<ManageRestaurantsPage />} />
                                <Route path="/admin/manage-catalog" element={<ManageCatalogPage />} />
                                <Route path="/admin/migration" element={<MigrationAdminPage />} />
                                <Route path="/admin/mapping-review" element={<CatalogItemMappingReviewPage />} />

                                <Route path="/" element={<Navigate to="/admin/forecast/control-tower" />} />
                            </>
                        )}

                        {/* ── Vendor Admin / User Routes ── */}
                        {!isSuperAdmin && (
                            <>
                                <Route path="/" element={<Dashboard />} />
                                <Route path="/items" element={<ItemCatalogPage />} />
                                <Route path="/vendors/:vendorId/items/:itemId" element={<ItemDetailPage />} />
                                <Route path="/profile" element={<VendorDetailPage />} />
                                <Route path="/dispatch-requests" element={<DispatchRequestsPage />} />
                                <Route path="/dispatch-requests/:dispatchId" element={<DispatchDetailPage />} />
                                <Route path="/vendor/invoices" element={<VendorInvoicesPage />} />
                                <Route path="/vendor/invoices/:invoiceId" element={<InvoiceDetailPage />} />
                                <Route path="/vendor/competitiveness" element={<VendorScoreDashboard />} />
                                <Route path="/vendor/allocation" element={<VendorExpectedAllocation />} />
                                <Route path="/vendor/capacity" element={<VendorCapacityPlanning />} />
                                <Route path="/vendor/import" element={<VendorImportPage />} />
                                <Route path="/vendor/import/preview" element={<VendorImportPreviewPage />} />
                                <Route path="/vendor/import/history" element={<VendorImportHistoryPage />} />
                                {isAdmin && (
                                    <>
                                        <Route path="/users" element={<UserManagementPage />} />
                                        <Route path="/settings/permissions" element={<RolePermissionsPage />} />
                                    </>
                                )}
                            </>
                        )}

                        {/* ── Catalog Review Queue (SuperAdmin only) ── */}
                        {isSuperAdmin && (
                            <>
                                <Route path="/admin/catalog-review" element={<SuperadminCatalogReviewQueuePage />} />
                                <Route path="/admin/unmapped-items" element={<UnmappedVendorItemsPage />} />
                            </>
                        )}

                        {/* 404 */}
                        <Route path="*" element={<h2 style={{ padding: 16, color: '#9db2ce' }}>404 - Page not found</h2>} />
                    </Routes>
                </div>
            </div>

            <ToastContainer
                position="top-right"
                autoClose={3000}
                hideProgressBar={false}
                theme="dark"
            />
        </div>
    );
}

export default App;
