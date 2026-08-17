import { sql } from "drizzle-orm";
import { db } from "../db";

export type UpdateFn<T> = (tx: any, currentRow: T) => Promise<{ updatedFields: Record<string, any> }>;

export async function optimisticUpdate<T = any>(params: {
  tableName: string;
  id: string;
  selectSql: string;
  updateSqlBuilder: (newValues: Record<string, any>, oldVersion: number) => { sql: string; params?: any[] };
  maxRetries?: number;
  delayMs?: number;
  tx?: any;
}): Promise<{ success: boolean; attempts: number; updatedRow?: T }> {
  const {
    tableName,
    id,
    selectSql,
    updateSqlBuilder,
    maxRetries = 3,
    delayMs = 50,
    tx
  } = params;

  let attempts = 0;
  const runInExternalTx = !!tx;

  while (attempts < maxRetries) {
    attempts += 1;

    if (runInExternalTx) {
      const res = await tx.execute(sql`${sql.raw(selectSql)}`);
      const row = res.rows[0];
      if (!row) return { success: false, attempts };

      const oldVersion = Number(row.version || 1);
      const { sql: updateSql } = updateSqlBuilder({}, oldVersion);

      const updateRes = await tx.execute(sql.raw(updateSql));
      if (updateRes.rowCount && updateRes.rowCount > 0) {
        const newRes = await tx.execute(sql`${sql.raw(selectSql)}`);
        return { success: true, attempts, updatedRow: newRes.rows[0] };
      }

      await new Promise(r => setTimeout(r, delayMs));
      continue;
    } else {
      const result = await db.transaction(async (txLocal) => {
        const res = await txLocal.execute(sql`${sql.raw(selectSql)}`);
        const row = res.rows[0];
        if (!row) return { ok: false, row: null };

        const oldVersion = Number(row.version || 1);
        const { sql: updateSql } = updateSqlBuilder({}, oldVersion);

        const updateRes = await txLocal.execute(sql.raw(updateSql));
        if (updateRes.rowCount && updateRes.rowCount > 0) {
          const newRes = await txLocal.execute(sql`${sql.raw(selectSql)}`);
          return { ok: true, row: newRes.rows[0] };
        }
        return { ok: false, row: null };
      });

      if (result.ok) return { success: true, attempts, updatedRow: result.row as T };
      await new Promise(r => setTimeout(r, delayMs));
    }
  }

  return { success: false, attempts };
}
