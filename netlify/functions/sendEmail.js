import { createClient } from '@supabase/supabase-js';
import { v4 as uuidv4 } from 'uuid';
import nodemailer from 'nodemailer';
import cookie from 'cookie';
import rateLimit from 'lambda-rate-limiter';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// Rate limiter: 5 emails per user per minute
const limiter = rateLimit({ interval: 60 * 1000, max: 5 });

// Nodemailer with forced TLS and app password
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
  secure: true, // force TLS
});

// Sanitize inputs to prevent HTML & header injection
const sanitize = (str) => {
  if (!str) return '';
  return str
    .replace(/[<>]/g, (c) => (c === '<' ? '&lt;' : '&gt;'))
    .replace(/(\r|\n)/g, ''); // prevent header injection
};

export const handler = async (event) => {
  try {
    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, body: JSON.stringify({ success: false, error: 'Method not allowed' }) };
    }

    const cookies = cookie.parse(event.headers.cookie || '');
    const session_token = cookies['__Host-session_secure']; // enforce secure cookie

    if (!session_token) {
      return { statusCode: 401, body: JSON.stringify({ success: false, error: 'Not authenticated' }) };
    }

    const { data: sessionData, error: sessionError } = await supabase
      .from('sessions')
      .select('user_email, expires_at')
      .eq('session_token', session_token)
      .single();

    if (sessionError || !sessionData) {
      return { statusCode: 403, body: JSON.stringify({ success: false, error: 'Invalid session' }) };
    }

    if (new Date(sessionData.expires_at) < new Date()) {
      return { statusCode: 403, body: JSON.stringify({ success: false, error: 'Session expired' }) };
    }

    const from_user = sessionData.user_email;

    // Parse input
    const { to_user, subject, body } = JSON.parse(event.body || '{}');

    if (!to_user || !body || body.length > 2000 || (subject && subject.length > 200)) {
      return { statusCode: 400, body: JSON.stringify({ success: false, error: 'Invalid input or length exceeded' }) };
    }

    const safeSubject = sanitize(subject || 'New message');
    const safeBody = sanitize(body);

    // ✅ Rate limit
    await limiter.check(from_user, 1);

    // ✅ Verify recipient exists & is verified
    const { data: recipient, error: recipientError } = await supabase
      .from('users')
      .select('email, verified')
      .eq('email', to_user)
      .single();

    if (recipientError || !recipient || !recipient.verified) {
      return { statusCode: 403, body: JSON.stringify({ success: false, error: 'Recipient not verified or does not exist' }) };
    }

    // Insert email in DB
    await supabase.from('emails').insert({
      id: uuidv4(),
      from_user,
      to_user,
      subject: safeSubject,
      body: safeBody,
      created_at: new Date().toISOString(),
    });

    // Send email via secure transporter
    await transporter.sendMail({
      from: `"Botnev Mail" <${process.env.EMAIL_USER}>`,
      to: to_user,
      replyTo: from_user,
      subject: safeSubject,
      text: safeBody,
    });

    return { statusCode: 200, body: JSON.stringify({ success: true, message: 'Email sent successfully' }) };
  } catch (err) {
    if (err.message?.includes('Too Many Requests')) {
      return { statusCode: 429, body: JSON.stringify({ success: false, error: 'Rate limit exceeded' }) };
    }
    console.error('sendEmail error:', err);
    return { statusCode: 500, body: JSON.stringify({ success: false, error: 'Internal server error' }) };
  }
};
