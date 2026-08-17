interface CategoryRule {
  categoryName: string;
  keywords: string[];
  minAmount?: number;
  maxAmount?: number;
}

const CATEGORY_RULES: CategoryRule[] = [
  // Einnahmen
  {
    categoryName: 'Mieteinnahmen',
    keywords: ['miete', 'rent', 'top', 'wohnung', 'whg', 'apartment', 'monatsmiete']
  },
  {
    categoryName: 'Betriebskostenvorauszahlungen',
    keywords: ['betriebskosten', 'bk', 'nebenkosten', 'nk', 'vorauszahlung']
  },
  
  // Versicherungen
  {
    categoryName: 'Versicherungen',
    keywords: ['versicherung', 'insurance', 'wiener städtische', 'uniqa', 'allianz', 'generali', 'donau versicherung', 'grazer wechselseitige']
  },
  
  // Instandhaltung & Reparaturen
  {
    categoryName: 'Instandhaltung',
    keywords: ['instandhaltung', 'wartung', 'maintenance', 'sanierung', 'renovierung']
  },
  {
    categoryName: 'Reparaturen',
    keywords: ['reparatur', 'repair', 'handwerker', 'notdienst', 'installateur', 'elektriker']
  },
  {
    categoryName: 'Lift/Aufzug',
    keywords: ['lift', 'aufzug', 'elevator', 'schindler', 'otis', 'kone', 'thyssenkrupp']
  },
  
  // Energie & Ver-/Entsorgung
  {
    categoryName: 'Heizung',
    keywords: ['heizung', 'heating', 'fernwärme', 'gas', 'öl', 'wien energie', 'heizkosten', 'wärme']
  },
  {
    categoryName: 'Strom Allgemein',
    keywords: ['strom', 'electricity', 'energie', 'beleuchtung', 'elektrizität']
  },
  {
    categoryName: 'Wasser/Abwasser',
    keywords: ['wasser', 'water', 'abwasser', 'kanal', 'wasserwerk', 'wassergebühr']
  },
  {
    categoryName: 'Müllabfuhr',
    keywords: ['müll', 'abfall', 'waste', 'entsorgung', 'ma 48', 'müllabfuhr', 'abfallwirtschaft']
  },
  
  // Pflege & Reinigung
  {
    categoryName: 'Hausbetreuung/Reinigung',
    keywords: ['reinigung', 'cleaning', 'hausbetreuung', 'putz', 'sauber', 'hauswart', 'hausmeister']
  },
  {
    categoryName: 'Gartenpflege',
    keywords: ['garten', 'garden', 'rasenmähen', 'grünfläche', 'baumpflege', 'grünanlagen']
  },
  {
    categoryName: 'Schneeräumung',
    keywords: ['schnee', 'snow', 'winterdienst', 'räumung', 'streudienst', 'streuen']
  },
  
  // Steuern & Verwaltung
  {
    categoryName: 'Grundsteuer',
    keywords: ['grundsteuer', 'property tax', 'kommunalsteuer', 'gemeindesteuer']
  },
  {
    categoryName: 'Verwaltungskosten',
    keywords: ['verwaltung', 'management', 'hausverwaltung', 'verwaltungshonorar', 'honorar']
  }
];

export interface CategorySuggestion {
  categoryId: string;
  confidence: number;
}

export interface CategorizationResult {
  categoryId: string | null;
  confidence: number;
  suggestions: CategorySuggestion[];
}

export interface CategoryInfo {
  id: string;
  name: string;
  type: string;
}

export function categorizeTransaction(
  description: string,
  reference: string,
  counterpartyName: string,
  amount: number,
  categories: CategoryInfo[]
): CategorizationResult {
  const searchText = `${description || ''} ${reference || ''} ${counterpartyName || ''}`.toLowerCase();
  const isExpense = amount < 0;
  
  let bestMatch = { categoryId: null as string | null, confidence: 0 };
  const suggestions: CategorySuggestion[] = [];
  
  // Durchsuche alle Regeln
  for (const rule of CATEGORY_RULES) {
    const category = categories.find(c => 
      c.name.toLowerCase() === rule.categoryName.toLowerCase() &&
      (isExpense ? c.type === 'expense' : c.type === 'income')
    );
    
    if (!category) continue;
    
    let confidence = 0;
    let matchCount = 0;
    
    // Keyword-Matching
    for (const keyword of rule.keywords) {
      if (searchText.includes(keyword.toLowerCase())) {
        matchCount++;
        confidence += 0.25;
      }
    }
    
    // Bonus für mehrere Treffer
    if (matchCount > 1) {
      confidence += 0.15;
    }
    
    // Betragsprüfung (optional)
    if (rule.minAmount && Math.abs(amount) < rule.minAmount) {
      confidence -= 0.1;
    }
    if (rule.maxAmount && Math.abs(amount) > rule.maxAmount) {
      confidence -= 0.1;
    }
    
    // Clamp zwischen 0 und 1
    confidence = Math.max(0, Math.min(1, confidence));
    
    if (confidence > 0.2) {
      suggestions.push({ categoryId: category.id, confidence });
    }
    
    if (confidence > bestMatch.confidence) {
      bestMatch = { categoryId: category.id, confidence };
    }
  }
  
  // Sortiere Suggestions nach Konfidenz
  suggestions.sort((a, b) => b.confidence - a.confidence);
  
  return {
    categoryId: bestMatch.confidence >= 0.3 ? bestMatch.categoryId : null,
    confidence: bestMatch.confidence,
    suggestions: suggestions.slice(0, 3) // Top 3
  };
}

// Kategorisiere mehrere Transaktionen auf einmal
export function categorizeTransactions<T extends {
  description?: string | null;
  reference?: string | null;
  counterpart_name?: string | null;
  amount: number;
}>(
  transactions: T[],
  categories: CategoryInfo[]
): Array<T & { autoCategory: CategorizationResult }> {
  return transactions.map(t => ({
    ...t,
    autoCategory: categorizeTransaction(
      t.description || '',
      t.reference || '',
      t.counterpart_name || '',
      t.amount,
      categories
    )
  }));
}
