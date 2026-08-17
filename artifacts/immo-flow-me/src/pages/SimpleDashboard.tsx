import { useState, useEffect, useMemo } from "react";
import { MainLayout } from "@/components/layout/MainLayout";
import { useAuth } from "@/hooks/useAuth";
import { useOrganization } from "@/hooks/useOrganization";
import { useProperties, useCreateProperty, useDeleteProperty } from "@/hooks/useProperties";
import { useUnits, useCreateUnit } from "@/hooks/useUnits";
import { useTenants } from "@/hooks/useTenants";
import { useInvoices } from "@/hooks/useInvoices";
import { MonthlyRevenueChart, PaymentRateChart } from '@/components/charts/FinanceChart';
import { Link } from "react-router-dom";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Building2, Plus, Trash2, ChevronDown, ChevronRight, Home, Sparkles } from "lucide-react";
import { OffenePostenWidget } from "@/components/dashboard/OffenePostenWidget";
import { DataQualityWidget } from "@/components/dashboard/DataQualityWidget";
import { BankAccountsWidget } from "@/components/dashboard/BankAccountsWidget";
import { UpcomingMaintenanceWidget } from "@/components/dashboard/UpcomingMaintenanceWidget";
import { ExpiringLeasesWidget } from "@/components/dashboard/ExpiringLeasesWidget";
import { CalendarWidget } from "@/components/dashboard/CalendarWidget";
import { PropertyKPIsWidget } from "@/components/dashboard/PropertyKPIsWidget";
import { OnboardingWizard } from "@/components/onboarding/OnboardingWizard";
import { useOnboardingStatus } from "@/hooks/useOnboardingStatus";
import { FeatureTour } from "@/components/tour/FeatureTour";
import { useFeatureTour } from "@/hooks/useFeatureTour";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

function UnitsSection({ propertyId }: { propertyId: string }) {
  const { data: units, isLoading } = useUnits(propertyId);
  const createUnit = useCreateUnit();
  const [showAddUnit, setShowAddUnit] = useState(false);
  const [newUnit, setNewUnit] = useState({ topNummer: '' });

  const unitsList = units || [];

  if (isLoading) {
    return <div className="mt-4 pt-4 border-t"><Skeleton className="h-20 w-full" /></div>;
  }

  return (
    <div className="mt-4 pt-4 border-t" onClick={(e) => e.stopPropagation()}>
      <div className="flex justify-between items-center mb-3">
        <h4 className="font-semibold text-sm">
          Einheiten ({unitsList.length})
        </h4>
        <Button
          size="sm"
          variant="outline"
          onClick={() => setShowAddUnit(true)}
        >
          <Plus className="h-3 w-3 mr-1" />
          Einheit
        </Button>
      </div>

      {showAddUnit && (
        <div className="mb-3 p-3 bg-muted rounded-lg">
          <Input
            type="text"
            placeholder="Einheit (z.B. Top 1, Whg. 3)"
            value={newUnit.topNummer}
            onChange={(e) => setNewUnit({ topNummer: e.target.value })}
            className="mb-2"
          />
          <div className="flex gap-2">
            <Button
              size="sm"
              onClick={async () => {
                if (!newUnit.topNummer) return;
                await createUnit.mutateAsync({
                  topNummer: newUnit.topNummer,
                  propertyId: propertyId,
                });
                setNewUnit({ topNummer: '' });
                setShowAddUnit(false);
              }}
              disabled={createUnit.isPending}
            >
              Speichern
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setShowAddUnit(false)}
            >
              Abbrechen
            </Button>
          </div>
        </div>
      )}

      {unitsList.length === 0 ? (
        <p className="text-sm text-muted-foreground">Noch keine Einheiten</p>
      ) : (
        <div className="space-y-2">
          {unitsList.map((unit) => (
            <div key={unit.id} className="flex justify-between items-center p-2 bg-muted rounded text-sm">
              <div className="flex items-center gap-2">
                <Home className="h-4 w-4 text-muted-foreground" />
                <span className="font-medium">{unit.topNummer}</span>
                <Badge variant={unit.status === 'aktiv' ? 'default' : 'secondary'} className="text-xs">
                  {unit.status === 'aktiv' ? 'Vermietet' : 'Leerstand'}
                </Badge>
              </div>
              <span className="text-muted-foreground">{unit.qm || unit.flaeche || 0} m²</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const MONTH_NAMES = ['Jän', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];

export default function SimpleDashboard() {
  const { data: organization, isLoading } = useOrganization();
  const { data: properties, isLoading: propertiesLoading } = useProperties();
  const { data: invoices } = useInvoices();
  const createProperty = useCreateProperty();
  const deleteProperty = useDeleteProperty();
  const { isComplete, markComplete } = useOnboardingStatus();
  const { isOpen, steps, startTour, closeTour, completeTour, autoStartTour, hasCompletedTour } = useFeatureTour();

  const [showAddForm, setShowAddForm] = useState(false);
  const [newProperty, setNewProperty] = useState({ name: '', address: '', city: '', postal_code: '' });
  const [selectedProperty, setSelectedProperty] = useState<string | null>(null);

  const propertiesList = properties || [];

  const currentYear = new Date().getFullYear();

  const revenueData = useMemo(() => {
    if (!invoices) return [];
    const monthMap = new Map<number, { income: number; expenses: number }>();
    for (let m = 0; m < 12; m++) monthMap.set(m, { income: 0, expenses: 0 });
    for (const inv of invoices) {
      if (inv.year !== currentYear) continue;
      const m = (inv.month || 1) - 1;
      const entry = monthMap.get(m);
      if (!entry) continue;
      const total = Number(inv.gesamtbetrag || 0);
      entry.income += total;
      const costs = Number(inv.betriebskosten || 0) + Number(inv.heizungskosten || 0) + Number(inv.sonstigeKosten || 0);
      entry.expenses += costs;
    }
    return Array.from(monthMap.entries())
      .sort(([a], [b]) => a - b)
      .map(([m, v]) => ({ month: MONTH_NAMES[m], income: v.income, expenses: v.expenses }));
  }, [invoices, currentYear]);

  const paymentRateData = useMemo(() => {
    if (!invoices) return [];
    const monthMap = new Map<number, { total: number; paid: number }>();
    for (let m = 0; m < 12; m++) monthMap.set(m, { total: 0, paid: 0 });
    for (const inv of invoices) {
      if (inv.year !== currentYear) continue;
      const m = (inv.month || 1) - 1;
      const entry = monthMap.get(m);
      if (!entry) continue;
      entry.total++;
      if (inv.status === 'bezahlt') entry.paid++;
    }
    return Array.from(monthMap.entries())
      .sort(([a], [b]) => a - b)
      .map(([m, v]) => ({
        month: MONTH_NAMES[m],
        rate: v.total > 0 ? Math.round((v.paid / v.total) * 1000) / 10 : 0,
      }));
  }, [invoices, currentYear]);
  const showOnboarding = !isComplete && propertiesList.length === 0 && !propertiesLoading;

  useEffect(() => {
    if (!isLoading && organization && !showOnboarding) {
      autoStartTour();
    }
  }, [isLoading, organization, showOnboarding, autoStartTour]);

  if (isLoading) {
    return (
      <MainLayout title="Dashboard" subtitle="Übersicht">
        <div className="max-w-4xl">
          <div className="bg-card rounded-lg shadow p-6 mb-6">
            <Skeleton className="h-6 w-32 mb-4" />
            <Skeleton className="h-4 w-64" />
          </div>
        </div>
      </MainLayout>
    );
  }

  if (!organization) {
    return (
      <MainLayout title="Dashboard" subtitle="Übersicht">
        <div className="max-w-4xl">
          <div className="bg-card rounded-lg shadow p-6">
            <h2 className="text-xl font-semibold mb-2">Organisation nicht gefunden</h2>
            <p className="text-muted-foreground">Bitte erstellen Sie zuerst eine Organisation.</p>
          </div>
        </div>
      </MainLayout>
    );
  }

  return (
    <MainLayout title="Dashboard" subtitle="Übersicht">
      <FeatureTour
        steps={steps}
        isOpen={isOpen}
        onClose={closeTour}
        onComplete={completeTour}
      />

      {showOnboarding && (
        <OnboardingWizard onComplete={markComplete} onSkip={markComplete} />
      )}

      <div className="max-w-4xl" data-tour="dashboard">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
          <h1 className="text-2xl font-bold">ImmoFlowMe</h1>
          <div className="flex gap-2">
            {hasCompletedTour && (
              <Button variant="outline" size="sm" onClick={startTour}>
                <Sparkles className="h-4 w-4 mr-2" />
                Tour starten
              </Button>
            )}
            <Button variant="outline" asChild>
              <Link to="/einstellungen">Einstellungen</Link>
            </Button>
          </div>
        </div>

        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Organisation</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <p className="text-sm text-muted-foreground">Name</p>
                <p className="text-lg font-medium">{organization.name}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Status</p>
                <Badge className="bg-green-100 text-green-800">Aktiv</Badge>
              </div>
            </div>
          </CardContent>
        </Card>

        <PropertyKPIsWidget />

        <div className="mt-6">
          <OffenePostenWidget />
        </div>

        <div className="mt-6">
          <DataQualityWidget />
        </div>

        <div className="mt-6">
          <BankAccountsWidget />
        </div>

        <div className="mt-6">
          <ExpiringLeasesWidget daysAhead={90} />
        </div>

        <div className="mt-6">
          <UpcomingMaintenanceWidget />
        </div>

        <div className="mt-6">
          <CalendarWidget />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Einnahmen vs. Ausgaben</CardTitle>
            </CardHeader>
            <CardContent>
              <MonthlyRevenueChart data={revenueData} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Mieteingangsquote</CardTitle>
            </CardHeader>
            <CardContent>
              <PaymentRateChart data={paymentRateData} />
            </CardContent>
          </Card>
        </div>

        <Card className="mt-6">
          <CardHeader>
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2">
              <CardTitle className="flex items-center gap-2">
                <Building2 className="h-5 w-5" />
                Meine Liegenschaften ({propertiesList.length})
              </CardTitle>
              <Button onClick={() => setShowAddForm(true)}>
                <Plus className="h-4 w-4 mr-2" />
                Neue Liegenschaft
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {showAddForm && (
              <div className="mb-6 p-4 border rounded-lg bg-muted">
                <h3 className="font-semibold mb-4">Neue Liegenschaft</h3>
                <div className="space-y-3">
                  <Input
                    type="text"
                    placeholder="Name (z.B. Bahnhofstraße 12)"
                    value={newProperty.name}
                    onChange={(e) => setNewProperty({ ...newProperty, name: e.target.value })}
                  />
                  <Input
                    type="text"
                    placeholder="Adresse"
                    value={newProperty.address}
                    onChange={(e) => setNewProperty({ ...newProperty, address: e.target.value })}
                  />
                  <div className="grid grid-cols-2 gap-3">
                    <Input
                      type="text"
                      placeholder="PLZ"
                      value={newProperty.postal_code}
                      onChange={(e) => setNewProperty({ ...newProperty, postal_code: e.target.value })}
                    />
                    <Input
                      type="text"
                      placeholder="Stadt"
                      value={newProperty.city}
                      onChange={(e) => setNewProperty({ ...newProperty, city: e.target.value })}
                    />
                  </div>
                  <div className="flex flex-col sm:flex-row gap-2">
                    <Button
                      onClick={async () => {
                        if (!newProperty.name || !newProperty.address || !newProperty.city || !newProperty.postal_code) return;
                        await createProperty.mutateAsync(newProperty);
                        setNewProperty({ name: '', address: '', city: '', postal_code: '' });
                        setShowAddForm(false);
                      }}
                      disabled={createProperty.isPending}
                    >
                      Speichern
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => {
                        setShowAddForm(false);
                        setNewProperty({ name: '', address: '', city: '', postal_code: '' });
                      }}
                    >
                      Abbrechen
                    </Button>
                  </div>
                </div>
              </div>
            )}

            {propertiesLoading ? (
              <div className="space-y-4">
                <Skeleton className="h-24 w-full" />
                <Skeleton className="h-24 w-full" />
              </div>
            ) : propertiesList.length === 0 && !showAddForm ? (
              <p className="text-muted-foreground py-8 text-center">
                Noch keine Liegenschaften vorhanden. Erstellen Sie Ihre erste Liegenschaft!
              </p>
            ) : (
              <div className="space-y-4">
                {propertiesList.map((property) => (
                  <div
                    key={property.id}
                    className="border rounded-lg p-4 hover:shadow-md transition cursor-pointer"
                    onClick={() => setSelectedProperty(property.id === selectedProperty ? null : property.id)}
                  >
                    <div className="flex justify-between items-start">
                      <div className="flex items-center gap-3">
                        {selectedProperty === property.id ? (
                          <ChevronDown className="h-5 w-5 text-muted-foreground shrink-0" />
                        ) : (
                          <ChevronRight className="h-5 w-5 text-muted-foreground shrink-0" />
                        )}
                        <div className="min-w-0">
                          <h3 className="font-semibold text-lg truncate">{property.name}</h3>
                          <p className="text-muted-foreground text-sm truncate">
                            {property.address}, {property.postal_code} {property.city}
                          </p>
                          <p className="text-sm text-muted-foreground mt-1">
                            {property.total_units || 0} Einheiten • {(property as any).rented_units || 0} vermietet • {property.total_qm || 0} m²
                          </p>
                        </div>
                      </div>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="shrink-0"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Liegenschaft löschen?</AlertDialogTitle>
                            <AlertDialogDescription>
                              Diese Aktion kann nicht rückgängig gemacht werden. Alle zugehörigen Einheiten und Mieter werden ebenfalls gelöscht.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Abbrechen</AlertDialogCancel>
                            <AlertDialogAction onClick={() => deleteProperty.mutate(property.id)}>
                              Löschen
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>

                    {selectedProperty === property.id && (
                      <UnitsSection propertyId={property.id} />
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </MainLayout>
  );
}
