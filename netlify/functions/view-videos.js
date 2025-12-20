// netlify/functions/view-videos.js
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY; // server-only
const supabase = createClient(supabaseUrl, supabaseKey);

// Verify session cookie
async function verifySession(cookieHeader) {
  if (!cookieHeader) return null;
  const cookies = cookieHeader.split(';').map(c => c.trim());
  const sessionCookie = cookies.find(c => c.startsWith('__Host-session_secure='));
  const sessionToken = sessionCookie ? sessionCookie.split('=')[1] : null;

  if (!sessionToken) return null;

  const { data: session } = await supabase
    .from('sessions')
    .select('*')
    .eq('session_token', sessionToken)
    .maybeSingle();

  if (!session || new Date(session.expires_at) < new Date() || !session.verified) return null;
  return session.user_email;
}

export const handler = async (event) => {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const cookieHeader = event.headers.cookie || '';
  const userEmail = await verifySession(cookieHeader);

  if (!userEmail) {
    return { statusCode: 401, body: 'Unauthorized: invalid or expired session.' };
  }

  try {
    // Fetch all videos
    const { data: videos, error } = await supabase
      .from('videos')
      .select('id, user_id, video_url, created_at')
      .order('created_at', { ascending: false });

    if (error) throw error;

    // Create signed URLs for each video (1 hour)
    const videosWithUrls = await Promise.all(videos.map(async (video) => {
      const { data: signedUrlData, error: signedUrlError } = await supabase
        .storage
        .from('videos')
        .createSignedUrl(video.video_url, 3600);

      return {
        id: video.id,
        user_id: video.user_id,
        videoUrl: signedUrlError ? null : signedUrlData.signedUrl,
        created_at: video.created_at
      };
    }));

    return {
      statusCode: 200,
      body: JSON.stringify(videosWithUrls)
    };

  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: 'Failed to fetch videos: ' + err.message };
  }
};
