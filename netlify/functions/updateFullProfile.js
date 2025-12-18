import { createClient } from '@supabase/supabase-js';
import bcrypt from 'bcrypt';
import cookie from 'cookie';

// Initialize Supabase with service role key for secure backend updates
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export const handler = async (event) => {
  try {
    if (event.httpMethod !== "POST") {
      return { statusCode: 405, body: JSON.stringify({ success: false, error: "Method not allowed" }) };
    }

    // Parse cookies
    const cookies = cookie.parse(event.headers.cookie || '');
    const session_token =
      cookies['__Host-session_secure'] || // new login
      cookies['session_token'];            // legacy login

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

    // Parse updates safely
    const { updates } = JSON.parse(event.body || '{}');
    if (!updates || typeof updates !== 'object') {
      return { statusCode: 400, body: JSON.stringify({ success: false, error: "Invalid updates" }) };
    }

    // Fetch user by session email
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('*')
      .eq('email', session.user_email)
      .maybeSingle();

    if (userError) throw userError;
    if (!user) return { statusCode: 404, body: JSON.stringify({ success: false, error: "User not found" }) };

    const updateData = {};
    const allowedFields = ['username','display_name','bio','profile_picture','password'];

    for (const field of allowedFields) {
      if (updates[field]) updateData[field] = updates[field];
    }

    // Handle password securely
    if (updateData.password) {
      const isSame = await bcrypt.compare(updateData.password, user.password);
      if (!isSame) {
        updateData.password = await bcrypt.hash(updateData.password, 12);
      } else {
        delete updateData.password;
      }
    }

    // Update user
    const { data: updatedUser, error: updateError } = await supabase
      .from('users')
      .update(updateData)
      .eq('email', session.user_email)
      .select()
      .maybeSingle();

    if (updateError) throw updateError;

    const safeUser = { ...updatedUser };
    delete safeUser.password;

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        message: "Profile updated successfully!",
        user: safeUser
      })
    };

  } catch (err) {
    console.error('Profile update error:', err);
    return {
      statusCode: 500,
      body: JSON.stringify({ success: false, error: "Failed to update profile", details: err.message })
    };
  }
};
