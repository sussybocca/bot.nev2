import { createClient } from '@supabase/supabase-js';
import nodemailer from 'nodemailer';
import { v4 as uuidv4 } from 'uuid';
import cookie from 'cookie';
import DOMPurify from 'dompurify';
import { JSDOM } from 'jsdom';
import crypto from 'crypto';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

const transporter =
  process.env.EMAIL_USER && process.env.EMAIL_PASS
    ? nodemailer.createTransport({
        service: 'gmail',
        auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
        secure: true
      })
    : null;

const RATE_LIMIT_COUNT = 10;
const RATE_LIMIT_WINDOW = 60 * 60 * 1000;
const RECENT_MESSAGE_WINDOW = 5 * 60 * 1000;

const window = new JSDOM('').window;
const purify = DOMPurify(window);

export const handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': 'https://botnet2.netlify.app/email?ref=@dude', // replace with your frontend
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Credentials': 'true'
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers };

  try {
    if (event.httpMethod !== 'POST')
      return { statusCode: 405, headers, body: JSON.stringify({ success: false }) };

    const cookies = cookie.parse(event.headers.cookie || '');
    const csrfCookie = cookies.csrf_token;
    if (!csrfCookie || csrfCookie !== process.env.CSRF_TOKEN)
      return { statusCode: 403, headers, body: JSON.stringify({ success: false, error: 'CSRF validation failed' }) };

    const session_token = cookies.session_token;
    if (!session_token)
      return { statusCode: 403, headers, body: JSON.stringify({ success: false, error: 'No session cookie' }) };

    const { to_user, subject, body } = JSON.parse(event.body || '{}');
    if (!to_user || !body)
      return { statusCode: 400, headers, body: JSON.stringify({ success: false, error: 'Missing fields' }) };

    const cleanBody = purify.sanitize(body);
    const cleanSubject = purify.sanitize(subject || '');

    const { data: session } = await supabase
      .from('sessions')
      .select('user_email, expires_at, last_fingerprint')
      .eq('session_token', session_token)
      .maybeSingle();

    if (!session) return { statusCode: 403, headers, body: JSON.stringify({ success: false, error: 'Invalid session' }) };
    if (new Date(session.expires_at) < new Date())
      return { statusCode: 403, headers, body: JSON.stringify({ success: false, error: 'Session expired' }) };

    const from_user = session.user_email;

    const fingerprintSource = event.headers['user-agent'] + event.headers['accept-language'] + (event.headers['x-forwarded-for'] || '');
    const currentFingerprint = crypto.createHash('sha256').update(fingerprintSource).digest('hex');

    if (session.last_fingerprint && session.last_fingerprint !== currentFingerprint)
      return { statusCode: 403, headers, body: JSON.stringify({ success: false, error: 'Device mismatch' }) };

    // Rate limit
    const { data: recentMessages } = await supabase
      .from('emails')
      .select('id, body, created_at')
      .eq('from_user', from_user)
      .gte('created_at', new Date(Date.now() - RATE_LIMIT_WINDOW));

    if (recentMessages?.length >= RATE_LIMIT_COUNT)
      return { statusCode: 429, headers, body: JSON.stringify({ success: false, error: 'Rate limit exceeded' }) };

    const duplicate = recentMessages?.find(m => new Date() - new Date(m.created_at) < RECENT_MESSAGE_WINDOW && m.body === cleanBody);
    if (duplicate) return { statusCode: 429, headers, body: JSON.stringify({ success: false, error: 'Duplicate message detected' }) };

    const { data: sender } = await supabase.from('users').select('email').eq('email', from_user).eq('verified', true).maybeSingle();
    if (!sender) return { statusCode: 403, headers, body: JSON.stringify({ success: false, error: 'Sender not verified' }) };

    const { data: recipient } = await supabase.from('users').select('email').eq('email', to_user).eq('verified', true).maybeSingle();
    if (!recipient) return { statusCode: 404, headers, body: JSON.stringify({ success: false, error: 'Recipient not found' }) };

    await supabase.from('emails').insert({ id: uuidv4(), from_user, to_user, subject: cleanSubject, body: cleanBody });

    if (transporter) {
      await transporter.sendMail({
        from: `"Botnev Mail" <${process.env.EMAIL_USER}>`,
        to: to_user,
        replyTo: from_user,
        subject: cleanSubject || `New message from ${from_user}`,
        text: cleanBody
      });
    }

    // Do NOT rotate session token here — leave it for login only
    return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };

  } catch (err) {
    console.error(err);
    return { statusCode: 500, headers, body: JSON.stringify({ success: false, error: 'Server error' }) };
  }
};
