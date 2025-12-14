// fetchItems.js
export async function fetchItems(type, userEmail = null) {
  try {
    // Call Netlify function
    const res = await fetch(`/.netlify/functions/getMarketItems`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, user_email: userEmail })
    });

    const json = await res.json();

    if (!json.success) {
      console.error(`Error fetching ${type}:`, json.error);
      return [];
    }

    return json.items || [];
  } catch (err) {
    console.error(`Network error fetching ${type}:`, err);
    return [];
  }
}
