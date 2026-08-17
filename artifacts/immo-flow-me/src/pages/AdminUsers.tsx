import { useState, useMemo } from 'react';
import { MainLayout } from '@/components/layout/MainLayout';
import { useAdminUsers, useAdminUserStats, useUpdateUserRole, useRemoveUserRole, AdminUser, AppRole } from '@/hooks/useAdminUsers';
import { useAuth } from '@/hooks/useAuth';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { 
  Users, 
  Shield,
  Wallet,
  Building2,
  Eye,
  Search,
  UserCog,
  AlertTriangle,
  UserX
} from 'lucide-react';
import { format } from 'date-fns';
import { de } from 'date-fns/locale';
import { toast } from 'sonner';

const ROLE_LABELS: Record<AppRole, string> = {
  admin: 'Admin',
  finance: 'Finance',
  property_manager: 'Property Manager',
  viewer: 'Viewer',
  tester: 'Tester',
};

const ROLE_DESCRIPTIONS: Record<AppRole, string> = {
  admin: 'Vollzugriff auf alle Funktionen und Benutzerverwaltung',
  finance: 'Zugriff auf Finanzdaten (IBAN, BIC, Bankkonten)',
  property_manager: 'Standardverwaltung ohne sensible Bankdaten',
  viewer: 'Nur Lesezugriff mit maskierten sensiblen Daten',
  tester: 'Demo-Zugang mit virtuellen Testdaten',
};

export default function AdminUsers() {
  const { user: currentUser } = useAuth();
  const { data: users, isLoading } = useAdminUsers();
  const stats = useAdminUserStats();
  const updateRole = useUpdateUserRole();
  const removeRole = useRemoveUserRole();

  const [searchTerm, setSearchTerm] = useState('');
  const [roleFilter, setRoleFilter] = useState<string>('all');
  const [selectedUser, setSelectedUser] = useState<AdminUser | null>(null);
  const [showRoleDialog, setShowRoleDialog] = useState(false);
  const [showRemoveDialog, setShowRemoveDialog] = useState(false);
  const [selectedRole, setSelectedRole] = useState<AppRole | ''>('');

  const filteredUsers = useMemo(() => {
    if (!users) return [];
    
    return users.filter(user => {
      const matchesSearch = 
        (user.full_name?.toLowerCase().includes(searchTerm.toLowerCase()) || false) ||
        (user.email?.toLowerCase().includes(searchTerm.toLowerCase()) || false) ||
        (user.organization_name?.toLowerCase().includes(searchTerm.toLowerCase()) || false);
      
      const matchesRole = roleFilter === 'all' || 
        (roleFilter === 'none' && !user.role) ||
        user.role === roleFilter;

      return matchesSearch && matchesRole;
    });
  }, [users, searchTerm, roleFilter]);

  const handleOpenRoleDialog = (user: AdminUser) => {
    setSelectedUser(user);
    setSelectedRole(user.role || '');
    setShowRoleDialog(true);
  };

  const handleSaveRole = async () => {
    if (!selectedUser || !selectedRole) return;

    // Check if user is trying to remove their own admin role
    if (selectedUser.user_id === currentUser?.id && selectedRole !== 'admin' && selectedUser.role === 'admin') {
      // Check if this is the last admin
      if (stats.adminCount <= 1) {
        toast.error('Sie können Ihre eigene Admin-Rolle nicht entfernen, da Sie der letzte Admin sind.');
        return;
      }
    }

    await updateRole.mutateAsync({ userId: selectedUser.user_id, role: selectedRole });
    setShowRoleDialog(false);
  };

  const handleOpenRemoveDialog = (user: AdminUser) => {
    setSelectedUser(user);
    setShowRemoveDialog(true);
  };

  const handleRemoveRole = async () => {
    if (!selectedUser) return;

    // Check if user is trying to remove their own admin role
    if (selectedUser.user_id === currentUser?.id && selectedUser.role === 'admin') {
      if (stats.adminCount <= 1) {
        toast.error('Sie können Ihre eigene Admin-Rolle nicht entfernen, da Sie der letzte Admin sind.');
        setShowRemoveDialog(false);
        return;
      }
    }

    await removeRole.mutateAsync(selectedUser.user_id);
    setShowRemoveDialog(false);
  };

  const getRoleBadge = (role: AppRole | null) => {
    if (!role) {
      return <Badge variant="outline" className="text-muted-foreground">Keine Rolle</Badge>;
    }

    switch (role) {
      case 'admin':
        return <Badge className="bg-red-500 hover:bg-red-600"><Shield className="h-3 w-3 mr-1" />{ROLE_LABELS[role]}</Badge>;
      case 'finance':
        return <Badge className="bg-green-500 hover:bg-green-600"><Wallet className="h-3 w-3 mr-1" />{ROLE_LABELS[role]}</Badge>;
      case 'property_manager':
        return <Badge className="bg-blue-500 hover:bg-blue-600"><Building2 className="h-3 w-3 mr-1" />{ROLE_LABELS[role]}</Badge>;
      case 'viewer':
        return <Badge variant="secondary"><Eye className="h-3 w-3 mr-1" />{ROLE_LABELS[role]}</Badge>;
      default:
        return <Badge variant="outline">{role}</Badge>;
    }
  };

  if (isLoading) {
    return (
      <MainLayout title="Benutzerverwaltung" subtitle="Rollen und Berechtigungen verwalten">
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
            {[1, 2, 3, 4, 5].map(i => (
              <Skeleton key={i} className="h-24" />
            ))}
          </div>
          <Skeleton className="h-96" />
        </div>
      </MainLayout>
    );
  }

  return (
    <MainLayout title="Benutzerverwaltung" subtitle="Rollen und Berechtigungen verwalten">
      <div className="space-y-6">
        {/* Stats Cards */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Gesamt</CardDescription>
              <CardTitle className="text-2xl flex items-center gap-2">
                <Users className="h-5 w-5 text-muted-foreground" />
                {stats.totalUsers}
              </CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Admins</CardDescription>
              <CardTitle className="text-2xl flex items-center gap-2">
                <Shield className="h-5 w-5 text-red-500" />
                {stats.adminCount}
              </CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Finance</CardDescription>
              <CardTitle className="text-2xl flex items-center gap-2">
                <Wallet className="h-5 w-5 text-green-500" />
                {stats.financeCount}
              </CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Manager</CardDescription>
              <CardTitle className="text-2xl flex items-center gap-2">
                <Building2 className="h-5 w-5 text-blue-500" />
                {stats.managerCount}
              </CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Viewer</CardDescription>
              <CardTitle className="text-2xl flex items-center gap-2">
                <Eye className="h-5 w-5 text-muted-foreground" />
                {stats.viewerCount}
              </CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Keine Rolle</CardDescription>
              <CardTitle className="text-2xl flex items-center gap-2">
                <UserX className="h-5 w-5 text-yellow-500" />
                {stats.noRoleCount}
              </CardTitle>
            </CardHeader>
          </Card>
        </div>

        {/* Users Table */}
        <Card>
          <CardHeader>
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <UserCog className="h-5 w-5" />
                  Benutzer
                </CardTitle>
                <CardDescription>Alle registrierten Benutzer und deren Rollen</CardDescription>
              </div>
              <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
                <div className="relative w-full sm:w-64">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Suchen..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="pl-10"
                  />
                </div>
                <Select value={roleFilter} onValueChange={setRoleFilter}>
                  <SelectTrigger className="w-full sm:w-40">
                    <SelectValue placeholder="Alle Rollen" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Alle Rollen</SelectItem>
                    <SelectItem value="admin">Admin</SelectItem>
                    <SelectItem value="finance">Finance</SelectItem>
                    <SelectItem value="property_manager">Manager</SelectItem>
                    <SelectItem value="viewer">Viewer</SelectItem>
                    <SelectItem value="none">Keine Rolle</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Benutzer</TableHead>
                    <TableHead>E-Mail</TableHead>
                    <TableHead>Organisation</TableHead>
                    <TableHead>Rolle</TableHead>
                    <TableHead>Registriert</TableHead>
                    <TableHead className="text-right">Aktionen</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredUsers.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                        Keine Benutzer gefunden
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredUsers.map((user) => (
                      <TableRow key={user.user_id}>
                        <TableCell className="font-medium">
                          {user.full_name || 'Kein Name'}
                          {user.user_id === currentUser?.id && (
                            <Badge variant="outline" className="ml-2 text-xs">Sie</Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-muted-foreground">{user.email || '-'}</TableCell>
                        <TableCell>{user.organization_name || '-'}</TableCell>
                        <TableCell>{getRoleBadge(user.role)}</TableCell>
                        <TableCell className="text-muted-foreground">
                          {format(new Date(user.created_at), 'dd.MM.yyyy', { locale: de })}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleOpenRoleDialog(user)}
                            >
                              <UserCog className="h-4 w-4 mr-1" />
                              Rolle ändern
                            </Button>
                            {user.role && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleOpenRemoveDialog(user)}
                                disabled={user.user_id === currentUser?.id && user.role === 'admin' && stats.adminCount <= 1}
                              >
                                <UserX className="h-4 w-4 text-destructive" />
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Role Edit Dialog */}
      <Dialog open={showRoleDialog} onOpenChange={setShowRoleDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rolle zuweisen</DialogTitle>
            <DialogDescription>
              Ändern Sie die Rolle für {selectedUser?.full_name || selectedUser?.email}
            </DialogDescription>
          </DialogHeader>
          <div className="py-4 space-y-4">
            <Select value={selectedRole} onValueChange={(value) => setSelectedRole(value as AppRole)}>
              <SelectTrigger>
                <SelectValue placeholder="Rolle auswählen" />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(ROLE_LABELS).map(([key, label]) => (
                  <SelectItem key={key} value={key}>
                    <div className="flex flex-col">
                      <span>{label}</span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {selectedRole && (
              <p className="text-sm text-muted-foreground">
                {ROLE_DESCRIPTIONS[selectedRole as AppRole]}
              </p>
            )}
            {selectedUser?.user_id === currentUser?.id && selectedRole !== 'admin' && selectedUser?.role === 'admin' && (
              <div className="flex items-center gap-2 p-3 bg-yellow-50 dark:bg-yellow-950 text-yellow-700 dark:text-yellow-300 rounded-md">
                <AlertTriangle className="h-4 w-4 flex-shrink-0" />
                <p className="text-sm">
                  Achtung: Sie ändern Ihre eigene Admin-Rolle. Dies kann nicht rückgängig gemacht werden, wenn Sie der letzte Admin sind.
                </p>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowRoleDialog(false)}>
              Abbrechen
            </Button>
            <Button onClick={handleSaveRole} disabled={!selectedRole || updateRole.isPending}>
              {updateRole.isPending ? 'Wird gespeichert...' : 'Speichern'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Remove Role Confirmation Dialog */}
      <AlertDialog open={showRemoveDialog} onOpenChange={setShowRemoveDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Rolle entfernen?</AlertDialogTitle>
            <AlertDialogDescription>
              Möchten Sie die Rolle "{selectedUser?.role && ROLE_LABELS[selectedUser.role]}" von {selectedUser?.full_name || selectedUser?.email} wirklich entfernen?
              Der Benutzer wird keinen Zugriff mehr auf die entsprechenden Funktionen haben.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Abbrechen</AlertDialogCancel>
            <AlertDialogAction onClick={handleRemoveRole} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Rolle entfernen
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </MainLayout>
  );
}
