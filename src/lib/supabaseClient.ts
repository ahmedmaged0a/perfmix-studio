import { createClient, type SupabaseClient } from '@supabase/supabase-js'

let client: SupabaseClient | null | undefined

function readEnv(): { url: string; key: string } | null {
  const url = import.meta.env.VITE_SUPABASE_URL?.trim()
  const key =
    import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim() ||
    import.meta.env.VITE_SUPABASE_ANON_KEY?.trim()
  if (!url || !key) return null
  return { url, key }
}

/** Singleton browser client; returns null when env is missing (e.g. misconfigured build). */
export function getSupabase(): SupabaseClient | null {
  if (client === undefined) {
    const env = readEnv()
    client = env ? createClient(env.url, env.key) : null
  }
  return client
}

export function isSupabaseConfigured(): boolean {
  return readEnv() != null
}
