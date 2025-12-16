import { createClient } from '@supabase/supabase-js';
import bcrypt from 'bcrypt';
import { v4 as uuidv4 } from 'uuid';

import { verifyCaptcha } from './verifyCaptcha.js';
import { checkRateLimit, logAttempt } from './rateLimit.js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

export const handler = async (event) => {
  try {
    const ip =
      event.headers['x-forwarded-for'] ||
      event.headers['client-ip'] ||
      'unknown';

    const { email, password, remember_me, captcha_token } =
      JSON.parse(event.body);

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

    // 🤖 CAPTCHA verification
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

    // Fetch user
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

    // Check password
    const match = await bcrypt.compare(password, user.password);
    if (!match) {
      await logAttempt(ip);
      return {
        statusCode: 401,
        body: JSON.stringify({
          success: false,
          error: 'Incorrect password'
        })
      };
    }

    // Manual verification (kept exactly as you want)
    if (!user.verified) {
      return {
        statusCode: 403,
        body: JSON.stringify({
          success: false,
          error: 'Email not verified'
        })
      };
    }

    // Generate session
    const session_token = uuidv4();
    const expiresInDays = remember_me ? 90 : 1;

    await supabase.from('sessions').insert({
      user_email: email,
      session_token,
      expires_at: new Date(
        Date.now() + expiresInDays * 24 * 60 * 60 * 1000
      )
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
      body: JSON.stringify({
        success: false,
        error: 'Internal server error'
      })
    };
  }
};
