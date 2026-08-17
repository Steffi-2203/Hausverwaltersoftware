import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Star, Phone, Mail, MapPin, MoreVertical, Pencil, Trash2, Building2 } from 'lucide-react';
import { Contractor, getSpecializationLabel } from '@/hooks/useContractors';

interface ContractorCardProps {
  contractor: Contractor;
  onEdit: (contractor: Contractor) => void;
  onDelete: (contractor: Contractor) => void;
}

export function ContractorCard({ contractor, onEdit, onDelete }: ContractorCardProps) {
  return (
    <Card className={!contractor.is_active ? 'opacity-60' : ''}>
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
              <Building2 className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h3 className="font-semibold">{contractor.company_name}</h3>
              {contractor.contact_person && (
                <p className="text-sm text-muted-foreground">{contractor.contact_person}</p>
              )}
            </div>
          </div>
          
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8">
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => onEdit(contractor)}>
                <Pencil className="h-4 w-4 mr-2" />
                Bearbeiten
              </DropdownMenuItem>
              <DropdownMenuItem 
                onClick={() => onDelete(contractor)}
                className="text-destructive"
              >
                <Trash2 className="h-4 w-4 mr-2" />
                Löschen
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </CardHeader>
      
      <CardContent className="space-y-3">
        {/* Rating */}
        {contractor.rating && (
          <div className="flex items-center gap-1">
            {[1, 2, 3, 4, 5].map((star) => (
              <Star
                key={star}
                className={`h-4 w-4 ${
                  star <= contractor.rating!
                    ? 'fill-yellow-400 text-yellow-400'
                    : 'text-muted-foreground/30'
                }`}
              />
            ))}
          </div>
        )}
        
        {/* Spezialisierungen */}
        {contractor.specializations && contractor.specializations.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {contractor.specializations.map((spec) => (
              <Badge key={spec} variant="secondary" className="text-xs">
                {getSpecializationLabel(spec)}
              </Badge>
            ))}
          </div>
        )}
        
        {/* Kontaktdaten */}
        <div className="space-y-1.5 text-sm">
          {contractor.email && (
            <a 
              href={`mailto:${contractor.email}`}
              className="flex items-center gap-2 text-muted-foreground hover:text-foreground"
            >
              <Mail className="h-4 w-4" />
              {contractor.email}
            </a>
          )}
          
          {(contractor.phone || contractor.mobile) && (
            <a 
              href={`tel:${contractor.mobile || contractor.phone}`}
              className="flex items-center gap-2 text-muted-foreground hover:text-foreground"
            >
              <Phone className="h-4 w-4" />
              {contractor.mobile || contractor.phone}
            </a>
          )}
          
          {(contractor.address || contractor.city) && (
            <div className="flex items-center gap-2 text-muted-foreground">
              <MapPin className="h-4 w-4" />
              {[contractor.address, `${contractor.postal_code} ${contractor.city}`.trim()]
                .filter(Boolean)
                .join(', ')}
            </div>
          )}
        </div>
        
        {/* Status Badge */}
        {!contractor.is_active && (
          <Badge variant="outline" className="text-muted-foreground">
            Inaktiv
          </Badge>
        )}
      </CardContent>
    </Card>
  );
}
