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

// Decrypt session token (AES-GCM) like login.js
function decryptSessionToken(encryptedToken) {
  try {
    const [ivHex, tagHex, encryptedHex] = encryptedToken.split(':');
    const iv = Buffer.from(ivHex, 'hex');
    const tag = Buffer.from(tagHex, 'hex');
    const encrypted = Buffer.from(encryptedHex, 'hex');
    const key = crypto.scryptSync(process.env.SESSION_SECRET, 'salt', 32);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv, { authTagLength: 16 });
    decipher.setAuthTag(tag);
    const decrypted = decipher.update(encrypted, 'hex', 'utf8') + decipher.final('utf8');
    return decrypted;
  } catch {
    return null;
  }
}

export const handler = async (event) => {
  try {
    // 🍪 Parse cookies
    const cookies = cookie.parse(event.headers.cookie || '');
    const rawToken = cookies['__Host-session_secure'];
    if (!rawToken || typeof rawToken !== 'string') {
      return { statusCode: 401, body: JSON.stringify({ success: false, error: 'Not authenticated' }) };
    }

    // Decrypt session token
    const sessionId = decryptSessionToken(rawToken);
    if (!sessionId) {
      return { statusCode: 403, body: JSON.stringify({ success: false, error: 'Invalid session token' }) };
    }

    // Lookup session in Supabase
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

    // Fetch emails with sender info
    const { data: emails, error: emailsError } = await supabase
      .from('emails')
      .select(`
        id,
        subject,
        from_user,
        body,
        created_at,
        from_user:users!emails_from_user_fkey (
          username,
          email,
          avatar_url,
          last_online
        )
      `)
      .eq('to_user', user_email)
      .order('created_at', { ascending: false });

    if (emailsError) throw emailsError;

    const mappedEmails = emails.map((e) => {
      const sender = e.from_user || {};
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
          avatar_url: sender.avatar_url || `https://avatars.dicebear.com/api/initials/${encodeURIComponent(sender.username || sender.email || 'user')}.svg`,
          online: senderOnline,
        },
      };
    });

    return { statusCode: 200, body: JSON.stringify({ success: true, emails: mappedEmails }) };
  } catch (err) {
    console.error('getEmails error:', err);
    return { statusCode: 500, body: JSON.stringify({ success: false, error: 'Internal server error', details: err.message }) };
  }
};
