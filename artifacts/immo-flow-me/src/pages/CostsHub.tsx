import { useSearchParams } from 'react-router-dom';
import { MainLayout } from '@/components/layout/MainLayout';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Receipt, CheckSquare } from 'lucide-react';
import { usePermissions } from '@/hooks/usePermissions';
import ExpenseList from './ExpenseList';
import InvoiceApproval from './InvoiceApproval';

export default function CostsHub() {
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = searchParams.get('tab') || 'expenses';
  const permissions = usePermissions();

  const showApproval = permissions.canApproveInvoices || permissions.isAdmin;

  return (
    <MainLayout
      title="Kosten & Belege"
      subtitle="Ausgaben erfassen und Rechnungen freigeben"
    >
      <Tabs
        value={activeTab}
        onValueChange={(tab) => setSearchParams({ tab })}
      >
        <TabsList className="mb-6">
          <TabsTrigger value="expenses" className="gap-2">
            <Receipt className="h-4 w-4" />
            Kosten & Belege
          </TabsTrigger>
          {showApproval && (
            <TabsTrigger value="approval" className="gap-2">
              <CheckSquare className="h-4 w-4" />
              Rechnungsfreigabe
            </TabsTrigger>
          )}
        </TabsList>

        <TabsContent value="expenses">
          <ExpenseList />
        </TabsContent>
        {showApproval && (
          <TabsContent value="approval">
            <InvoiceApproval />
          </TabsContent>
        )}
      </Tabs>
    </MainLayout>
  );
}
