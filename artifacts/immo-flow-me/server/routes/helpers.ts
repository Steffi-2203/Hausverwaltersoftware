import { Request, Response, NextFunction } from "express";
import { rootDb } from "../db";
import { eq } from "drizzle-orm";
import * as schema from "@shared/schema";
import { storage } from "../storage";

export function snakeToCamel(obj: any): any {
  if (obj === null || obj === undefined) return obj;
  if (Array.isArray(obj)) return obj.map(snakeToCamel);
  if (typeof obj !== 'object') return obj;
  
  const result: any = {};
  for (const [key, value] of Object.entries(obj)) {
    const camelKey = key.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
    result[camelKey] = snakeToCamel(value);
  }
  return result;
}

export function parsePagination(req: Request) {
  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  const limit = Math.min(500, Math.max(1, parseInt(req.query.limit as string) || 100));
  const offset = (page - 1) * limit;
  return { page, limit, offset };
}

export function paginateArray<T>(items: T[], page: number, limit: number) {
  const total = items.length;
  const offset = (page - 1) * limit;
  const data = items.slice(offset, offset + limit);
  return { data, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } };
}

export function camelToSnake(str: string): string {
  return str.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
}

export function objectToSnakeCase(obj: any): any {
  if (obj === null || obj === undefined) return obj;
  if (Array.isArray(obj)) return obj.map(objectToSnakeCase);
  if (typeof obj !== 'object' || obj instanceof Date) return obj;
  const result: any = {};
  for (const [key, value] of Object.entries(obj)) {
    result[camelToSnake(key)] = objectToSnakeCase(value);
  }
  return result;
}

export function snakeToCamelKey(str: string): string {
  return str.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
}

export function objectToCamelCase(obj: any): any {
  if (obj === null || obj === undefined) return obj;
  if (Array.isArray(obj)) return obj.map(objectToCamelCase);
  if (typeof obj !== 'object' || obj instanceof Date) return obj;
  const result: any = {};
  for (const [key, value] of Object.entries(obj)) {
    result[snakeToCamelKey(key)] = objectToCamelCase(value);
  }
  return result;
}

export async function getAuthContext(req: Request, res: Response) {
  const userId = (req.session as any)?.userId;
  if (!userId) {
    res.status(401).json({ error: 'Nicht authentifiziert' });
    return null;
  }
  const profile = await rootDb.select().from(schema.profiles).where(eq(schema.profiles.id, userId)).limit(1);
  if (!profile.length) {
    res.status(403).json({ error: 'Profil nicht gefunden' });
    return null;
  }
  return { userId, orgId: profile[0].organizationId };
}

export async function checkMutationPermission(req: Request, res: Response): Promise<boolean> {
  const userId = (req.session as any)?.userId;
  if (!userId) return false;
  const userRoles = await rootDb.select().from(schema.userRoles).where(eq(schema.userRoles.userId, userId));
  const roles = userRoles.map(r => r.role);
  if (roles.includes('admin') || roles.includes('property_manager') || roles.includes('finance')) return true;
  res.status(403).json({ error: "Keine Berechtigung für diese Aktion" });
  return false;
}

// Re-export the bearer-token-aware isAuthenticated from auth.ts
// so mobile clients using Authorization: Bearer <token> are also accepted.
export { isAuthenticated } from "../auth";

export async function getUserRoles(req: any): Promise<string[]> {
  try {
    const userId = req.session?.userId;
    if (!userId) return [];
    const roles = await storage.getUserRoles(userId);
    return roles.map((r: any) => r.role);
  } catch {
    return [];
  }
}

export function requireRole(...allowedRoles: string[]) {
  return async (req: any, res: Response, next: NextFunction) => {
    const roles = await getUserRoles(req);
    if (roles.includes('admin')) return next();
    if (allowedRoles.some(r => roles.includes(r))) return next();
    return res.status(403).json({ error: "Keine Berechtigung für diese Aktion" });
  };
}

export function requireMutationAccess() {
  return async (req: any, res: Response, next: NextFunction) => {
    const roles = await getUserRoles(req);
    if (roles.includes('admin')) return next();
    if (roles.includes('viewer') || roles.includes('tester')) {
      return res.status(403).json({ error: "Nur-Lese-Zugriff: Keine Berechtigung für Änderungen" });
    }
    return next();
  };
}

export function requireFinanceAccess() {
  return async (req: any, res: Response, next: NextFunction) => {
    const roles = await getUserRoles(req);
    if (roles.includes('admin') || roles.includes('finance')) return next();
    return res.status(403).json({ error: "Keine Berechtigung für Finanzoperationen" });
  };
}

export function requireAdminAccess() {
  return async (req: any, res: Response, next: NextFunction) => {
    const roles = await getUserRoles(req);
    if (roles.includes('admin')) return next();
    return res.status(403).json({ error: "Nur Administratoren haben Zugriff" });
  };
}

export async function getProfileFromSession(req: any) {
  const userId = req.session?.userId;
  if (!userId) return null;
  return storage.getProfileById(userId);
}

export function isTester(roles: string[]): boolean {
  return roles.includes('tester');
}

export function maskPersonalData(data: any): any {
  if (!data) return data;
  
  const sensitivePatterns = [
    'firstname', 'lastname', 'first_name', 'last_name', 'vorname', 'nachname',
    'fullname', 'full_name', 'tenant_name', 'tenantname', 'owner',
    'email', 'mail', 'contact',
    'phone', 'telefon', 'mobile', 'mobil', 'handy', 'fax',
    'iban', 'bic', 'bank_account', 'bankaccount', 'account_holder', 'accountholder', 'kontoinhaber',
    'birthdate', 'birth_date', 'geburtsdatum', 'birthday',
    'address', 'adresse', 'street', 'strasse', 'postal', 'plz', 'city', 'stadt', 'ort',
    'recipient', 'empfaenger', 'absender', 'sender',
  ];
  
  const shouldMask = (key: string): boolean => {
    const lowerKey = key.toLowerCase();
    if (lowerKey === 'name' && lowerKey.length === 4) return false;
    return sensitivePatterns.some(p => lowerKey.includes(p));
  };
  
  const maskValue = (key: string, value: any): any => {
    if (typeof value !== 'string' || !value) return value;
    
    const lowerKey = key.toLowerCase();
    
    if (lowerKey.includes('email') || lowerKey.includes('mail')) return 'mieter@beispiel.at';
    if (lowerKey.includes('phone') || lowerKey.includes('telefon') || lowerKey.includes('mobil') || lowerKey.includes('handy') || lowerKey.includes('fax')) return '+43 XXX XXXXXX';
    if (lowerKey.includes('iban')) return 'AT** **** **** **** ****';
    if (lowerKey.includes('bic')) return 'XXXXATXX';
    if (lowerKey.includes('account') || lowerKey.includes('konto')) return 'Max Mustermann';
    if (lowerKey.includes('first') || lowerKey === 'vorname') return 'Max';
    if (lowerKey.includes('last') || lowerKey === 'nachname') return 'Mustermann';
    if (lowerKey.includes('name') || lowerKey.includes('tenant') || lowerKey.includes('owner') || lowerKey.includes('recipient') || lowerKey.includes('contact')) {
      return 'Max Mustermann';
    }
    if (lowerKey.includes('address') || lowerKey.includes('adresse') || lowerKey.includes('street') || lowerKey.includes('strasse')) {
      return 'Musterstraße 1';
    }
    if (lowerKey.includes('city') || lowerKey.includes('stadt') || lowerKey.includes('ort')) return 'Wien';
    if (lowerKey.includes('postal') || lowerKey.includes('plz')) return '1010';
    if (lowerKey.includes('birth') || lowerKey.includes('geburt')) return '01.01.1980';
    
    return '***';
  };
  
  if (Array.isArray(data)) {
    return data.map(item => maskPersonalData(item));
  }
  
  if (typeof data === 'object') {
    const masked: any = {};
    for (const [key, value] of Object.entries(data)) {
      if (shouldMask(key)) {
        masked[key] = maskValue(key, value);
      } else if (typeof value === 'object' && value !== null) {
        masked[key] = maskPersonalData(value);
      } else {
        masked[key] = value;
      }
    }
    return masked;
  }
  
  return data;
}
