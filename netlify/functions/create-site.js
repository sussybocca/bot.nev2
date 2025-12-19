import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

// Helper: split large string into chunks of maxChunkSize bytes
function chunkString(str, maxChunkSize = 50000) {
  const chunks = [];
  let start = 0;
  while (start < str.length) {
    chunks.push(str.slice(start, start + maxChunkSize));
    start += maxChunkSize;
  }
  return chunks;
}

export const handler = async (event) => {
  try {
    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) };
    }

    let body;
    try {
      body = JSON.parse(event.body || '{}');
    } catch (parseError) {
      console.error('JSON parse error:', parseError);
      return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON body', details: parseError.message }) };
    }

    const { user_id, site_name, files } = body;

    // Validate inputs
    if (!user_id || !site_name) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Missing user_id or site_name' }) };
    }

    if (!/^[a-z0-9-]{3,30}$/.test(site_name)) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Invalid site name. Only lowercase letters, numbers, and - allowed.' }) };
    }

    if (!files || typeof files !== 'object') {
      return { statusCode: 400, body: JSON.stringify({ error: 'Missing or invalid files object' }) };
    }

    // Check if the subdomain already exists
    const { data: existing, error: selectError } = await supabase
      .from('sites')
      .select('subdomain')
      .eq('subdomain', site_name)
      .maybeSingle();

    if (selectError) {
      console.error('Supabase select error:', selectError);
      return { statusCode: 500, body: JSON.stringify({ error: 'Supabase select error', details: selectError.message }) };
    }

    if (existing) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Subdomain already exists' }) };
    }

    // Split each file content into chunks
    const chunkedFiles = {};
    for (const [filename, content] of Object.entries(files)) {
      chunkedFiles[filename] = chunkString(content, 50000); // 50 KB per chunk
    }

    // Set expiration one month from now
    const expires_at = new Date();
    expires_at.setMonth(expires_at.getMonth() + 1);

    // Insert new site with chunked files

  const { error: insertError } = await supabase
  .from('sites')
  .insert({
    user_id: user_id || null,  // <-- if no user, insert null
    subdomain: site_name,
    files: chunkedFiles,
    expires_at,
    created_at: new Date()
  });


      if (insertError) {
      console.error('Supabase insert error:', insertError);
      return { statusCode: 500, body: JSON.stringify({ error: 'Supabase insert error', details: insertError.message }) };
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        message: 'Site created successfully',
        url: `https://${site_name}.fire-usa.com`
      })
    };

  } catch (err) {
    console.error('Unhandled create-site error:', err);
    return { statusCode: 500, body: JSON.stringify({ error: 'Unhandled error', details: err.message }) };
  }
};
