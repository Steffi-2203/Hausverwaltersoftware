import Fuse from 'fuse.js';
import { useProperties } from '@/hooks/useProperties';

interface PropertyMatch {
  propertyId: string;
  propertyName: string;
  propertyAddress: string;
  confidence: number; // 0-1
  matchedFields: ('address' | 'plz' | 'city')[];
}

interface LeistungsortData {
  strasse: string | null;
  plz: string | null;
  stadt: string | null;
}

export function usePropertyMatcher() {
  const { data: properties } = useProperties();
  
  const matchPropertyByLeistungsort = (leistungsort: LeistungsortData): PropertyMatch | null => {
    if (!properties || properties.length === 0) return null;
    if (!leistungsort.strasse && !leistungsort.plz && !leistungsort.stadt) return null;
    
    let bestMatch: PropertyMatch | null = null;
    
    for (const property of properties) {
      let confidence = 0;
      const matchedFields: ('address' | 'plz' | 'city')[] = [];
      
      // 1. PLZ-Match (höchste Priorität - sehr zuverlässig)
      if (leistungsort.plz && property.postal_code) {
        const plzClean = leistungsort.plz.replace(/\s/g, '');
        if (plzClean === property.postal_code.replace(/\s/g, '')) {
          confidence += 0.4;
          matchedFields.push('plz');
        }
      }
      
      // 2. Straßen-Match (Fuzzy-Matching für Tippfehler/Abkürzungen)
      if (leistungsort.strasse && property.address) {
        const fuse = new Fuse([{ text: property.address.toLowerCase() }], {
          keys: ['text'],
          threshold: 0.3,
          includeScore: true,
        });
        const result = fuse.search(leistungsort.strasse.toLowerCase());
        if (result.length > 0 && result[0].score !== undefined) {
          const streetConfidence = 0.4 * (1 - result[0].score);
          if (streetConfidence > 0.2) {
            confidence += streetConfidence;
            matchedFields.push('address');
          }
        }
      }
      
      // 3. Stadt-Match (zusätzliche Bestätigung)
      if (leistungsort.stadt && property.city) {
        if (leistungsort.stadt.toLowerCase().includes(property.city.toLowerCase()) ||
            property.city.toLowerCase().includes(leistungsort.stadt.toLowerCase())) {
          confidence += 0.2;
          matchedFields.push('city');
        }
      }
      
      // Nur akzeptieren wenn mindestens PLZ oder Straße matcht
      if (matchedFields.length > 0 && confidence > (bestMatch?.confidence || 0)) {
        bestMatch = {
          propertyId: property.id,
          propertyName: property.name,
          propertyAddress: `${property.address || ''}, ${property.postal_code || ''} ${property.city || ''}`.trim(),
          confidence: Math.min(confidence, 1),
          matchedFields,
        };
      }
    }
    
    return bestMatch;
  };
  
  return { matchPropertyByLeistungsort, properties };
}

export type { PropertyMatch, LeistungsortData };
