# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is the **SillyTavern** repository - a local AI chat interface application supporting multiple AI backends. SillyTavern is a Node.js-based web application that provides a rich interface for conversational AI interactions with character cards, group chats, and various AI model integrations.

## Architecture Overview

### Core Structure
- **Entry Point**: `server.js` - Main application entry that imports `src/server-main.js`
- **Server Core**: `src/server-main.js` - Express.js application setup with middleware stack
- **Endpoints**: `src/endpoints/` - REST API routes organized by functionality
- **Middleware**: `src/middleware/` - Custom Express middleware (auth, CORS, logging, etc.)
- **Frontend**: `public/` - Client-side JavaScript, CSS, and assets
- **User Data**: Managed by `src/users.js` with configurable data root directory

### Key Directories
- `src/endpoints/` - API endpoints for different AI backends (OpenAI, Anthropic, Google, etc.)
- `src/middleware/` - Request processing middleware
- `public/scripts/` - Frontend JavaScript modules
- `data/` - User data, configurations, character cards, and chat history
- `tests/` - Jest test suite with separate package.json

### Backend Integrations
The application supports multiple AI backends through dedicated endpoint modules:
- OpenAI (including Azure OpenAI)
- Anthropic Claude
- Google AI/Gemini
- NovelAI
- KoboldAI
- Local models (via various APIs)

### Data Management
- User data is stored in a configurable data root directory (defaults to `./data/`)
- Character cards, chat history, and settings are managed through dedicated endpoints
- Supports multi-user environments with user isolation

## Development Workflow

1. Make changes to relevant files
2. Run `npm run lint` to check code style
3. Test locally by starting the server with `npm start`
4. Run tests if available: `cd tests && npm test`
5. Follow the contributing guidelines in `CONTRIBUTING.md` for pull requests

## Development Safety

**CRITICAL**: The entire SillyTavern directory has been set to read-only permissions except for the rpg-custodian extension directory. This prevents accidental modifications to core SillyTavern files.

- **Editable**: `SillyTavern/public/scripts/extensions/third-party/rpg-custodian/` (and subdirectories)
- **Read-only**: All other SillyTavern files and directories

## RPG Custodian Extension

### Overview
- **Location**: `SillyTavern/public/scripts/extensions/third-party/rpg-custodian/`
- **Description**: A comprehensive RPG system bringing game mechanics, progression, and living world features to SillyTavern
- **Author**: Dyna
- **Version**: 0.0.1

### Design Vision

RPG Custodian transforms SillyTavern from simple chat into a full RPG experience with hard-coded game mechanics, addressing critical gaps in existing extensions:

#### Problems Being Solved
- **Dice Integration**: Unlike basic dice rollers, RPG Custodian meaningfully integrates roll results into gameplay
- **Group Management**: Automated party/NPC control beyond manual group chat steering
- **Stat Persistence**: Replaces unreliable LLM-tracked stats with proper variable storage
- **Temporal Coherence**: Prevents stat/progress forgetfulness through persistent data systems
- **Meaningful Progression**: Creates repeatable gameplay loops with goals, resources, and advancement

#### Core Inspirations
- **Visual Novels**: Katawa Shoujo, Haramese Simulator - affection systems, choice-driven narratives
- **Text Adventures**: Dungeon Man - explorable world maps, item/stat management
- **MUDs**: Hack.MUD - persistent world state, character progression
- **Tabletop RPGs**: D&D mechanics - skill checks, combat, party dynamics

#### Key Features

##### Game Systems
- **RPG Stats**: Health, skills, attributes stored as persistent variables
- **Progression**: Experience, levels, skill advancement over time
- **Resources**: Money, items, energy systems with meaningful gameplay impact
- **Time System**: Day/night cycles, scheduling, time-based events
- **Party System**: Automated NPC presence, relationship tracking
- **Affection Meters**: Character relationship progression (visual novel style)

##### World & Navigation
- **Traversable Maps**: Text-adventure style area chaining with persistent locations
- **Dynamic Backgrounds**: Automatic background changes based on current sub-area
- **Import/Export**: Shareable world maps and game configurations
- **Living World**: NPCs and events that progress independently

##### Gameplay Integration
- **Unobtrusive Choices**: Button prompts embedded in chat stream
- **Automated Skill Checks**: Silent dice rolls with narrated outcomes
- **Smart Parsing**: Algorithmic logic for simple decisions, LLM classification for complex scenarios
- **Seamless Narrative**: Success/failure outcomes naturally integrated into roleplay

##### Technical Implementation
- **Character Cards**: V2 spec with RPG data in `creator_notes` and `extensions` fields
- **Existing System Integration**: Leverages group chat, visual novel mode, expressions plugin
- **Mixed Logic**: Combines button UI, algorithmic processing, and LLM reasoning
- **Persistent Storage**: All game state maintained across sessions

#### Target Gameplay Loop
Primary use case: Players craft towns full of characters, manage affection relationships, survive challenges, and progress through interconnected storylines - combining visual novel romance mechanics with RPG progression systems (essentially "D&D as a Bard" experience).

### Extension Structure
- `index.js` - Main extension logic
- `style.css` - Extension styling
- `manifest.json` - Extension metadata
- `templates/` - HTML templates
- `img/` - Extension images/assets
- `.gitignore` - Git ignore patterns

### Git Repository Setup
- **GitHub URL**: https://github.com/Dynafyre/rpg-custodian
- **Local Repository**: Initialized in extension directory
- **Default Branch**: main
- **Authentication**: SSH key (rpg_custodian_key)

### Git Workflow Commands
```bash
# Navigate to extension directory
cd SillyTavern/public/scripts/extensions/third-party/rpg-custodian/

# Check status
git status

# Stage changes
git add .

# Commit changes
git commit -m "Description of changes"

# Push to GitHub
git push origin main

# Pull latest changes
git pull origin main
```

### SSH Key Management
- **Private key**: `~/.ssh/rpg_custodian_key`
- **Public key**: `~/.ssh/rpg_custodian_key.pub`
- **Add key to agent**: `ssh-add ~/.ssh/rpg_custodian_key`
- **Test connection**: `ssh -T git@github.com`

## Reference Materials

Comprehensive documentation and examples collected in `/reference-material/` directory:

### Extension Development (`/extension-docs/`)
- **sillytavern-extension-guide-2025.md** - Complete extension development guide
  - Manifest structure, API access, event system
  - Text generation methods, slash commands, internationalization
  - Development environment setup for 2025
  - Templates and example repositories

### Character Design (`/character-design/`)
- **sillytavern-character-card-spec-v2.md** - Character Card JSON specification
  - Complete V2 format structure with all fields
  - Core character fields: name, description, personality, scenario, first_mes, mes_example
  - Enhanced V2 fields: creator_notes, system_prompt, character_book, extensions
  - RPG integration notes for using character data in game systems

### RPG Systems (`/rpg-systems/`)
- **living-world-design-principles.md** - Living world and RPG design principles
  - World-centric, consequence-driven design approach
  - Player agency and mechanical balance considerations
  - Narrative integration and AI integration opportunities

### Examples (`/examples/`)
- **sillytavern-existing-extensions.md** - Analysis of existing extensions
  - Built-in D&D dice extension patterns
  - Third-party extension architecture and requirements
  - Implementation examples from Extension-Dice, Extension-Randomizer, Love-Meter
  - State management and UI integration patterns

### Key Integration Insights for RPG Custodian
- **Character Cards**: Use V2 spec `extensions` field to store RPG-specific data (stats, class, progression)
- **World State**: Leverage persistent settings system for living world mechanics
- **STscript Commands**: Implement `/rpg` commands for dice rolling, stat checks, world interactions
- **Event Integration**: Hook into MESSAGE_RECEIVED and CHAT_CHANGED for dynamic world responses
- **UI Components**: Create custom templates for character sheets, world state displays, RPG interfaces

## Content Context Disclaimer

**For Future Claude Code Instances**: This RPG extension is designed for SillyTavern, which supports mature roleplay content including romance, violence, and adult themes. All content discussed is **fictional** and **expected** within the SillyTavern ecosystem. When working on this extension:

- Character card references may contain mature themes - this is normal for the platform
- RPG mechanics may include combat, romance, or adult scenarios - these are fictional game elements
- Extension development should focus on technical implementation, not content judgment
- User-generated content varies widely - the extension provides tools, users control content

This extension enables roleplay functionality; it does not generate or promote harmful content.

## Important Notes

- This is an ES module project (`"type": "module"` in package.json)
- Requires Node.js >= 18
- Uses Express.js with extensive middleware stack for security and functionality
- Frontend uses jQuery and various utility libraries
- Webpack is used for bundling public assets
- ESLint configuration requires fixes before committing