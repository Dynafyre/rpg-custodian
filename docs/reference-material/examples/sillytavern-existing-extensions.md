# SillyTavern Existing Extensions Reference

## Built-in Extensions

### D&D Dice Extension
- **Functionality**: Provides classic D&D dice rolling capabilities
- **STscript Command**: `/roll (dice formula)` - adds hidden message with dice roll results
- **Integration**: Built into SillyTavern core, can be enabled/disabled in Extensions panel

## Third-Party Extension Architecture

### Installation Process
1. Extensions => Install Extension menu
2. Paste URL of extension repository
3. Optional: specify branch and installation target (all users vs current user)
4. Extensions mounted to `/scripts/extensions/third-party/` folder

### Security Considerations
- Third-party extensions can have unintended side effects
- May pose security risks - always trust the source
- SillyTavern not responsible for damage from third-party extensions

## Extension Development Requirements

### Licensing & Compatibility
- **Must be open-source** with libre license (AGPLv3 recommended)
- **Must be compatible** with latest SillyTavern release
- **Must be ready to update** when core changes
- **Well-documented** with README, installation instructions, usage examples

### Technical Structure
- **Manifest required** with display_name, js, css, author, version
- **Event/API hooks** for SillyTavern integration
- **STscript integration** for chat commands
- **Relative imports** based on third-party folder mounting

## Existing Extension Examples

From our codebase analysis, we identified these third-party extensions:

### Extension-Dice
- Basic dice rolling functionality
- Files: `index.js`, `manifest.json`, `style.css`, HTML templates
- Button and dropdown interfaces

### Extension-Randomizer  
- Randomization features for chat interactions
- Standard extension structure with manifest and styling

### Love-Meter
- Relationship/affection tracking system
- Demonstrates UI integration with templates and styling
- Shows how extensions can track persistent state

## RPG Extension Implementation Patterns

### State Management
- Extensions can maintain persistent data through SillyTavern's settings system
- Character-specific data can be stored and retrieved
- World state can be maintained across sessions

### UI Integration
- Custom HTML templates in `templates/` folder
- CSS styling in dedicated files
- JavaScript event handling for user interactions

### Chat Integration
- STscript commands for in-chat functionality
- Hidden messages for system communications
- Integration with message history and character responses

## Development Best Practices
- Use unique identifiers for settings and data
- Handle optional dependencies gracefully
- Provide clear user documentation
- Follow SillyTavern's event system patterns
- Implement proper error handling

## Sources
- SillyTavern official documentation: docs.sillytavern.app/extensions/
- Extension development guide: docs.sillytavern.app/for-contributors/writing-extensions/
- STscript reference: docs.sillytavern.app/usage/st-script/
- Local extension analysis from third-party folder