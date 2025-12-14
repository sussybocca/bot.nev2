import { supabase } from './_auth.js';

export async function handler() {
  const cutoff = new Date(Date.now() - 60 * 60 * 1000).toISOString();

  await supabase
    .from('messages')
    .delete()
    .lt('created_at', cutoff);

  return { statusCode: 200, body: 'Old messages cleared' };
}
