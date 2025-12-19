import { createClient } from '@supabase/supabase-js';
import busboy from 'busboy';

// Initialize Supabase with service role key (server-only)
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB max per video

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  // Authenticate user using a JWT token passed in headers
  const authHeader = event.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return { statusCode: 401, body: 'Unauthorized: missing token' };
  }
  const token = authHeader.split(' ')[1];

  const { data: userData, error: userError } = await supabase.auth.getUser(token);
  if (userError || !userData?.user) {
    return { statusCode: 401, body: 'Unauthorized: invalid token' };
  }
  const userId = userData.user.id;

  return new Promise((resolve, reject) => {
    const bb = busboy({ headers: event.headers, limits: { fileSize: MAX_FILE_SIZE } });
    let uploadBuffer = null;
    let filename = '';

    bb.on('file', (fieldname, file, info) => {
      const { filename: originalFilename, mimeType } = info;

      // Only accept MP4 files
      if (mimeType !== 'video/mp4' && !originalFilename.toLowerCase().endsWith('.mp4')) {
        return resolve({ statusCode: 400, body: 'Only MP4 videos are allowed.' });
      }

      // Sanitize filename
      const safeName = originalFilename.replace(/[^a-z0-9_\-\.]/gi, '_');
      filename = `${Date.now()}_${safeName}`;

      const chunks = [];
      let totalSize = 0;

      file.on('data', (chunk) => {
        totalSize += chunk.length;
        if (totalSize > MAX_FILE_SIZE) {
          return resolve({ statusCode: 400, body: 'File too large.' });
        }
        chunks.push(chunk);
      });

      file.on('end', () => {
        uploadBuffer = Buffer.concat(chunks);
      });
    });

    bb.on('close', async () => {
      if (!uploadBuffer) {
        return resolve({ statusCode: 400, body: 'No video uploaded.' });
      }

      // Upload securely to Supabase Storage
      const { error: storageError } = await supabase
        .storage
        .from('videos')
        .upload(filename, uploadBuffer, { contentType: 'video/mp4', upsert: false });

      if (storageError) {
        return resolve({ statusCode: 500, body: storageError.message });
      }

      // Generate a signed URL valid for 1 hour
      const { data: signedUrlData, error: signedUrlError } = supabase
        .storage
        .from('videos')
        .createSignedUrl(filename, 3600);

      if (signedUrlError) {
        return resolve({ statusCode: 500, body: signedUrlError.message });
      }

      // Insert metadata
      await supabase
        .from('videos')
        .insert([{ user_id: userId, video_url: filename }]);

      // Delete oldest videos if exceeding 100
      const { data: allVideos } = await supabase
        .from('videos')
        .select('id, video_url')
        .order('created_at', { ascending: true });

      if (allVideos.length > 100) {
        const videosToDelete = allVideos.slice(0, allVideos.length - 100);

        for (const video of videosToDelete) {
          await supabase.storage.from('videos').remove([video.video_url]);
          await supabase.from('videos').delete().eq('id', video.id);
        }
      }

      resolve({ statusCode: 200, body: JSON.stringify({ videoUrl: signedUrlData.signedUrl }) });
    });

    bb.write(event.body, event.isBase64Encoded ? 'base64' : 'binary');
    bb.end();
  });
};
