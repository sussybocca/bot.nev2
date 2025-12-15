import { createClient } from '@supabase/supabase-js';
import nodemailer from 'nodemailer';
import bcrypt from 'bcrypt';
import { v4 as uuidv4 } from 'uuid';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// -----------------------
// Password validation
// -----------------------
function validatePassword(password) {
  // Rule 1: >=30 characters
  if (password.length < 30) return false;
  // Rule 2: Capital letter at front
  if (!/[A-Z]/.test(password[0])) return false;
  // Rule 3: Ends with number
  if (!/[0-9]/.test(password.slice(-1))) return false;
  // Rule 4: At least 2 special characters anywhere
  if ((password.match(/[^A-Za-z0-9]/g) || []).length < 2) return false;

  return true;
}

// -----------------------
// Signup handler
// -----------------------
export const handler = async (event) => {
  try {
    let { email, username, password } = JSON.parse(event.body);

    if (!email || !password) {
      return {
        statusCode: 400,
        body: JSON.stringify({ success: false, error: 'Email and password are required.' })
      };
    }

    // Fallback username if not provided
    if (!username) {
      username = email.split('@')[0];
    }

    // Validate password
    if (!validatePassword(password)) {
      return {
        statusCode: 400,
        body: JSON.stringify({
          success: false,
          error: 'Password does not meet requirements.'
        })
      };
    }

    // Hash the password
    const hashed = await bcrypt.hash(password, 10);

    // Short verification code
    const verificationCode = uuidv4().split('-')[0];

    // Store user in Supabase with verified = false
    const { data, error } = await supabase
      .from('users')
      .insert({
        email,
        username,
        password: hashed,
        verified: false,
        verification_code: verificationCode
      });

    if (error) throw error;

    // Send verification email
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
      }
    });

    await transporter.sendMail({
      from: `"Botnev Team" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: "Your Botnev Verification Code",
      text: `Hello ${username},\n\nYour verification code is: ${verificationCode}\nUse this code to verify your account.`
    });

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        message: 'Signup successful, verification email sent!'
      })
    };

  } catch (err) {
    console.error(err);
    return {
      statusCode: 500,
      body: JSON.stringify({ success: false, error: 'Failed to signup.' })
    };
  }
};
