import { Link } from 'react-router-dom';
import { Building2, MapPin, Home, Users, ArrowRight, Star } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';

export interface PropertyCardProps {
  property: {
    id: string;
    name: string;
    address: string;
    postal_code: string;
    city: string;
    total_qm: number;
    total_mea: number;
    building_year: number | null;
  };
  units?: { total: number; occupied: number; vacant: number };
  maxUnitsPerProperty?: number;
}

export function PropertyCard({ property, units = { total: 0, occupied: 0, vacant: 0 }, maxUnitsPerProperty }: PropertyCardProps) {
  const occupancyRate = units.total > 0 ? (units.occupied / units.total) * 100 : 0;
  const isAtUnitLimit = maxUnitsPerProperty ? units.total >= maxUnitsPerProperty : false;

  return (
    <Link
      to={`/liegenschaften/${property.id}`}
      className="group block rounded-xl border border-border bg-card p-5 shadow-card transition-all hover:shadow-card-hover hover:border-primary/30"
    >
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-primary/10 p-2.5">
            <Building2 className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h3 className="font-semibold text-foreground group-hover:text-primary transition-colors">
              {property.name}
            </h3>
            <div className="flex items-center gap-1 mt-1 text-sm text-muted-foreground">
              <MapPin className="h-3.5 w-3.5" />
              <span>{property.postal_code} {property.city}</span>
            </div>
          </div>
        </div>
        <ArrowRight className="h-5 w-5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
      </div>

      <div className="mt-5 grid grid-cols-3 gap-4">
        <div className="text-center">
          <p className="text-2xl font-bold text-foreground">{units.total}</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {maxUnitsPerProperty ? `von ${maxUnitsPerProperty}` : 'Einheiten'}
          </p>
        </div>
        <div className="text-center">
          <p className="text-2xl font-bold text-success">{units.occupied}</p>
          <p className="text-xs text-muted-foreground mt-0.5">Vermietet</p>
        </div>
        <div className="text-center">
          <p className="text-2xl font-bold text-warning">{units.vacant}</p>
          <p className="text-xs text-muted-foreground mt-0.5">Leerstand</p>
        </div>
      </div>

      <div className="mt-4">
        <div className="flex items-center justify-between text-xs mb-1.5">
          <span className="text-muted-foreground">Auslastung</span>
          <span className="font-medium text-foreground">{occupancyRate.toFixed(0)}%</span>
        </div>
        <div className="h-2 rounded-full bg-secondary overflow-hidden">
          <div
            className={cn(
              'h-full rounded-full transition-all',
              occupancyRate >= 90 ? 'bg-success' : occupancyRate >= 70 ? 'bg-primary' : 'bg-warning'
            )}
            style={{ width: `${occupancyRate}%` }}
          />
        </div>
      </div>

      <div className="mt-4 flex items-center gap-2 flex-wrap">
        <Badge variant="secondary" className="text-xs">
          {Number(property.total_qm).toLocaleString('de-AT')} m²
        </Badge>
        {property.building_year && (
          <Badge variant="secondary" className="text-xs">
            BJ {property.building_year}
          </Badge>
        )}
        {isAtUnitLimit && (
          <Badge variant="outline" className="text-xs text-amber-600 border-amber-300">
            <Star className="h-3 w-3 mr-1" />
            Limit erreicht
          </Badge>
        )}
      </div>
    </Link>
  );
}