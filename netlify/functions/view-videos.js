import { createClient } from '@supabase/supabase-js';
import videoMetadata from 'video-metadata-thumbnails';
import getVideoInfo from 'get-video-info';
import probe from 'probe-image-size';
import fetch from 'node-fetch';

// Supabase
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

export const handler = async () => {
  try {
    const { data: files, error: listError } = await supabase
      .storage
      .from('videos')
      .list('', { limit: 100, offset: 0 });

    if (listError) return { statusCode: 500, body: listError.message };
    if (!files?.length) return { statusCode: 200, body: JSON.stringify([]) };

    const results = await Promise.all(
      files.map(async (file) => {
        const { data: videoRecord } = await supabase
          .from('videos')
          .select('user_id, created_at, cover_url')
          .eq('video_url', file.name)
          .maybeSingle();

        if (!videoRecord) return null;

        const { data: signedVideo } = await supabase
          .storage.from('videos')
          .createSignedUrl(file.name, 3600);

        if (!signedVideo) return null;

        const videoBuffer = await fetch(signedVideo.signedUrl).then(r => r.arrayBuffer());

        // ================= METADATA =================
        let duration = null;
        let resolution = null;

        try {
          const meta = await videoMetadata(new Uint8Array(videoBuffer));
          duration = meta.duration;
          resolution = { width: meta.width, height: meta.height };
        } catch {
          try {
            const info = await new Promise((res, rej) =>
              getVideoInfo(Buffer.from(videoBuffer), (e, d) => e ? rej(e) : res(d))
            );
            duration = parseFloat(info.duration) || null;
            resolution = info.width && info.height
              ? { width: info.width, height: info.height }
              : null;
          } catch {}
        }

        // ================= COVER =================
        let coverUrl = null;
        let coverSize = null;

        if (videoRecord.cover_url) {
          const { data: signedCover } = await supabase
            .storage.from('covers')
            .createSignedUrl(videoRecord.cover_url, 3600);

          if (signedCover) {
            const coverBuffer = Buffer.from(
              await fetch(signedCover.signedUrl).then(r => r.arrayBuffer())
            );

            // get image dimensions without decoding entire file
            try {
              const probed = await probe(coverBuffer);
              coverSize = { width: probed.width, height: probed.height };
            } catch {}

            coverUrl = signedCover.signedUrl;
          }
        }

        // ================= USER =================
        const { data: userData } = await supabase
          .from('users')
          .select('id, email')
          .eq('id', videoRecord.user_id)
          .maybeSingle();

        return {
          name: file.name,
          size: file.size,
          uploaded_at: new Date(videoRecord.created_at).toISOString(),
          videoUrl: signedVideo.signedUrl,
          coverUrl,
          coverSize,
          duration,
          resolution,
          user: userData ? { id: userData.id, email: userData.email } : null
        };
      })
    );

    return {
      statusCode: 200,
      body: JSON.stringify(results.filter(Boolean))
    };

  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: err.message };
  }
};
