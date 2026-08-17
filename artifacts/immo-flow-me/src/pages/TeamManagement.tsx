import { useState } from 'react';
import { MainLayout } from '@/components/layout/MainLayout';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { usePermissions } from '@/hooks/usePermissions';
import { useTeamMembers, useTeamStats, useUpdateTeamMemberRole, useRemoveTeamMemberRole, TeamMember } from '@/hooks/useTeamMembers';
import { useAuth } from '@/hooks/useAuth';
import { Users, Shield, Briefcase, Eye, UserX, Search, AlertTriangle, UserPlus, Clock, X, Building2 } from 'lucide-react';
import { format } from 'date-fns';
import { de } from 'date-fns/locale';
import { InviteUserDialog } from '@/components/settings/InviteUserDialog';
import { PropertyAssignmentDialog } from '@/components/settings/PropertyAssignmentDialog';
import { usePendingInvites, useDeleteInvite, ROLE_LABELS } from '@/hooks/useOrganizationInvites';

type AppRole = 'admin' | 'property_manager' | 'finance' | 'viewer' | 'tester';

const ROLE_OPTIONS: { value: AppRole; label: string; description: string; permissions: string }[] = [
  { value: 'admin', label: 'Admin', description: 'Voller Zugriff auf alle Funktionen', permissions: 'Voller Zugriff' },
  { value: 'property_manager', label: 'Hausverwalter', description: 'Wartungen, Nachrichten, Rechnungsfreigabe', permissions: 'Wartungen, Nachrichten, Rechnungsfreigabe' },
  { value: 'finance', label: 'Buchhaltung', description: 'Finanzen, Banking, Rechnungsfreigabe', permissions: 'Finanzen, Banking, Rechnungsfreigabe' },
  { value: 'viewer', label: 'Betrachter', description: 'Nur Lesezugriff', permissions: 'Nur Ansicht' },
];

const getRoleBadgeVariant = (role: AppRole | null): "default" | "secondary" | "outline" | "destructive" => {
  switch (role) {
    case 'admin':
      return 'default';
    case 'property_manager':
      return 'secondary';
    case 'finance':
      return 'outline';
    case 'viewer':
      return 'secondary';
    default:
      return 'outline';
  }
};

const getRoleLabel = (role: AppRole | null) => {
  const option = ROLE_OPTIONS.find(o => o.value === role);
  return option?.label || 'Keine Rolle';
};

export default function TeamManagement() {
  const permissions = usePermissions();
  const { user } = useAuth();
  const { data: teamMembers, isLoading } = useTeamMembers();
  const stats = useTeamStats();
  const updateRole = useUpdateTeamMemberRole();
  const removeRole = useRemoveTeamMemberRole();
  const { data: pendingInvites } = usePendingInvites();
  const deleteInvite = useDeleteInvite();

  const [searchQuery, setSearchQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState<string>('all');
  const [editingMember, setEditingMember] = useState<TeamMember | null>(null);
  const [selectedRole, setSelectedRole] = useState<AppRole | ''>('');
  const [removingMember, setRemovingMember] = useState<TeamMember | null>(null);
  const [showInviteDialog, setShowInviteDialog] = useState(false);
  const [propertyAssignmentMember, setPropertyAssignmentMember] = useState<TeamMember | null>(null);

  // Permission check
  if (!permissions.canManageUsers && !permissions.isAdmin) {
    return (
      <MainLayout title="Team-Verwaltung">
        <div className="flex flex-col items-center justify-center h-[50vh] gap-4">
          <AlertTriangle className="h-16 w-16 text-destructive" />
          <h1 className="text-2xl font-bold">Keine Berechtigung</h1>
          <p className="text-muted-foreground">
            Diese Seite ist nur für Administratoren zugänglich.
          </p>
        </div>
      </MainLayout>
    );
  }

  // Filter team members
  const filteredMembers = teamMembers?.filter(member => {
    const matchesSearch = 
      member.full_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      member.email?.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesRole = roleFilter === 'all' || member.role === roleFilter || (roleFilter === 'none' && !member.role);
    return matchesSearch && matchesRole;
  }) || [];

  // Check if this is the last admin
  const isLastAdmin = (memberId: string) => {
    const member = teamMembers?.find(m => m.id === memberId);
    return member?.role === 'admin' && stats.admins <= 1;
  };

  const handleEditRole = (member: TeamMember) => {
    setEditingMember(member);
    setSelectedRole(member.role || '' as any);
  };

  const handleSaveRole = async () => {
    if (!editingMember || !selectedRole) return;
    
    await updateRole.mutateAsync({ userId: editingMember.id, newRole: selectedRole as any });
    setEditingMember(null);
    setSelectedRole('');
  };

  const handleRemoveRole = async () => {
    if (!removingMember) return;
    
    await removeRole.mutateAsync(removingMember.id);
    setRemovingMember(null);
  };

  return (
    <MainLayout title="Team-Verwaltung" subtitle="Verwalten Sie die Rollen und Berechtigungen Ihres Teams">
      <div className="space-y-6">
        {/* Header with Invite Button */}
        <div className="flex justify-end">
          <Button onClick={() => setShowInviteDialog(true)}>
            <UserPlus className="h-4 w-4 mr-2" />
            Benutzer einladen
          </Button>
        </div>
        {/* Stats Cards */}
        <div className="grid gap-4 md:grid-cols-5">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Gesamt</CardTitle>
              <Users className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.total}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Admins</CardTitle>
              <Shield className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.admins}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Hausverwalter</CardTitle>
              <Briefcase className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.propertyManagers}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Buchhaltung</CardTitle>
              <Briefcase className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.finance}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Betrachter</CardTitle>
              <Eye className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.viewers}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Ausstehend</CardTitle>
              <Clock className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{pendingInvites?.length || 0}</div>
            </CardContent>
          </Card>
        </div>

        {/* Team Members Table */}
        <Card>
          <CardHeader>
            <CardTitle>Teammitglieder</CardTitle>
            <CardDescription>
              Alle Benutzer Ihrer Organisation
            </CardDescription>
          </CardHeader>
          <CardContent>
            {/* Filters */}
            <div className="flex flex-col sm:flex-row gap-4 mb-6">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Nach Name oder E-Mail suchen..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10"
                />
              </div>
              <Select value={roleFilter} onValueChange={setRoleFilter}>
                <SelectTrigger className="w-full sm:w-[180px]">
                  <SelectValue placeholder="Rolle filtern" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Alle Rollen</SelectItem>
                  <SelectItem value="admin">Admin</SelectItem>
                  <SelectItem value="property_manager">Hausverwalter</SelectItem>
                  <SelectItem value="finance">Buchhaltung</SelectItem>
                  <SelectItem value="viewer">Betrachter</SelectItem>
                  <SelectItem value="none">Keine Rolle</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Table */}
            {isLoading ? (
              <div className="flex items-center justify-center h-32">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
              </div>
            ) : filteredMembers.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                Keine Teammitglieder gefunden
              </div>
            ) : (
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>E-Mail</TableHead>
                      <TableHead>Rolle</TableHead>
                      <TableHead>Zugewiesene Objekte</TableHead>
                      <TableHead>Berechtigungen</TableHead>
                      <TableHead>Mitglied seit</TableHead>
                      <TableHead className="text-right">Aktionen</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredMembers.map((member) => (
                      <TableRow key={member.id}>
                        <TableCell className="font-medium">
                          {member.full_name || 'Unbekannt'}
                          {member.id === user?.id && (
                            <Badge variant="outline" className="ml-2">Sie</Badge>
                          )}
                        </TableCell>
                        <TableCell>{member.email || '-'}</TableCell>
                        <TableCell>
                          <Badge variant={getRoleBadgeVariant(member.role)}>
                            {getRoleLabel(member.role)}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          {member.role === 'property_manager' ? (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-auto py-1 px-2"
                              onClick={() => setPropertyAssignmentMember(member)}
                            >
                              <Building2 className="h-4 w-4 mr-1" />
                              {member.assignedPropertiesCount > 0 ? (
                                <Badge variant="secondary">{member.assignedPropertiesCount}</Badge>
                              ) : (
                                <span className="text-muted-foreground">Keine</span>
                              )}
                            </Button>
                          ) : (
                            <span className="text-muted-foreground text-sm">—</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <span className={
                            member.role === 'admin' ? 'text-green-600' :
                            member.role === 'property_manager' ? 'text-blue-600' :
                            member.role === 'finance' ? 'text-purple-600' :
                            'text-muted-foreground'
                          }>
                            {ROLE_OPTIONS.find(r => r.value === member.role)?.permissions || 'Keine Berechtigungen'}
                          </span>
                        </TableCell>
                        <TableCell>
                          {format(new Date(member.created_at), 'dd.MM.yyyy', { locale: de })}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleEditRole(member)}
                            >
                              Rolle ändern
                            </Button>
                            {member.role && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setRemovingMember(member)}
                                disabled={isLastAdmin(member.id)}
                                title={isLastAdmin(member.id) ? 'Letzter Admin kann nicht entfernt werden' : undefined}
                              >
                                <UserX className="h-4 w-4" />
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Pending Invitations */}
        {pendingInvites && pendingInvites.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Clock className="h-5 w-5" />
                Ausstehende Einladungen
              </CardTitle>
              <CardDescription>
                Einladungen, die noch nicht angenommen wurden
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>E-Mail</TableHead>
                      <TableHead>Rolle</TableHead>
                      <TableHead>Gültig bis</TableHead>
                      <TableHead className="text-right">Aktionen</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pendingInvites.map((invite) => (
                      <TableRow key={invite.id}>
                        <TableCell className="font-medium">{invite.email}</TableCell>
                        <TableCell>
                          <Badge variant="secondary">{ROLE_LABELS[invite.role]}</Badge>
                        </TableCell>
                        <TableCell>
                          {format(new Date(invite.expiresAt), 'dd.MM.yyyy', { locale: de })}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => deleteInvite.mutate(invite.id)}
                            disabled={deleteInvite.isPending}
                          >
                            <X className="h-4 w-4 mr-1" />
                            Widerrufen
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Edit Role Dialog */}
        <Dialog open={!!editingMember} onOpenChange={() => setEditingMember(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Rolle ändern</DialogTitle>
              <DialogDescription>
                Wählen Sie eine neue Rolle für {editingMember?.full_name || editingMember?.email}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <Select value={selectedRole} onValueChange={(v) => setSelectedRole(v as AppRole)}>
                <SelectTrigger>
                  <SelectValue placeholder="Rolle auswählen" />
                </SelectTrigger>
                <SelectContent>
                  {ROLE_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      <div className="flex flex-col">
                        <span>{option.label}</span>
                        <span className="text-xs text-muted-foreground">{option.description}</span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setEditingMember(null)}>
                Abbrechen
              </Button>
              <Button 
                onClick={handleSaveRole} 
                disabled={!selectedRole || updateRole.isPending}
              >
                {updateRole.isPending ? 'Speichern...' : 'Speichern'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Remove Role Confirmation */}
        <AlertDialog open={!!removingMember} onOpenChange={() => setRemovingMember(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Rolle entfernen?</AlertDialogTitle>
              <AlertDialogDescription>
                Möchten Sie die Rolle von {removingMember?.full_name || removingMember?.email} wirklich entfernen?
                Der Benutzer hat dann keinen Zugriff mehr auf rollenspezifische Funktionen.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Abbrechen</AlertDialogCancel>
              <AlertDialogAction 
                onClick={handleRemoveRole}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                Rolle entfernen
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Invite User Dialog */}
        <InviteUserDialog 
          open={showInviteDialog} 
          onOpenChange={setShowInviteDialog} 
        />

        {/* Property Assignment Dialog */}
        {propertyAssignmentMember && (
          <PropertyAssignmentDialog
            open={!!propertyAssignmentMember}
            onOpenChange={(open) => !open && setPropertyAssignmentMember(null)}
            userId={propertyAssignmentMember.id}
            userName={propertyAssignmentMember.full_name || propertyAssignmentMember.email || 'Benutzer'}
          />
        )}

        {/* Role Explanation */}
        <Card className="bg-blue-50 border-blue-200 dark:bg-blue-950/20 dark:border-blue-800">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center gap-2">
              <Shield className="h-5 w-5" />
              Rollen-Erklärung
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2 text-sm">
              <li><strong>Admin:</strong> Voller Zugriff auf alles (Buchhaltung, Finanzen, Team-Verwaltung, Einstellungen)</li>
              <li><strong>Hausverwalter:</strong> Wartungen, Aufträge, Nachrichten, Rechnungsfreigabe – KEINE Buchhaltung</li>
              <li><strong>Buchhaltung:</strong> Finanzen, Banking, Rechnungsfreigabe – KEINE Wartungen</li>
              <li><strong>Betrachter:</strong> Kann nur Daten ansehen, nichts bearbeiten oder genehmigen</li>
            </ul>
          </CardContent>
        </Card>
      </div>
    </MainLayout>
  );
}
