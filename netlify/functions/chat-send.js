import { createClient } from '@supabase/supabase-js';
import cookie from 'cookie';
import crypto from 'crypto';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const RATE_LIMIT_COUNT = 20; // messages per conversation per hour
const RATE_LIMIT_WINDOW = 60 * 60 * 1000; // 1 hour
const RECENT_MESSAGE_WINDOW = 5 * 60 * 1000; // 5 minutes
const MAX_MESSAGE_LENGTH = 2000;

export async function handler(event) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Credentials': 'true'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers };
  }

  try {
    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, headers, body: JSON.stringify({ success: false, error: 'Method not allowed' }) };
    }

    const cookies = cookie.parse(event.headers.cookie || '');
    const session_token = cookies.session_token;

    if (!session_token) {
      return { statusCode: 403, headers, body: JSON.stringify({ success: false, error: 'No session cookie found' }) };
    }

    // Verify session
    const { data: session } = await supabase
      .from('sessions')
      .select('user_email, username, avatar_url, expires_at, last_fingerprint')
      .eq('session_token', session_token)
      .maybeSingle();

    if (!session) {
      return { statusCode: 403, headers, body: JSON.stringify({ success: false, error: 'Invalid session' }) };
    }

    if (new Date(session.expires_at) < new Date()) {
      return { statusCode: 403, headers, body: JSON.stringify({ success: false, error: 'Session expired' }) };
    }

    const { conversation_id, content } = JSON.parse(event.body || '{}');
    if (!conversation_id || !content) {
      return { statusCode: 400, headers, body: JSON.stringify({ success: false, error: 'Missing data' }) };
    }

    // Sanitize message: remove non-printable, limit length
    const safeContent = content
      .replace(/[^\x20-\x7E\n\r]+/g, '')
      .slice(0, MAX_MESSAGE_LENGTH);

    // Device fingerprint
    const fingerprintSource =
      event.headers['user-agent'] +
      event.headers['accept-language'] +
      (event.headers['x-forwarded-for'] || '');
    const currentFingerprint = crypto.createHash('sha256').update(fingerprintSource).digest('hex');

    if (session.last_fingerprint && session.last_fingerprint !== currentFingerprint) {
      return { statusCode: 403, headers, body: JSON.stringify({ success: false, error: 'Device mismatch' }) };
    }

    // Rate limiting
    const { data: recentMessages } = await supabase
      .from('messages')
      .select('id, content, created_at')
      .eq('conversation_id', conversation_id)
      .gte('created_at', new Date(Date.now() - RATE_LIMIT_WINDOW));

    if (recentMessages?.length >= RATE_LIMIT_COUNT) {
      return { statusCode: 429, headers, body: JSON.stringify({ success: false, error: 'Rate limit exceeded' }) };
    }

    // Replay prevention
    const duplicate = recentMessages?.find(
      m => new Date() - new Date(m.created_at) < RECENT_MESSAGE_WINDOW && m.content === safeContent
    );
    if (duplicate) {
      return { statusCode: 429, headers, body: JSON.stringify({ success: false, error: 'Duplicate message detected' }) };
    }

    // Insert message
    const { error } = await supabase.from('messages').insert([{
      conversation_id,
      sender_id: session.user_email,
      content: safeContent,
      sender_email: session.user_email,
      sender_username: session.username,
      sender_avatar: session.avatar_url,
      ip_address: event.headers['x-forwarded-for'] || '',
      user_agent: event.headers['user-agent'] || ''
    }]);

    if (error) throw error;

    return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
  } catch (err) {
    console.error('Secure chat handler error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ success: false, error: 'Server error', details: err.message }) };
  }
}
