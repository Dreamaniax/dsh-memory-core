# Release Checklist

Status: private repository / npm publication disabled. The package is an auditable private
candidate, not a public release. Complete the decisions below before changing that status.

Last updated: 2026-11-16 for the v0.1.0 release candidate.

## Candidate verification (2026-11-16)

- [x] LICENSE (MIT) added; `package.json` has `"license": "MIT"`; README License section
      updated; the tarball gate requires `package/LICENSE` and `manifest.license === "MIT"`.
- [x] Dependency license audit: zod MIT; TypeScript Apache-2.0 (dev/build only, not in
      tarball); peer and transitive packages MIT. No conflict with MIT distribution.
- [x] History decision: accept and keep the two early local absolute paths; no rewrite and
      no force-push.
- [x] Platform decision: macOS arm64 tested; Windows and Linux unverified, not claimed as
      supported.
- [x] Backup decision: automatic migration backups keep the newest 3; unencrypted by default;
      manual `backupTo` files are not pruned. Risk and user protection documented in README.
- [x] `npm run typecheck` exit 0; `npm run build` exit 0; `npm test` 47/47 pass, 0 fail;
      coverage 95.80% lines / 85.07% branches / 94.72% functions; `npm run test:examples`
      exit 0.
- [x] `npm pack --dry-run` precheck: 140 files, LICENSE present, license MIT, private true.
- [x] Isolated DSH mount on the candidate code commit: exit 0, memoryId
      889d83ce-17ba-4768-b941-1107f76f30cb, restart persistence and clean close passed.
- [x] Real tarball gate on the candidate code commit: exit 0, 135,294 bytes, 140 files, requiredFiles 9,
      all 0644, forbiddenPaths 0, contentFindings 0; tarball-installed mount passed with
      memoryId 4eacf925-3b5d-4b82-8f58-b59e8134f6d5. The first candidate attempt failed at
      `npm cache add zod@4.4.3` (registry timeout); retry after cache warm passed.
- [x] Clean clone at the candidate code commit: npm ci, typecheck, test (47/47), coverage, examples, test:dsh
      (memoryId 5253ff24-9230-4f26-aea0-1e0fbfe5179b), and test:tarball (memoryId
      8f7108a9-db51-43f6-a6fb-3caac5db8ce1) all exit 0; clone worktree clean.

## Final public-source review (2026-11-16)

- [x] Reviewed commit 81f9cd45d653e409b7a32e2d4eccaeab34678db4, tree
      c0d9e9fb895a6762b1ef5dd9287d2d14a866cfc4; local main = origin/main = GitHub
      refs/heads/main; worktree clean.
- [x] Actual GitHub visibility: private; tags 0; releases 0; package.json private true.
- [x] Fresh clean checkout: 82 tracked files, 80 x 100644 plus 2 x 100755; no mode drift.
- [x] Fresh isolated npm cache: npm ci exit 0 (8 packages in 4s); typecheck exit 0;
      npm test 47/47; coverage 95.80 / 85.07 / 94.72; examples exit 0.
- [x] Real tarball gate at reviewed commit 81f9: exit 0; 136,056 bytes; 140 files;
      requiredFiles 9; all 0644; forbiddenPaths 0; contentFindings 0; isolated mount
      memoryId b27896bf-330c-44cd-92d3-2c44e6377570. The final documentation-tree gate
      and tarball sha256 are recorded in the review report.
- [x] History audit: 14 commits, 158 unique blobs, 0 binaries; no secrets, credentials,
      databases, logs, emails, or real memory; only the two accepted early paths remain.
- [x] Current tree audit: no actual personal path; the only path/token-like literals are
      scanner regexes in tests/integration/check-tarball.mjs, excluded from the tarball.
- [x] Independent report: reviews/FINAL_PUBLIC_REVIEW.md (repository-only; not in npm
      tarball).
- [ ] Windows and Linux unverified; fully offline cold-cache first-run unproven.
- [ ] GitHub visibility switch, public Release/tag, and npm publish not performed and not
      authorized.

## Verified baseline (2026-11-15, v0.1.0)

- [x] TypeScript typecheck and build exit 0.
- [x] 47 integration/unit tests pass on the build output (47 pass, 0 fail).
- [x] Overall line/branch/function coverage: 95.80% / 85.07% / 94.72%.
- [x] Isolated DSH_HOME mount: ctx.memoryCore create/get/search/feedback/close, restart
      persistence, clean close with no WAL/SHM; real profile untouched.
- [x] Both examples pass --selftest.
- [x] Clean dependency install from a fresh clone: npm ci exit 0 with a fresh cache (registry available).
- [x] Real npm tarball, not only --dry-run: packed from a clean copy, installed into a fresh
      temporary DSH_HOME profile, and the same mount probe passed (create/read/search/feedback,
      restart persistence, clean close). The profile install prewarms zod with npm cache add
      and then runs npm install --offline; no dependency is copied by hand.
- [x] Tarball contents: 139 entries, all files mode 0644; packed size 130,527 bytes at
      commit 542182d and 132,309 bytes at docs commit 864b693 (exact bytes vary with docs);
      no database, WAL/SHM, tests, node_modules, cache, log, secret, token, or personal path.
- [x] Tracked file modes normalized in commit f6a65be (77 files 100644 plus one directly
      executed mount script 100755); after adding the tarball gate that baseline had
      79 files 100644 and two directly executed verification scripts 100755. The final
      candidate HEAD has 80 files 100644 plus the same two 100755 scripts.
- [x] Current tracked tree has no secret-like literal, private key, real user memory, session
      content, or local absolute path.
- [x] Git history audit: no binary blobs, databases, logs, secrets, or tokens. Earlier commits
      retain two local absolute workspace paths; see below.
- [x] No real DSH profile was written and no existing plugin was modified.
- [x] Fresh-clone acceptance at commit 542182d: npm ci, typecheck, npm test (47/47),
      test:examples, and test:tarball all exit 0; the tarball gate re-ran the isolated mount,
      restart persistence, and clean close.

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
The gate prewarms zod with npm cache add (so the cold cache needs the npm registry once) and
then runs the profile install with --offline. This proves repeatable installation from the
npm tarball without hand-copying dependencies, but it does not prove a completely offline
first-run install on a machine with an empty cache.

## Required decisions before public release

- [x] Confirm a license. Selected MIT; LICENSE, package.json, README, and the tarball gate
      are updated. Apache-2.0 was considered for an explicit patent grant but not selected.
- [x] Decide how to handle the two local absolute paths in earlier Git commits. Accepted and
      kept; they are development paths, not credentials or user data, and the current tree is
      redacted. No history rewrite and no force-push.
- [x] Keep "private": true unless actually publishing to npm. The package remains private; a
      public GitHub repository would not require an npm publish.
- [x] Choose a Windows policy. Windows and Linux are documented as unverified and are not
      claimed as supported. Only macOS arm64 has been tested here.
- [x] Decide backup encryption, retention, off-machine storage, and a restore drill owner.
      v0.1 keeps the current default: newest 3 automatic migration backups, unencrypted,
      no off-machine copy. README documents the risk, user protection options, and restore
      procedure.
- [x] Decide whether "node:sqlite" Experimental is acceptable for the supported Node range.
      Accepted for the v0.1 candidate and explicitly documented as Experimental.
- [ ] Before any npm publish: remove "private", confirm the package name, run
      npm publish --dry-run, inspect the final tarball, then publish.
- [ ] Before switching the GitHub repository public: repeat the secrets/history/license audit
      and confirm there is no unreviewed personal data.

## Known release limitations

- node:sqlite is Experimental; pin/test the supported Node range.
- No auth/encryption; namespaceId is not an authorization boundary.
- Purge does not erase backups, WAL, snapshots, or cloud-sync version history.
- Migration backups default to the last 3; they are not encrypted or off-site.
- The tarball gate's cold cache needs the npm registry once for the zod packument and tarball;
  after npm cache add, the profile install is offline.
- Keyword search only; Chinese 2-character queries use O(n) LIKE fallback.
- No HTTP/tool layer, automatic extraction, consolidation, vector search, or multi-agent sync.
- Windows and Linux are unverified; this candidate does not claim support. No npm publish
  has been performed.
