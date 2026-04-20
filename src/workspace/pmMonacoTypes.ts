/**
 * Ambient typings for Monaco JavaScript language service (extra lib).
 * Keep in sync with `basePm` in workspaceHttpPipeline.ts.
 */

import type * as Monaco from 'monaco-editor'

const PM_RESPONSE = `
interface PmResponse {
  readonly code: number;
  readonly status: number;
  readonly reason: string;
  readonly headers: { get(name: string): string | null };
  text(): string;
  json(): unknown;
}
`.trim()

const PM_REQUEST = `
interface PmRequestHeaders {
  upsert(key: string, value: string): void;
  add(obj: { key: string; value: string }): void;
  remove(key: string): void;
}
interface PmRequestShape {
  url: string;
  method: string;
  body: string;
  readonly headers: PmRequestHeaders;
}
`.trim()

/** Pre-request: no \`pm.response\`. */
export const PM_PRE_LIB = `
${PM_RESPONSE}
${PM_REQUEST}
declare const pm: {
  readonly request: PmRequestShape;
  readonly collectionVariables: { get(key: string): string | undefined; set(key: string, value: string): void };
  readonly environment: { get(key: string): string | undefined; set(key: string, value: string): void };
  readonly variables: { get(key: string): string | undefined; set(key: string, value: string): void };
  sendRequest(
    urlOrOpts: string | { url: string; method?: string; headers?: Record<string, string>; body?: string | null },
    callback?: (err: Error | null, res: PmResponse | null) => void,
  ): void;
  test(name: string, fn: () => void): void;
};
`.trim()

/** Post-request: includes \`pm.response\`. */
export const PM_POST_LIB = `
${PM_RESPONSE}
${PM_REQUEST}
declare const pm: {
  readonly request: PmRequestShape;
  readonly collectionVariables: { get(key: string): string | undefined; set(key: string, value: string): void };
  readonly environment: { get(key: string): string | undefined; set(key: string, value: string): void };
  readonly variables: { get(key: string): string | undefined; set(key: string, value: string): void };
  sendRequest(
    urlOrOpts: string | { url: string; method?: string; headers?: Record<string, string>; body?: string | null },
    callback?: (err: Error | null, res: PmResponse | null) => void,
  ): void;
  test(name: string, fn: () => void): void;
  readonly response: PmResponse;
};
`.trim()

let pmLibDisposable: Monaco.IDisposable | null = null
let activeLibPhase: 'pre' | 'post' | null = null

/** Swap the in-memory \`pm\` declaration so pre-request omits \`response\` from typings. */
export function ensurePmScriptLib(monaco: typeof import('monaco-editor'), phase: 'pre' | 'post'): void {
  if (activeLibPhase === phase && pmLibDisposable) return
  pmLibDisposable?.dispose()
  pmLibDisposable = monaco.languages.typescript.javascriptDefaults.addExtraLib(
    phase === 'pre' ? PM_PRE_LIB : PM_POST_LIB,
    'inmemory://perfmix/pm.d.ts',
  )
  activeLibPhase = phase
}

export function disposePmScriptLib(): void {
  pmLibDisposable?.dispose()
  pmLibDisposable = null
  activeLibPhase = null
}

/** Registers the default (pre-request) lib; editors call \`ensurePmScriptLib\` when mounted. */
export function registerPmScriptMonacoLibs(monaco: typeof import('monaco-editor')): void {
  ensurePmScriptLib(monaco, 'pre')
}
