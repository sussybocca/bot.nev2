import { createClient } from '@supabase/supabase-js';
import busboy from 'busboy';
import { v4 as uuidv4 } from 'uuid';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB

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
    let videoBuffer = null;
    let coverBuffer = null;
    let videoFilename = '';
    let coverFilename = '';
    let originalVideoName = '';
    let originalCoverName = '';

    bb.on('file', (fieldname, file, info) => {
      const safeName = info.filename.replace(/[^a-z0-9_\-\.]/gi, '_');
      const chunks = [];
      let totalSize = 0;

      file.on('data', (chunk) => {
        totalSize += chunk.length;
        if (totalSize > MAX_FILE_SIZE) return resolve({ statusCode: 400, body: 'File too large.' });
        chunks.push(chunk);
      });

      file.on('end', () => {
        const buffer = Buffer.concat(chunks);
        if (fieldname === 'video') {
          originalVideoName = info.filename;
          videoFilename = `${Date.now()}_${uuidv4()}_${safeName}`;
          videoBuffer = buffer;
        } else if (fieldname === 'cover') {
          originalCoverName = info.filename;
          coverFilename = `${Date.now()}_${uuidv4()}_${safeName}`;
          coverBuffer = buffer;
        }
      });
    });

    bb.on('error', (err) => resolve({ statusCode: 500, body: 'Upload error: ' + err.message }));

    bb.on('finish', async () => {
      // Require both video and cover art
      if (!videoBuffer) return resolve({ statusCode: 400, body: 'No video uploaded.' });
      if (!coverBuffer) return resolve({ statusCode: 400, body: 'Cover art is required.' });

      // Upload video to private bucket
      const { error: videoError } = await supabase.storage.from('videos').upload(videoFilename, videoBuffer, { contentType: 'video/mp4', upsert: false });
      if (videoError) return resolve({ statusCode: 500, body: videoError.message });

      // Upload cover art
      const { error: coverError } = await supabase.storage.from('covers').upload(coverFilename, coverBuffer, { contentType: 'image/png', upsert: false });
      if (coverError) return resolve({ statusCode: 500, body: coverError.message });

      // Insert into database
      const { error: insertError } = await supabase.from('videos').insert([{
        user_id: userId,
        video_url: videoFilename,
        cover_url: coverFilename,
        original_filename: originalVideoName,
        created_at: new Date()
      }]);
      if (insertError) return resolve({ statusCode: 500, body: insertError.message });

      resolve({ statusCode: 200, body: JSON.stringify({ message: 'Upload successful! Cover art required.' }) });
    });

    bb.end(Buffer.from(event.body, event.isBase64Encoded ? 'base64' : 'utf8'));
  });
};
