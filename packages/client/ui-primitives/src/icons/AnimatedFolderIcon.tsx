import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import type { IconProps } from './props.ts'
import type { LottiePlayerHandle } from './LottiePlayer.tsx'
import folderAnimation from './assets/folder.json'
import css from './AnimatedFolderIcon.module.css'

const Lottie = lazy(() => import('./LottiePlayer.tsx'))

export interface DeepCreatorIconAnimatedFolder16Props extends IconProps {
  /** Open state. State changes animate between the supplied frames 0 and 7. */
  expanded?: boolean | undefined
  /** Correct the source composition's large padding; disable for intentionally compact actions. */
  opticalScale?: boolean | undefined
}

/** Product folder asset migrated from DeepSeeker CodeAgent's Lottie source. */
export function DeepCreatorIconAnimatedFolder16({ expanded = false, opticalScale = true, size = 16, className }: DeepCreatorIconAnimatedFolder16Props) {
  const animationRef = useRef<LottiePlayerHandle>(null)
  const initialized = useRef(false)
  const [ready, setReady] = useState(false)
  const markReady = useCallback(() => { setReady(true) }, [])

  useEffect(() => {
    if (!ready) return
    const animation = animationRef.current
    if (animation === null) return
    const targetFrame = expanded ? 7 : 0
    const reduceMotion = typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (!initialized.current || reduceMotion) {
      animation.goToAndStop(targetFrame, true)
      initialized.current = true
      return
    }
    animation.setDirection(expanded ? 1 : -1)
    animation.goToAndPlay(expanded ? 0 : 7, true)
  }, [expanded, ready])

  return (
    <span
      className={clsx(css.root, opticalScale && css.opticalScale, className)}
      style={{ width: size, height: size }}
      aria-hidden="true"
      data-deepcreator-icon="animated-folder"
      data-expanded={expanded || undefined}
      data-optical-scale={String(opticalScale)}
    >
      <Suspense fallback={null}>
        <Lottie
          animationData={folderAnimation}
          autoplay={false}
          loop={false}
          lottieRef={animationRef}
          onDOMLoaded={markReady}
          style={{ width: '100%', height: '100%' }}
        />
      </Suspense>
    </span>
  )
}
