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
        // Get video metadata from videos table
        const { data: videoRecord, error: videoError } = await supabase
          .from('videos')
          .select('user_id, created_at, cover_url')
          .eq('video_url', file.name)
          .maybeSingle();

        if (videoError || !videoRecord) return null;

        // Create signed URL for the video
        const { data: signedVideoData, error: signedVideoError } = await supabase
          .storage
          .from('videos')
          .createSignedUrl(file.name, 3600);

        if (signedVideoError) return null;

        // Create signed URL for cover art if exists
        let coverUrl = null;
        if (videoRecord.cover_url) {
          const { data: signedCoverData, error: signedCoverError } = await supabase
            .storage
            .from('covers')
            .createSignedUrl(videoRecord.cover_url, 3600);
          if (!signedCoverError) coverUrl = signedCoverData.signedUrl;
        }

        // Fetch user info from users table
        const { data: userData } = await supabase
          .from('users')
          .select('id, email')
          .eq('id', videoRecord.user_id)
          .maybeSingle();

        const user = userData ? { id: userData.id, email: userData.email } : null;

        return {
          name: file.name,
          size: file.size,
          uploaded_at: videoRecord.created_at ? new Date(videoRecord.created_at).toISOString() : null,
          videoUrl: signedVideoData.signedUrl,
          coverUrl,
          user
        };
      })
    );

    const filteredVideos = videosWithUser.filter(v => v); // remove any nulls

    return {
      statusCode: 200,
      body: JSON.stringify(filteredVideos)
    };
  } catch (err) {
    return { statusCode: 500, body: err.message };
  }
};
