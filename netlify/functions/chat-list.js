import { createClient } from '@supabase/supabase-js';
import cookie from 'cookie';

// Use service role key for secure backend operations
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export async function handler(event) {
  try {
    // Read session token from cookie
    const cookies = cookie.parse(event.headers.cookie || '');
    const session_token = cookies.session_token;

    if (!session_token) {
      return {
        statusCode: 400,
        body: JSON.stringify({ success: false, error: 'Missing session cookie' })
      };
    }

    // Look up user by session token
    const { data: sessionData, error: sessionError } = await supabase
      .from('sessions')
      .select('user_email')
      .eq('session_token', session_token)
      .single();

    if (sessionError || !sessionData) {
      return { statusCode: 401, body: JSON.stringify({ success: false, error: 'Invalid session token' }) };
    }

    // Get user ID
    const { data: userData, error: userError } = await supabase
      .from('users')
      .select('id')
      .eq('email', sessionData.user_email)
      .single();

    if (userError || !userData) {
      return { statusCode: 404, body: JSON.stringify({ success: false, error: 'User not found' }) };
    }

    const user_id = userData.id;

    // Fetch chats where user is a member
    const { data: memberships, error: chatError } = await supabase
      .from('conversation_members')
      .select(`conversation_id, conversations(id, title, is_group)`)
      .eq('user_id', user_id);

    if (chatError) {
      console.error('Supabase error:', chatError);
      return { statusCode: 500, body: JSON.stringify({ success: false, error: 'Failed to fetch chats' }) };
    }

    // Map the response to frontend-friendly format
    const chats = memberships.map(m => ({
      id: m.conversation_id,
      title: m.conversations?.title || 'Private Chat',
      is_group: m.conversations?.is_group || false
    }));

    return { statusCode: 200, body: JSON.stringify({ success: true, chats }) };

  } catch (err) {
    console.error('Unexpected error:', err);
    return { statusCode: 500, body: JSON.stringify({ success: false, error: 'Internal server error' }) };
  }
}
