import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

let client: SupabaseClient | null = null;

// Use a Proxy to lazily initialize the Supabase client.
// This prevents "supabaseUrl is required" errors on application load 
// if the environment variables are not yet set.
export const supabase = new Proxy({} as SupabaseClient, {
  get(target, prop, receiver) {
    if (!client) {
      if (!supabaseUrl || !supabaseAnonKey) {
        throw new Error('Supabase credentials missing. Please set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in your secrets.');
      }
      client = createClient(supabaseUrl, supabaseAnonKey);
    }
    return Reflect.get(client, prop, receiver);
  },
});
