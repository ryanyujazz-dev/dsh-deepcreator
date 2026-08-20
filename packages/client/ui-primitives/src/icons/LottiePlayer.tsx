import { useEffect, useRef } from 'react'
import lottie from 'lottie-web/build/player/lottie_light'
import type { AnimationItem, AnimationConfigWithData } from 'lottie-web'

export type LottiePlayerHandle = Pick<AnimationItem, 'goToAndPlay' | 'goToAndStop' | 'setDirection'>

/** Narrow SVG-only player kept behind the animated icon's lazy boundary. */
export default function LottiePlayer({ animationData, autoplay, loop, lottieRef, onDOMLoaded, style }: {
  animationData: AnimationConfigWithData['animationData']
  autoplay: boolean
  loop: boolean
  lottieRef: { current: LottiePlayerHandle | null }
  onDOMLoaded(): void
  style?: React.CSSProperties | undefined
}) {
  const container = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (container.current === null) return
    const animation = lottie.loadAnimation({
      container: container.current,
      renderer: 'svg',
      animationData,
      autoplay,
      loop,
    })
    lottieRef.current = animation
    animation.addEventListener('DOMLoaded', onDOMLoaded)
    return () => {
      animation.removeEventListener('DOMLoaded', onDOMLoaded)
      lottieRef.current = null
      animation.destroy()
    }
  }, [animationData, autoplay, loop, lottieRef, onDOMLoaded])

  return <div ref={container} style={style} />
}
