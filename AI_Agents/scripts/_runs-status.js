require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const https = require('https');
const t = process.env.GITHUB_TOKEN;
https.request({
  host: 'api.github.com',
  path: '/repos/lmoreshwar/PLAYWRIGHT_BLAST_FRAMEWORK/actions/workflows/blast-runner.yml/runs?per_page=5',
  headers: { Authorization: 'Bearer ' + t, 'User-Agent': 'blast', Accept: 'application/vnd.github+json' },
}, (res) => {
  let d = '';
  res.on('data', (c) => (d += c));
  res.on('end', () => {
    const j = JSON.parse(d);
    (j.workflow_runs || []).forEach((r) => {
      console.log(`#${r.run_number} [${r.status}/${r.conclusion || '—'}] "${r.display_title}" ${r.html_url}`);
    });
  });
}).end();
