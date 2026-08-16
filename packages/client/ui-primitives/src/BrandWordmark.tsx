// DeepCreator brand wordmark: the compact whale mark shares the sidebar's
// 14px icon scale, while the geometric label inherits the product font token
// so it follows the active platform and theme without a bitmap asset.

import { FishLogo } from './FishLogo.tsx'
import type { IconProps } from './icons/props.ts'
import { SIDEBAR_BRAND_ICON_SIZE } from './sidebarMetrics.ts'

/** Native wordmark height used to scale the complete lockup. */
const WORDMARK_HEIGHT = 18
/** Native wordmark width including the whale, gap, and label. */
const WORDMARK_WIDTH = 116

/**
 * Render the DeepCreator brand wordmark.
 * @param props.size - complete lockup height in px (default 18).
 * @param props.className - extra class for layout placement.
 * @returns the theme-aware vector wordmark (aria-hidden decorative brand art).
 */
export function BrandWordmark({ size = WORDMARK_HEIGHT, className }: IconProps) {
  return (
    <svg
      width={(size * WORDMARK_WIDTH) / WORDMARK_HEIGHT}
      height={size}
      className={className}
      viewBox={`0 0 ${WORDMARK_WIDTH} ${WORDMARK_HEIGHT}`}
      fill="none"
      aria-hidden="true"
    >
      <g transform="translate(0 3.1)">
        <FishLogo size={SIDEBAR_BRAND_ICON_SIZE} />
      </g>
      <text
        x="19"
        y="14.25"
        fill="currentColor"
        fontSize="14.5"
        fontWeight="650"
        letterSpacing="-0.58"
        style={{ fontFamily: 'var(--dsw-font-family)' }}
      >
        DeepCreator
      </text>
    </svg>
  )
}
