import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// limit of real signups
const LIMIT = 100;

// test credentials stored in Netlify env vars
const TEST_EMAIL = process.env.TEST_EMAIL;
const TEST_PASSWORD = process.env.TEST_PASSWORD;

export const handler = async (event) => {
  try {
    // get email from frontend
    const data = JSON.parse(event.body || "{}");
    const email = data.email || null;

    // count users
    const { count, error } = await supabase
      .from('users')
      .select('*', { count: 'exact', head: true });

    if (error) throw error;

    // allow if under limit OR email matches test account
    const allowed = (count < LIMIT) || (email === TEST_EMAIL);

    return {
      statusCode: 200,
      body: JSON.stringify({
        allowed,
        count,
        email,
        testCredentials: {
          email: TEST_EMAIL,
          password: TEST_PASSWORD
        }
      })
    };

  } catch (err) {
    console.error("USER LIMIT ERROR:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({ allowed: false, error: err.message })
    };
  }
};
