import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export async function handler(event) {
  try {
    const { conversation_id, message, user_id } = JSON.parse(event.body);

    if (!conversation_id || !message || !user_id) {
      return { statusCode: 400, body: 'Missing fields' };
    }

    const { error } = await supabase
      .from('messages')
      .insert([{ conversation_id, sender_id: user_id, content: message }]);

    if (error) throw error;

    return { statusCode: 200, body: JSON.stringify({ success: true }) };
  } catch (err) {
    return { statusCode: 500, body: err.message };
  }
}
