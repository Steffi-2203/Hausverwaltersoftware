import { Sidebar } from './Sidebar';
import { Header } from './Header';
import { PaymentStatusBanner } from './PaymentStatusBanner';
import { TrialBanner } from '@/components/subscription/SubscriptionTeaser';
import { UserUpgradeBanner } from '@/components/subscription/UserUpgradeBanner';
import { DemoTimerBanner } from '@/components/DemoTimerBanner';
import { SidebarProvider, useSidebarContext } from '@/contexts/SidebarContext';
import { useIsMobile } from '@/hooks/use-mobile';
import { cn } from '@/lib/utils';

interface MainLayoutProps {
  children: React.ReactNode;
  title: string;
  subtitle?: string;
}

function MainLayoutContent({ children, title, subtitle }: MainLayoutProps) {
  const isMobile = useIsMobile();
  const { collapsed } = useSidebarContext();

  return (
    <div className="min-h-screen bg-background">
      <DemoTimerBanner />
      <Sidebar />
      <div 
        className={cn(
          'transition-all duration-300',
          isMobile ? 'pl-0' : (collapsed ? 'pl-16' : 'pl-64')
        )}
      >
        <UserUpgradeBanner />
        <PaymentStatusBanner />
        <TrialBanner />
        <Header title={title} subtitle={subtitle} />
        <main className="p-4 md:p-6">{children}</main>
      </div>
    </div>
  );
}

export function MainLayout({ children, title, subtitle }: MainLayoutProps) {
  return (
    <SidebarProvider>
      <MainLayoutContent title={title} subtitle={subtitle}>
        {children}
      </MainLayoutContent>
    </SidebarProvider>
  );
}
