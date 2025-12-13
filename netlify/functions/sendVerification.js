import nodemailer from "nodemailer";

export const handler = async (event) => {
  try {
    const { email, username, code } = JSON.parse(event.body);

    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
      },
    });

    await transporter.sendMail({
      from: `"Botnev Team" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: "Your Botnev Verification Code",
      text: `Hello ${username},

Your verification code is: ${code}

This verification code is required to ensure the security of your Botnev account. Enter this code during signup to complete your registration. This code is one-time use only.

For support, contact us at: support@botnev.com

Best regards,
The Botnev Team`,
    });

    return {
      statusCode: 200,
      body: JSON.stringify({ success: true, message: "Verification email sent!" }),
    };
  } catch (err) {
    console.error("Error sending email:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({ success: false, error: "Failed to send verification email." }),
    };
  }
};
