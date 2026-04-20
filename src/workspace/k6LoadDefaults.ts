import type { Collection } from '../models/types'

/** Defaults for collection k6 load controls; keep in sync with workspace top bar fallbacks. */
export const DEFAULT_K6_LOAD_VUS = 5
export const DEFAULT_K6_LOAD_DURATION = '1m'
export const DEFAULT_K6_LOAD_RAMP_UP = '30s'

export type ResolvedK6LoadFields = {
  k6LoadVus: number
  k6LoadDuration: string
  k6LoadRampUp: string
}

export const DEFAULT_K6_LOAD_FIELDS: ResolvedK6LoadFields = {
  k6LoadVus: DEFAULT_K6_LOAD_VUS,
  k6LoadDuration: DEFAULT_K6_LOAD_DURATION,
  k6LoadRampUp: DEFAULT_K6_LOAD_RAMP_UP,
}

export function ensureCollectionK6LoadFields(
  c: Pick<Collection, 'k6LoadVus' | 'k6LoadDuration' | 'k6LoadRampUp'>,
): ResolvedK6LoadFields {
  return {
    k6LoadVus: typeof c.k6LoadVus === 'number' && Number.isFinite(c.k6LoadVus) ? c.k6LoadVus : DEFAULT_K6_LOAD_VUS,
    k6LoadDuration:
      typeof c.k6LoadDuration === 'string' && c.k6LoadDuration.trim() ? c.k6LoadDuration : DEFAULT_K6_LOAD_DURATION,
    k6LoadRampUp:
      typeof c.k6LoadRampUp === 'string' && c.k6LoadRampUp.trim() ? c.k6LoadRampUp : DEFAULT_K6_LOAD_RAMP_UP,
  }
}
