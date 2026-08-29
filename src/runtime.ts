export interface ProductEnv {
  COMMONS_RPC_API_URL?: string;
  COMMONS_RPC_API_KEY?: string;
  COMMONS_PAYMENTS_API_URL?: string;
  COMMONS_PAYMENTS_API_KEY?: string;
  COMMONS_OIDC_ISSUER?: string;
  COMMONS_OIDC_CLIENT_ID?: string;
  COMMONS_OIDC_CLIENT_SECRET?: string;
  COMMONS_X402_API_URL?: string;
  COMMONS_X402_API_KEY?: string;
}

export interface ProductContext {
  env: ProductEnv;
  sql: ProductSql;
  user: ProductUser | null;
}

export interface ProductSql {
  exec<T extends Record<string, SqlStorageValue> = Record<string, SqlStorageValue>>(
    query: string,
    ...bindings: any[]
  ): SqlStorageCursor<T>;
  all<T extends Record<string, SqlStorageValue> = Record<string, SqlStorageValue>>(
    query: string,
    ...bindings: any[]
  ): T[];
  first<T extends Record<string, SqlStorageValue> = Record<string, SqlStorageValue>>(
    query: string,
    ...bindings: any[]
  ): T | null;
  run(query: string, ...bindings: any[]): { rowsWritten: number };
}

export interface ProductUser {
  sub: string;
  id: string;
  name: string | null;
  displayName: string | null;
  email: string | null;
  x_handle: string | null;
  github_handle: string | null;
}

export type ProductHandler = (
  request: Request,
  context: ProductContext
) => Promise<Response | null> | Response | null;
