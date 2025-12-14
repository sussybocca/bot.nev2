import { createClient } from '@supabase/supabase-js';

// Use Supabase service role key from Netlify environment variables
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export async function handler(event) {
  try {
    const user_id = event.queryStringParameters?.user_id;

    if (!user_id) {
      return { statusCode: 400, body: 'Missing user_id parameter' };
    }

    const { data, error } = await supabase
      .from('conversation_members')
      .select(`
        conversation_id,
        conversations ( title, is_group )
      `)
      .eq('user_id', user_id);

    if (error) {
      console.error('Supabase error:', error);
      return { statusCode: 500, body: JSON.stringify(error) };
    }

    // Return empty array if no chats found
    return { statusCode: 200, body: JSON.stringify(data || []) };
  } catch (err) {
    console.error('Unexpected error:', err);
    return { statusCode: 500, body: 'Internal server error' };
  }
}
