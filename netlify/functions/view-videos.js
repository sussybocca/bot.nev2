import { createClient } from '@supabase/supabase-js';
import ffmpeg from 'fluent-ffmpeg';
import ffprobePath from 'ffprobe-static';
import { getVideoDurationInSeconds } from 'get-video-duration';
import sharp from 'sharp';
import fetch from 'node-fetch'; // ensure fetch is imported

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY; // server-only
const supabase = createClient(supabaseUrl, supabaseKey);

ffmpeg.setFfprobePath(ffprobePath.path);

export const handler = async () => {
  try {
    const { data: files, error: listError } = await supabase
      .storage
      .from('videos')
      .list('', { limit: 100, offset: 0 });

    if (listError) return { statusCode: 500, body: listError.message };
    if (!files || files.length === 0) return { statusCode: 200, body: JSON.stringify([]) };

    const videosWithUser = await Promise.all(
      files.map(async (file) => {
        const { data: videoRecord, error: videoError } = await supabase
          .from('videos')
          .select('user_id, created_at, cover_url')
          .eq('video_url', file.name)
          .maybeSingle();

        if (videoError || !videoRecord) return null;

        // Signed video URL
        const { data: signedVideoData, error: signedVideoError } = await supabase
          .storage
          .from('videos')
          .createSignedUrl(file.name, 3600);

        if (signedVideoError) return null;

        // Fetch video as buffer
        const videoBuffer = await fetch(signedVideoData.signedUrl).then(res => res.arrayBuffer());

        // Get duration (in seconds) using buffer
        let duration = null;
        try {
          duration = await getVideoDurationInSeconds(Buffer.from(videoBuffer));
        } catch (err) {
          console.error('Duration error', err);
        }

        // Get resolution via ffmpeg (buffer input)
        let resolution = null;
        try {
          const metadata = await new Promise((resolve, reject) => {
            ffmpeg(Buffer.from(videoBuffer))
              .ffprobe((err, data) => {
                if (err) reject(err);
                else resolve(data);
              });
          });
          if (metadata.streams && metadata.streams[0]) {
            resolution = {
              width: metadata.streams[0].width,
              height: metadata.streams[0].height
            };
          }
        } catch (err) {
          console.error('FFprobe error', err);
        }

        // Cover thumbnail (resize in memory)
        let coverUrl = null;
        if (videoRecord.cover_url) {
          const { data: signedCoverData, error: signedCoverError } = await supabase
            .storage
            .from('covers')
            .createSignedUrl(videoRecord.cover_url, 3600);

          if (!signedCoverError) {
            const coverBuffer = Buffer.from(await fetch(signedCoverData.signedUrl).then(r => r.arrayBuffer()));
            const thumbBuffer = await sharp(coverBuffer)
              .resize(320, 180)
              .toBuffer();
            // You could upload this thumbnail back to Supabase if needed
            coverUrl = signedCoverData.signedUrl;
          }
        }

        // User info
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
          duration,
          resolution,
          user
        };
      })
    );

    return {
      statusCode: 200,
      body: JSON.stringify(videosWithUser.filter(v => v))
    };
  } catch (err) {
    return { statusCode: 500, body: err.message };
  }
};
