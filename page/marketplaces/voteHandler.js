// voteHandler.js

export async function voteItem(voterEmail, itemType, itemId, voteValue) {
  try {
    const response = await fetch('/.netlify/functions/vote', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_email: voterEmail,
        item_type: itemType,
        item_id: itemId,
        vote_value: voteValue
      })
    });

    const result = await response.json();
    if (!result.success) throw new Error(result.error || 'Vote failed');

    return { success: true };
  } catch (err) {
    console.error('Vote error:', err);
    return { success: false, error: err.message };
  }
}
