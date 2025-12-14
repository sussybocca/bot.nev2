// market.js
import { fetchItems } from './fetchItems.js';
import { voteItem } from './voteHandler.js';

export async function loadMarket(type, containerId, voterEmail) {
  const container = document.getElementById(containerId);
  container.innerHTML = '<p>Loading items...</p>';

  // Fetch items from Netlify function
  const items = await fetchItems(type, voterEmail);
  container.innerHTML = '';

  if (!items.length) {
    container.innerHTML = '<p>No items found.</p>';
    return;
  }

  items.forEach(item => {
    const card = document.createElement('div');
    card.className = 'market-card';
    card.innerHTML = `
      <h3>${item.boteo_name || item.title}</h3>
      <p>Votes: <span class="vote-count">${item.votes}</span></p>
      <button class="upvote">⬆️</button>
      <button class="downvote">⬇️</button>
      <button class="download">Download</button>
    `;

    // Upvote button
    card.querySelector('.upvote').onclick = async () => {
      const res = await voteItem(voterEmail, type, item.id, 1);
      if (res.success) {
        item.votes += 1; // update local vote count
        card.querySelector('.vote-count').innerText = item.votes;
      } else {
        alert(res.error || 'Vote failed');
      }
    };

    // Downvote button
    card.querySelector('.downvote').onclick = async () => {
      const res = await voteItem(voterEmail, type, item.id, -1);
      if (res.success) {
        item.votes -= 1; // update local vote count
        card.querySelector('.vote-count').innerText = item.votes;
      } else {
        alert(res.error || 'Vote failed');
      }
    };

    // Download placeholder (to be implemented with Netlify function)
    card.querySelector('.download').onclick = () => {
      alert('Download not implemented yet.');
    };

    container.appendChild(card);
  });
}
