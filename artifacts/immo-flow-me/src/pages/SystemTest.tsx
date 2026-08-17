import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { MainLayout } from '@/components/layout/MainLayout';
import { CheckCircle2, XCircle, Loader2, Play } from 'lucide-react';
import { apiRequest } from '@/lib/queryClient';

interface TestResult {
  test: string;
  status: 'PASS' | 'FAIL';
  message: string;
}

export default function SystemTest() {
  const [testResults, setTestResults] = useState<TestResult[]>([]);
  const [isRunning, setIsRunning] = useState(false);

  const runTests = async () => {
    setIsRunning(true);
    setTestResults([]);
    const results: TestResult[] = [];

    try {
      const response = await fetch('/api/health', { credentials: 'include' });
      const data = await response.json();
      results.push({
        test: 'API-Verbindung',
        status: response.ok ? 'PASS' : 'FAIL',
        message: response.ok ? 'Backend erreichbar' : 'Backend nicht erreichbar'
      });
    } catch (e: any) {
      results.push({ test: 'API-Verbindung', status: 'FAIL', message: e.message });
    }

    let profile: any = null;
    try {
      const response = await fetch('/api/profile', { credentials: 'include' });
      if (response.ok) {
        profile = await response.json();
        results.push({
          test: 'Benutzer-Authentifizierung',
          status: 'PASS',
          message: `Benutzer: ${profile.email}`
        });
      } else {
        results.push({
          test: 'Benutzer-Authentifizierung',
          status: 'FAIL',
          message: 'Nicht eingeloggt'
        });
      }
    } catch (e: any) {
      results.push({ test: 'Benutzer-Authentifizierung', status: 'FAIL', message: e.message });
    }

    if (profile?.organizationId) {
      try {
        const response = await fetch('/api/profile/organization', { credentials: 'include' });
        if (response.ok) {
          const org = await response.json();
          results.push({
            test: 'Organisation',
            status: org ? 'PASS' : 'FAIL',
            message: org ? `${org.name} (${org.subscriptionTier || 'standard'})` : 'Keine Organisation'
          });
        } else {
          results.push({
            test: 'Organisation',
            status: 'FAIL',
            message: 'Organisation nicht gefunden'
          });
        }
      } catch (e: any) {
        results.push({ test: 'Organisation', status: 'FAIL', message: e.message });
      }
    }

    try {
      const response = await fetch('/api/properties', { credentials: 'include' });
      const properties = await response.json();
      results.push({
        test: 'Liegenschaften-Abfrage',
        status: response.ok ? 'PASS' : 'FAIL',
        message: response.ok ? `${properties.length} Liegenschaften` : 'Abfrage fehlgeschlagen'
      });
    } catch (e: any) {
      results.push({ test: 'Liegenschaften-Abfrage', status: 'FAIL', message: e.message });
    }

    try {
      const response = await fetch('/api/units', { credentials: 'include' });
      const units = await response.json();
      results.push({
        test: 'Einheiten-Abfrage',
        status: response.ok ? 'PASS' : 'FAIL',
        message: response.ok ? `${units.length} Einheiten` : 'Abfrage fehlgeschlagen'
      });
    } catch (e: any) {
      results.push({ test: 'Einheiten-Abfrage', status: 'FAIL', message: e.message });
    }

    try {
      const response = await fetch('/api/tenants', { credentials: 'include' });
      const tenants = await response.json();
      results.push({
        test: 'Mieter-Abfrage',
        status: response.ok ? 'PASS' : 'FAIL',
        message: response.ok ? `${tenants.length} Mieter` : 'Abfrage fehlgeschlagen'
      });
    } catch (e: any) {
      results.push({ test: 'Mieter-Abfrage', status: 'FAIL', message: e.message });
    }

    if (profile) {
      try {
        const testProperty = {
          name: '[TEST] Automatischer Systemtest',
          address: 'Test Straße 1',
          city: 'Wien',
          postal_code: '1010',
        };

        const createResponse = await apiRequest('POST', '/api/properties', testProperty);
        const created = await createResponse.json();

        if (created?.id) {
          await apiRequest('DELETE', `/api/properties/${created.id}`);
          
          results.push({
            test: 'Erstellen/Löschen-Berechtigung',
            status: 'PASS',
            message: 'Insert & Delete erfolgreich'
          });
        } else {
          results.push({
            test: 'Erstellen/Löschen-Berechtigung',
            status: 'FAIL',
            message: 'Insert fehlgeschlagen'
          });
        }
      } catch (e: any) {
        results.push({ test: 'Erstellen/Löschen-Berechtigung', status: 'FAIL', message: e.message });
      }
    }

    try {
      const response = await fetch('/api/functions/validate-invoice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dryRun: true }),
        credentials: 'include'
      });
      
      results.push({
        test: 'API-Funktionen',
        status: response.ok ? 'PASS' : 'FAIL',
        message: response.ok ? 'API-Funktionen erreichbar' : 'API-Funktionen nicht erreichbar'
      });
    } catch (e: any) {
      results.push({ test: 'API-Funktionen', status: 'FAIL', message: e.message });
    }

    if (profile?.roles) {
      const isAdmin = profile.roles.includes('admin');
      results.push({
        test: 'Admin-Rolle',
        status: isAdmin ? 'PASS' : 'FAIL',
        message: isAdmin ? 'Admin-Rolle vorhanden' : `Rollen: ${profile.roles.join(', ') || 'keine'}`
      });
    }

    setTestResults(results);
    setIsRunning(false);
  };

  const passedTests = testResults.filter(r => r.status === 'PASS').length;
  const failedTests = testResults.filter(r => r.status === 'FAIL').length;
  const allPassed = testResults.length > 0 && failedTests === 0;

  return (
    <MainLayout title="System Test" subtitle="Admin-Bereich">
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-3xl font-bold">System Test</h1>
            <p className="text-muted-foreground">Überprüfen Sie die Systemkonfiguration und Verbindungen</p>
          </div>
          <Button onClick={runTests} disabled={isRunning} size="lg" data-testid="button-run-tests">
            {isRunning ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Tests laufen...
              </>
            ) : (
              <>
                <Play className="mr-2 h-4 w-4" />
                Tests starten
              </>
            )}
          </Button>
        </div>

        {testResults.length > 0 && (
          <Card className={allPassed ? 'border-green-500 bg-green-50 dark:bg-green-950/20' : 'border-red-500 bg-red-50 dark:bg-red-950/20'}>
            <CardContent className="pt-6">
              <div className="flex items-center gap-4">
                {allPassed ? (
                  <CheckCircle2 className="h-12 w-12 text-green-600" />
                ) : (
                  <XCircle className="h-12 w-12 text-red-600" />
                )}
                <div>
                  <h2 className="text-xl font-bold">
                    {allPassed ? 'Alle Tests bestanden!' : 'Einige Tests fehlgeschlagen'}
                  </h2>
                  <p className="text-muted-foreground">
                    {passedTests} / {testResults.length} Tests erfolgreich
                    {failedTests > 0 && ` - ${failedTests} fehlgeschlagen`}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        <div className="grid gap-3">
          {testResults.map((result, idx) => (
            <Card key={idx} className={result.status === 'PASS' ? 'border-l-4 border-l-green-500' : 'border-l-4 border-l-red-500'}>
              <CardContent className="py-4">
                <div className="flex justify-between items-center gap-2 flex-wrap">
                  <div className="flex items-center gap-3">
                    {result.status === 'PASS' ? (
                      <CheckCircle2 className="h-5 w-5 text-green-600" />
                    ) : (
                      <XCircle className="h-5 w-5 text-red-600" />
                    )}
                    <div>
                      <h3 className="font-semibold">{result.test}</h3>
                      <p className="text-sm text-muted-foreground">{result.message}</p>
                    </div>
                  </div>
                  <Badge variant={result.status === 'PASS' ? 'default' : 'destructive'}>
                    {result.status}
                  </Badge>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {testResults.length === 0 && !isRunning && (
          <Card>
            <CardContent className="py-12 text-center">
              <p className="text-muted-foreground">
                Klicken Sie auf "Tests starten" um die Systemkonfiguration zu überprüfen
              </p>
            </CardContent>
          </Card>
        )}
      </div>
    </MainLayout>
  );
}
