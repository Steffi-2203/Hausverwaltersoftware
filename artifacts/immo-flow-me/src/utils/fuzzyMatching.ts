import Fuse from 'fuse.js';

export interface MatchCandidate {
  id: string;
  type: 'unit' | 'tenant' | 'learned';
  searchText: string;
  unitId: string;
  tenantId: string | null;
  displayName: string;
}

export interface FuzzyMatchResult {
  unitId: string | null;
  tenantId: string | null;
  confidence: number;
  matchReason: string;
  matchType: 'exact' | 'fuzzy' | 'learned' | 'none';
}

export interface LearnedPattern {
  id: string;
  pattern: string;
  unit_id: string | null;
  tenant_id: string | null;
  match_count: number | null;
}

export interface UnitData {
  id: string;
  top_nummer: string;
  property_id: string;
}

export interface TenantData {
  id: string;
  first_name: string;
  last_name: string;
  unit_id: string;
  iban?: string | null;
}

// Generate search variations for unit numbers
function generateUnitVariations(topNummer: string): string[] {
  const base = topNummer.toLowerCase().trim();
  const numberMatch = base.match(/\d+/);
  const number = numberMatch ? numberMatch[0] : '';
  const paddedNumber = number.padStart(2, '0');
  
  return [
    base,
    base.replace(/\s/g, ''),
    `top ${number}`,
    `top${number}`,
    `top ${paddedNumber}`,
    `top${paddedNumber}`,
    `wohnung ${number}`,
    `wohnung${number}`,
    `einheit ${number}`,
    `whg ${number}`,
    `whg${number}`,
    `w${number}`,
    `t${number}`,
  ].filter(v => v.length > 0);
}

// Create search candidates from units and tenants
export function createSearchCandidates(
  units: UnitData[],
  tenants: TenantData[],
  learnedPatterns: LearnedPattern[] = []
): MatchCandidate[] {
  const candidates: MatchCandidate[] = [];
  
  // Add learned patterns (highest priority)
  for (const pattern of learnedPatterns) {
    if (pattern.unit_id) {
      candidates.push({
        id: `learned-${pattern.id}`,
        type: 'learned',
        searchText: pattern.pattern,
        unitId: pattern.unit_id,
        tenantId: pattern.tenant_id,
        displayName: `Gelerntes Pattern: ${pattern.pattern}`,
      });
    }
  }
  
  // Add unit variations
  for (const unit of units) {
    const tenant = tenants.find(t => t.unit_id === unit.id);
    const variations = generateUnitVariations(unit.top_nummer);
    
    for (const variation of variations) {
      candidates.push({
        id: `unit-${unit.id}-${variation}`,
        type: 'unit',
        searchText: variation,
        unitId: unit.id,
        tenantId: tenant?.id || null,
        displayName: unit.top_nummer,
      });
    }
  }
  
  // Add tenant name variations
  for (const tenant of tenants) {
    const fullName = `${tenant.first_name} ${tenant.last_name}`.toLowerCase();
    const lastName = tenant.last_name.toLowerCase();
    const firstName = tenant.first_name.toLowerCase();
    
    candidates.push({
      id: `tenant-full-${tenant.id}`,
      type: 'tenant',
      searchText: fullName,
      unitId: tenant.unit_id,
      tenantId: tenant.id,
      displayName: `${tenant.first_name} ${tenant.last_name}`,
    });
    
    if (lastName.length > 3) {
      candidates.push({
        id: `tenant-last-${tenant.id}`,
        type: 'tenant',
        searchText: lastName,
        unitId: tenant.unit_id,
        tenantId: tenant.id,
        displayName: tenant.last_name,
      });
    }
    
    // Add IBAN matching if available
    if (tenant.iban) {
      const ibanClean = tenant.iban.replace(/\s/g, '').toLowerCase();
      candidates.push({
        id: `tenant-iban-${tenant.id}`,
        type: 'tenant',
        searchText: ibanClean,
        unitId: tenant.unit_id,
        tenantId: tenant.id,
        displayName: `IBAN: ${tenant.iban}`,
      });
    }
  }
  
  return candidates;
}

// Perform fuzzy matching
export function fuzzyMatch(
  searchText: string,
  candidates: MatchCandidate[],
  threshold: number = 0.3
): FuzzyMatchResult {
  const normalizedSearch = searchText.toLowerCase().trim();
  
  if (!normalizedSearch || candidates.length === 0) {
    return {
      unitId: null,
      tenantId: null,
      confidence: 0,
      matchReason: '',
      matchType: 'none',
    };
  }
  
  // First check for exact matches in learned patterns
  const learnedExact = candidates.find(
    c => c.type === 'learned' && normalizedSearch.includes(c.searchText)
  );
  
  if (learnedExact) {
    return {
      unitId: learnedExact.unitId,
      tenantId: learnedExact.tenantId,
      confidence: 0.95,
      matchReason: `Gelerntes Muster "${learnedExact.searchText}" erkannt`,
      matchType: 'learned',
    };
  }
  
  // Check for exact substring matches
  for (const candidate of candidates) {
    if (normalizedSearch.includes(candidate.searchText) && candidate.searchText.length > 2) {
      const confidence = candidate.type === 'tenant' ? 0.9 : 0.85;
      return {
        unitId: candidate.unitId,
        tenantId: candidate.tenantId,
        confidence,
        matchReason: `"${candidate.displayName}" im Text gefunden`,
        matchType: 'exact',
      };
    }
  }
  
  // Use Fuse.js for fuzzy matching
  const fuse = new Fuse(candidates, {
    keys: ['searchText'],
    threshold,
    includeScore: true,
    minMatchCharLength: 3,
  });
  
  const results = fuse.search(normalizedSearch);
  
  if (results.length > 0 && results[0].score !== undefined) {
    const bestMatch = results[0];
    const confidence = Math.max(0.3, 1 - bestMatch.score);
    
    // Only accept fuzzy matches with reasonable confidence
    if (confidence >= 0.5) {
      return {
        unitId: bestMatch.item.unitId,
        tenantId: bestMatch.item.tenantId,
        confidence,
        matchReason: `Ähnlichkeit mit "${bestMatch.item.displayName}" (${Math.round(confidence * 100)}%)`,
        matchType: 'fuzzy',
      };
    }
  }
  
  return {
    unitId: null,
    tenantId: null,
    confidence: 0,
    matchReason: '',
    matchType: 'none',
  };
}

// Extract patterns from transaction for learning
export function extractLearnablePatterns(
  counterpartName: string | undefined,
  counterpartIban: string | undefined,
  description: string | undefined
): string[] {
  const patterns: string[] = [];
  
  // Counterpart name is usually the best pattern
  if (counterpartName && counterpartName.trim().length > 3) {
    patterns.push(counterpartName.trim().toLowerCase());
  }
  
  // IBAN is very reliable
  if (counterpartIban) {
    const cleanIban = counterpartIban.replace(/\s/g, '').toLowerCase();
    if (cleanIban.length >= 15) {
      patterns.push(cleanIban);
    }
  }
  
  return patterns;
}
