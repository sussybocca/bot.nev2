import { createClient } from '@supabase/supabase-js';
import { v4 as uuidv4 } from 'uuid';
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

export const handler = async (event) => {
  try {
    if (event.httpMethod !== 'POST') return { statusCode: 405 };

    const { user_email, item_type, item_id, vote_value } = JSON.parse(event.body);
    if (!user_email || !item_type || !item_id || ![1, -1].includes(vote_value)) {
      return { statusCode: 400, body: JSON.stringify({ success: false, error: 'Invalid input' }) };
    }

    // Record vote
    await supabase.from('votes').insert({
      id: uuidv4(),
      user_email,
      item_type,
      item_id,
      vote_value
    });

    // Update item vote count
    const { data, error } = await supabase
      .from(item_type)
      .update({ votes: supabase.raw('votes + ?', [vote_value]) })
      .eq('id', item_id)
      .select()
      .single();

    if (error) throw error;

    return { statusCode: 200, body: JSON.stringify({ success: true, new_votes: data.votes }) };

  } catch (err) {
    console.error('Vote error:', err);
    return { statusCode: 500, body: JSON.stringify({ success: false, error: 'Vote failed' }) };
  }
};
