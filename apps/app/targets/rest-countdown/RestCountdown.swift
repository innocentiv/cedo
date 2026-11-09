import ActivityKit
import AlarmKit
import SwiftUI
import WidgetKit

/// A rest counting down on the Lock Screen and in the Dynamic Island, and "Rest over" at its end
/// (#39). iOS draws these from what the app sets (`modules/rest-alert`): a Live Activity beside a
/// notification, or an alarm. This only says how they look; the app is not running while they count.

/// The app's own, by name and shape: ActivityKit finds a view for an activity by its attributes'
/// type name. A notification's countdown.
struct RestActivityAttributes: ActivityAttributes {
  struct ContentState: Codable, Hashable {
    var endsAt: Date
    var next: String
  }

  var sessionId: String
}

/// The app's own, by name: an alarm's countdown, `AlarmAttributes<RestMetadata>`. Nothing rides with it.
struct RestMetadata: AlarmMetadata {}

@main
struct RestCountdownBundle: WidgetBundle {
  var body: some Widget {
    NotificationCountdown()
    AlarmCountdown()
  }
}

/// The yellow plate, `plate.yellow` in src/ui/tokens.ts.
let plateYellow = Color(red: 242 / 255, green: 185 / 255, blue: 15 / 255)

/// A notification's rest: counting down, then "Rest over" from its end — when iOS draws it stale.
struct NotificationCountdown: Widget {
  var body: some WidgetConfiguration {
    ActivityConfiguration(for: RestActivityAttributes.self) { context in
      HStack(alignment: .center, spacing: 12) {
        Mark().frame(width: 40, height: 40)
        VStack(alignment: .leading, spacing: 2) {
          Text(context.isStale ? "Rest over" : "Rest").font(.headline)
          Text(context.state.next).font(.caption).foregroundStyle(.secondary).lineLimit(2)
        }
        Left(endsAt: context.state.endsAt, over: context.isStale)
          .font(.system(size: 40, weight: .semibold).monospacedDigit())
          .foregroundStyle(plateYellow)
          // A timer's text takes all the width it is offered: it is pushed right within it.
          .multilineTextAlignment(.trailing)
          .frame(maxWidth: .infinity, alignment: .trailing)
      }
      .padding()
      .widgetURL(sessionURL(context.attributes.sessionId))
    } dynamicIsland: { context in
      DynamicIsland {
        DynamicIslandExpandedRegion(.leading) {
          HStack(spacing: 8) {
            Mark().frame(width: 28, height: 28)
            Text(context.isStale ? "Rest over" : "Rest").font(.headline)
          }
          .padding(.leading, 4)
        }
        DynamicIslandExpandedRegion(.trailing) {
          Left(endsAt: context.state.endsAt, over: context.isStale)
            .font(.title.monospacedDigit())
            .foregroundStyle(plateYellow)
            .multilineTextAlignment(.trailing)
            .padding(.trailing, 4)
        }
        DynamicIslandExpandedRegion(.bottom) {
          Text(context.state.next).font(.caption).foregroundStyle(.secondary).lineLimit(1)
        }
      } compactLeading: {
        Mark().frame(width: 20, height: 20)
      } compactTrailing: {
        Left(endsAt: context.state.endsAt, over: context.isStale)
          .monospacedDigit()
          .foregroundStyle(plateYellow)
          .multilineTextAlignment(.trailing)
          .frame(maxWidth: 52)
      } minimal: {
        Mark().frame(width: 20, height: 20)
      }
      .widgetURL(sessionURL(context.attributes.sessionId))
      .keylineTint(plateYellow)
    }
  }
}

/// An alarm's rest, counted by iOS: "Rest" while it counts, "Rest over" once it rings.
struct AlarmCountdown: Widget {
  var body: some WidgetConfiguration {
    ActivityConfiguration(for: AlarmAttributes<RestMetadata>.self) { context in
      HStack(alignment: .center, spacing: 12) {
        Mark().frame(width: 40, height: 40)
        VStack(alignment: .leading, spacing: 2) {
          Text(said(context.state)).font(.headline)
          Text("cedo").font(.caption).foregroundStyle(.secondary)
        }
        AlarmLeft(state: context.state)
          .font(.system(size: 40, weight: .semibold).monospacedDigit())
          .foregroundStyle(context.attributes.tintColor)
          .multilineTextAlignment(.trailing)
          .frame(maxWidth: .infinity, alignment: .trailing)
      }
      .padding()
    } dynamicIsland: { context in
      DynamicIsland {
        DynamicIslandExpandedRegion(.leading) {
          HStack(spacing: 8) {
            Mark().frame(width: 28, height: 28)
            Text(said(context.state)).font(.headline)
          }
          .padding(.leading, 4)
        }
        DynamicIslandExpandedRegion(.trailing) {
          AlarmLeft(state: context.state)
            .font(.title.monospacedDigit())
            .foregroundStyle(context.attributes.tintColor)
            .multilineTextAlignment(.trailing)
            .padding(.trailing, 4)
        }
      } compactLeading: {
        Mark().frame(width: 20, height: 20)
      } compactTrailing: {
        AlarmLeft(state: context.state)
          .monospacedDigit()
          .foregroundStyle(context.attributes.tintColor)
          .multilineTextAlignment(.trailing)
          .frame(maxWidth: 52)
      } minimal: {
        Mark().frame(width: 20, height: 20)
      }
      .keylineTint(context.attributes.tintColor)
    }
  }
}

/// The session a tap opens, by the app's own scheme — expo-router's address for it.
func sessionURL(_ sessionId: String) -> URL? {
  URL(string: "cedo://today/session/\(sessionId)")
}

/// What is left of a notification's rest, counted by iOS itself; "Go" once it is over.
struct Left: View {
  let endsAt: Date
  let over: Bool

  var body: some View {
    if over {
      Text("Go")
    } else {
      // A range ending before it starts would stop the widget drawing at all.
      Text(timerInterval: Date.now...max(Date.now, endsAt), countsDown: true)
    }
  }
}

/// "Rest" while it counts, "Rest over" once it rings.
func said(_ state: AlarmPresentationState) -> String {
  if case .alert = state.mode { return "Rest over" }
  return "Rest"
}

/// What is left of an alarm's rest: counting down, held, or over.
struct AlarmLeft: View {
  let state: AlarmPresentationState

  var body: some View {
    switch state.mode {
    case .countdown(let countdown):
      Text(timerInterval: Date.now...max(Date.now, countdown.fireDate), countsDown: true)
    case .paused(let paused):
      Text(
        Duration.seconds(paused.totalCountdownDuration - paused.previouslyElapsedDuration)
          .formatted(.time(pattern: .minuteSecond))
      )
    case .alert:
      Text("Go")
    @unknown default:
      EmptyView()
    }
  }
}

/// cedo's mark (#61), as `src/ui/brand.tsx` draws it on its 512 grid: a yellow plate face on, a
/// wedge of shadow across its right side opening it into the c, the raised rim's line, and the steel
/// insert at the hub. Colours copied from `brand` in src/ui/tokens.ts.
struct Mark: View {
  /// `brand.shadow`: the plate's yellow, a quarter of the light gone.
  private let shadow = Color(red: 168 / 255, green: 127 / 255, blue: 10 / 255)
  /// `plate.white`: the steel insert.
  private let insert = Color(red: 236 / 255, green: 232 / 255, blue: 225 / 255)
  /// `color.bg`: the floor, through the hub and the rim's line.
  private let floor = Color(red: 27 / 255, green: 28 / 255, blue: 30 / 255)

  var body: some View {
    GeometryReader { space in
      let side = min(space.size.width, space.size.height)
      let unit = side / 512
      let centre = CGPoint(x: side / 2, y: side / 2)
      ZStack {
        Circle().fill(plateYellow).frame(width: 360 * unit, height: 360 * unit)
        Path { wedge in
          wedge.move(to: centre)
          wedge.addArc(
            center: centre,
            radius: 180 * unit,
            startAngle: .degrees(-40),
            endAngle: .degrees(40),
            clockwise: false
          )
          wedge.closeSubpath()
        }
        .fill(shadow)
        Circle()
          .stroke(floor.opacity(0.22), lineWidth: 8 * unit)
          .frame(width: 276 * unit, height: 276 * unit)
        Circle().fill(insert).frame(width: 100 * unit, height: 100 * unit)
        Circle().fill(floor).frame(width: 60 * unit, height: 60 * unit)
      }
      .frame(width: side, height: side)
    }
    .aspectRatio(1, contentMode: .fit)
  }
}
