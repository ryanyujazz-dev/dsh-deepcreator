/**
 * DeepCreator-owned product glyphs.
 *
 * Keep these assets separate from `icons/index.tsx`, which mirrors the
 * official `ic_ds_*` library. Product artwork can therefore evolve without
 * overwriting or being mistaken for an upstream DeepSeek icon.
 */
import type { IconProps } from './props.ts'
import type { ReactNode } from 'react'

function WorkbenchGlyph({ size = 16, className, name, children }: IconProps & { name: string; children: ReactNode }) {
  return <svg width={size} height={size} className={className} viewBox="0 0 16 16" fill="none" aria-hidden data-deepcreator-icon={name}>{children}</svg>
}

/** Compact model selector: a literal two-lobed brain rather than the orbital Think glyph. */
export const DeepCreatorIconBrain16 = (props: IconProps) => (
  <WorkbenchGlyph {...props} name="brain">
    <path
      d="M7.75 2.7A2.5 2.5 0 0 0 3.4 4.4 2.45 2.45 0 0 0 2.15 8.55a2.7 2.7 0 0 0 2.55 4.5 2.35 2.35 0 0 0 3.05 1.4V2.7ZM8.25 2.7a2.5 2.5 0 0 1 4.35 1.7 2.45 2.45 0 0 1 1.25 4.15 2.7 2.7 0 0 1-2.55 4.5 2.35 2.35 0 0 1-3.05 1.4V2.7Z"
      stroke="currentColor" strokeWidth="1.15" strokeLinecap="round" strokeLinejoin="round"
    />
  </WorkbenchGlyph>
)

/** Workbench launcher: one surface representing the complete panel collection. */
export const DeepCreatorIconPanels16 = (props: IconProps) => (
  <WorkbenchGlyph {...props} name="workbench-panels">
    <rect x="1.75" y="2" width="12.5" height="12" rx="1.5" stroke="currentColor" strokeWidth="1.2" />
    <path d="M7.75 2.25v11.5M8 7.75h6" stroke="currentColor" strokeWidth="1.2" />
  </WorkbenchGlyph>
)

/** Workbench Activity: two compact status rows. */
export const DeepCreatorIconActivity16 = (props: IconProps) => (
  <WorkbenchGlyph {...props} name="workbench-activity">
    <circle cx="3.25" cy="5" r="1.25" stroke="currentColor" strokeWidth="1.2" />
    <circle cx="3.25" cy="11" r="1.25" stroke="currentColor" strokeWidth="1.2" />
    <path d="M6.25 5h7.5M6.25 11h7.5" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />
  </WorkbenchGlyph>
)

/** Workbench Artifact: a clipboard with two content lines. */
export const DeepCreatorIconArtifact16 = (props: IconProps) => (
  <WorkbenchGlyph {...props} name="workbench-artifact">
    <path fill="currentColor" d="M11.28 1.73Q11.15 1.38 10.85 1.15Q10.54 0.93 10.16 0.93L5.84 0.93Q5.46 0.93 5.15 1.15Q4.85 1.38 4.72 1.73L4.16 1.73Q3.58 1.73 3.09 2.02Q2.59 2.32 2.3 2.82Q2 3.33 2 3.9L2 12.91Q2 13.49 2.3 13.98Q2.59 14.48 3.09 14.78Q3.58 15.07 4.16 15.07L11.84 15.07Q12.42 15.07 12.91 14.78Q13.41 14.48 13.7 13.98Q14 13.49 14 12.91L14 3.9Q14 3.33 13.7 2.82Q13.41 2.32 12.91 2.02Q12.42 1.73 11.84 1.73L11.28 1.73ZM5.66 2.1Q5.66 2.02 5.71 1.97Q5.76 1.92 5.84 1.92L10.16 1.92Q10.24 1.92 10.29 1.97Q10.34 2.02 10.34 2.1L10.34 3.23Q10.34 3.3 10.29 3.34Q10.24 3.39 10.16 3.39L5.84 3.39Q5.76 3.39 5.71 3.35Q5.66 3.31 5.66 3.23L5.66 2.1ZM13.01 12.91Q13.01 13.39 12.66 13.74Q12.3 14.08 11.84 14.08L4.16 14.08Q3.68 14.08 3.34 13.74Q3.01 13.39 3.01 12.91L3.01 3.9Q3.01 3.42 3.34 3.08Q3.68 2.74 4.16 2.74L4.67 2.74L4.67 3.23Q4.67 3.7 5.02 4.05Q5.36 4.4 5.84 4.4L10.16 4.4Q10.64 4.4 10.98 4.05Q11.33 3.7 11.33 3.23L11.33 2.74L11.84 2.74Q12.3 2.74 12.66 3.08Q13.01 3.42 13.01 3.9L13.01 12.91ZM10.83 8.02Q11.04 8.02 11.18 7.87Q11.33 7.73 11.33 7.52Q11.33 7.31 11.18 7.16Q11.04 7.01 10.83 7.01L5.17 7.01Q4.96 7.01 4.82 7.16Q4.67 7.31 4.67 7.52Q4.67 7.73 4.82 7.87Q4.96 8.02 5.17 8.02L10.83 8.02ZM10.83 10.85Q11.04 10.85 11.18 10.7Q11.33 10.56 11.33 10.35Q11.33 10.14 11.18 9.99Q11.04 9.84 10.83 9.84L5.17 9.84Q4.96 9.84 4.82 9.99Q4.67 10.14 4.67 10.35Q4.67 10.56 4.82 10.7Q4.96 10.85 5.17 10.85L10.83 10.85Z" />
  </WorkbenchGlyph>
)

/** Workbench Review: addition and removal marks inside one rounded frame. */
export const DeepCreatorIconReview16 = (props: IconProps) => (
  <WorkbenchGlyph {...props} name="workbench-review">
    <rect x="1.75" y="2" width="12.5" height="12" rx="2" stroke="currentColor" strokeWidth="1.2" />
    <path d="M5.5 6h5M8 3.5v5M6.5 12h3" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />
  </WorkbenchGlyph>
)

/** Workbench Terminal: an unframed prompt fold and cursor. */
export const DeepCreatorIconTerminal16 = (props: IconProps) => (
  <WorkbenchGlyph {...props} name="workbench-terminal">
    <path d="M2.5 4.25 6.25 8 2.5 11.75M8 11.75h5.5" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round" />
  </WorkbenchGlyph>
)

/** Workbench Preview: the supplied play silhouette, outlined and optically inset. */
export const DeepCreatorIconPreview16 = (props: IconProps) => (
  <WorkbenchGlyph {...props} name="workbench-preview">
    <path
      d="M4.51 1.57Q3.97 1.26 3.38 1.38Q2.8 1.49 2.41 1.94Q2.02 2.38 2.02 3.01L2.02 12.98Q2.02 13.6 2.41 14.06Q2.8 14.51 3.38 14.62Q3.97 14.74 4.51 14.43L13.15 9.44Q13.7 9.14 13.89 8.57Q14.08 8 13.89 7.43Q13.7 6.86 13.15 6.56L4.51 1.57Z"
      transform="translate(8 8) scale(.82) translate(-8 -8)"
      fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"
    />
  </WorkbenchGlyph>
)

/** Workbench Panel expand: the supplied outward-arrow glyph in its original direction. */
export const DeepCreatorIconPanelExpand16 = (props: IconProps) => (
  <WorkbenchGlyph {...props} name="workbench-panel-expand">
    <path
      d="M1.58 6.43Q1.58 6.64 1.73 6.78Q1.87 6.93 2.08 6.93Q2.29 6.93 2.44 6.78Q2.59 6.64 2.59 6.43L2.59 3.3L6.1 6.82Q6.24 6.96 6.45 6.96Q6.66 6.96 6.8 6.82Q6.96 6.67 6.96 6.46Q6.96 6.26 6.8 6.11L3.28 2.58L6.42 2.58Q6.62 2.58 6.77 2.43Q6.91 2.29 6.91 2.08Q6.91 1.87 6.77 1.73Q6.62 1.58 6.42 1.58L2.45 1.58Q2.1 1.58 1.84 1.83Q1.58 2.08 1.58 2.45L1.58 6.43ZM9.09 13.92Q9.09 14.13 9.23 14.27Q9.38 14.42 9.58 14.42L13.55 14.42Q13.92 14.42 14.17 14.16Q14.42 13.9 14.42 13.55L14.42 9.57Q14.42 9.36 14.27 9.22Q14.13 9.07 13.92 9.07Q13.71 9.07 13.56 9.22Q13.41 9.36 13.41 9.57L13.41 12.69L9.9 9.18Q9.76 9.04 9.55 9.04Q9.34 9.04 9.2 9.18Q9.04 9.33 9.04 9.54Q9.04 9.74 9.2 9.89L12.7 13.41L9.58 13.41Q9.38 13.41 9.23 13.56Q9.09 13.71 9.09 13.92Z"
      fill="currentColor"
    />
  </WorkbenchGlyph>
)

/** Workbench Panel collapse: the supplied inward-arrow glyph in its original direction. */
export const DeepCreatorIconPanelCollapse16 = (props: IconProps) => (
  <WorkbenchGlyph {...props} name="workbench-panel-collapse">
    <path
      d="M5.97 6.67L2.83 6.67Q2.62 6.67 2.47 6.82Q2.32 6.96 2.32 7.17Q2.32 7.38 2.47 7.52Q2.62 7.66 2.83 7.66L6.8 7.66Q7.15 7.66 7.41 7.41Q7.66 7.15 7.66 6.8L7.66 2.82Q7.66 2.61 7.51 2.46Q7.36 2.32 7.15 2.32Q6.94 2.32 6.8 2.46Q6.66 2.61 6.66 2.82L6.66 5.95L2.69 1.98Q2.54 1.84 2.34 1.84Q2.13 1.84 1.98 1.98Q1.84 2.13 1.84 2.34Q1.84 2.54 1.98 2.69ZM8.34 13.17Q8.34 13.38 8.48 13.52Q8.62 13.66 8.83 13.66Q9.04 13.66 9.18 13.52Q9.33 13.38 9.33 13.17L9.33 10.05L13.3 14.02Q13.44 14.16 13.65 14.16Q13.86 14.16 14 14.02Q14.16 13.87 14.16 13.66Q14.16 13.46 14 13.31L10.02 9.33L13.17 9.33Q13.38 9.33 13.52 9.18Q13.66 9.04 13.66 8.83Q13.66 8.62 13.52 8.47Q13.38 8.32 13.17 8.32L9.2 8.32Q8.85 8.32 8.59 8.58Q8.34 8.83 8.34 9.2L8.34 13.17Z"
      fill="currentColor"
    />
  </WorkbenchGlyph>
)

/** DeepCreator settings-trigger glyph, sourced from gearshape.svg. */
export const DeepCreatorIconGearshape16 = ({ size = 16, className }: IconProps) => (
  <svg
    width={size} height={size} className={className} viewBox="0 0 24 24" fill="none"
    xmlns="http://www.w3.org/2000/svg" data-deepcreator-icon="gearshape"
  >
    <path
      d="M12.02 9Q12.84 9 13.52 9.41Q14.21 9.82 14.6 10.51Q15 11.21 15 12.02Q15 12.84 14.6 13.52Q14.21 14.21 13.52 14.6Q12.84 15 12 15Q11.18 15 10.49 14.59Q9.79 14.18 9.4 13.49Q9 12.79 9 11.98Q9 11.16 9.41 10.48Q9.82 9.79 10.51 9.4Q11.21 9 12.02 9ZM12.05 7.51Q10.82 7.51 9.78 8.11Q8.74 8.71 8.12 9.73Q7.51 10.75 7.51 11.98Q7.51 13.2 8.11 14.24Q8.71 15.29 9.74 15.9Q10.78 16.51 12 16.51Q13.22 16.51 14.26 15.91Q15.29 15.31 15.9 14.28Q16.51 13.25 16.51 12.02Q16.51 10.8 15.91 9.77Q15.31 8.74 14.29 8.12Q13.27 7.51 12.05 7.51ZM13.56 22.66Q14.02 22.66 14.4 22.4Q14.78 22.15 14.98 21.74L15.79 19.85L15.98 19.75Q16.42 19.49 16.85 19.22L18.91 19.49Q19.39 19.54 19.8 19.33Q20.21 19.13 20.45 18.72L22.03 15.98Q22.27 15.58 22.24 15.12Q22.2 14.66 21.94 14.28L20.69 12.6L20.69 11.42L21.94 9.74Q22.22 9.36 22.25 8.9Q22.27 8.45 22.03 8.04L20.45 5.28Q20.23 4.9 19.82 4.68Q19.42 4.46 18.94 4.51L16.85 4.78Q16.42 4.46 15.86 4.2L15.02 2.23Q14.83 1.82 14.45 1.56Q14.06 1.3 13.61 1.3L10.44 1.3Q9.98 1.3 9.59 1.56Q9.19 1.82 9 2.23L8.16 4.2L7.92 4.34Q7.73 4.44 7.55 4.54Q7.37 4.63 7.2 4.75L5.09 4.51Q4.63 4.44 4.21 4.64Q3.79 4.85 3.55 5.26L1.97 8.02Q1.73 8.4 1.76 8.87Q1.8 9.34 2.06 9.72L3.34 11.42L3.34 12.53L2.06 14.23Q1.78 14.62 1.75 15.07Q1.73 15.53 1.97 15.94L3.53 18.67Q3.77 19.08 4.18 19.28Q4.58 19.49 5.06 19.44L7.13 19.2Q7.8 19.63 8.14 19.8L8.98 21.72Q9.14 22.15 9.53 22.4Q9.91 22.66 10.39 22.66L13.56 22.66ZM7.08 17.66L4.8 17.9L3.22 15.1L4.58 13.27Q4.8 12.94 4.8 12.6Q4.78 12.31 4.78 11.95Q4.78 11.59 4.8 11.3Q4.8 10.92 4.58 10.61L3.22 8.74L4.85 5.95L7.15 6.24Q7.37 6.26 7.55 6.22Q7.73 6.17 7.87 6.07Q8.3 5.76 8.93 5.47Q9.29 5.28 9.43 4.94L10.39 2.78L13.61 2.81L14.52 4.94Q14.64 5.26 15.02 5.47Q15.55 5.71 16.1 6.1Q16.46 6.34 16.82 6.26L19.13 6.02L20.71 8.83L19.37 10.63Q19.1 10.92 19.15 11.33Q19.18 11.64 19.18 12.01Q19.18 12.38 19.15 12.67Q19.13 13.06 19.37 13.37L20.71 15.19L19.08 17.98L16.85 17.71Q16.66 17.69 16.46 17.72Q16.27 17.76 16.13 17.88Q15.6 18.26 15 18.53Q14.83 18.62 14.69 18.76Q14.54 18.89 14.47 19.06L13.56 21.14L10.34 21.12L9.46 19.03Q9.29 18.67 8.95 18.5Q8.47 18.29 7.85 17.88Q7.58 17.69 7.25 17.69Z"
      fill="currentColor"
    />
  </svg>
)

/** DeepCreator Session-pin glyph, sourced from pin.svg. */
export const DeepCreatorIconPin16 = ({ size = 16, className }: IconProps) => (
  <svg
    width={size} height={size} className={className} viewBox="0 0 24 24" fill="none"
    xmlns="http://www.w3.org/2000/svg" data-deepcreator-icon="pin"
  >
    <path
      d="M16.08 2.83Q15.74 2.5 15.25 2.5Q14.76 2.5 14.4 2.83L13.63 3.6Q13.27 3.98 13.28 4.46Q13.3 4.94 13.68 5.33Q13.73 5.38 13.74 5.44Q13.75 5.5 13.7 5.54Q13.68 5.54 13.66 5.57L8.98 8.88Q7.92 8.14 6.58 8.26Q5.23 8.38 4.32 9.29L3.7 9.91Q3.36 10.25 3.36 10.73Q3.36 11.21 3.7 11.54L7.13 14.98L2.57 21.26Q2.52 21.34 2.54 21.41Q2.57 21.48 2.64 21.5Q2.71 21.53 2.78 21.48L9 16.87L12.43 20.28Q12.77 20.64 13.26 20.64Q13.75 20.64 14.06 20.28L14.57 19.8Q15.7 18.67 15.74 17.33Q15.79 15.98 15.07 14.95L18.36 10.3Q18.43 10.22 18.5 10.22Q18.58 10.22 18.65 10.3Q19.01 10.63 19.49 10.66Q19.97 10.68 20.3 10.34L21.12 9.53Q21.46 9.19 21.46 8.68Q21.46 8.16 21.1 7.85L16.08 2.83ZM19.49 9.05Q19.39 9 19.34 8.96Q19.3 8.93 19.2 8.88Q18.98 8.78 18.78 8.74Q18.58 8.69 18.36 8.71Q17.98 8.74 17.65 8.93Q17.33 9.12 17.14 9.41L13.15 15.07L13.61 15.53Q14.02 15.96 14.16 16.54Q14.3 17.11 14.16 17.66Q14.02 18.22 13.61 18.62L13.27 18.96L4.99 10.73L5.38 10.34Q5.78 9.94 6.34 9.79Q6.89 9.65 7.44 9.79Q7.99 9.94 8.4 10.34L8.86 10.8L14.52 6.82Q14.81 6.6 15 6.28Q15.19 5.95 15.22 5.59Q15.24 5.3 15.12 4.92Q15.1 4.8 15.04 4.69Q14.98 4.58 14.88 4.49L15.24 4.13L19.82 8.71L19.49 9.05Z"
      fill="currentColor"
    />
  </svg>
)

/**
 * DeepCreator scheduled-task glyph, optically fitted from timer.svg.
 *
 * The supplied artwork uses a detailed 24 px filled path. Rendering that path
 * at the sidebar's 14 px size leaves its 1.48 px features between device
 * pixels, so this product-owned variant keeps the same silhouette on a native
 * 14 px grid.
 */
export const DeepCreatorIconTimer16 = ({ size = 16, className }: IconProps) => (
  <svg
    width={size} height={size} className={className} viewBox="0 0 14 14" fill="none"
    xmlns="http://www.w3.org/2000/svg" data-deepcreator-icon="timer"
  >
    <path
      d="M7 1.25V3.7M3.65 3.2A5.55 5.55 0 1 0 7 1.45"
      stroke="currentColor" strokeWidth="1.15" strokeLinecap="round" strokeLinejoin="round"
    />
    <path
      d="M4.45 4.45L7 7"
      stroke="currentColor" strokeWidth="1.15" strokeLinecap="round"
    />
  </svg>
)

/** Product-tuned single-tone folder used in action rows. */
export const DeepCreatorIconFolderOpenOutline16 = ({ size = 16, className }: IconProps) => (
  <svg
    width={size} height={size} className={className} viewBox="0 0 16 16" fill="none"
    data-deepcreator-icon="folder-open-outline"
  >
    <path d="M5.19629 1.57104C5.81144 1.5711 6.38623 1.8786 6.72754 2.39038L7.19922 3.09839C7.28454 3.22635 7.42824 3.30344 7.58203 3.30347H12.1699C13.5039 3.30348 14.5859 4.38548 14.5859 5.71948V6.62671C15.2694 7.02689 15.6605 7.85012 15.4385 8.68726L14.3848 12.658C14.1037 13.7164 13.1449 14.4527 12.0498 14.4529H2.91699C1.51651 14.4529 0.451662 13.2814 0.501954 11.9519V3.98706C0.501954 2.65305 1.58396 1.57104 2.91797 1.57104H5.19629ZM3.7793 7.75562C3.30994 7.75562 2.89883 8.07153 2.77832 8.52515L1.91602 11.7722C1.74167 12.4291 2.23734 13.073 2.91699 13.073H12.0498C12.5191 13.0728 12.9304 12.757 13.0508 12.3035L14.1045 8.33374C14.1819 8.04202 13.9619 7.756 13.6602 7.75562H3.7793ZM2.91797 2.9519C2.34625 2.9519 1.88281 3.41534 1.88281 3.98706V7.2937C2.33068 6.7269 3.02249 6.37476 3.7793 6.37476H13.2051V5.71948C13.2051 5.14777 12.7416 4.68434 12.1699 4.68433H7.58203C6.96675 4.6843 6.39209 4.37595 6.05078 3.86401L5.5791 3.15601C5.49379 3.02821 5.34995 2.95196 5.19629 2.9519H2.91797Z" fill="currentColor" />
  </svg>
)

/** Hand-authored product sparkle used for generic agent activity. */
export const DeepCreatorIconSparkle16 = ({ size = 16, className }: IconProps) => (
  <svg
    width={size} height={size} className={className} viewBox="0 0 16 16" fill="none"
    xmlns="http://www.w3.org/2000/svg" data-deepcreator-icon="sparkle"
  >
    <path d="M6.1 3.1Q6.6 7.8 11.3 8.3Q6.6 8.8 6.1 13.5Q5.6 8.8 0.9 8.3Q5.6 7.8 6.1 3.1Z" fill="currentColor" />
    <path d="M11.9 1Q12.2 3.7 14.9 4Q12.2 4.3 11.9 7Q11.6 4.3 8.9 4Q11.6 3.7 11.9 1Z" fill="currentColor" />
    <path d="M12.5 9.4Q12.7 11.4 14.7 11.6Q12.7 11.8 12.5 13.8Q12.3 11.8 10.3 11.6Q12.3 11.4 12.5 9.4Z" fill="currentColor" />
  </svg>
)

/** Product inspect glyph shared by compact tool-row affordances. */
export const DeepCreatorIconInspectOutline12 = ({ size = 12, className }: IconProps) => (
  <svg
    width={size} height={size} className={className} viewBox="0 0 16 16" fill="none"
    xmlns="http://www.w3.org/2000/svg" aria-hidden data-deepcreator-icon="inspect"
  >
    <path d="M16 8L10.8571 12V10.552L14.1383 8L10.8571 5.448V4L16 8ZM5.14286 10.552L1.86171 8L5.14286 5.448V4L0 8L5.14286 12V10.552ZM9.02514 4L5.59657 12H6.84057L10.2691 4H9.02514Z" fill="currentColor" />
  </svg>
)

/** Product skill glyph used by sidebar and conversation-flow surfaces. */
export const DeepCreatorIconSkillOutline16 = ({ size = 16, className }: IconProps) => (
  <svg
    width={size} height={size} className={className} viewBox="0 0 16 16" fill="none"
    xmlns="http://www.w3.org/2000/svg" data-deepcreator-icon="skill"
  >
    <path
      d="M12.5113 15.4067C12.4395 15.6249 12.1308 15.6249 12.059 15.4067L11.643 14.1416C11.454 13.567 11.0033 13.1164 10.4288 12.9274L9.16369 12.5113C8.94544 12.4395 8.94544 12.1308 9.16369 12.059L10.4288 11.643C11.0033 11.454 11.454 11.0033 11.643 10.4288L12.059 9.16369C12.1308 8.94544 12.4395 8.94544 12.5113 9.16369L12.9274 10.4288C13.1164 11.0033 13.567 11.454 14.1416 11.643L15.4067 12.059C15.6249 12.1308 15.6249 12.4395 15.4067 12.5113L14.1416 12.9274C13.567 13.1164 13.1164 13.567 12.9274 14.1416L12.5113 15.4067Z"
      fill="currentColor"
    />
    <path
      d="M9.02246 0.546878C9.9822 0.546878 10.7564 0.545403 11.374 0.612307C12.0042 0.680586 12.5515 0.826244 13.0273 1.17188C13.3052 1.37376 13.5501 1.61868 13.752 1.89649C14.0975 2.37225 14.2432 2.91984 14.3115 3.54981C14.3784 4.16727 14.377 4.94206 14.377 5.90137V8.51367C13.9611 8.29533 13.5071 8.13985 13.0273 8.06055V5.90137C13.0273 4.9121 13.0259 4.22322 12.9688 3.69532C12.9129 3.18044 12.8098 2.89782 12.6592 2.69043C12.5406 2.52724 12.3966 2.38326 12.2334 2.26465C12.026 2.11404 11.7437 2.0109 11.2285 1.95508C10.7005 1.89789 10.0122 1.89649 9.02246 1.89649H6.55371C5.56395 1.89649 4.87569 1.89787 4.34766 1.95508C3.83242 2.01092 3.55022 2.11398 3.34278 2.26465C3.17953 2.38329 3.03564 2.52719 2.91699 2.69043C2.76642 2.89782 2.66325 3.18042 2.60742 3.69532C2.55027 4.22322 2.54883 4.9121 2.54883 5.90137V10.0986C2.54883 11.0878 2.55031 11.7768 2.60742 12.3047C2.66326 12.8196 2.76642 13.1032 2.91699 13.3105C3.03558 13.4736 3.17966 13.6178 3.34278 13.7363C3.5502 13.8869 3.83265 13.9901 4.34766 14.0459C4.87568 14.1031 5.56398 14.1035 6.55371 14.1035H8.08399C8.27443 14.6025 8.55077 15.0585 8.89551 15.4541H6.55371C5.59402 15.4541 4.81976 15.4546 4.20215 15.3877C3.57204 15.3194 3.02468 15.1738 2.54883 14.8281C2.27111 14.6263 2.02606 14.3813 1.82422 14.1035C1.47883 13.6278 1.33293 13.08 1.26465 12.4502C1.19783 11.8327 1.19922 11.0579 1.19922 10.0986V5.90137C1.19922 4.94206 1.1978 4.16727 1.26465 3.54981C1.33295 2.91984 1.47867 2.37225 1.82422 1.89649C2.02613 1.61864 2.27098 1.37379 2.54883 1.17188C3.02472 0.826181 3.57197 0.6806 4.20215 0.612307C4.81976 0.545393 5.594 0.546877 6.55371 0.546878H9.02246ZM9.19629 9.14649H4.5459V7.84571H9.19629V9.14649ZM11.0303 6.10645H4.5459V4.80567H11.0303V6.10645Z"
      fill="currentColor"
    />
  </svg>
)
