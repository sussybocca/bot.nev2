import { createClient } from '@supabase/supabase-js';
import mime from 'mime-types';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

export const handler = async (event) => {
  try {
    const host = event.headers.host; 
    const subdomain = host.split('.')[0]; // abc.botnet2.netlify.app

    const path = event.path === '/' ? 'index.html' : event.path.slice(1);
    const filePath = `${subdomain}/${path}`;

    // Check if site exists and not expired
    const { data: siteData, error: siteError } = await supabase
      .from('sites')
      .select('expires_at')
      .eq('subdomain', subdomain)
      .single();

    if (!siteData || siteError) {
      return { statusCode: 404, body: 'Site not found' };
    }

    const expiresAt = new Date(siteData.expires_at);
    if (expiresAt < new Date()) {
      return { statusCode: 410, body: 'Site expired' };
    }

    // Download file from Supabase Storage
    const { data: fileData, error: fileError } = await supabase
      .storage
      .from('sites')
      .download(filePath);

    if (!fileData || fileError) {
      return { statusCode: 404, body: 'File not found' };
    }

    // Detect content type
    const contentType = mime.lookup(filePath) || 'application/octet-stream';
    const buffer = await fileData.arrayBuffer();
    const body = Buffer.from(buffer).toString('base64');

    return {
      statusCode: 200,
      isBase64Encoded: true,
      body,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'max-age=3600'
      }
    };
  } catch (err) {
    console.error('serve-site error:', err);
    return {
      statusCode: 500,
      body: 'Internal server error'
    };
  }
};
