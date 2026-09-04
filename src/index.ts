import { DurableObject } from 'cloudflare:workers';
import { handleProductRequest } from './product';
import {
  handleLogin,
  handleCallback,
  handleLogout,
  getSessionUser,
} from './auth';
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
    const url = new URL(request.url);
    const sql = createProductSql(this.ctx.storage.sql);
    const env = this.env as any;

    if (url.pathname.startsWith('/auth/')) {
      if (url.pathname === '/auth/login') return handleLogin(request, env);
      if (url.pathname === '/auth/callback') return handleCallback(request, env, sql);
      if (url.pathname === '/auth/logout') return handleLogout(request, sql);
      return new Response('Not found', { status: 404 });
    }

    const user = getSessionUser(request, sql);
    if (url.pathname === '/api/me') {
      return new Response(JSON.stringify(user ? { sub: user.sub, name: user.name } : null), {
        headers: { 'content-type': 'application/json' },
      });
    }

    const response = await handleProductRequest(request, {
      env: this.env,
      sql,
      user,
    });
    return response ?? new Response('Not found', { status: 404 });
  }
}
