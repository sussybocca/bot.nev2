import { createClient } from '@supabase/supabase-js';
import bcrypt from 'bcrypt';
import { v4 as uuidv4 } from 'uuid';
import { checkRateLimit, logAttempt } from './rateLimit.js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

// Inline CAPTCHA verification using your backend secret key
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

export const handler = async (event) => {
  try {
    const ip =
      event.headers['x-forwarded-for'] ||
      event.headers['client-ip'] ||
      'unknown';

    const { email, password, remember_me, captcha_token, google } =
      JSON.parse(event.body);

    // ⚠ Google login branch first (skip CAPTCHA)
    if (google) {
      return {
        statusCode: 200,
        body: JSON.stringify({
          success: true,
          redirect: '/.netlify/functions/googleStart'
        })
      };
    }

    // 🔐 Rate limiting
    const allowed = await checkRateLimit(ip);
    if (!allowed) {
      return {
        statusCode: 429,
        body: JSON.stringify({
          success: false,
          error: 'Too many login attempts. Try again later.'
        })
      };
    }

    // 🤖 CAPTCHA verification (only for normal login)
    const captchaValid = await verifyCaptcha(captcha_token, ip);
    if (!captchaValid) {
      await logAttempt(ip);
      return {
        statusCode: 403,
        body: JSON.stringify({
          success: false,
          error: 'CAPTCHA verification failed'
        })
      };
    }

    // 🔐 Normal email/password login
    const { data: user, error } = await supabase
      .from('users')
      .select('*')
      .eq('email', email)
      .single();

    if (error || !user) {
      await logAttempt(ip);
      return {
        statusCode: 400,
        body: JSON.stringify({ success: false, error: 'User not found' })
      };
    }

    const match = await bcrypt.compare(password, user.password);
    if (!match) {
      await logAttempt(ip);
      return {
        statusCode: 401,
        body: JSON.stringify({ success: false, error: 'Incorrect password' })
      };
    }

    if (!user.verified) {
      return {
        statusCode: 403,
        body: JSON.stringify({ success: false, error: 'Email not verified' })
      };
    }

    // Generate session token
    const session_token = uuidv4();
    const expiresInDays = remember_me ? 90 : 1;

    await supabase.from('sessions').insert({
      user_email: email,
      session_token,
      expires_at: new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000)
    });

    return {
      statusCode: 200,
      headers: {
        'Set-Cookie': `session_token=${session_token}; Path=/; Max-Age=${
          expiresInDays * 24 * 60 * 60
        }; SameSite=Lax`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        success: true,
        message: 'Login successful!',
        session_token
      })
    };
  } catch (err) {
    console.error(err);
    return {
      statusCode: 500,
      body: JSON.stringify({ success: false, error: 'Internal server error' })
    };
  }
};
