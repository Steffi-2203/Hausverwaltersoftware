/**
 * Central field normalization utility for API data
 * 
 * PROBLEM: Drizzle ORM returns camelCase (tenantId, propertyId), but much of
 * the frontend code was written expecting snake_case (tenant_id, property_id).
 * 
 * SOLUTION: This utility normalizes all data to include BOTH formats,
 * ensuring backwards compatibility while gradually migrating to camelCase.
 */

// Common field mappings from camelCase to snake_case
const fieldMappings: Record<string, string> = {
  // IDs
  tenantId: 'tenant_id',
  propertyId: 'property_id',
  unitId: 'unit_id',
  invoiceId: 'invoice_id',
  organizationId: 'organization_id',
  bankAccountId: 'bank_account_id',
  categoryId: 'category_id',
  ownerId: 'owner_id',
  contractorId: 'contractor_id',
  meterId: 'meter_id',
  expenseId: 'expense_id',
  taskId: 'task_id',
  documentId: 'document_id',
  settlementId: 'settlement_id',
  collectionId: 'collection_id',
  budgetId: 'budget_id',
  messageId: 'message_id',
  keyId: 'key_id',
  contractId: 'contract_id',
  adjustmentId: 'adjustment_id',
  transactionId: 'transaction_id',
  parentId: 'parent_id',
  userId: 'user_id',
  memberId: 'member_id',
  matchedTenantId: 'matched_tenant_id',
  matchedUnitId: 'matched_unit_id',
  
  // Names
  firstName: 'first_name',
  lastName: 'last_name',
  companyName: 'company_name',
  contactName: 'contact_name',
  
  // Tenant fields
  topNummer: 'top_nummer',
  betriebskostenVorschuss: 'betriebskosten_vorschuss',
  heizungskostenVorschuss: 'heizungskosten_vorschuss',
  mobilePhone: 'mobile_phone',
  sepaMandatDatum: 'sepa_mandat_datum',
  sepaMandat: 'sepa_mandat',
  kautionBezahlt: 'kaution_bezahlt',
  
  // Dates
  buchungsDatum: 'buchungs_datum',
  eingangsDatum: 'eingangs_datum',
  transactionDate: 'transaction_date',
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  deletedAt: 'deleted_at',
  faelligAm: 'faellig_am',
  dueDate: 'due_date',
  startDate: 'start_date',
  endDate: 'end_date',
  readingDate: 'reading_date',
  handoverDate: 'handover_date',
  returnDate: 'return_date',
  effectiveDate: 'effective_date',
  expiryDate: 'expiry_date',
  invoiceDate: 'invoice_date',
  paymentDate: 'payment_date',
  completedAt: 'completed_at',
  sentAt: 'sent_at',
  receivedAt: 'received_at',
  
  // URLs and paths
  pdfUrl: 'pdf_url',
  fileUrl: 'file_url',
  filePath: 'file_path',
  documentUrl: 'document_url',
  
  // Financial
  vortragMiete: 'vortrag_miete',
  vortragBk: 'vortrag_bk',
  vortragHk: 'vortrag_hk',
  vortragSonstige: 'vortrag_sonstige',
  ustSatz: 'ust_satz',
  ustSatzBk: 'ust_satz_bk',
  ustSatzHeizung: 'ust_satz_heizung',
  paymentType: 'payment_type',
  netAmount: 'net_amount',
  grossAmount: 'gross_amount',
  taxAmount: 'tax_amount',
  taxRate: 'tax_rate',
  baseAmount: 'base_amount',
  totalAmount: 'total_amount',
  openAmount: 'open_amount',
  paidAmount: 'paid_amount',
  
  // Expense/Invoice
  invoiceNumber: 'invoice_number',
  expenseNumber: 'expense_number',
  referenceNumber: 'reference_number',
  supplierName: 'supplier_name',
  expenseCategory: 'expense_category',
  costType: 'cost_type',
  distributionKey: 'distribution_key',
  
  // Meter
  meterNumber: 'meter_number',
  meterType: 'meter_type',
  previousReading: 'previous_reading',
  currentReading: 'current_reading',
  readingValue: 'reading_value',
  
  // Bank/SEPA
  accountNumber: 'account_number',
  bankName: 'bank_name',
  accountHolder: 'account_holder',
  mandateReference: 'mandate_reference',
  collectionDate: 'collection_date',
  executionDate: 'execution_date',
  
  // Maintenance
  priorityLevel: 'priority_level',
  taskType: 'task_type',
  contractType: 'contract_type',
  
  // Keys
  keyNumber: 'key_number',
  keyType: 'key_type',
  keyCount: 'key_count',
  
  // VPI
  indexValue: 'index_value',
  baseIndex: 'base_index',
  currentIndex: 'current_index',
  adjustmentPercent: 'adjustment_percent',
  
  // Distribution keys
  keyName: 'key_name',
  keyDescription: 'key_description',
  
  // Documents
  fileName: 'file_name',
  fileSize: 'file_size',
  fileType: 'file_type',
  mimeType: 'mime_type',
  
  // Budget
  budgetYear: 'budget_year',
  budgetMonth: 'budget_month',
  plannedAmount: 'planned_amount',
  actualAmount: 'actual_amount',
  
  // Messages
  messageType: 'message_type',
  isRead: 'is_read',
  readAt: 'read_at',
  senderName: 'sender_name',
  recipientId: 'recipient_id',
  
  // Organization
  planType: 'plan_type',
  subscriptionStatus: 'subscription_status',
  trialEndsAt: 'trial_ends_at',
  
  // Misc
  verwendungszweck: 'verwendungszweck',
  notizen: 'notizen',
  zipCode: 'zip_code',
  postalCode: 'postal_code',
  isActive: 'is_active',
  isDeleted: 'is_deleted',
  sortOrder: 'sort_order',
};

// Reverse mapping: snake_case to camelCase
const reverseFieldMappings: Record<string, string> = Object.entries(fieldMappings)
  .reduce((acc, [camel, snake]) => ({ ...acc, [snake]: camel }), {});

/**
 * Normalize a single object to include both camelCase and snake_case fields
 */
export function normalizeFields<T extends Record<string, any>>(obj: T): T & Record<string, any> {
  if (!obj || typeof obj !== 'object') return obj;
  
  const result: Record<string, any> = { ...obj };
  
  // Add snake_case aliases for camelCase fields
  for (const [camelKey, snakeKey] of Object.entries(fieldMappings)) {
    if (camelKey in obj && !(snakeKey in obj)) {
      result[snakeKey] = obj[camelKey];
    }
  }
  
  // Add camelCase aliases for snake_case fields (if API returns snake_case)
  for (const [snakeKey, camelKey] of Object.entries(reverseFieldMappings)) {
    if (snakeKey in obj && !(camelKey in obj)) {
      result[camelKey] = obj[snakeKey];
    }
  }
  
  return result as T & Record<string, any>;
}

/**
 * Normalize an array of objects
 */
export function normalizeArray<T extends Record<string, any>>(arr: T[]): (T & Record<string, any>)[] {
  if (!Array.isArray(arr)) return arr;
  return arr.map(normalizeFields);
}

/**
 * Tenant normalization - ensures all fields are accessible in both formats
 */
export interface NormalizedTenant {
  id: string;
  unitId: string;
  unit_id: string;
  firstName: string;
  first_name: string;
  lastName: string;
  last_name: string;
  email: string | null;
  phone: string | null;
  mobilePhone: string | null;
  mobile_phone: string | null;
  status: 'aktiv' | 'leerstand' | 'beendet';
  mietbeginn: string | null;
  mietende: string | null;
  grundmiete: string;
  betriebskostenVorschuss: string;
  betriebskosten_vorschuss: string;
  heizungskostenVorschuss: string;
  heizungskosten_vorschuss: string;
  kaution: string | null;
  kautionBezahlt: boolean;
  kaution_bezahlt: boolean;
  iban: string | null;
  bic: string | null;
  sepaMandat: boolean;
  sepa_mandat: boolean;
  sepaMandatDatum: string | null;
  sepa_mandat_datum: string | null;
  notes: string | null;
  createdAt: string;
  created_at: string;
  updatedAt: string;
  updated_at: string;
  units?: NormalizedUnit;
}

/**
 * Unit normalization
 */
export interface NormalizedUnit {
  id: string;
  propertyId: string;
  property_id: string;
  topNummer: string;
  top_nummer: string;
  type: 'wohnung' | 'geschaeft' | 'garage' | 'stellplatz' | 'lager' | 'sonstiges';
  status: 'aktiv' | 'leerstand' | 'beendet';
  flaeche: string | null;
  zimmer: number | null;
  nutzwert: string | null;
  stockwerk: number | null;
  notes: string | null;
  createdAt: string;
  created_at: string;
  updatedAt: string;
  updated_at: string;
  properties?: NormalizedProperty;
  tenants?: NormalizedTenant[];
}

/**
 * Property normalization
 */
export interface NormalizedProperty {
  id: string;
  organizationId: string;
  organization_id: string;
  name: string;
  address: string;
  city: string;
  zipCode: string;
  zip_code: string;
  country: string;
  notes: string | null;
  createdAt: string;
  created_at: string;
  updatedAt: string;
  updated_at: string;
}

/**
 * Payment normalization
 */
export interface NormalizedPayment {
  id: string;
  tenantId: string;
  tenant_id: string;
  invoiceId: string | null;
  invoice_id: string | null;
  betrag: string;
  buchungsDatum: string;
  buchungs_datum: string;
  eingangsDatum?: string;
  eingangs_datum?: string;
  paymentType: string;
  payment_type: string;
  verwendungszweck: string | null;
  transactionId: string | null;
  transaction_id: string | null;
  notizen: string | null;
  createdAt: string;
  created_at: string;
}

/**
 * Transaction normalization
 */
export interface NormalizedTransaction {
  id: string;
  bankAccountId: string | null;
  bank_account_id: string | null;
  organizationId: string;
  organization_id: string;
  propertyId: string | null;
  property_id: string | null;
  tenantId: string | null;
  tenant_id: string | null;
  matchedTenantId: string | null;
  matched_tenant_id: string | null;
  matchedUnitId: string | null;
  matched_unit_id: string | null;
  categoryId: string | null;
  category_id: string | null;
  transactionDate: string;
  transaction_date: string;
  amount: string;
  description: string | null;
  reference: string | null;
  type: 'income' | 'expense';
  status: string;
  createdAt: string;
  created_at: string;
}

/**
 * Normalize tenants array with proper typing
 */
export function normalizeTenants(tenants: any[]): NormalizedTenant[] {
  return normalizeArray(tenants) as NormalizedTenant[];
}

/**
 * Normalize units array with proper typing
 */
export function normalizeUnits(units: any[]): NormalizedUnit[] {
  return normalizeArray(units) as NormalizedUnit[];
}

/**
 * Normalize properties array with proper typing
 */
export function normalizeProperties(properties: any[]): NormalizedProperty[] {
  return normalizeArray(properties) as NormalizedProperty[];
}

/**
 * Normalize payments array with proper typing
 */
export function normalizePayments(payments: any[]): NormalizedPayment[] {
  return normalizeArray(payments) as NormalizedPayment[];
}

/**
 * Normalize transactions array with proper typing
 */
export function normalizeTransactions(transactions: any[]): NormalizedTransaction[] {
  return normalizeArray(transactions) as NormalizedTransaction[];
}

/**
 * Get field value with fallback (supports both camelCase and snake_case)
 */
export function getField<T = any>(obj: Record<string, any>, camelKey: string): T | undefined {
  if (!obj) return undefined;
  const snakeKey = fieldMappings[camelKey];
  return obj[camelKey] ?? obj[snakeKey];
}

/**
 * SonstigeKosten cost item structure from OCR extraction
 */
export interface SonstigeKostenItem {
  betrag: number;
  ust: number;
  schluessel?: string;
}

export type SonstigeKosten = Record<string, SonstigeKostenItem>;

/**
 * Calculate total costs from sonstigeKosten JSONB field
 * Returns sum of all betrag values (NET amounts)
 * Handles both numeric and string values from JSONB
 */
export function calculateSonstigeKostenTotal(sonstigeKosten: SonstigeKosten | null | undefined): number {
  if (!sonstigeKosten || typeof sonstigeKosten !== 'object') return 0;
  return Object.values(sonstigeKosten).reduce((sum, item) => {
    if (item && item.betrag !== undefined && item.betrag !== null) {
      const betrag = typeof item.betrag === 'string' ? parseFloat(item.betrag) : Number(item.betrag);
      if (!isNaN(betrag)) {
        return sum + betrag;
      }
    }
    return sum;
  }, 0);
}

/**
 * Check if sonstigeKosten has any cost items
 */
export function hasSonstigeKosten(sonstigeKosten: SonstigeKosten | null | undefined): boolean {
  if (!sonstigeKosten || typeof sonstigeKosten !== 'object') return false;
  return Object.keys(sonstigeKosten).length > 0;
}

/**
 * Calculate total rent including grundmiete and all sonstigeKosten items
 */
export function calculateTotalRent(tenant: Record<string, any>): number {
  const grundmiete = Number(tenant.grundmiete) || 0;
  
  const sonstige = tenant.sonstigeKosten ?? tenant.sonstige_kosten;
  // If sonstigeKosten has data (keys present), use it; otherwise fall back to legacy fields
  if (hasSonstigeKosten(sonstige)) {
    const sonstigeTotal = calculateSonstigeKostenTotal(sonstige);
    return grundmiete + sonstigeTotal;
  }
  
  // Legacy fallback for old data - support both camelCase and snake_case
  const bk = Number(tenant.betriebskostenVorschuss ?? tenant.betriebskosten_vorschuss) || 0;
  const hk = Number(tenant.heizungskostenVorschuss ?? tenant.heizungskosten_vorschuss) || 0;
  const wk = Number(tenant.wasserkostenVorschuss ?? tenant.wasserkosten_vorschuss) || 0;
  const wwk = Number(tenant.warmwasserkostenVorschuss ?? tenant.warmwasserkosten_vorschuss) || 0;
  
  return grundmiete + bk + hk + wk + wwk;
}

/**
 * Format sonstigeKosten as breakdown string for display
 */
export function formatSonstigeKostenBreakdown(sonstigeKosten: SonstigeKosten | null | undefined): string {
  if (!sonstigeKosten || typeof sonstigeKosten !== 'object') return '';
  
  const items = Object.entries(sonstigeKosten)
    .filter(([_, item]) => item && typeof item.betrag === 'number')
    .map(([name, item]) => `${name}: €${item.betrag.toFixed(2)}`);
  
  return items.join(', ');
}
