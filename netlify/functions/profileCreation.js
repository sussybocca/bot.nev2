import { createClient } from '@supabase/supabase-js';
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import nodemailer from 'nodemailer';
import cookie from 'cookie';
import { v4 as uuidv4 } from 'uuid';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// Nodemailer setup
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS }
});

// AES-GCM encrypted token
function generateEncryptedToken() {
  const iv = crypto.randomBytes(16);
  const key = crypto.scryptSync(process.env.SESSION_SECRET, 'salt', 32);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv, { authTagLength: 16 });
  const uuid = uuidv4();
  const encrypted = cipher.update(uuid, 'utf8', 'hex') + cipher.final('hex');
  const tag = cipher.getAuthTag().toString('hex');
  return `${iv.toString('hex')}:${tag}:${encrypted}`;
}

// Send verification email
async function sendVerificationEmail(email, code) {
  await transporter.sendMail({
    from: process.env.EMAIL_USER,
    to: email,
    subject: 'Verify Your Device',
    text: `Your verification code is: ${code}\nIt expires in 15 minutes.`
  });
}

// Device fingerprint
function getDeviceFingerprint(headers, frontendFingerprint) {
  const source = frontendFingerprint || (headers['user-agent'] || '') + (headers['accept-language'] || '') + (headers['x-forwarded-for'] || '');
  return crypto.createHash('sha256').update(source).digest('hex');
}

// Verification code
function generateVerificationCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

export const handler = async (event) => {
  try {
    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, body: JSON.stringify({ success: false, error: 'Method not allowed' }) };
    }

    const body = JSON.parse(event.body || '{}');
    const { step, email, verification_code, frontendFingerprint, username, bio, profile_picture, fbx_avatar_ids, online_status, new_password, current_password } = body;

    // Parse existing cookies
    const cookies = cookie.parse(event.headers.cookie || '');
    let user_email = null;

    if (cookies['session_secure']) {
      const sessionToken = cookies['session_secure'];
      const { data: session } = await supabase.from('sessions')
        .select('user_email, expires_at')
        .eq('session_token', sessionToken)
        .maybeSingle();

      if (session && new Date(session.expires_at) > new Date()) {
        user_email = session.user_email;
      }
    }

    // Step 0: Email verification if no session
    if (!user_email) {
      if (!email) return { statusCode: 400, body: JSON.stringify({ success: false, error: 'Email is required' }) };

      if (!verification_code) {
        const code = generateVerificationCode();
        const fingerprint = getDeviceFingerprint(event.headers, frontendFingerprint);

        await supabase.from('pending_verifications').upsert({
          email, code, fingerprint,
          expires_at: new Date(Date.now() + 15 * 60 * 1000)
        }, { onConflict: ['email', 'fingerprint'] });

        await sendVerificationEmail(email, code);

        return { statusCode: 200, body: JSON.stringify({ success: true, verification_required: true, message: 'Verification code sent to email.' }) };
      }

      // Verify code
      const { data: pending } = await supabase.from('pending_verifications')
        .select('*').eq('email', email).maybeSingle();

      if (!pending || pending.code !== verification_code || new Date(pending.expires_at) < new Date()) {
        return { statusCode: 401, body: JSON.stringify({ success: false, error: 'Invalid or expired verification code' }) };
      }

      user_email = email;

      // Fetch or create user
      let { data: user } = await supabase.from('users').select('*').eq('email', email).maybeSingle();
      if (!user) {
        const { data: newUser, error: createError } = await supabase.from('users').insert({ email }).select().single();
        if (createError) throw createError;
        user = newUser;
      }

      // Create session cookie
      const session_token = generateEncryptedToken();
      const fingerprint = getDeviceFingerprint(event.headers, frontendFingerprint);
      await supabase.from('sessions').insert({
        user_email, session_token, fingerprint,
        expires_at: new Date(Date.now() + 90*24*60*60*1000),
        verified: true
      });

      await supabase.from('pending_verifications').delete().eq('email', email);

      return {
        statusCode: 200,
        headers: {
          'Set-Cookie': `session_secure=${session_token}; Path=/; HttpOnly; Secure; Max-Age=${90*24*60*60}; SameSite=Strict; Domain=fire-usa.com`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ success:true, message:'Device verified. Secure session created!', user:{...user,password:undefined} })
      };
    }

    // Step 1+: Profile updates
    let { data: user } = await supabase.from('users').select('*').eq('email', user_email).maybeSingle();
    if (!user) return { statusCode: 404, body: JSON.stringify({ success:false, error:'User not found' }) };

    let updates = {};
    if (step) {
      switch(step){
        case 1: if(!username||!bio) return { statusCode:400, body:JSON.stringify({success:false,error:'Username and bio required'})}; updates.username=username; updates.bio=bio; break;
        case 2: if(!profile_picture) return { statusCode:400, body:JSON.stringify({success:false,error:'Profile picture required'})}; updates.profile_picture=profile_picture; break;
        case 3: if(!fbx_avatar_ids || !Array.isArray(fbx_avatar_ids) || fbx_avatar_ids.length>3) return { statusCode:400, body:JSON.stringify({success:false,error:'Select up to 3 FBX avatars'})}; updates.fbx_avatar_ids=fbx_avatar_ids; break;
        case 4: updates.completed_profile=true; break;
        default: if(username) updates.username=username; if(bio) updates.bio=bio; if(profile_picture) updates.profile_picture=profile_picture; if(fbx_avatar_ids) updates.fbx_avatar_ids=fbx_avatar_ids;
      }

      // Online status
      if (online_status) {
        if (!['online','offline'].includes(online_status)) return { statusCode:400, body:JSON.stringify({success:false,error:'Invalid online_status'}) };
        updates.online_status=online_status;
        updates.last_online=new Date().toISOString();
      }

      // Password change
      if (new_password) {
        if (!current_password) return { statusCode:400, body:JSON.stringify({success:false,error:'Current password required'}) };
        const match = await bcrypt.compare(current_password, user.encrypted_password || user.password || '');
        if (!match) return { statusCode:401, body:JSON.stringify({success:false,error:'Incorrect current password'}) };
        updates.encrypted_password = await bcrypt.hash(new_password,10);
      }

      if (Object.keys(updates).length>0) {
        const { data: updatedUser, error: updateError } = await supabase.from('users')
          .update(updates)
          .eq('email', user_email)
          .select()
          .single();
        if (updateError) throw updateError;
        user = updatedUser;
      }
    }

    return { statusCode:200, body: JSON.stringify({ success:true, message:'Profile updated successfully!', user:{...user,password:undefined} }) };

  } catch(err){
    console.error('Secure profile error:', err);
    return { statusCode:500, body:JSON.stringify({success:false,error:'Internal server error',details:err.message})};
  }
};
