import { useWindowDimensions } from 'react-native'
import { TABLET_MIN_WIDTH } from './tokens.ts'

type Layout = 'phone' | 'tablet'

/**
 * The only layout branch in the app. A screen asks for this and picks between one column and two;
 * it never reads a raw width. See docs/08-frontend.md.
 */
export function useLayout(): Layout {
  const { width } = useWindowDimensions()
  return width >= TABLET_MIN_WIDTH ? 'tablet' : 'phone'
}
