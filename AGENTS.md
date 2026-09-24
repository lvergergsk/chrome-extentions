# Chrome Extensions

- Every extension update must increment the version in both `utils/manifest.json`
  and `package.json`, including small UI fixes. Keep the versions identical.
- After merging and reloading Utils, verify the running version with
  `gg browser status`; a reload request alone does not prove the update loaded.
- The popup exposes tab sorting only. Tab movement stays keyboard-only, with no
  shortcut hints or movement buttons.
- Diagnose shortcut failures from actual Chrome assignments. Manifest
  `suggested_key` values do not prove Chrome assigned the shortcuts; another
  extension can own them, and reload does not transfer ownership.
