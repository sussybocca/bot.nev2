import { createClient } from '@supabase/supabase-js';
import cookie from 'cookie';

// Use the service role key for secure backend access
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

export const handler = async (event) => {
  try {
    if (event.httpMethod !== "POST") {
      return { statusCode: 405, body: JSON.stringify({ success: false, error: "Method not allowed" }) };
    }

    // Read session token from cookie
    const cookies = cookie.parse(event.headers.cookie || '');
    const session_token = cookies.session_token;

    if (!session_token) {
      return { statusCode: 403, body: JSON.stringify({ success: false, error: "No session cookie found" }) };
    }

    // Verify session
    const { data: session, error: sessionError } = await supabase
      .from('sessions')
      .select('user_email, expires_at')
      .eq('session_token', session_token)
      .maybeSingle();

    if (sessionError || !session) {
      return { statusCode: 403, body: JSON.stringify({ success: false, error: "Invalid session" }) };
    }

    if (new Date(session.expires_at) < new Date()) {
      return { statusCode: 403, body: JSON.stringify({ success: false, error: "Session expired" }) };
    }

    // Fetch user by session email
    const { data: user, error } = await supabase
      .from('users')
      .select('*')
      .eq('email', session.user_email)
      .maybeSingle();

    if (error) throw error;
    if (!user) return { statusCode: 404, body: JSON.stringify({ success: false, error: "User not found" }) };

    // Remove sensitive fields before returning
    const safeUser = { ...user };
    delete safeUser.password;

    return { statusCode: 200, body: JSON.stringify({ success: true, user: safeUser }) };

  } catch (err) {
    console.error('getUser error:', err);
    return { statusCode: 500, body: JSON.stringify({ success: false, error: "Failed to fetch user", details: err.message }) };
  }
};
