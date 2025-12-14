import { createClient } from '@supabase/supabase-js';
import { v4 as uuidv4 } from 'uuid';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

export const handler = async (event) => {
  try {
    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, body: JSON.stringify({ success: false, error: 'Method not allowed' }) };
    }

    const body = JSON.parse(event.body);
    const { user_email, boteo_name, folder_data, is_public = false, id } = body;

    if (!user_email || !boteo_name || !folder_data) {
      return { statusCode: 400, body: JSON.stringify({ success: false, error: 'Missing required fields.' }) };
    }

    // Generate .wdb metadata
    const wdb_files = Object.keys(folder_data).map(fileName => ({
      file_name: fileName,
      created_at: new Date().toISOString(),
      size: folder_data[fileName].length || 0
    }));

    let data, error;
    if (id) {
      // Update existing Boteo
      ({ data, error } = await supabase
        .from('boteos')
        .update({ boteo_name, folder_data, wdb_files, is_public })
        .eq('id', id)
        .select()
        .single());
    } else {
      // Insert new Boteo
      ({ data, error } = await supabase
        .from('boteos')
        .insert([{
          id: uuidv4(),
          user_email,
          boteo_name,
          folder_data,
          wdb_files,
          is_public,
          created_at: new Date(),
          votes: 0
        }])
        .select()
        .single());
    }

    if (error) throw error;

    return {
      statusCode: 200,
      body: JSON.stringify({ success: true, boteo: data })
    };

  } catch (err) {
    console.error('Boteo error:', err);
    return { statusCode: 500, body: JSON.stringify({ success: false, error: 'Failed to process Boteo.' }) };
  }
};
