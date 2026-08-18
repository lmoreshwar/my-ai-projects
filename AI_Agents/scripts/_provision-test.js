// Throwaway diagnostic (gitignored _*.js): exercises the provisioning helpers end-to-end
// using the token already on disk in dev-connections.json. Never prints the token.
const path = require('path');
const gh = require(path.join(__dirname, '..', 'api', '_tools', 'github_agent.js'));
const conn = require(path.join(__dirname, '..', 'dev-connections.json'));

(async () => {
  const git = { token: (conn.github || {}).token };
  const name = process.argv[2] || 'blast-framework';
  if (!git.token) { console.error('No github.token in dev-connections.json'); process.exit(1); }

  try {
    const me = await gh.getAuthenticatedUser(git);
    console.log('1) token account login:', me.login);

    const exists = await gh.repoExists(git, me.login, name);
    console.log(`2) repo ${me.login}/${name} exists:`, exists);

    if (exists) {
      console.log('   → already there; endpoint would ADOPT it (no duplicate). Nothing created.');
      console.log('RESULT: OK (adopt path)');
      return;
    }

    const r = await gh.generateFromTemplate(git, { owner: me.login, name, private: true });
    console.log('3) provisioned:', r.fullName);
    console.log('   url:', r.htmlUrl, '| default branch:', r.defaultBranch);
    console.log('RESULT: OK (created)');
  } catch (e) {
    console.error('RESULT: FAILED —', e.message);
    process.exit(2);
  }
})();
