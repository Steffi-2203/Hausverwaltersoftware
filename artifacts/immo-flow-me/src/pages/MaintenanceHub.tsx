import { useSearchParams } from 'react-router-dom';
import { MainLayout } from '@/components/layout/MainLayout';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Wrench, HardHat } from 'lucide-react';
import Maintenance from './Maintenance';
import Contractors from './Contractors';

export default function MaintenanceHub() {
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = searchParams.get('tab') || 'tasks';

  return (
    <MainLayout
      title="Wartungen & Aufträge"
      subtitle="Facility Management, Handwerker und Aufträge verwalten"
    >
      <Tabs
        value={activeTab}
        onValueChange={(tab) => setSearchParams({ tab })}
      >
        <TabsList className="mb-6">
          <TabsTrigger value="tasks" className="gap-2">
            <Wrench className="h-4 w-4" />
            Aufträge
          </TabsTrigger>
          <TabsTrigger value="contractors" className="gap-2">
            <HardHat className="h-4 w-4" />
            Handwerker
          </TabsTrigger>
        </TabsList>

        <TabsContent value="tasks">
          <Maintenance />
        </TabsContent>
        <TabsContent value="contractors">
          <Contractors />
        </TabsContent>
      </Tabs>
    </MainLayout>
  );
}
