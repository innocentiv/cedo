import ActivityKit
import AlarmKit
import SwiftUI
import WidgetKit

/// A rest counting down on the Lock Screen and in the Dynamic Island while its alarm is set, and
/// "Rest over" once it rings (#39). iOS draws it from the alarm the app sets (`modules/rest-alarm`);
/// this only says how it looks. The app does not run while it counts.

/// The app's own, by name and shape: ActivityKit finds this view for the alarm by its attributes'
/// type name, `AlarmAttributes<RestMetadata>`. Nothing rides with it.
struct RestMetadata: AlarmMetadata {}

@main
struct RestCountdownBundle: WidgetBundle {
  var body: some Widget { RestCountdown() }
}

struct RestCountdown: Widget {
  var body: some WidgetConfiguration {
    ActivityConfiguration(for: AlarmAttributes<RestMetadata>.self) { context in
      HStack(alignment: .center) {
        VStack(alignment: .leading, spacing: 2) {
          Text(said(context.state)).font(.headline)
          Text("cedo").font(.caption).foregroundStyle(.secondary)
        }
        Left(state: context.state)
          .font(.system(size: 44, weight: .semibold).monospacedDigit())
          .foregroundStyle(context.attributes.tintColor)
          // A timer's text takes all the width it is offered: it is pushed right within it.
          .multilineTextAlignment(.trailing)
          .frame(maxWidth: .infinity, alignment: .trailing)
      }
      .padding()
    } dynamicIsland: { context in
      DynamicIsland {
        DynamicIslandExpandedRegion(.leading) {
          Text(said(context.state)).font(.headline).padding(.leading, 4)
        }
        DynamicIslandExpandedRegion(.trailing) {
          Left(state: context.state)
            .font(.title.monospacedDigit())
            .foregroundStyle(context.attributes.tintColor)
            .multilineTextAlignment(.trailing)
            .padding(.trailing, 4)
        }
      } compactLeading: {
        Image(systemName: "timer").foregroundStyle(context.attributes.tintColor)
      } compactTrailing: {
        Left(state: context.state)
          .monospacedDigit()
          .foregroundStyle(context.attributes.tintColor)
          .multilineTextAlignment(.trailing)
          .frame(maxWidth: 52)
      } minimal: {
        Image(systemName: "timer").foregroundStyle(context.attributes.tintColor)
      }
      .keylineTint(context.attributes.tintColor)
    }
  }
}

/// "Rest" while it counts, "Rest over" once it rings.
func said(_ state: AlarmPresentationState) -> String {
  if case .alert = state.mode { return "Rest over" }
  return "Rest"
}

/// What is left of the rest, counted by iOS itself: the app is not running to count it.
struct Left: View {
  let state: AlarmPresentationState

  var body: some View {
    switch state.mode {
    case .countdown(let countdown):
      // A range ending before it starts would stop the widget drawing at all.
      Text(timerInterval: Date.now...max(Date.now, countdown.fireDate), countsDown: true)
    case .paused(let paused):
      Text(
        Duration.seconds(paused.totalCountdownDuration - paused.previouslyElapsedDuration)
          .formatted(.time(pattern: .minuteSecond))
      )
    case .alert:
      Text("0:00")
    @unknown default:
      EmptyView()
    }
  }
}
