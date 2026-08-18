require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const https = require('https');
const t = process.env.GITHUB_TOKEN;
console.log('token loaded:', t ? 'yes len=' + t.length : 'NO');
const body = JSON.stringify({ ref: 'main', inputs: { job_id: 'PROBE-1', job_payload: '{"jobId":"PROBE-1"}' } });
const req = https.request({
  method: 'POST',
  host: 'api.github.com',
  path: '/repos/lmoreshwar/PLAYWRIGHT_BLAST_FRAMEWORK/actions/workflows/blast-runner.yml/dispatches',
  headers: {
    Authorization: 'Bearer ' + t,
    'User-Agent': 'blast',
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
  },
}, (res) => {
  let d = '';
  res.on('data', (c) => (d += c));
  res.on('end', () => console.log('status', res.statusCode, 'body:', d || '(empty = success)'));
});
req.on('error', (e) => console.log('REQUEST ERROR:', e.message));
req.write(body);
req.end();
