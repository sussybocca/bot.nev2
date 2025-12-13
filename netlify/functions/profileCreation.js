import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

export const handler = async (event) => {
  try {
    if (event.httpMethod !== "POST") {
      return { statusCode: 405, body: JSON.stringify({ success: false, error: 'Method not allowed' }) };
    }

    const { email, step, username, bio, profile_picture, fbx_avatar_ids } = JSON.parse(event.body);

    if (!email || !step) {
      return { statusCode: 400, body: JSON.stringify({ success: false, error: 'Email and step are required.' }) };
    }

    // Fetch or create user
    let { data: user, error: fetchError } = await supabase
      .from('users')
      .select('*')
      .eq('email', email)
      .single();

    if (fetchError || !user) {
      // Create user record with minimal data
      const { data: newUser, error: insertError } = await supabase
        .from('users')
        .insert({ email, completed_profile: false })
        .select()
        .single();

      if (insertError) {
        return { statusCode: 500, body: JSON.stringify({ success: false, error: 'Failed to create new user.' }) };
      }

      user = newUser;
    }

    const updates = {};

    // Handle each step
    switch (step) {
      case 1: // Username + bio
        if (!username || !bio) {
          return { statusCode: 400, body: JSON.stringify({ success: false, error: 'Username and bio are required.' }) };
        }
        updates.username = username;
        updates.bio = bio;
        break;

      case 2: // Profile picture
        if (!profile_picture) {
          return { statusCode: 400, body: JSON.stringify({ success: false, error: 'Profile picture is required.' }) };
        }
        updates.profile_picture = profile_picture;
        break;

      case 3: // FBX avatars
        if (!fbx_avatar_ids || !Array.isArray(fbx_avatar_ids) || fbx_avatar_ids.length > 3) {
          return { statusCode: 400, body: JSON.stringify({ success: false, error: 'Must select up to 3 FBX avatars.' }) };
        }
        updates.fbx_avatar_ids = fbx_avatar_ids;
        break;

      case 4: // Complete profile
        updates.completed_profile = true;
        break;

      default:
        return { statusCode: 400, body: JSON.stringify({ success: false, error: 'Invalid step.' }) };
    }

    // Apply updates
    const { data: updatedUser, error: updateError } = await supabase
      .from('users')
      .update(updates)
      .eq('email', email)
      .select()
      .single();

    if (updateError) throw updateError;

    return {
      statusCode: 200,
      body: JSON.stringify({ success: true, message: `Step ${step} completed successfully!`, data: updatedUser })
    };

  } catch (err) {
    console.error(err);
    return {
      statusCode: 500,
      body: JSON.stringify({ success: false, error: 'Profile creation failed.' })
    };
  }
};
