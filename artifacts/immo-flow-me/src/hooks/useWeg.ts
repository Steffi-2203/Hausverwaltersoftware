import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { toast } from 'sonner';

export interface WegUnitOwner {
  id: string;
  organization_id: string | null;
  property_id: string;
  unit_id: string;
  owner_id: string;
  mea_share: number;
  nutzwert: number | null;
  valid_from: string | null;
  valid_to: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface WegAssembly {
  id: string;
  organization_id: string | null;
  property_id: string;
  title: string;
  assembly_type: 'ordentlich' | 'ausserordentlich' | 'umlaufbeschluss';
  assembly_date: string;
  location: string | null;
  invitation_sent_at: string | null;
  invitation_deadline: string | null;
  is_circular_resolution: boolean;
  circular_deadline: string | null;
  protocol_url: string | null;
  protocol_number: string | null;
  status: 'geplant' | 'eingeladen' | 'durchgefuehrt' | 'protokolliert';
  total_mea_present: number | null;
  total_mea_property: number | null;
  quorum_reached: boolean | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface WegAgendaItem {
  id: string;
  assembly_id: string;
  top_number: number;
  title: string;
  description: string | null;
  category: string;
  created_at: string;
}

export interface WegVote {
  id: string;
  assembly_id: string;
  agenda_item_id: string | null;
  topic: string;
  description: string | null;
  required_majority: 'einfach' | 'qualifiziert' | 'einstimmig';
  votes_yes: number;
  votes_no: number;
  votes_abstain: number;
  mea_votes_yes: number;
  mea_votes_no: number;
  mea_votes_abstain: number;
  total_mea: number | null;
  result: 'angenommen' | 'abgelehnt' | 'vertagt' | null;
  result_basis: 'mea' | 'koepfe';
  is_circular_vote: boolean;
  /** § 24 Abs. 1 WEG 2002: 'umlauf' erfordert Einstimmigkeit aller Eigentümer. */
  vote_type: 'versammlung' | 'umlauf';
  created_at: string;
}

export interface WegOwnerVote {
  id: string;
  vote_id: string;
  owner_id: string;
  unit_id: string | null;
  vote_value: 'ja' | 'nein' | 'enthaltung';
  mea_weight: number | null;
  voted_at: string;
  created_at: string;
}

export interface ReserveFundEntry {
  id: string;
  organization_id: string | null;
  property_id: string;
  year: number;
  month: number;
  amount: number;
  description: string | null;
  entry_type: 'einzahlung' | 'entnahme';
  unit_id: string | null;
  owner_id: string | null;
  created_at: string;
}

export interface WegBudgetPlan {
  id: string;
  organization_id: string | null;
  property_id: string;
  year: number;
  total_amount: number;
  reserve_contribution: number;
  management_fee: number;
  active_from: string | null;
  due_day: number;
  status: 'entwurf' | 'beschlossen' | 'aktiv' | 'abgeschlossen';
  approved_at: string | null;
  approved_by_vote_id: string | null;
  activated_at: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface WegBudgetLine {
  id: string;
  budget_plan_id: string;
  category: string;
  description: string | null;
  amount: number;
  allocation_key: string;
  ust_rate: number;
  created_at: string;
}

export interface BudgetDistribution {
  unit_owner_id: string;
  unit_id: string;
  owner_id: string;
  unit_top: string;
  unit_type: string;
  owner_name: string;
  owner_email: string | null;
  mea_share: number;
  mea_ratio: number;
  bk_netto_jahr: number;
  bk_ust_rate: number;
  bk_ust_jahr: number;
  hk_netto_jahr: number;
  hk_ust_rate: number;
  hk_ust_jahr: number;
  ruecklage_jahr: number;
  verwaltung_netto_jahr: number;
  verwaltung_ust_jahr: number;
  sonstiges_netto_jahr: number;
  sonstiges_ust_jahr: number;
  jahres_total: number;
  monats_total: number;
}

export interface BudgetPreviewResponse {
  plan: WegBudgetPlan;
  distributions: BudgetDistribution[];
  total_mea: number;
}

export interface WegVorschreibung {
  id: string;
  unit_id: string;
  owner_id: string | null;
  weg_budget_plan_id: string | null;
  year: number;
  month: number;
  betriebskosten: number;
  heizungskosten: number;
  ust: number;
  gesamtbetrag: number;
  /** Bereits bezahlter Anteil (bei Status 'teilbezahlt' oder 'bezahlt'). */
  paid_amount: number | null;
  status: string;
  faellig_am: string | null;
  run_id: string | null;
  owner_name: string | null;
  unit_top: string | null;
  unit_type: string | null;
  ust_satz_bk: number;
  ust_satz_heizung: number;
  /** Letzter erfolgreicher Versandzeitpunkt (ISO-String) oder null wenn noch nie versendet. */
  last_sent_at: string | null;
}

export interface WegSpecialAssessment {
  id: string;
  organization_id: string | null;
  property_id: string;
  title: string;
  description: string | null;
  total_amount: number;
  allocation_key: string;
  due_date: string | null;
  approved_by_vote_id: string | null;
  status: 'beschlossen' | 'in_einzahlung' | 'abgeschlossen';
  created_at: string;
  updated_at: string;
}

export interface WegMaintenanceItem {
  id: string;
  organization_id: string | null;
  property_id: string;
  title: string;
  description: string | null;
  category: 'ordentliche_verwaltung' | 'ausserordentliche_verwaltung' | 'notmassnahme';
  priority: 'niedrig' | 'normal' | 'hoch' | 'dringend';
  estimated_cost: number | null;
  actual_cost: number | null;
  financing_source: 'ruecklage' | 'sonderumlage' | 'laufend';
  special_assessment_id: string | null;
  approved_by_vote_id: string | null;
  status: 'geplant' | 'beauftragt' | 'in_ausfuehrung' | 'abgeschlossen';
  start_date: string | null;
  completion_date: string | null;
  contractor_name: string | null;
  contractor_contact: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

// ====== UNIT OWNERS (MEA) ======

export function useWegUnitOwners(propertyId?: string) {
  return useQuery({
    queryKey: ['/api/weg/unit-owners', propertyId],
    queryFn: async () => {
      const params = propertyId ? `?propertyId=${propertyId}` : '';
      const res = await fetch(`/api/weg/unit-owners${params}`, { credentials: 'include' });
      if (!res.ok) throw new Error('Fehler beim Laden');
      return res.json() as Promise<WegUnitOwner[]>;
    },
  });
}

export function useCreateWegUnitOwner() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: Omit<WegUnitOwner, 'id' | 'created_at' | 'updated_at'>) => {
      const res = await apiRequest('POST', '/api/weg/unit-owners', data);
      return res.json();
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['/api/weg/unit-owners'] }); toast.success('Eigentümer-Zuordnung erstellt'); },
    onError: () => toast.error('Fehler beim Erstellen'),
  });
}

export function useUpdateWegUnitOwner() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...updates }: { id: string } & Partial<WegUnitOwner>) => {
      const res = await apiRequest('PATCH', `/api/weg/unit-owners/${id}`, updates);
      return res.json();
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['/api/weg/unit-owners'] }); toast.success('Aktualisiert'); },
    onError: () => toast.error('Fehler beim Aktualisieren'),
  });
}

export function useDeleteWegUnitOwner() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest('DELETE', `/api/weg/unit-owners/${id}`);
      return res.json();
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['/api/weg/unit-owners'] }); toast.success('Eigentümer-Zuordnung gelöscht'); },
    onError: () => toast.error('Fehler beim Löschen'),
  });
}

// ====== ASSEMBLIES ======

export function useWegAssemblies(propertyId?: string) {
  return useQuery({
    queryKey: ['/api/weg/assemblies', propertyId],
    queryFn: async () => {
      const params = propertyId ? `?propertyId=${propertyId}` : '';
      const res = await fetch(`/api/weg/assemblies${params}`, { credentials: 'include' });
      if (!res.ok) throw new Error('Fehler beim Laden');
      return res.json() as Promise<WegAssembly[]>;
    },
  });
}

export function useCreateWegAssembly() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest('POST', '/api/weg/assemblies', data);
      return res.json();
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['/api/weg/assemblies'] }); toast.success('Versammlung erstellt'); },
    onError: () => toast.error('Fehler beim Erstellen'),
  });
}

export function useUpdateWegAssembly() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...updates }: { id: string } & Partial<WegAssembly>) => {
      const res = await apiRequest('PATCH', `/api/weg/assemblies/${id}`, updates);
      return res.json();
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['/api/weg/assemblies'] }); toast.success('Versammlung aktualisiert'); },
    onError: () => toast.error('Fehler beim Aktualisieren'),
  });
}

// ====== AGENDA ITEMS (TOPs) ======

export function useWegAgendaItems(assemblyId?: string) {
  return useQuery({
    queryKey: ['/api/weg/agenda-items', assemblyId],
    queryFn: async () => {
      const res = await fetch(`/api/weg/agenda-items?assemblyId=${assemblyId}`, { credentials: 'include' });
      if (!res.ok) throw new Error('Fehler beim Laden');
      return res.json() as Promise<WegAgendaItem[]>;
    },
    enabled: !!assemblyId,
  });
}

export function useCreateWegAgendaItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: Omit<WegAgendaItem, 'id' | 'created_at'>) => {
      const res = await apiRequest('POST', '/api/weg/agenda-items', data);
      return res.json();
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['/api/weg/agenda-items'] }); toast.success('TOP hinzugefügt'); },
    onError: () => toast.error('Fehler beim Erstellen'),
  });
}

export function useDeleteWegAgendaItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest('DELETE', `/api/weg/agenda-items/${id}`);
      return res.json();
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['/api/weg/agenda-items'] }); toast.success('TOP gelöscht'); },
    onError: () => toast.error('Fehler beim Löschen'),
  });
}

// ====== VOTES ======

export function useWegVotes(assemblyId?: string) {
  return useQuery({
    queryKey: ['/api/weg/votes', assemblyId],
    queryFn: async () => {
      const res = await fetch(`/api/weg/votes?assemblyId=${assemblyId}`, { credentials: 'include' });
      if (!res.ok) throw new Error('Fehler beim Laden');
      return res.json() as Promise<WegVote[]>;
    },
    enabled: !!assemblyId,
  });
}

export function useCreateWegVote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest('POST', '/api/weg/votes', data);
      return res.json();
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['/api/weg/votes'] }); toast.success('Abstimmung gespeichert'); },
    onError: () => toast.error('Fehler beim Speichern'),
  });
}

// ====== OWNER VOTES (per-owner) ======

export function useWegOwnerVotes(voteId?: string) {
  return useQuery({
    queryKey: ['/api/weg/owner-votes', voteId],
    queryFn: async () => {
      const res = await fetch(`/api/weg/owner-votes?voteId=${voteId}`, { credentials: 'include' });
      if (!res.ok) throw new Error('Fehler beim Laden');
      return res.json() as Promise<WegOwnerVote[]>;
    },
    enabled: !!voteId,
  });
}

export function useCreateWegOwnerVote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: Omit<WegOwnerVote, 'id' | 'created_at' | 'voted_at'>) => {
      const res = await apiRequest('POST', '/api/weg/owner-votes', data);
      return res.json();
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['/api/weg/owner-votes'] }); toast.success('Stimme erfasst'); },
    onError: () => toast.error('Fehler beim Speichern'),
  });
}

// ====== RESERVE FUND ======

export function useReserveFund(propertyId?: string) {
  return useQuery({
    queryKey: ['/api/weg/reserve-fund', propertyId],
    queryFn: async () => {
      const params = propertyId ? `?propertyId=${propertyId}` : '';
      const res = await fetch(`/api/weg/reserve-fund${params}`, { credentials: 'include' });
      if (!res.ok) throw new Error('Fehler beim Laden');
      return res.json() as Promise<ReserveFundEntry[]>;
    },
  });
}

export function useCreateReserveFundEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest('POST', '/api/weg/reserve-fund', data);
      return res.json();
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['/api/weg/reserve-fund'] }); toast.success('Rücklage-Buchung erstellt'); },
    onError: () => toast.error('Fehler beim Erstellen'),
  });
}

// ====== BUDGET PLANS (Wirtschaftsplan) ======

export function useWegBudgetPlans(propertyId?: string) {
  return useQuery({
    queryKey: ['/api/weg/budget-plans', propertyId],
    queryFn: async () => {
      const params = propertyId ? `?propertyId=${propertyId}` : '';
      const res = await fetch(`/api/weg/budget-plans${params}`, { credentials: 'include' });
      if (!res.ok) throw new Error('Fehler beim Laden');
      return res.json() as Promise<WegBudgetPlan[]>;
    },
  });
}

export function useCreateWegBudgetPlan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest('POST', '/api/weg/budget-plans', data);
      return res.json();
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['/api/weg/budget-plans'] }); toast.success('Wirtschaftsplan erstellt'); },
    onError: () => toast.error('Fehler beim Erstellen'),
  });
}

export function useUpdateWegBudgetPlan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...updates }: { id: string } & Partial<WegBudgetPlan>) => {
      const res = await apiRequest('PATCH', `/api/weg/budget-plans/${id}`, updates);
      return res.json();
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['/api/weg/budget-plans'] }); toast.success('Wirtschaftsplan aktualisiert'); },
    onError: () => toast.error('Fehler beim Aktualisieren'),
  });
}

// ====== BUDGET LINES ======

export function useWegBudgetLines(budgetPlanId?: string) {
  return useQuery({
    queryKey: ['/api/weg/budget-lines', budgetPlanId],
    queryFn: async () => {
      const res = await fetch(`/api/weg/budget-lines?budgetPlanId=${budgetPlanId}`, { credentials: 'include' });
      if (!res.ok) throw new Error('Fehler beim Laden');
      return res.json() as Promise<WegBudgetLine[]>;
    },
    enabled: !!budgetPlanId,
  });
}

export function useCreateWegBudgetLine() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: Omit<WegBudgetLine, 'id' | 'created_at'>) => {
      const res = await apiRequest('POST', '/api/weg/budget-lines', data);
      return res.json();
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['/api/weg/budget-lines'] }); toast.success('Budgetposition hinzugefügt'); },
    onError: () => toast.error('Fehler beim Erstellen'),
  });
}

export function useUpdateWegBudgetLine() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...data }: { id: string; allocation_key?: string; category?: string; description?: string; amount?: number; ust_rate?: number }) => {
      const res = await apiRequest('PATCH', `/api/weg/budget-lines/${id}`, data);
      return res.json();
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['/api/weg/budget-lines'] }); toast.success('Budgetposition gespeichert'); },
    onError: () => toast.error('Fehler beim Aktualisieren'),
  });
}

export function useDeleteWegBudgetLine() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest('DELETE', `/api/weg/budget-lines/${id}`);
      return res.json();
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['/api/weg/budget-lines'] }); toast.success('Budgetposition gelöscht'); },
    onError: () => toast.error('Fehler beim Löschen'),
  });
}

// ====== SPECIAL ASSESSMENTS (Sonderumlagen) ======

export function useWegSpecialAssessments(propertyId?: string) {
  return useQuery({
    queryKey: ['/api/weg/special-assessments', propertyId],
    queryFn: async () => {
      const params = propertyId ? `?propertyId=${propertyId}` : '';
      const res = await fetch(`/api/weg/special-assessments${params}`, { credentials: 'include' });
      if (!res.ok) throw new Error('Fehler beim Laden');
      return res.json() as Promise<WegSpecialAssessment[]>;
    },
  });
}

export function useCreateWegSpecialAssessment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest('POST', '/api/weg/special-assessments', data);
      return res.json();
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['/api/weg/special-assessments'] }); toast.success('Sonderumlage erstellt'); },
    onError: () => toast.error('Fehler beim Erstellen'),
  });
}

export function useUpdateWegSpecialAssessment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...updates }: { id: string } & Partial<WegSpecialAssessment>) => {
      const res = await apiRequest('PATCH', `/api/weg/special-assessments/${id}`, updates);
      return res.json();
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['/api/weg/special-assessments'] }); toast.success('Sonderumlage aktualisiert'); },
    onError: () => toast.error('Fehler beim Aktualisieren'),
  });
}

/**
 * Erstellt WEG-Vorschreibungen für eine beschlossene Sonderumlage.
 * Invalidiert nach Erfolg auch die Rücklage-Übersicht, damit der
 * neue Rücklage-Eintrag (credits_reserve_fund=true) sofort sichtbar ist.
 */
export function useCreateSpecialAssessmentInvoices() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (assessmentId: string) => {
      const res = await apiRequest('POST', `/api/weg/special-assessments/${assessmentId}/invoice`, {});
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as any).error || 'Fehler beim Erstellen der Vorschreibungen');
      }
      return res.json();
    },
    onSuccess: (data) => {
      // Sonderumlage-Liste aktualisieren
      qc.invalidateQueries({ queryKey: ['/api/weg/special-assessments'] });
      // Rücklage-Übersicht neu laden (falls credits_reserve_fund=true)
      qc.invalidateQueries({ queryKey: ['/api/weg/reserve-fund'] });
      // Vorschreibungen-Liste neu laden
      qc.invalidateQueries({ queryKey: ['/api/weg/vorschreibungen'] });
      toast.success(`${(data as any).count ?? 0} Vorschreibungen für Sonderumlage erstellt`);
    },
    onError: (err: Error) => toast.error(err.message || 'Fehler beim Erstellen der Vorschreibungen'),
  });
}

// ====== MAINTENANCE ITEMS (Erhaltung & Verbesserung) ======

export function useWegMaintenance(propertyId?: string) {
  return useQuery({
    queryKey: ['/api/weg/maintenance', propertyId],
    queryFn: async () => {
      const params = propertyId ? `?propertyId=${propertyId}` : '';
      const res = await fetch(`/api/weg/maintenance${params}`, { credentials: 'include' });
      if (!res.ok) throw new Error('Fehler beim Laden');
      return res.json() as Promise<WegMaintenanceItem[]>;
    },
  });
}

export function useCreateWegMaintenance() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest('POST', '/api/weg/maintenance', data);
      return res.json();
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['/api/weg/maintenance'] }); toast.success('Maßnahme erstellt'); },
    onError: () => toast.error('Fehler beim Erstellen'),
  });
}

export function useUpdateWegMaintenance() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...updates }: { id: string } & Partial<WegMaintenanceItem>) => {
      const res = await apiRequest('PATCH', `/api/weg/maintenance/${id}`, updates);
      return res.json();
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['/api/weg/maintenance'] }); toast.success('Maßnahme aktualisiert'); },
    onError: () => toast.error('Fehler beim Aktualisieren'),
  });
}

export function useDeleteWegMaintenance() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest('DELETE', `/api/weg/maintenance/${id}`);
      return res.json();
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['/api/weg/maintenance'] }); toast.success('Maßnahme gelöscht'); },
    onError: () => toast.error('Fehler beim Löschen'),
  });
}

// ====== BUDGET PLAN PREVIEW & ACTIVATION ======

export function useBudgetPlanPreview(planId?: string) {
  return useQuery({
    queryKey: ['/api/weg/budget-plans', planId, 'preview'],
    queryFn: async () => {
      const res = await fetch(`/api/weg/budget-plans/${planId}/preview`, { credentials: 'include' });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Fehler' }));
        throw new Error(err.error || 'Fehler bei der Vorschau');
      }
      return res.json() as Promise<BudgetPreviewResponse>;
    },
    enabled: !!planId,
  });
}

export function useActivateBudgetPlan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (planId: string) => {
      const res = await apiRequest('POST', `/api/weg/budget-plans/${planId}/activate`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Fehler' }));
        throw new Error(err.error || 'Fehler beim Aktivieren');
      }
      return res.json();
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['/api/weg/budget-plans'] });
      toast.success(data.message || 'Vorschreibungen generiert');
    },
    onError: (err: Error) => toast.error(err.message || 'Fehler beim Aktivieren'),
  });
}

export function useWegVorschreibungen(planId?: string) {
  return useQuery({
    queryKey: ['/api/weg/budget-plans', planId, 'vorschreibungen'],
    queryFn: async () => {
      const res = await fetch(`/api/weg/budget-plans/${planId}/vorschreibungen`, { credentials: 'include' });
      if (!res.ok) throw new Error('Fehler beim Laden');
      return res.json() as Promise<WegVorschreibung[]>;
    },
    enabled: !!planId,
  });
}

export function useSendWegVorschreibungen() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (planId: string) => {
      const res = await apiRequest('POST', `/api/weg/budget-plans/${planId}/send`, {});
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as any).error || 'Fehler beim Versand');
      }
      return res.json();
    },
    onSuccess: (_data, planId) => {
      qc.invalidateQueries({ queryKey: ['/api/weg/budget-plans', planId, 'vorschreibungen'] });
      toast.success('Vorschreibungen versendet');
    },
    onError: (err: Error) => toast.error(err.message || 'Fehler beim Versand'),
  });
}

// ====== EIGENTÜMERWECHSEL (OWNER CHANGE) ======

export interface WegOwnerChange {
  id: string;
  organization_id: string | null;
  property_id: string;
  unit_id: string;
  previous_owner_id: string;
  new_owner_id: string;
  transfer_date: string;
  grundbuch_date: string | null;
  tz_number: string | null;
  kaufvertrag_date: string | null;
  rechtsgrund: 'kauf' | 'schenkung' | 'erbschaft' | 'zwangsversteigerung' | 'einbringung';
  status: 'entwurf' | 'grundbuch_eingetragen' | 'abgeschlossen';
  mea_share: string | null;
  nutzwert: string | null;
  reserve_amount: string;
  open_debts_amount: string;
  aliquot_month: number | null;
  aliquot_old_owner_amount: string;
  aliquot_new_owner_amount: string;
  cancelled_invoice_count: number;
  new_invoice_count: number;
  notes: string | null;
  created_by: string | null;
  executed_at: string | null;
  created_at: string;
  updated_at: string;
  previous_owner_name?: string | null;
  new_owner_name?: string | null;
  unit_top?: string | null;
}

export interface OwnerChangePreview {
  owner_change: any;
  previous_owner: { id: string; name: string; email: string | null } | null;
  new_owner: { id: string; name: string; email: string | null } | null;
  unit: { id: string; top_nummer: string; type: string; nutzflaeche: string | null } | null;
  transfer: {
    transfer_date: string;
    transfer_year: number;
    transfer_month: number;
    transfer_day: number;
    days_in_transfer_month: number;
    days_in_year: number;
  };
  aliquotierung: {
    old_owner_days_in_month: number;
    new_owner_days_in_month: number;
    old_owner_days_in_year: number;
    new_owner_days_in_year: number;
    monthly_amount: number;
    yearly_amount: number;
    aliquot_old_month: number;
    aliquot_new_month: number;
    aliquot_old_year: number;
    aliquot_new_year: number;
  };
  financials: {
    open_debts_total: number;
    past_due_invoices: number;
    past_due_amount: number;
    future_invoices_to_cancel: number;
    reserve_total: number;
    reserve_share: number;
    mea_share: number;
    mea_ratio: number;
    total_mea: number;
  };
  new_invoices: {
    remaining_months: number[];
    count: number;
    monthly_amount: number;
    first_month_aliquot: number | null;
    has_aliquot_month: boolean;
  };
  warnings: string[];
}

export function useOwnerChanges(propertyId?: string) {
  return useQuery({
    queryKey: ['/api/weg/owner-changes', propertyId],
    queryFn: async () => {
      const url = propertyId ? `/api/weg/owner-changes?propertyId=${propertyId}` : '/api/weg/owner-changes';
      const res = await fetch(url, { credentials: 'include' });
      if (!res.ok) throw new Error('Fehler beim Laden');
      return res.json() as Promise<WegOwnerChange[]>;
    },
    enabled: !!propertyId,
  });
}

export function useCreateOwnerChange() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest('POST', '/api/weg/owner-changes', data);
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Fehler' }));
        throw new Error(err.error || 'Fehler beim Erstellen');
      }
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['/api/weg/owner-changes'] });
      toast.success('Eigentümerwechsel angelegt');
    },
    onError: (err: Error) => toast.error(err.message),
  });
}

export function useUpdateOwnerChange() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: any }) => {
      const res = await apiRequest('PATCH', `/api/weg/owner-changes/${id}`, data);
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Fehler' }));
        throw new Error(err.error || 'Fehler beim Aktualisieren');
      }
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['/api/weg/owner-changes'] });
      toast.success('Eigentümerwechsel aktualisiert');
    },
    onError: (err: Error) => toast.error(err.message),
  });
}

export function useOwnerChangePreview(id?: string) {
  return useQuery({
    queryKey: ['/api/weg/owner-changes', id, 'preview'],
    queryFn: async () => {
      const res = await fetch(`/api/weg/owner-changes/${id}/preview`, { credentials: 'include' });
      if (!res.ok) throw new Error('Fehler bei der Vorschau');
      return res.json() as Promise<OwnerChangePreview>;
    },
    enabled: !!id,
  });
}

export function useExecuteOwnerChange() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest('POST', `/api/weg/owner-changes/${id}/execute`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Fehler' }));
        throw new Error(err.error || 'Fehler beim Durchführen');
      }
      return res.json();
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['/api/weg/owner-changes'] });
      qc.invalidateQueries({ queryKey: ['/api/weg/unit-owners'] });
      qc.invalidateQueries({ queryKey: ['/api/weg/budget-plans'] });
      qc.invalidateQueries({ queryKey: ['/api/weg/reserve-fund'] });
      toast.success(data.message || 'Eigentümerwechsel durchgeführt');
    },
    onError: (err: Error) => toast.error(err.message),
  });
}
