/**
 * Sidebar slot contract: the registrant-side props composition for the
 * layout-owned `sidebar` slot, plus the holes this shell declares. The shell
 * owns column geometry (fold state machine, brand row, New Session);
 * feature-owned primary actions register into `sidebar.primary.action`,
 * everything between the section header and the list bottom is the
 * `sidebar.workspaces` registrant's (ui-workspace), and the foot is the
 * `sidebar.settings` registrant's (ui-settings), followed by optional footer
 * actions in `sidebar.footer.action`.
 */
import type { PropsLocale, PropsRenderSlots, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: pulls ui-layout's SlotMap merge (the 'sidebar' entry) into every
// program that sees this contract, so PropsRuntime<'sidebar'> resolves.
import type {} from '@ryanyujazz/dsh-client-ui-layout/client'
import type { WorkspaceId } from '@deepseek-ai/dsh-client-runtime/client'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /**
     * The stage-mode switch (对话｜应用) directly under the Brand row and
     * outside the primary action list. Declared by this package's 'sidebar'
     * entry; the layout plugin contributes the control (the mode is layout
     * state). The occupant renders nothing while the sidebar is collapsed
     * (wide=false) — the mode survives independently of the column.
     */
    'sidebar.stage-mode': { kind: 'single'; scope: 'root'; owner: SidebarStageModeOwnerProps }
    /** Feature-owned rows immediately after the shell-owned New Session row. */
    'sidebar.primary.action': { kind: 'list'; scope: 'root'; owner: SidebarPrimaryActionOwnerProps }
    /**
     * The workspace/session browsing region: section header, search, the
     * grouped/flat session list, and every workspace dialog. Declared by this
     * package's 'sidebar' entry (declaring is claiming); ui-workspace
     * registers the browser.
     */
    'sidebar.workspaces': { kind: 'single'; scope: 'root'; owner: SidebarSectionOwnerProps }
    /**
     * The settings seat at the sidebar foot. Declared by this package's
     * 'sidebar' entry; ui-settings registers its trigger row + modal panel.
     * The sidebar passes only its column state — it holds no settings state.
     */
    'sidebar.settings': { kind: 'single'; scope: 'root'; owner: SidebarSettingsOwnerProps }
    /**
     * Optional actions beside Settings at the sidebar foot. Declared by this
     * package's 'sidebar' entry; each action receives only the column state.
     */
    'sidebar.footer.action': { kind: 'list'; scope: 'root'; owner: SidebarFooterActionOwnerProps }
  }
}

/**
 * Owner share of the browser hole — the only facts crossing the shell/region
 * boundary. Business data and actions arrive through the region's own inject.
 */
export interface SidebarSectionOwnerProps {
  /** True while the expanded browser surface is rendered. */
  wide: boolean
  /** Rail icons request expansion; the browser rides the wide flip for focus. */
  expandSidebar: () => void
}

/**
 * Owner share of the sidebar settings seat: the column display state the
 * occupant's trigger row renders only while the expanded surface exists.
 */
export interface SidebarSettingsOwnerProps {
  /** Whether expanded sidebar content is visible. */
  wide: boolean
}

/** Owner share of a feature row in the sidebar's primary action list. */
export interface SidebarPrimaryActionOwnerProps {
  /** Whether expanded sidebar content is visible. */
  wide: boolean
}

/**
 * Owner share of the stage-mode switch seat: only the column display state.
 * The mode itself lives in the layout store of the contributing registrant.
 */
export interface SidebarStageModeOwnerProps {
  /** Whether expanded sidebar content is visible. */
  wide: boolean
}

/** Owner share of an action rendered beside Settings at the sidebar foot. */
export interface SidebarFooterActionOwnerProps {
  /** Whether expanded sidebar content is visible. */
  wide: boolean
}

/**
 * Registrant-private injected share (arrives via the register inject
 * factory). The shell keeps only its own controls: starting a Session from
 * the New Session button and toggling the column.
 */
export type SidebarRootInjected = {
  /**
   * Start a New Session: with a workspace, reuse-or-create its blank session
   * and open it; without one, inherit the current Session Workspace, then the
   * recent Workspace, or clear into the New Session pure view when none exist.
   */
  startSession: (workspaceId?: WorkspaceId) => void
  /** Toggle the sidebar column through the layout service. */
  toggleSidebar: () => void
}

/** Injected face for the frame-owned closed-sidebar control. */
export type SidebarClosedToggleInjected = {
  /** Reopen the fully closed sidebar through the layout service. */
  toggleSidebar: () => void
}

/** Stable frame-chrome reopen control; layout owns its position and visibility. */
export type SidebarClosedToggleComponentProps =
  PropsRuntime<'deepcreator.shell.sidebar-toggle'>
  & SidebarClosedToggleInjected
  & PropsLocale<'sidebar'>

/**
 * Full component props: layout owner state/actions plus the declared holes'
 * render shares, this package's injected callbacks, and the standard locale
 * seat. No store is registered.
 */
export type SidebarRootComponentProps =
  PropsRuntime<'sidebar'>
  & PropsRenderSlots<'sidebar.stage-mode' | 'sidebar.primary.action' | 'sidebar.workspaces' | 'sidebar.settings' | 'sidebar.footer.action'>
  & SidebarRootInjected & PropsLocale<'sidebar'>
