# SillyTavern Character Card Spec V2 Format

## Overview
Character cards in SillyTavern use a JSON format following the Character Card V2 specification. These cards are often packaged into PNG images and shared on platforms like chub.ai.

## Complete JSON Structure

```typescript
{
  spec: 'chara_card_v2',
  spec_version: '2.0',
  data: {
    // Original V1 fields (nested)
    name: string,                    // Character's name
    description: string,             // Character description/appearance
    personality: string,             // Character personality traits
    scenario: string,                // Setting/scenario description
    first_mes: string,              // The character's first message
    mes_example: string,            // Example messages/dialogue

    // New V2 fields
    creator_notes: string,                  // Creator information (not included in prompts)
    system_prompt: string,                  // Character-specific system prompt
    post_history_instructions: string,      // Jailbreak/UJB instructions
    alternate_greetings: string[],          // Alternative first messages
    character_book?: {                      // Character lorebook/world info
      name?: string,
      description?: string,
      scan_depth?: number,
      token_budget?: number,
      recursive_scanning?: boolean,
      extensions: Record<string, any>,
      entries: Array<{
        keys: string[],                     // Trigger keywords
        content: string,                    // Lorebook entry content
        extensions: Record<string, any>,
        enabled: boolean,
        insertion_order: number,
        case_sensitive?: boolean
      }>
    },
    tags: string[],                         // Character tags for categorization
    creator: string,                        // Creator name
    character_version: string,              // Version identifier
    extensions: Record<string, any>         // Extension-specific data
  }
}
```

## Key Field Descriptions

### Core Character Fields (V1 Legacy)
- **name**: Character's display name
- **description**: Physical description, background, setting details
- **personality**: Personality traits, behavior patterns, quirks
- **scenario**: Current situation/context for roleplay
- **first_mes**: Opening message from the character
- **mes_example**: Example dialogue showing character's speech patterns

### Enhanced V2 Fields
- **creator_notes**: Information for users/creators, never sent to AI
- **system_prompt**: Character-specific system instructions (overrides global)
- **post_history_instructions**: Advanced prompting instructions (jailbreak/UJB)
- **alternate_greetings**: Array of alternative opening messages
- **character_book**: Embedded lorebook with world/character information
- **tags**: Categorization tags for discovery/filtering
- **creator**: Creator attribution
- **character_version**: Version tracking for updates
- **extensions**: Custom data for third-party extensions

## Specification Requirements
- `spec` field MUST be 'chara_card_v2'
- `spec_version` field MUST be '2.0'
- `extensions` field MUST default to empty object `{}`
- All V1 fields are nested under `data` to prevent V1 editors from corrupting V2 data

## RPG Extension Integration Notes
For the RPG Custodian extension, these character card fields could be utilized as:
- **Starting configuration**: Use character data to initialize RPG stats/classes
- **World building**: Leverage character_book for RPG world/lore information
- **Character progression**: Store RPG-specific data in extensions field
- **Scenario integration**: Use scenario field for RPG campaign/quest setup

## Community Resources
- **chub.ai**: Primary platform for sharing character cards
- **Character creation tools**: Various online editors support V2 format
- **SillyTavern compatibility**: Native support for importing/exporting V2 cards

## Source
Based on the official Character Card V2 specification: https://github.com/malfoyslastname/character-card-spec-v2