import { useRouter } from 'expo-router'

/**
 * Go back, or go somewhere sensible when there is nowhere to go back to.
 *
 * `router.back()` on an empty history warns "The action 'GO_BACK' was not handled by any navigator"
 * and then does nothing, leaving the user stranded on the screen they just finished with. That
 * happens more than it sounds: opening a session link directly, reloading the page mid-workout, or
 * arriving from a redirect — the web build has no native stack underneath it.
 *
 * `fallback` is where the flow belongs when its history is empty, not a generic home route.
 */
export function useGoBack(fallback: string): () => void {
  const router = useRouter()
  return () => {
    if (router.canGoBack()) {
      router.back()
      return
    }
    router.replace(fallback)
  }
}
