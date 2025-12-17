import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

export const handler = async (event) => {
  try {
    if(event.httpMethod !== "POST"){
      return { statusCode: 405, body: JSON.stringify({ success:false, error:"Method not allowed" }) };
    }

    const { email, code } = JSON.parse(event.body || '{}');

    if (!email || !code) {
      return { statusCode: 400, body: JSON.stringify({ success:false, error:"Email and code required" }) };
    }

    // Find user
    const { data: user, error } = await supabase
      .from('users')
      .select('*')
      .eq('email', email)
      .single();

    if (!user || error) {
      return { statusCode: 404, body: JSON.stringify({ success:false, error:"User not found" }) };
    }

    if(user.verified) {
      return { statusCode: 200, body: JSON.stringify({ success:true, message:"Already verified" }) };
    }

    if(user.verification_code !== code) {
      return { statusCode: 400, body: JSON.stringify({ success:false, error:"Invalid verification code" }) };
    }

    // Mark as verified
    const { error: updateError } = await supabase
      .from('users')
      .update({ verified: true, verification_code: null })
      .eq('email', email);

    if(updateError) throw updateError;

    return { statusCode: 200, body: JSON.stringify({ success:true, message:"Email verified successfully!" }) };

  } catch(err) {
    console.error(err);
    return { statusCode: 500, body: JSON.stringify({ success:false, error:"Failed to verify email" }) };
  }
};
