/**
 * The app's entry. What Hermes, the native app's engine, lacks is given first — imports are
 * evaluated in order, so no module of the app or the contract runs before it — and then Expo
 * Router's own entry, which loads every route. See `src/lib/hermes-builtins.ts` (#77).
 *
 * Both are imported for what evaluating them does, and in this order: that is an entry's job.
 */
// oxlint-disable-next-line import/no-unassigned-import
import './src/lib/hermes-builtins.ts'
// oxlint-disable-next-line import/no-unassigned-import
import 'expo-router/entry'
