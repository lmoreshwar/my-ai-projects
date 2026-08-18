require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const https = require('https');
const t = process.env.GITHUB_TOKEN;
const REPO = '/repos/lmoreshwar/PLAYWRIGHT_BLAST_FRAMEWORK';
function g(p) {
  return new Promise((res) => {
    https.request({ host: 'api.github.com', path: p, headers: { Authorization: 'Bearer ' + t, 'User-Agent': 'blast', Accept: 'application/vnd.github+json' } }, (r) => {
      let d = '';
      r.on('data', (c) => (d += c));
      r.on('end', () => res({ s: r.statusCode, d }));
    }).end();
  });
}
(async () => {
  const runs = JSON.parse((await g(`${REPO}/actions/workflows/blast-runner.yml/runs?per_page=1`)).d).workflow_runs[0];
  console.log(`RUN #${runs.run_number} [${runs.status}/${runs.conclusion}] ${runs.html_url}`);
  const jobs = JSON.parse((await g(`${REPO}/actions/runs/${runs.id}/jobs`)).d).jobs || [];
  jobs.forEach((j) => {
    console.log(`\nJOB: ${j.name} -> ${j.conclusion}`);
    (j.steps || []).forEach((s) => console.log(`  [${s.conclusion || s.status}] ${s.number}. ${s.name}`));
  });
})();
