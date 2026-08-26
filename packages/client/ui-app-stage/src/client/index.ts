/**
 * Client assembly of the App Stage shell.
 *
 * Registers the Stage Shell into ui-layout's `deepcreator.stage.apps` seat
 * (single, root scope — waits via slots.inject, S3 semantics: an absent
 * declaration is a pending wait, never an error) and binds the two faces the
 * component needs: the layout write face (`ctx.layout`) and the captured
 * appStage remote namespace. Reads of live geometry arrive as owner props;
 * writes never climb back through them.
 *
 * M4 adds the Stage router: the long-poll executor that drains host-queued
 * `app_invoke` / `app_open` requests into the live container, owns the
 * container store the shell renders, and raises the activity signal (the
 * segmented switch dot + the conversation-mode chip) while an agent drives
 * an app.
 * @module @ryanyujazz/dsh-client-ui-app-stage/client
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@ryanyujazz/dsh-client-locale/client'
import type {} from '@ryanyujazz/dsh-client-ui-layout/client'
// Type-only: the generated remote-client face keys 'appStage' into TypertClientRemote.
import type {} from '@ryanyujazz/dsh-app-stage/remote'
import type {} from './contract.ts'
import { StageShell } from './StageShell.tsx'
import { createAppStageBridge } from './bridge.ts'
import { createStageRouter, startRouterLoop } from './router.ts'
import { en, zh, type AppStageKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** App Stage shell copy (desktop, dev menu, container chrome). */
    'app-stage': AppStageKey
  }
}

/** Dictionary namespace owned by this plugin. */
const NS = 'app-stage'

/** Services required by the App Stage shell (remote.appStage mounts via workbench-remotes). */
export const inject = ['slots', 'locale', 'layout', 'sessions', 'remote', 'remote.appStage']

/** Mount the Stage Shell into the frame's apps seat.
 * @param ctx - Client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-app-stage: dictionaries')

  // Capture the namespace once: a Proxy read per render would invalidate
  // every effect on every render (ui-workbench-artifact precedent).
  const appStage = ctx.remote['appStage']

  // Live current-session feed as a plain external store: `inject` props are
  // captured once at registration, so the dev scope must arrive as a
  // subscription the component reads through useSyncExternalStore — the
  // ctx.sessions subscription itself never reaches the render path.
  const sessions = {
    subscribe: (listener: () => void) => ctx.sessions.list.subscribe(listener),
    getSnapshot: () => ctx.sessions.list.getSnapshot().current,
  }

  // Sandbox data bridge: the relay reads the same captured namespace and the
  // same live session feed; the container view attaches it per open frame.
  const bridge = createAppStageBridge({ remote: appStage, session: sessions.getSnapshot })

  // The M4 operation router: executes host-queued invoke/open requests in
  // the live container. The activity signal lights the layout's stage dot
  // and the conversation chip; app_open focus is the agent face's one
  // user-view switch.
  const router = createStageRouter({
    remote: appStage,
    session: sessions.getSnapshot,
    onActivity: activity => { ctx.layout.setStageActivity(activity) },
    onPresent: focus => { if (focus) ctx.layout.setStageMode('apps') },
  }, bridge)
  ctx.effect(() => startRouterLoop({ poll: () => router.poll() }, { session: sessions.getSnapshot }), 'ui-app-stage: router poll loop')

  ctx.effect(
    () => ctx.slots.inject('deepcreator.stage.apps', () => ctx.slots.register(
      {
        name: 'deepcreator.stage.apps',
        locale: NS,
        inject: () => ({
          // Writes stay one-way: the shell calls down into ctx.layout.
          layout: {
            setDockOpen: open => { ctx.layout.setDockOpen(open) },
            setStageMode: mode => { ctx.layout.setStageMode(mode) },
          },
          remote: appStage,
          sessions,
          scanTick: 0,
          router,
        }),
      },
      StageShell,
    )),
    'ui-app-stage: stage shell seat',
  )
}

export type { AppStageRemote, StageShellProps } from './contract.ts'
export { StageShell } from './StageShell.tsx'
export { en, zh } from './locales.ts'
export type { AppStageKey } from './locales.ts'
