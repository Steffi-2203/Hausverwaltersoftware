import { useSearchParams } from 'react-router-dom';
import { MainLayout } from '@/components/layout/MainLayout';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Wallet, FileText, AlertTriangle } from 'lucide-react';
import { usePermissions } from '@/hooks/usePermissions';
import PaymentList from './PaymentList';
import InvoiceList from './InvoiceList';
import Dunning from './Dunning';

export default function RentalFinance() {
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = searchParams.get('tab') || 'payments';
  const permissions = usePermissions();

  const showDunning = permissions.canEditFinances || permissions.isAdmin;

  return (
    <MainLayout
      title="Mieteinnahmen"
      subtitle="Zahlungen, Vorschreibungen und Mahnwesen"
    >
      <Tabs
        value={activeTab}
        onValueChange={(tab) => setSearchParams({ tab })}
      >
        <TabsList className="mb-6">
          <TabsTrigger value="payments" className="gap-2">
            <Wallet className="h-4 w-4" />
            Mieteinnahmen
          </TabsTrigger>
          <TabsTrigger value="invoices" className="gap-2">
            <FileText className="h-4 w-4" />
            Vorschreibungen
          </TabsTrigger>
          {showDunning && (
            <TabsTrigger value="dunning" className="gap-2">
              <AlertTriangle className="h-4 w-4" />
              Mahnwesen
            </TabsTrigger>
          )}
        </TabsList>

        <TabsContent value="payments">
          <PaymentList />
        </TabsContent>
        <TabsContent value="invoices">
          <InvoiceList />
        </TabsContent>
        {showDunning && (
          <TabsContent value="dunning">
            <Dunning />
          </TabsContent>
        )}
      </Tabs>
    </MainLayout>
  );
}
