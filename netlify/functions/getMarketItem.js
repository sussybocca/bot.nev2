import { createClient } from '@supabase/supabase-js';
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

export const handler = async (event) => {
  try {
    const type = event.queryStringParameters?.type || 'boteos';
    const { data, error } = await supabase
      .from(type)
      .select('*')
      .order('votes', { ascending: false })
      .limit(100); // Return top 100

    if (error) throw error;

    return {
      statusCode: 200,
      body: JSON.stringify({ success: true, items: data })
    };
  } catch (err) {
    console.error('Market fetch error:', err);
    return { statusCode: 500, body: JSON.stringify({ success: false, error: 'Failed to fetch items.' }) };
  }
};
