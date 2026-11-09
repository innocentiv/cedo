import ActivityKit
import ExpoModulesCore
import SwiftUI
#if canImport(AlarmKit)
import AlarmKit
#endif

/// A rest's end told with the app closed (#39), as iOS does it: the app's own native module.
///
/// - Beside a notification, the rest counts down on the Lock Screen and in the Dynamic Island: a
///   Live Activity the app starts as the set is logged, and which turns itself to "Rest over" at the
///   rest's end — its stale date — with no push to tell it.
/// - An alarm rings through the silent switch and Focus, with cedo's chime, until it is stopped
///   (AlarmKit, iOS 26 and later); iOS counts it down itself.
///
/// The widget that draws both is `targets/rest-countdown`. What to set, and when, is decided in
/// `src/lib/rest-alert.ts`; this only asks iOS.
public class RestAlertModule: Module {
  public func definition() -> ModuleDefinition {
    Name("RestAlert")

    /// Starts the countdown, or moves the one showing. False when Live Activities are off for cedo.
    AsyncFunction("showCountdown") { (seconds: Double, next: String, sessionId: String) async -> Bool in
      await Countdown.show(
        endsAt: Date().addingTimeInterval(max(1, seconds)),
        next: next,
        sessionId: sessionId
      )
    }

    /// The rest skipped, undone, finished — or told another way: gone at once.
    AsyncFunction("endCountdown") { () async in
      await Countdown.end(onlyOver: false)
    }

    /// The app back in front: a countdown whose rest is over has said so, and goes.
    AsyncFunction("endCountdownIfOver") { () async in
      await Countdown.end(onlyOver: true)
    }

    /// Whether this iPhone has AlarmKit: the alarm is offered in Settings only where it does.
    Function("ringsAlarms") { () -> Bool in
      #if canImport(AlarmKit)
      if #available(iOS 26.0, *) { return true }
      #endif
      return false
    }

    /// iOS asks once; after that it answers what the person said.
    AsyncFunction("allowAlarms") { () async throws -> Bool in
      #if canImport(AlarmKit)
      if #available(iOS 26.0, *) {
        let manager = AlarmManager.shared
        switch manager.authorizationState {
        case .authorized: return true
        case .denied: return false
        case .notDetermined: return try await manager.requestAuthorization() == .authorized
        @unknown default: return false
        }
      }
      #endif
      return false
    }

    AsyncFunction("scheduleAlarm") { (seconds: Double, title: String) async throws in
      #if canImport(AlarmKit)
      if #available(iOS 26.0, *) { try await RestAlarm.schedule(in: seconds, title: title) }
      #endif
    }

    AsyncFunction("cancelAlarm") { () in
      #if canImport(AlarmKit)
      if #available(iOS 26.0, *) { RestAlarm.cancel() }
      #endif
    }
  }
}

/// The countdown's attributes. The widget declares the same, by name and shape: ActivityKit finds
/// its view by the type's name.
struct RestActivityAttributes: ActivityAttributes {
  struct ContentState: Codable, Hashable {
    var endsAt: Date
    /// The next set, as the logger will ask it.
    var next: String
  }

  /// The session a tap on it opens.
  var sessionId: String
}

/// One countdown at a time: the rest now running, moved rather than started again.
enum Countdown {
  static func show(endsAt: Date, next: String, sessionId: String) async -> Bool {
    let content = ActivityContent(
      state: RestActivityAttributes.ContentState(endsAt: endsAt, next: next),
      // At the rest's end iOS draws it again as stale, which the widget shows as "Rest over".
      staleDate: endsAt
    )
    let showing = Activity<RestActivityAttributes>.activities
    if let current = showing.first(where: { $0.attributes.sessionId == sessionId }) {
      await current.update(content)
      for other in showing where other.id != current.id {
        await other.end(nil, dismissalPolicy: .immediate)
      }
      return true
    }
    for other in showing { await other.end(nil, dismissalPolicy: .immediate) }
    guard ActivityAuthorizationInfo().areActivitiesEnabled else { return false }
    do {
      _ = try Activity.request(
        attributes: RestActivityAttributes(sessionId: sessionId),
        content: content
      )
      return true
    } catch {
      return false
    }
  }

  static func end(onlyOver: Bool) async {
    for activity in Activity<RestActivityAttributes>.activities
    where !onlyOver || activity.content.state.endsAt <= Date() {
      await activity.end(nil, dismissalPolicy: .immediate)
    }
  }
}

#if canImport(AlarmKit)
/// Nothing rides with the alarm: a tap on it opens the app, which knows its session. The widget
/// declares the same, by name: ActivityKit matches them so.
@available(iOS 26.0, *)
struct RestMetadata: AlarmMetadata {}

@available(iOS 26.0, *)
enum RestAlarm {
  /// The one rest alarm, the same on every launch.
  static let id = UUID(uuidString: "5E0A7C1B-9D24-4F3A-8B61-2C7E4D9F0A35")!

  /// cedo's chime with a breath after it (`scripts/chime-wav.ts`), as an alarm repeats it until stopped.
  static let sound = "rest-alarm.wav"

  static func schedule(in seconds: Double, title: String) async throws {
    cancel()
    let attributes = AlarmAttributes<RestMetadata>(
      presentation: AlarmPresentation(
        alert: alert(title),
        countdown: AlarmPresentation.Countdown(title: "Rest")
      ),
      // The yellow plate, `plate.yellow` in src/ui/tokens.ts.
      tintColor: Color(red: 242 / 255, green: 185 / 255, blue: 15 / 255)
    )
    _ = try await AlarmManager.shared.schedule(
      id: id,
      // A timer, not an alarm at a date: iOS counts it down where the app cannot.
      configuration: .timer(
        duration: max(1, seconds),
        attributes: attributes,
        sound: .named(sound)
      )
    )
  }

  /// iOS 26.0 asks for a stop button; 26.1 draws its own.
  static func alert(_ title: String) -> AlarmPresentation.Alert {
    let said = LocalizedStringResource(String.LocalizationValue(title))
    if #available(iOS 26.1, *) { return AlarmPresentation.Alert(title: said) }
    return AlarmPresentation.Alert(
      title: said,
      stopButton: AlarmButton(text: "Stop", textColor: .white, systemImageName: "stop.circle")
    )
  }

  /// Scheduled, or ringing: either way, gone.
  static func cancel() {
    try? AlarmManager.shared.cancel(id: id)
  }
}
#endif
