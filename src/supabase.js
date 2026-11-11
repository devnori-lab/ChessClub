// Supabase client. The URL and anon key are public by design — every
// permission is enforced by Row Level Security in the database (see
// supabase/migrations). Never put the service_role key in the frontend.
import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const isConfigured = Boolean(url && anonKey);

if (!isConfigured) {
  console.error('[supabase] VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY are missing — check .env locally or the repo secrets in CI.');
}

export const supabase = isConfigured
  ? createClient(url, anonKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } })
  : null;
