import { supabase, verifySession } from './_auth.js';

export async function handler(event) {
  const { session_token, conversation_id, title } = JSON.parse(event.body);
  const user_id = await verifySession(session_token);

  const { data } = await supabase
    .from('conversation_members')
    .select('role')
    .eq('conversation_id', conversation_id)
    .eq('user_id', user_id)
    .single();

  if (data.role !== 'admin') {
    return { statusCode: 403, body: 'Admin only' };
  }

  await supabase
    .from('conversations')
    .update({ title })
    .eq('id', conversation_id);

  return { statusCode: 200, body: 'Renamed' };
}
