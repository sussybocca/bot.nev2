// netlify/functions/getEmails.js
import { createClient } from '@supabase/supabase-js';
import cookie from 'cookie';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

export const handler = async (event) => {
  try {
    // 🍪 Parse cookies
    const cookies = cookie.parse(event.headers.cookie || '');
    
    // ⚠️ Use the actual cookie name your site sets (e.g., ion_token)
    const session_token = cookies.ion_token; 

    if (!session_token) {
      return {
        statusCode: 401,
        body: JSON.stringify({ success: false, error: 'Not authenticated: missing session token' })
      };
    }

    // 🔐 Verify session
    const { data: sessionData, error: sessionError } = await supabase
      .from('sessions')
      .select('user_email')
      .eq('session_token', session_token)
      .single();

    if (sessionError || !sessionData) {
      return {
        statusCode: 403,
        body: JSON.stringify({ success: false, error: 'Invalid or expired session' })
      };
    }

    const user_email = sessionData.user_email;

    // 📥 Fetch inbox emails for this user
    const { data: emails, error: emailsError } = await supabase
      .from('emails')
      .select('*')
      .eq('to_user', user_email)
      .order('created_at', { ascending: false });

    if (emailsError) throw emailsError;

    return {
      statusCode: 200,
      body: JSON.stringify({ success: true, emails })
    };

  } catch (err) {
    console.error('getEmails error:', err);
    return {
      statusCode: 500,
      body: JSON.stringify({ success: false, error: 'Internal server error', details: err.message })
    };
  }
};
