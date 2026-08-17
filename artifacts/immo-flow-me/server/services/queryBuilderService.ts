import { orgContext } from "../db";

export interface QueryConfig {
  entity: string;
  selectedFields: string[];
  filters: Array<{
    field: string;
    operator: string;
    value: string;
  }>;
  groupBy?: string;
  orderBy?: { field: string; direction: 'asc' | 'desc' };
  limit?: number;
}

interface EntityDef {
  label: string;
  table: string;
  fields: Record<string, FieldMeta>;
  orgPath: string;
}

interface FieldMeta {
  label: string;
  type: 'text' | 'number' | 'date' | 'enum';
  operators: string[];
  enumValues?: string[];
}

const OPERATOR_MAP: Record<string, string> = {
  '=': '=',
  '!=': '!=',
  '>': '>',
  '<': '<',
  '>=': '>=',
  '<=': '<=',
  'enthält': 'ILIKE',
  'ist leer': 'IS NULL',
  'ist nicht leer': 'IS NOT NULL',
};

const TEXT_OPS = ['=', '!=', 'enthält', 'ist leer', 'ist nicht leer'];
const NUM_OPS = ['=', '!=', '>', '<', '>=', '<=', 'ist leer', 'ist nicht leer'];
const DATE_OPS = ['=', '!=', '>', '<', '>=', '<=', 'ist leer', 'ist nicht leer'];
const ENUM_OPS = ['=', '!=', 'ist leer', 'ist nicht leer'];

const ENTITIES: Record<string, EntityDef> = {
  properties: {
    label: 'Objekte',
    table: 'properties',
    orgPath: 'properties.organization_id',
    fields: {
      name: { label: 'Name', type: 'text', operators: TEXT_OPS },
      address: { label: 'Adresse', type: 'text', operators: TEXT_OPS },
      city: { label: 'Stadt', type: 'text', operators: TEXT_OPS },
      postal_code: { label: 'PLZ', type: 'text', operators: TEXT_OPS },
      total_units: { label: 'Anzahl Einheiten', type: 'number', operators: NUM_OPS },
      total_area: { label: 'Gesamtfläche', type: 'number', operators: NUM_OPS },
      construction_year: { label: 'Baujahr', type: 'number', operators: NUM_OPS },
    },
  },
  units: {
    label: 'Einheiten',
    table: 'units',
    orgPath: 'properties.organization_id',
    fields: {
      top_nummer: { label: 'Top-Nummer', type: 'text', operators: TEXT_OPS },
      type: { label: 'Typ', type: 'enum', operators: ENUM_OPS, enumValues: ['wohnung', 'geschaeft', 'garage', 'stellplatz', 'lager', 'sonstiges'] },
      status: { label: 'Status', type: 'enum', operators: ENUM_OPS, enumValues: ['aktiv', 'leerstand', 'beendet'] },
      flaeche: { label: 'Fläche (m²)', type: 'number', operators: NUM_OPS },
      zimmer: { label: 'Zimmer', type: 'number', operators: NUM_OPS },
      nutzwert: { label: 'Nutzwert', type: 'number', operators: NUM_OPS },
      stockwerk: { label: 'Stockwerk', type: 'number', operators: NUM_OPS },
      'properties.name': { label: 'Objekt Name', type: 'text', operators: TEXT_OPS },
    },
  },
  tenants: {
    label: 'Mieter',
    table: 'tenants',
    orgPath: 'properties.organization_id',
    fields: {
      first_name: { label: 'Vorname', type: 'text', operators: TEXT_OPS },
      last_name: { label: 'Nachname', type: 'text', operators: TEXT_OPS },
      email: { label: 'E-Mail', type: 'text', operators: TEXT_OPS },
      status: { label: 'Status', type: 'enum', operators: ENUM_OPS, enumValues: ['aktiv', 'leerstand', 'beendet'] },
      mietbeginn: { label: 'Mietbeginn', type: 'date', operators: DATE_OPS },
      mietende: { label: 'Mietende', type: 'date', operators: DATE_OPS },
      grundmiete: { label: 'Grundmiete', type: 'number', operators: NUM_OPS },
      betriebskosten_vorschuss: { label: 'BK-Vorschuss', type: 'number', operators: NUM_OPS },
      'units.top_nummer': { label: 'Einheit Top-Nr.', type: 'text', operators: TEXT_OPS },
      'properties.name': { label: 'Objekt Name', type: 'text', operators: TEXT_OPS },
    },
  },
  invoices: {
    label: 'Rechnungen',
    table: 'monthly_invoices',
    orgPath: 'properties.organization_id',
    fields: {
      year: { label: 'Jahr', type: 'number', operators: NUM_OPS },
      month: { label: 'Monat', type: 'number', operators: NUM_OPS },
      gesamtbetrag: { label: 'Gesamtbetrag', type: 'number', operators: NUM_OPS },
      status: { label: 'Status', type: 'enum', operators: ENUM_OPS, enumValues: ['offen', 'bezahlt', 'teilbezahlt', 'ueberfaellig'] },
      faellig_am: { label: 'Fällig am', type: 'date', operators: DATE_OPS },
      'tenants.first_name': { label: 'Mieter Vorname', type: 'text', operators: TEXT_OPS },
      'tenants.last_name': { label: 'Mieter Nachname', type: 'text', operators: TEXT_OPS },
      'units.top_nummer': { label: 'Einheit Top-Nr.', type: 'text', operators: TEXT_OPS },
      'properties.name': { label: 'Objekt Name', type: 'text', operators: TEXT_OPS },
    },
  },
  payments: {
    label: 'Zahlungen',
    table: 'payments',
    orgPath: 'properties.organization_id',
    fields: {
      betrag: { label: 'Betrag', type: 'number', operators: NUM_OPS },
      buchungs_datum: { label: 'Buchungsdatum', type: 'date', operators: DATE_OPS },
      payment_type: { label: 'Zahlungsart', type: 'enum', operators: ENUM_OPS, enumValues: ['sepa', 'ueberweisung', 'bar', 'sonstiges'] },
      verwendungszweck: { label: 'Verwendungszweck', type: 'text', operators: TEXT_OPS },
      'tenants.first_name': { label: 'Mieter Vorname', type: 'text', operators: TEXT_OPS },
      'tenants.last_name': { label: 'Mieter Nachname', type: 'text', operators: TEXT_OPS },
      'properties.name': { label: 'Objekt Name', type: 'text', operators: TEXT_OPS },
    },
  },
};

function getJoins(entity: string): string {
  switch (entity) {
    case 'properties':
      return 'FROM properties';
    case 'units':
      return 'FROM units JOIN properties ON units.property_id = properties.id';
    case 'tenants':
      return 'FROM tenants JOIN units ON tenants.unit_id = units.id JOIN properties ON units.property_id = properties.id';
    case 'invoices':
      return 'FROM monthly_invoices LEFT JOIN tenants ON monthly_invoices.tenant_id = tenants.id JOIN units ON monthly_invoices.unit_id = units.id JOIN properties ON units.property_id = properties.id';
    case 'payments':
      return 'FROM payments JOIN tenants ON payments.tenant_id = tenants.id JOIN units ON tenants.unit_id = units.id JOIN properties ON units.property_id = properties.id';
    default:
      throw new Error(`Unknown entity: ${entity}`);
  }
}

function resolveColumn(entity: string, field: string): string | null {
  const entityDef = ENTITIES[entity];
  if (!entityDef) return null;
  if (!entityDef.fields[field]) return null;

  if (field.includes('.')) {
    return field;
  }
  return `${entityDef.table}.${field}`;
}

export function getAvailableEntities() {
  const result: Record<string, { label: string; fields: string[] }> = {};
  for (const [key, val] of Object.entries(ENTITIES)) {
    result[key] = {
      label: val.label,
      fields: Object.keys(val.fields),
    };
  }
  return result;
}

export function getFieldMetadata(entity: string) {
  const entityDef = ENTITIES[entity];
  if (!entityDef) return null;
  return entityDef.fields;
}

export async function executeQuery(orgId: string, config: QueryConfig): Promise<any[]> {
  const entityDef = ENTITIES[config.entity];
  if (!entityDef) throw new Error(`Unbekannte Entität: ${config.entity}`);

  const validFields = config.selectedFields.filter(f => entityDef.fields[f]);
  if (validFields.length === 0) throw new Error('Keine gültigen Felder ausgewählt');

  const selectCols = validFields.map(f => {
    const col = resolveColumn(config.entity, f);
    if (!col) throw new Error(`Ungültiges Feld: ${f}`);
    const alias = f.replace('.', '_');
    return `${col} AS "${alias}"`;
  });

  const fromClause = getJoins(config.entity);
  const params: any[] = [orgId];
  let paramIdx = 2;

  let whereClause = `WHERE ${entityDef.orgPath} = $1`;

  if (entityDef.table !== 'monthly_invoices') {
    whereClause += ` AND ${entityDef.table}.deleted_at IS NULL`;
  }

  if (config.filters && config.filters.length > 0) {
    for (const filter of config.filters) {
      const col = resolveColumn(config.entity, filter.field);
      if (!col) continue;

      const fieldMeta = entityDef.fields[filter.field];
      if (!fieldMeta) continue;

      const sqlOp = OPERATOR_MAP[filter.operator];
      if (!sqlOp) continue;

      if (filter.operator === 'ist leer') {
        whereClause += ` AND ${col} IS NULL`;
      } else if (filter.operator === 'ist nicht leer') {
        whereClause += ` AND ${col} IS NOT NULL`;
      } else if (filter.operator === 'enthält') {
        whereClause += ` AND ${col}::text ILIKE $${paramIdx}`;
        params.push(`%${filter.value}%`);
        paramIdx++;
      } else {
        whereClause += ` AND ${col}::text ${sqlOp} $${paramIdx}`;
        params.push(filter.value);
        paramIdx++;
      }
    }
  }

  let groupByClause = '';
  if (config.groupBy) {
    const groupCol = resolveColumn(config.entity, config.groupBy);
    if (groupCol) {
      groupByClause = `GROUP BY ${groupCol}`;
    }
  }

  let orderByClause = '';
  if (config.orderBy?.field) {
    const orderCol = resolveColumn(config.entity, config.orderBy.field);
    if (orderCol) {
      const dir = config.orderBy.direction === 'desc' ? 'DESC' : 'ASC';
      orderByClause = `ORDER BY ${orderCol} ${dir}`;
    }
  }

  const limit = Math.min(Math.max(1, config.limit || 100), 10000);

  const query = `SELECT ${selectCols.join(', ')} ${fromClause} ${whereClause} ${groupByClause} ${orderByClause} LIMIT ${limit}`;

  // Alle Abfragen laufen über die RLS-gebundene Verbindung aus dem
  // Org-Kontext — nie über den Superuser-Pool. Fehlt der Kontext, schlägt
  // die Abfrage explizit fehl statt RLS zu umgehen.
  const store = orgContext.getStore();
  if (!store?.client) {
    throw new Error("[queryBuilderService] Kein Org-Kontext — Abfrage abgelehnt");
  }
  const result = await store.client.query(query, params);
  return result.rows;
}
