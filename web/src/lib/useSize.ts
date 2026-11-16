import { useCallback, useRef, useState } from 'react'
/** Observe an element's content box. Charts are sized from their container, never hard-coded.
    A callback ref, so it also works for elements that mount after the component does. */
export function useSize<T extends HTMLElement>() {
  const [size, set] = useState({ w: 0, h: 0 })
  const ro = useRef<ResizeObserver | null>(null)
  const ref = useCallback((el: T | null) => {
    ro.current?.disconnect()
    if (!el) return
    ro.current = new ResizeObserver(([e]) => set({ w: Math.floor(e.contentRect.width), h: Math.floor(e.contentRect.height) }))
    ro.current.observe(el)
  }, [])
  return [ref, size] as const
}
