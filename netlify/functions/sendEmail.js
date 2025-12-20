import { createClient } from '@supabase/supabase-js';
import { v4 as uuidv4 } from 'uuid';
import nodemailer from 'nodemailer';
import cookie from 'cookie';
import crypto from 'crypto';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
  secure: true,
});

const sanitize = (str) => {
  if (!str) return '';
  return str.replace(/[<>]/g, (c) => (c === '<' ? '&lt;' : '&gt;'))
            .replace(/(\r|\n)/g, '');
};

const isValidEmail = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

export const handler = async (event) => {
  try {
    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, body: JSON.stringify({ success: false, error: 'Method not allowed' }) };
    }

    // Parse cookie
    const cookies = cookie.parse(event.headers.cookie || '');
    const session_token = cookies['__Host-session_secure'];
    if (!session_token) {
      return { statusCode: 401, body: JSON.stringify({ success: false, error: 'Not authenticated' }) };
    }

    // Verify session
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

    // Fetch sender info
    const { data: senderData, error: senderError } = await supabase
      .from('users')
      .select('email, username, avatar_url, last_online, verified')
      .eq('email', from_user)
      .single();

    if (senderError || !senderData || !senderData.verified) {
      return { statusCode: 403, body: JSON.stringify({ success: false, error: 'Sender not verified or invalid' }) };
    }

    // Parse request body
    let payload;
    try { payload = JSON.parse(event.body || '{}'); } 
    catch { 
      return { statusCode: 400, body: JSON.stringify({ success: false, error: 'Invalid JSON' }) }; 
    }

    let { to_user, subject, body } = payload;

    if (!to_user || !body || body.length > 2000 || (subject && subject.length > 200)) {
      return { statusCode: 400, body: JSON.stringify({ success: false, error: 'Invalid input or length exceeded' }) };
    }

    subject = sanitize(subject || 'New message');
    body = sanitize(body);

    if (!isValidEmail(to_user)) {
      return { statusCode: 400, body: JSON.stringify({ success: false, error: 'Recipient email is invalid' }) };
    }

    // Fetch recipient info
    const { data: recipientData, error: recipientError } = await supabase
      .from('users')
      .select('email, username, avatar_url, last_online, verified')
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

    // Determine sender online status
    const senderOnline = (Date.now() - new Date(senderData.last_online || 0).getTime()) < 5 * 60 * 1000;
    const senderStatusText = senderOnline ? 'Online' : 'Offline';
    const senderAvatar = senderData.avatar_url || `https://avatars.dicebear.com/api/initials/${encodeURIComponent(senderData.username)}.svg`;

    // Send email with HTML
    await transporter.sendMail({
      from: `"${senderData.username}" <${senderData.email}>`,
      to: recipientData.email,
      replyTo: senderData.email,
      subject,
      text: `${senderData.username} (${senderStatusText}) says:\n\n${body}`,
      html: `
        <div style="font-family: sans-serif; color: #111;">
          <div style="display:flex; align-items:center; margin-bottom:10px;">
            <img src="${senderAvatar}" width="50" height="50" style="border-radius:50%; margin-right:10px;" />
            <div>
              <strong>${senderData.username}</strong> (${senderData.email})<br/>
              Status: <strong>${senderStatusText}</strong>
            </div>
          </div>
          <div style="margin-top:10px; padding:10px; border:1px solid #ddd; border-radius:5px;">
            ${body.replace(/\n/g, '<br/>')}
          </div>
        </div>
      `,
    });

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        message: `Email sent successfully from ${senderData.username} to ${recipientData.username || recipientData.email}`,
        sender: {
          username: senderData.username,
          avatar_url: senderAvatar,
          online: senderOnline
        }
      }),
    };

  } catch (err) {
    console.error('sendEmail error:', err);
    return { statusCode: 500, body: JSON.stringify({ success: false, error: 'Internal server error', details: err.message }) };
  }
};
