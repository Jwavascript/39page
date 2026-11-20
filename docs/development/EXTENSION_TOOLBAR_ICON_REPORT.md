# Toolbar icon enlargement (2026-11-18)

Changed extension/icons/icon-16.png, icon-32.png, icon-48.png and extension/integration/cassette-design.mjs.
Toolbar artwork width increased from 75% to 100% of the canvas (33% larger). Approved SVG geometry and store icon 128px are preserved.
No dependencies added. No runtime behavior changed; unit tests were not rerun for this asset change.
Validation: npm run package passed (type-check, production builds, manifest checks, ZIP round-trip comparison). git diff --check passed. Inspected generated 48px PNG.
Updated ZIP: extension/release/39page-extension-1.0.0.zip.
SHA-256: 80bd8564ab89bea7279c8787dcc8011e6435bc73004102192dfedc2f34f78b41
Build includes uncommitted icon changes; provenance records that state. Earlier release report hash refers to the previous package.
TODO: user checks perceived size in Chrome toolbar after reloading the installed extension. No production deployment or Store upload performed.
