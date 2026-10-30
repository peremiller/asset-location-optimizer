# Automatic full-static offline releases

Copy this directory into a Site's `scripts/offline/`. After its normal build,
run `node scripts/offline/build.mjs --dir dist --name "App name"`. The static
directory must contain published public files only. Use `--base /subpath/` for
a verified subpath deployment and `--spa` only for an app whose routes use the
same public SPA document. The generator is idempotent and has no dependencies.

The build injects an external first-party client into every HTML page, permits
that client and first-party workers in existing CSP directives, and writes
checksummed public archive chunks. Initial visits automatically save every
published page, local image/font/script/style/data file. Installation and repair
verify exact pack and file SHA-256 checksums. Interrupted installs can resume;
old complete versions remain usable until a whole new release is ready.

APIs, credentials, writes, foreign origins, site uploads/private directories,
source maps, database files and secret-shaped files are excluded. Browser data
and app records are never uploaded. Cached public files do not authenticate
accounts or simulate a cloud service. The report lists external runtime assets
and fetch destinations requiring separate replacement/vendoring or offline
fallbacks. Inspect it before asserting complete feature coverage. Downloaded
streaming media and cloud AI are not supplied by this engine.

Readiness verifies the complete local bundle, including never-visited pages.
Offline use still requires a charged device and retained browser storage.
Source build hooks must invoke the generator after each original build. Do not
publish only modified build output while leaving future builds uninstrumented.
