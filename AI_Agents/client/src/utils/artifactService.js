/**
 * checkExistingArtifact — Check if an artifact of given type already exists for a ticket
 *
 * @param {string} apiBase - Base API URL
 * @param {string} type - Artifact type (e.g. 'test-cases')
 * @param {string} ticketId - Ticket ID to check
 * @returns {Promise<{exists: boolean, artifact?: object}>}
 */
export async function checkExistingArtifact(apiBase, type, ticketId) {
  const token = localStorage.getItem('blast_token');
  if (!token) return { exists: false };
  try {
    const res = await fetch(`${apiBase}/api/artifacts/check?type=${encodeURIComponent(type)}&ticketId=${encodeURIComponent(ticketId)}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!res.ok) return { exists: false };
    return res.json();
  } catch { return { exists: false }; }
}

/**
 * updateArtifact — Update an existing artifact
 *
 * @param {string} apiBase - Base API URL
 * @param {string} id - Artifact ID
 * @param {object} payload - { title?, content?, files?, metadata? }
 * @returns {Promise<object>} - Updated artifact
 */
export async function updateArtifact(apiBase, id, { title, content, files, metadata }) {
  const token = localStorage.getItem('blast_token');
  if (!token) throw new Error('Not logged in');
  const res = await fetch(`${apiBase}/api/artifacts/${id}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({ title, content, files, metadata })
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.msg || `Update failed (${res.status})`);
  }
  return res.json();
}

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
