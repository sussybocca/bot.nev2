import { createClient } from '@supabase/supabase-js';
import fetch from 'node-fetch';
import crypto from 'crypto';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// Decrypt AES-GCM session token
function decryptSessionToken(token) {
  try {
    const [ivHex, tagHex, encryptedHex] = token.split(':');
    const key = crypto.scryptSync(process.env.SESSION_SECRET, 'salt', 32);
    const iv = Buffer.from(ivHex, 'hex');
    const tag = Buffer.from(tagHex, 'hex');
    const encrypted = Buffer.from(encryptedHex, 'hex');

    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv, { authTagLength: 16 });
    decipher.setAuthTag(tag);
    const decrypted = decipher.update(encrypted, undefined, 'utf8') + decipher.final('utf8');
    return decrypted;
  } catch (e) {
    return null;
  }
}

// Validate that the URL is an HTTPS image
async function isValidImageUrl(url) {
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) return false;

    const res = await fetch(url, { method: 'HEAD' });
    const contentType = res.headers.get('content-type') || '';
    return res.ok && contentType.startsWith('image/');
  } catch (e) {
    return false;
  }
}

export const handler = async (event) => {
  try {
    const cookieHeader = event.headers.cookie || '';
    const sessionMatch = cookieHeader.match(/__Host-session_secure=([^;]+)/);
    if (!sessionMatch) return { statusCode: 401, body: JSON.stringify({ success: false, error: 'No session cookie found' }) };

    const sessionToken = sessionMatch[1];
    const userUUID = decryptSessionToken(sessionToken);
    if (!userUUID) return { statusCode: 401, body: JSON.stringify({ success: false, error: 'Invalid session token' }) };

    // Validate session exists and is not expired
    const { data: session } = await supabase.from('sessions')
      .select('user_email, expires_at')
      .eq('session_token', sessionToken)
      .maybeSingle();

    if (!session || new Date(session.expires_at) < new Date()) {
      return { statusCode: 401, body: JSON.stringify({ success: false, error: 'Session expired or invalid' }) };
    }

    // Fetch current user data
    const { data: user, error: userError } = await supabase.from('users')
      .select('email, username, avatar_url, online')
      .eq('email', session.user_email)
      .maybeSingle();

    if (userError) {
      return { statusCode: 500, body: JSON.stringify({ success: false, error: 'Failed to fetch user', details: userError.message }) };
    }

    // Parse body for updates
    let body = {};
    try { body = JSON.parse(event.body || '{}'); } catch(e){}

    const updates = {};
    if (typeof body.online === 'boolean') updates.online = body.online;
    if (body.avatar_url) {
      if (!(await isValidImageUrl(body.avatar_url))) {
        return { statusCode: 400, body: JSON.stringify({ success: false, error: 'Invalid or unreachable avatar URL' }) };
      }
      updates.avatar_url = body.avatar_url;
    }

    // Apply updates if any
    if (Object.keys(updates).length > 0) {
      const { error } = await supabase.from('users')
        .update(updates)
        .eq('email', session.user_email);

      if (error) return { statusCode: 500, body: JSON.stringify({ success: false, error: 'Failed to update user', details: error.message }) };
    }

    // Return current settings after any updates
    const responseUser = { 
      email: user.email,
      username: user.username,
      avatar_url: updates.avatar_url ?? user.avatar_url,
      online: updates.online ?? user.online
    };

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        user: responseUser
      })
    };

  } catch (err) {
    console.error('SETTINGS FUNCTION ERROR:', err);
    return { statusCode: 500, body: JSON.stringify({ success: false, error: 'Internal server error', details: err.message }) };
  }
};
