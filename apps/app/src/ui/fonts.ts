import { useFonts } from 'expo-font'
import { Barlow_400Regular } from '@expo-google-fonts/barlow/400Regular'
import { Barlow_500Medium } from '@expo-google-fonts/barlow/500Medium'
import { Barlow_600SemiBold } from '@expo-google-fonts/barlow/600SemiBold'
import { BarlowCondensed_600SemiBold } from '@expo-google-fonts/barlow-condensed/600SemiBold'
import { BarlowCondensed_700Bold } from '@expo-google-fonts/barlow-condensed/700Bold'

/**
 * The faces `font` in tokens.ts names, bundled with the app: they load from it, offline too, and a
 * self-hosted instance asks no third party for them. Only the weights the type scale uses. Whether
 * they are ready — or failed, after which the system face stands in. Never a reason to render
 * nothing: see `app/_layout.tsx`.
 */
export function useAppFonts(): boolean {
  const [loaded, failed] = useFonts({
    Barlow_400Regular,
    Barlow_500Medium,
    Barlow_600SemiBold,
    BarlowCondensed_600SemiBold,
    BarlowCondensed_700Bold,
  })
  return loaded || failed !== null
}
