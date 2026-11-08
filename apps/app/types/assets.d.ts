/**
 * A sound bundled by Metro: importing one gives its asset id, which is what expo-audio's players
 * take. The rest-over chime on native is the one (`src/lib/chime.ts`).
 */
declare module '*.wav' {
  const asset: number
  export default asset
}
