import { createClient } from '@supabase/supabase-js';
import { v4 as uuidv4 } from 'uuid';
import nodemailer from 'nodemailer';
import cookie from 'cookie';

// Initialize Supabase with service role key
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// Nodemailer with TLS
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
  secure: true,
});

// Basic sanitization to prevent injection
const sanitize = (str) => {
  if (!str) return '';
  return str.replace(/[<>]/g, (c) => (c === '<' ? '&lt;' : '&gt;'))
            .replace(/(\r|\n)/g, ''); // prevent header injection
};

// Simple email validation
const isValidEmail = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

export const handler = async (event) => {
  try {
    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, body: JSON.stringify({ success: false, error: 'Method not allowed' }) };
    }

    // Use the login cookie from your login page
    const cookies = cookie.parse(event.headers.cookie || '');
    const session_token = cookies['__Host-login_token']; // <- your login cookie

    if (!session_token) {
      return { statusCode: 401, body: JSON.stringify({ success: false, error: 'Not authenticated' }) };
    }

    // Verify sender session
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

    // Verify sender exists & is verified
    const { data: senderData, error: senderError } = await supabase
      .from('users')
      .select('email, username, verified')
      .eq('email', from_user)
      .single();

    if (senderError || !senderData || !senderData.verified) {
      return { statusCode: 403, body: JSON.stringify({ success: false, error: 'Sender not verified or invalid' }) };
    }

    // Parse request body
    let payload;
    try { payload = JSON.parse(event.body || '{}'); } 
    catch { return { statusCode: 400, body: JSON.stringify({ success: false, error: 'Invalid JSON' }) }; }

    let { to_user, subject, body } = payload;

    if (!to_user || !body || body.length > 2000 || (subject && subject.length > 200)) {
      return { statusCode: 400, body: JSON.stringify({ success: false, error: 'Invalid input or length exceeded' }) };
    }

    // Sanitize inputs
    subject = sanitize(subject || 'New message');
    body = sanitize(body);

    if (!isValidEmail(to_user)) {
      return { statusCode: 400, body: JSON.stringify({ success: false, error: 'Recipient email is invalid' }) };
    }

    // Verify recipient exists & is verified
    const { data: recipientData, error: recipientError } = await supabase
      .from('users')
      .select('email, username, verified')
      .eq('email', to_user)
      .single();

    if (recipientError || !recipientData || !recipientData.verified) {
      return { statusCode: 403, body: JSON.stringify({ success: false, error: 'Recipient not verified or does not exist' }) };
    }

    // Insert email into DB
    await supabase.from('emails').insert({
      id: uuidv4(),
      from_user,
      to_user,
      subject,
      body,
      created_at: new Date().toISOString(),
    });

    // Send email using sender info
    await transporter.sendMail({
      from: `"${senderData.username}" <${senderData.email}>`,
      to: recipientData.email,
      replyTo: senderData.email,
      subject,
      text: body,
    });

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        message: `Email sent successfully from ${senderData.username} (${senderData.email}) to ${recipientData.username || recipientData.email}`,
      }),
    };

  } catch (err) {
    console.error('sendEmail error:', err);
    return { statusCode: 500, body: JSON.stringify({ success: false, error: 'Internal server error' }) };
  }
};
