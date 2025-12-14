import { createClient } from '@supabase/supabase-js';
import bcrypt from 'bcrypt';
import { v4 as uuidv4 } from 'uuid';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

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
      return {
        statusCode: 400,
        body: JSON.stringify({ success: false, error: 'User not found' })
      };
    }

    // Check password
    const match = await bcrypt.compare(password, user.password);
    if (!match) {
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

    // Generate UUID session token
    const session_token = uuidv4();
    const expiresInDays = remember_me ? 90 : 1;

    // Save session in Supabase
    await supabase.from('sessions').insert({
      user_email: email,
      session_token,
      expires_at: new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000)
    });

    // Return cookie AND include token in JSON
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
        session_token // ← now included for frontend
      })
    };

  } catch (err) {
    console.error(err);
    return {
      statusCode: 500,
      body: JSON.stringify({ success: false, error: err.message })
    };
  }
};
