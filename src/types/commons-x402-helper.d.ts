// Ambient shim so `tsc` compiles locally without the real package resolved
// (it lives on Commonsmade's private registry, only available in their
// build/deploy pipeline — see .npmrc note in README). Remove this file
// once `npm install` can actually resolve the real package and its own
// types take over.
declare module "@commons/x402-helper" {
  export function x402Fetch(path: string, init?: RequestInit): Promise<Response>;
}
