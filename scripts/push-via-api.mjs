/**
 * Push the current branch head through the GitHub REST Git Data API — a
 * fallback for when the smart-HTTP git protocol is unreachable but the REST
 * API still works. Replays the diff between a given parent and HEAD as
 * blobs/tree/commit/ref updates.
 *
 * Usage: node scripts/push-via-api.mjs <parent-sha> [branch]
 *   node scripts/push-via-api.mjs 5893629 main
 */
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const repo = 'ryanyujazz-dev/dsh-plugins'
const [parent, branch = 'main'] = process.argv.slice(2)
if (parent === undefined) throw new Error('usage: node scripts/push-via-api.mjs <parent-sha> [branch]')

const run = (cmd) => execSync(cmd, { cwd: root, encoding: 'utf8' }).trim()
const ghJson = (method, path, flags = [], input) => {
  const args = ['api', '-X', method, `repos/${repo}/${path}`, ...flags]
  if (input !== undefined) args.push('--input', '-')
  const result = execSync(`gh ${args.join(' ')}`, {
    cwd: root,
    encoding: 'utf8',
    input: input === undefined ? undefined : JSON.stringify(input),
  })
  return JSON.parse(result)
}

const head = run('git rev-parse HEAD')
const parentSha = run(`git rev-parse ${parent}`)
const nameStatus = run(`git diff --name-status ${parentSha} ${head}`)
const message = run(`git log -1 --format=%B ${head}`).replace(/\s+$/, '')
const parentCommit = ghJson('GET', `commits/${parentSha}`)
const baseTree = parentCommit.commit.tree.sha

const entries = []
for (const line of nameStatus.split('\n')) {
  if (line === '') continue
  const [status, ...pathParts] = line.split('\t')
  const path = pathParts.join('\t')
  if (status.startsWith('D')) {
    entries.push({ path, mode: '100644', type: 'blob', sha: null })
    continue
  }
  const content = readFileSync(join(root, path)).toString('base64')
  const blob = ghJson('POST', 'git/blobs', [], { content, encoding: 'base64' })
  entries.push({ path, mode: '100644', type: 'blob', sha: blob.sha })
}

const tree = ghJson('POST', 'git/trees', [], { base_tree: baseTree, tree: entries })
const commit = ghJson('POST', 'git/commits', [], { message, tree: tree.sha, parents: [parentSha] })
ghJson('PATCH', `git/refs/heads/${branch}`, [], { sha: commit.sha, force: false })
console.log(`pushed ${head} to ${branch} via the Git Data API`)
