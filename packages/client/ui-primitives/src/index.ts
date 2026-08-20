/**
 * Cordis-free React primitives styled only through `--dsw-*` tokens.
 */

/** Cordis lifecycle entry; browser primitives are exposed through the client module table. */
export function apply(): void {}

export { StateDot } from './StateDot.tsx'
export type { StateDotState } from './StateDot.tsx'
export { DisclosureRow } from './DisclosureRow.tsx'
export type { DisclosureRowProps } from './DisclosureRow.tsx'
export { Button } from './Button.tsx'
export type { ButtonVariant } from './Button.tsx'
export { Pill } from './Pill.tsx'
export { Input } from './Input.tsx'
export { Menu } from './Menu.tsx'
export type { MenuEntry, MenuItem, MenuSeparator, MenuLabel } from './Menu.tsx'
export { useAnchoredMaxHeight } from './useAnchoredMaxHeight.ts'
export { HoverCard } from './HoverCard.tsx'
export { Modal } from './Modal.tsx'
export { OnboardingSurface } from './OnboardingSurface.tsx'
export { RiskConfirmation } from './RiskConfirmation.tsx'
export type { RiskConfirmationProps } from './RiskConfirmation.tsx'
export { ConnectionBanner } from './ConnectionBanner.tsx'
export { FishLogo } from './FishLogo.tsx'
export { BrandWordmark } from './BrandWordmark.tsx'
export { Tooltip } from './Tooltip.tsx'
export type { TooltipSide } from './Tooltip.tsx'
export { FileIcon, FileLabel } from './file-icons/FileIcon.tsx'
export type { FileIconProps, FileLabelProps } from './file-icons/FileIcon.tsx'
export { resolveFileIcon } from './file-icons/file-icon.ts'
export type { ResolvedFileIcon } from './file-icons/file-icon.ts'
export {
  WorkbenchPanelIconButton, WorkbenchPanelShell,
} from './WorkbenchPanelShell.tsx'
export type {
  WorkbenchPanelIconButtonProps, WorkbenchPanelShellProps,
} from './WorkbenchPanelShell.tsx'
export { WorkbenchPanelTabs } from './WorkbenchPanelTabs.tsx'
export type { WorkbenchPanelTabsProps } from './WorkbenchPanelTabs.tsx'
export { SidebarRow } from './SidebarRow.tsx'
export type { SidebarRowProps } from './SidebarRow.tsx'
export {
  ICON_TOOLBAR_BUTTON_SIZE, ICON_TOOLBAR_GAP, ICON_TOOLBAR_GLYPH_SIZE,
  SIDEBAR_BRAND_ICON_SIZE, SIDEBAR_ICON_SIZE,
} from './sidebarMetrics.ts'
export { Toast } from './Toast.tsx'
export { writeClipboard } from './clipboard.ts'
export { JsonTree } from './JsonTree.tsx'
export type { JsonTreeProps, JsonTreeLabels } from './JsonTree.tsx'
export { TerminalBlock, DEFAULT_TERMINAL_MAX_LINES } from './TerminalBlock.tsx'
export type { TerminalBlockProps, TerminalBlockLabels } from './TerminalBlock.tsx'
export { ReadBlock, DEFAULT_READ_MAX_LINES } from './ReadBlock.tsx'
export type { ReadBlockProps, ReadBlockLine } from './ReadBlock.tsx'
export { CodeSurface } from './CodeSurface.tsx'
export type { CodeSurfaceProps } from './CodeSurface.tsx'
export { DiffBlock, DEFAULT_DIFF_MAX_LINES } from './DiffBlock.tsx'
export type { DiffBlockProps, DiffHunk } from './DiffBlock.tsx'
export {
  buildCachedDiffHunkModel, buildDiffHunkModel, countDiffHunkLines, diffContentLines, diffLanguageFromPath, prioritizeSnapshotHighlights,
  snapshotHighlightKey, subscribeSnapshotHighlight, warmDiffHunkModels,
} from './diff/model.ts'
export type { AlignedRow, DiffHunkInput, DiffHunkModel, TextRange } from './diff/model.ts'
export { parseUnifiedDiff } from './diff/unified.ts'
export type { UnifiedDiffFile } from './diff/unified.ts'
export { SearchBlock, DEFAULT_SEARCH_MAX_LINES } from './SearchBlock.tsx'
export type {
  SearchBlockProps, SearchMatchesBlockProps, SearchPathsBlockProps, SearchFileGroup, SearchBlockLineMatch,
} from './SearchBlock.tsx'
export { WebBlock } from './WebBlock.tsx'
export type { WebBlockProps, WebSearchBlockProps, WebFetchBlockProps, WebSourceView } from './WebBlock.tsx'
export { CodeBlock } from './markdown/CodeBlock.tsx'
export type { CodeBlockProps } from './markdown/CodeBlock.tsx'
export { JsonBlock } from './markdown/JsonBlock.tsx'
export { MarkdownText } from './markdown/MarkdownText.tsx'
export type { MarkdownCodeLabels, MarkdownFileMentions } from './markdown/MarkdownText.tsx'
export { MessageText } from './markdown/MessageText.tsx'
export { extractMarkdownPlainText } from './markdown/plain-text.ts'
export type { MarkdownPlainTextMode, MarkdownPlainTextOptions } from './markdown/plain-text.ts'
export { CODE_THEME_IDS } from './markdown/code-themes.ts'
export type { CodeThemeId, LightCodeThemeId, DarkCodeThemeId } from './markdown/code-themes.ts'
export * from './icons/index.tsx'
export * from './icons/deepcreator.tsx'
