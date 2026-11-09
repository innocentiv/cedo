Pod::Spec.new do |s|
  s.name           = 'RestAlert'
  s.version        = '1.0.0'
  s.summary        = "A rest's end told with the app closed: its countdown, and an alarm (#39)"
  s.description    = "A rest's end told with the app closed: its countdown, and an alarm (#39)"
  s.license        = 'AGPL-3.0-or-later'
  s.author         = 'cedo'
  s.homepage       = 'https://github.com/innocentiv/cedo'
  s.platforms      = { :ios => '16.4' }
  s.swift_version  = '5.9'
  s.source         = { git: 'https://github.com/innocentiv/cedo.git' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  # AlarmKit is iOS 26's: linked weakly, so the app still opens on an older iOS, which never calls it.
  s.weak_frameworks = 'AlarmKit'

  s.source_files = "**/*.{h,m,swift}"
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }
end
