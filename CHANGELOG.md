# Change Log

All notable changes to the "sequence" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [0.0.4]

- Highlight preview text.
- Refactor code base.

## [0.0.3]

- Fix a bug related to insertion preview
  - The preview produced a wrong result when delete some characters with zero-width selections.
- Change the `activationEvents` to `onStartupFinished` to prevent the command execution from begin blocked by slow activating extensions.

## [0.0.2]

- Properly handle workspace trust
  - Most commands work normally with or without trust.
  - The configuration `sequence-tool.customCommands` won't be load from the configuration of untrusted workspaces.
- Supports virtual workspaces and web.

## [0.0.1]

- Initial release
