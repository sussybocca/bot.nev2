import { createClient } from '@supabase/supabase-js';
import cookie from 'cookie';
import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

// Decrypt AES-GCM session token
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
  } catch (e) {
    return null;
  }
}

// Generate device fingerprint like login
function getDeviceFingerprint(headers, frontendFingerprint) {
  const source = frontendFingerprint || headers['user-agent'] + headers['accept-language'] + (headers['x-forwarded-for'] || '') + uuidv4();
  return crypto.createHash('sha256').update(source).digest('hex');
}

export const handler = async (event) => {
  try {
    // 🍪 Parse cookies safely
    const cookies = cookie.parse(event.headers.cookie || '');
    const rawToken = cookies['__Host-session_secure'] || cookies['session_token'];

    if (!rawToken || typeof rawToken !== 'string') {
      return { statusCode: 401, body: JSON.stringify({ success: false, error: 'Not authenticated: missing or invalid session token' }) };
    }

    // Decrypt token
    const session_token = decryptSessionToken(rawToken);
    if (!session_token) {
      return { statusCode: 403, body: JSON.stringify({ success: false, error: 'Invalid session token' }) };
    }

    // Verify session in DB
    const { data: sessionData, error: sessionError } = await supabase
      .from('sessions')
      .select('user_email, expires_at, fingerprint')
      .eq('session_token', rawToken) // store raw cookie in DB like login
      .single();

    if (sessionError || !sessionData) {
      return { statusCode: 403, body: JSON.stringify({ success: false, error: 'Invalid or expired session' }) };
    }

    // Check expiration
    if (new Date(sessionData.expires_at) < new Date()) {
      return { statusCode: 403, body: JSON.stringify({ success: false, error: 'Session expired' }) };
    }

    // Device fingerprint check
    const currentFingerprint = getDeviceFingerprint(event.headers);
    if (sessionData.fingerprint && sessionData.fingerprint !== currentFingerprint) {
      return { statusCode: 403, body: JSON.stringify({ success: false, error: 'Session invalid for this device' }) };
    }

    const user_email = sessionData.user_email;

    // Fetch emails
    const { data: emails, error: emailsError } = await supabase
      .from('emails')
      .select('id, subject, from_user, body, created_at')
      .eq('to_user', user_email)
      .order('created_at', { ascending: false });

    if (emailsError) throw emailsError;

    return { statusCode: 200, body: JSON.stringify({ success: true, emails }) };

  } catch (err) {
    console.error('getEmails error:', err);
    return { statusCode: 500, body: JSON.stringify({ success: false, error: 'Internal server error', details: err.message }) };
  }
};
