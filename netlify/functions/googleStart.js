export const handler = async () => {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const redirectUri = `${process.env.SITE_URL}`;

  const scope = encodeURIComponent(
    'openid email profile'
  );

  const authUrl =
    `https://accounts.google.com/o/oauth2/v2/auth` +
    `?client_id=${clientId}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&response_type=code` +
    `&scope=${scope}` +
    `&prompt=consent`;

  return {
    statusCode: 302,
    headers: {
      Location: authUrl
    }
  };
};
