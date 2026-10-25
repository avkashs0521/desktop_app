#!/usr/bin/env node
// build/adhoc-sign.cjs
// Ad-hoc code-sign all binaries inside the freshly built macOS .app bundle.
//
// WHY: Apple requires every Mach-O binary to be signed before it can run on
// macOS (Gatekeeper). A Distribution certificate is needed to notarise for
// the App Store or for distribution to others. For local development / demo
// we sign ad-hoc instead — the identity "-" tells codesign to embed a hash-
// based signature without a real certificate. This is enough to satisfy
// macOS's requirement that Electron's internal binaries are signed.
//
// HOW: Walk the .app bundle, find every Mach-O binary (use `file` to check),
// and call `codesign --force --deep --sign -` on each one.
//
// USAGE: node build/adhoc-sign.cjs [path/to/Argus.app]
// If no argument is given it defaults to dist/mac-arm64/Argus.app (M-series)
// and falls back to dist/mac/Argus.app (Intel).

const { execFileSync, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// ── Locate the .app bundle ────────────────────────────────────────────────
const projectRoot = path.resolve(__dirname, '..');
const defaultCandidates = [
  path.join(projectRoot, 'dist', 'mac-arm64', 'Argus.app'),
  path.join(projectRoot, 'dist', 'mac', 'Argus.app'),
];

let appPath = process.argv[2];
if (!appPath) {
  appPath = defaultCandidates.find((p) => fs.existsSync(p));
}

if (!appPath || !fs.existsSync(appPath)) {
  console.error('[adhoc-sign] ERROR: Could not find Argus.app. Pass its path as the first argument.');
  process.exit(1);
}

console.log(`[adhoc-sign] Signing: ${appPath}`);

// ── Helpers ───────────────────────────────────────────────────────────────

/**
 * Recursively walk a directory, yielding absolute file paths.
 * @param {string} dir
 * @returns {string[]}
 */
function walk(dir) {
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) continue; // skip symlinks — codesign handles them
    if (entry.isDirectory()) {
      results.push(...walk(full));
    } else {
      results.push(full);
    }
  }
  return results;
}

/**
 * Returns true if the file is a Mach-O binary (native executable or dylib).
 * Uses the `file` command which reads the magic bytes.
 * @param {string} filePath
 */
function isMachO(filePath) {
  try {
    const result = spawnSync('file', [filePath], { encoding: 'utf8' });
    const out = result.stdout || '';
    return out.includes('Mach-O');
  } catch {
    return false;
  }
}

// ── Sign ──────────────────────────────────────────────────────────────────
const files = walk(appPath);
let signed = 0;
let skipped = 0;

for (const file of files) {
  if (!isMachO(file)) {
    skipped++;
    continue;
  }

  try {
    // --force        : re-sign even if already signed
    // --deep         : recursively sign nested bundles (frameworks, helpers)
    // --sign -       : ad-hoc identity (no certificate required)
    // --options runtime : enables hardened runtime flag (helpful but not required for ad-hoc)
    execFileSync('codesign', ['--force', '--sign', '-', file], { stdio: 'inherit' });
    console.log(`  ✔ signed: ${path.relative(projectRoot, file)}`);
    signed++;
  } catch (err) {
    console.warn(`  ✖ failed: ${path.relative(projectRoot, file)} — ${err.message}`);
  }
}

console.log(`\n[adhoc-sign] Done. Signed ${signed} binaries, skipped ${skipped} non-Mach-O files.`);
