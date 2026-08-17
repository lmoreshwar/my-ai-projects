const express = require('express');
const axios = require('axios');
const auth = require('../middleware/auth');
const { resolveGitConnection } = require('../_tools/git_connection');

const router = express.Router();
const API = 'https://api.github.com';

async function githubWithRetry(fn, attempts = 3) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      const status = error.response?.status;
      const retryable = !status || status === 429 || (status >= 500 && status < 600);
      if (!retryable || attempt === attempts - 1) throw error;
      await new Promise((resolve) => setTimeout(resolve, 600 * (attempt + 1)));
    }
  }
  throw lastError;
}

router.post('/create-repo', auth, async (req, res) => {
  const name = String(req.body.name || '').trim();
  if (!name) return res.status(400).json({ msg: 'Enter a repository name.' });
  if (!/^[A-Za-z0-9._-]+$/.test(name)) {
    return res.status(400).json({ msg: 'Use only letters, numbers, dots, hyphens, and underscores.' });
  }

  try {
    const git = await resolveGitConnection(req.user.id);
    if (!git.token) return res.status(400).json({ msg: 'Save and test your GitHub connection first.' });

    const headers = {
      Authorization: `Bearer ${git.token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    };
    const user = await githubWithRetry(() => axios.get(`${API}/user`, { headers, timeout: 10000 }));
    const templateOwner = process.env.BLAST_TEMPLATE_OWNER || 'lmoreshwar';
    const templateRepo = process.env.BLAST_TEMPLATE_REPO || 'PLAYWRIGHT_BLAST_FRAMEWORK';
    const created = await githubWithRetry(() => axios.post(
      `${API}/repos/${templateOwner}/${templateRepo}/generate`,
      {
        owner: user.data.login,
        name,
        description: 'AI Native Playwright automation generated from the BLAST template.',
        private: false,
        include_all_branches: false,
      },
      { headers, timeout: 20000 },
    ));

    return res.status(201).json({
      message: `Created ${created.data.full_name}.`,
      fullName: created.data.full_name,
      defaultBranch: created.data.default_branch || 'main',
      htmlUrl: created.data.html_url,
    });
  } catch (error) {
    const status = error.response?.status;
    const detail = error.response?.data?.message || error.message;
    if (status === 422) {
      return res.status(409).json({ msg: 'A repository with that name already exists. Choose another name.' });
    }
    if (status === 403) {
      return res.status(403).json({ msg: 'Your GitHub token cannot create repositories. Use a token with repo and workflow scopes.' });
    }
    if (status === 404) {
      return res.status(502).json({ msg: 'The BLAST template repository is unavailable or is not marked as a template.' });
    }
    return res.status(502).json({ msg: `GitHub repository creation failed: ${detail}` });
  }
});

module.exports = router;