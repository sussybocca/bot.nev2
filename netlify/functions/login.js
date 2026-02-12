import fetch from 'node-fetch';
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

// Verify CAPTCHA
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
  const source = frontendFingerprint || headers['user-agent'] + headers['accept-language'] + headers['x-forwarded-for'] + uuidv4();
  return crypto.createHash('sha256').update(source).digest('hex');
}

// Random delay (anti-bruteforce)
async function randomDelay() {
  const delay = 500 + Math.random() * 1000;
  return new Promise(res => setTimeout(res, delay));
}

// AES-GCM encrypted session token generator
function generateEncryptedTokenPair() {
  const iv = crypto.randomBytes(16);
  const key = crypto.scryptSync(process.env.SESSION_SECRET, 'salt', 32);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv, { authTagLength: 16 });
  
  const uuid = uuidv4(); // This goes in DB
  const encrypted = cipher.update(uuid, 'utf8', 'hex') + cipher.final('hex');
  const tag = cipher.getAuthTag().toString('hex');
  
  const encryptedToken = `${iv.toString('hex')}:${tag}:${encrypted}`; // Goes to cookie
  
  return {
    uuid, // Store this in database
    encryptedToken // Send this to browser
  };
}

// Backward compatibility - detect token format
function isLegacyToken(token) {
  // Legacy tokens are just UUIDs (no colons)
  return token && !token.includes(':') && token.length === 36;
}

// Send verification email
async function sendVerificationEmail(email, code) {
  await transporter.sendMail({
    from: process.env.EMAIL_USER,
    to: email,
    subject: 'Verify Your Login',
    text: `Your verification code is: ${code}\nIt expires in 1 minute.`
  });
}

// Generate 6-digit verification code
function generateVerificationCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// Strong password check
function passwordStrongEnough(password) {
  return password.length >= 8 &&
         /[A-Z]/.test(password) &&
         /[a-z]/.test(password) &&
         /\d/.test(password) &&
         /[!@#$%^&*]/.test(password);
}

export const handler = async (event) => {
  try {
    const ip = event.headers['x-forwarded-for'] || event.headers['client-ip'] || 'unknown';
    const { email, password, remember_me, captcha_token, google, fingerprint, verification_code } = JSON.parse(event.body);

    // Google login shortcut
    if (google) {
      return { statusCode: 200, body: JSON.stringify({ success: true, redirect: '/.netlify/functions/googleStart' }) };
    }

    // Rate limit check
    if (!(await checkRateLimit(ip + email))) {
      return { statusCode: 429, body: JSON.stringify({ success: false, error: 'Too many login attempts. Try again later.' }) };
    }

    // Fetch user
    const { data: user } = await supabase.from('users').select('*').eq('email', email).maybeSingle();
    const userPassword = user?.encrypted_password || user?.password || '';
    const dummyHash = '$2b$12$C6UzMDM.H6dfI/f/IKcEeO';
    const passwordMatch = user ? await bcrypt.compare(password, userPassword) : await bcrypt.compare(dummyHash, dummyHash);

    if (!user || !passwordMatch || !user.verified || user.is_honeytoken) {
      await logAttempt(ip + email);
      await randomDelay();
      return { statusCode: 401, body: JSON.stringify({ success: false, error: 'Invalid email or password' }) };
    }

    if (!passwordStrongEnough(password)) {
      return { statusCode: 400, body: JSON.stringify({ success: false, error: 'Password does not meet strength requirements' }) };
    }

    const deviceFingerprint = getDeviceFingerprint(event.headers, fingerprint);

    // CAPTCHA only on initial login
    if (!verification_code) {
      if (!(await verifyCaptcha(captcha_token, ip))) {
        await logAttempt(ip + email);
        await randomDelay();
        return { statusCode: 403, body: JSON.stringify({ success: false, error: 'CAPTCHA verification failed' }) };
      }
    }

    // ZERO TRUST: email verification required every login
    if (!verification_code) {
      const code = generateVerificationCode();
      const { error: upsertError } = await supabase.from('pending_verifications').upsert({
        email, code, fingerprint: deviceFingerprint,
        expires_at: new Date(Date.now() + 60 * 1000)
      }, { onConflict: ['email','fingerprint'] });

      if (upsertError) throw upsertError;
      await sendVerificationEmail(email, code);
      return { statusCode: 200, body: JSON.stringify({ success: true, verification_required: true, message: 'Verification code sent to your email. It expires in 1 minute.' }) };
    }

    // Verify email code
    const { data: pending } = await supabase.from('pending_verifications')
      .select('*')
      .eq('email', email)
      .eq('fingerprint', deviceFingerprint)
      .maybeSingle();

    if (!pending || pending.code !== verification_code || new Date(pending.expires_at) < new Date()) {
      return { statusCode: 401, body: JSON.stringify({ success: false, error: 'Invalid or expired verification code' }) };
    }

    await supabase.from('pending_verifications').delete()
      .eq('email', email)
      .eq('fingerprint', deviceFingerprint);

    // ===== UPDATED SESSION CREATION =====
    // Generate both UUID (for DB) and encrypted token (for cookie)
    const { uuid: sessionUuid, encryptedToken } = generateEncryptedTokenPair();
    const expiresInDays = remember_me ? 90 : 1;
    const expiresAt = new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000);

    // Check if session already exists for this user/device
    const { data: existingSession } = await supabase
      .from('sessions')
      .select('id, session_token')
      .eq('user_email', email)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    // Handle existing session - support both legacy and new formats
    if (existingSession) {
      const isLegacy = isLegacyToken(existingSession.session_token);
      
      if (isLegacy) {
        // Legacy session - update it with new UUID format
        const { error: updateError } = await supabase
          .from('sessions')
          .update({
            session_token: sessionUuid, // Convert to UUID format
            expires_at: expiresAt,
            verified: true,
            updated_at: new Date().toISOString()
          })
          .eq('id', existingSession.id);
        
        if (updateError) console.error('Failed to update legacy session:', updateError);
      } else {
        // Delete old session for this device to prevent accumulation
        await supabase
          .from('sessions')
          .delete()
          .eq('user_email', email)
          .eq('session_token', existingSession.session_token);
      }
    }

    // Insert new session with UUID in database
    const { error: sessionError } = await supabase.from('sessions').insert({
      user_email: email,
      session_token: sessionUuid, // ✅ Store UUID in database (no colons)
      expires_at: expiresAt,
      verified: true,
      created_at: new Date().toISOString(),
      device_fingerprint: deviceFingerprint // Optional: add this column to track devices
    });

    if (sessionError) {
      console.error('Session insert failed:', sessionError);
      return { statusCode: 500, body: JSON.stringify({ success: false, error: 'Failed to create session', details: sessionError.message }) };
    }

    // Update user's last fingerprint
    await supabase.from('users').update({ 
      last_fingerprint: deviceFingerprint,
      last_login: new Date().toISOString(),
      online: true 
    }).eq('email', email);

    // ===== BACKWARD COMPATIBILITY =====
    // Also maintain legacy sessions table if it exists (for older functions)
    try {
      const { data: legacyTable } = await supabase
        .from('user_sessions')
        .select('id')
        .limit(1)
        .maybeSingle();
      
      if (legacyTable) {
        await supabase.from('user_sessions').insert({
          user_id: user.id,
          session_key: sessionUuid,
          device_fingerprint: deviceFingerprint,
          expires_at: expiresAt,
          created_at: new Date().toISOString()
        }).catch(e => console.log('Legacy session insert skipped:', e.message));
      }
    } catch (e) {
      // Legacy table doesn't exist - ignore
    }

    // Return cookie with ENCRYPTED token + success
    return {
      statusCode: 200,
      headers: {
        'Set-Cookie': `__Host-session_secure=${encryptedToken}; Path=/; HttpOnly; Secure; Max-Age=${expiresInDays * 24 * 60 * 60}; SameSite=Strict`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ 
        success: true, 
        message: 'Verification complete. Login successful!',
        session_token: sessionUuid, // For debugging if needed
        expires_at: expiresAt
      })
    };

  } catch (err) {
    console.error('LOGIN ERROR:', err);
    return { 
      statusCode: 500, 
      body: JSON.stringify({ 
        success: false, 
        error: 'Internal server error', 
        details: process.env.NODE_ENV === 'development' ? err.message : undefined 
      }) 
    };
  }
};
