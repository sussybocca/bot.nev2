import { createClient } from '@supabase/supabase-js';

// Supabase service role key from environment variables
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export async function handler(event) {
  try {
    const session_token = event.queryStringParameters?.session_token;
    if (!session_token) {
      return { statusCode: 400, body: 'Missing session_token parameter' };
    }

    // Look up user by session token
    const { data: sessionData, error: sessionError } = await supabase
      .from('sessions')
      .select('user_email')
      .eq('session_token', session_token)
      .single();

    if (sessionError || !sessionData) {
      return { statusCode: 401, body: 'Invalid session token' };
    }

    // Get user ID from users table
    const { data: userData, error: userError } = await supabase
      .from('users')
      .select('id')
      .eq('email', sessionData.user_email)
      .single();

    if (userError || !userData) {
      return { statusCode: 404, body: 'User not found' };
    }

    const user_id = userData.id;

    // Fetch chats
    const { data, error } = await supabase
      .from('conversation_members')
      .select(`
        conversation_id,
        conversations ( id, title, is_group )
      `)
      .eq('user_id', user_id);

    if (error) {
      console.error('Supabase error:', error);
      return { statusCode: 500, body: JSON.stringify(error) };
    }

    return { statusCode: 200, body: JSON.stringify(data || []) };

  } catch (err) {
    console.error('Unexpected error:', err);
    return { statusCode: 500, body: 'Internal server error' };
  }
}
