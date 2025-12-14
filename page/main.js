// main.js for /page/index.html

const cutscene = document.getElementById('cutscene');
const startMenu = document.getElementById('start-menu');
const bgVideo = document.getElementById('bg-video');
const music = document.getElementById('music');

// Play cutscene, then show start menu
function playCutscene() {
  cutscene.style.display = 'block';
  bgVideo.style.display = 'none';
  cutscene.play();

  cutscene.onended = () => {
    cutscene.style.display = 'none';
    bgVideo.style.display = 'block';
    startMenu.style.display = 'block';
    music.play().catch(() => console.log('Autoplay blocked'));
  };
}

// Fullscreen toggle
function enableFullscreen() {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen().catch(() => {});
  }
}

// Button navigation
function goToEditor(type) {
  window.location.href = `/platform/editors/${type}.html`;
}

function goToMarket(type) {
  window.location.href = `/platform/marketplaces/${type}.html`;
}

// Animate emoji cursor
const emojiCursor = document.createElement('div');
emojiCursor.style.position = 'fixed';
emojiCursor.style.pointerEvents = 'none';
emojiCursor.style.width = '40px';
emojiCursor.style.height = '40px';
emojiCursor.style.backgroundImage = "url('emoji_cursor.png')";
emojiCursor.style.backgroundSize = 'contain';
emojiCursor.style.zIndex = 1000;
document.body.appendChild(emojiCursor);

document.addEventListener('mousemove', e => {
  emojiCursor.style.left = e.clientX + 'px';
  emojiCursor.style.top = e.clientY + 'px';
});

// Click to enter fullscreen
document.addEventListener('click', enableFullscreen);

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  // Hide start menu initially
  startMenu.style.display = 'none';
  playCutscene();
});
