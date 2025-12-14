// loader.js
export function showLoader(containerId) {
  const container = document.getElementById(containerId);
  container.innerHTML = `
    <div class="loader">
      <div class="spinner"></div>
      <p>Loading...</p>
    </div>
  `;
}

export function hideLoader(containerId) {
  const container = document.getElementById(containerId);
  container.innerHTML = '';
}
