import { createClient } from '@supabase/supabase-js';
import cookie from 'cookie';
import crypto from 'crypto';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// Generate device fingerprint like in login.js
function getDeviceFingerprint(headers, frontendFingerprint) {
  const source =
    frontendFingerprint ||
    headers['user-agent'] +
    headers['accept-language'] +
    (headers['x-forwarded-for'] || '');
  return crypto.createHash('sha256').update(source).digest('hex');
}

export const handler = async (event) => {
  try {
    // 🍪 Parse cookies
    const cookies = cookie.parse(event.headers.cookie || '');
    const rawToken = cookies['__Host-session_secure'];
    if (!rawToken || typeof rawToken !== 'string') {
      return { statusCode: 401, body: JSON.stringify({ success: false, error: 'Not authenticated' }) };
    }

    // ✅ Lookup session using raw token (no decryption)
    const { data: sessionData, error: sessionError } = await supabase
      .from('sessions')
      .select('user_email, expires_at, fingerprint')
      .eq('session_token', rawToken)
      .single();

    if (sessionError || !sessionData) {
      return { statusCode: 403, body: JSON.stringify({ success: false, error: 'Invalid or expired session' }) };
    }

    // Check expiration
    if (new Date(sessionData.expires_at) < new Date()) {
      return { statusCode: 403, body: JSON.stringify({ success: false, error: 'Session expired' }) };
    }

    // Verify device fingerprint
    const currentFingerprint = getDeviceFingerprint(event.headers);
    if (sessionData.fingerprint && sessionData.fingerprint !== currentFingerprint) {
      return { statusCode: 403, body: JSON.stringify({ success: false, error: 'Session invalid for this device' }) };
    }

    const user_email = sessionData.user_email;

    // Fetch emails (without broken foreign key)
    const { data: emails, error: emailsError } = await supabase
      .from('emails')
      .select('*')
      .eq('to_user', user_email)
      .order('created_at', { ascending: false });

    if (emailsError) throw emailsError;

    // Fetch sender info manually
    const mappedEmails = await Promise.all(emails.map(async (e) => {
      let sender = { email: e.from_user, username: e.from_user, avatar_url: null, last_online: null };
      if (e.from_user) {
        const { data: senderData } = await supabase
          .from('users')
          .select('username, email, avatar_url, last_online')
          .eq('email', e.from_user)
          .maybeSingle();
        if (senderData) sender = senderData;
      }

      const lastOnline = new Date(sender.last_online || 0);
      const senderOnline = Date.now() - lastOnline.getTime() < 5 * 60 * 1000;

      return {
        id: e.id,
        subject: e.subject,
        body: e.body,
        created_at: e.created_at,
        from: {
          email: sender.email || 'Unknown',
          username: sender.username || sender.email || 'Unknown',
          avatar_url:
            sender.avatar_url ||
            `https://avatars.dicebear.com/api/initials/${encodeURIComponent(sender.username || sender.email || 'user')}.svg`,
          online: senderOnline,
        },
      };
    }));

    return { statusCode: 200, body: JSON.stringify({ success: true, emails: mappedEmails }) };
  } catch (err) {
    console.error('getEmails error:', err);
    return { statusCode: 500, body: JSON.stringify({ success: false, error: 'Internal server error', details: err.message }) };
  }
};
