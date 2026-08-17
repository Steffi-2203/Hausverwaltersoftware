import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
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
  UserPlus, 
  Loader2, 
  Mail, 
  Clock, 
  X,
  Shield,
  Building2,
  Calculator,
  Eye
} from 'lucide-react';
import { useOrganization } from '@/hooks/useOrganization';
import { useAuth } from '@/hooks/useAuth';
import { 
  usePendingInvites, 
  useDeleteInvite,
  AppRole,
  ROLE_LABELS 
} from '@/hooks/useOrganizationInvites';
import { useAdminUsers, useUpdateUserRole, useRemoveUserRole } from '@/hooks/useAdminUsers';
import { InviteUserDialog } from './InviteUserDialog';
import { format } from 'date-fns';
import { de } from 'date-fns/locale';
import { toast } from 'sonner';

const ROLE_ICONS: Record<AppRole, typeof Shield> = {
  admin: Shield,
  property_manager: Building2,
  finance: Calculator,
  viewer: Eye,
  tester: Shield,
};

const ROLE_COLORS: Record<AppRole, string> = {
  admin: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
  property_manager: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
  finance: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
  viewer: 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200',
  tester: 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200',
};

export function UserRoleManager() {
  const { user: currentUser } = useAuth();
  const { data: organization } = useOrganization();
  const { data: allUsers, isLoading: isLoadingUsers } = useAdminUsers();
  const { data: pendingInvites, isLoading: isLoadingInvites } = usePendingInvites();
  const deleteInvite = useDeleteInvite();
  const updateUserRole = useUpdateUserRole();
  const removeUserRole = useRemoveUserRole();

  const [showInviteDialog, setShowInviteDialog] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState<{ userId: string; userName: string } | null>(null);
  const [updatingRole, setUpdatingRole] = useState<string | null>(null);

  // Filter users to only show those in the same organization
  const organizationUsers = allUsers?.filter(u => 
    u.organization_id === organization?.id
  ) || [];

  const handleRoleChange = async (userId: string, newRole: AppRole | 'none') => {
    if (userId === currentUser?.id) {
      toast.error('Sie können Ihre eigene Rolle nicht ändern');
      return;
    }

    setUpdatingRole(userId);
    try {
      if (newRole === 'none') {
        await removeUserRole.mutateAsync(userId);
      } else {
        await updateUserRole.mutateAsync({ userId, role: newRole as any });
      }
    } finally {
      setUpdatingRole(null);
    }
  };

  const handleDeleteInvite = async (inviteId: string) => {
    await deleteInvite.mutateAsync(inviteId);
  };

  const isLoading = isLoadingUsers || isLoadingInvites;

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Users className="h-5 w-5" />
              Benutzerverwaltung
            </CardTitle>
            <CardDescription>
              Verwalten Sie Benutzer und deren Rollen in Ihrer Organisation
            </CardDescription>
          </div>
          <Button onClick={() => setShowInviteDialog(true)}>
            <UserPlus className="h-4 w-4 mr-2" />
            Benutzer einladen
          </Button>
        </CardHeader>
        <CardContent className="space-y-6">
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <>
              {/* Current Users */}
              <div>
                <h3 className="text-sm font-medium mb-3">Aktive Benutzer</h3>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Benutzer</TableHead>
                      <TableHead>E-Mail</TableHead>
                      <TableHead>Rolle</TableHead>
                      <TableHead className="w-[200px]">Rolle ändern</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {organizationUsers.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={4} className="text-center text-muted-foreground py-8">
                          Keine Benutzer gefunden
                        </TableCell>
                      </TableRow>
                    ) : (
                      organizationUsers.map((orgUser) => {
                        const RoleIcon = orgUser.role ? ROLE_ICONS[orgUser.role as AppRole] : Eye;
                        const isCurrentUser = orgUser.user_id === currentUser?.id;

                        return (
                          <TableRow key={orgUser.user_id}>
                            <TableCell className="font-medium">
                              {orgUser.full_name || 'Unbekannt'}
                              {isCurrentUser && (
                                <Badge variant="outline" className="ml-2 text-xs">
                                  Sie
                                </Badge>
                              )}
                            </TableCell>
                            <TableCell>{orgUser.email}</TableCell>
                            <TableCell>
                              {orgUser.role ? (
                                <Badge className={ROLE_COLORS[orgUser.role as AppRole]}>
                                  <RoleIcon className="h-3 w-3 mr-1" />
                                  {ROLE_LABELS[orgUser.role as AppRole]}
                                </Badge>
                              ) : (
                                <Badge variant="outline">Keine Rolle</Badge>
                              )}
                            </TableCell>
                            <TableCell>
                              {isCurrentUser ? (
                                <span className="text-sm text-muted-foreground">
                                  Eigene Rolle
                                </span>
                              ) : (
                                <Select
                                  value={orgUser.role || 'none'}
                                  onValueChange={(value) => handleRoleChange(orgUser.user_id, value as AppRole | 'none')}
                                  disabled={updatingRole === orgUser.user_id}
                                >
                                  <SelectTrigger className="w-[180px]">
                                    {updatingRole === orgUser.user_id ? (
                                      <Loader2 className="h-4 w-4 animate-spin" />
                                    ) : (
                                      <SelectValue />
                                    )}
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="admin">
                                      <div className="flex items-center gap-2">
                                        <Shield className="h-4 w-4" />
                                        Administrator
                                      </div>
                                    </SelectItem>
                                    <SelectItem value="property_manager">
                                      <div className="flex items-center gap-2">
                                        <Building2 className="h-4 w-4" />
                                        Hausverwalter
                                      </div>
                                    </SelectItem>
                                    <SelectItem value="finance">
                                      <div className="flex items-center gap-2">
                                        <Calculator className="h-4 w-4" />
                                        Buchhalter
                                      </div>
                                    </SelectItem>
                                    <SelectItem value="viewer">
                                      <div className="flex items-center gap-2">
                                        <Eye className="h-4 w-4" />
                                        Betrachter
                                      </div>
                                    </SelectItem>
                                    <SelectItem value="none">
                                      <div className="flex items-center gap-2 text-muted-foreground">
                                        <X className="h-4 w-4" />
                                        Keine Rolle
                                      </div>
                                    </SelectItem>
                                  </SelectContent>
                                </Select>
                              )}
                            </TableCell>
                          </TableRow>
                        );
                      })
                    )}
                  </TableBody>
                </Table>
              </div>

              {/* Pending Invites */}
              {pendingInvites && pendingInvites.length > 0 && (
                <div>
                  <h3 className="text-sm font-medium mb-3 flex items-center gap-2">
                    <Clock className="h-4 w-4" />
                    Offene Einladungen
                  </h3>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>E-Mail</TableHead>
                        <TableHead>Rolle</TableHead>
                        <TableHead>Gültig bis</TableHead>
                        <TableHead className="w-[100px]">Aktion</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {pendingInvites.map((invite) => {
                        const RoleIcon = ROLE_ICONS[invite.role];
                        return (
                          <TableRow key={invite.id}>
                            <TableCell className="font-medium">
                              <div className="flex items-center gap-2">
                                <Mail className="h-4 w-4 text-muted-foreground" />
                                {invite.email}
                              </div>
                            </TableCell>
                            <TableCell>
                              <Badge className={ROLE_COLORS[invite.role]}>
                                <RoleIcon className="h-3 w-3 mr-1" />
                                {ROLE_LABELS[invite.role]}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              {format(new Date(invite.expiresAt), 'dd.MM.yyyy', { locale: de })}
                            </TableCell>
                            <TableCell>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleDeleteInvite(invite.id)}
                                disabled={deleteInvite.isPending}
                              >
                                {deleteInvite.isPending ? (
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                  <X className="h-4 w-4" />
                                )}
                              </Button>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      <InviteUserDialog 
        open={showInviteDialog} 
        onOpenChange={setShowInviteDialog} 
      />

      <AlertDialog open={!!confirmRemove} onOpenChange={() => setConfirmRemove(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Rolle entfernen</AlertDialogTitle>
            <AlertDialogDescription>
              Möchten Sie wirklich die Rolle von {confirmRemove?.userName} entfernen?
              Der Benutzer hat dann keinen Zugriff mehr auf die Anwendung.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Abbrechen</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (confirmRemove) {
                  handleRoleChange(confirmRemove.userId, 'none');
                  setConfirmRemove(null);
                }
              }}
            >
              Rolle entfernen
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
