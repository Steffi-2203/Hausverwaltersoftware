import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Building2, MapPin, Loader2 } from 'lucide-react';
import { useProperties } from '@/hooks/useProperties';
import { useUserPropertyAssignments, useUpdatePropertyAssignments } from '@/hooks/usePropertyAssignments';

interface PropertyAssignmentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userId: string;
  userName: string;
}

export function PropertyAssignmentDialog({
  open,
  onOpenChange,
  userId,
  userName,
}: PropertyAssignmentDialogProps) {
  const { data: allProperties, isLoading: propertiesLoading } = useProperties();
  const { data: userAssignments, isLoading: assignmentsLoading } = useUserPropertyAssignments(userId);
  const updateAssignments = useUpdatePropertyAssignments();

  const [selectedProperties, setSelectedProperties] = useState<Set<string>>(new Set());

  // Initialize selected properties when data loads
  useEffect(() => {
    if (userAssignments) {
      setSelectedProperties(new Set(userAssignments.map(a => a.property_id)));
    }
  }, [userAssignments]);

  const isLoading = propertiesLoading || assignmentsLoading;

  const handleToggleProperty = (propertyId: string) => {
    setSelectedProperties(prev => {
      const next = new Set(prev);
      if (next.has(propertyId)) {
        next.delete(propertyId);
      } else {
        next.add(propertyId);
      }
      return next;
    });
  };

  const handleSelectAll = () => {
    if (allProperties) {
      setSelectedProperties(new Set(allProperties.map(p => p.id)));
    }
  };

  const handleDeselectAll = () => {
    setSelectedProperties(new Set());
  };

  const handleSave = async () => {
    await updateAssignments.mutateAsync({
      userId,
      propertyIds: Array.from(selectedProperties),
    });
    onOpenChange(false);
  };

  const hasChanges = () => {
    const originalIds = new Set(userAssignments?.map(a => a.property_id) || []);
    if (originalIds.size !== selectedProperties.size) return true;
    for (const id of selectedProperties) {
      if (!originalIds.has(id)) return true;
    }
    return false;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Building2 className="h-5 w-5" />
            Liegenschaften zuweisen
          </DialogTitle>
          <DialogDescription>
            Wählen Sie die Liegenschaften, die {userName} verwalten soll.
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="flex items-center justify-center h-48">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : allProperties && allProperties.length > 0 ? (
          <div className="space-y-4">
            {/* Quick actions */}
            <div className="flex items-center justify-between">
              <div className="text-sm text-muted-foreground">
                {selectedProperties.size} von {allProperties.length} ausgewählt
              </div>
              <div className="flex gap-2">
                <Button variant="ghost" size="sm" onClick={handleSelectAll}>
                  Alle
                </Button>
                <Button variant="ghost" size="sm" onClick={handleDeselectAll}>
                  Keine
                </Button>
              </div>
            </div>

            {/* Property list */}
            <ScrollArea className="h-[300px] border rounded-md">
              <div className="p-4 space-y-3">
                {allProperties.map((property) => (
                  <label
                    key={property.id}
                    className="flex items-start gap-3 p-3 rounded-lg hover:bg-muted/50 cursor-pointer transition-colors"
                  >
                    <Checkbox
                      checked={selectedProperties.has(property.id)}
                      onCheckedChange={() => handleToggleProperty(property.id)}
                      className="mt-0.5"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate">{property.name}</div>
                      <div className="flex items-center gap-1 text-sm text-muted-foreground">
                        <MapPin className="h-3 w-3 flex-shrink-0" />
                        <span className="truncate">{property.address}, {property.postal_code} {property.city}</span>
                      </div>
                    </div>
                    {userAssignments?.some(a => a.property_id === property.id) && 
                     selectedProperties.has(property.id) && (
                      <Badge variant="secondary" className="text-xs flex-shrink-0">
                        Aktuell
                      </Badge>
                    )}
                  </label>
                ))}
              </div>
            </ScrollArea>
          </div>
        ) : (
          <div className="text-center py-8 text-muted-foreground">
            <Building2 className="h-12 w-12 mx-auto mb-3 opacity-50" />
            <p>Keine Liegenschaften vorhanden</p>
            <p className="text-sm">Erstellen Sie zuerst eine Liegenschaft.</p>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Abbrechen
          </Button>
          <Button 
            onClick={handleSave} 
            disabled={!hasChanges() || updateAssignments.isPending}
          >
            {updateAssignments.isPending ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Speichern...
              </>
            ) : (
              'Speichern'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
