import fetch from 'node-fetch'; // <-- keep this as is
import { createClient } from '@supabase/supabase-js';
import bcrypt from 'bcrypt';
import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';
import nodemailer from 'nodemailer';
import { checkRateLimit, logAttempt } from './rateLimit.js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// Nodemailer transporter
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

// CAPTCHA verification
async function verifyCaptcha(token, ip) {
  if (!token) return false;
  const secret = process.env.CAPTCHA_SECRET_KEY;
  const res = await fetch('https://hcaptcha.com/siteverify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `secret=${secret}&response=${token}&remoteip=${ip}`
  });
  const data = await res.json();
  return data.success === true;
}

// Device fingerprint hash
function getDeviceFingerprint(headers, frontendFingerprint) {
  const source = frontendFingerprint || (headers['user-agent'] + headers['accept-language'] + headers['x-forwarded-for']);
  return crypto.createHash('sha256').update(source).digest('hex');
}

// Random uniform delay (0.5–1.5s)
async function randomDelay() {
  const delay = 500 + Math.random() * 1000;
  return new Promise(res => setTimeout(res, delay));
}

// Generate encrypted session token (AES-GCM)
function generateEncryptedToken() {
  const iv = crypto.randomBytes(16);
  const key = crypto.scryptSync(process.env.SESSION_SECRET, 'salt', 32);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv, { authTagLength: 16 });
  const uuid = uuidv4();
  const encrypted = cipher.update(uuid, 'utf8', 'hex') + cipher.final('hex');
  const tag = cipher.getAuthTag().toString('hex');
  return `${iv.toString('hex')}:${tag}:${encrypted}`;
}

// Send verification email
async function sendVerificationEmail(email, code) {
  const mailOptions = {
    from: process.env.EMAIL_USER,
    to: email,
    subject: 'Verify Your New Device/Login',
    text: `Your verification code is: ${code}`
  };
  await transporter.sendMail(mailOptions);
}

// Generate random verification code
function generateVerificationCode() {
  return Math.floor(100000 + Math.random() * 900000).toString(); // 6-digit code
}

// Password crackdown: strong policy check
function passwordStrongEnough(password) {
  return password.length >= 8 && /[A-Z]/.test(password) && /[a-z]/.test(password) && /\d/.test(password) && /[!@#$%^&*]/.test(password);
}

export const handler = async (event) => {
  try {
    const ip = event.headers['x-forwarded-for'] || event.headers['client-ip'] || 'unknown';
    const { email, password, remember_me, captcha_token, google, fingerprint, verification_code } = JSON.parse(event.body);
    const deviceFingerprint = getDeviceFingerprint(event.headers, fingerprint);

    // Google OAuth shortcut
    if (google) {
      return { statusCode: 200, body: JSON.stringify({ success: true, redirect: '/.netlify/functions/googleStart' }) };
    }

    // Rate limit check
    const allowed = await checkRateLimit(ip + email);
    if (!allowed) return { statusCode: 429, body: JSON.stringify({ success: false, error: 'Too many login attempts. Try again later.' }) };

    // CAPTCHA check
    const captchaValid = await verifyCaptcha(captcha_token, ip);
    if (!captchaValid) {
      await logAttempt(ip + email);
      await randomDelay();
      return { statusCode: 403, body: JSON.stringify({ success: false, error: 'CAPTCHA verification failed' }) };
    }

    // Fetch user
    const { data: user } = await supabase.from('users').select('*').eq('email', email).maybeSingle();
    const userPassword = user?.encrypted_password || user?.password || '';
    const dummyHash = '$2b$12$C6UzMDM.H6dfI/f/IKcEeO';
    const passwordMatch = user ? await bcrypt.compare(password, userPassword) : await bcrypt.compare(dummyHash, dummyHash);

    // Reject if password/user/device invalid or honeytoken
    if (!user || !passwordMatch || !user.verified || user.is_honeytoken) {
      await logAttempt(ip + email);
      await randomDelay();
      return { statusCode: 401, body: JSON.stringify({ success: false, error: 'Invalid email or password or device' }) };
    }

    // Password policy enforcement (optional)
    if (!passwordStrongEnough(password)) {
      return { statusCode: 400, body: JSON.stringify({ success: false, error: 'Password does not meet strength requirements' }) };
    }

    // New device or first login session: email verification required
    let sessionNeedsVerification = false;
    if (!user.last_fingerprint || user.last_fingerprint !== deviceFingerprint) {
      sessionNeedsVerification = true;

      if (!verification_code) {
        const code = generateVerificationCode();
        await supabase.from('pending_verifications').upsert({
          email,
          code,
          fingerprint: deviceFingerprint,
          expires_at: new Date(Date.now() + 10 * 60 * 1000) // 10 min validity
        }, { onConflict: ['email'] });
        await sendVerificationEmail(email, code);
        return { statusCode: 200, body: JSON.stringify({ success: true, verification_required: true, message: 'Verification code sent to email' }) };
      }

      // Check provided verification code
      const { data: pending } = await supabase.from('pending_verifications')
        .select('*')
        .eq('email', email)
        .eq('fingerprint', deviceFingerprint)
        .maybeSingle();

      if (!pending || pending.code !== verification_code || new Date(pending.expires_at) < new Date()) {
        return { statusCode: 401, body: JSON.stringify({ success: false, error: 'Invalid or expired verification code' }) };
      }

      // Delete verified code
      await supabase.from('pending_verifications').delete().eq('email', email).eq('fingerprint', deviceFingerprint);
    }

    // Generate session token and store it
    const session_token = generateEncryptedToken();
    const expiresInDays = remember_me ? 90 : 1;

    await supabase.from('sessions').insert({
      user_email: email,
      session_token,
      expires_at: new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000),
      verified: !sessionNeedsVerification
    });

    await supabase.from('users').update({ last_fingerprint: deviceFingerprint }).eq('email', email);

    return {
      statusCode: 200,
      headers: {
        'Set-Cookie': `session_token=${session_token}; Path=/; HttpOnly; Secure; Max-Age=${expiresInDays*24*60*60}; SameSite=Strict`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        success: true,
        message: sessionNeedsVerification ? 'Verification complete, login successful!' : 'Login successful!',
        verification_required: false
      })
    };

  } catch (err) {
    console.error('LOGIN ERROR:', err);
    return { statusCode: 500, body: JSON.stringify({ success: false, error: 'Internal server error', details: err.message }) };
  }
};
