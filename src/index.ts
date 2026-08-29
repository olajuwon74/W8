import { DurableObject } from 'cloudflare:workers';
import { handleProductRequest } from './product';
import type { ProductEnv, ProductSql } from './runtime';

function createProductSql(sql: SqlStorage): ProductSql {
  return {
    exec: <T extends Record<string, SqlStorageValue>>(query: string, ...bindings: any[]) =>
      sql.exec<T>(query, ...bindings),
    all: <T extends Record<string, SqlStorageValue>>(query: string, ...bindings: any[]) =>
      sql.exec<T>(query, ...bindings).toArray(),
    first: <T extends Record<string, SqlStorageValue>>(query: string, ...bindings: any[]) =>
      sql.exec<T>(query, ...bindings).toArray()[0] ?? null,
    run: (query: string, ...bindings: any[]) => {
      const cursor = sql.exec(query, ...bindings);
      return { rowsWritten: cursor.rowsWritten };
    },
  };
}

export class App extends DurableObject<ProductEnv> {
  async fetch(request: Request): Promise<Response> {
    const user = null;
    const response = await handleProductRequest(request, {
      env: this.env,
      sql: createProductSql(this.ctx.storage.sql),
      user,
    });
    return response ?? new Response('Not found', { status: 404 });
  }
}
