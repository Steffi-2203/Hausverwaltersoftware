import { Suspense, lazy } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import { AdminRoute } from "@/components/auth/AdminRoute";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { CookieConsent } from "@/components/CookieConsent";
import { InstallBanner } from "@/components/pwa/InstallBanner";
import { OfflineIndicator } from "@/components/pwa/OfflineIndicator";
import { DemoDataProvider } from "@/contexts/DemoDataContext";
import { ActiveOrganizationProvider } from "@/contexts/ActiveOrganizationContext";
import { Loader2 } from "lucide-react";

import Landing from "./pages/Landing";
import Login from "./pages/Login";
import SimpleDashboard from "./pages/SimpleDashboard";
import PropertyList from "./pages/PropertyList";
import PropertyDetail from "./pages/PropertyDetail";
import PropertyForm from "./pages/PropertyForm";
import NotFound from "./pages/NotFound";

const ResetPassword = lazy(() => import("./pages/ResetPassword"));
const Register = lazy(() => import("./pages/Register"));
const UnitList = lazy(() => import("./pages/UnitList"));
const UnitDetail = lazy(() => import("./pages/UnitDetail"));
const UnitForm = lazy(() => import("./pages/UnitForm"));
const TenantForm = lazy(() => import("./pages/TenantForm"));
const TenantList = lazy(() => import("./pages/TenantList"));
const TenantDetail = lazy(() => import("./pages/TenantDetail"));
const RentalFinance = lazy(() => import("./pages/RentalFinance"));
const CostsHub = lazy(() => import("./pages/CostsHub"));
const AdminAuditLogs = lazy(() => import("./pages/AdminAuditLogs"));
const Reports = lazy(() => import("./pages/Reports"));
const OperatingCostSettlement = lazy(() => import("./pages/OperatingCostSettlement"));
const Documents = lazy(() => import("./pages/Documents"));
const Settings = lazy(() => import("./pages/Settings"));
const Admin = lazy(() => import("./pages/Admin"));
const AdminUsers = lazy(() => import("./pages/AdminUsers"));
const SystemTest = lazy(() => import("./pages/SystemTest"));
const Banking = lazy(() => import("./pages/Banking"));
const BankReconciliation = lazy(() => import("./pages/BankReconciliation"));
const AutoMatch = lazy(() => import("./pages/AutoMatch"));
const Accounting = lazy(() => import("./pages/Accounting"));
const MaintenanceHub = lazy(() => import("./pages/MaintenanceHub"));
const MessagesPage = lazy(() => import("./pages/Messages"));
const TeamManagement = lazy(() => import("./pages/TeamManagement"));
const Budgets = lazy(() => import("./pages/Budgets"));
const TenantPortal = lazy(() => import("./pages/TenantPortal"));
const WegManagement = lazy(() => import("./pages/WegManagement"));
const WegVorschreibungen = lazy(() => import("./pages/WegVorschreibungen"));
const InsuranceManagement = lazy(() => import("./pages/InsuranceManagement"));
const DeadlineCalendar = lazy(() => import("./pages/DeadlineCalendar"));
const SerialLetters = lazy(() => import("./pages/SerialLetters"));
const ManagementContracts = lazy(() => import("./pages/ManagementContracts"));
const Impressum = lazy(() => import("./pages/Impressum"));
const Datenschutz = lazy(() => import("./pages/Datenschutz"));
const AGB = lazy(() => import("./pages/AGB"));
const AVV = lazy(() => import("./pages/AVV"));
const SLA = lazy(() => import("./pages/SLA"));
const Loeschkonzept = lazy(() => import("./pages/Loeschkonzept"));
const DsgvoCompliance = lazy(() => import("./pages/DsgvoCompliance"));
const SecurityDashboard = lazy(() => import("./pages/SecurityDashboard"));
const SupportTickets = lazy(() => import("./pages/SupportTickets"));
const GuidedWorkflows = lazy(() => import("./pages/GuidedWorkflows"));
const EsgDashboard = lazy(() => import("./pages/EsgDashboard"));
const DamageReports = lazy(() => import("./pages/DamageReports"));
const TenantLogin = lazy(() => import("./pages/TenantLogin"));
const TenantPortalStandalone = lazy(() => import("./pages/TenantPortalStandalone"));
const OwnerLogin = lazy(() => import("./pages/OwnerLogin"));
const OwnerPortalStandalone = lazy(() => import("./pages/OwnerPortalStandalone"));
const OwnerPortal = lazy(() => import("./pages/OwnerPortal"));
const LeaseContractGenerator = lazy(() => import("./pages/LeaseContractGenerator"));
const KiAssistent = lazy(() => import("./pages/KiAssistent"));
const AutomationSettings = lazy(() => import("./pages/AutomationSettings"));
const InvoiceOcr = lazy(() => import("./pages/InvoiceOcr"));
const KiInsights = lazy(() => import("./pages/KiInsights"));
const KiKommunikation = lazy(() => import("./pages/KiKommunikation"));
const EbicsBanking = lazy(() => import("./pages/EbicsBanking"));
const OffenePosten = lazy(() => import("./pages/OffenePosten"));
const Jahresabschluss = lazy(() => import("./pages/Jahresabschluss"));
const ScheduledReports = lazy(() => import("./pages/ScheduledReports"));
const Signatures = lazy(() => import("./pages/Signatures"));
const QueryBuilder = lazy(() => import("./pages/QueryBuilder"));
const Heizkosten = lazy(() => import("./pages/Heizkosten"));
const Pricing = lazy(() => import("./pages/Pricing"));
const Richtwertmietzins = lazy(() => import("./pages/Richtwertmietzins"));
const Aktivitaeten = lazy(() => import("./pages/Aktivitaeten"));
const DemoRequest = lazy(() => import("./pages/demo-request"));
const DemoActivate = lazy(() => import("./pages/demo-activate"));
const WhiteLabelRequest = lazy(() => import("./pages/WhiteLabelRequest"));
const Checkout = lazy(() => import("./pages/Checkout"));
const VpiAdjustments = lazy(() => import("./pages/VpiAdjustments"));
const TwoFactorEnrollment = lazy(() => import("./pages/TwoFactorEnrollment"));

const queryClient = new QueryClient();

function PageLoader() {
  return (
    <div className="flex items-center justify-center h-screen" data-testid="page-loader">
      <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
    </div>
  );
}

function ProtectedWithOrg({ children }: { children: React.ReactNode }) {
  return (
    <ProtectedRoute>
      <ActiveOrganizationProvider>
        <DemoDataProvider>
          {children}
        </DemoDataProvider>
      </ActiveOrganizationProvider>
    </ProtectedRoute>
  );
}

const App = () => (
  <ErrorBoundary>
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <InstallBanner />
        <OfflineIndicator />
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <Suspense fallback={<PageLoader />}>
          <Routes>
            {/* Public routes */}
            <Route path="/" element={<Landing />} />
            <Route path="/login" element={<Login />} />
            <Route path="/reset-password" element={<ResetPassword />} />
            {/* Register route only accessible via invite token */}
            <Route path="/register" element={<Register />} />
            <Route path="/impressum" element={<Impressum />} />
            <Route path="/datenschutz" element={<Datenschutz />} />
            <Route path="/agb" element={<AGB />} />
            <Route path="/avv" element={<AVV />} />
            <Route path="/sla" element={<SLA />} />
            <Route path="/loeschkonzept" element={<Loeschkonzept />} />
            <Route path="/preise" element={<Pricing />} />
            <Route path="/demo" element={<DemoRequest />} />
            <Route path="/demo-activate" element={<DemoActivate />} />
            <Route path="/demo/activate" element={<DemoActivate />} />
            <Route path="/white-label" element={<WhiteLabelRequest />} />
            <Route path="/checkout" element={<Checkout />} />
            <Route path="/pricing" element={<Navigate to="/preise" replace />} />
            <Route path="/2fa-einrichten" element={<TwoFactorEnrollment />} />
            <Route path="/mieter-login" element={<TenantLogin />} />
            <Route path="/mieter-portal" element={<TenantPortalStandalone />} />
            <Route path="/eigentuemer-login" element={<OwnerLogin />} />
            <Route path="/eigentuemer-portal" element={<OwnerPortalStandalone />} />
            
            {/* Protected routes - wrapped with ActiveOrganizationProvider and DemoDataProvider */}
            <Route path="/dashboard" element={<ProtectedWithOrg><SimpleDashboard /></ProtectedWithOrg>} />
            <Route path="/liegenschaften" element={<ProtectedWithOrg><PropertyList /></ProtectedWithOrg>} />
            <Route path="/liegenschaften/neu" element={<ProtectedWithOrg><PropertyForm /></ProtectedWithOrg>} />
            <Route path="/liegenschaften/:id" element={<ProtectedWithOrg><PropertyDetail /></ProtectedWithOrg>} />
            <Route path="/liegenschaften/:id/bearbeiten" element={<ProtectedWithOrg><PropertyForm /></ProtectedWithOrg>} />
            <Route path="/liegenschaften/:propertyId/einheiten/neu" element={<ProtectedWithOrg><UnitForm /></ProtectedWithOrg>} />
            <Route path="/liegenschaften/:propertyId/einheiten/:unitId/bearbeiten" element={<ProtectedWithOrg><UnitForm /></ProtectedWithOrg>} />
            <Route path="/einheiten" element={<ProtectedWithOrg><UnitList /></ProtectedWithOrg>} />
            <Route path="/einheiten/:propertyId/:unitId" element={<ProtectedWithOrg><UnitDetail /></ProtectedWithOrg>} />
            <Route path="/einheiten/:propertyId/:unitId/mieter/neu" element={<ProtectedWithOrg><TenantForm /></ProtectedWithOrg>} />
            <Route path="/einheiten/:propertyId/:unitId/mieter/:tenantId/bearbeiten" element={<ProtectedWithOrg><TenantForm /></ProtectedWithOrg>} />
            <Route path="/mieter" element={<ProtectedWithOrg><TenantList /></ProtectedWithOrg>} />
            <Route path="/mieter/neu" element={<ProtectedWithOrg><TenantForm /></ProtectedWithOrg>} />
            <Route path="/mieter/:tenantId" element={<ProtectedWithOrg><TenantDetail /></ProtectedWithOrg>} />
            <Route path="/mieter/:tenantId/bearbeiten" element={<ProtectedWithOrg><TenantForm /></ProtectedWithOrg>} />
            <Route path="/zahlungen" element={<ProtectedWithOrg><RentalFinance /></ProtectedWithOrg>} />
            <Route path="/buchhaltung" element={<Navigate to="/finanzbuchhaltung" replace />} />
            <Route path="/auto-zuordnung" element={<ProtectedWithOrg><AutoMatch /></ProtectedWithOrg>} />
            <Route path="/bank-abgleich" element={<ProtectedWithOrg><BankReconciliation /></ProtectedWithOrg>} />
            <Route path="/finanzbuchhaltung" element={<ProtectedWithOrg><Accounting /></ProtectedWithOrg>} />
            <Route path="/ebics-banking" element={<ProtectedWithOrg><EbicsBanking /></ProtectedWithOrg>} />
            <Route path="/offene-posten" element={<ProtectedWithOrg><OffenePosten /></ProtectedWithOrg>} />
            <Route path="/jahresabschluss" element={<ProtectedWithOrg><Jahresabschluss /></ProtectedWithOrg>} />
            <Route path="/kosten" element={<ProtectedWithOrg><CostsHub /></ProtectedWithOrg>} />
            <Route path="/abrechnung" element={<ProtectedWithOrg><OperatingCostSettlement /></ProtectedWithOrg>} />
            <Route path="/dokumente" element={<ProtectedWithOrg><Documents /></ProtectedWithOrg>} />
            <Route path="/reports" element={<ProtectedWithOrg><Reports /></ProtectedWithOrg>} />
            <Route path="/geplante-berichte" element={<ProtectedWithOrg><ScheduledReports /></ProtectedWithOrg>} />
            <Route path="/wartungen" element={<ProtectedWithOrg><MaintenanceHub /></ProtectedWithOrg>} />
            <Route path="/budgets" element={<ProtectedWithOrg><Budgets /></ProtectedWithOrg>} />
            <Route path="/nachrichten" element={<ProtectedWithOrg><MessagesPage /></ProtectedWithOrg>} />
            <Route path="/team" element={<ProtectedWithOrg><TeamManagement /></ProtectedWithOrg>} />
            <Route path="/weg" element={<ProtectedWithOrg><WegManagement /></ProtectedWithOrg>} />
            <Route path="/weg-vorschreibungen" element={<ProtectedWithOrg><WegVorschreibungen /></ProtectedWithOrg>} />
            <Route path="/versicherungen" element={<ProtectedWithOrg><InsuranceManagement /></ProtectedWithOrg>} />
            <Route path="/fristen" element={<ProtectedWithOrg><DeadlineCalendar /></ProtectedWithOrg>} />
            <Route path="/serienbriefe" element={<ProtectedWithOrg><SerialLetters /></ProtectedWithOrg>} />
            <Route path="/hv-vertraege" element={<ProtectedWithOrg><ManagementContracts /></ProtectedWithOrg>} />
            <Route path="/mieterportal" element={<ProtectedWithOrg><TenantPortal /></ProtectedWithOrg>} />
            <Route path="/eigentuemerportal" element={<ProtectedWithOrg><OwnerPortal /></ProtectedWithOrg>} />
            <Route path="/dsgvo" element={<ProtectedWithOrg><DsgvoCompliance /></ProtectedWithOrg>} />
            <Route path="/sicherheit" element={<ProtectedWithOrg><SecurityDashboard /></ProtectedWithOrg>} />
            <Route path="/tickets" element={<ProtectedWithOrg><SupportTickets /></ProtectedWithOrg>} />
            <Route path="/workflows" element={<ProtectedWithOrg><GuidedWorkflows /></ProtectedWithOrg>} />
            <Route path="/esg" element={<ProtectedWithOrg><EsgDashboard /></ProtectedWithOrg>} />
            <Route path="/schadensmeldungen" element={<ProtectedWithOrg><DamageReports /></ProtectedWithOrg>} />
            <Route path="/mietvertrag-generator" element={<ProtectedWithOrg><LeaseContractGenerator /></ProtectedWithOrg>} />
            <Route path="/ki-assistent" element={<ProtectedWithOrg><KiAssistent /></ProtectedWithOrg>} />
            <Route path="/automatisierung" element={<ProtectedWithOrg><AutomationSettings /></ProtectedWithOrg>} />
            <Route path="/ki-rechnungen" element={<ProtectedWithOrg><InvoiceOcr /></ProtectedWithOrg>} />
            <Route path="/ki-insights" element={<ProtectedWithOrg><KiInsights /></ProtectedWithOrg>} />
            <Route path="/ki-kommunikation" element={<ProtectedWithOrg><KiKommunikation /></ProtectedWithOrg>} />
            <Route path="/signaturen" element={<ProtectedWithOrg><Signatures /></ProtectedWithOrg>} />
            <Route path="/abfrage-builder" element={<ProtectedWithOrg><QueryBuilder /></ProtectedWithOrg>} />
            <Route path="/heizkosten" element={<ProtectedWithOrg><Heizkosten /></ProtectedWithOrg>} />
            <Route path="/mietzinsrechner" element={<ProtectedWithOrg><Richtwertmietzins /></ProtectedWithOrg>} />
            <Route path="/aktivitaeten" element={<ProtectedWithOrg><Aktivitaeten /></ProtectedWithOrg>} />
            <Route path="/vpi-anpassungen" element={<ProtectedWithOrg><VpiAdjustments /></ProtectedWithOrg>} />
            <Route path="/einstellungen" element={<ProtectedWithOrg><Settings /></ProtectedWithOrg>} />
            
            {/* Redirects for merged routes */}
            <Route path="/vorschreibungen" element={<Navigate to="/zahlungen?tab=invoices" replace />} />
            <Route path="/mahnwesen" element={<Navigate to="/zahlungen?tab=dunning" replace />} />
            <Route path="/handwerker" element={<Navigate to="/wartungen?tab=contractors" replace />} />
            <Route path="/rechnungsfreigabe" element={<Navigate to="/kosten?tab=approval" replace />} />
            
            {/* Admin routes */}
            <Route path="/admin" element={<AdminRoute><Admin /></AdminRoute>} />
            <Route path="/admin/users" element={<AdminRoute><AdminUsers /></AdminRoute>} />
            <Route path="/admin/audit-logs" element={<AdminRoute><AdminAuditLogs /></AdminRoute>} />
            <Route path="/admin/system-test" element={<AdminRoute><SystemTest /></AdminRoute>} />
            
            <Route path="*" element={<NotFound />} />
          </Routes>
          </Suspense>
          <CookieConsent />
        </BrowserRouter>
      </TooltipProvider>
    </QueryClientProvider>
  </ErrorBoundary>
);

export default App;
