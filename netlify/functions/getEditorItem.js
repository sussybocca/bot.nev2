import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

export const handler = async (event) => {
  try {
    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, body: JSON.stringify({ success: false, error: 'Method not allowed' }) };
    }

    const { item_id, item_type } = JSON.parse(event.body);

    if (!item_id || !item_type) {
      return { statusCode: 400, body: JSON.stringify({ success: false, error: 'Missing item_id or item_type' }) };
    }

    const tableMap = {
      boteos: 'boteos',
      projects: 'projects',
      webapps: 'webapps'
    };

    const tableName = tableMap[item_type.toLowerCase()];
    if (!tableName) {
      return { statusCode: 400, body: JSON.stringify({ success: false, error: 'Invalid item_type' }) };
    }

    const { data, error } = await supabase
      .from(tableName)
      .select('*')
      .eq('id', item_id)
      .single();

    if (error) throw error;

    return {
      statusCode: 200,
      body: JSON.stringify({ success: true, item: data })
    };

  } catch (err) {
    console.error('getEditorItem error:', err);
    return { statusCode: 500, body: JSON.stringify({ success: false, error: 'Failed to fetch editor item' }) };
  }
};
