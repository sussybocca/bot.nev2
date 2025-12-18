import { createClient } from '@supabase/supabase-js';
import nodemailer from 'nodemailer';
import { v4 as uuidv4 } from 'uuid';
import cookie from 'cookie';
import DOMPurify from 'dompurify';
import { JSDOM } from 'jsdom';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

const transporter =
  process.env.EMAIL_USER && process.env.EMAIL_PASS
    ? nodemailer.createTransport({
        service: 'gmail',
        auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
        secure: true
      })
    : null;

// Rate limiting config
const RATE_LIMIT_COUNT = 10; // messages per hour
const RATE_LIMIT_WINDOW = 60 * 60 * 1000; // 1 hour

// Replay attack prevention
const RECENT_MESSAGE_WINDOW = 5 * 60 * 1000; // 5 min

// Sanitizer
const window = new JSDOM('').window;
const purify = DOMPurify(window);

export const handler = async (event) => {
  try {
    if (event.httpMethod !== 'POST')
      return { statusCode: 405, body: JSON.stringify({ success: false, error: 'Method not allowed' }) };

    // ✅ CSRF
    const csrfToken = event.headers['x-csrf-token'];
    if (!csrfToken || csrfToken !== process.env.CSRF_TOKEN)
      return { statusCode: 403, body: JSON.stringify({ success: false, error: 'CSRF check failed' }) };

    // ✅ Read session cookie
    const cookies = cookie.parse(event.headers.cookie || '');
    const session_token = cookies.session_token;
    if (!session_token)
      return { statusCode: 403, body: JSON.stringify({ success: false, error: 'No session cookie found' }) };

    // ✅ Parse & sanitize inputs
    const { to_user, subject, body } = JSON.parse(event.body || '{}');
    if (!to_user || !body)
      return { statusCode: 400, body: JSON.stringify({ success: false, error: 'Missing fields' }) };
    if (typeof to_user !== 'string' || typeof body !== 'string')
      return { statusCode: 400, body: JSON.stringify({ success: false, error: 'Invalid field types' }) };
    if (body.length > 5000)
      return { statusCode: 400, body: JSON.stringify({ success: false, error: 'Message too long' }) };
    if (subject && subject.length > 255)
      return { statusCode: 400, body: JSON.stringify({ success: false, error: 'Subject too long' }) };

    const cleanBody = purify.sanitize(body);
    const cleanSubject = purify.sanitize(subject || '');

    // 🔐 Verify session & expiration
    const { data: session } = await supabase
      .from('sessions')
      .select('user_email, expires_at, last_fingerprint')
      .eq('session_token', session_token)
      .maybeSingle();

    if (!session) return { statusCode: 403, body: JSON.stringify({ success: false, error: 'Invalid session' }) };
    if (new Date(session.expires_at) < new Date())
      return { statusCode: 403, body: JSON.stringify({ success: false, error: 'Session expired' }) };

    const from_user = session.user_email;

    // ✅ Device fingerprint
    const fingerprint = event.headers['user-agent'] + event.headers['accept-language'] + (event.headers['x-forwarded-for'] || '');
    const crypto = require('crypto');
    const currentFingerprint = crypto.createHash('sha256').update(fingerprint).digest('hex');
    if (session.last_fingerprint && session.last_fingerprint !== currentFingerprint)
      return { statusCode: 403, body: JSON.stringify({ success: false, error: 'Device mismatch' }) };

    // ✅ Rate limiting per user
    const { data: recentMessages } = await supabase
      .from('emails')
      .select('id, created_at')
      .eq('from_user', from_user)
      .gte('created_at', new Date(Date.now() - RATE_LIMIT_WINDOW));

    if (recentMessages?.length >= RATE_LIMIT_COUNT)
      return { statusCode: 429, body: JSON.stringify({ success: false, error: 'Rate limit exceeded. Try later.' }) };

    // ✅ Replay attack prevention
    const duplicate = recentMessages?.find(m => m.created_at && new Date() - new Date(m.created_at) < RECENT_MESSAGE_WINDOW && cleanBody === m.body);
    if (duplicate)
      return { statusCode: 429, body: JSON.stringify({ success: false, error: 'Duplicate message detected. Wait before retrying.' }) };

    // ✅ Verify sender & recipient
    const { data: sender } = await supabase.from('users').select('email, verified').eq('email', from_user).eq('verified', true).maybeSingle();
    if (!sender) return { statusCode: 403, body: JSON.stringify({ success: false, error: 'Sender not verified' }) };

    const { data: recipient } = await supabase.from('users').select('email, verified').eq('email', to_user).eq('verified', true).maybeSingle();
    if (!recipient) return { statusCode: 404, body: JSON.stringify({ success: false, error: 'Recipient not found' }) };

    // 📨 Store internal message
    await supabase.from('emails').insert({ id: uuidv4(), from_user, to_user, subject: cleanSubject, body: cleanBody });

    // ✉️ Send email
    if (transporter) {
      await transporter.sendMail({
        from: `"Botnev Mail" <${process.env.EMAIL_USER}>`,
        to: to_user,
        replyTo: from_user,
        subject: cleanSubject || `New message from ${from_user}`,
        text: cleanBody
      });
    } else {
      console.log(`Transporter not configured. Message to ${to_user}:`, cleanBody);
    }

    // ✅ Logging
    console.log(`[SECURE] Message sent from ${from_user} to ${to_user} at ${new Date().toISOString()}`);

    // 🔄 Rotate session token
    const newSessionToken = uuidv4();
    await supabase.from('sessions').update({ session_token: newSessionToken, expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000), last_fingerprint: currentFingerprint }).eq('session_token', session_token);

    return {
      statusCode: 200,
      headers: { 'Set-Cookie': `session_token=${newSessionToken}; Path=/; HttpOnly; Secure; SameSite=Strict` },
      body: JSON.stringify({ success: true, message: 'Message sent successfully' })
    };
  } catch (err) {
    console.error('sendEmail error:', err);
    return { statusCode: 500, body: JSON.stringify({ success: false, error: 'Server error', details: err.message }) };
  }
};
