#!/usr/bin/env node

const fs = require('node:fs')
const path = require('node:path')
const { spawn } = require('node:child_process')

const repoRoot = path.resolve(__dirname, '..', '..')
const tool = process.argv[2]
const args = process.argv.slice(3)

const toolEntries = {
  biome: path.join(repoRoot, 'node_modules', '@biomejs', 'biome', 'bin', 'biome'),
  eslint: path.join(repoRoot, 'node_modules', 'eslint', 'bin', 'eslint.js')
}

function fail(message) {
  console.error(`[run-local-bin] ${message}`)
  process.exit(1)
}

if (!tool) {
  fail('Missing tool name. Usage: run-local-bin.cjs <biome|eslint> [...args]')
}

const entry = toolEntries[tool]

if (!entry) {
  fail(`Unsupported tool "${tool}". Expected one of: ${Object.keys(toolEntries).join(', ')}`)
}

if (!fs.existsSync(entry)) {
  fail(`Cannot find local entry for "${tool}" at ${entry}. Run pnpm install first.`)
}

const child = spawn(process.execPath, [entry, ...args], {
  cwd: repoRoot,
  stdio: 'inherit',
  env: process.env
})

child.on('error', (error) => {
  fail(`Failed to start "${tool}": ${error.message}`)
})

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal)
    return
  }

  process.exit(code ?? 1)
})
