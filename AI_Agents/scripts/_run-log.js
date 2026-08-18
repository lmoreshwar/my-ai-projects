// Temp: download run logs and print Level 3 + verification lines.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const https = require('https');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const t = process.env.GITHUB_TOKEN;
const REPO = 'lmoreshwar/PLAYWRIGHT_BLAST_FRAMEWORK';
const runId = process.argv[2];
if (!runId) { console.error('usage: node _run-log.js <runId>'); process.exit(1); }

function get(p, cb, hdrs) {
  https.request({ host: 'api.github.com', path: p, headers: { Authorization: 'Bearer ' + t, 'User-Agent': 'blast', Accept: 'application/vnd.github+json', ...(hdrs || {}) } }, cb).end();
}
// logs endpoint returns a 302 redirect to a signed zip URL
get(`/repos/${REPO}/actions/runs/${runId}/logs`, (r) => {
  if (r.statusCode === 302 && r.headers.location) {
    const zip = path.join(__dirname, `_run-${runId}.zip`);
    const file = fs.createWriteStream(zip);
    https.get(r.headers.location, (rr) => {
      rr.pipe(file);
      file.on('finish', () => {
        file.close(() => {
        const outDir = path.join(__dirname, `_run-${runId}`);
        fs.rmSync(outDir, { recursive: true, force: true });
        execSync(`powershell -Command "Expand-Archive -Path '${zip}' -DestinationPath '${outDir}' -Force"`);
        const lines = [];
        const walk = (d) => fs.readdirSync(d).forEach((f) => {
          const fp = path.join(d, f);
          if (fs.statSync(fp).isDirectory()) return walk(fp);
          if (!fp.endsWith('.txt')) return;
          fs.readFileSync(fp, 'utf8').split(/\r?\n/).forEach((ln) => {
            if (/\[L3\]|Verified live actions|VERIFICATION|VERIFIED|passed|PASSED|FAILED|Pull Request|PR #|Journey complete/.test(ln)) lines.push(ln.replace(/^\S+\s/, ''));
          });
        });
        walk(outDir);
        console.log(lines.join('\n'));
        fs.rmSync(zip, { force: true });
        fs.rmSync(outDir, { recursive: true, force: true });
        });
      });
    });
  } else {
    console.error('no redirect, status', r.statusCode);
  }
});
