# Release Checklist

Status: private repository / npm publication disabled. Complete the public-release gates before
changing that status.

## Already verified (2026-11-15, v0.1.0)

- [x] TypeScript typecheck and build exit 0.
- [x] 47 integration/unit tests pass on the build output.
- [x] Overall line/branch/function coverage: 95.80% / 85.07% / 94.72%.
- [x] Isolated `DSH_HOME` mount: `ctx.memoryCore` create/get/search/feedback/close, restart
      persistence, clean close with no WAL/SHM; real profile untouched.
- [x] Both examples pass `--selftest`.
- [x] `npm pack --dry-run` contains no database, test, cache, secret, or temporary files.
- [x] The mount test did not write to the real DSH profile, and no existing plugin was modified.

## Before making the repository public

- [ ] Choose a license: MIT (short, permissive, no explicit patent grant) or Apache-2.0
      (longer, includes an explicit patent grant). Do not describe the project as open source until
      a license file is present.
- [ ] Remove `"private": true` only if publishing to npm; keep it while the package is private.
- [ ] Normalize tracked file modes in a normal checkout. This OneDrive working copy tracks many
      source/docs files as 100755; use 100644 for source/docs/tests and keep the shell test
      executable only where needed.
- [ ] Audit or rewrite Git history. Earlier commits contain a local absolute workspace path in
      `docs/PHASE0_INVESTIGATION.md` and the historical architecture file. The current package
      contents are redacted, but history retains the old text.
- [ ] Re-run the tarball gate: `npm pack`, install the tarball into a fresh isolated DSH_HOME
      profile, and repeat the mount probe. Do not rely only on `--dry-run`.
- [ ] Run on Windows or document it as unsupported/untested.
- [ ] Decide backup encryption/retention and document where backups live.
- [ ] Confirm no secrets, credentials, session content, real memories, or personal paths appear in
      the tarball or history.

## Known release limitations

- `node:sqlite` is Experimental; pin/test the supported Node range.
- No auth/encryption; `namespaceId` is not an authorization boundary.
- Purge does not erase backups, WAL, snapshots, or cloud-sync version history.
- Keyword search only; Chinese 2-character queries use O(n) LIKE fallback.
- No HTTP/tool layer, automatic extraction, consolidation, vector search, or multi-agent sync.
