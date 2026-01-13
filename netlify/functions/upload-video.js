import { createClient } from '@supabase/supabase-js';
import busboy from 'busboy';
import { v4 as uuidv4 } from 'uuid';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB

export const config = { api: { bodyParser: false } };

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

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');

  const cookieHeader = req.headers.cookie || '';
  const userEmail = await verifySession(cookieHeader);
  if (!userEmail) return res.status(401).send('Unauthorized');

  const { data: user } = await supabase.from('users').select('id').eq('email', userEmail).maybeSingle();
  if (!user) return res.status(401).send('User not found');
  const userId = user.id;

  const bb = busboy({ headers: req.headers, limits: { fileSize: MAX_FILE_SIZE } });

  let videoBuffer = null;
  let coverBuffer = null;
  let videoFilename = '';
  let coverFilename = '';
  let originalVideoName = '';
  let originalCoverName = '';
  let videoTitle = '';

  bb.on('field', (fieldname, val) => {
    if (fieldname === 'title') videoTitle = val.trim();
  });

  bb.on('file', (fieldname, file, info) => {
    const safeName = info.filename.replace(/[^a-z0-9_\-\.]/gi, '_');
    const chunks = [];
    let totalSize = 0;

    file.on('data', (chunk) => {
      totalSize += chunk.length;
      if (totalSize > MAX_FILE_SIZE) {
        file.resume();
        return res.status(400).send('File too large');
      }
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

  bb.on('error', (err) => res.status(500).send('Upload error: ' + err.message));

  bb.on('finish', async () => {
    if (!videoBuffer) return res.status(400).send('No video uploaded.');
    if (!coverBuffer) return res.status(400).send('Cover art is required.');
    if (!videoTitle) return res.status(400).send('Video title is required.');

    // Upload video
    const { error: videoError } = await supabase.storage.from('videos').upload(videoFilename, videoBuffer, {
      contentType: 'video/mp4',
      upsert: false,
    });
    if (videoError) {
      console.error('Video upload failed:', videoError);
      return res.status(500).send(videoError.message);
    }

    // Upload cover
    const { error: coverError } = await supabase.storage.from('covers').upload(coverFilename, coverBuffer, {
      contentType: 'image/png',
      upsert: false,
    });
    if (coverError) {
      console.error('Cover upload failed:', coverError);
      return res.status(500).send(coverError.message);
    }

    // Insert into database
    const { error: insertError } = await supabase.from('videos').insert([{
      user_id: userId,
      video_url: videoFilename,
      cover_url: coverFilename,
      title: videoTitle,
      original_filename: originalVideoName,
      created_at: new Date(),
      mime_type: 'video/mp4',
      size: videoBuffer.length,
    }]);
    if (insertError) {
      console.error('Database insert failed:', insertError);
      return res.status(500).send(insertError.message);
    }

    res.status(200).json({ message: 'Upload successful!' });
  });

  req.pipe(bb);
}
