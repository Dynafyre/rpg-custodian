# SillyTavern UI Extension Development Guide (2025)

## Overview
UI extensions expand SillyTavern's functionality by hooking into its events and API. They run in a browser context and have practically unrestricted access to the DOM, JavaScript APIs, and the SillyTavern context.

## Key Components of UI Extensions

### Manifest Requirements
A `manifest.json` file is essential, with required fields:
- `display_name`: Extension name
- `js`: Main JavaScript file
- `author`: Extension creator

Optional fields include:
- `loading_order`
- `css`
- `dependencies`
- `i18n` for internationalization

### Extension Capabilities
UI extensions can:
- Modify the DOM
- Access SillyTavern's JavaScript context
- Call internal APIs
- Interact with chat data

## Key API Access Methods

### Context Access
```javascript
const context = SillyTavern.getContext();
// Provides access to:
// - chat logs
// - characters
// - groups
// - utility functions
```

### Persistent Settings
```javascript
const { extensionSettings, saveSettingsDebounced } = SillyTavern.getContext();
// Store and retrieve JSON-serializable extension data
```

## Event System
Extensions can listen to and emit events:
```javascript
eventSource.on(event_types.MESSAGE_RECEIVED, handleIncomingMessage);
```

Key events include:
- `APP_READY`
- `MESSAGE_RECEIVED`
- `CHAT_CHANGED`
- `GENERATION_ENDED`

## Text Generation Methods
- `generateQuietPrompt()`: Generate text in chat context
- `generateRaw()`: Generate text without context
- Support for structured JSON outputs

## Internationalization
Extensions can provide translations via:
- Direct `addLocaleData` call
- Manifest's `i18n` configuration

## Slash Commands
New commands should use `SlashCommandParser.addCommandObject()` for enhanced functionality.

## Best Practices
- Use unique identifiers for settings
- Handle optional dependencies gracefully
- Provide clear documentation
- Follow open-source licensing
- Extensions must be compatible with the latest release version of SillyTavern
- Extensions must be well-documented with README, installation instructions, usage examples

## Development Environment (2025)
- Extensions can utilize bundling to isolate themselves from the rest of the modules
- Can use any dependencies from NPM, including UI frameworks like Vue, React, etc.
- SillyTavern uses Webpack for bundling frontend dependencies
- Extension Management includes branch selection in installation dialog
- Browse available extensions directly from Extensions => Download Extensions & Assets menu

## Note on Extras
The Extras project was discontinued in April 2024. You do not need to install Extras to use extensions.

## Templates & Examples
- [Basic Extension Template](https://github.com/city-unit/st-extension-example)
- [Advanced Template with Webpack](https://github.com/SillyTavern/Extension-WebpackTemplate)
- [Official Extensions List](https://github.com/search?q=topic:extension+org:SillyTavern&type=Repositories)

## Source
Current documentation available at: https://docs.sillytavern.app/for-contributors/writing-extensions/