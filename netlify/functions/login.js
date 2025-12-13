import { createClient } from '@supabase/supabase-js';
import bcrypt from 'bcrypt';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

export const handler = async (event) => {
  try {
    const { email, password } = JSON.parse(event.body);

    const { data: user, error } = await supabase
      .from('users')
      .select('*')
      .eq('email', email)
      .single();

    if (error || !user) return { statusCode: 400, body: JSON.stringify({ success: false, error: 'User not found.' }) };

    const match = await bcrypt.compare(password, user.password);
    if (!match) return { statusCode: 401, body: JSON.stringify({ success: false, error: 'Incorrect password.' }) };

    if (!user.verified) return { statusCode: 403, body: JSON.stringify({ success: false, error: 'Email not verified.' }) };

    return { statusCode: 200, body: JSON.stringify({ success: true, message: 'Login successful!', user: { username: user.username, email: user.email } }) };

  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: JSON.stringify({ success: false, error: 'Login failed.' }) };
  }
};
