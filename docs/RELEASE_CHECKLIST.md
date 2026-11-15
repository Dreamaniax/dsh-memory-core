# Release Checklist

Status: private repository / npm publication disabled. The package is an auditable private
candidate, not a public release. Complete the decisions below before changing that status.

## Verified (2026-11-15, v0.1.0)

- [x] TypeScript typecheck and build exit 0.
- [x] 47 integration/unit tests pass on the build output (47 pass, 0 fail).
- [x] Overall line/branch/function coverage: 95.80% / 85.07% / 94.72%.
- [x] Isolated DSH_HOME mount: ctx.memoryCore create/get/search/feedback/close, restart
      persistence, clean close with no WAL/SHM; real profile untouched.
- [x] Both examples pass --selftest.
- [x] Clean dependency install from a git-archive copy: npm ci exit 0 using the local npm cache.
- [x] Real npm tarball, not only --dry-run: packed from a clean copy, installed into a fresh
      temporary DSH_HOME profile, and the same mount probe passed (create/read/search/feedback,
      restart persistence, clean close).
- [x] Tarball contents: 139 entries, all files mode 0644; packed size about 130.4 KB; no database, WAL/SHM, tests,
      node_modules, cache, log, secret, token, or personal absolute path.
- [x] Tracked file modes normalized in commit f6a65be: 77 files 100644 plus only the directly
      executed mount script 100755; cached diff has zero content changes.
- [x] Current tracked tree has no secret-like literal, private key, real user memory, session
      content, or local absolute path.
- [x] Git history audit: no binary blobs, databases, logs, secrets, or tokens. Earlier commits
      retain two local absolute workspace paths; see below.
- [x] No real DSH profile was written and no existing plugin was modified.

Reproduce:

~~~bash
npm run typecheck
npm test
npm run test:coverage
npm run test:examples
npm run test:dsh
npm run test:tarball
npm pack --dry-run
~~~

test:tarball runs from git archive HEAD, validates tarball modes and content, then installs that
tarball into an isolated DSH_HOME and repeats the mount probe. It requires a local DSH app.
The current run used node:sqlite and npm's local cache; it does not prove a completely offline
install on another machine.

## Required decisions before public release

- [ ] Choose a license: MIT (short, permissive, no explicit patent grant) or Apache-2.0
      (longer, includes an explicit patent grant). Do not describe the project as open source
      until a LICENSE file is present. Files to change: LICENSE, package.json (license),
      README License section; Apache-2.0 may also need NOTICE.
- [ ] Decide how to handle the two local absolute paths in earlier Git commits:
      accept them, rewrite history with git filter-repo (force-push and re-coordinate clones),
      or start a fresh history from the current tree. Do not rewrite pushed history without
      explicit consent.
- [ ] Keep "private": true unless actually publishing to npm. A public GitHub repository does
      not require an npm publish.
- [ ] Choose a Windows policy: add CI/real-machine verification, or document Windows as
      unsupported/untested. Only macOS arm64 has been tested here.
- [ ] Decide backup encryption, retention, off-machine storage, and a restore drill owner.
- [ ] Decide whether "node:sqlite" Experimental is acceptable for the supported Node range.
- [ ] Before any npm publish: remove "private", confirm the package name, run
      npm publish --dry-run, inspect the final tarball, then publish.
- [ ] Before switching the GitHub repository public: repeat the secrets/history/license audit
      and confirm there is no unreviewed personal data.

## Known release limitations

- node:sqlite is Experimental; pin/test the supported Node range.
- No auth/encryption; namespaceId is not an authorization boundary.
- Purge does not erase backups, WAL, snapshots, or cloud-sync version history.
- Migration backups default to the last 3; they are not encrypted or off-site.
- Keyword search only; Chinese 2-character queries use O(n) LIKE fallback.
- No HTTP/tool layer, automatic extraction, consolidation, vector search, or multi-agent sync.
- Windows is unverified; no npm publish has been performed.
