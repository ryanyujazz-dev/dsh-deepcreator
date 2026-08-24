import { isAbsolute, join, resolve } from 'node:path'

const PRODUCT_NAME = 'DeepCreator'
const DEFAULT_USER_DATA_DIRECTORY = 'DeepCreator DSH'
const INSTANCE_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,31}$/

/** Process-local identity and storage roots for one Desktop instance. */
export interface DesktopInstance {
  /** Optional non-default instance id supplied by the launcher. */
  id?: string
  /** Visible application/window name. */
  applicationName: string
  /** Electron userData path that scopes Chromium state and the instance lock. */
  userDataPath: string
}

function requiredAbsolutePath(env: NodeJS.ProcessEnv, key: 'DSH_HOME' | 'DSH_AGENTS_HOME', instanceId: string): string {
  const value = env[key]?.trim()
  if (value === undefined || value === '') {
    throw new Error(`DeepCreator Desktop instance "${instanceId}" requires an explicit ${key} for isolated runtime data.`)
  }
  if (!isAbsolute(value)) {
    throw new Error(`DeepCreator Desktop instance "${instanceId}" requires ${key} to be an absolute path (received ${JSON.stringify(value)}).`)
  }
  return resolve(value)
}

/**
 * Resolve one Desktop instance before Electron acquires its single-instance
 * lock. Non-default instances must isolate both official runtime data roots;
 * a separate Chromium directory without separate Sessions and profiles would
 * provide a dangerously incomplete boundary.
 */
export function resolveDesktopInstance(env: NodeJS.ProcessEnv, appDataPath: string): DesktopInstance {
  const rawId = env.DEEPCREATOR_INSTANCE_ID
  if (rawId === undefined || rawId === '') {
    return {
      applicationName: PRODUCT_NAME,
      userDataPath: join(appDataPath, DEFAULT_USER_DATA_DIRECTORY),
    }
  }

  const id = rawId.trim().toLowerCase()
  if (id !== rawId || !INSTANCE_ID_PATTERN.test(id)) {
    throw new Error('DEEPCREATOR_INSTANCE_ID must be 1-32 lowercase letters, digits, underscores, or hyphens, starting with a letter or digit.')
  }
  const dshHome = requiredAbsolutePath(env, 'DSH_HOME', id)
  const agentsHome = requiredAbsolutePath(env, 'DSH_AGENTS_HOME', id)
  if (dshHome === agentsHome) {
    throw new Error(`DeepCreator Desktop instance "${id}" requires distinct DSH_HOME and DSH_AGENTS_HOME paths.`)
  }

  return {
    id,
    applicationName: `${PRODUCT_NAME} [${id}]`,
    userDataPath: join(appDataPath, `${DEFAULT_USER_DATA_DIRECTORY}-${id}`),
  }
}
