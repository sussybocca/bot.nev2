// netlify/functions/view-videos.js
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY; // server-only
const supabase = createClient(supabaseUrl, supabaseKey);

export const handler = async () => {
  try {
    // List all files in the 'videos' bucket
    const { data: files, error: listError } = await supabase
      .storage
      .from('videos')
      .list('', { limit: 100, offset: 0, sortBy: { column: 'created_at', order: 'desc' } });

    if (listError) {
      return { statusCode: 500, body: listError.message };
    }

    // Create signed URLs for each video
    const videosWithUrls = await Promise.all(
      files.map(async (file) => {
        const { data: signedUrlData, error: signedUrlError } = await supabase
          .storage
          .from('videos')
          .createSignedUrl(file.name, 3600); // 1 hour expiry

        if (signedUrlError) return null;
        return {
          name: file.name,
          size: file.size,
          updated_at: file.updated_at,
          videoUrl: signedUrlData.signedUrl
        };
      })
    );

    const filteredVideos = videosWithUrls.filter(v => v); // remove any nulls

    return {
      statusCode: 200,
      body: JSON.stringify(filteredVideos)
    };
  } catch (err) {
    return { statusCode: 500, body: err.message };
  }
};
