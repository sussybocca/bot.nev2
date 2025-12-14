import { supabase, verifySession } from './_auth.js';

export async function handler(event) {
  const { session_token, conversation_id, bot_name, bot_description } = JSON.parse(event.body);
  const user_id = await verifySession(session_token);

  if (!conversation_id || !bot_name) {
    return { statusCode: 400, body: 'Conversation ID and bot name required' };
  }

  const { error } = await supabase
    .from('chat_bots')
    .insert([{ conversation_id, user_id, bot_name, bot_description }]);

  if (error) {
    return { statusCode: 500, body: error.message };
  }

  return { statusCode: 200, body: 'Bot added to chat' };
}
