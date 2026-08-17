import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Phone, Mail, MapPin, MoreVertical, Pencil, Trash2, User, Building, Star } from 'lucide-react';
import { Owner } from '@/hooks/useOwners';

interface OwnerCardProps {
  owner: Owner;
  onEdit: (owner: Owner) => void;
  onDelete: (owner: Owner) => void;
}

export function OwnerCard({ owner, onEdit, onDelete }: OwnerCardProps) {
  return (
    <Card data-testid={`card-owner-${owner.id}`}>
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
              <User className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h3 className="font-semibold flex items-center gap-2">
                {owner.name}
                {owner.is_primary && (
                  <Badge variant="secondary" className="gap-1">
                    <Star className="h-3 w-3" />
                    Haupt
                  </Badge>
                )}
              </h3>
              {owner.properties && (
                <p className="text-sm text-muted-foreground flex items-center gap-1">
                  <Building className="h-3 w-3" />
                  {owner.properties.name}
                </p>
              )}
            </div>
          </div>
          
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button 
                variant="ghost" 
                size="icon" 
                className="h-8 w-8"
                data-testid={`button-owner-menu-${owner.id}`}
              >
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem 
                onClick={() => onEdit(owner)}
                data-testid={`button-edit-owner-${owner.id}`}
              >
                <Pencil className="h-4 w-4 mr-2" />
                Bearbeiten
              </DropdownMenuItem>
              <DropdownMenuItem 
                onClick={() => onDelete(owner)}
                className="text-destructive"
                data-testid={`button-delete-owner-${owner.id}`}
              >
                <Trash2 className="h-4 w-4 mr-2" />
                Löschen
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </CardHeader>
      
      <CardContent className="space-y-3">
        <div className="flex items-center gap-2">
          <Badge variant="outline">{owner.ownership_share}% Anteil</Badge>
        </div>
        
        <div className="space-y-1.5 text-sm">
          {owner.email && (
            <a 
              href={`mailto:${owner.email}`}
              className="flex items-center gap-2 text-muted-foreground hover:text-foreground"
              data-testid={`link-owner-email-${owner.id}`}
            >
              <Mail className="h-4 w-4" />
              {owner.email}
            </a>
          )}
          
          {owner.phone && (
            <a 
              href={`tel:${owner.phone}`}
              className="flex items-center gap-2 text-muted-foreground hover:text-foreground"
              data-testid={`link-owner-phone-${owner.id}`}
            >
              <Phone className="h-4 w-4" />
              {owner.phone}
            </a>
          )}
          
          {(owner.address || owner.city) && (
            <div className="flex items-center gap-2 text-muted-foreground">
              <MapPin className="h-4 w-4" />
              {[owner.address, `${owner.postal_code || ''} ${owner.city || ''}`.trim()]
                .filter(Boolean)
                .join(', ')}
            </div>
          )}
        </div>
        
        {owner.iban && (
          <div className="text-xs text-muted-foreground">
            IBAN: {owner.iban}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
