import { useCallback, useState } from 'react'
import { useFocusEffect } from 'expo-router'

/**
 * Whether this screen is the one shown: false while another is pushed over it, or its tab is left.
 * A sheet a screen holds open asks it, so it does not stay over the screen pushed from inside it —
 * an exercise's editor, opened from the exercise's sheet — and is there again on coming back.
 */
export function useFocused(): boolean {
  const [focused, setFocused] = useState(true)
  useFocusEffect(
    useCallback(() => {
      setFocused(true)
      return () => {
        setFocused(false)
      }
    }, []),
  )
  return focused
}
