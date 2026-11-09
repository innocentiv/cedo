import ActivityKit
import SwiftUI
import WidgetKit
#if canImport(AlarmKit)
import AlarmKit
#endif

/// A rest counting down on the Lock Screen and in the Dynamic Island, and "Rest over" at its end
/// (#39). iOS draws these from what the app sets (`modules/rest-alert`): a Live Activity beside a
/// notification, on any iOS with Live Activities, or an alarm, from iOS 26. This only says how they
/// look; the app is not running while they count.

/// The app's own, by name and shape: ActivityKit finds a view for an activity by its attributes'
/// type name. A notification's countdown.
struct RestActivityAttributes: ActivityAttributes {
  struct ContentState: Codable, Hashable {
    var endsAt: Date
    var next: String
  }

  var sessionId: String
}

@main
struct RestCountdownBundle: WidgetBundle {
  var body: some Widget {
    NotificationCountdown()
    #if canImport(AlarmKit)
    if #available(iOS 26.0, *) { AlarmCountdown() }
    #endif
  }
}

/// `brand.plate` in src/ui/tokens.ts: the yellow plate.
let plateYellow = Color(red: 242 / 255, green: 185 / 255, blue: 15 / 255)

/// What is left of a rest: counting down to its end, held, or over.
enum Left {
  case counting(to: Date)
  case held(seconds: TimeInterval)
  case over
}

/// A rest as both countdowns show it: what it is, a line under it, what is left, and its colour.
struct RestShown {
  let left: Left
  let under: String
  let tint: Color

  /// "Rest" while it counts, "Rest over" once it is over.
  var title: String {
    if case .over = left { return "Rest over" }
    return "Rest"
  }
}

/// A notification's rest: counting down, then "Rest over" from its end — when iOS draws it stale.
struct NotificationCountdown: Widget {
  var body: some WidgetConfiguration {
    ActivityConfiguration(for: RestActivityAttributes.self) { context in
      LockScreenRest(rest: shown(context))
        .widgetURL(sessionURL(context.attributes.sessionId))
    } dynamicIsland: { context in
      islandRest(shown(context)).widgetURL(sessionURL(context.attributes.sessionId))
    }
  }

  private func shown(_ context: ActivityViewContext<RestActivityAttributes>) -> RestShown {
    RestShown(
      left: context.isStale ? .over : .counting(to: context.state.endsAt),
      under: context.state.next,
      tint: plateYellow
    )
  }
}

#if canImport(AlarmKit)
/// The app's own, by name: an alarm's countdown, `AlarmAttributes<RestMetadata>`. Nothing rides with it.
@available(iOS 26.0, *)
struct RestMetadata: AlarmMetadata {}

/// An alarm's rest, counted by iOS: "Rest" while it counts, "Rest over" once it rings.
@available(iOS 26.0, *)
struct AlarmCountdown: Widget {
  var body: some WidgetConfiguration {
    ActivityConfiguration(for: AlarmAttributes<RestMetadata>.self) { context in
      LockScreenRest(rest: shown(context))
    } dynamicIsland: { context in
      islandRest(shown(context))
    }
  }

  private func shown(_ context: ActivityViewContext<AlarmAttributes<RestMetadata>>) -> RestShown {
    let left: Left =
      switch context.state.mode {
      case .countdown(let countdown): .counting(to: countdown.fireDate)
      case .paused(let paused):
        .held(seconds: paused.totalCountdownDuration - paused.previouslyElapsedDuration)
      default: .over
      }
    return RestShown(left: left, under: "cedo", tint: context.attributes.tintColor)
  }
}
#endif

/// The session a tap opens, by the app's own scheme — expo-router's address for it.
func sessionURL(_ sessionId: String) -> URL? {
  URL(string: "cedo://today/session/\(sessionId)")
}

/// On the Lock Screen: the mark, what it is and the line under it, and what is left at the right.
struct LockScreenRest: View {
  let rest: RestShown

  var body: some View {
    HStack(alignment: .center, spacing: 12) {
      Mark().frame(width: 40, height: 40)
      VStack(alignment: .leading, spacing: 2) {
        Text(rest.title).font(.headline)
        Text(rest.under).font(.caption).foregroundStyle(.secondary).lineLimit(2)
      }
      TimeLeft(left: rest.left)
        .font(.system(size: 40, weight: .semibold).monospacedDigit())
        .foregroundStyle(rest.tint)
        // A timer's text takes all the width it is offered: it is pushed right within it.
        .multilineTextAlignment(.trailing)
        .frame(maxWidth: .infinity, alignment: .trailing)
    }
    .padding()
  }
}

/// In the Dynamic Island: the mark and what is left, compact; the line under it, expanded.
func islandRest(_ rest: RestShown) -> DynamicIsland {
  DynamicIsland {
    DynamicIslandExpandedRegion(.leading) {
      HStack(spacing: 8) {
        Mark().frame(width: 28, height: 28)
        Text(rest.title).font(.headline)
      }
      .padding(.leading, 4)
    }
    DynamicIslandExpandedRegion(.trailing) {
      TimeLeft(left: rest.left)
        .font(.title.monospacedDigit())
        .foregroundStyle(rest.tint)
        .multilineTextAlignment(.trailing)
        .padding(.trailing, 4)
    }
    DynamicIslandExpandedRegion(.bottom) {
      Text(rest.under).font(.caption).foregroundStyle(.secondary).lineLimit(1)
    }
  } compactLeading: {
    Mark().frame(width: 20, height: 20)
  } compactTrailing: {
    TimeLeft(left: rest.left)
      .monospacedDigit()
      .foregroundStyle(rest.tint)
      .multilineTextAlignment(.trailing)
      .frame(maxWidth: 52)
  } minimal: {
    Mark().frame(width: 20, height: 20)
  }
  .keylineTint(rest.tint)
}

/// What is left, counted by iOS itself — the app is not running to count it — and "Go" once over.
struct TimeLeft: View {
  let left: Left

  var body: some View {
    switch left {
    case .counting(let end):
      // A range ending before it starts would stop the widget drawing at all.
      Text(timerInterval: Date.now...max(Date.now, end), countsDown: true)
    case .held(let seconds):
      Text(Duration.seconds(seconds).formatted(.time(pattern: .minuteSecond)))
    case .over:
      Text("Go")
    }
  }
}

/// cedo's mark (#61), as `src/ui/brand.tsx` draws it on its 512 grid: the plate face on, a wedge of
/// shadow across its right side opening it into the c, the raised rim's line, and the steel insert
/// at the hub. Its colours are `brand`'s in src/ui/tokens.ts.
struct Mark: View {
  /// `brand.shadow`: the plate's yellow, a quarter of the light gone.
  private let shadow = Color(red: 168 / 255, green: 127 / 255, blue: 10 / 255)
  /// `brand.insert`: the steel insert.
  private let insert = Color(red: 236 / 255, green: 232 / 255, blue: 225 / 255)
  /// `brand.floor`: the floor, through the hub and the rim's line.
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
