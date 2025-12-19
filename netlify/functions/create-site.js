import { createClient } from '@supabase/supabase-js';
import fetch from 'node-fetch'; // Ensure this is installed in your environment

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

// Helper: split large string into chunks
function chunkString(str, maxChunkSize = 50000) {
  const chunks = [];
  let start = 0;
  while (start < str.length) {
    chunks.push(str.slice(start, start + maxChunkSize));
    start += maxChunkSize;
  }
  return chunks;
}

// Push site files to GitHub using real API
async function pushSiteToGitHub(userToken, repoName, files) {
  const GITHUB_CLIENT_ID = process.env.CLIENT_ID;
  const GITHUB_CLIENT_SECRET = process.env.CLIENT_SECRET;

  if (!userToken || !repoName || !files) {
    throw new Error('Missing required parameters for GitHub push');
  }

  // GitHub API requires Base64 encoding of content
  const fileEntries = Object.entries(files);
  for (const [filename, content] of fileEntries) {
    const url = `https://api.github.com/repos/:owner/${repoName}/contents/${filename}`;
    const body = {
      message: `Add ${filename} via Fire-USA site builder`,
      content: Buffer.from(content).toString('base64')
    };

    const response = await fetch(url.replace(':owner', 'user'), {
      method: 'PUT',
      headers: {
        Authorization: `token ${userToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      const errData = await response.json();
      throw new Error(`GitHub API error for file ${filename}: ${errData.message}`);
    }
  }

  return { success: true, repoUrl: `https://github.com/user/${repoName}` };
}

export const handler = async (event) => {
  try {
    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) };
    }

    let body;
    try {
      body = JSON.parse(event.body || '{}');
    } catch (parseError) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Invalid JSON body', details: parseError.message })
      };
    }

    const { site_name, files, github_token } = body;

    if (!site_name) return { statusCode: 400, body: JSON.stringify({ error: 'Missing site_name' }) };
    if (!/^[a-z0-9-]{3,30}$/.test(site_name)) return { statusCode: 400, body: JSON.stringify({ error: 'Invalid site name' }) };
    if (!files || typeof files !== 'object') return { statusCode: 400, body: JSON.stringify({ error: 'Missing or invalid files object' }) };
    if (!github_token) return { statusCode: 400, body: JSON.stringify({ error: 'Missing GitHub OAuth token' }) };

    // Track site metadata in Supabase
    const chunkedFiles = {};
    for (const [filename, content] of Object.entries(files)) {
      chunkedFiles[filename] = chunkString(content, 50000);
    }

    const expires_at = new Date();
    expires_at.setMonth(expires_at.getMonth() + 1);

    const { data: insertedData, error: insertError } = await supabase
      .from('sites')
      .insert({
        name: site_name,
        subdomain: site_name,
        files: chunkedFiles,
        expires_at,
        created_at: new Date()
      });

    if (insertError) {
      return { statusCode: 500, body: JSON.stringify({ error: 'Supabase insert error', details: insertError }) };
    }

    // Push files to GitHub using **real API** and secrets
    const githubResult = await pushSiteToGitHub(github_token, site_name, files);

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        message: 'Site created successfully under your domain using GitHub',
        githubUrl: githubResult.repoUrl,
        insertedData
      })
    };

  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Unhandled error', details: err.message }) };
  }
};
