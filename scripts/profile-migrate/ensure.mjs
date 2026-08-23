#!/usr/bin/env node
/** Refresh the managed profile only when its bundle/package contract is stale. */

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { managedProfileNeedsRefresh, requiredWorkspaceLinks } from './contract.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const dshHome = resolve(process.env.DSH_HOME ?? join(homedir(), '.dsh'))
const targetDir = join(dshHome, 'profiles', 'deepcreator')
const targetManifestPath = join(targetDir, 'package.json')
const bundlePath = join(root, 'packages', 'bundle', 'deepcreator-web')
const targetManifest = existsSync(targetManifestPath)
  ? JSON.parse(readFileSync(targetManifestPath, 'utf8'))
  : undefined
const requiredLinks = requiredWorkspaceLinks(root, bundlePath)

if (managedProfileNeedsRefresh(targetDir, targetManifest, requiredLinks)) {
  console.log('DeepCreator profile is stale; refreshing managed package links...')
  execFileSync(process.execPath, [join(import.meta.dirname, 'index.mjs')], {
    cwd: root,
    env: process.env,
    stdio: 'inherit',
  })
} else {
  console.log('DeepCreator profile is current.')
}
