// Generates THIRD-PARTY-NOTICES.md from the production dependency tree.
//
// The bundle ships third-party code, and MIT and ISC both require the
// copyright and permission notice to travel with it. Vite's minifier strips
// the comments those notices live in, so without this file the published app
// would redistribute that code with no notice at all.
//
// Only `npm ls --omit=dev` packages are listed: build-time tooling
// (lightningcss, caniuse-lite and friends) never reaches a user. The listing
// comes from `--parseable`, which yields real install paths and therefore
// skips unresolved optional peers that are not on disk and cannot ship.
//
//   npm run notices        write the file
//   npm run notices:check  fail if it is out of date (CI)

import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'

const OUT = 'THIRD-PARTY-NOTICES.md'

/** Installed production packages, as [name, version, dir], sorted by name. */
function productionPackages() {
  const paths = execFileSync('npm', ['ls', '--omit=dev', '--all', '--parseable'], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.includes('node_modules'))
    // Keep only the part from the first node_modules on and re-anchor it to
    // the project root. npm prints absolute paths, but trusting a prefix we
    // did not construct is needless: it breaks anywhere the parent path is
    // rewritten between the child process and here.
    .map((line) => join(process.cwd(), line.slice(line.indexOf('node_modules'))))

  const found = new Map()
  for (const dir of paths) {
    const pkg = manifest(dir)
    if (!pkg.name || found.has(pkg.name)) continue
    found.set(pkg.name, { version: pkg.version, dir, pkg })
  }
  return [...found.entries()].sort(([a], [b]) => a.localeCompare(b))
}

function manifest(dir) {
  try {
    return JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
  } catch {
    return {}
  }
}

/** The package's own license text. Projects name the file every which way —
 *  LICENSE, LICENCE, license.md, LICENSE.markdown, COPYING — so match on the
 *  stem rather than a fixed list of candidates. */
function licenseText(dir) {
  let entries
  try {
    entries = readdirSync(dir)
  } catch {
    return null
  }
  const file = entries.find((name) => /^(licen[sc]e|copying)(\.|$)/i.test(name))
  if (!file) return null
  try {
    return readFileSync(join(dir, file), 'utf8').trim()
  } catch {
    return null
  }
}

function declaredLicense(pkg) {
  if (typeof pkg.license === 'string') return pkg.license
  if (pkg.license?.type) return pkg.license.type
  if (Array.isArray(pkg.licenses)) return pkg.licenses.map((l) => l.type ?? l).join(' OR ')
  return null
}

function render() {
  const packages = productionPackages()
  const undeclared = []

  const body = []
  for (const [name, { version, dir, pkg }] of packages) {
    const license = declaredLicense(pkg)
    const text = licenseText(dir)
    if (!license && !text) undeclared.push(name)

    body.push(`## ${name} ${version}`, '')
    body.push(`License: ${license ?? '**not declared** — see the note above'}`)
    if (pkg.homepage) body.push(`Homepage: ${pkg.homepage}`)
    body.push('')
    if (text) {
      body.push('```text', text, '```', '')
    } else {
      body.push(`_This package ships no license file; \`${relative('.', dir)}\` declares only the`)
      body.push(`\`license\` field above._`, '')
    }
  }

  const head = [
    '# Third-party notices',
    '',
    'The metal-stack planner bundles the packages below. Each is redistributed under its',
    'own license, reproduced here because the production build minifies away the notices',
    'that normally travel in the source.',
    '',
    'Build-time tooling is not listed: it never reaches a user.',
    '',
    'Regenerate with `npm run notices`; CI checks that it stays current.',
    '',
    `${packages.length} packages.`,
    '',
  ]

  if (undeclared.length) {
    head.push(
      '> **Note.** The following declare no license and ship no license file:',
      `> ${undeclared.map((n) => `\`${n}\``).join(', ')}.`,
      '> They reach the bundle only as transitive dependencies of `exceljs`. Their terms',
      '> could not be established automatically and are worth confirming with upstream.',
      '',
    )
  }

  return [...head, ...body].join('\n')
}

const rendered = render()

if (process.argv.includes('--check')) {
  let current = ''
  try {
    current = readFileSync(OUT, 'utf8')
  } catch {
    // a missing file counts as out of date
  }
  if (current !== rendered) {
    console.error(`${OUT} is out of date. Run: npm run notices`)
    process.exit(1)
  }
  console.log(`${OUT} is up to date.`)
} else {
  writeFileSync(OUT, rendered)
  console.log(`Wrote ${OUT}.`)
}
