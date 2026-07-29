# RPG Custodian Save System Research & Design

## Research Summary

Based on text adventure and RPG save system research, here are the key findings for designing RPG Custodian's save system.

## Save File Architecture: What Goes Where

### ❌ **NEVER in Save Files (Static World Data)**
- **Base world structure** (locations, connections, descriptions)
- **Default location backgrounds** and static assets
- **Base character templates** and starting attributes
- **Game rules** and mechanical systems
- **UI layouts** and display configurations

### ✅ **ALWAYS in Save Files (Dynamic Player State)**

#### **Core Player Data**
- Current location in the world
- Player stats (health, mana, experience, level)
- Inventory items and quantities
- Currency/resources
- Skill progressions and unlocked abilities

#### **World State Changes**
- Modified location descriptions (due to events)
- Opened/closed doors and pathways
- Depleted/respawned resources
- Environmental changes (weather, time of day)
- Background overrides (if locations change due to events)

#### **Character & Relationship Data**
- NPC relationship levels/affection meters
- Character locations (if NPCs move around)
- NPC state changes (alive/dead, mood, faction)
- Conversation history flags
- Romance progression states

#### **Quest & Progress Data**
- Active quest states and progress
- Completed objectives and flags
- Story progression markers
- Unlocked areas and content
- Achievement/milestone tracking

#### **Session Metadata**
- Save timestamp and version
- Playtime statistics
- Current world ID being played
- Save file name/description

## Key Research Insights

### Text Adventure Save Patterns
- **Checkpoint-based approach**: Save at specific story points
- **State machine pattern**: Each action changes game state
- **Delta-based saves**: Only store what's changed from defaults
- **Flag and counter system**: Booleans for binary states, numbers for quantities

### RPG Save System Best Practices
- **Efficient storage**: Never save what hasn't changed
- **Unique object IDs**: Track all world objects with unique identifiers
- **Hierarchical structure**: Organize data in logical sections
- **Version compatibility**: Plan for save file migrations

### Technical Implementation
- **Serialization**: Use JSON for cross-system compatibility
- **Compression**: Large save files benefit from compression
- **Lazy loading**: Load sections as needed for performance
- **Error handling**: Graceful degradation for corrupted saves

## RPG Custodian Specific Design

### World Template vs Save Separation
```
fresh-worlds/prototype-town.json  ← Static world template
saves/prototype-town_player1.json ← Dynamic player state
```

### Extensible Save File Structure
```json
{
  "version": "1.0",
  "metadata": {
    "timestamp": "2025-01-11T10:30:00Z",
    "worldId": "prototype-town",
    "playerName": "Player",
    "playtimeMinutes": 45
  },
  "player": {
    "location": "outskirts",
    "stats": { /* future: health, mana, etc */ },
    "inventory": { /* future: items */ }
  },
  "world_state": {
    "locationChanges": { /* modified descriptions */ },
    "environmentalFlags": { /* door states, etc */ }
  },
  "relationships": { /* future: NPC affection */ },
  "progression": { /* future: quests, achievements */ },
  "extensions": { /* future systems */ }
}
```

### Development Strategy
Start minimal with just player location, then incrementally add:
1. Player location (Phase 1)
2. Basic world state flags (Phase 2)
3. Inventory system (Phase 3)
4. NPC relationships (Phase 4)
5. Quest progression (Phase 5)

## Size Management
- Use delta-based saves (only store changes)
- Implement save file compression
- Regular cleanup of obsolete flags
- Version migration system for updates

## Implementation Notes
- Store saves in `game-worlds/saves/` directory
- Use world ID + player identifier for save names
- JSON format for human readability and debugging
- Graceful fallback to world defaults for missing data