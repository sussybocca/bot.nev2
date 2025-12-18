import { createClient } from '@supabase/supabase-js';
import cookie from 'cookie';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

export const handler = async (event) => {
  try {
    // 🍪 Read session_token from HttpOnly cookie
    const cookies = cookie.parse(event.headers.cookie || '');
    const session_token = cookies.session_token;

    if (!session_token) {
      return {
        statusCode: 401,
        body: JSON.stringify({ success: false, error: 'Not authenticated' })
      };
    }

    // 🔐 Verify session
    const { data: sessionData } = await supabase
      .from('sessions')
      .select('user_email')
      .eq('session_token', session_token)
      .single();

    if (!sessionData) {
      return {
        statusCode: 403,
        body: JSON.stringify({ success: false, error: 'Invalid session' })
      };
    }

    const user_email = sessionData.user_email;

    // 📥 Fetch inbox emails
    const { data: emails, error } = await supabase
      .from('emails')
      .select('*')
      .eq('to_user', user_email)
      .order('created_at', { ascending: false });

    if (error) throw error;

    return {
      statusCode: 200,
      body: JSON.stringify({ success: true, emails })
    };

  } catch (err) {
    console.error('getEmails error:', err);
    return {
      statusCode: 500,
      body: JSON.stringify({ success: false, error: 'Internal server error' })
    };
  }
};
