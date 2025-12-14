import { createClient } from '@supabase/supabase-js';
import { v4 as uuidv4 } from 'uuid';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

export const handler = async (event) => {
  try {
    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, body: JSON.stringify({ success: false, error: 'Method not allowed' }) };
    }

    const { user_email, folder_data, boteo_name } = JSON.parse(event.body);

    if (!user_email || !folder_data || !boteo_name) {
      return { statusCode: 400, body: JSON.stringify({ success: false, error: 'Missing required fields' }) };
    }

    // Generate .wdb metadata from folder_data
    const wdb_files = Object.keys(folder_data).map(fileName => ({
      file_name: fileName,
      size: folder_data[fileName].length || 0,
      created_at: new Date().toISOString()
    }));

    const { data, error } = await supabase
      .from('boteos')
      .insert([{
        id: uuidv4(),
        user_email,
        boteo_name,
        folder_data,
        wdb_files,
        is_public: false,
        created_at: new Date(),
        votes: 0
      }])
      .select()
      .single();

    if (error) throw error;

    return {
      statusCode: 200,
      body: JSON.stringify({ success: true, message: 'Folder uploaded as Boteo', boteo: data })
    };

  } catch (err) {
    console.error('uploadFolder error:', err);
    return { statusCode: 500, body: JSON.stringify({ success: false, error: 'Failed to upload folder' }) };
  }
};
