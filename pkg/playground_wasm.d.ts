/* tslint:disable */
/* eslint-disable */

/**
 * Type check user source with cached stdlib.
 */
export function check(source: string): string;

/**
 * Convert .celc binary to human-readable text.
 */
export function dump_celc(cache_bytes: Uint8Array): string;

/**
 * Initialize stdlib. Call once on page load.
 * Returns number of stdlib definitions.
 */
export function init_stdlib(): number;

/**
 * Type check + NbE eval + IO execute.
 * Uses NbE + io_runtime (not bytecode VM) — correct and fast.
 */
export function run(source: string): string;

/**
 * Set panic hook for better WASM error messages.
 */
export function start(): void;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly check: (a: number, b: number) => [number, number];
    readonly dump_celc: (a: number, b: number) => [number, number];
    readonly init_stdlib: () => number;
    readonly run: (a: number, b: number) => [number, number];
    readonly start: () => void;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
