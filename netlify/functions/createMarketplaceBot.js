import { createClient } from '@supabase/supabase-js';
import { v4 as uuidv4 } from 'uuid';
import formidable from 'formidable-serverless';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    // Parse multipart/form-data using formidable
    const form = new formidable.IncomingForm();
    form.keepExtensions = true;

    const parseForm = () =>
      new Promise((resolve, reject) => {
        form.parse(event, (err, fields, files) => {
          if (err) reject(err);
          else resolve({ fields, files });
        });
      });

    const { fields, files } = await parseForm();

    const { name, description, seller_email, price_points, paid_link } = fields;
    const profile_picture_file = files.profile_picture_file;
    const fbx_file = files.fbx_file;

    if (!name || !description || !seller_email || !fbx_file) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Missing required fields or FBX file.' }) };
    }

    // Upload FBX to Supabase Storage
    const fbxId = uuidv4();
    const fbxExt = fbx_file.originalFilename.split('.').pop();
    const fbxPath = `fbx/${fbxId}.${fbxExt}`;
    const fbxUpload = await supabase.storage
      .from('bots')
      .upload(fbxPath, fbx_file.filepath, { cacheControl: '3600', upsert: true });

    if (fbxUpload.error) throw fbxUpload.error;
    const fbxUrl = supabase.storage.from('bots').getPublicUrl(fbxPath).publicURL;

    // Upload profile picture if provided
    let profile_picture_url = null;
    if (profile_picture_file) {
      const picId = uuidv4();
      const picExt = profile_picture_file.originalFilename.split('.').pop();
      const picPath = `profile_pictures/${picId}.${picExt}`;
      const picUpload = await supabase.storage
        .from('bots')
        .upload(picPath, profile_picture_file.filepath, { cacheControl: '3600', upsert: true });

      if (picUpload.error) throw picUpload.error;
      profile_picture_url = supabase.storage.from('bots').getPublicUrl(picPath).publicURL;
    }

    // Insert into database
    const { data, error } = await supabase
      .from('bots')
      .insert({
        id: uuidv4(),
        name,
        description,
        profile_picture: profile_picture_url,
        fbx_model_id: fbxUrl,
        paid_link: paid_link || null,
        price_points: parseInt(price_points) || 0,
        seller_email,
        created_at: new Date()
      })
      .select()
      .single();

    if (error) throw error;

    return { statusCode: 200, body: JSON.stringify({ success: true, bot: data }) };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: JSON.stringify({ error: 'Failed to create bot.' }) };
  }
};
