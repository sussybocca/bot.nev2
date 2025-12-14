import { createClient } from '@supabase/supabase-js';

export const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export async function verifySession(session_token) {
  const { data, error } = await supabase
    .from('sessions')
    .select('user_id')
    .eq('token', session_token)
    .single();

  if (error || !data) throw new Error('Invalid session');
  return data.user_id;
}
