import ExpoModulesCore
import SwiftUI
#if canImport(AlarmKit)
import AlarmKit
#endif

/// A rest's end rung as an alarm (#39): AlarmKit, iOS 26 and later. It sounds through the silent
/// switch and Focus, with the system's alarm sound, and with the app in front too. Until then iOS
/// counts the rest down on the Lock Screen and in the Dynamic Island, drawn by the widget in
/// `targets/rest-countdown`. One alarm at a time, under one id: scheduling replaces the one before.
/// What to set, and when, is decided in `src/lib/rest-alert.ts`; this only asks iOS.
public class RestAlarmModule: Module {
  public func definition() -> ModuleDefinition {
    Name("RestAlarm")

    /// Whether this iPhone has AlarmKit: offered in Settings only where it does.
    Function("isAvailable") { () -> Bool in
      #if canImport(AlarmKit)
      if #available(iOS 26.0, *) { return true }
      #endif
      return false
    }

    /// iOS asks once; after that it answers what the person said.
    AsyncFunction("requestAuthorization") { () async throws -> Bool in
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

    AsyncFunction("schedule") { (seconds: Double, title: String) async throws in
      #if canImport(AlarmKit)
      if #available(iOS 26.0, *) { try await RestAlarm.schedule(in: seconds, title: title) }
      #endif
    }

    AsyncFunction("cancel") { () in
      #if canImport(AlarmKit)
      if #available(iOS 26.0, *) { RestAlarm.cancel() }
      #endif
    }
  }
}

#if canImport(AlarmKit)
/// Nothing rides with the alarm: a tap on it opens the app, which knows its session. The widget
/// (`targets/rest-countdown`) declares the same, by name: ActivityKit matches them so.
@available(iOS 26.0, *)
struct RestMetadata: AlarmMetadata {}

@available(iOS 26.0, *)
enum RestAlarm {
  /// The one rest alarm, the same on every launch.
  static let id = UUID(uuidString: "5E0A7C1B-9D24-4F3A-8B61-2C7E4D9F0A35")!

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
      configuration: .timer(duration: max(1, seconds), attributes: attributes)
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
