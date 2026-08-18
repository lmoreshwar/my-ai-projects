require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const https = require('https');
const t = process.env.GITHUB_TOKEN;
const cancel = [31125584756, 31125624861, 31125660136]; // keep 31125669141 (#4)
cancel.forEach((id) => {
  const req = https.request({
    method: 'POST',
    host: 'api.github.com',
    path: `/repos/lmoreshwar/PLAYWRIGHT_BLAST_FRAMEWORK/actions/runs/${id}/cancel`,
    headers: { Authorization: 'Bearer ' + t, 'User-Agent': 'blast', Accept: 'application/vnd.github+json', 'Content-Length': 0 },
  }, (res) => {
    let d = '';
    res.on('data', (c) => (d += c));
    res.on('end', () => console.log(`run ${id}: ${res.statusCode} ${d ? JSON.parse(d).message || '' : 'cancel accepted'}`));
  });
  req.on('error', (e) => console.log(`run ${id}: ERROR ${e.message}`));
  req.end();
});
