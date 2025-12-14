import { supabase, verifySession } from './_auth.js';

export async function handler(event) {
  const { session_token, conversation_id, user_id } = JSON.parse(event.body);
  const admin_id = await verifySession(session_token);

  // Check if the requester is an admin
  const { data } = await supabase
    .from('conversation_members')
    .select('role')
    .eq('conversation_id', conversation_id)
    .eq('user_id', admin_id)
    .single();

  if (data?.role !== 'admin') {
    return { statusCode: 403, body: 'Admin only' };
  }

  // Remove user from conversation
  await supabase
    .from('conversation_members')
    .delete()
    .eq('conversation_id', conversation_id)
    .eq('user_id', user_id);

  // Log the kick
  await supabase
    .from('kicked_users')
    .insert({
      user_id,
      conversation_id,
      kicked_by: admin_id
    });

  return { statusCode: 200, body: 'User kicked successfully' };
}
