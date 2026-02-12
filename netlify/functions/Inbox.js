import { createClient } from '@supabase/supabase-js';
import cookie from 'cookie';
import crypto from 'crypto';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Decrypt token (matches login.js)
function decryptToken(encryptedToken) {
  try {
    const [ivHex, tagHex, encryptedHex] = encryptedToken.split(':');
    if (!ivHex || !tagHex || !encryptedHex) return null;
    
    const iv = Buffer.from(ivHex, 'hex');
    const tag = Buffer.from(tagHex, 'hex');
    const encrypted = Buffer.from(encryptedHex, 'hex');
    
    const key = crypto.scryptSync(process.env.SESSION_SECRET, 'salt', 32);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv, { authTagLength: 16 });
    decipher.setAuthTag(tag);
    
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted; // Returns the UUID
  } catch (err) {
    console.error('Token decryption failed:', err.message);
    return null;
  }
}

export const handler = async (event) => {
  try {
    // Only allow GET requests
    if (event.httpMethod !== 'GET') {
      return { 
        statusCode: 405, 
        body: JSON.stringify({ success: false, error: 'Method not allowed' }) 
      };
    }

    // Parse cookies
    const cookies = cookie.parse(event.headers.cookie || '');
    const encrypted_token = cookies['__Host-session_secure'];
    
    if (!encrypted_token) {
      return { 
        statusCode: 401, 
        body: JSON.stringify({ success: false, error: 'Not authenticated - no session cookie' }) 
      };
    }

    // Decrypt the token to get the actual session_token (UUID)
    const session_token = decryptToken(encrypted_token);
    
    if (!session_token) {
      return { 
        statusCode: 403, 
        body: JSON.stringify({ success: false, error: 'Invalid session token format' }) 
      };
    }

    // Lookup session using the decrypted UUID
    const { data: sessionData, error: sessionError } = await supabase
      .from('sessions')
      .select('user_email, expires_at')
      .eq('session_token', session_token)
      .single();

    if (sessionError || !sessionData) {
      return { 
        statusCode: 403, 
        body: JSON.stringify({ success: false, error: 'Invalid or expired session' }) 
      };
    }
    
    if (new Date(sessionData.expires_at) < new Date()) {
      return { 
        statusCode: 403, 
        body: JSON.stringify({ success: false, error: 'Session expired' }) 
      };
    }

    const user_email = sessionData.user_email;

    // Pagination parameters
    let page = parseInt(event.queryStringParameters?.page || '1', 10);
    let pageSize = parseInt(event.queryStringParameters?.pageSize || '20', 10);
    
    if (isNaN(page) || page < 1) page = 1;
    if (isNaN(pageSize) || pageSize < 1 || pageSize > 100) pageSize = 20;
    
    const offset = (page - 1) * pageSize;

    // Fetch emails for this user
    const { data: emails, error: emailsError, count } = await supabase
      .from('emails')
      .select('id, from_user, subject, body, created_at, read_at', { count: 'exact' })
      .eq('to_user', user_email)
      .order('created_at', { ascending: false })
      .range(offset, offset + pageSize - 1);

    if (emailsError) {
      console.error('Emails fetch error:', emailsError);
      throw emailsError;
    }

    // If no emails, return empty array
    if (!emails || emails.length === 0) {
      return {
        statusCode: 200,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store'
        },
        body: JSON.stringify({
          success: true,
          emails: [],
          page,
          pageSize,
          total: count || 0,
          hasMore: false
        })
      };
    }

    // Get unique sender emails
    const senderEmails = [...new Set(emails.map(e => e.from_user))];

    // Fetch sender info for all unique senders
    const { data: senders, error: sendersError } = await supabase
      .from('users')
      .select('email, username, avatar_url, online')
      .in('email', senderEmails);

    if (sendersError) {
      console.error('Senders fetch error:', sendersError);
    }

    // Create sender lookup map
    const senderMap = new Map();
    if (senders) {
      senders.forEach(sender => {
        senderMap.set(sender.email, sender);
      });
    }

    // Build inbox with sender details
    const inbox = emails.map(e => {
      const sender = senderMap.get(e.from_user) || {
        email: e.from_user,
        username: e.from_user.split('@')[0],
        avatar_url: null,
        online: false
      };

      const senderOnline = sender?.online === true;

      return {
        id: e.id,
        subject: e.subject || '(no subject)',
        body: e.body || '',
        created_at: e.created_at,
        read_at: e.read_at,
        from: {
          email: sender.email || e.from_user,
          username: sender.username || sender.email?.split('@')[0] || e.from_user.split('@')[0],
          avatar_url: sender.avatar_url || `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(sender.username || sender.email || e.from_user)}`,
          online: senderOnline
        }
      };
    });

    // Calculate if there are more pages
    const total = count || 0;
    const hasMore = offset + pageSize < total;

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
        'Set-Cookie': `__Host-session_secure=${encrypted_token}; Path=/; HttpOnly; Secure; Max-Age=${90 * 24 * 60 * 60}; SameSite=Strict`
      },
      body: JSON.stringify({
        success: true,
        emails: inbox,
        page,
        pageSize,
        total,
        hasMore,
        nextPage: hasMore ? page + 1 : null
      })
    };

  } catch (err) {
    console.error('Inbox function error:', err);
    return {
      statusCode: 500,
      body: JSON.stringify({
        success: false,
        error: 'Internal server error',
        message: err.message
      })
    };
  }
};
