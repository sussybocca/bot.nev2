import { createClient } from '@supabase/supabase-js';
import bcrypt from 'bcrypt';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

export const handler = async (event) => {
  try {
    if (event.httpMethod !== "POST") {
      return { statusCode: 405, body: JSON.stringify({ success: false, error: 'Method not allowed' }) };
    }

    const cookies = event.headers.cookie || '';
    const match = cookies.match(/session_token=([^;]+)/);
    const session_token = match ? match[1] : null;

    if (!session_token) {
      return { statusCode: 401, body: JSON.stringify({ success: false, error: 'Unauthorized: No session token.' }) };
    }

    // Verify session
    const { data: sessionData } = await supabase
      .from('sessions')
      .select('user_email')
      .eq('session_token', session_token)
      .single();

    if (!sessionData) {
      return { statusCode: 401, body: JSON.stringify({ success: false, error: 'Invalid session.' }) };
    }

    const user_email = sessionData.user_email;

    // Fetch user
    const { data: user } = await supabase
      .from('users')
      .select('*')
      .eq('email', user_email)
      .single();

    if (!user) {
      return { statusCode: 404, body: JSON.stringify({ success: false, error: 'User not found.' }) };
    }

    const {
      step,
      username,
      bio,
      profile_picture,
      fbx_avatar_ids,
      online_status,
      new_password,
      current_password
    } = JSON.parse(event.body || '{}');

    let updates = {};

    // Profile creation steps
    switch(step){
      case 1:
        if(!username || !bio) return { statusCode:400, body:JSON.stringify({success:false, error:'Username and bio required'})};
        updates.username = username;
        updates.bio = bio;
        break;
      case 2:
        if(!profile_picture) return { statusCode:400, body:JSON.stringify({success:false, error:'Profile picture required'})};
        updates.profile_picture = profile_picture;
        break;
      case 3:
        if(!fbx_avatar_ids || !Array.isArray(fbx_avatar_ids) || fbx_avatar_ids.length > 3) 
          return { statusCode:400, body:JSON.stringify({success:false, error:'Select up to 3 FBX avatars'})};
        updates.fbx_avatar_ids = fbx_avatar_ids;
        break;
      case 4:
        updates.completed_profile = true;
        break;
      default:
        if(username) updates.username=username;
        if(bio) updates.bio=bio;
        if(profile_picture) updates.profile_picture=profile_picture;
        if(fbx_avatar_ids) updates.fbx_avatar_ids=fbx_avatar_ids;
        break;
    }

    // Online status
    if(online_status){
      if(!['online','offline'].includes(online_status)) 
        return { statusCode:400, body:JSON.stringify({success:false, error:'Invalid online_status'})};
      updates.online_status = online_status;
      updates.last_online = new Date().toISOString();
    }

    // Change password
    if(new_password){
      if(!current_password) return { statusCode:400, body:JSON.stringify({success:false, error:'Current password required'})};
      const match = await bcrypt.compare(current_password, user.password);
      if(!match) return { statusCode:401, body:JSON.stringify({success:false, error:'Incorrect current password'})};
      updates.password = await bcrypt.hash(new_password, 10);
    }

    // Remove undefined values
    updates = Object.fromEntries(Object.entries(updates).filter(([_,v])=>v!==undefined));

    // Apply updates
    const { data: updatedUser, error: updateError } = await supabase
      .from('users')
      .update(updates)
      .eq('email', user_email)
      .select()
      .single();

    if(updateError) return { statusCode:500, body:JSON.stringify({success:false, error:'Failed to update profile', details:updateError})};

    return { statusCode:200, body:JSON.stringify({success:true, message:'Profile updated successfully!', user:{...user,...updatedUser,password:undefined}})};

  } catch(err){
    console.error('ProfileCreation error:', err);
    return { statusCode:500, body:JSON.stringify({success:false, error:'Internal server error', details:err.message})};
  }
};
