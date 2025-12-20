// netlify/functions/upload-video.js
import { createClient } from '@supabase/supabase-js';
import busboy from 'busboy';
import { v4 as uuidv4 } from 'uuid';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

const MAX_FILE_SIZE = 50 * 1024 * 1024;

async function verifySession(cookieHeader) {
  if (!cookieHeader) return null;
  const cookies = cookieHeader.split(';').map(c => c.trim());
  const sessionCookie = cookies.find(c => c.startsWith('__Host-session_secure='));
  if (!sessionCookie) return null;

  const sessionToken = sessionCookie.split('=')[1];
  const { data: session } = await supabase
    .from('sessions')
    .select('*')
    .eq('session_token', sessionToken)
    .maybeSingle();

  if (!session || !session.verified || new Date(session.expires_at) < new Date()) return null;
  return session.user_email;
}

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };

  const cookieHeader = event.headers.cookie || '';
  const userEmail = await verifySession(cookieHeader);
  if (!userEmail) return { statusCode: 401, body: 'Unauthorized' };

  const { data: user } = await supabase.from('users').select('id').eq('email', userEmail).maybeSingle();
  if (!user) return { statusCode: 401, body: 'User not found' };
  const userId = user.id;

  return new Promise((resolve) => {
    const bb = busboy({ headers: event.headers, limits: { fileSize: MAX_FILE_SIZE } });
    let uploadBuffer = null;
    let filename = '';
    let originalFilename = '';

    bb.on('file', (fieldname, file, info) => {
      originalFilename = info.filename;
      const safeName = originalFilename.replace(/[^a-z0-9_\-\.]/gi, '_');
      filename = `${Date.now()}_${uuidv4()}_${safeName}`;

      const chunks = [];
      let totalSize = 0;

      file.on('data', (chunk) => {
        totalSize += chunk.length;
        if (totalSize > MAX_FILE_SIZE) return resolve({ statusCode: 400, body: 'File too large.' });
        chunks.push(chunk);
      });

      file.on('end', () => {
        uploadBuffer = Buffer.concat(chunks);
      });
    });

    bb.on('error', (err) => resolve({ statusCode: 500, body: 'Upload error: ' + err.message }));

    bb.on('finish', async () => {
      if (!uploadBuffer) return resolve({ statusCode: 400, body: 'No video uploaded.' });

      // Upload to storage
      const { error: storageError } = await supabase
        .storage
        .from('videos')
        .upload(filename, uploadBuffer, { contentType: 'video/mp4', upsert: false });
      if (storageError) return resolve({ statusCode: 500, body: storageError.message });

      // Insert metadata into table
      const { error: insertError } = await supabase
        .from('videos')
        .insert([{ user_id: userId, video_url: filename, original_filename: originalFilename, created_at: new Date() }]);
      if (insertError) return resolve({ statusCode: 500, body: insertError.message });

      // Create signed URL
      const { data: signedUrlData, error: signedUrlError } = await supabase
        .storage
        .from('videos')
        .createSignedUrl(filename, 3600);
      if (signedUrlError) return resolve({ statusCode: 500, body: signedUrlError.message });

      resolve({ statusCode: 200, body: JSON.stringify({ videoUrl: signedUrlData.signedUrl }) });
    });

    // Correctly handle base64 or raw
    bb.end(Buffer.from(event.body, event.isBase64Encoded ? 'base64' : 'utf8'));
  });
};
