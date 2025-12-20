const fetch = require('node-fetch');  // To make API requests

exports.handler = async function(event, context) {
const apiUrl = 'https://api.github.com/repos/sussybocca/bot.nev2/contents/assets';


  try {
    // Fetch the contents of the 'assets' folder from your GitHub repo
    const response = await fetch(apiUrl);

    if (!response.ok) {
      return {
        statusCode: 404,
        body: JSON.stringify({ error: 'Failed to fetch data from GitHub API' }),
      };
    }

    const files = await response.json();

    // Filter the files to get only the .mp3 and .mp4 files
    const mediaFiles = files.filter(file => 
      file.name.toLowerCase().endsWith('.mp3') || file.name.toLowerCase().endsWith('.mp4')
    ).map(file => ({
      name: file.name,
      download_url: file.download_url,  // The URL to download the file
    }));

    // Return the media files as JSON
    return {
      statusCode: 200,
      body: JSON.stringify({ mediaFiles }),
    };
  } catch (error) {
    // Catch any errors and return an error response
    return {
      statusCode: 500,
      body: JSON.stringify({ error: `Error: ${error.message}` }),
    };
  }
};
