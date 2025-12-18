import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

export const handler = async (event) => {
  try {
    const { session_token } = JSON.parse(event.body || '{}');
    if (!session_token) {
      return { statusCode: 400, body: JSON.stringify({ success: false, error: 'Missing session token' }) };
    }

    // 🔐 Verify session and get user email
    const { data: sessionData } = await supabase
      .from('sessions')
      .select('*')
      .eq('session_token', session_token)
      .single();

    if (!sessionData) {
      return { statusCode: 403, body: JSON.stringify({ success: false, error: 'Invalid session' }) };
    }

    const user_email = sessionData.user_email;

    // ✅ Fetch all emails to this user
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
    return { statusCode: 500, body: JSON.stringify({ success: false, error: 'Internal server error' }) };
  }
};
