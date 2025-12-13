import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

export const handler = async () => {
  try {
    const { data: bots, error } = await supabase
      .from('bots') // make sure you have a "bots" table
      .select('id, name, description, profile_picture, fbx_model_id, paid_link, price_points, created_at')
      .order('created_at', { ascending: false });

    if (error) throw error;

    return {
      statusCode: 200,
      body: JSON.stringify(bots)
    };
  } catch (err) {
    console.error(err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Failed to load marketplace bots.' })
    };
  }
};
