import { useLocalSearchParams, useRouter } from 'expo-router'
import { Card, Empty, ListRow, Loaded, Screen, Text, useLayout } from '../../../src/ui/index.ts'
import { useAthletes } from '../../../src/api/athlete-queries.ts'
import { AthleteView } from '../../../src/lib/athlete.tsx'

/**
 * The athletes a coach reads (#30): everyone sharing their training with a group the caller runs.
 * On a desktop the one chosen opens beside the list, in the address (`?open=`) as an exercise does
 * in the library (#29); on a phone it is a screen of its own. See docs/08-frontend.md, "The coach's
 * view".
 */
export default function Athletes(): React.JSX.Element {
  const router = useRouter()
  const desk = useLayout() === 'tablet'
  const open = useLocalSearchParams<{ open?: string }>().open ?? null
  const athletes = useAthletes()

  const list = (
    <Loaded query={athletes} testID="athletes">
      {(data) =>
        data.length === 0 ? (
          <Empty
            title="Nobody shares their training with you"
            detail="An athlete shares theirs from a group you run, in its settings."
            testID="athletes-empty"
          />
        ) : (
          data.map((athlete) => (
            <ListRow
              key={athlete.user.id}
              title={athlete.user.displayName}
              subtitle={`@${athlete.user.username}`}
              selected={desk && open === athlete.user.id}
              onPress={() => {
                if (desk) router.setParams({ open: athlete.user.id })
                else router.push(`/athletes/${athlete.user.id}`)
              }}
              testID={`athlete-row-${athlete.user.id}`}
            />
          ))
        )
      }
    </Loaded>
  )

  return (
    <Screen
      title="Athletes"
      wide
      testID="athletes-screen"
      // Beside the list, each its own scroll (#50): their whole training is long.
      columns={
        desk
          ? {
              narrow: 'main',
              main: list,
              side: (
                <Card testID="athlete-pane-card">
                  {open === null ? (
                    <Text tone="muted">Choose an athlete to read their training here.</Text>
                  ) : (
                    <AthleteView key={open} id={open} pane />
                  )}
                </Card>
              ),
              chosen: open,
            }
          : undefined
      }
    >
      {desk ? null : list}
    </Screen>
  )
}
