import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export async function handler(event) {
  const conversation_id = event.queryStringParameters.id;

  const { data, error } = await supabase
    .from('messages')
    .select('content, created_at, sender_id')
    .eq('conversation_id', conversation_id)
    .order('created_at');

  if (error) {
    return { statusCode: 500, body: error.message };
  }

  return { statusCode: 200, body: JSON.stringify(data) };
}
