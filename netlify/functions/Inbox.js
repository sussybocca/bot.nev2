import { createClient } from '@supabase/supabase-js';
import cookie from 'cookie';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Rate limiting
const rateLimitMap = new Map();
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 min
const RATE_LIMIT_MAX = 30;

export const handler = async (event) => {
  try {
    if (event.httpMethod !== 'GET') {
      return { statusCode: 405, body: JSON.stringify({ success: false, error: 'Method not allowed' }) };
    }

    // Rate limiting
    const ip = event.headers['x-forwarded-for'] || event.headers['remote_addr'] || 'unknown';
    const now = Date.now();
    if (!rateLimitMap.has(ip)) rateLimitMap.set(ip, []);
    const timestamps = rateLimitMap.get(ip).filter(ts => now - ts < RATE_LIMIT_WINDOW_MS);
    if (timestamps.length >= RATE_LIMIT_MAX) return { statusCode: 429, body: JSON.stringify({ success: false, error: 'Too many requests' }) };
    timestamps.push(now);
    rateLimitMap.set(ip, timestamps);

    // Parse cookie
    const cookies = cookie.parse(event.headers.cookie || '');
    const session_token = cookies['__Host-session_secure'];
    if (!session_token) return { statusCode: 401, body: JSON.stringify({ success: false, error: 'Not authenticated' }) };

    // Lookup session using raw token
    const { data: sessionData, error: sessionError } = await supabase
      .from('sessions')
      .select('user_email, expires_at')
      .eq('session_token', session_token)
      .single();

    if (sessionError || !sessionData) return { statusCode: 403, body: JSON.stringify({ success: false, error: 'Invalid or expired session' }) };
    if (new Date(sessionData.expires_at) < new Date()) return { statusCode: 403, body: JSON.stringify({ success: false, error: 'Session expired' }) };

    const user_email = sessionData.user_email;

    // Pagination
    let page = parseInt(event.queryStringParameters?.page || '1', 10);
    let pageSize = parseInt(event.queryStringParameters?.pageSize || '20', 10);
    if (isNaN(page) || page < 1) page = 1;
    if (isNaN(pageSize) || pageSize < 1 || pageSize > 100) pageSize = 20;
    const offset = (page - 1) * pageSize;

    // Fetch emails only
    const { data: emails, error: emailsError } = await supabase
      .from('emails')
      .select('id, from_user, subject, body, created_at')
      .eq('to_user', user_email)
      .order('created_at', { ascending: false })
      .range(offset, offset + pageSize - 1);

    if (emailsError) throw emailsError;

    // Fetch sender info for each email
    const inbox = await Promise.all(emails.map(async e => {
      const { data: sender } = await supabase
        .from('users')
        .select('email, username, avatar_url, last_online')
        .eq('email', e.from_user)
        .maybeSingle();

      const lastOnline = new Date(sender?.last_online || 0);
      const senderOnline = Date.now() - lastOnline.getTime() < 5 * 60 * 1000;

      return {
        id: e.id,
        subject: String(e.subject || ''),
        body: String(e.body || ''),
        created_at: e.created_at,
        from: {
          email: sender?.email || e.from_user || 'Unknown',
          username: sender?.username || sender?.email || e.from_user || 'Unknown',
          avatar_url: sender?.avatar_url || `https://avatars.dicebear.com/api/initials/${encodeURIComponent(sender?.username || sender?.email || e.from_user || 'user')}.svg`,
          online: senderOnline
        }
      };
    }));

    return { statusCode: 200, body: JSON.stringify({ success: true, emails: inbox, page, pageSize }) };

  } catch (err) {
    console.error('Inbox error:', err);
    return { statusCode: 500, body: JSON.stringify({ success: false, error: 'Internal server error', details: err.message }) };
  }
};
