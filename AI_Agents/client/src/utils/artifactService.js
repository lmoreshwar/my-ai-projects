/**
 * saveArtifact — Save generated content to MongoDB via /api/artifacts
 *
 * @param {string} apiBase - Base API URL
 * @param {object} payload - { type, title, content?, files?, metadata? }
 * @returns {Promise<object>} - The saved artifact document
 */
export async function saveArtifact(apiBase, { type, title, content, files, metadata }) {
  const token = localStorage.getItem('blast_token');
  if (!token) throw new Error('Not logged in');
  const res = await fetch(`${apiBase}/api/artifacts`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({ type, title, content, files, metadata })
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.msg || `Save failed (${res.status})`);
  }
  return res.json();
}

/**
 * listArtifacts — List saved artifacts for current user
 *
 * @param {string} apiBase - Base API URL
 * @param {string} [type] - Optional filter by type
 * @returns {Promise<Array>}
 */
export async function listArtifacts(apiBase, type) {
  const token = localStorage.getItem('blast_token');
  if (!token) throw new Error('Not logged in');
  const url = type ? `${apiBase}/api/artifacts?type=${type}` : `${apiBase}/api/artifacts`;
  const res = await fetch(url, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  if (!res.ok) throw new Error('Failed to load saved items');
  return res.json();
}

/**
 * loadArtifact — Load full artifact by ID
 *
 * @param {string} apiBase
 * @param {string} id
 * @returns {Promise<object>}
 */
export async function loadArtifact(apiBase, id) {
  const token = localStorage.getItem('blast_token');
  if (!token) throw new Error('Not logged in');
  const res = await fetch(`${apiBase}/api/artifacts/${id}`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  if (!res.ok) throw new Error('Failed to load artifact');
  return res.json();
}

/**
 * deleteArtifact — Delete artifact by ID
 *
 * @param {string} apiBase
 * @param {string} id
 * @returns {Promise<void>}
 */
export async function deleteArtifact(apiBase, id) {
  const token = localStorage.getItem('blast_token');
  if (!token) throw new Error('Not logged in');
  const res = await fetch(`${apiBase}/api/artifacts/${id}`, {
    method: 'DELETE',
    headers: { 'Authorization': `Bearer ${token}` }
  });
  if (!res.ok) throw new Error('Failed to delete');
}
