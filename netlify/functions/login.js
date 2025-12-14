import { createClient } from '@supabase/supabase-js';
import bcrypt from 'bcrypt';
import { v4 as uuidv4 } from 'uuid';
import jwt from 'jsonwebtoken';

// Use Netlify environment variables
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const JWT_SECRET = process.env.JWT_SECRET;

if (!SUPABASE_URL || !SUPABASE_KEY || !JWT_SECRET) {
  throw new Error("Missing required environment variables!");
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

export const handler = async (event) => {
  try {
    const { email, password, remember_me } = JSON.parse(event.body);

    // Fetch user
    const { data: user, error } = await supabase
      .from('users')
      .select('*')
      .eq('email', email)
      .single();

    if (error || !user) {
      return { statusCode: 400, body: JSON.stringify({ success: false, error: 'User not found' }) };
    }

    // Check password
    const match = await bcrypt.compare(password, user.password);
    if (!match) {
      return { statusCode: 401, body: JSON.stringify({ success: false, error: 'Incorrect password' }) };
    }

    // Check verified
    if (!user.verified) {
      return { statusCode: 403, body: JSON.stringify({ success: false, error: 'Email not verified' }) };
    }

    // Generate JWT token
    const tokenPayload = { email: user.email, username: user.username };
    const tokenOptions = remember_me ? { expiresIn: '90d' } : { expiresIn: '1d' };
    const token = jwt.sign(tokenPayload, JWT_SECRET, tokenOptions);

    // Optionally save session token in DB if persistent session
    if (remember_me) {
      const session_token = uuidv4();
      const expires_at = new Date();
      expires_at.setMonth(expires_at.getMonth() + 3);

      await supabase.from('sessions').insert({
        user_email: email,
        session_token,
        expires_at
      });
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        message: 'Login successful!',
        token // JWT for frontend
      })
    };

  } catch (err) {
    console.error(err);
    return {
      statusCode: 500,
      body: JSON.stringify({ success: false, error: 'Login failed' })
    };
  }
};
