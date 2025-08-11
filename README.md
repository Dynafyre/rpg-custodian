# RPG Custodian Extension

A comprehensive RPG system for SillyTavern that brings game mechanics, progression, and living world features to character roleplay.

## Features

### Adventure Mode
- Toggle adventure mode on/off near the text entry field
- New Game/Continue/Load system through chat interface
- Automatic empty group chat creation for adventures

### World Navigation System
Commands for exploring game worlds:

- `/move <location>` - Travel to a connected location
- `/travel <location>` - Alternative travel command  
- `/look` - Examine your current location
- `/map` - Show available connections from current location

### World System
- JSON-based world files stored in `game-worlds/` directory
- Dynamic background changes based on current location
- Interconnected location system with descriptions and connections
- Import/export capability for sharing worlds

## Usage

1. Toggle "Adventure Mode" near the text input field
2. Click "New Game" to start a fresh adventure
3. Use `/move <location>` to travel between connected areas
4. Use `/look` to get location details and `/map` to see where you can go

## World File Format

Game worlds are stored as JSON files in the `game-worlds/` directory. Each world contains:

```json
{
  "worldId": "unique-world-name",
  "name": "Display Name",
  "description": "World description",
  "startingLocation": "location-key",
  "locations": {
    "location-key": {
      "name": "Location Name",
      "description": "Location description",
      "connections": ["connected-location-1", "connected-location-2"],
      "background": "background-image.jpg"
    }
  },
  "gameSettings": {
    "enableBackgroundChange": true,
    "enableFirstVisitMessages": true
  }
}
```

## Development Status

Currently in early development. Core features being implemented:
- ✅ World file structure
- 🚧 Adventure mode toggle
- 🚧 Navigation commands
- ⏳ Background integration
- ⏳ Game state persistence

## Files Structure

```
rpg-custodian/
├── index.js              # Main extension logic
├── style.css             # Extension styling  
├── manifest.json         # Extension metadata
├── README.md             # This file
├── templates/            # HTML templates
├── img/                  # Extension images/assets
└── game-worlds/          # World data files
    └── prototype-town.json # Sample world
```