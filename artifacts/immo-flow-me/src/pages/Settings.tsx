import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Building2, User, Mail, Calendar, Sparkles, Shield, FileText, Pencil, CreditCard, Landmark } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { MainLayout } from '@/components/layout/MainLayout';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useOrganization } from '@/hooks/useOrganization';
import { useAuth } from '@/hooks/useAuth';
import { useNavigate, Link } from 'react-router-dom';
import { format } from 'date-fns';
import { de } from 'date-fns/locale';
import { DistributionKeySettings } from '@/components/settings/DistributionKeySettings';
import { AccountCategorySettings } from '@/components/settings/AccountCategorySettings';
import { FAQSection } from '@/components/settings/FAQSection';
import { HandbookSection } from '@/components/settings/HandbookSection';
import { PrivacySettings } from '@/components/settings/PrivacySettings';
import { OrganizationEditDialog } from '@/components/settings/OrganizationEditDialog';
import { UserRoleManager } from '@/components/settings/UserRoleManager';
import { BrandingSettings } from '@/components/settings/BrandingSettings';
import { BankAccountsSection } from '@/components/settings/BankAccountsSection';
import { SubscriptionSettings } from '@/components/settings/SubscriptionSettings';
import { useFeatureTour } from '@/hooks/useFeatureTour';
import { useSessionTimeout } from '@/hooks/useSessionTimeout';
import { useIsAdmin } from '@/hooks/useAdmin';
import { useUserRole } from '@/hooks/useUserRole';
import { TwoFactorSettings } from '@/components/settings/TwoFactorSettings';
import { ApiKeySettings } from '@/components/settings/ApiKeySettings';
import { LeaseExpiryNotificationSettings } from '@/components/settings/LeaseExpiryNotificationSettings';

// Mask IBAN for display
function maskIban(iban: string | null): string {
  if (!iban) return '—';
  if (iban.length <= 8) return iban;
  return `${iban.slice(0, 4)} **** **** ${iban.slice(-4)}`;
}

export default function Settings() {
  const { user } = useAuth();
  const { data: organization, isLoading } = useOrganization();
  const { resetTour } = useFeatureTour();
  const navigate = useNavigate();
  const { data: isAdmin } = useIsAdmin();
  const { data: userRole } = useUserRole();
  const [searchParams] = useSearchParams();
  const [showEditOrg, setShowEditOrg] = useState(false);
  
  // Get initial tab from URL params
  const initialTab = searchParams.get('tab') || 'account';
  
  // Initialize session timeout
  useSessionTimeout();

  const handleStartTour = () => {
    resetTour();
    navigate('/dashboard');
  };

  const canViewFinancials = userRole === 'admin' || userRole === 'finance' || userRole === 'property_manager';

  if (isLoading) {
    return (
      <MainLayout title="Einstellungen" subtitle="Verwalten Sie Ihr Konto">
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
        </div>
      </MainLayout>
    );
  }

  return (
    <MainLayout title="Einstellungen" subtitle="Verwalten Sie Ihr Konto">
      <div className="max-w-6xl mx-auto">
        <Tabs defaultValue={initialTab} className="w-full">
          <TabsList className="mb-6 flex-wrap">
            <TabsTrigger value="account">Konto</TabsTrigger>
            <TabsTrigger value="subscription">Abo</TabsTrigger>
            {canViewFinancials && <TabsTrigger value="banking">Bankkonten</TabsTrigger>}
            <TabsTrigger value="security">Sicherheit</TabsTrigger>
            <TabsTrigger value="notifications">Benachrichtigungen</TabsTrigger>
            <TabsTrigger value="privacy">Datenschutz</TabsTrigger>
            {isAdmin && <TabsTrigger value="branding">Branding</TabsTrigger>}
            <TabsTrigger value="distribution">Verteilungsschlüssel</TabsTrigger>
            <TabsTrigger value="categories">Kostenarten</TabsTrigger>
            <TabsTrigger value="faq">FAQ</TabsTrigger>
            <TabsTrigger value="handbook">Handbuch</TabsTrigger>
            {isAdmin && <TabsTrigger value="admin">Administration</TabsTrigger>}
          </TabsList>

          <TabsContent value="account" className="space-y-6">
            {/* Account Section */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <User className="h-5 w-5" />
                  Konto
                </CardTitle>
                <CardDescription>Ihre Kontoinformationen</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center gap-3">
                  <Mail className="h-4 w-4 text-muted-foreground" />
                  <div>
                    <p className="text-sm text-muted-foreground">E-Mail</p>
                    <p className="font-medium">{user?.email || 'Nicht verfügbar'}</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Organization Section */}
            <Card>
              <CardHeader className="flex flex-row items-start justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <Building2 className="h-5 w-5" />
                    Organisation
                  </CardTitle>
                  <CardDescription>Ihre Organisationsdetails</CardDescription>
                </div>
                {isAdmin && (
                  <Button variant="outline" size="sm" onClick={() => setShowEditOrg(true)}>
                    <Pencil className="h-4 w-4 mr-2" />
                    Bearbeiten
                  </Button>
                )}
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <p className="text-sm text-muted-foreground">Organisationsname</p>
                  <p className="font-medium text-lg">{organization?.name || 'Nicht verfügbar'}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Status</p>
                  <Badge className="bg-green-100 text-green-800">Aktiv</Badge>
                </div>
                
                {/* Financial data - only visible to Admin/Finance */}
                {canViewFinancials && organization && (
                  <div className="pt-4 border-t space-y-3">
                    <div className="flex items-center gap-2 mb-2">
                      <CreditCard className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm font-medium">Bankdaten</span>
                    </div>
                    <div className="grid gap-3 md:grid-cols-3">
                      <div>
                        <p className="text-sm text-muted-foreground">IBAN</p>
                        <p className="font-mono text-sm">{maskIban(organization.iban)}</p>
                      </div>
                      <div>
                        <p className="text-sm text-muted-foreground">BIC</p>
                        <p className="font-mono text-sm">{organization.bic || '—'}</p>
                      </div>
                      <div>
                        <p className="text-sm text-muted-foreground">SEPA-Gläubiger-ID</p>
                        <p className="font-mono text-sm">{organization.sepa_creditor_id || '—'}</p>
                      </div>
                    </div>
                  </div>
                )}

                {organization?.created_at && (
                  <div className="flex items-center gap-3 pt-4 border-t">
                    <Calendar className="h-4 w-4 text-muted-foreground" />
                    <div>
                      <p className="text-sm text-muted-foreground">Mitglied seit</p>
                      <p className="font-medium">
                        {format(new Date(organization.created_at), 'dd. MMMM yyyy', { locale: de })}
                      </p>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Feature Tour Section */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Sparkles className="h-5 w-5" />
                  Einführungstour
                </CardTitle>
                <CardDescription>Lernen Sie alle Funktionen der Software kennen</CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground mb-4">
                  Starten Sie die interaktive Tour, um einen Überblick über alle wichtigen Funktionen zu erhalten.
                </p>
                <Button onClick={handleStartTour}>
                  <Sparkles className="h-4 w-4 mr-2" />
                  Tour erneut starten
                </Button>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="subscription">
            <SubscriptionSettings />
          </TabsContent>

          {canViewFinancials && (
            <TabsContent value="banking">
              <BankAccountsSection />
            </TabsContent>
          )}

          <TabsContent value="security" className="space-y-6">
            <TwoFactorSettings />
          </TabsContent>

          <TabsContent value="notifications" className="space-y-6">
            <LeaseExpiryNotificationSettings />
          </TabsContent>

          <TabsContent value="privacy">
            <PrivacySettings />
          </TabsContent>

          {isAdmin && (
            <TabsContent value="branding">
              <BrandingSettings />
            </TabsContent>
          )}

          <TabsContent value="distribution">
            <DistributionKeySettings />
          </TabsContent>

          <TabsContent value="categories">
            <AccountCategorySettings />
          </TabsContent>

          <TabsContent value="faq">
            <FAQSection />
          </TabsContent>

          <TabsContent value="handbook">
            <HandbookSection />
          </TabsContent>

          {isAdmin && (
            <TabsContent value="admin" className="space-y-6">
              {/* API-Key Verwaltung */}
              <ApiKeySettings />

              {/* User Role Manager - inline */}
              <UserRoleManager />

              {/* Other Admin Links */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Shield className="h-5 w-5" />
                    Weitere Verwaltung
                  </CardTitle>
                  <CardDescription>
                    Zusätzliche Administrationsoptionen
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="grid gap-4 md:grid-cols-2">
                    <Button variant="outline" asChild className="justify-start h-auto py-4">
                      <Link to="/admin">
                        <Building2 className="h-5 w-5 mr-3" />
                        <div className="text-left">
                          <div className="font-medium">Organisationen</div>
                          <div className="text-sm text-muted-foreground">
                            Alle Organisationen verwalten
                          </div>
                        </div>
                      </Link>
                    </Button>

                    <Button variant="outline" asChild className="justify-start h-auto py-4">
                      <Link to="/admin/audit-logs">
                        <FileText className="h-5 w-5 mr-3" />
                        <div className="text-left">
                          <div className="font-medium">Audit-Logs</div>
                          <div className="text-sm text-muted-foreground">
                            Protokollierung aller Datenänderungen
                          </div>
                        </div>
                      </Link>
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
          )}
        </Tabs>
      </div>

      <OrganizationEditDialog
        organization={organization ?? null}
        open={showEditOrg}
        onOpenChange={setShowEditOrg}
      />
    </MainLayout>
  );
}
