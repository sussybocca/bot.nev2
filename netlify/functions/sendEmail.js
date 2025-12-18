import { createClient } from '@supabase/supabase-js';
import { v4 as uuidv4 } from 'uuid';
import nodemailer from 'nodemailer';
import crypto from 'crypto';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY // use service role for secure operations
);

// Optional transporter if EMAIL_USER and EMAIL_PASS are set
const transporter = process.env.EMAIL_USER && process.env.EMAIL_PASS
  ? nodemailer.createTransport({
      service: 'gmail',
      auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
      secure: true
    })
  : null;

// Rate limit / duplicate checks
const RATE_LIMIT_COUNT = 10; // max emails per hour
const RATE_LIMIT_WINDOW = 60 * 60 * 1000; // 1 hour
const DUPLICATE_WINDOW = 5 * 60 * 1000; // 5 minutes

export const handler = async (event) => {
  try {
    const { session_token, to_user, subject, body } = JSON.parse(event.body || '{}');

    if (!session_token || !to_user || !body) {
      return { statusCode: 400, body: JSON.stringify({ success: false, error: 'Missing required fields' }) };
    }

    // Verify session
    const { data: session } = await supabase
      .from('sessions')
      .select('user_email, expires_at, last_fingerprint')
      .eq('session_token', session_token)
      .maybeSingle();

    if (!session) {
      return { statusCode: 403, body: JSON.stringify({ success: false, error: 'Invalid session' }) };
    }

    if (new Date(session.expires_at) < new Date()) {
      return { statusCode: 403, body: JSON.stringify({ success: false, error: 'Session expired' }) };
    }

    const from_user = session.user_email;

    // Device fingerprint
    const fingerprintSource = event.headers['user-agent'] + (event.headers['x-forwarded-for'] || '');
    const currentFingerprint = crypto.createHash('sha256').update(fingerprintSource).digest('hex');
    if (session.last_fingerprint && session.last_fingerprint !== currentFingerprint) {
      return { statusCode: 403, body: JSON.stringify({ success: false, error: 'Device mismatch' }) };
    }

    // Rate limit check
    const { data: recentMessages } = await supabase
      .from('emails')
      .select('id, body, created_at')
      .eq('from_user', from_user)
      .gte('created_at', new Date(Date.now() - RATE_LIMIT_WINDOW));

    if (recentMessages?.length >= RATE_LIMIT_COUNT) {
      return { statusCode: 429, body: JSON.stringify({ success: false, error: 'Rate limit exceeded' }) };
    }

    // Prevent duplicate messages within DUPLICATE_WINDOW
    const duplicate = recentMessages?.find(
      m => new Date() - new Date(m.created_at) < DUPLICATE_WINDOW && m.body === body
    );
    if (duplicate) {
      return { statusCode: 429, body: JSON.stringify({ success: false, error: 'Duplicate message detected' }) };
    }

    // Verify sender
    const { data: sender } = await supabase
      .from('users')
      .select('email, verified')
      .eq('email', from_user)
      .eq('verified', true)
      .maybeSingle();
    if (!sender) return { statusCode: 403, body: JSON.stringify({ success: false, error: 'Sender not verified' }) };

    // Verify recipient
    const { data: recipient } = await supabase
      .from('users')
      .select('email, verified')
      .eq('email', to_user)
      .eq('verified', true)
      .maybeSingle();
    if (!recipient) return { statusCode: 404, body: JSON.stringify({ success: false, error: 'Recipient not found or not verified' }) };

    // Insert email into Supabase
    await supabase.from('emails').insert({
      id: uuidv4(),
      from_user,
      to_user,
      subject: subject || '',
      body
    });

    // Optionally send via Nodemailer
    if (transporter) {
      await transporter.sendMail({
        from: `"Botnev Mail" <${process.env.EMAIL_USER}>`,
        to: to_user,
        replyTo: from_user,
        subject: subject || `New message from ${from_user}`,
        text: body
      });
    }

    // Update session fingerprint to prevent token misuse
    await supabase
      .from('sessions')
      .update({ last_fingerprint: currentFingerprint })
      .eq('session_token', session_token);

    return { statusCode: 200, body: JSON.stringify({ success: true, message: 'Email sent successfully!' }) };

  } catch (err) {
    console.error('SendEmail error:', err);
    return { statusCode: 500, body: JSON.stringify({ success: false, error: 'Internal server error' }) };
  }
};
