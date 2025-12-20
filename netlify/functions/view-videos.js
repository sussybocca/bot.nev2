// netlify/functions/view-videos.js
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY; // server-only
const supabase = createClient(supabaseUrl, supabaseKey);

export const handler = async () => {
  try {
    // List all files in the 'videos' storage bucket
    const { data: files, error: listError } = await supabase
      .storage
      .from('videos')
      .list('', { limit: 100, offset: 0 });

    if (listError) return { statusCode: 500, body: listError.message };
    if (!files || files.length === 0) return { statusCode: 200, body: JSON.stringify([]) };

    const videosWithUser = await Promise.all(
      files.map(async (file) => {
        // Create signed URL for the video
        const { data: signedUrlData, error: signedUrlError } = await supabase
          .storage
          .from('videos')
          .createSignedUrl(file.name, 3600); // 1 hour expiry

        if (signedUrlError) return null;

        // Get video metadata from videos table
        const { data: videoRecord, error: videoError } = await supabase
          .from('videos')
          .select('user_id, created_at')
          .eq('video_url', file.name)
          .maybeSingle();

        if (videoError || !videoRecord) return null;

        // Fetch user info from users table
        const { data: userData, error: userError } = await supabase
          .from('users')
          .select('id, email')
          .eq('id', videoRecord.user_id)
          .maybeSingle();

        // Safely handle returned user
        const user = userData ? { id: userData.id, email: userData.email } : null;

        // Convert created_at string to ISO string to avoid Invalid Date
        const uploaded_at = videoRecord.created_at
          ? new Date(videoRecord.created_at).toISOString()
          : null;

        return {
          name: file.name,
          size: file.size,
          uploaded_at,
          videoUrl: signedUrlData.signedUrl,
          user
        };
      })
    );

    // Remove any nulls in case some lookups failed
    const filteredVideos = videosWithUser.filter(v => v);

    return {
      statusCode: 200,
      body: JSON.stringify(filteredVideos)
    };
  } catch (err) {
    return { statusCode: 500, body: err.message };
  }
};
