import { createClient } from '@supabase/supabase-js';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';

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
    if (!tableName) return { statusCode: 400, body: JSON.stringify({ success: false, error: 'Invalid item_type' }) };

    const { data, error } = await supabase
      .from(tableName)
      .select('*')
      .eq('id', item_id)
      .single();

    if (error || !data) throw error || new Error('Item not found');

    const zip = new JSZip();
    Object.entries(data.folder_data).forEach(([fileName, content]) => {
      zip.file(fileName, content);
    });

    const content = await zip.generateAsync({ type: 'nodebuffer' });

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename=${data.boteo_name || 'backup'}.zip`
      },
      body: content.toString('base64'),
      isBase64Encoded: true
    };

  } catch (err) {
    console.error('backupItem error:', err);
    return { statusCode: 500, body: JSON.stringify({ success: false, error: 'Failed to create backup' }) };
  }
};
