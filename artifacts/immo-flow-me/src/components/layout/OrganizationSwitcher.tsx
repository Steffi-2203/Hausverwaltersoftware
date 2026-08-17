import { Building2, ChevronDown, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useActiveOrganization } from '@/contexts/ActiveOrganizationContext';
import { cn } from '@/lib/utils';

export function OrganizationSwitcher() {
  const { activeOrgId, activeOrgName, organizations, switchOrganization } = useActiveOrganization();

  // Don't render if user has 0 or 1 org
  if (organizations.length <= 1) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2 max-w-[200px]">
          <Building2 className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="truncate text-sm">{activeOrgName || 'Mandant wählen'}</span>
          <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel className="text-xs text-muted-foreground">
          Mandant wechseln
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {organizations.map((membership) => (
          <DropdownMenuItem
            key={membership.organization_id}
            onClick={() => switchOrganization(membership.organization_id)}
            className={cn(
              'flex items-center justify-between cursor-pointer',
              membership.organization_id === activeOrgId && 'bg-accent'
            )}
          >
            <div className="flex items-center gap-2 min-w-0">
              <Building2 className="h-4 w-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{membership.organization?.name}</p>
                <p className="text-xs text-muted-foreground capitalize">{membership.role}</p>
              </div>
            </div>
            {membership.organization_id === activeOrgId && (
              <Check className="h-4 w-4 shrink-0 text-primary" />
            )}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
