import { db } from "../db";
import { properties, units, tenants } from "@shared/schema";
import { eq, and, isNull } from "drizzle-orm";
import { format } from "date-fns";
import { de } from "date-fns/locale";

interface DocumentMetadata {
  id: string;
  organizationId: string;
  name: string;
  type: 'contract' | 'invoice' | 'settlement' | 'protocol' | 'correspondence' | 'other';
  category: string;
  propertyId?: string;
  unitId?: string;
  tenantId?: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  uploadedAt: Date;
  uploadedBy: string;
  tags: string[];
  description?: string;
}

interface DocumentSearchParams {
  organizationId: string;
  propertyId?: string;
  unitId?: string;
  tenantId?: string;
  type?: DocumentMetadata['type'];
  searchTerm?: string;
  fromDate?: Date;
  toDate?: Date;
}

export class DocumentManagementService {
  private documents: Map<string, DocumentMetadata> = new Map();

  async uploadDocument(
    organizationId: string,
    metadata: Omit<DocumentMetadata, 'id' | 'uploadedAt' | 'organizationId'>
  ): Promise<DocumentMetadata> {
    const id = crypto.randomUUID();
    const doc: DocumentMetadata = {
      ...metadata,
      id,
      organizationId,
      uploadedAt: new Date(),
    };
    
    this.documents.set(id, doc);
    return doc;
  }

  async getDocuments(params: DocumentSearchParams): Promise<DocumentMetadata[]> {
    let results = Array.from(this.documents.values());
    
    results = results.filter(d => d.organizationId === params.organizationId);
    
    if (params.propertyId) {
      results = results.filter(d => d.propertyId === params.propertyId);
    }
    if (params.unitId) {
      results = results.filter(d => d.unitId === params.unitId);
    }
    if (params.tenantId) {
      results = results.filter(d => d.tenantId === params.tenantId);
    }
    if (params.type) {
      results = results.filter(d => d.type === params.type);
    }
    if (params.searchTerm) {
      const term = params.searchTerm.toLowerCase();
      results = results.filter(d => 
        d.name.toLowerCase().includes(term) ||
        d.description?.toLowerCase().includes(term) ||
        d.tags.some(t => t.toLowerCase().includes(term))
      );
    }
    if (params.fromDate) {
      results = results.filter(d => d.uploadedAt >= params.fromDate!);
    }
    if (params.toDate) {
      results = results.filter(d => d.uploadedAt <= params.toDate!);
    }
    
    return results.sort((a, b) => b.uploadedAt.getTime() - a.uploadedAt.getTime());
  }

  async deleteDocument(organizationId: string, documentId: string): Promise<boolean> {
    const doc = this.documents.get(documentId);
    if (!doc || doc.organizationId !== organizationId) {
      return false;
    }
    return this.documents.delete(documentId);
  }

  async getDocumentStats(organizationId: string): Promise<{
    totalDocuments: number;
    byType: Record<string, number>;
    totalSize: number;
    recentUploads: number;
  }> {
    const docs = Array.from(this.documents.values()).filter(d => d.organizationId === organizationId);
    const oneWeekAgo = new Date();
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
    
    const byType: Record<string, number> = {};
    let totalSize = 0;
    let recentUploads = 0;
    
    for (const doc of docs) {
      byType[doc.type] = (byType[doc.type] || 0) + 1;
      totalSize += doc.fileSize;
      if (doc.uploadedAt >= oneWeekAgo) {
        recentUploads++;
      }
    }
    
    return {
      totalDocuments: docs.length,
      byType,
      totalSize,
      recentUploads,
    };
  }

  getDocumentTypes(): Array<{ value: string; label: string }> {
    return [
      { value: 'contract', label: 'Mietvertrag' },
      { value: 'invoice', label: 'Rechnung' },
      { value: 'settlement', label: 'Abrechnung' },
      { value: 'protocol', label: 'Protokoll (Übergabe, etc.)' },
      { value: 'correspondence', label: 'Korrespondenz' },
      { value: 'other', label: 'Sonstiges' },
    ];
  }
}

export const documentManagementService = new DocumentManagementService();
