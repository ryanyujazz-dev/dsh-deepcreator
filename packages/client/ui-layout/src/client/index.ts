/**
 * Layout plugin, browser half: one register() call contributes AppFrame into
 * the runtime's built-in 'root' slot and, in the same breath, declares the
 * six child slots (declaration = exclusive render authority), seats the
 * layout store (panel geometry + stage mode), and wires the panel-action
 * service face. ctx.layout is the cross-plugin panel-action contract;
 * navigation state lives with the runtime sessions service. A second effect
 * seats the theme presenter, which projects ctx.theme snapshots onto
 * document.body; a third contributes the stage-mode segmented control into
 * ui-sidebar's stage-mode seat.
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@ryanyujazz/dsh-client-ui-theme/client'
import type {} from '@ryanyujazz/dsh-client-locale/client'
import type { PanelActions } from './service.ts'
import { AppFrame } from './AppFrame.tsx'
import { StageModeSegmented } from './StageModeSegmented.tsx'
import { createLayoutStore } from './stores.ts'
import { LayoutController } from './service.ts'
import { ThemePresenter } from './theme-presenter.ts'
import { en, zh, type LayoutKey } from './locales.ts'

// Contract exports only (export-convergence rule: cross-package consumers
// keep a symbol exported; test-only/package-internal symbols live off /src).
// ILayout: the ctx.layout face consumers and test fakes type against.
// OwnerShare contracts below are the render-side halves registrants compose
// against; the frame components and the store factory are package-internal.
export { LayoutController } from './service.ts'
export type { ILayout } from './service.ts'
export type { StageModeSegmentedProps } from './StageModeSegmented.tsx'
export type { LayoutKey } from './locales.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The outward face only; the concrete service stays inside this plugin. */
    layout: import('./service.ts').ILayout
  }
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Layout-owned controls copy (stage-mode segmented control). */
    layout: LayoutKey
  }
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    // The 'root' entry itself is the runtime's built-in slot (declared
    // there); these five are the frame's children, declared by the same
    // register() call that contributes AppFrame. Session owners never pass
    // sessionId: the framework injects it as a standard prop.
    /**
     * The whole left column. OCCUPIED by ui-sidebar's SidebarRoot, which
     * declares the workspace and settings seats inside it — registering here
     * replaces the navigation column outright rather than adding to it, and
     * the seats it declares disappear with it. To add something to the
     * sidebar, register into one of those inner seats instead.
     *
     * The occupant receives the frame's live column state (collapsed, width).
     * At zero width it remains mounted only for state continuity; the frame's
     * dedicated sidebar-toggle seat owns the visible reopen affordance.
     */
    'sidebar': { kind: 'single'; scope: 'root'; owner: SidebarOwnerProps }
    /**
     * The whole center column, across both the no-session hero and a live
     * conversation. OCCUPIED by ui-conversation's ConversationRoot, which
     * declares the session body, composer, and input seats inside it —
     * registering here replaces the entire conversation surface (and removes
     * every seat it declares) rather than adding to it.
     *
     * Current-session-optional: the occupant owns both states without
     * changing its React identity, so it keeps its own state across a session
     * switch. It receives no owner props; session facts arrive through the
     * framework hooks of the `session-maybe` scope.
     */
    'conversation': { kind: 'single'; scope: 'session-maybe'; owner: ConvOwnerProps }
    /**
     * The right details column, shown when the layout opens it. OCCUPIED by
     * ui-workbench, which declares the keyed panel and icon extension seats.
     * Registering here replaces the entire Workbench column. Absent an
     * occupant the column renders nothing.
     *
     * The framework injects the session id and hooks for the `session` scope;
     * owner props report Stage width, resolved column width, and pointer-resize
     * gesture metadata while `ctx.layout` owns rendered geometry.
     */
    'details': { kind: 'single'; scope: 'session'; owner: DetailsOwnerProps }
    /**
     * The App Stage takeover layer: the whole central Stage (conversation +
     * Workbench positions, never the Sidebar) while stage mode is 'apps'.
     * OCCUPIED by ui-app-stage's Stage Shell; registering here replaces the
     * desktop surface outright. The layer is MOUNTED PERMANENTLY and hidden
     * while conversation mode owns the Stage (the frame keeps the subtree
     * alive for state continuity, like the details column at zero width), so
     * a mode switch never rebuilds it. No occupant, nothing rendered — an
     * empty seat is invisible at all times.
     */
    'deepcreator.stage.apps': { kind: 'single'; scope: 'root'; owner: StageAppsOwnerProps }
    /**
     * Stable frame-chrome seat for the sidebar reopen control. AppFrame
     * renders it only while the sidebar is fully closed, independently of
     * the no-session hero or active-conversation body. On macOS it sits just
     * after the native traffic lights on the shared 48px header baseline.
     */
    'deepcreator.shell.sidebar-toggle': { kind: 'single'; scope: 'root'; owner: SidebarToggleOwnerProps }
    /**
     * Frame-wide floating layer, above every column and outside their scroll
     * containers. Deliberately generic and unowned by any feature: a badge, a
     * toast stack or a status pill all belong here, and entries order among
     * themselves. The layer itself is click-through — entries opt back into
     * pointer events — so an occupant never blocks the app underneath.
     *
     * This is the additive seat for a frame-wide surface of your own: a fresh
     * `id` is added beside the shipped entries instead of replacing them.
     */
    'shell.overlay': { kind: 'list'; scope: 'root' }
  }
}

// OwnerShare contracts — the render-side share the slot owner supplies at
// renderSlot. Registrants IMPORT these and compose their full component props
// through the four-share intersection (PropsRuntime & PropsRenderSlots &
// PropsStore & I). Conversation business state and actions arrive through
// framework-standard hooks and each registrant's inject face, not owner props.

/** Sidebar owner share: live column state from the frame's concession solve. */
export interface SidebarOwnerProps {
  /** True when the sidebar is fully closed. */
  collapsed: boolean
  /** Rendered column width in px (zero when collapsed). */
  width: number
}

/** Sidebar-toggle owner share: geometry and visibility are frame-owned. */
export interface SidebarToggleOwnerProps {}

/**
 * App Stage seat owner share: the live viewport facts the occupant lays its
 * desktop out against. The dock toggle state rides along as a presentation
 * fact (the top bar's pressed state); every mode/dock WRITE goes through
 * `ctx.layout`, never back up through these props.
 */
export interface StageAppsOwnerProps {
  /** Phone-width viewport (≤640px): full-stage covering projection. */
  phone: boolean
  /** Stage width available to the occupant (minus Sidebar, minus an open dock). */
  stageWidth: number
  /** Whether the conversation dock currently occupies the stage's right band. */
  dockOpen: boolean
}

/** Conversation owner share: business state and actions belong to the registrant. */
export interface ConvOwnerProps {}

/** Details owner share: empty — sessionId arrives as a framework-standard prop. */
export interface DetailsOwnerProps {
  /** Resolved Workbench width after the frame concession solve. */
  width: number
  /** Conversation + Workbench width, excluding Sidebar. */
  stageWidth: number
  /** Present only while the user is dragging the outer details boundary. */
  resizeGesture: { active: true; startWidth: number } | null
}

/** Required services (cordis fiber inject — the loader passes all module exports as an object plugin). */
export const inject = ['slots', 'theme', 'locale']

/**
 * Client plugin body: provide ctx.layout, then one register() call — AppFrame
 * into 'root' with the six child-slot declarations, the layout store seat,
 * and the inject hook that hands the store's bound actions to the service.
 * The same store handle seats the stage-mode segmented control ui-layout
 * contributes into ui-sidebar's `sidebar.stage-mode` seat (the framework
 * keys store instances by handle × scope, so both root-scope entries share
 * one instance — the mode has a single source of truth).
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  const layout = new LayoutController()
  ctx.effect(() => ctx.locale.register('layout', { zh, en }), 'ui-layout: dictionary')
  const layoutStore = createLayoutStore()
  ctx.effect(() => {
    const disposeService = ctx.reflect.provide('layout', layout)
    const disposeRegistration = ctx.slots.register({
      name: 'root',
      children: {
        'sidebar': { kind: 'single', scope: 'root' },
        'conversation': { kind: 'single', scope: 'session-maybe' },
        'details': { kind: 'single', scope: 'session' },
        'deepcreator.stage.apps': { kind: 'single', scope: 'root' },
        'deepcreator.shell.sidebar-toggle': { kind: 'single', scope: 'root' },
        'shell.overlay': { kind: 'list', scope: 'root' },
      },
      // Shared handle (created in the apply world per plugin lifetime): the
      // framework delivers useStore/actions to AppFrame as standard props and
      // reuses the same root-scope instance for the segmented control below.
      store: layoutStore,
      // The hook's only side effect connects the root store to ctx.layout;
      // conversation business actions belong to their registrants.
      inject: (actions: PanelActions) => {
        layout.attachPanels(actions)
        return {}
      },
    }, AppFrame)
    return () => {
      disposeRegistration()
      // provide()'s disposer settles asynchronously; teardown is synchronous fire-and-forget.
      void disposeService()
    }
  }, 'ui-layout: service + root registration')

  // The stage-mode switch: waits for ui-sidebar's seat declaration (the
  // sidebar plugin owns the column) and contributes the 对话｜应用 segmented
  // control bound to the same layout store. inject()'s disposer — returned
  // here, collected by the caller's fiber unload — unregisters the entry.
  ctx.effect(() => ctx.slots.inject('sidebar.stage-mode', () => ctx.slots.register({
    name: 'sidebar.stage-mode',
    locale: 'layout',
    store: layoutStore,
  }, StageModeSegmented)), 'ui-layout: stage-mode segmented control')

  // Theme presentation: pure DOM writes from resolved snapshots — initial
  // state through the getter once, then event-driven only; no React path.
  ctx.effect(() => {
    const presenter = new ThemePresenter()
    presenter.apply(ctx.theme.getTheme())
    const off = ctx.on('theme/change', (snapshot) => { presenter.apply(snapshot) })
    return () => {
      off()
      presenter.dispose()
    }
  }, 'ui-layout: theme presenter')
}
