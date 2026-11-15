# Examples

These examples are self-contained smoke tests for the public Library API. They do not read the real
DSH profile and do not write to the default memory database.

~~~bash
node examples/weekly-retro/ingest.mjs --selftest
node examples/prompt-optimizer/ingest.mjs --selftest
~~~

Each command creates a temporary directory, opens a fresh database, creates memories, submits
feedback, verifies search/versions/sources, closes the database, and removes the directory in a
`finally` block. They require a built package (`npm run build`) and are also run by
`npm run test:examples`.

For DSH integration, use `ctx.memoryCore` instead of opening a Library instance per plugin; see the
plugin section in the root README and API_REFERENCE.md.
