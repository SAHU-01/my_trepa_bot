import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// Server-side admin client — uses service role key to bypass RLS.
// NEVER expose this key to the browser.
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
export const supabaseAdmin = supabaseServiceKey
  ? createClient(supabaseUrl, supabaseServiceKey)
  : supabase;

/**
 * PRODUCTION AUDIT LOGGING
 * 
 * This function handles storing API metadata, execution times, and errors.
 */
export async function logAudit(event: {
  event_type: 'API_CALL' | 'TRADE_EXECUTION' | 'ERROR';
  method: string;
  endpoint: string;
  status?: number;
  payload?: any;
  response?: any;
  duration_ms?: number;
}) {
  try {
    const { error } = await supabase.from('audit_logs').insert([
      {
        ...event,
        timestamp: new Date().toISOString(),
      },
    ]);
    if (error) console.error('Failed to save audit log:', error);
  } catch (e) {
    console.error('Error in logAudit:', e);
  }
}
