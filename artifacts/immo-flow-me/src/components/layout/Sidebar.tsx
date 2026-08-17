import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { 
  Building, 
  LayoutDashboard, 
  FileStack, 
  TrendingUp, 
  Cog, 
  Wallet, 
  Layers, 
  Calculator, 
  ChevronLeft, 
  ChevronRight, 
  ChevronDown,
  BookOpen, 
  Receipt,
  Users,
  X,
  Shield,
  Wrench,
  MessageSquare,
  HardHat,
  Home,
  ShieldCheck,
  CalendarClock,
  DoorOpen,
  Lock,
  AlertTriangle,
  Bot,
  Zap,
  ScanLine,
  Brain,
  MessageSquarePlus,
  Sparkles,
  ClipboardList,
  Landmark,
  Flame,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useIsMobile } from '@/hooks/use-mobile';
import { useSidebarContext } from '@/contexts/SidebarContext';
import { useIsAdmin } from '@/hooks/useAdmin';
import { usePermissions } from '@/hooks/usePermissions';
import { useIsTester } from '@/hooks/useUserRole';
import { useSidebarBadges } from '@/hooks/useSidebarBadges';
import { useKiAutopilot } from '@/hooks/useKiAutopilot';
import immoflowLogo from '@/assets/immoflowme-logo.png';

interface NavItem {
  label: string;
  icon: React.ElementType;
  href: string;
  badge?: number;
  tourId?: string;
}

interface NavGroup {
  label: string;
  icon?: React.ElementType;
  items: NavItem[];
  collapsible?: boolean;
}

const navGroups: NavGroup[] = [
  {
    label: '',
    items: [
      { label: 'Dashboard', icon: LayoutDashboard, href: '/dashboard', tourId: 'nav-dashboard' },
      { label: 'Liegenschaften', icon: Building, href: '/liegenschaften', tourId: 'nav-properties' },
      { label: 'Einheiten', icon: Layers, href: '/einheiten', tourId: 'nav-units' },
    ],
  },
  {
    label: 'Mietverwaltung',
    icon: Users,
    collapsible: true,
    items: [
      { label: 'Mieter', icon: Users, href: '/mieter', tourId: 'nav-tenants' },
      { label: 'Mieteinnahmen', icon: Wallet, href: '/zahlungen' },
      { label: 'BK-Abrechnung', icon: Calculator, href: '/abrechnung' },
      { label: 'Heizkosten', icon: Flame, href: '/heizkosten' },
      { label: 'Mietzinsrechner', icon: Calculator, href: '/mietzinsrechner' },
      { label: 'VPI-Anpassungen', icon: TrendingUp, href: '/vpi-anpassungen' },
      { label: 'Mieterportal', icon: DoorOpen, href: '/mieterportal' },
      { label: 'Aktivitäten', icon: ClipboardList, href: '/aktivitaeten' },
    ],
  },
  {
    label: 'WEG-Verwaltung',
    icon: Home,
    collapsible: true,
    items: [
      { label: 'WEG-Verwaltung', icon: Home, href: '/weg', tourId: 'nav-weg' },
      { label: 'WEG-Vorschreibungen', icon: ClipboardList, href: '/weg-vorschreibungen', tourId: 'nav-weg-vs' },
      { label: 'Eigentümerportal', icon: DoorOpen, href: '/eigentuemerportal' },
    ],
  },
  {
    label: 'Finanzen',
    icon: BookOpen,
    collapsible: true,
    items: [
      { label: 'Kosten & Belege', icon: Receipt, href: '/kosten', tourId: 'nav-expenses' },
      { label: 'Finanzbuchhaltung', icon: Calculator, href: '/finanzbuchhaltung', tourId: 'nav-accounting' },
      { label: 'EBICS Banking', icon: Landmark, href: '/ebics-banking' },
      { label: 'Offene Posten', icon: AlertTriangle, href: '/offene-posten', tourId: 'nav-op' },
      { label: 'Jahresabschluss', icon: Lock, href: '/jahresabschluss', tourId: 'nav-ja' },
      { label: 'Reports', icon: TrendingUp, href: '/reports', tourId: 'nav-reports' },
    ],
  },
  {
    label: 'Verwaltung',
    icon: Cog,
    collapsible: true,
    items: [
      { label: 'Dokumente', icon: FileStack, href: '/dokumente' },
      { label: 'Versicherungen', icon: ShieldCheck, href: '/versicherungen' },
      { label: 'Fristen & Termine', icon: CalendarClock, href: '/fristen' },
      { label: 'Schadensmeldungen', icon: AlertTriangle, href: '/schadensmeldungen' },
      { label: 'Assistenten', icon: HardHat, href: '/workflows' },
    ],
  },
  {
    label: '',
    items: [
      { label: 'Einstellungen', icon: Cog, href: '/einstellungen', tourId: 'nav-settings' },
    ],
  },
];

export function Sidebar() {
  const location = useLocation();
  const isMobile = useIsMobile();
  const { isOpen, collapsed, closeSidebar, toggleCollapsed } = useSidebarContext();
  const { data: isAdmin } = useIsAdmin();
  const permissions = usePermissions();
  const { isTester } = useIsTester();
  const { data: badges } = useSidebarBadges();
  const { isActive: kiActive } = useKiAutopilot();

  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

  const toggleGroup = (label: string) => {
    setCollapsedGroups(prev => {
      const next = new Set(prev);
      if (next.has(label)) {
        next.delete(label);
      } else {
        next.add(label);
      }
      return next;
    });
  };

  const kiPaths = ['/ki-assistent', '/automatisierung', '/ki-rechnungen', '/ki-insights', '/ki-kommunikation'];

  const badgeMap: Record<string, number> = {
    '/zahlungen': badges?.dunning ?? 0,
    '/wartungen': badges?.maintenance ?? 0,
    '/nachrichten': badges?.messages ?? 0,
    '/kosten': badges?.invoiceApproval ?? 0,
  };

  const testerHiddenPaths = ['/team'];

  const roleBasedItems: NavItem[] = [
    ...(permissions.canManageMaintenance || permissions.isAdmin ? [{
      label: 'Wartungen & Aufträge',
      icon: Wrench,
      href: '/wartungen',
      tourId: 'nav-maintenance'
    }] : []),
    ...(permissions.canSendMessages || permissions.isAdmin ? [{
      label: 'Nachrichten',
      icon: MessageSquare,
      href: '/nachrichten',
      tourId: 'nav-messages'
    }] : []),
    ...(permissions.canManageUsers || permissions.isAdmin ? [{
      label: 'Team-Verwaltung',
      icon: Users,
      href: '/team',
      tourId: 'nav-team'
    }] : []),
  ];

  const allGroups = navGroups.map(group => {
    if (group.label === 'Verwaltung') {
      return { ...group, items: [...group.items, ...roleBasedItems] };
    }
    return group;
  }).map(group => ({
    ...group,
    items: group.items.filter(item => {
      if (isTester && testerHiddenPaths.includes(item.href)) return false;
      if (kiPaths.includes(item.href) && !kiActive) return false;
      return true;
    }),
  })).filter(group => group.items.length > 0);

  if (kiActive) {
    const kiGroup: NavGroup = {
      label: 'KI-Autopilot',
      icon: Sparkles,
      collapsible: true,
      items: [
        { label: 'KI-Assistent', icon: Bot, href: '/ki-assistent' },
        { label: 'Automatisierung', icon: Zap, href: '/automatisierung' },
        { label: 'KI-Rechnungen', icon: ScanLine, href: '/ki-rechnungen' },
        { label: 'KI-Insights', icon: Brain, href: '/ki-insights' },
        { label: 'KI-Kommunikation', icon: MessageSquarePlus, href: '/ki-kommunikation' },
      ],
    };
    allGroups.splice(allGroups.length - 1, 0, kiGroup);
  }

  const handleLinkClick = () => {
    if (isMobile) {
      closeSidebar();
    }
  };

  const isGroupExpanded = (group: NavGroup) => {
    if (!group.collapsible) return true;
    if (!collapsedGroups.has(group.label)) return true;
    return group.items.some(item => location.pathname === item.href || (item.href !== '/' && location.pathname.startsWith(item.href)));
  };

  if (isMobile) {
    return (
      <>
        {isOpen && (
          <div 
            className="fixed inset-0 bg-black/50 z-40 transition-opacity"
            onClick={closeSidebar}
          />
        )}
        
        <aside 
          data-tour="sidebar"
          className={cn(
            'fixed left-0 top-0 z-50 h-screen bg-sidebar border-r border-sidebar-border w-64 transition-transform duration-300 flex flex-col',
            isOpen ? 'translate-x-0' : '-translate-x-full'
          )}
        >
          <div className="flex h-20 items-center justify-between px-4 border-b border-sidebar-border shrink-0">
            <div className="flex items-center gap-3">
              <img src={immoflowLogo} alt="ImmoFlowMe Logo" className="h-12 w-auto" />
              <div className="flex flex-col">
                <span className="font-bold text-white text-lg leading-tight">ImmoFlowMe</span>
                <span className="text-xs text-white/60">by ImmoPepper</span>
              </div>
            </div>
            <Button 
              variant="ghost" 
              size="icon" 
              className="h-8 w-8 bg-sidebar-accent/50 text-white hover:bg-sidebar-accent"
              onClick={closeSidebar}
            >
              <X className="h-5 w-5" />
            </Button>
          </div>

          <nav className="flex-1 overflow-y-auto flex flex-col gap-0.5 p-2 mt-2">
            {allGroups.map((group, gi) => (
              <div key={group.label || `g${gi}`}>
                {group.label && (
                  <div 
                    className={cn(
                      "flex items-center gap-2 px-3 pt-4 pb-1",
                      group.collapsible && "cursor-pointer select-none"
                    )}
                    onClick={group.collapsible ? () => toggleGroup(group.label) : undefined}
                  >
                    {group.icon && <group.icon className="h-3.5 w-3.5 text-white/50" />}
                    <span className="text-[11px] font-semibold uppercase tracking-wider text-white/50 flex-1">{group.label}</span>
                    {group.collapsible && (
                      <ChevronDown className={cn(
                        "h-3 w-3 text-white/40 transition-transform",
                        collapsedGroups.has(group.label) && "-rotate-90"
                      )} />
                    )}
                  </div>
                )}
                {isGroupExpanded(group) && group.items.map(item => {
                  const isActive = location.pathname === item.href || 
                    (item.href !== '/' && location.pathname.startsWith(item.href));
                  return (
                    <Link 
                      key={item.href}
                      to={item.href}
                      onClick={handleLinkClick}
                      data-tour={item.tourId}
                      className={cn(
                        'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-all',
                        'text-white/80 hover:text-white hover:bg-white/10',
                        isActive && 'bg-white/15 text-white'
                      )}
                    >
                      <item.icon className="h-4.5 w-4.5 shrink-0" />
                      <span className="flex-1">{item.label}</span>
                      {(badgeMap[item.href] ?? 0) > 0 && (
                        <span className="rounded-full bg-sidebar-primary px-2 py-0.5 text-xs text-sidebar-primary-foreground">
                          {badgeMap[item.href]}
                        </span>
                      )}
                    </Link>
                  );
                })}
              </div>
            ))}
            {isAdmin && (
              <Link 
                to="/admin"
                onClick={handleLinkClick}
                className={cn(
                  'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-all',
                  'text-white/80 hover:text-white hover:bg-white/10',
                  location.pathname.startsWith('/admin') && 'bg-white/15 text-white'
                )}
              >
                <Shield className="h-4.5 w-4.5 shrink-0" />
                <span className="flex-1">Administration</span>
              </Link>
            )}
          </nav>

          <div className="shrink-0 p-4 border-t border-sidebar-border">
            <div className="rounded-lg bg-sidebar-accent p-3">
              <p className="text-xs text-sidebar-foreground/50">© 2026 ImmoFlowMe by ImmoPepper</p>
            </div>
          </div>
        </aside>
      </>
    );
  }

  return (
    <aside 
      data-tour="sidebar"
      className={cn(
        'fixed left-0 top-0 z-40 h-screen bg-sidebar border-r border-sidebar-border transition-all duration-300 flex flex-col',
        collapsed ? 'w-16' : 'w-64'
      )}
    >
      <div className="flex h-20 items-center justify-between px-4 border-b border-sidebar-border shrink-0">
        {!collapsed && (
          <div className="flex items-center gap-3">
            <img src={immoflowLogo} alt="ImmoFlowMe Logo" className="h-12 w-auto" />
            <div className="flex flex-col">
              <span className="font-bold text-white text-lg leading-tight">ImmoFlowMe</span>
              <span className="text-xs text-white/60">by ImmoPepper</span>
            </div>
          </div>
        )}
        {collapsed && (
          <img src={immoflowLogo} alt="ImmoFlowMe Logo" className="h-10 w-10 object-contain" />
        )}
        <Button 
          variant="ghost" 
          size="icon" 
          className="h-8 w-8 bg-sidebar-accent/50 text-white hover:bg-sidebar-accent" 
          onClick={toggleCollapsed}
        >
          {collapsed ? <ChevronRight className="h-5 w-5" /> : <ChevronLeft className="h-5 w-5" />}
        </Button>
      </div>

      <nav className="flex-1 overflow-y-auto flex flex-col gap-0.5 p-2 mt-2">
        {allGroups.map((group, gi) => (
          <div key={group.label || `g${gi}`}>
            {group.label && !collapsed && (
              <div 
                className={cn(
                  "flex items-center gap-2 px-3 pt-4 pb-1",
                  group.collapsible && "cursor-pointer select-none"
                )}
                onClick={group.collapsible ? () => toggleGroup(group.label) : undefined}
              >
                {group.icon && <group.icon className="h-3.5 w-3.5 text-white/50" />}
                <span className="text-[11px] font-semibold uppercase tracking-wider text-white/50 flex-1">{group.label}</span>
                {group.collapsible && (
                  <ChevronDown className={cn(
                    "h-3 w-3 text-white/40 transition-transform",
                    collapsedGroups.has(group.label) && "-rotate-90"
                  )} />
                )}
              </div>
            )}
            {group.label && collapsed && (
              <div className="flex justify-center pt-3 pb-1">
                {group.icon && <group.icon className="h-3.5 w-3.5 text-white/50" />}
              </div>
            )}
            {isGroupExpanded(group) && group.items.map(item => {
              const isActive = location.pathname === item.href || 
                (item.href !== '/' && location.pathname.startsWith(item.href));
              return (
                <Link 
                  key={item.href}
                  to={item.href} 
                  title={collapsed ? item.label : undefined}
                  data-tour={item.tourId}
                  className={cn(
                    'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-all',
                    'text-white/80 hover:text-white hover:bg-white/10',
                    isActive && 'bg-white/15 text-white'
                  )}
                >
                  <item.icon className="h-4.5 w-4.5 shrink-0" />
                  {!collapsed && (
                    <>
                      <span className="flex-1">{item.label}</span>
                      {(badgeMap[item.href] ?? 0) > 0 && (
                        <span className="rounded-full bg-sidebar-primary px-2 py-0.5 text-xs text-sidebar-primary-foreground">
                          {badgeMap[item.href]}
                        </span>
                      )}
                    </>
                  )}
                </Link>
              );
            })}
          </div>
        ))}
        {isAdmin && (
          <Link 
            to="/admin"
            title={collapsed ? 'Administration' : undefined}
            className={cn(
              'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-all',
              'text-white/80 hover:text-white hover:bg-white/10',
              location.pathname.startsWith('/admin') && 'bg-white/15 text-white'
            )}
          >
            <Shield className="h-4.5 w-4.5 shrink-0" />
            {!collapsed && <span className="flex-1">Administration</span>}
          </Link>
        )}
      </nav>

      {!collapsed && (
        <div className="shrink-0 p-4 border-t border-sidebar-border">
          <div className="rounded-lg bg-sidebar-accent p-3">
            <p className="text-xs text-sidebar-foreground/50">© 2026 ImmoFlowMe by ImmoPepper</p>
          </div>
        </div>
      )}
    </aside>
  );
}
