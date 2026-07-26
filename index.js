/**
 * RPG Custodian Extension for SillyTavern
 * A comprehensive RPG system bringing game mechanics and living world features
 */

import { getMessageTimeStamp } from '../../../RossAscends-mods.js';
import { SlashCommand } from '../../../slash-commands/SlashCommand.js';
import { SlashCommandArgument } from '../../../slash-commands/SlashCommandArgument.js';
import { ARGUMENT_TYPE } from '../../../slash-commands/SlashCommandArgument.js';
import { SlashCommandEnumValue, enumTypes } from '../../../slash-commands/SlashCommandEnumValue.js';
import { this_chid, generateQuietPrompt, user_avatar, isGenerating } from '../../../../script.js';
import { background_settings } from '../../../backgrounds.js';
import { getUserAvatars, setUserAvatar } from '../../../personas.js';
import { openGroupById, editGroup, createNewGroupChat, group_activation_strategy, group_generation_mode } from '../../../group-chats.js';
import { loadWorldInfo, saveWorldInfo, createWorldInfoEntry, updateWorldInfoList } from '../../../world-info.js';

jQuery(async () => {
    'use strict';

    const extensionName = 'rpg-custodian';
    
    // Get SillyTavern context
    const context = SillyTavern.getContext();

    // getContext() returns SNAPSHOTS: `characters` and `chat` are mutated in
    // place (so the cached `context` ref stays valid), but `groups` is
    // reassigned by getGroups() and `groupId`/`characterId` are primitive
    // snapshots — all three go stale on the cached object. Read mutable state
    // through a FRESH context whenever it can change under us.
    const getCtx = () => SillyTavern.getContext();

    // Cache for available worlds (populated during initialization)
    let availableWorldsCache = [];
    
    // Current game state (in memory for now)
    let currentGameState = {
        worldData: null,
        currentLocation: null,
        isActive: false,
        currentTime: 0, // 0=Morning, 1=Day, 2=Evening, 3=Night
        dayCount: 1
    };
    
    // Time system constants
    const TIME_PERIODS = [
        { name: 'Morning', emoji: '🌅' },
        { name: 'Day', emoji: '☀️' },
        { name: 'Evening', emoji: '🌆' },
        { name: 'Night', emoji: '🌙' }
    ];
    
    // World registry stored in extension settings
    function getWorldRegistry() {
        const settings = context.extensionSettings[extensionName] || {};
        return settings.worldRegistry || ['prototype-town']; // Default with prototype-town
    }
    
    // Get/set saved pre-RPG background
    function getSavedBackground() {
        const settings = context.extensionSettings[extensionName] || {};
        return settings.savedBackground || null;
    }
    
    function setSavedBackground(backgroundName) {
        context.extensionSettings[extensionName] = context.extensionSettings[extensionName] || {};
        context.extensionSettings[extensionName].savedBackground = backgroundName;
        context.saveSettingsDebounced();
    }
    
    // Restore saved background
    async function restoreSavedBackground() {
        const savedBackground = getSavedBackground();
        if (savedBackground) {
            console.log(`RPG Custodian: Restoring saved background: ${savedBackground}`);
            await setBackground(savedBackground);
        } else {
            console.log('RPG Custodian: No saved background to restore');
        }
    }
    
    function saveWorldRegistry(registry) {
        context.extensionSettings[extensionName] = context.extensionSettings[extensionName] || {};
        context.extensionSettings[extensionName].worldRegistry = registry;
        context.saveSettingsDebounced();
    }
    
    /**
     * Initialize the extension
     */
    async function init() {
        console.log('RPG Custodian: Initializing extension');
        
        // Load registered worlds
        await loadRegisteredWorlds();

        // Ensure Game Master character exists (before the lorebook, which binds to it)
        await ensureGameMasterExists();

        // Ensure the RPG Custodian lorebook exists and is bound to the Game Master
        await ensureRpgLorebook();
        
        // Add RPG menu button
        addRpgMenuButton();
        
        // Register slash commands
        registerSlashCommands();

        // Drive the Intent Analyzer off every player message
        context.eventSource.on(context.eventTypes.MESSAGE_SENT, onUserMessage);

        console.log('RPG Custodian: Extension initialized');
    }

    // The extension's own SillyTavern lorebook (World Info), BOUND TO THE GAME
    // MASTER character (its character-lorebook) and created on init (idempotent).
    // This is the seed of the spell/curse system's flavor layer. More world lore
    // and future curses/spells are added the same way via RPG_LORE_ENTRIES.
    const RPG_LOREBOOK_NAME = 'RPG Custodian Lore';
    const RPG_LORE_ENTRIES = [
        {
            comment: 'Crystal Curse',
            key: ['crystal curse', 'crystal', 'curse', 'dark magic', 'soulgem', 'soul gem', 'soul'],
            content: [
                'The Crystal Curse (also "the Soulgem Hex") is a dark-magic affliction that corrupts the very seed of life.',
                'A man under the curse sires only soulgems; a woman under it bears only soulgems — inert, faceted magic crystals in place of living young. No child conceived by or carried by a cursed person can ever quicken; the pregnancy runs its full term and delivers cold, lifeless crystal instead.',
                'The curse is PERMANENT once laid, lingering until it is broken by magic — a cleansing rite, holy light, a counter-hex, or a wish. (A weaker, temporary casting may fade on its own after a time.)',
                'To LAY the curse is a contest of will and craft: the caster\'s Craftiness (or, for a trap or cursed item, its stored power) pitted against the victim\'s Ruggedness to resist. The strong of body may shrug it off.',
                'It can be laid through soulgem sorcery, a witch\'s hex, a cursed artifact, or a pact. The afflicted are often marked by faint crystalline growths, a cold gemlight behind the eyes, or skin that glitters like frost.',
            ].join('\n'),
            constant: false,
            selective: true,
            order: 100,
        },
        {
            comment: 'Soul Crystals',
            key: ['soul crystal', 'soulshard', 'soulgem', 'soul gem', 'soul crystals', 'mana crystal'],
            content: [
                'A soul crystal (soulshard) is the inert, faceted gem born in place of a living child to one under the Crystal Curse. Cold and lifeless, it holds no soul of its own — but it is dense with raw arcane potential.',
                'Crushed or channelled, a fully-formed soul crystal yields its stored energy: consuming one restores a measure of a spellcaster\'s Mana (1 point). They are the crude batteries of soul-magic, prized by wizards and hoarded by the desperate.',
                'They accumulate wherever they were born — a cursed mother\'s home may glitter with a growing clutch of them.',
            ].join('\n'),
            constant: false,
            selective: true,
            order: 100,
        },
    ];
    async function ensureRpgLorebook() {
        try {
            let data = await loadWorldInfo(RPG_LOREBOOK_NAME);
            let changed = false;
            if (!data || typeof data !== 'object' || !data.entries) { data = { entries: {} }; changed = true; }
            for (const spec of RPG_LORE_ENTRIES) {
                const already = Object.values(data.entries).some(e => (e.comment || '') === spec.comment);
                if (already) continue;
                const entry = createWorldInfoEntry(RPG_LOREBOOK_NAME, data);
                if (!entry) continue;
                Object.assign(entry, spec);
                changed = true;
            }
            if (changed) await saveWorldInfo(RPG_LOREBOOK_NAME, data, true);
            await updateWorldInfoList();
            // Bind it to the Game Master character (its character-lorebook), so the
            // lore travels with the RPG rather than polluting every chat globally.
            const gmIndex = (context.characters || []).findIndex(c => c.avatar === 'Game Master.png');
            if (gmIndex >= 0 && context.characters[gmIndex].data?.extensions?.world !== RPG_LOREBOOK_NAME) {
                await context.writeExtensionField(gmIndex, 'world', RPG_LOREBOOK_NAME);
            }
            console.log('RPG Custodian: lorebook ready + bound to Game Master:', RPG_LOREBOOK_NAME);
        } catch (e) {
            console.error('RPG Custodian: failed to ensure lorebook', e);
        }
    }

    /**
     * Load registered worlds from the world registry
     */
    async function loadRegisteredWorlds() {
        try {
            console.log('RPG Custodian: Loading registered worlds...');
            
            const registeredWorlds = getWorldRegistry();
            const loadedWorlds = [];
            
            for (const worldName of registeredWorlds) {
                try {
                    const worldPath = `scripts/extensions/third-party/rpg-custodian/game-worlds/fresh-worlds/${worldName}/${worldName}.json`;
                    const response = await fetch(worldPath);
                    
                    if (response.ok) {
                        const worldData = await response.json();
                        loadedWorlds.push({
                            name: worldName,
                            description: worldData.description || `${worldData.name} - No description available`,
                            emoji: '🗺️'
                        });
                        console.log(`RPG Custodian: Loaded registered world "${worldName}"`);
                    } else {
                        console.warn(`RPG Custodian: Registered world "${worldName}" file not found (may have been deleted)`);
                    }
                } catch (error) {
                    console.warn(`RPG Custodian: Could not load registered world "${worldName}":`, error);
                }
            }
            
            // Always have at least one world available
            if (loadedWorlds.length === 0) {
                console.warn('RPG Custodian: No registered worlds could be loaded, using fallback');
                loadedWorlds.push({
                    name: 'prototype-town',
                    description: 'Mountain Town Prototype - Default world (register with /rpg-register-world)',
                    emoji: '🗺️'
                });
            }
            
            availableWorldsCache = loadedWorlds;
            console.log(`RPG Custodian: Loaded ${availableWorldsCache.length} registered world(s):`, 
                       availableWorldsCache.map(w => w.name).join(', '));
            
        } catch (error) {
            console.error('RPG Custodian: Error loading registered worlds:', error);
            // Fallback to default
            availableWorldsCache = [{
                name: 'prototype-town',
                description: 'Mountain Town Prototype - Default world',
                emoji: '🗺️'
            }];
        }
    }

    /**
     * Add RPG menu button to the rightSendForm element
     */
    function addRpgMenuButton() {
        const rightSendForm = $('#rightSendForm');
        
        if (rightSendForm.length === 0) {
            console.error('RPG Custodian: Could not find rightSendForm element');
            return;
        }
        
        const button = $(`
            <button id="rpg-menu-button" 
                    title="rpg-menu"
                    style="
                        margin-left: 5px; 
                        padding: 8px 12px; 
                        background: rgba(255, 255, 255, 0.1); 
                        color: white; 
                        border: 1px solid rgba(255, 255, 255, 0.3); 
                        border-radius: 6px; 
                        cursor: pointer;
                        font-size: 12px;
                        font-weight: 500;
                        height: 36px;
                        min-height: 36px;
                        max-height: 36px;
                        align-self: flex-start;
                        text-shadow: 0 1px 2px rgba(0, 0, 0, 0.5);
                        box-shadow: 
                            0 2px 4px rgba(0, 0, 0, 0.3),
                            inset 0 1px 0 rgba(255, 255, 255, 0.2),
                            inset 0 -1px 0 rgba(0, 0, 0, 0.2);
                        transition: all 0.1s ease;
                        backdrop-filter: blur(2px);
                        box-sizing: border-box;
                    ">
                RPG
            </button>
        `);
        
        button.on('click', function(event) {
            event.stopPropagation();
            toggleRpgMenu();
        });
        
        // Add hover and click effects
        button.on('mouseenter', function() {
            $(this).css({
                'background': 'rgba(255, 255, 255, 0.2)',
                'box-shadow': `
                    0 3px 6px rgba(0, 0, 0, 0.4),
                    inset 0 1px 0 rgba(255, 255, 255, 0.3),
                    inset 0 -1px 0 rgba(0, 0, 0, 0.1)
                `
            });
        });
        
        button.on('mouseleave', function() {
            $(this).css({
                'background': 'rgba(255, 255, 255, 0.1)',
                'box-shadow': `
                    0 2px 4px rgba(0, 0, 0, 0.3),
                    inset 0 1px 0 rgba(255, 255, 255, 0.2),
                    inset 0 -1px 0 rgba(0, 0, 0, 0.2)
                `
            });
        });
        
        // Mouse events for desktop
        button.on('mousedown', function() {
            $(this).css({
                'box-shadow': `
                    inset 0 2px 4px rgba(0, 0, 0, 0.4),
                    inset 0 1px 0 rgba(0, 0, 0, 0.2),
                    inset 0 -1px 0 rgba(255, 255, 255, 0.1)
                `,
                'transform': 'translateY(1px)'
            });
        });
        
        button.on('mouseup', function() {
            $(this).css({
                'box-shadow': `
                    0 3px 6px rgba(0, 0, 0, 0.4),
                    inset 0 1px 0 rgba(255, 255, 255, 0.3),
                    inset 0 -1px 0 rgba(0, 0, 0, 0.1)
                `,
                'transform': 'translateY(0px)'
            });
        });
        
        // Touch events for mobile - visual feedback only.
        // No preventDefault here: it would suppress the synthesized 'click'
        // event on touch devices and make the button dead on mobile.
        button.on('touchstart', function() {
            $(this).css({
                'transform': 'translateY(1px) scale(0.98)',
                'opacity': '0.8'
            });
        });
        
        button.on('touchend', function() {
            $(this).css({
                'transform': 'translateY(0px) scale(1)',
                'opacity': '1'
            });
        });
        
        // Also handle touchcancel in case touch is interrupted
        button.on('touchcancel', function() {
            $(this).css({
                'transform': 'translateY(0px) scale(1)',
                'opacity': '1'
            });
        });
        
        rightSendForm.append(button);
        
        console.log('RPG Custodian: RPG menu button added to rightSendForm');
    }

    /**
     * Build and toggle the RPG dropdown menu anchored above the RPG button.
     * Primary player-facing entry point: New Game / Continue / Character /
     * Wait / Date / Exit, so slash commands stay fallback-only.
     */
    function toggleRpgMenu() {
        const existing = $('#rpg-menu-popup');
        if (existing.length) {
            existing.remove();
            return;
        }

        const save = getCurrentSave();
        const items = [];

        if (save) {
            items.push({ icon: '▶️', label: `Continue (${save.world}, Day ${save.day ?? 1})`, action: continueGame });
        }
        for (const world of availableWorldsCache) {
            items.push({ icon: '🎲', label: `New Game: ${world.name}`, action: () => newGame(world.name) });
        }
        items.push({ icon: '✨', label: 'Create Character', action: () => createRPGCharacterCommand() });
        items.push({ icon: '👤', label: 'Character Sheet', action: () => showRPGCharacterInfoCommand({}, '') });
        if (currentGameState.isActive) {
            items.push({ icon: '⏰', label: 'Wait (advance time)', action: () => waitCommand({}, '') });
            items.push({ icon: '📅', label: 'Date & Time', action: () => dateCommand({}, '') });
            items.push({ icon: '🚪', label: 'Exit RPG Mode', action: () => rpgExitCommand({}, '') });
        }

        const menu = $('<div id="rpg-menu-popup"></div>');
        for (const item of items) {
            const row = $(`<div class="rpg-menu-item">${item.icon} ${item.label}</div>`);
            row.on('click', async function(event) {
                event.stopPropagation();
                $('#rpg-menu-popup').remove();
                try {
                    await item.action();
                } catch (error) {
                    console.error('RPG Custodian: Menu action failed:', error);
                }
            });
            menu.append(row);
        }

        $('body').append(menu);

        // Position the popup near the RPG button, then clamp it fully inside
        // the viewport. Measuring after append (instead of a single bottom/right
        // calculation) keeps it on-screen on mobile, where the button rect and
        // innerHeight don't line up the way they do on desktop.
        const btn = document.getElementById('rpg-menu-button');
        const el = menu[0];
        const margin = 8;
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const pw = el.offsetWidth;
        const ph = el.offsetHeight;

        let left = vw - pw - margin;   // default: pinned to the right edge
        let top = vh - ph - margin;    // default: above the input row

        if (btn) {
            const rect = btn.getBoundingClientRect();
            // Prefer above the button; flip below if there isn't room above.
            top = rect.top - ph - margin;
            if (top < margin) top = rect.bottom + margin;
            // Right-align the popup with the button.
            left = rect.right - pw;
        }

        // Final clamp so it can never render off any edge.
        left = Math.min(Math.max(margin, left), vw - pw - margin);
        top = Math.min(Math.max(margin, top), vh - ph - margin);

        menu.css({ left: `${left}px`, top: `${top}px`, right: 'auto', bottom: 'auto' });

        // Dismiss on outside click
        setTimeout(() => {
            $(document).one('click.rpgMenu', () => $('#rpg-menu-popup').remove());
        }, 0);
    }

    // --- Group-chat session model -------------------------------------------
    // An RPG session is a group chat: Game Master (talkativeness 0, narration
    // only) + the whole world cast. Membership is static; *presence* is
    // controlled by muting — everyone not at the player's current location sits
    // in the group's disabled_members, and syncPresence() un-mutes exactly the
    // NPCs whose schedule places them here-and-now. See docs/game-design.

    const RPG_GROUP_PREFIX = 'RPG: ';

    /**
     * Find the existing RPG group for a world, if any.
     */
    function findRpgGroup(worldData) {
        const name = `${RPG_GROUP_PREFIX}${worldData.name}`;
        return (getCtx().groups || []).find(g => g.name === name) || null;
    }

    /**
     * Create the RPG group chat for a world (Game Master + full cast).
     * Returns the new group id, or null on failure.
     */
    async function createRpgGroup(worldData) {
        // Members are avatar filenames; cast + Game Master must already exist.
        const memberAvatars = ['Game Master.png'];
        const chars = getCtx().characters;
        for (const castName of (worldData.cast || [])) {
            const char = chars.find(c => c.avatar === `${castName}.png`);
            if (char) memberAvatars.push(char.avatar);
        }

        const chatName = `${worldData.worldId}-${currentGameState.dayCount || 1}`;
        const groupModel = {
            name: `${RPG_GROUP_PREFIX}${worldData.name}`,
            members: memberAvatars,
            avatar_url: 'img/five.png',
            allow_self_responses: false,
            hideMutedSprites: true,
            // MANUAL: the group never auto-generates on a player message — the
            // Custodian orchestration explicitly /triggers the addressed NPC.
            // This avoids racing to abort an auto-reply (which was locking gen).
            activation_strategy: group_activation_strategy.MANUAL,
            generation_mode: group_generation_mode.SWAP,
            disabled_members: [],
            fav: false,
            chat_id: chatName,
            chats: [chatName],
            auto_mode_delay: 5,
        };

        const response = await fetch('/api/groups/create', {
            method: 'POST',
            headers: context.getRequestHeaders(),
            body: JSON.stringify(groupModel),
        });
        if (!response.ok) {
            console.error('RPG Custodian: Group create failed:', response.status, await response.text());
            return null;
        }
        const data = await response.json();
        await context.getCharacters();
        console.log(`RPG Custodian: Created RPG group "${groupModel.name}" (${data.id}) with ${memberAvatars.length} members`);
        return data.id;
    }

    /**
     * Recompute NPC presence and apply it as group mute state.
     * Present NPCs are un-muted; everyone else (except the GM) is muted.
     * The Game Master stays enabled but has talkativeness 0, so it only speaks
     * when @mentioned or triggered by a game function call.
     */
    async function syncPresence() {
        if (!currentGameState.isActive || !currentGameState.groupId) return;
        const group = (getCtx().groups || []).find(g => g.id === currentGameState.groupId);
        if (!group) {
            console.warn('RPG Custodian: syncPresence could not find group', currentGameState.groupId);
            return;
        }

        const presentAvatars = getNpcsAt(currentGameState.currentLocation).map(npc => `${npc.name}.png`);
        const disabled = [];
        for (const avatar of group.members) {
            if (avatar === 'Game Master.png') continue;        // GM never muted
            if (!presentAvatars.includes(avatar)) disabled.push(avatar);
        }
        group.disabled_members = disabled;
        group.activation_strategy = group_activation_strategy.MANUAL;   // self-heal older NATURAL groups

        try {
            await editGroup(currentGameState.groupId, true, true);
        } catch (error) {
            console.error('RPG Custodian: Failed to persist presence mute state:', error);
        }
        console.log(`RPG Custodian: Presence synced — present: [${presentAvatars.join(', ') || 'none'}], muted: ${disabled.length}`);
        renderActionBar();
        projectPlayerStatus();  // refresh dispositions for who's now present
    }

    /**
     * True when we are inside the active RPG group session.
     * Replaces the old solo-GM-chat check now that sessions are group chats.
     */
    function isInRpgSession() {
        return Boolean(
            currentGameState.isActive &&
            currentGameState.groupId &&
            getCtx().groupId === currentGameState.groupId,
        );
    }

    /**
     * Open (creating if needed) the RPG group for a world and return its id.
     */
    async function openRpgGroup(worldData) {
        let group = findRpgGroup(worldData);
        let groupId = group?.id;
        if (!groupId) {
            groupId = await createRpgGroup(worldData);
            if (!groupId) return null;
        }
        await openGroupById(groupId);
        return groupId;
    }

    /**
     * Start a brand new game in the given world (menu action).
     */
    async function newGame(worldName) {
        const currentBackground = background_settings.name;
        if (currentBackground && currentBackground !== '__transparent.png' && !currentGameState.isActive) {
            setSavedBackground(currentBackground);
        }
        await startRpgSession(worldName);
    }

    /**
     * Resume the last saved game (menu action).
     */
    async function continueGame() {
        const save = getCurrentSave();
        if (!save) {
            sendGhostMessage('❌ No save found. Start a New Game from the RPG menu.');
            return;
        }

        const currentBackground = background_settings.name;
        if (currentBackground && currentBackground !== '__transparent.png' && !currentGameState.isActive) {
            setSavedBackground(currentBackground);
        }

        const worldPath = `scripts/extensions/third-party/rpg-custodian/game-worlds/fresh-worlds/${save.world}/${save.world}.json`;
        const response = await fetch(worldPath);
        if (!response.ok) {
            sendGhostMessage(`❌ Saved world "${save.world}" could not be loaded.`);
            return;
        }
        const worldData = await response.json();

        currentGameState.worldData = worldData;
        currentGameState.currentTime = save.time ?? 0;
        currentGameState.dayCount = save.day ?? 1;
        currentGameState.party = save.party || [];
        currentGameState.offspring = save.offspring || [];
        currentGameState.timeStep = save.timeStep ?? 0;
        currentGameState.currentLocation = worldData.locations[save.location] ? save.location : worldData.startingLocation;

        // Cast + group must exist before we can open the session
        await ensureCastExists(worldData);
        const groupId = await openRpgGroup(worldData);
        if (!groupId) {
            sendGhostMessage('❌ Could not open the RPG group chat. Check console.');
            return;
        }
        currentGameState.groupId = groupId;
        currentGameState.isActive = true;
        getPlayerRpgData();

        await syncPresence();
        projectPlayerStatus();
        updateTimeDisplay();

        const location = worldData.locations[currentGameState.currentLocation];
        await setBackground(location.background);

        const time = TIME_PERIODS[currentGameState.currentTime];
        sendGameMasterMessage(`💾 **Game Loaded: ${worldData.name}**\n\n🗓️ Day ${currentGameState.dayCount}, ${time.emoji} ${time.name}\n\n📍 **${location.name}**\n${location.description}${presenceLine(currentGameState.currentLocation)}`);
        console.log(`RPG Custodian: Continued save in "${save.world}" at "${currentGameState.currentLocation}"`);
    }

    /**
     * Read the current save from extension settings.
     */
    function getCurrentSave() {
        const settings = context.extensionSettings[extensionName] || {};
        const save = settings.currentSave;
        // Support both the new flat schema and the original nested one
        if (!save) return null;
        if (save.world) return save;
        if (save.metadata?.worldId) {
            return {
                world: save.metadata.worldId,
                location: save.player?.location,
                time: 0,
                day: (save.player?.gameDaysSpent ?? 0) + 1,
            };
        }
        return null;
    }

    /**
     * Persist the live game state as the current save.
     */
    function saveCurrentState() {
        if (!currentGameState.isActive) return;
        context.extensionSettings[extensionName] = context.extensionSettings[extensionName] || {};
        context.extensionSettings[extensionName].currentSave = {
            version: '1.1',
            world: currentGameState.worldData.worldId,
            location: currentGameState.currentLocation,
            time: currentGameState.currentTime,
            day: currentGameState.dayCount,
            timeStep: currentGameState.timeStep || 0,
            groupId: currentGameState.groupId || null,
            party: currentGameState.party || [],
            offspring: currentGameState.offspring || [],
            timestamp: new Date().toISOString(),
        };
        context.saveSettingsDebounced();
    }

    // Extended Persona System for RPG Characters
    /**
     * Extended version of SillyTavern's initPersona function that adds RPG data fields
     * @param {string} avatarId - The avatar ID/filename
     * @param {string} personaName - The character name
     * @param {string} personaDescription - The character description (for LLM context)
     * @param {string} personaTitle - Optional title for the character
     * @param {Object} rpgData - RPG-specific character data
     */
    async function initRPGPersona(avatarId, personaName, personaDescription, personaTitle, rpgData = {}) {
        // Access power_user through the correct context path
        const power_user = context.powerUserSettings;
        
        console.log('RPG Custodian: Using context.powerUserSettings for persona access');
        console.log('RPG Custodian: Before creation - existing personas:', Object.keys(power_user.personas || {}));
        
        // Initialize personas objects if they don't exist
        power_user.personas = power_user.personas || {};
        power_user.persona_descriptions = power_user.persona_descriptions || {};
        
        // Create the persona structure
        power_user.personas[avatarId] = personaName;
        power_user.persona_descriptions[avatarId] = {
            description: personaDescription || '',
            position: 0, // IN_PROMPT position
            depth: 4,    // DEFAULT_DEPTH
            role: 0,     // DEFAULT_ROLE
            lorebook: '',
            title: personaTitle || '',
        };
        
        console.log('RPG Custodian: After creation - personas:', Object.keys(power_user.personas));
        console.log('RPG Custodian: New persona created:', avatarId, personaName);
        console.log('RPG Custodian: Persona data:', power_user.personas[avatarId]);
        console.log('RPG Custodian: Persona description:', power_user.persona_descriptions[avatarId]);
        
        // Extend the persona_descriptions object with RPG data
        const personaDesc = power_user.persona_descriptions[avatarId];
        if (personaDesc) {
            // Add RPG-specific fields that won't interfere with SillyTavern's normal operation
            personaDesc.rpg_data = {
                version: '2.0',
                created_at: new Date().toISOString(),
                // Core four-stat system (see docs/game-design/core-mechanics.md):
                // Ruggedness -> Stamina pool (HP + exertion), Craftiness -> Mana pool,
                // Charm -> social/escalation checks, Virility -> fertilization rolls.
                stats: rpgData.stats || {
                    level: 1,
                    experience: 0,
                    power_tokens: 0,
                    ruggedness: 3,
                    charm: 3,
                    craftiness: 3,
                    virility: 1,
                    stamina: 3,      // current, max = ruggedness
                    mana: 3          // current, max = craftiness (daily refresh)
                },
                skills: rpgData.skills || {},
                inventory: rpgData.inventory || {
                    items: [],
                    currency: 0
                },
                progression: rpgData.progression || {
                    quests_completed: [],
                    achievements: [],
                    unlocked_areas: []
                },
                world_state: rpgData.world_state || {
                    current_location: null,
                    visited_locations: [],
                    relationship_flags: {},
                    story_flags: {}
                },
                metadata: rpgData.metadata || {
                    character_class: 'Adventurer',
                    background: 'Traveler',
                    notes: ''
                }
            };
            
            console.log(`RPG Custodian: Extended persona "${personaName}" with RPG data:`, personaDesc.rpg_data);
        }
        
        // Save settings to persist the changes
        if (typeof context.saveSettingsDebounced === 'function') {
            context.saveSettingsDebounced();
        }
        
        // Refresh the persona UI to show the new persona
        if (typeof context.getUserAvatars === 'function') {
            await context.getUserAvatars(true, avatarId);
            console.log('RPG Custodian: Refreshed persona UI');
        } else {
            console.warn('RPG Custodian: getUserAvatars not available in context');
        }
        
        return avatarId;
    }

    /**
     * Extended version of SillyTavern's createPersona function that includes RPG character creation
     */
    async function createRPGPersona(avatarId) {
        // Simple prompt function fallback
        const prompt = (message, defaultValue = '') => {
            return window.prompt(message, defaultValue);
        };
        
        // Get basic character info
        const personaName = prompt('Enter a name for your RPG character:', '');
        if (!personaName) {
            console.debug('RPG Custodian: User cancelled creating RPG character');
            return null;
        }
        
        const personaDescription = prompt(
            'Enter a description for your character:\n(This will be sent to NPCs as context)', 
            ''
        );
        
        const characterClass = prompt('Enter your character class:', 'Adventurer');
        const background = prompt('Enter your character background:', 'Traveler');
        
        // Create RPG-specific starting data (four-stat system)
        const rpgData = {
            stats: {
                level: 1,
                experience: 0,
                power_tokens: 0,
                ruggedness: 3,
                charm: 3,
                craftiness: 3,
                virility: 1,
                stamina: 3,
                mana: 3
            },
            metadata: {
                character_class: characterClass || 'Adventurer',
                background: background || 'Traveler',
                notes: ''
            }
        };
        
        // Create the extended persona
        const createdAvatarId = await initRPGPersona(avatarId, personaName, personaDescription, '', rpgData);
        
        // Refresh the persona UI to show the new character immediately
        try {
            await getUserAvatars(true, createdAvatarId);
            console.log(`RPG Custodian: UI refreshed for new character "${personaName}"`);
        } catch (error) {
            console.warn('RPG Custodian: Failed to refresh UI:', error);
        }

        // Select the new character as the active persona so it IS the player.
        try {
            await setUserAvatar(createdAvatarId, { toastPersonaNameChange: false });
            console.log(`RPG Custodian: Selected "${personaName}" as active persona`);
            renderActionBar();
        } catch (error) {
            console.warn('RPG Custodian: Failed to select new persona:', error);
        }

        console.log(`RPG Custodian: Created RPG character "${personaName}" with class "${characterClass}"`);
        return createdAvatarId;
    }

    /**
     * Get RPG data for the current persona
     * @returns {Object|null} RPG data object or null if no RPG data exists
     */
    function getCurrentRPGData() {
        const currentPersona = user_avatar;
        if (!currentPersona || !context.powerUserSettings.persona_descriptions[currentPersona]) {
            return null;
        }
        
        return context.powerUserSettings.persona_descriptions[currentPersona].rpg_data || null;
    }

    /**
     * Update RPG data for the current persona
     * @param {Object} updateData - Object containing the fields to update
     */
    function updateCurrentRPGData(updateData) {
        const currentPersona = user_avatar;
        if (!currentPersona || !context.powerUserSettings.persona_descriptions[currentPersona]) {
            console.warn('RPG Custodian: No current persona to update RPG data for');
            return false;
        }
        
        const personaDesc = context.powerUserSettings.persona_descriptions[currentPersona];
        if (!personaDesc.rpg_data) {
            console.warn('RPG Custodian: Current persona has no RPG data to update');
            return false;
        }
        
        // Deep merge the update data
        function deepMerge(target, source) {
            for (const key in source) {
                if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
                    target[key] = target[key] || {};
                    deepMerge(target[key], source[key]);
                } else {
                    target[key] = source[key];
                }
            }
        }
        
        deepMerge(personaDesc.rpg_data, updateData);
        
        // Save settings
        if (typeof context.saveSettingsDebounced === 'function') {
            context.saveSettingsDebounced();
        }
        
        console.log('RPG Custodian: Updated RPG data for current persona:', updateData);
        return true;
    }

    /**
     * Register slash commands for RPG functionality
     */
    function registerSlashCommands() {
        // Register /rpg-start command with autocomplete
        context.SlashCommandParser.addCommandObject(SlashCommand.fromProps({
            name: 'rpg-start',
            callback: rpgStartCommand,
            unnamedArgumentList: [
                SlashCommandArgument.fromProps({
                    description: 'world name to start',
                    typeList: [ARGUMENT_TYPE.STRING],
                    isRequired: true,
                    enumProvider: getAvailableWorldsEnum,
                }),
            ],
            helpString: 'Start a new RPG session with the specified world',
            returns: 'Status message about the RPG session start',
        }));
        
        // Register travel commands
        context.SlashCommandParser.addCommandObject(SlashCommand.fromProps({
            name: 'move',
            callback: moveCommand,
            unnamedArgumentList: [
                SlashCommandArgument.fromProps({
                    description: 'location to move to',
                    typeList: [ARGUMENT_TYPE.STRING],
                    isRequired: true,
                    enumProvider: getConnectedLocationsEnum,
                }),
            ],
            helpString: 'Move to a connected location in the current world',
            returns: 'Status message about the movement',
        }));
        
        context.SlashCommandParser.addCommandObject(SlashCommand.fromProps({
            name: 'look',
            callback: lookCommand,
            unnamedArgumentList: [
                SlashCommandArgument.fromProps({
                    description: 'optional target to look at',
                    typeList: [ARGUMENT_TYPE.STRING],
                    isRequired: false,
                }),
            ],
            helpString: 'Look at your current location or examine a specific target',
            returns: 'Description of current location or target',
        }));
        
        // Register world management commands
        context.SlashCommandParser.addCommandObject(SlashCommand.fromProps({
            name: 'rpg-register-world',
            callback: registerWorldCommand,
            unnamedArgumentList: [
                SlashCommandArgument.fromProps({
                    description: 'world name to register',
                    typeList: [ARGUMENT_TYPE.STRING],
                    isRequired: true,
                }),
            ],
            helpString: 'Register a new world by checking if it exists and adding to the registry',
            returns: 'Status message about the registration',
        }));
        
        context.SlashCommandParser.addCommandObject(SlashCommand.fromProps({
            name: 'rpg-deregister-world',
            callback: deregisterWorldCommand,
            unnamedArgumentList: [
                SlashCommandArgument.fromProps({
                    description: 'world name to deregister',
                    typeList: [ARGUMENT_TYPE.STRING],
                    isRequired: true,
                    enumProvider: getRegisteredWorldsEnum,
                }),
            ],
            helpString: 'Remove a world from the registry (does not delete files)',
            returns: 'Status message about the deregistration',
        }));
        
        // Register background restore command
        context.SlashCommandParser.addCommandObject(SlashCommand.fromProps({
            name: 'rpg-exit',
            callback: rpgExitCommand,
            unnamedArgumentList: [],
            helpString: 'Exit RPG mode and restore the previously saved background',
            returns: 'Status message about exiting RPG mode',
        }));
        
        // Register flavor text command
        context.SlashCommandParser.addCommandObject(SlashCommand.fromProps({
            name: 'describe',
            callback: describeCommand,
            unnamedArgumentList: [
                SlashCommandArgument.fromProps({
                    description: 'what you want the Game Master to describe',
                    typeList: [ARGUMENT_TYPE.STRING],
                    isRequired: false,
                }),
            ],
            helpString: 'Ask the Game Master to describe the current scene or a specific scenario',
            returns: 'Flavor text request sent to Game Master',
        }));
        
        // Register time system commands
        context.SlashCommandParser.addCommandObject(SlashCommand.fromProps({
            name: 'rpg-wait',
            callback: waitCommand,
            unnamedArgumentList: [],
            helpString: 'Wait and advance time to the next period (Morning → Day → Evening → Night → Morning)',
            returns: 'Status message about time advancement',
        }));
        
        context.SlashCommandParser.addCommandObject(SlashCommand.fromProps({
            name: 'date',
            callback: dateCommand,
            unnamedArgumentList: [],
            helpString: 'Show the current day and time of day',
            returns: 'Current date and time information',
        }));
        
        // Register RPG character creation command
        context.SlashCommandParser.addCommandObject(SlashCommand.fromProps({
            name: 'rpg-create-character',
            callback: createRPGCharacterCommand,
            unnamedArgumentList: [],
            helpString: 'Create a new RPG character using extended persona system',
            returns: 'Status message about character creation',
        }));
        
        // Register RPG character info command
        context.SlashCommandParser.addCommandObject(SlashCommand.fromProps({
            name: 'rpg-character-info',
            callback: showRPGCharacterInfoCommand,
            unnamedArgumentList: [
                SlashCommandArgument.fromProps({
                    description: 'persona to show info for (optional, defaults to current persona)',
                    typeList: [ARGUMENT_TYPE.STRING],
                    isRequired: true,
                    enumProvider: getRPGPersonasEnum,
                }),
            ],
            helpString: 'Show RPG character information and stats',
            returns: 'Character information display',
        }));
        
        console.log('RPG Custodian: Slash commands registered');
    }

    // Slash command callback functions
    async function createRPGCharacterCommand() {
        try {
            
            // Generate a unique avatar ID (timestamp-based like SillyTavern does)
            const avatarId = `rpg_character_${Date.now()}.png`;
            
            // Create the avatar file first by uploading the default avatar with our filename
            console.log('RPG Custodian: Creating avatar file for:', avatarId);
            try {
                // Use the correct default avatar image path
                const defaultAvatarUrl = '/img/user-default.png';
                
                // This uploads the default avatar as a new avatar file with our unique name
                const fetchResult = await fetch(defaultAvatarUrl);
                const blob = await fetchResult.blob();
                const file = new File([blob], 'avatar.png', { type: 'image/png' });
                const formData = new FormData();
                formData.append('avatar', file);
                formData.append('overwrite_name', avatarId);
                
                const uploadResponse = await fetch('/api/avatars/upload', {
                    method: 'POST',
                    headers: context.getRequestHeaders({ omitContentType: true }),
                    cache: 'no-cache',
                    body: formData,
                });
                
                if (uploadResponse.ok) {
                    console.log('RPG Custodian: Avatar file created successfully');
                    const uploadData = await uploadResponse.json();
                    console.log('RPG Custodian: Upload response:', uploadData);
                } else {
                    const errorText = await uploadResponse.text();
                    console.error('RPG Custodian: Upload failed with status:', uploadResponse.status);
                    console.error('RPG Custodian: Upload error response:', errorText);
                    throw new Error(`Avatar upload failed: ${uploadResponse.status} - ${errorText}`);
                }
            } catch (error) {
                console.error('RPG Custodian: Failed to create avatar file:', error);
                return `❌ Failed to create avatar file: ${error.message}`;
            }
            
            // Create the RPG persona
            const createdId = await createRPGPersona(avatarId);
            
            if (createdId) {
                return `✅ RPG character created successfully! Avatar ID: ${createdId}`;
            } else {
                return `❌ Character creation cancelled or failed.`;
            }
        } catch (error) {
            console.error('RPG Custodian: Error creating RPG character:', error);
            return `❌ Error creating RPG character: ${error.message}`;
        }
    }

    /**
     * Helper function to resolve persona name to avatar ID
     * Prioritizes persona name input, falls back to avatar ID for compatibility
     */
    function resolvePersonaToAvatarId(input) {
        if (!input) return null;
        
        const trimmedInput = String(input).trim();
        
        // First, search by persona name (primary use case)
        for (const [avatarId, personaName] of Object.entries(context.powerUserSettings.personas)) {
            if (personaName.toLowerCase() === trimmedInput.toLowerCase()) {
                return avatarId;
            }
        }
        
        // Fallback: check if it's an avatar ID (for backward compatibility)
        if (context.powerUserSettings.personas[trimmedInput]) {
            return trimmedInput;
        }
        
        return null;
    }

    async function showRPGCharacterInfoCommand(args, value) {
        try {
            // Determine which persona to show info for
            let targetPersona;
            if (value) {
                targetPersona = resolvePersonaToAvatarId(value);
                if (!targetPersona) {
                    sendGhostMessage('❌ Specified persona not found. Use autocomplete to see available RPG characters.');
                    return '';
                }
            } else {
                targetPersona = user_avatar;
            }
            
            if (!targetPersona) {
                sendGhostMessage('❌ No persona specified and no persona currently selected.');
                return '';
            }
            
            const personaName = context.powerUserSettings.personas[targetPersona];
            if (!personaName) {
                sendGhostMessage('❌ Specified persona not found.');
                return '';
            }
            
            const personaDesc = context.powerUserSettings.persona_descriptions[targetPersona];
            const rpgData = personaDesc?.rpg_data;
            
            if (!rpgData) {
                sendGhostMessage(`❌ Persona "${personaName}" is not an RPG character. Use /rpg-create-character to create an RPG character.`);
                return '';
            }
            
            // Send character information as multiple ghost messages
            const stats = rpgData.stats;
            const metadata = rpgData.metadata;
            const worldState = rpgData.world_state;
            const inventory = rpgData.inventory;
            const progression = rpgData.progression;
            
            // Message 1: Character Header
            sendGhostMessage(`**RPG Character: ${personaName}**
Class: ${metadata.character_class}
Background: ${metadata.background}`);
            
            // Message 2: Description
            if (personaDesc.description && personaDesc.description.trim()) {
                sendGhostMessage(`**Description**
${personaDesc.description.trim()}`);
            }
            
            // Message 3: Core Stats (four-stat schema with legacy fallback)
            if (stats.ruggedness !== undefined) {
                sendGhostMessage(`**Core Stats**
Level: ${stats.level} | XP: ${stats.experience} | ⭐ Power Tokens: ${stats.power_tokens ?? 0}
Stamina: ${stats.stamina}/${stats.ruggedness} | Mana: ${stats.mana}/${stats.craftiness}`);

                const line = (label, key) => { const eff = effectiveStat(key); return `${label}: ${stats[key]}${eff !== stats[key] ? ` → ${eff}` : ''}`; };
                sendGhostMessage(`**Attributes**
💪 ${line('Ruggedness', 'ruggedness')}
😏 ${line('Charm', 'charm')}
🦊 ${line('Craftiness', 'craftiness')}
🔥 ${line('Virility', 'virility')}`);
                const sheetFx = playerCustomEffects();
                if (sheetFx.length) {
                    sendGhostMessage(`**Active Effects** ✨\n` + sheetFx
                        .map(e => `• ${effectIcon(e)} ${e.name}${statusModString(e.mods)}${statusEndsLabel(e) ? ` — ${statusEndsLabel(e)}` : ''}`)
                        .join('\n'));
                }
            } else {
                // Legacy v1.0 character
                sendGhostMessage(`**Core Stats (legacy)**
Level: ${stats.level} | XP: ${stats.experience}
Health: ${stats.health} | Mana: ${stats.mana}
STR ${stats.strength} / DEX ${stats.dexterity} / INT ${stats.intelligence} / CHA ${stats.charisma}`);
            }
            
            // Message 5: World State (if available)
            if (worldState.current_location || (worldState.visited_locations && worldState.visited_locations.length > 0)) {
                let worldMessage = '**World State**\n';
                if (worldState.current_location) {
                    worldMessage += `Current Location: ${worldState.current_location}\n`;
                }
                if (worldState.visited_locations && worldState.visited_locations.length > 0) {
                    worldMessage += `Visited Locations: ${worldState.visited_locations.join(', ')}`;
                }
                sendGhostMessage(worldMessage.trim());
            }
            
            // Message 6: Inventory & Progression
            if (inventory.currency > 0 || (inventory.items && inventory.items.length > 0) || 
                (progression.quests_completed && progression.quests_completed.length > 0)) {
                let progressMessage = '**Inventory & Progression**\n';
                if (inventory.currency > 0) {
                    progressMessage += `Currency: ${inventory.currency}\n`;
                }
                if (inventory.items && inventory.items.length > 0) {
                    progressMessage += `Items: ${inventory.items.join(', ')}\n`;
                }
                if (progression.quests_completed && progression.quests_completed.length > 0) {
                    progressMessage += `Quests Completed: ${progression.quests_completed.length}`;
                }
                sendGhostMessage(progressMessage.trim());
            }
            
            // Message 7: Metadata
            let metaMessage = '**Character Info**\n';
            metaMessage += `Created: ${new Date(rpgData.created_at).toLocaleDateString()}`;
            if (metadata.notes) {
                metaMessage += `\nNotes: ${metadata.notes}`;
            }
            sendGhostMessage(metaMessage);
            
            return '';
            
        } catch (error) {
            console.error('RPG Custodian: Error showing character info:', error);
            sendGhostMessage(`❌ Error displaying character information: ${error.message}`);
            return '';
        }
    }

    /**
     * Get available worlds for autocomplete
     */
    function getAvailableWorldsEnum() {
        // Return cached worlds discovered during initialization
        if (availableWorldsCache.length === 0) {
            // Fallback if cache is empty
            return [new SlashCommandEnumValue('prototype-town', 'Mountain Town Prototype - Default world', enumTypes.enum, '🗺️')];
        }
        
        return availableWorldsCache.map(world => 
            new SlashCommandEnumValue(world.name, world.description, enumTypes.enum, world.emoji)
        );
    }

    /**
     * Get available RPG personas for autocomplete
     */
    function getRPGPersonasEnum() {
        const rpgPersonas = [];
        
        if (!context.powerUserSettings.personas || !context.powerUserSettings.persona_descriptions) {
            return rpgPersonas;
        }
        
        // Iterate through all personas and find ones with RPG data
        for (const [avatarId, personaName] of Object.entries(context.powerUserSettings.personas)) {
            const personaDesc = context.powerUserSettings.persona_descriptions[avatarId];
            
            // Only include personas that have RPG data
            if (personaDesc && personaDesc.rpg_data) {
                const characterClass = personaDesc.rpg_data.metadata?.character_class || 'Unknown Class';
                const level = personaDesc.rpg_data.stats?.level || 1;
                
                rpgPersonas.push(new SlashCommandEnumValue(
                    personaName,  // Use persona name as value instead of avatar ID
                    `${personaName} (${characterClass}, Level ${level})`,
                    enumTypes.enum,
                    ''
                ));
            }
        }
        
        return rpgPersonas;
    }

    /**
     * Get registered worlds for deregister command autocomplete
     */
    function getRegisteredWorldsEnum() {
        const registry = getWorldRegistry();
        return registry.map(worldName => 
            new SlashCommandEnumValue(worldName, `Deregister ${worldName}`, enumTypes.enum, '🗑️')
        );
    }

    /**
     * Get connected locations for move command autocomplete
     */
    function getConnectedLocationsEnum() {
        if (!currentGameState.isActive || !currentGameState.worldData || !currentGameState.currentLocation) {
            return [new SlashCommandEnumValue('', 'No active RPG session', enumTypes.enum, '❌')];
        }
        
        const currentLocationData = currentGameState.worldData.locations[currentGameState.currentLocation];
        if (!currentLocationData || !currentLocationData.connections) {
            return [new SlashCommandEnumValue('', 'No connections available', enumTypes.enum, '❌')];
        }
        
        return currentLocationData.connections.map(connectionKey => {
            const connectionData = currentGameState.worldData.locations[connectionKey];
            const description = connectionData ? connectionData.name : connectionKey;
            return new SlashCommandEnumValue(connectionKey, description, enumTypes.enum, '🚪');
        });
    }

    /**
     * Handle /rpg-register-world command
     */
    async function registerWorldCommand(args, value) {
        try {
            const worldName = value.trim();
            
            if (!worldName) {
                sendGhostMessage('❌ Usage: /rpg-register-world <world-name>\nExample: /rpg-register-world my-custom-world');
                return;
            }
            
            // Check if world file exists
            const worldPath = `scripts/extensions/third-party/rpg-custodian/game-worlds/fresh-worlds/${worldName}/${worldName}.json`;
            const response = await fetch(worldPath);
            
            if (!response.ok) {
                sendGhostMessage(`❌ World "${worldName}" not found. Make sure the file exists at:\n${worldPath}`);
                return;
            }
            
            // Validate world file format
            try {
                const worldData = await response.json();
                if (!worldData.worldId || !worldData.locations || !worldData.startingLocation) {
                    sendGhostMessage(`❌ World "${worldName}" has invalid format. Missing required fields: worldId, locations, or startingLocation.`);
                    return;
                }
            } catch (error) {
                sendGhostMessage(`❌ World "${worldName}" contains invalid JSON: ${error.message}`);
                return;
            }
            
            // Add to registry if not already there
            const registry = getWorldRegistry();
            if (registry.includes(worldName)) {
                sendGhostMessage(`⚠️ World "${worldName}" is already registered.`);
                return;
            }
            
            registry.push(worldName);
            saveWorldRegistry(registry);
            
            // Reload world cache
            await loadRegisteredWorlds();
            
            sendGhostMessage(`✅ World "${worldName}" registered successfully! It will now appear in /rpg-start autocomplete.`);
            console.log(`RPG Custodian: Registered world "${worldName}"`);
            
        } catch (error) {
            console.error('RPG Custodian: Error in /rpg-register-world command:', error);
            sendGhostMessage('❌ Error registering world. Check console for details.');
        }
        
        return ''; // Slash commands must return a string
    }

    /**
     * Handle /rpg-deregister-world command
     */
    async function deregisterWorldCommand(args, value) {
        try {
            const worldName = value.trim();
            
            if (!worldName) {
                sendGhostMessage('❌ Usage: /rpg-deregister-world <world-name>\nUse autocomplete to see registered worlds.');
                return;
            }
            
            const registry = getWorldRegistry();
            if (!registry.includes(worldName)) {
                sendGhostMessage(`❌ World "${worldName}" is not registered.`);
                return;
            }
            
            // Remove from registry
            const newRegistry = registry.filter(w => w !== worldName);
            saveWorldRegistry(newRegistry);
            
            // Reload world cache
            await loadRegisteredWorlds();
            
            sendGhostMessage(`✅ World "${worldName}" deregistered successfully. (Files were not deleted)`);
            console.log(`RPG Custodian: Deregistered world "${worldName}"`);
            
        } catch (error) {
            console.error('RPG Custodian: Error in /rpg-deregister-world command:', error);
            sendGhostMessage('❌ Error deregistering world. Check console for details.');
        }
    }

    /**
     * Handle /rpg-start command
     */
    async function rpgStartCommand(args, value) {
        try {
            const worldName = value.trim();
            
            if (!worldName) {
                sendGhostMessage('❌ Usage: /rpg-start <world-name>\nExample: /rpg-start prototype-town');
                return '';
            }
            
            // Validate we're in a Game Master solo chat
            if (!isInRpgSession()) {
                sendGhostMessage('❌ Error: /rpg-start can only be used inside an active RPG session.');
                return '';
            }
            
            // Load the world
            await startRpgSession(worldName);
            
        } catch (error) {
            console.error('RPG Custodian: Error in /rpg-start command:', error);
            sendGhostMessage('❌ Error starting RPG session. Check console for details.');
        }
        
        return ''; // Slash commands must return a string
    }

    /**
     * Handle /rpg-exit command
     */
    async function rpgExitCommand(args, value) {
        try {
            // Deactivate game state
            currentGameState.worldData = null;
            currentGameState.currentLocation = null;
            currentGameState.isActive = false;
            currentGameState.groupId = null;
            currentGameState.currentTime = 0;
            currentGameState.dayCount = 1;
            $('#rpg-action-bar').remove();
            $('#rpg-action-popup').remove();
            projectPlayerStatus();  // clears the injected status block
            
            // Update time display back to RPG button
            updateTimeDisplay();
            
            // Restore the saved background
            await restoreSavedBackground();
            sendGhostMessage('✅ RPG mode exited. Background restored to previous setting.');
            console.log('RPG Custodian: RPG mode exited, background restored');
            
        } catch (error) {
            console.error('RPG Custodian: Error in /rpg-exit command:', error);
            sendGhostMessage('❌ Error exiting RPG mode. Check console for details.');
        }
        
        return ''; // Slash commands must return a string
    }

    /**
     * Handle /move command
     */
    async function moveCommand(args, value) {
        try {
            const targetLocation = value.trim();
            
            if (!targetLocation) {
                sendGhostMessage('❌ Usage: /move <location>\nUse autocomplete to see available locations.');
                return '';
            }
            
            // Check if RPG session is active
            if (!currentGameState.isActive) {
                sendGhostMessage('❌ No active RPG session. Start a game with /rpg-start <world-name> first.');
                return '';
            }
            
            // Validate we're in a Game Master chat
            if (!isInRpgSession()) {
                sendGhostMessage('❌ Error: /move can only be used inside an active RPG session.');
                return '';
            }
            
            // Check if target location exists and is connected
            const currentLocationData = currentGameState.worldData.locations[currentGameState.currentLocation];
            if (!currentLocationData.connections.includes(targetLocation)) {
                sendGhostMessage(`❌ Cannot move to "${targetLocation}". Not connected to current location.`);
                return '';
            }
            
            const targetLocationData = currentGameState.worldData.locations[targetLocation];
            if (!targetLocationData) {
                sendGhostMessage(`❌ Location "${targetLocation}" not found in world data.`);
                return '';
            }
            
            // Move to the new location
            currentGameState.currentLocation = targetLocation;
            
            // Update RPG character data if current persona has RPG data
            const rpgData = getCurrentRPGData();
            if (rpgData) {
                updateCurrentRPGData({
                    world_state: {
                        current_location: targetLocation,
                        visited_locations: [...(rpgData.world_state.visited_locations || []), targetLocation].filter((v, i, a) => a.indexOf(v) === i) // Remove duplicates
                    }
                });
                console.log(`RPG Custodian: Updated character location to "${targetLocation}"`);
            }
            
            // Change background to new location
            await setBackground(targetLocationData.background);

            // Update NPC presence for the new location (mute/un-mute members)
            await syncPresence();

            // Send movement message
            sendGameMasterMessage(`🚶 **You traveled to: ${targetLocationData.name}**\n\n${targetLocationData.description}${presenceLine(targetLocation)}`);

            saveCurrentState();
            console.log(`RPG Custodian: Moved to location "${targetLocation}"`);
            
        } catch (error) {
            console.error('RPG Custodian: Error in /move command:', error);
            sendGhostMessage('❌ Error moving to location. Check console for details.');
        }
        
        return '';
    }

    /**
     * Handle /look command
     */
    async function lookCommand(args, value) {
        try {
            const target = value?.trim() || '';
            
            // Check if RPG session is active
            if (!currentGameState.isActive) {
                sendGhostMessage('❌ No active RPG session. Start a game with /rpg-start <world-name> first.');
                return '';
            }
            
            // Validate we're in a Game Master chat
            if (!isInRpgSession()) {
                sendGhostMessage('❌ Error: /look can only be used inside an active RPG session.');
                return '';
            }
            
            // If no target specified, look at current location
            if (!target) {
                const currentLocationData = currentGameState.worldData.locations[currentGameState.currentLocation];
                
                let exitsList = '';
                if (currentLocationData.connections && currentLocationData.connections.length > 0) {
                    const exitNames = currentLocationData.connections.map(connectionKey => {
                        const connectionData = currentGameState.worldData.locations[connectionKey];
                        return connectionData ? connectionData.name : connectionKey;
                    });
                    exitsList = `\n\n**Available exits:** ${exitNames.join(', ')}`;
                }
                
                sendGameMasterMessage(`👀 **${currentLocationData.name}**\n\n${currentLocationData.description}${presenceLine(currentGameState.currentLocation)}${exitsList}`);
            } else {
                // TODO: Implement looking at specific targets (NPCs, objects, etc.)
                // For now, just acknowledge the attempt
                sendGhostMessage(`❌ Looking at specific targets not implemented yet. Try /look without arguments to examine your current location.`);
            }
            
        } catch (error) {
            console.error('RPG Custodian: Error in /look command:', error);
            sendGhostMessage('❌ Error looking around. Check console for details.');
        }
        
        return '';
    }

    /**
     * Handle /describe command
     */
    async function describeCommand(args, value) {
        try {
            const scenario = value?.trim() || 'the current scene';
            
            // Check if RPG session is active
            if (!currentGameState.isActive) {
                sendGhostMessage('❌ No active RPG session. Start a game with /rpg-start <world-name> first.');
                return '';
            }
            
            // Validate we're in a Game Master chat
            if (!isInRpgSession()) {
                sendGhostMessage('❌ Error: /describe can only be used inside an active RPG session.');
                return '';
            }
            
            // Get current location for context
            const currentLocationData = currentGameState.worldData.locations[currentGameState.currentLocation];
            
            // Request flavor text from Game Master
            await requestFlavorText(scenario, currentLocationData);
            
            console.log(`RPG Custodian: Requested description of: ${scenario}`);
            
        } catch (error) {
            console.error('RPG Custodian: Error in /describe command:', error);
            sendGhostMessage('❌ Error requesting description. Check console for details.');
        }
        
        return '';
    }

    /**
     * Advance time to the next period and handle day transitions
     */
    function advanceTime(quiet = false) {
        if (!currentGameState.isActive) {
            console.warn('RPG Custodian: Cannot advance time - no active game session');
            return null;
        }

        const previousTime = TIME_PERIODS[currentGameState.currentTime];
        currentGameState.currentTime = (currentGameState.currentTime + 1) % 4;
        currentGameState.timeStep = (currentGameState.timeStep || 0) + 1;

        // If we wrapped from Night back to Morning, advance the day count.
        // (Stamina is NOT restored passively — only an explicit rest recovers it.)
        const newDay = currentGameState.currentTime === 0;
        if (newDay) {
            currentGameState.dayCount += 1;
        }

        // Expire timed effects, and grow every active pregnancy. `quiet` suppresses
        // per-step notifications during a multi-step skip (advanceTimeBy summarizes).
        pruneCurses(quiet);          // timed curses expire
        pruneCustomStatuses(quiet);  // timed status effects run their course
        advancePregnancies(quiet);
        hatchEggs(quiet);            // laid eggs hatch a couple days on
        recoverUnconscious(quiet);   // KO'd NPCs wake on their own once they've slept it off

        const newTime = TIME_PERIODS[currentGameState.currentTime];
        
        // Update the time display
        updateTimeDisplay();
        
        // TODO: Update save file with new time
        
        console.log(`RPG Custodian: Time advanced to ${newTime.name} (${currentGameState.currentTime}), Day ${currentGameState.dayCount}`);
        
        return {
            previousTime,
            newTime,
            newDay,
            dayCount: currentGameState.dayCount
        };
    }

    /**
     * Handle /rpg-wait command
     */
    async function waitCommand(args, value) {
        try {
            // Check if RPG session is active
            if (!currentGameState.isActive) {
                sendGhostMessage('❌ No active RPG session. Start a game with /rpg-start <world-name> first.');
                return '';
            }
            
            // Validate we're in a Game Master chat
            if (!isInRpgSession()) {
                sendGhostMessage('❌ Error: /rpg-wait can only be used inside an active RPG session.');
                return '';
            }
            
            // Advance time
            const timeResult = advanceTime();
            if (!timeResult) {
                sendGhostMessage('❌ Error advancing time.');
                return '';
            }

            // NPC schedules shift with the clock — re-apply presence muting
            await syncPresence();
            markPresentSeen();   // time passed IN PLACE — anyone still here was with you

            // Send time advancement message
            let timeMessage = `⏰ **Time passes...** ${timeResult.previousTime.emoji} → ${timeResult.newTime.emoji}\n\nIt is now **${timeResult.newTime.name}**.`;

            if (timeResult.newDay) {
                timeMessage += `\n\n🗓️ **A new day has begun!** (Day ${timeResult.dayCount})`;
            }

            // NPC schedules shift with the clock — report who is around now
            timeMessage += presenceLine(currentGameState.currentLocation);

            sendGameMasterMessage(timeMessage);
            saveCurrentState();
            
        } catch (error) {
            console.error('RPG Custodian: Error in /rpg-wait command:', error);
            sendGhostMessage('❌ Error advancing time. Check console for details.');
        }
        
        return '';
    }

    /**
     * Handle /date command
     */
    async function dateCommand(args, value) {
        try {
            // Check if RPG session is active
            if (!currentGameState.isActive) {
                sendGhostMessage('❌ No active RPG session. Start a game with /rpg-start <world-name> first.');
                return '';
            }
            
            // Validate we're in a Game Master chat
            if (!isInRpgSession()) {
                sendGhostMessage('❌ Error: /date can only be used inside an active RPG session.');
                return '';
            }
            
            const currentTime = TIME_PERIODS[currentGameState.currentTime];
            const dateMessage = `📅 **Current Date & Time**\n\n🗓️ **Day ${currentGameState.dayCount}**\n${currentTime.emoji} **${currentTime.name}**`;
            
            sendGameMasterMessage(dateMessage);
            
            console.log(`RPG Custodian: Current date - Day ${currentGameState.dayCount}, ${currentTime.name}`);
            
        } catch (error) {
            console.error('RPG Custodian: Error in /date command:', error);
            sendGhostMessage('❌ Error showing date. Check console for details.');
        }
        
        return '';
    }

    /**
     * Update the time display button
     */
    function updateTimeDisplay() {
        const button = $('#rpg-menu-button');
        if (button.length === 0) return;
        
        if (currentGameState.isActive) {
            const currentTime = TIME_PERIODS[currentGameState.currentTime];
            button.text(currentTime.emoji);
            button.attr('title', `${currentTime.name} - Day ${currentGameState.dayCount}`);
        } else {
            button.text('RPG');
            button.attr('title', 'rpg-menu');
        }
    }

    /**
     * Send a ghost message (hidden from AI context)
     */
    function sendGhostMessage(text) {
        const message = {
            name: 'RPG Custodian',
            is_system: true,
            is_user: false,
            send_date: getMessageTimeStamp(),
            mes: text,
            extra: {
                isSmallSys: true
            }
        };

        const ctx = getCtx();
        ctx.chat.push(message);
        ctx.addOneMessage(message);
    }

    /**
     * Send a Game Master narration message (visible to AI)
     */
    function sendGameMasterMessage(text) {
        const message = {
            name: 'Game Master',
            is_user: false,
            send_date: getMessageTimeStamp(),
            mes: text
        };

        const ctx = getCtx();
        ctx.chat.push(message);
        ctx.addOneMessage(message);
    }

    /**
     * Request flavor text from Game Master for a specific scenario
     * This triggers actual LLM generation for atmospheric description
     */
    async function requestFlavorText(scenario, location = null) {
        try {
            const locationContext = location ? ` at ${location.name}` : '';
            const flavorPrompt = `Describe the scene: ${scenario}${locationContext}. Provide atmospheric flavor text for this moment.`;
            
            console.log(`RPG Custodian: Requesting flavor text for: ${scenario}`);
            
            // Use generateQuietPrompt to actually trigger LLM generation
            const response = await generateQuietPrompt({
                quietPrompt: flavorPrompt,
                quietToLoud: false // Keep it quiet, we'll manually add to chat
            });
            
            console.log(`RPG Custodian: Generated flavor text: ${response}`);
            
            // Manually add the response to chat as a Game Master message
            if (response && response.trim()) {
                sendGameMasterMessage(response);
            }
            
        } catch (error) {
            console.error('RPG Custodian: Error requesting flavor text:', error);
            sendGhostMessage('❌ Error generating flavor text. Check console for details.');
        }
    }

    /**
     * Send a silent system message that won't trigger AI response
     * Use this for game mechanics messages that shouldn't prompt narration
     */
    function sendSilentSystemMessage(text) {
        const message = {
            name: 'RPG System',
            is_system: true,
            is_user: false,
            send_date: getMessageTimeStamp(),
            mes: text,
            extra: {
                isSmallSys: true,
                api: 'manual', // Prevents AI from seeing this as a prompt
                quiet: true    // Additional flag to suppress response
            }
        };

        const ctx = getCtx();
        ctx.chat.push(message);
        ctx.addOneMessage(message);
    }

    /**
     * Check if we're in a solo chat with Game Master
     */
    function isInGameMasterChat() {
        try {
            // Check if we're in a group chat
            if (context.groupId !== null && context.groupId !== undefined) {
                return false;
            }
            
            // Get the current character ID
            if (this_chid === null || this_chid === undefined) {
                return false;
            }
            
            // Get the current character
            const currentChar = context.characters[this_chid];
            if (!currentChar) {
                return false;
            }
            
            return currentChar.avatar === 'Game Master.png';
            
        } catch (error) {
            console.error('RPG Custodian: Error in isInGameMasterChat:', error);
            return false;
        }
    }

    /**
     * Start an RPG session with the specified world
     */
    async function startRpgSession(worldName) {
        try {
            // Load world data
            const worldPath = `scripts/extensions/third-party/rpg-custodian/game-worlds/fresh-worlds/${worldName}/${worldName}.json`;
            const response = await fetch(worldPath);
            
            if (!response.ok) {
                sendGhostMessage(`❌ Error: World "${worldName}" not found. Check that the world file exists.`);
                return;
            }
            
            const worldData = await response.json();
            const startingLocation = worldData.locations[worldData.startingLocation];

            if (!startingLocation) {
                sendGhostMessage(`❌ Error: Starting location "${worldData.startingLocation}" not found in world "${worldName}".`);
                return;
            }

            // Initialize game state (fresh game starts at Morning, Day 1)
            currentGameState.worldData = worldData;
            currentGameState.currentTime = 0;
            currentGameState.dayCount = 1;
            currentGameState.party = [];
            currentGameState.offspring = [];
            currentGameState.timeStep = 0;

            // Check if current persona has RPG data with a saved location
            const rpgData = getCurrentRPGData();
            if (rpgData?.world_state?.current_location && worldData.locations[rpgData.world_state.current_location]) {
                currentGameState.currentLocation = rpgData.world_state.current_location;
                console.log(`RPG Custodian: Loaded character location "${currentGameState.currentLocation}" from RPG data`);
            } else {
                currentGameState.currentLocation = worldData.startingLocation;
            }

            // Make sure the world's NPC cast exists and build the presence roster
            await ensureCastExists(worldData);

            // Open (creating if needed) the RPG group chat: GM + full cast
            const groupPreexisted = Boolean(findRpgGroup(worldData));
            const groupId = await openRpgGroup(worldData);
            if (!groupId) {
                sendGhostMessage('❌ Could not open the RPG group chat. Check console.');
                return;
            }
            currentGameState.groupId = groupId;
            currentGameState.isActive = true;

            // Make sure the player persona has an rpg_data block (stats/gold/inventory)
            getPlayerRpgData();

            // Every new game plays in its own chat file — the previous
            // playthrough's log stays intact in the group's past chats. (The
            // old clearChat() here only wiped the DOM; the stale log came back
            // on reload.) A just-created group already starts on a fresh chat.
            if (groupPreexisted) {
                await createNewGroupChat(groupId);
            }
            await syncPresence();
            projectPlayerStatus();

            // Update time display
            updateTimeDisplay();

            // Set background to starting location
            await setBackground(startingLocation.background);

            // Send game start message and persist it into the new chat file
            // (nothing else saves the chat until the first generation)
            sendGameMasterMessage(`🎲 **New Game Started: ${worldData.name}**\n\n${worldData.description}\n\n📍 **${startingLocation.name}**\n${startingLocation.description}${presenceLine(currentGameState.currentLocation)}`);
            await getCtx().saveChat();

            // Create/update save file
            saveCurrentState();

            console.log(`RPG Custodian: Started new game with world "${worldName}" at location "${worldData.startingLocation}"`);
            
        } catch (error) {
            console.error('RPG Custodian: Error starting RPG session:', error);
            sendGhostMessage(`❌ Error loading world "${worldName}". Check console for details.`);
        }
    }

    /**
     * Set the chat background image using SillyTavern's background system
     */
    async function setBackground(backgroundFileName) {
        try {
            console.log(`RPG Custodian: Setting background to ${backgroundFileName}`);
            
            // Use SillyTavern's background system - backgrounds are stored in backgrounds/ folder
            // Generate the proper URL format that SillyTavern expects
            const backgroundUrl = `url("backgrounds/${encodeURIComponent(backgroundFileName)}")`;
            
            // Set the background using jQuery (same way SillyTavern does it)
            $('#bg1').css('background-image', backgroundUrl);
            
            // Update SillyTavern's background settings
            background_settings.name = backgroundFileName;
            background_settings.url = backgroundUrl;
            
            // Save settings to persist the change
            context.saveSettingsDebounced();
            
            console.log(`RPG Custodian: Background set to ${backgroundFileName}`);
            
        } catch (error) {
            console.error('RPG Custodian: Error setting background:', error);
        }
    }

    /**
     * True if a live character card still carries a greeting (first_mes or any
     * alternate). RPG cards must not — see createCharacterFromCardData.
     */
    function cardHasGreeting(char) {
        return Boolean(
            char?.first_mes ||
            char?.data?.first_mes ||
            (char?.data?.alternate_greetings || []).some(g => g),
        );
    }

    /**
     * Ensure Game Master character exists, create from template if not.
     * Recreates it if the live card predates the no-greetings rule.
     */
    async function ensureGameMasterExists() {
        try {
            const gameMaster = context.characters.find(char =>
                char.avatar === 'Game Master.png'
            );

            if (gameMaster && !cardHasGreeting(gameMaster)) {
                console.log('RPG Custodian: Game Master character already exists');
                return;
            }

            console.log(gameMaster
                ? 'RPG Custodian: Game Master card has a greeting, recreating without it...'
                : 'RPG Custodian: Game Master not found, creating from template...');
            await createGameMasterFromTemplate();

        } catch (error) {
            console.error('RPG Custodian: Error ensuring Game Master exists:', error);
        }
    }

    /**
     * Create Game Master character from template
     */
    async function createGameMasterFromTemplate() {
        try {
            // Load the template
            const templatePath = 'scripts/extensions/third-party/rpg-custodian/templates/Game Master.json';
            const response = await fetch(templatePath);
            
            if (!response.ok) {
                throw new Error(`Failed to load template: ${response.status}`);
            }
            
            const templateData = await response.json();
            await createCharacterFromCardData(templateData, 'Game Master');
            console.log('RPG Custodian: Game Master character created successfully');
        } catch (error) {
            console.error('RPG Custodian: Error creating Game Master from template:', error);
        }
    }

    /**
     * Create a SillyTavern character from V2/V3 card JSON data.
     * Shared by Game Master bootstrap and world cast auto-creation.
     */
    async function createCharacterFromCardData(cardData, fileName) {
        try {
            // Use the data object from the card (V2/V3 format)
            const charData = cardData.data || cardData;

            // Create FormData for character creation (following SillyTavern's API)
            const formData = new FormData();
            formData.append('ch_name', charData.name || fileName);
            formData.append('file_name', fileName);
            formData.append('description', charData.description || '');
            formData.append('personality', charData.personality || '');
            formData.append('scenario', charData.scenario || '');
            // Greetings are a vanilla-ST feature the engine never uses — and a
            // fresh group chat auto-seeds every member's non-empty first_mes,
            // spamming a New Game with canned intros. RPG cards are therefore
            // always created greeting-less, whatever the source card says.
            formData.append('first_mes', '');
            formData.append('mes_example', charData.mes_example || '');
            formData.append('creator_notes', charData.creator_notes || '');
            formData.append('system_prompt', charData.system_prompt || '');
            formData.append('post_history_instructions', charData.post_history_instructions || '');
            formData.append('creator', charData.creator || '');
            formData.append('character_version', charData.character_version || '');
            
            // Handle tags
            if (charData.tags && charData.tags.length > 0) {
                formData.append('tags', charData.tags.join(','));
            }
            
            // Add extensions data
            if (charData.extensions) {
                formData.append('extensions', JSON.stringify(charData.extensions));
            }
            
            // Create character using SillyTavern's API with proper headers
            const saveResponse = await fetch('/api/characters/create', {
                method: 'POST',
                headers: context.getRequestHeaders({ omitContentType: true }),
                body: formData
            });
            
            if (!saveResponse.ok) {
                throw new Error(`Failed to create character: ${saveResponse.status}`);
            }
            
            // Refresh the characters list to get the newly created character
            await context.getCharacters();

            console.log(`RPG Custodian: Character "${fileName}" created successfully`);

        } catch (error) {
            console.error(`RPG Custodian: Error creating character "${fileName}":`, error);
            throw error;
        }
    }

    /**
     * Ensure the world's cast of NPCs exists as SillyTavern characters,
     * creating any missing ones from the card JSONs shipped with the world.
     * Also builds the in-memory NPC roster (schedules) for presence tracking.
     */
    async function ensureCastExists(worldData) {
        const roster = [];
        const castNames = worldData.cast || [];

        for (const castName of castNames) {
            try {
                const cardPath = `scripts/extensions/third-party/rpg-custodian/game-worlds/fresh-worlds/${worldData.worldId}/characters/${encodeURIComponent(castName)}.json`;
                const response = await fetch(cardPath);
                if (!response.ok) {
                    console.warn(`RPG Custodian: Cast card "${castName}" not found at ${cardPath}`);
                    continue;
                }
                const cardData = await response.json();
                const charData = cardData.data || cardData;
                const rpgMeta = charData.extensions?.rpg_custodian || {};

                roster.push({
                    name: charData.name,
                    role: rpgMeta.role || '',
                    secret: !!rpgMeta.secret,   // secret cast stay out of the common-knowledge directory
                    description: charData.description || '',
                    schedule: rpgMeta.schedule || {},
                    homeLocation: rpgMeta.home_location || null,
                    shopInventory: rpgMeta.shop_inventory || null,
                    wrestle: rpgMeta.wrestle || null,
                    fertility: rpgMeta.fertility,
                    ruggedness: rpgMeta.ruggedness,
                    race: rpgMeta.race,
                    age: rpgMeta.age,
                });

                // Create if missing, or refresh in place if the on-disk card is
                // an older version than the world ships (self-healing so New Game
                // always gives the current cast without manual deletion). A live
                // card that still carries a greeting also refreshes (greetings
                // are stripped at creation and would spam fresh group chats).
                const existing = getCtx().characters.find(char => char.avatar === `${castName}.png`);
                const liveVersion = existing?.data?.extensions?.rpg_custodian?.card_version;
                const srcVersion = rpgMeta.card_version;
                if (!existing) {
                    console.log(`RPG Custodian: Creating cast member "${castName}"...`);
                    await createCharacterFromCardData(cardData, castName);
                } else if (liveVersion !== srcVersion || cardHasGreeting(existing)) {
                    console.log(`RPG Custodian: Refreshing "${castName}" card (${liveVersion || 'none'} → ${srcVersion})`);
                    await createCharacterFromCardData(cardData, castName);
                }
            } catch (error) {
                console.error(`RPG Custodian: Failed to ensure cast member "${castName}":`, error);
            }
        }

        currentGameState.npcRoster = roster;
        console.log(`RPG Custodian: Cast ready (${roster.length} NPC(s)):`, roster.map(n => n.name).join(', '));
    }

    /**
     * Get NPCs scheduled to be at the given location for the current time period.
     */
    function getNpcsAt(locationId) {
        const roster = currentGameState.npcRoster || [];
        const period = TIME_PERIODS[currentGameState.currentTime].name;
        const party = currentGameState.party || [];
        const rels = getPlayerRpgData()?.relationships || {};   // read-only; don't create records
        return roster.filter(npc => {
            // Party members travel with you: present wherever YOU are, schedule ignored.
            if (party.includes(npc.name)) return locationId === currentGameState.currentLocation;
            // An unconscious NPC can't walk her schedule — she stays exactly where
            // she fell / was left until she wakes (see stashedAt).
            const rel = rels[npc.name];
            if (rel?.npcUnconscious && rel.stashedAt) return locationId === rel.stashedAt;
            return (npc.schedule?.[period] ?? npc.homeLocation) === locationId;
        });
    }
    function isInParty(name) { return (currentGameState.party || []).includes(name); }
    // Where an NPC's schedule places her at the current time (her "own" spot).
    function scheduledLocationFor(name) {
        const npc = (currentGameState.npcRoster || []).find(n => n.name === name);
        const period = TIME_PERIODS[currentGameState.currentTime].name;
        return npc?.schedule?.[period] ?? npc?.homeLocation ?? null;
    }

    // Decide which present NPC(s) the player is talking to, from their words —
    // reliable where the analyzer's single-guess target_npc is not (2+ present).
    function detectAddressedNpcs(text) {
        const present = getNpcsAt(currentGameState.currentLocation);
        const t = String(text || '');
        const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const named = [];
        // A name at the very start = direct address ("Bryony, …").
        for (const npc of present) if (new RegExp(`^["'*\\s]*${esc(npc.name)}\\b`, 'i').test(t)) named.push(npc.name);
        // Any present NPC named anywhere in the line.
        for (const npc of present) if (!named.includes(npc.name) && new RegExp(`\\b${esc(npc.name)}\\b`, 'i').test(t)) named.push(npc.name);
        if (named.length) return named;
        // Collective address → everyone present reacts.
        if (present.length > 1 && /\b(you (two|three|both|all|lot)|both of you|all of you|everyone|ladies|girls|the group|y'?all)\b/i.test(t)) {
            return present.map(n => n.name);
        }
        return [];
    }

    /**
     * Look at a present NPC: a mechanical stat readout PLUS a vivid appearance
     * description flavored by her current status (aroused, pregnant, KO'd, buffed).
     * Only works for NPCs in the player's current location.
     */
    async function examineNpc(npcName) {
        if (!getNpcsAt(currentGameState.currentLocation).some(n => n.name === npcName)) {
            sendGhostMessage(`❌ ${npcName} isn't here to look at.`);
            return;
        }
        const npc = (currentGameState.npcRoster || []).find(n => n.name === npcName);
        const rel = getRelationship(npcName);

        // 1) Mechanical readout
        const parts = [];
        parts.push(`💗 Disposition: **${affectionTier(rel.affection).label}** (affection ${rel.affection}/10)`);
        parts.push(`🔥 Arousal: **${arousalTier(rel.arousal).label}** (${rel.arousal || 1}/10)`);
        parts.push(`❤️ Stamina: ${rel.npcStamina ?? npcMaxStamina(npcName)}/${npcMaxStamina(npcName)}${rel.npcUnconscious ? ' — UNCONSCIOUS' : ''}`);
        if (npc?.fertility != null) parts.push(`🌱 Fertility: ${fertilityPercent(npcName)}%`);
        if (npc?.wrestle) parts.push(`🤼 Contest DC: ${npc.wrestle.difficulty}`);
        if ((rel.pregnancies || 0) > 0) parts.push(`🤰 Pregnancy: ${rel.pregnancies} carried — ${pregnancyStage(rel.pregnancy_progress) || 'newly conceived'} (${rel.pregnancy_progress || 0}%)`);
        for (const e of npcActiveEffects(npcName)) parts.push(effectLine(e));
        if (isCrystalCursed(npcName)) parts.push(`💠 **Crystal Curse** — her issue turns to soulgems (${(getRelationship(npcName).crystalCurse?.expiresStep == null) ? 'permanent until broken' : `${Math.max(0, getRelationship(npcName).crystalCurse.expiresStep - (currentGameState.timeStep || 0))} periods left`})`);
        if (isInParty(npcName)) parts.push('🧑‍🤝‍🧑 Travelling with you');
        const idLine = [npc?.role, npc?.race, npc?.age].filter(Boolean).join(', ');
        sendGhostMessage(`🔍 **${npcName}**${idLine ? ` — ${idLine}` : ''}\n${parts.join('\n')}`);

        // 2) Status-flavored appearance (LLM), grounded in her card + the live
        // scene. Think-first via generateProse: reasoning models keep their
        // thinking (headroom + strip), prefill only as rescue.
        const flavor = [];
        if (rel.npcUnconscious) flavor.push('unconscious, limp and unresponsive');
        else if ((rel.arousal || 1) >= 3) flavor.push(arousalTier(rel.arousal).band);
        const stamNow = rel.npcStamina ?? npcMaxStamina(npcName);
        if (!rel.npcUnconscious && stamNow < npcMaxStamina(npcName)) {
            flavor.push(stamNow <= npcMaxStamina(npcName) / 3 ? 'utterly spent, barely upright' : 'worn and tired');
        }
        if ((rel.pregnancies || 0) > 0) flavor.push(`${pregnancyStage(rel.pregnancy_progress)} pregnant, carrying ${rel.pregnancies}`);
        for (const e of npcActiveEffects(npcName)) flavor.push(`under the effect of ${e.name}${e.desc ? ` (${e.desc})` : ''}`);
        const t = affectionTier(rel.affection);
        // Positive framing beats negation: telling the model to "ignore her
        // usual spot" made it describe her BY CONTRAST to it. Instead we state
        // her present life as fact (road tenure) and never mention the old one.
        let tenure = '';
        if (isInParty(npcName)) {
            const onRoad = rel.partyJoinedStep != null ? (currentGameState.timeStep || 0) - rel.partyJoinedStep : 0;
            tenure = onRoad >= 4
                ? `${npcName} has been travelling at the player's side for ${elapsedPhrase(onRoad)} — the road together is her everyday life now, and this moment finds her living it.`
                : `${npcName} travels at the player's side; this journey is her life right now.`;
        }
        const sys = `You are the GAME MASTER. The player pauses to LOOK at ${npcName}. Write 4-6 sentences of rich physical description — her build, face, hair, attire, body position, posture, expression, and what she is in the middle of doing in this exact moment. The RECENT STORY below is the ground truth of the moment: her whereabouts within the scene, her position, her activity, her dress and mood all come FROM IT — read it closely and describe her exactly where the last beats of the story place her, mid-whatever the story has her doing. The stated location only names where in the world this is; the story tells you where WITHIN it she is. Make her listed current state and her feeling toward the player VISIBLE in the picture (an exhausted woman looks it; a wary one watches him back). Description only: no dialogue, no actions on her behalf, no new events. If you need to reason first, do it inside <think></think> tags; the description itself is pure prose.`;
        const prompt = `Setting: ${currentSceneLabel()}.${currentLocationDesc() ? ` ${currentLocationDesc()}` : ''}\n` +
            (tenure ? `${tenure}\n` : '') +
            `Who she is (general appearance & manner): ${npc?.description || `${npc?.role || 'a townswoman'}`}\n` +
            `Her feeling toward the player: ${t.label} (this colors how she meets his gaze).\n` +
            (flavor.length ? `Her current physical state (make this visible): ${flavor.join('; ')}.\n` : '') +
            `RECENT STORY (ground truth — her position, activity, and surroundings come from the latest beats of this):\n${recentStoryWindow()}\n\n` +
            `Describe ${npcName} now, exactly as the story's final beats find her.`;
        try {
            const desc = (await generateProse({ prompt, systemPrompt: sys, budget: 700, rescuePrefill: '👁️ ' })).replace(/^👁️\s*/, '');
            if (desc) sendGameMasterMessage(`👁️ ${desc}`);
        } catch (e) { console.error('RPG Custodian: examine failed', e); }
    }

    /**
     * Look at yourself: a full mechanical readout of the player — stats (with
     * active buff arrows), Stamina/Mana pools, gold, carried items, buffs, party.
     * The player-facing mirror of examineNpc.
     */
    function examineSelf() {
        const rd = getPlayerRpgData();
        if (!rd) { sendGhostMessage('❌ No active character to look at.'); return; }
        const s = rd.stats;
        const name = context.powerUserSettings.personas?.[playerAvatar()] || 'The adventurer';
        const arrow = (label, emoji, key) => {
            const eff = effectiveStat(key), b = customStatMod(key);
            return `${emoji} ${label}: ${s[key]}${b ? ` → ${eff} (${b >= 0 ? '+' : ''}${b} buff)` : ''}`;
        };
        const parts = [];
        parts.push(`🎚️ Level ${s.level} · XP ${s.experience} · ⭐ ${s.power_tokens ?? 0} Power Tokens`);
        parts.push(`❤️ Stamina: ${getStamina()}/${maxStamina()}${rd.stats.unconscious ? ' — UNCONSCIOUS' : ''}${customStatMod('stamina') ? ` (${customStatMod('stamina') >= 0 ? '+' : ''}${customStatMod('stamina')})` : ''}   🔮 Mana: ${s.mana}/${effectiveStat('craftiness')}`);
        parts.push(`🪙 Gold: ${getGold()}`);
        parts.push([arrow('Ruggedness', '💪', 'ruggedness'), arrow('Charm', '😏', 'charm'), arrow('Craftiness', '🦊', 'craftiness'), arrow('Virility', '🔥', 'virility')].join('\n'));
        if (isCrystalCursed('player')) parts.push(`💠 **Crystal Curse** — your issue turns to soulgems (${rd.crystalCurse?.expiresStep == null ? 'permanent until broken by magic' : `${Math.max(0, rd.crystalCurse.expiresStep - (currentGameState.timeStep || 0))} periods left`})`);
        for (const e of playerStatusesOnly()) { const el = statusEndsLabel(e); parts.push(`${effectIcon(e)} **${e.name}**${statusModString(e.mods)}${el ? ` — ends when: ${el}` : ''}`); }
        for (const e of playerObjectives()) { const rw = rewardLabel(e.reward); parts.push(`📜 **${e.name}** — ${e.endCondition || 'ongoing'}${statusModString(e.mods)}${rw ? ` (reward: ${rw})` : ''}`); }
        const worn = equippedItemsSummary();
        if (worn.length) parts.push(`🎽 Equipped: ${worn.join(', ')}`);
        const party = (currentGameState.party || []);
        if (party.length) parts.push(`🧑‍🤝‍🧑 Party: ${party.join(', ')}`);
        const items = (rd.inventory.items || []).map(i => prettyItem(i.name));
        parts.push(`🎒 Carrying: ${items.length ? items.join(', ') : 'nothing of note'}`);
        sendGhostMessage(`🪞 **${name}**\n${parts.join('\n')}`);
    }

    // === Party: NPCs who travel with you (schedule suspended) ===
    async function addToParty(npcName) {
        currentGameState.party = currentGameState.party || [];
        if (!currentGameState.party.includes(npcName)) {
            currentGameState.party.push(npcName);
            // Tenure: how long she's been on the road with you (feeds examine
            // descriptions so travel reads as her present life, not an outing).
            getRelationship(npcName).partyJoinedStep = currentGameState.timeStep || 0;
            savePlayer();
            sendGhostMessage(`🧑‍🤝‍🧑 **${npcName} joins you** — she'll travel at your side until you part ways.`);
        }
        saveCurrentState();
        await syncPresence();   // un-mute her at your location; she follows on every move
    }
    async function removeFromParty(npcName) {
        const wasParty = (currentGameState.party || []).includes(npcName);
        const rel = getRelationship(npcName);
        const here = currentGameState.currentLocation;
        rel.partyJoinedStep = null;

        if (rel.npcUnconscious) {
            // Leaving her unconscious: pin her HERE and record the circumstance so
            // the reunion note (and she) can speak to being left / waking alone.
            currentGameState.party = (currentGameState.party || []).filter(n => n !== npcName);
            rel.stashedAt = here;
            if (rel.koStep == null) rel.koStep = currentGameState.timeStep || 0;
            rel.leftUnconscious = true;
            rel.leftAt = here;
            rel.leftStep = currentGameState.timeStep || 0;
            sendGhostMessage(`💤 You leave **${npcName}**'s unconscious form at ${locName(here)}. She'll rest here until she wakes.`);
            saveCurrentState();
            await syncPresence();
            return;
        }

        // Conscious parting: let her say goodbye IN CHARACTER and name where she's
        // headed on her own routine, BEFORE she leaves the scene.
        if (wasParty) await triggerNpcDeparture(npcName);
        currentGameState.party = (currentGameState.party || []).filter(n => n !== npcName);
        const dest = scheduledLocationFor(npcName);
        sendGhostMessage(`👋 **${npcName} parts ways**${dest ? `, heading to ${locName(dest)}` : ''}, and returns to her own routine.`);
        saveCurrentState();
        await syncPresence();
    }

    // A departing companion's spoken farewell — triggered while she is still
    // present, told where she is off to (her scheduled spot for this period).
    const DEPART_PROMPT_KEY = 'RPG_CUSTODIAN_DEPART';
    async function triggerNpcDeparture(npcName) {
        const present = getNpcsAt(currentGameState.currentLocation).map(n => n.name);
        if (!present.includes(npcName)) return;
        if (getRelationship(npcName).npcUnconscious) return;
        if (!(await waitForGenerationIdle(10000))) return;
        const npc = (currentGameState.npcRoster || []).find(n => n.name === npcName);
        const player = context.powerUserSettings.personas?.[playerAvatar()] || 'the adventurer';
        const period = TIME_PERIODS[currentGameState.currentTime].name;
        const destId = scheduledLocationFor(npcName);
        const dest = destId ? locName(destId) : 'about her own way';
        const role = npc?.role ? ` (you are ${aOrAn(npc.role)})` : '';
        const note = `[You are parting ways with ${player} for now and heading off on your OWN. In ONE short, warm, in-character line, say goodbye and tell him where he can find you — you are going to ${dest} to go about your business this ${period}${role}. Tone like: "Alright, goodbye! If you need me, I'll be at ${dest} this ${period}." Just the spoken farewell — do not narrate leaving in detail.]`;
        context.setExtensionPrompt(DEPART_PROMPT_KEY, note, 1, 0);
        try {
            await context.executeSlashCommandsWithOptions(`/trigger await=true ${npcName}`, { source: 'rpg-custodian' });
        } catch (e) { console.error('RPG Custodian: departure trigger failed', e); }
        finally { context.setExtensionPrompt(DEPART_PROMPT_KEY, '', 1, 0); noteSeen(npcName); savePlayer(); }
    }

    // === Narrative time passing (the Custodian's advance_time verb) ===
    async function advanceTimeBy(n) {
        if (!currentGameState.isActive) return;
        const steps = Math.max(1, Math.min(40, n));   // cap runaway skips (~10 days)
        const startDay = currentGameState.dayCount;
        const rd = getPlayerRpgData();
        const multi = steps > 1;

        // Snapshot pregnancy stages so a multi-step skip can summarize instead of
        // spamming a message for every single increment.
        const pregBefore = {};
        if (multi && rd) for (const [nm, rel] of Object.entries(rd.relationships || {})) if ((rel.pregnancies || 0) > 0) pregBefore[nm] = pregnancyStage(rel.pregnancy_progress);

        for (let i = 0; i < steps; i++) advanceTime(multi);   // quiet per-step when skipping many
        await syncPresence();   // schedules shift; party members stay with you
        markPresentSeen();      // time passed IN PLACE — anyone still present was with you through it

        const t = TIME_PERIODS[currentGameState.currentTime];
        let msg = `⏰ ${multi ? `Time skips ahead ${steps} periods` : 'Time passes'}… it is now ${t.emoji} **${t.name}**`;
        if (currentGameState.dayCount > startDay) msg += ` (Day ${currentGameState.dayCount})`;
        msg += `.${presenceLine(currentGameState.currentLocation)}`;
        sendGameMasterMessage(msg);

        // One consolidated pregnancy summary for the whole skip.
        if (multi && rd) {
            for (const [nm, rel] of Object.entries(rd.relationships || {})) {
                if ((rel.pregnancies || 0) > 0 && pregnancyStage(rel.pregnancy_progress) !== pregBefore[nm]) {
                    const st = pregnancyStage(rel.pregnancy_progress);
                    sendGhostMessage(`🤰 ${nm}'s pregnancy is now **${st}** — ${rel.pregnancy_progress}%.` + (st === 'Birth Overdue' ? ' At term, ready to give birth!' : ''));
                }
            }
        }
        saveCurrentState();
    }

    /**
     * Build a "who's here" suffix for location messages ('' when alone).
     */
    function presenceLine(locationId) {
        const present = getNpcsAt(locationId);
        const foot = offspringFootnote(locationId);
        if (present.length === 0) return foot;
        const names = present.map(npc => {
            const tag = isInParty(npc.name) ? ' 🧑‍🤝‍🧑' : (npc.role ? ` (${npc.role})` : '');
            return `**${npc.name}**${tag}`;
        });
        return `\n\n👥 Here: ${names.join(', ')}${foot}`;
    }

    // ========================================================================
    // VERTICAL SLICE ENGINE — resources, skill checks, shop, quests, wrestle
    // ========================================================================

    /** Current player persona avatar id. `user_avatar` is a live module binding
     *  from script.js (getContext() does NOT expose it). */
    function playerAvatar() {
        return user_avatar;
    }

    /** Get the player's rpg_data, initializing a default four-stat block if absent. */
    function getPlayerRpgData() {
        const avatar = playerAvatar();
        const pud = context.powerUserSettings;
        if (!avatar || !pud?.persona_descriptions?.[avatar]) return null;
        const desc = pud.persona_descriptions[avatar];
        if (!desc.rpg_data) {
            desc.rpg_data = {
                version: '2.0',
                created_at: new Date().toISOString(),
                stats: { level: 1, experience: 0, power_tokens: 0,
                    ruggedness: 3, charm: 3, craftiness: 3, virility: 1, stamina: 3, mana: 3 },
                inventory: { items: [], currency: 0 },
                customEffects: [],
                quests: {},
                world_state: { current_location: null, visited_locations: [], relationship_flags: {}, story_flags: {} },
                metadata: { character_class: 'Adventurer', background: 'Traveler', notes: '' },
            };
            console.log('RPG Custodian: Initialized rpg_data for player persona', avatar);
        }
        // Backfill fields that older personas may lack
        const rd = desc.rpg_data;
        rd.inventory = rd.inventory || { items: [], currency: 0 };
        rd.inventory.items = rd.inventory.items || [];
        rd.customEffects = rd.customEffects || [];
        return rd;
    }

    function savePlayer() {
        if (typeof context.saveSettingsDebounced === 'function') context.saveSettingsDebounced();
        renderActionBar();
        projectPlayerStatus();
    }

    /**
     * Inject a live "player status" block into the prompt so the Game Master and
     * every present NPC can SEE the player's stats, coin, and inventory — the
     * persistent character-sheet-in-context Dyna asked for. Refreshed on any
     * change. Injected at shallow chat depth as a system note.
     */
    // === NPC continuity: last-seen tracking + reunion kick-start ===
    // So an NPC you left days ago reacts to your RETURN (aware time passed, with
    // her own life lived in between) instead of resuming mid-scene.
    function locName(id) { return currentGameState.worldData?.locations?.[id]?.name || id || 'somewhere'; }
    function aOrAn(w) { return /^[aeiou]/i.test(String(w || '')) ? `an ${w}` : `a ${w}`; }
    // The current place + time of day — the anchor every narration/reply shares.
    function currentSceneLabel() {
        const period = TIME_PERIODS[currentGameState.currentTime];
        return `${locName(currentGameState.currentLocation)}${period ? `, ${period.name}` : ''}`;
    }
    function currentLocationDesc() {
        return currentGameState.worldData?.locations?.[currentGameState.currentLocation]?.description || '';
    }

    // A readable summary of an NPC's routine + home, grouped by location. Used
    // both for her own self-knowledge (status block) and the reunion note.
    function scheduleSummary(npc) {
        const sched = npc.schedule || {};
        const byLoc = {};
        for (const p of ['Morning', 'Day', 'Evening', 'Night']) { const l = sched[p]; if (!l) continue; (byLoc[l] = byLoc[l] || []).push(p.toLowerCase()); }
        const clauses = Object.entries(byLoc).map(([loc, ps]) => `${locName(loc)} (${ps.join('/')})`);
        const home = npc.homeLocation ? locName(npc.homeLocation) : null;
        let s = clauses.length ? `usual haunts — ${clauses.join(', ')}` : 'no fixed routine';
        if (home) s += `; home is ${home}`;
        return s + '.';
    }
    // Turn a count of elapsed time-periods (4 = one day) into plain words.
    function elapsedPhrase(periods) {
        if (periods <= 0) return 'almost no time';
        const days = Math.floor(periods / 4), rem = periods % 4;
        const remWord = ['', 'a few hours', 'half a day', 'most of a day'][rem];
        if (days === 0) return remWord;
        let s = `${days} full day${days > 1 ? 's' : ''}`;
        if (rem) s += ` and ${remWord}`;
        return s;
    }
    // Record that the player is co-present with an NPC right now. Reuniting also
    // consumes any "left unconscious / woke alone" circumstance (it's now resolved).
    function noteSeen(npcName) {
        const rel = getRelationship(npcName);
        rel.lastSeenStep = currentGameState.timeStep || 0;
        rel.lastSeenDay = currentGameState.dayCount;
        rel.lastSeenTime = currentGameState.currentTime;
        rel.leftUnconscious = false;
        rel.leftAt = null;
        rel.wokeAloneAt = null;
        rel.bornAlone = null;
    }
    // Mark every NPC currently present as freshly seen — called when time passes
    // IN PLACE (wait/rest/advance_time), so time spent TOGETHER is not later
    // mistaken for an absence. (Travel does not tick the clock, so arriving after
    // a long gap correctly leaves the reunion pending until she reacts.)
    function markPresentSeen() {
        if (!currentGameState.isActive) return;
        for (const npc of getNpcsAt(currentGameState.currentLocation)) noteSeen(npc.name);
        savePlayer();
    }
    // The ephemeral note injected right before an NPC's first reply after a gap.
    const REUNION_PROMPT_KEY = 'RPG_CUSTODIAN_REUNION';

    // === Charm-check interpretation (romance-redesign §B) ===
    // A charm roll decides whether she ACCEPTS THE PLAYER'S FRAMING — not
    // whether she likes him. The outcome becomes a one-shot note the addressed
    // NPC reads before replying; her REACTION is hers (a seen-through lie can
    // delight her), and the reaction judge reads that reply for tier movement.
    const CHARM_PROMPT_KEY = 'RPG_CUSTODIAN_CHARM_READ';
    let pendingCharmNote = null;   // set on a charm roll, consumed by the next addressed NPC

    function buildCharmInterpretationNote(check) {
        const player = context.powerUserSettings.personas?.[playerAvatar()] || 'the adventurer';
        let read;
        if (!check) read = 'His words land easily — nothing in them strains belief, and she takes them at face value.';
        else if (check.tier === 'critical') read = 'His words land better than he could have hoped — she believes him completely, and finds herself genuinely moved by how he put it.';
        else if (check.tier === 'success') read = 'She reads him as sincere and sees it his way — she is inclined to go along with what he said or asked.';
        else if (check.tier === 'mixed') read = 'She HALF-believes him — wants to, but something rings uncertain; she hedges, tests him, or grants only part of it.';
        else read = 'She is NOT persuaded — she sees straight through the framing to what she actually perceives underneath, and reacts to THAT truth however her nature dictates: amusement, suspicion, pity, or open delight at catching him. Being unconvinced does not have to mean being cold — her feelings are her own, and her disposition still applies.';
        return `[How she received ${player}'s last words — play this reading in your reply:] ${read}`;
    }

    // === Reaction judge (romance-redesign §C) ===
    // The heart of emergent romance: her reply was generated WITH her bands as
    // instruction. If she still played warmer (or colder) than her band allows,
    // the roleplay model judged that the moment earned it — the engine only
    // detects the band-break and moves the tier. Affection: ±1 (±2 reserved
    // for far-outside-band moments), gain paced per time period. Arousal: ±2
    // on physical evidence. Default is always 0.
    async function judgeNpcReaction(npcName, preReplyLen) {
        try {
            const chat = getCtx().chat || [];
            const reply = chat.length > preReplyLen ? chat[chat.length - 1] : null;
            if (!reply || reply.is_user || reply.is_system || reply.name !== npcName) return;
            const replyText = String(reply.mes || '').trim();
            if (!replyText) return;
            const playerMsg = [...chat.slice(0, preReplyLen)].reverse().find(m => m.is_user);
            const rel = getRelationship(npcName);
            const t = affectionTier(rel.affection || 0);
            const a = arousalTier(rel.arousal || 1);

            const sys = `You are the RPG relationship JUDGE. An NPC replied to the player. She was INSTRUCTED to play a stated disposition band (what she gives freely, and what she would NOT yet do) and a stated physical band. Decide whether her reply stepped OUTSIDE those bands. Acting outside her band is exactly HOW affection is built in this game — your job is to RECOGNIZE it consistently, every time it happens. Judge in two parts:
1. TONE: pleasant, teasing, flirty, sharp, or grumpy TONE consistent with her band scores ZERO. Never reward mere friendliness or banter.
2. CONCRETE ACTS: if in this reply she DOES something her band says he has not yet earned — seeks out or invites his company, extends an invitation, confides something personal, does him an unasked kindness, grants trust the band withholds — that IS a band-break: affection +1. When in doubt between 0 and +1 over a CONCRETE act, score the act — missing a real act is the worse error. Give +2 only for a dramatic leap FAR beyond the band (a confession, a bedding invitation from a guarded woman, entrusting him with her life). Conversely, if she REFUSES or withdraws what her band normally gives freely — goes cold, revokes trust, pulls away — score −1 (−2 for an open rupture). If neither list is touched, 0.
LANE RULE: affection is about TRUST and CARE only. Her body's interest — closeness, touch, display, sexual banter — belongs to the AROUSAL channel below and NEVER counts as an affection act by itself. A woman can want him while trusting him no further than she can throw him.
AROUSAL — answer this checklist IN ORDER:
(a) Did SHE introduce any sexual reference, innuendo, or crude sexual banter — mentioning his body, beds, sex, what he does with his cock — that is NOT merely echoing or refusing something HE said? If YES: arousal is AT LEAST +1, NO EXCEPTIONS — gruffness, warnings, and professional framing do not cancel it. Bringing sex up unprompted is her body talking.
(b) Physical evidence beyond her stated band — lingering or roaming gazes, deliberate touches, closing distance, display, flush, breathlessness: +1 (+2 if blatant).
(c) Clear physical cooling below her band: −1.
(d) None of the above: 0. (Merely refusing or deflecting an advance HE made is 0.)
Output ONLY JSON: {"affection": <-2..2>, "arousal": <-2..2>, "why": "<ten words max>"}`;
            const prompt = `NPC: ${npcName}
Her disposition band she was told to play (${t.label}, affection ${rel.affection || 0}/10): she ${t.band}
Her physical band (${a.label}, arousal ${rel.arousal || 1}/10): ${a.band}
Scene context (for reading her reply — but score ONLY the reply itself):
${recentSceneForAnalyzer().split('\n').slice(-6).join('\n')}
Player's message: "${String(playerMsg?.mes || '').replace(/\s+/g, ' ').slice(0, 600)}"
HER REPLY (score this):
${replyText.replace(/\s+/g, ' ').slice(0, 1500)}`;

            const p = await generateJson({ prompt, systemPrompt: sys, budget: 220 });
            if (!p) return;
            let dAff = Math.max(-2, Math.min(2, Math.round(Number(p.affection) || 0)));
            const dAro = Math.max(-2, Math.min(2, Math.round(Number(p.arousal) || 0)));
            // Log zeros too — silent verdicts made live misses undiagnosable.
            console.log(`RPG Custodian: reaction judge ${npcName}: aff ${dAff >= 0 ? '+' : ''}${dAff}, aro ${dAro >= 0 ? '+' : ''}${dAro} (${p.why || ''})`);
            if (!dAff && !dAro) return;

            // Pacing cap (knob #1): ordinary gain +1 per time period per NPC;
            // a far-outside +2 may breach it once. Losses are never capped.
            const step = currentGameState.timeStep || 0;
            if (dAff > 0) {
                const gained = rel.affJudgeStep === step ? (rel.affGainedThisStep || 0) : 0;
                const allowance = Math.max(0, (dAff >= 2 ? 2 : 1) - gained);
                dAff = Math.min(dAff, allowance);
                if (dAff > 0) { rel.affJudgeStep = step; rel.affGainedThisStep = gained + dAff; }
            }
            const beforeTier = affectionTier(rel.affection || 0).label;
            if (dAff) rel.affection = Math.max(0, Math.min(10, (rel.affection || 0) + dAff));
            if (dAro) rel.arousal = Math.max(1, Math.min(10, (rel.arousal || 1) + dAro));
            savePlayer();

            // Only a tier BOUNDARY crossing surfaces to the player — felt
            // progress, not scorekeeping noise.
            const afterTier = affectionTier(rel.affection || 0).label;
            if (afterTier !== beforeTier) {
                sendGhostMessage(dAff > 0
                    ? `💗 Something shifts in ${npcName} — **${beforeTier} → ${afterTier}**.`
                    : `💔 ${npcName} pulls back — **${beforeTier} → ${afterTier}**.`);
                projectPlayerStatus();   // she plays the new band from the next line
            }
        } catch (e) { console.error('RPG Custodian: reaction judge failed', e); }
    }
    function buildReunionNote(npcName) {
        const rel = getRelationship(npcName);
        if (rel.lastSeenStep == null) return null;                         // never met → no reunion
        const elapsed = (currentGameState.timeStep || 0) - rel.lastSeenStep;
        if (elapsed < 1) return null;                                      // seen just now / together
        const npc = (currentGameState.npcRoster || []).find(n => n.name === npcName);
        const player = context.powerUserSettings.personas?.[playerAvatar()] || 'the adventurer';
        const t = affectionTier(rel.affection);
        const dur = elapsedPhrase(elapsed);
        const role = npc?.role ? ` (${aOrAn(npc.role)})` : '';
        const preg = rel.pregnancies > 0
            ? ` You have carried ${rel.pregnancies} of his ${rel.pregnancies === 1 ? 'child' : 'children'} through this absence (now ${pregnancyStage(rel.pregnancy_progress) || 'newly conceived'}, ${rel.pregnancy_progress || 0}% along).`
            : '';
        // If the last thing that happened was being left unconscious, that colors
        // the whole reunion — she remembers passing out / being left, not a
        // normal goodbye, and may have woken alone somewhere.
        let circumstance = '';
        if (rel.leftUnconscious && rel.leftAt) {
            circumstance = ` IMPORTANT: the last thing you remember is losing consciousness — ${player} left you unconscious at ${locName(rel.leftAt)}.`;
            circumstance += rel.wokeAloneAt
                ? ` You woke there ALONE, without him, and have carried on since — you may feel abandoned, relieved, worried, cross, or tender about it, true to your character.`
                : ` You are only now coming back to your senses around him.`;
        }
        // Gave birth alone while he was away — a huge thing to have gone through
        // without him. She has strong feelings about it, true to her character.
        if (rel.bornAlone) {
            const b = rel.bornAlone;
            const what = b.kind === 'egg' ? `laid ${b.count} egg${b.count > 1 ? 's' : ''}`
                : b.kind === 'crystal' ? `birthed ${b.count} lifeless soul-crystal${b.count > 1 ? 's' : ''}`
                : (b.count > 1 ? `gave birth to ${b.count} of his children` : `gave birth to his child`);
            circumstance += ` MAJOR: while ${player} was away and never came to help, you ${what} ALONE at ${locName(b.at)}. You went through it without him — react with the weight of that (hurt, pride, exhaustion, longing, anger, or love, as fits you). ${b.kind === 'egg' ? 'The eggs/young are back at your home.' : b.kind === 'crystal' ? 'The inert crystals unsettle you.' : 'The child(ren) are back at your home.'}`;
        }
        return `[SCENE CONTINUITY for ${npcName}${role} — read this before you reply. You have NOT seen ${player} for about ${dur}. You spent that time APART, living your own life — ${scheduleSummary(npc)}${circumstance} React to his RETURN across that gap: you are aware time has passed and that you did NOT spend it with him, so greet/acknowledge the reunion rather than picking the last scene back up as if he never left. You may carry your own news, changes, or feelings about the time apart. Your standing with him: ${t.label} — ${npcName} ${t.desc}.${preg} If he asks where you have been or what you do, answer honestly from your routine above.]`;
    }

    const STATUS_PROMPT_KEY = 'RPG_CUSTODIAN_STATUS';
    function projectPlayerStatus() {
        const rd = currentGameState.isActive ? getPlayerRpgData() : null;
        if (!rd) { context.setExtensionPrompt(STATUS_PROMPT_KEY, '', 1, 4); return; }
        const s = rd.stats;
        const name = context.powerUserSettings.personas?.[playerAvatar()] || 'The adventurer';
        const items = rd.inventory.items.map(i => prettyItem(i.name));
        const lines = [
            // The scene anchor — FIRST, so every reply/narration is grounded in
            // WHERE and WHEN this is happening. NPCs must speak/act as being here.
            `[SCENE — this is happening at: ${currentSceneLabel()} (Day ${currentGameState.dayCount}).${currentLocationDesc() ? ` ${currentLocationDesc()}` : ''} Everyone present is HERE, in this place; ground all dialogue, action, and description in this exact setting — do not drift to another location.]`,
            ``,
            `[Adventurer Status — plainly visible to everyone present]`,
            `${name} — Ruggedness ${effectiveStat('ruggedness')}, Charm ${effectiveStat('charm')}, Craftiness ${effectiveStat('craftiness')}, Virility ${effectiveStat('virility')} (Level ${s.level}).`,
            `Stamina ${getStamina()}/${maxStamina()}${rd.stats.unconscious ? ' — UNCONSCIOUS' : ''}.`,
            `Coin purse: ${rd.inventory.currency} gold.`,
            `Carrying: ${items.length ? items.join(', ') : 'nothing of note'}.`,
        ];
        if (isCrystalCursed('player')) lines.push(`💠 Afflicted by the CRYSTAL CURSE — any child ${name} sires is born an inert soulgem, not a living child (until the curse is broken by magic).`);
        const pStatuses = playerStatusesOnly();
        if (pStatuses.length) lines.push(`Status effects: ${pStatuses.map(e => `${effectIcon(e)} ${e.name}${e.desc ? ` (${e.desc})` : ''}`).join('; ')}.`);
        const pObjectives = playerObjectives();
        if (pObjectives.length) lines.push(`Active objectives/pacts: ${pObjectives.map(e => `${effectIcon(e)} ${e.name} — ${e.endCondition || 'ongoing'}`).join('; ')}.`);
        const worn = equippedItemsSummary();
        if (worn.length) lines.push(`Wearing/wielding: ${worn.join(', ')}.`);

        // How the NPCs present feel about the player — the number turned into
        // behavior. Each reads her own line and plays it.
        const present = getNpcsAt(currentGameState.currentLocation);
        const dispositions = present.map(npc => {
            const rel = getRelationship(npc.name);
            if (rel.npcUnconscious) {
                return `‼️ ${npc.name} is UNCONSCIOUS — she has collapsed from exhaustion (Stamina 0) and is completely limp and unresponsive. She CANNOT speak, move, think, or react in any way. If ${npc.name} would respond, instead she simply lies there, out cold. Do NOT write dialogue or deliberate action for her until she is revived or wakes from rest.`;
            }
            const t = affectionTier(rel.affection);
            const a = arousalTier(rel.arousal || 1);
            let d = `${npc.name} (${t.label}${isInParty(npc.name) ? ', travelling with you' : ''}): ${npc.name} ${t.band}`;
            if ((rel.arousal || 1) >= 3) d += ` Physically (${a.label}): ${a.band}`;
            if (rel.pregnancies > 0) d += ` She is carrying ${rel.pregnancies} of your ${rel.pregnancies === 1 ? 'child' : 'children'} — ${pregnancyStage(rel.pregnancy_progress) || 'newly conceived'} stage, ${rel.pregnancy_progress || 0}% developed.`;
            const npcFx = npcActiveEffects(npc.name);
            if (npcFx.length) d += ` Under effects: ${npcFx.map(effectLine).join(', ')}.`;
            if (isCrystalCursed(npc.name)) d += ` She bears the CRYSTAL CURSE — any child she births comes as an inert soulgem (until broken by magic).`;
            return d;
        });
        if (dispositions.length) {
            lines.push('', `[How those present feel toward ${name} — each plays HER OWN line faithfully, INCLUDING its limits. These dispositions are strong and persistent: warmth beyond a stated line must be earned in the story, never assumed. She:]`, ...dispositions);
        }

        // Each present NPC's own home + daily routine, so she can speak to where
        // she lives and what she does honestly (from her character sheet).
        const routines = present
            .filter(npc => !getRelationship(npc.name).npcUnconscious)
            .map(npc => `${npc.name} — ${scheduleSummary(npc)}`);
        if (routines.length) {
            lines.push('', '[Where those present live and their daily routine — each knows her OWN and can answer truthfully if asked:]', ...routines);
        }

        // Common town knowledge: every resident knows who the town's public
        // figures are. Without this, models CONFABULATE names for absent cast
        // (Bryony once introduced the madam of the Velvet Rose as "Fern").
        const known = (currentGameState.npcRoster || []).filter(n => !n.secret);
        if (known.length > 1) {
            lines.push('', '[Common local knowledge — everyone here knows of these people; NEVER invent or swap their names/roles:]',
                known.map(n => `${n.name}, the ${n.role || 'resident'}${n.homeLocation ? ` (${locName(n.homeLocation)})` : ''}`).join(' · '));
        }

        // position 1 = IN_CHAT, depth 4, system role — always near the live scene.
        context.setExtensionPrompt(STATUS_PROMPT_KEY, lines.join('\n'), 1, 4);
    }

    // --- Resources ---
    function getGold() { return getPlayerRpgData()?.inventory.currency ?? 0; }
    function addGold(n) { const rd = getPlayerRpgData(); if (rd) { rd.inventory.currency = Math.max(0, (rd.inventory.currency || 0) + n); savePlayer(); } }
    function addItem(item) { const rd = getPlayerRpgData(); if (rd) { rd.inventory.items.push(item); savePlayer(); queueAppraise(item); } }
    function removeItemById(id) {
        const rd = getPlayerRpgData(); if (!rd) return false;
        const i = rd.inventory.items.findIndex(it => it.id === id);
        if (i === -1) return false;
        rd.inventory.items.splice(i, 1); savePlayer(); return true;
    }

    // --- Stats & boosts ---
    function baseStat(name) { return getPlayerRpgData()?.stats?.[name] ?? 0; }
    // ALL temporary/lasting stat changes flow through ONE system: bespoke effects
    // (buffs/debuffs/blessings/curses/pacts/diseases, AND single-use pre-buffs) in
    // customEffects, read via customStatMod (player) / npcStatMod (npc). The old
    // apply_buff/rd.buffs AND active_boosts systems are fully folded into this.
    function effectiveStat(name) { return baseStat(name) + customStatMod(name) + equipStatMod(name); }
    // A one-use pre-buff (potion/blessing that helps the NEXT trial of a stat) is
    // just an effect with expiresOnCheck === that stat. Spend it after the roll.
    function consumeCheckEffects(stat) {
        const rd = getPlayerRpgData(); if (!rd?.customEffects?.length) return;
        const spent = rd.customEffects.filter(e => e.active !== false && e.expiresOnCheck === stat);
        if (!spent.length) return;
        rd.customEffects = rd.customEffects.filter(e => !spent.includes(e));
        for (const e of spent) sendGhostMessage(`⌛ **${e.name}** is spent — its power fed your ${stat}.`);
        savePlayer();
    }
    // Legacy shim: a couple of call sites / item paths still ask for a boost.
    function addBoost(stat, amount, source) {
        return addCustomStatus('player', { name: source || 'a surge of power', kind: 'buff', polarity: amount >= 0 ? 'positive' : 'negative', mods: [{ stat, amount }], expires_on_check: stat });
    }

    // --- Dice & skill checks (2d6 + effective stat vs difficulty; PbtA-style tiers) ---
    function rollDie() { return 1 + Math.floor(Math.random() * 6); }
    function skillCheck(statName, difficulty) {
        const base = baseStat(statName);
        const eff = effectiveStat(statName);
        const boost = eff - base;   // combined bonus from all active effects/gear
        const d1 = rollDie(), d2 = rollDie();
        const total = d1 + d2 + eff;
        let tier;
        if (total >= difficulty + 4) tier = 'critical';
        else if (total >= difficulty) tier = 'success';
        else if (total >= difficulty - 3) tier = 'mixed';
        else tier = 'failure';
        return { statName, base, boost, eff, d1, d2, dice: d1 + d2, total, difficulty, tier, success: total >= difficulty };
    }
    function skillCheckLine(check, label) {
        const boostStr = check.boost ? ` +${check.boost} boost` : '';
        const icon = { critical: '🌟', success: '✅', mixed: '➖', failure: '❌' }[check.tier];
        return `🎲 **${label}** — ${check.statName} check (DC ${check.difficulty})\n` +
            `Rolled 2d6 [${check.d1}+${check.d2}=${check.dice}] + ${check.base}${boostStr} = **${check.total}** → ${icon} **${check.tier.toUpperCase()}**`;
    }

    // --- Quests (player-side state stored in rpg_data.quests keyed by quest id) ---
    // (The old pre-authored card-quest system — accept/attempt/turnin by id —
    // is GONE, demolished 2026-07-25 after it collided with an emergent job:
    // "accepting a job from Bryony" got force-fit onto her card's wolves quest.
    // ALL quests are bespoke add_objective records now; the condition judge
    // completes them. Legacy rd.quests data in old saves is inert.)

    // --- Shop ---
    function openShop(npc) {
        const items = (npc.shopInventory || []).map(item => ({
            icon: '🪙',
            label: `${item.name} — ${item.price}g`,
            sub: item.desc,
            action: () => buyItem(npc, item),
        }));
        items.push({ icon: '🚪', label: 'Leave shop', action: () => {} });
        openActionPopup(`🛒 ${npc.name}'s Shop  (you have ${getGold()}g)`, items);
    }
    function buyItem(npc, item) {
        if (getGold() < item.price) {
            sendGhostMessage(`❌ You can't afford **${item.name}** (${item.price}g). You have ${getGold()}g.`);
            return;
        }
        addGold(-item.price);
        addItem({ id: item.id, name: item.name, desc: item.desc, effect: item.effect });
        // Mechanical record only. The Shop-button path triggers the merchant to
        // react here; the NL path lets orchestration trigger her (avoid double).
        sendGhostMessage(`🛍️ Bought **${item.name}** for ${item.price}g. (${getGold()}g left)`);
        renderActionBar();
        if (!currentGameState.rpgOrchestrating) triggerNpcReply(npc.name);
    }

    // --- Inventory & item use ---
    function openInventory() {
        const rd = getPlayerRpgData();
        const all = (rd?.inventory.items || []);
        const items = all.map(item => {
            const consumable = itemIsConsumable(item);
            return {
                icon: consumable ? '🧪' : (item.equipped ? '🎽' : '📦'),
                label: itemLabel(item),
                sub: consumable ? 'tap to use' : (item.equipped ? 'equipped · tap to remove' : 'tap to equip') + (item.desc ? ` · ${item.desc}` : ''),
                action: () => toggleOrUseItem(item),
            };
        });
        // Gold sits at the top of the pouch as its own line.
        items.unshift({ icon: '🪙', label: `${getGold()} gold`, sub: 'coin purse', action: () => {} });
        if (items.length === 1) items.push({ icon: '—', label: '(no other items)', action: () => {} });
        const equipped = equippedItemsSummary();
        openActionPopup(`🎒 Inventory${equipped.length ? `  —  worn: ${equipped.map(e => e.split(' (')[0]).join(', ')}` : ''}`, items);
    }
    function useItem(item) {
        if (item.effect?.type === 'stat_boost') {
            const enc = (item.effect.duration || 'encounter') === 'encounter';
            addCustomStatus('player', {
                name: item.name, kind: 'buff', polarity: item.effect.amount >= 0 ? 'positive' : 'negative',
                mods: [{ stat: item.effect.stat, amount: item.effect.amount }],
                expires_on_check: enc ? item.effect.stat : null,        // one-use pre-buff, or…
                duration: enc ? null : Number(item.effect.duration) || null,   // …a timed one
            });
            removeItemById(item.id);
            sendGameMasterMessage(`🧪 You drink the **${item.name}**. Power floods your ${item.effect.stat} (+${item.effect.amount}${enc ? ` until your next trial of ${item.effect.stat}` : ''}). ` +
                `Your effective ${item.effect.stat} is now **${effectiveStat(item.effect.stat)}**.`);
        } else if (isSoulCrystalName(item.name)) {
            // Crush a soul crystal for its stored arcane charge → +1 Mana.
            const gained = restoreMana(1);
            removeItemById(item.id);
            const rd = getPlayerRpgData();
            sendGameMasterMessage(`💠 You crush the **${prettyItem(item.name)}**, drawing out its stored energy${gained ? '' : ' — but your Mana is already full'}. Mana **${rd.stats.mana}/${maxMana()}**${gained ? ` (+${gained})` : ''}.`);
        } else {
            sendGhostMessage(`You examine the ${item.name}. (No use implemented.)`);
        }
        renderActionBar();
    }

    // Emergent XP: harder successful checks are worth more (bard experience —
    // besting a dragon eclipses finding a stick). See core-mechanics §5.
    function awardCheckXp(check) {
        if (!check?.success) return 0;
        const xp = Math.max(1, (check.difficulty - 5)) * 10; // DC6→10 … DC14→90 … DC16→110
        const rd = getPlayerRpgData();
        if (rd) { rd.stats.experience = (rd.stats.experience || 0) + xp; savePlayer(); }
        return xp;
    }

    // Relationships live in the PLAYER'S persona (hidden rpg_data.relationships,
    // keyed by NPC name) — so each NPC only knows her own feelings and multiple
    // heroes can share one living world. See core-mechanics §5b.
    function getRelationship(npcName) {
        const rd = getPlayerRpgData();
        if (!rd) return { affection: 0, arousal: 1, familiarity: 0, pregnancies: 0, pregnancy_progress: 0 };
        rd.relationships = rd.relationships || {};
        rd.relationships[npcName] = rd.relationships[npcName] || { affection: 0, arousal: 1, familiarity: 0, pregnancies: 0, pregnancy_progress: 0 };
        return rd.relationships[npcName];
    }
    function getNpcAffection(name) { return getRelationship(name).affection || 0; }
    function adjustNpcAffection(name, delta) {
        const rel = getRelationship(name);
        rel.affection = Math.max(0, Math.min(10, (rel.affection || 0) + delta));  // clamp 0–10
        savePlayer();
    }

    // Affection 0–10 → tier + behavioral BAND (romance-redesign §A). `desc` is
    // the short line for compact readouts; `band` is the rich projection the
    // NPC plays: inner stance, body language, what she gives freely, and — the
    // gate — what she would NOT yet do at this tier. The band is also the
    // yardstick the reaction judge measures her replies against: warmth beyond
    // the band is the signal that the moment earned a tier step.
    function affectionTier(v) {
        if (v <= 0)  return { label: 'Wary', desc: 'is guarded around you, a near-stranger she has little reason to trust yet',
            band: 'sees him as a stranger whose motives are unproven. Inwardly her wall is up; her attention stays on her own business, and she reads him rather than warms to him. She keeps physical distance, angles herself half-away, and lets no touch happen or linger. Freely given: civility, trade, directions, guarded small talk with an exit in view. She would NOT yet: seek out his company, confide anything personal, share private space with him, or accept flirtation as anything but noise — and she does not extend invitations of any kind herself.' };
        if (v <= 2)  return { label: 'Cordial', desc: 'is polite but reserved with you, still keeping a careful distance',
            band: 'finds him tolerable, even mildly interesting, but owes him nothing. She is polite and businesslike, will chat within arm\'s reach of her comfort, and may laugh at a good line — then put the counter back between them. Freely given: conversation, fair dealing, casual company in public places. She would NOT yet: make time for him on purpose, share meals alone, speak of her past or feelings, tolerate more than incidental touch, or invite him anywhere private.' };
        if (v <= 4)  return { label: 'Warming', desc: 'is growing comfortable around you and offers small, genuine kindnesses',
            band: 'has decided he might be worth knowing. Her guard lowers in increments: she remembers what he says, offers small unprompted kindnesses, lingers a little in his company. Body language eases — she faces him fully, allows brief friendly touch, sits nearer than strictly necessary. Freely given: real conversation, small favors, shared time in public, honest answers to honest questions. She would NOT yet: call it anything, invite him into her private spaces or her bed, accept overt romantic advances without pulling back — desire may flicker, but trust has not caught up.' };
        if (v <= 6)  return { label: 'Fond', desc: 'plainly likes you, seeks out your company, and smiles more easily with you',
            band: 'genuinely likes him and no longer hides it well. She seeks out his company, teases, confides in pieces, touches his arm when she laughs. Privacy stops being a wall: sharing a table, a walk, a quiet corner, even ordinary time in her own space feels natural. Freely given: her time, her stories, casual affectionate touch, care when he is hurt, maybe an invitation into her private world — tea in the back room, a spare cot — offered as friendship with something unspoken underneath. She would NOT yet: leap into his bed on a bold ask, say aloud what this is becoming, or forgive carelessness with her trust cheaply.' };
        if (v <= 8)  return { label: 'Smitten', desc: 'is openly attracted to you — flirtatious, warm, and eager for your attention',
            band: 'wants him and has mostly stopped pretending otherwise. She lights up when he arrives, flirts openly, finds reasons to touch and be touched, and her invitations — shared evenings, closeness, staying just a little longer — carry clear intent. Freely given: open affection, kisses that are welcome rather than won, jealousy she can\'t fully hide, first moves of her own. She would NOT yet: surrender the last of her self-protection — declarations, promises, or anything she would be ruined to lose — without the story earning it.' };
        if (v <= 9)  return { label: 'Devoted', desc: 'has fallen for you: trusting, tender, and unafraid to show she wants you',
            band: 'has fallen, and knows it. Her trust is deep and given without accounting; her body and bed are his for the asking, and she asks for him in return. She plans around him, defends him to others, and shows tenderness without embarrassment. Freely given: nearly everything — intimacy, loyalty, vulnerability, her honest heart. She would NOT yet: only the very last things — binding her whole life to his word — wait on proof that lasts.' };
        return { label: 'Adoring', desc: 'loves you completely and trusts you without reservation, cherishing every moment at your side',
            band: 'loves him completely and without reservation. There is no wall left; his presence is her home. She trusts his word over appearances, gives affection lavishly and unprompted, and every choice she makes bends toward a life with him in it. Nothing within her power is withheld.' };
    }

    // Arousal 1–10 → physical band (romance-redesign §D). Purely bodily: what
    // her body is doing regardless of what her pride says. Projected to the
    // NPC/GM and judged from physical evidence in her replies.
    function arousalTier(v) {
        const a = Math.max(1, Math.min(10, v || 1));
        if (a <= 2) return { label: 'Calm', band: 'Her body is at ease — breathing even, skin cool, attention undistracted by him physically.' };
        if (a <= 4) return { label: 'Stirred', band: 'Something about him has her faintly stirred — glances that last a half-second too long, a warmth in her cheeks she could still deny, small self-conscious adjustments of hair and clothing.' };
        if (a <= 6) return { label: 'Flushed', band: 'Her body is plainly interested — color in her face, breath a touch short, finding reasons to stand near him, touches that linger. She knows it, and is hiding it imperfectly.' };
        if (a <= 8) return { label: 'Aching', band: 'Desire has real hold of her — flushed skin, quickened breath, restless hands, drawing close to him without deciding to. Composure takes active effort and keeps slipping.' };
        return { label: 'Desperate', band: 'Her body has overruled her pride — trembling, breathless, pressing near, barely keeping her hands from him. Every sense is full of him, and it shows in everything she does.' };
    }

    // === Stamina: the unified HP pool for combat AND sex (core-mechanics §5b) ===
    // Max = Ruggedness, plus any timed 'stamina' buff (a stamina potion).
    function maxStamina() { return Math.max(1, effectiveStat('ruggedness') + customStatMod('stamina')); }
    function getStamina() {
        const rd = getPlayerRpgData(); if (!rd) return 0;
        if (rd.stats.stamina == null) rd.stats.stamina = maxStamina();
        // Invariant: you can't be unconscious with Stamina left. Self-heal stale
        // flags left by an earlier top-up that didn't clear it.
        if (rd.stats.stamina > 0 && rd.stats.unconscious) rd.stats.unconscious = false;
        return rd.stats.stamina;
    }
    function spendStamina(n) {
        const rd = getPlayerRpgData(); if (!rd) return;
        rd.stats.stamina = Math.max(0, getStamina() - n);
        rd.stats.unconscious = rd.stats.stamina <= 0;
        savePlayer();
    }
    // Everyone recovers to their OWN max Stamina, clearing unconsciousness.
    function restoreEveryoneStamina() {
        const rd = getPlayerRpgData();
        if (rd) { rd.stats.stamina = maxStamina(); rd.stats.unconscious = false; }
        for (const [name, r] of Object.entries(rd?.relationships || {})) {
            if (r.npcUnconscious) wakeNpc(name, r, true);   // records woke-alone if she's stashed elsewhere
            else if (r.npcStamina != null) r.npcStamina = npcMaxStamina(name);
        }
        if (rd) savePlayer();
    }

    // Restoration magic / a healing draught: restore CURRENT Stamina to a target
    // (player or NPC) without raising the max and without passing time. amount is
    // an integer, or 'full'/null to fully restore. Revives from unconsciousness.
    function healStamina(target, amount) {
        const tgt = String(target || 'player');
        const full = amount == null || amount === 'full' || amount === 'max';
        if (tgt === 'player') {
            const rd = getPlayerRpgData(); if (!rd) return;
            const before = getStamina(), max = maxStamina();
            const revived = rd.stats.unconscious && (full || amount > 0);
            rd.stats.stamina = full ? max : Math.min(max, before + (amount || 0));
            rd.stats.unconscious = rd.stats.stamina <= 0;
            savePlayer();
            const gained = rd.stats.stamina - before;
            sendGhostMessage(`💚 Restoration${gained > 0 ? ` (+${gained})` : ''} — your Stamina is ${rd.stats.stamina}/${max}${revived && !rd.stats.unconscious ? ' — you come to, revived!' : ''}.`);
        } else {
            const rel = getRelationship(tgt);
            const max = npcMaxStamina(tgt);
            const before = rel.npcStamina ?? max;
            const revived = rel.npcUnconscious && (full || amount > 0);
            rel.npcStamina = full ? max : Math.min(max, before + (amount || 0));
            rel.npcUnconscious = rel.npcStamina <= 0;
            savePlayer();
            const gained = rel.npcStamina - before;
            sendGhostMessage(`💚 Restoration${gained > 0 ? ` (+${gained})` : ''} — ${tgt}'s Stamina is ${rel.npcStamina}/${max}${revived && !rel.npcUnconscious ? ' — she stirs back to consciousness!' : ''}.`);
        }
    }

    // The `rest` action — the main way Stamina comes back (restoration magic via
    // the `heal` effect is the other). Restores everyone's Stamina and passes
    // exactly ONE time period (never skips ahead to morning).
    async function doRest() {
        restoreEveryoneStamina();
        sendGhostMessage('😴 You rest and recover — everyone\'s Stamina restored to full.');
        await advanceTimeBy(1);
    }

    // NPC combat/sex stamina, tracked on the relationship record.
    function npcMaxStamina(npcName) {
        const npc = (currentGameState.npcRoster || []).find(n => n.name === npcName);
        return Math.max(1, (npc?.ruggedness ?? 3) + npcStatMod(npcName, 'ruggedness') + npcStatMod(npcName, 'stamina'));
    }
    // How many time periods a knocked-out NPC sleeps before waking on her own.
    const KO_RECOVER_PERIODS = 2;
    function spendNpcStamina(npcName, n) {
        const rel = getRelationship(npcName);
        if (rel.npcStamina == null) rel.npcStamina = npcMaxStamina(npcName);
        const was = rel.npcUnconscious;
        rel.npcStamina = Math.max(0, rel.npcStamina - n);
        rel.npcUnconscious = rel.npcStamina <= 0;
        // Post-coital physiology (romance-redesign §D): orgasms spend Stamina,
        // so exhaustion IS the sated state. 1 left → running out of steam
        // (arousal caps at 5); 0 → satisfied and spent (arousal drops to 2).
        if (rel.npcStamina <= 0) rel.arousal = Math.min(rel.arousal || 1, 2);
        else if (rel.npcStamina === 1) rel.arousal = Math.min(rel.arousal || 1, 5);
        // On the moment she drops: note WHEN (for autonomous waking) and WHERE she
        // is right now (party → with you; otherwise her scheduled spot), so an
        // unconscious NPC stays put instead of walking her schedule.
        if (rel.npcUnconscious && !was) {
            rel.koStep = currentGameState.timeStep || 0;
            rel.stashedAt = isInParty(npcName) ? currentGameState.currentLocation : scheduledLocationFor(npcName);
        }
        savePlayer();
        return rel;
    }
    // Wake a knocked-out NPC: restore her, clear the pin, and — if she comes to
    // somewhere the player ISN'T — record that she woke alone (for the reunion).
    function wakeNpc(npcName, rel, quiet = false) {
        rel.npcUnconscious = false;
        rel.npcStamina = npcMaxStamina(npcName);
        const where = rel.stashedAt;
        if (where && where !== currentGameState.currentLocation) {
            rel.wokeAloneAt = where;
            rel.wokeAloneStep = currentGameState.timeStep || 0;
        } else if (where && !quiet) {
            sendGhostMessage(`💫 ${npcName} stirs and comes to.`);
        }
        rel.stashedAt = null;
        rel.koStep = null;
    }
    // Each time a period passes, KO'd NPCs who've slept long enough wake up —
    // wherever they were left, with or without the player present.
    function recoverUnconscious(quiet = false) {
        const rd = getPlayerRpgData(); if (!rd) return;
        const step = currentGameState.timeStep || 0;
        for (const [name, rel] of Object.entries(rd.relationships || {})) {
            if (rel.npcUnconscious && (step - (rel.koStep ?? step)) >= KO_RECOVER_PERIODS) {
                wakeNpc(name, rel, quiet);
            }
        }
    }

    // === Breeding: internal orgasm → fertilization roll(s) (core-mechanics §6) ===
    function fertilityPercent(npcName) {
        const npc = (currentGameState.npcRoster || []).find(n => n.name === npcName);
        return Math.max(0, (npc?.fertility ?? 25) + npcStatMod(npcName, 'fertility'));   // base % + timed buffs
    }

    // Pregnancy stages by total progress %. Progress rises 5% per time step
    // (20%/day → term in 5 days). Once at Fetal (25%+) no new fertilizations.
    const PREGNANCY_STAGES = [
        { min: 5, max: 9, name: 'Zygote' },
        { min: 10, max: 24, name: 'Womb Implantation' },
        { min: 25, max: 34, name: 'Fetal' },
        { min: 35, max: 59, name: '1st Trimester' },
        { min: 60, max: 79, name: '2nd Trimester' },
        { min: 80, max: 99, name: '3rd Trimester' },
        { min: 100, max: 999, name: 'Birth Overdue' },
    ];
    const FERTILIZATION_LOCK_PCT = 25;   // Fetal stage onward: no new conceptions
    function pregnancyStage(pct) {
        if (!pct || pct <= 0) return null;
        if (pct < 5) return 'Zygote';
        for (const s of PREGNANCY_STAGES) if (pct >= s.min && pct <= s.max) return s.name;
        return 'Birth Overdue';
    }
    // Called on every Increment Time event — grows each active pregnancy 5%.
    function advancePregnancies(quiet = false) {
        const rd = getPlayerRpgData(); if (!rd) return;
        for (const [name, rel] of Object.entries(rd.relationships || {})) {
            // Any NPC carrying (pregnancies > 0) grows, even if progress was still 0.
            if ((rel.pregnancies || 0) > 0 && (rel.pregnancy_progress || 0) < OVERDUE_SOLO_BIRTH_PCT) {
                const before = rel.pregnancy_progress || 0;
                rel.pregnancy_progress = Math.min(OVERDUE_SOLO_BIRTH_PCT, before + 5);
                const s0 = pregnancyStage(before), s1 = pregnancyStage(rel.pregnancy_progress);
                if (!quiet && s1 && s1 !== s0) {
                    const carry = rel.pregnancies > 1 ? ` (${rel.pregnancies} fetuses)` : '';
                    sendGhostMessage(`🤰 ${name}'s pregnancy${carry} enters the **${s1}** stage — ${rel.pregnancy_progress}%.` +
                        (s1 === 'Fetal' ? ' She can no longer conceive further until this pregnancy ends.' :
                            s1 === 'Birth Overdue' ? ' She is at term and ready to give birth!' : ''));
                }
            }
            // Severely overdue and you never came to help: she births ALONE,
            // off-screen, wherever she is (logged for the reunion). If she's
            // present WITH you, leave it — the scene will narrate the birth.
            if ((rel.pregnancies || 0) > 0 && (rel.pregnancy_progress || 0) >= OVERDUE_SOLO_BIRTH_PCT) {
                const withYou = getNpcsAt(currentGameState.currentLocation).some(n => n.name === name);
                if (!withYou) autoBirthOffscreen(name);
            }
        }
        savePlayer();
    }
    // One player orgasm: −1 Stamina; if internal & P-in-V, roll fertilization
    // VIRILITY times, each at her Fertility% — so a single climax can take
    // multiple times (twins/triplets). `count` handles several climaxes.
    function resolvePlayerOrgasm(npcName, internal, count = 1) {
        let conceived = 0;
        const lines = [];
        for (let i = 0; i < Math.max(1, count); i++) {
            if (getPlayerRpgData()?.stats.unconscious) { lines.push('…you have no stamina left to give.'); break; }
            spendStamina(1);
            let line = `💦 Climax — −1 Stamina (now ${getStamina()}/${maxStamina()})`;
            if (internal && npcName) {
                const rel = getRelationship(npcName);
                if ((rel.pregnancy_progress || 0) >= FERTILIZATION_LOCK_PCT) {
                    // Fetal stage onward — womb already committed, can't take again.
                    line += ` · (already carrying, ${pregnancyStage(rel.pregnancy_progress)} — cannot conceive again)`;
                } else {
                    const virility = Math.max(1, effectiveStat('virility'));
                    const fpct = fertilityPercent(npcName);
                    let hits = 0;
                    for (let r = 0; r < virility; r++) if (Math.random() * 100 < fpct) hits++;
                    line += ` · ${virility} shot${virility > 1 ? 's' : ''} at ${fpct}% → ${hits > 0 ? `🌱 ${hits} took` : 'none took'}`;
                    if (hits > 0) {
                        rel.pregnancies = (rel.pregnancies || 0) + hits;
                        if (!rel.pregnancy_progress || rel.pregnancy_progress <= 0) rel.pregnancy_progress = 5; // conception = Zygote
                        if (!rel.conceptionKind) rel.conceptionKind = resolveConceptionKind(npcName);  // egg / crystal / live
                        conceived += hits; savePlayer();
                    }
                }
            }
            lines.push(line);
            if (getPlayerRpgData()?.stats.unconscious) { lines.push('🥴 Spent utterly — you slump into unconsciousness.'); break; }
        }
        if (conceived && npcName) {
            const rel = getRelationship(npcName);
            const multi = conceived === 1 ? '' : conceived === 2 ? ' (twins!)' : conceived === 3 ? ' (triplets!)' : ` (${conceived} at once!)`;
            lines.push(`🤰 ${conceived} new fertilization${conceived > 1 ? 's' : ''} this encounter${multi} — ${npcName} now carries **${rel.pregnancies}** total.`);
        }
        sendGhostMessage(lines.join('\n'));
        return { conceived };
    }

    // ========================================================================
    // BIRTH SYSTEM — term pregnancies deliver: live children, monster eggs, or
    // (for a soul-mage sire) inert soul-crystals. Each birth awards a Power Token.
    // Offspring linger at the mother's home as a footnote of the area. Overdue
    // mothers left unattended give birth ALONE off-screen at 150% (logged for the
    // reunion system). See core-mechanics.
    // ========================================================================
    const POWER_TOKEN_PER_BIRTH = 1;
    const OVERDUE_SOLO_BIRTH_PCT = 150;   // if never attended, she births alone here
    const EGG_HATCH_PERIODS = 8;          // 2 days
    // Races that lay eggs rather than bearing live young.
    const EGG_RACE = /dragon|draconic|wyrm|wyvern|drake|harpy|lamia|naga|serpent|reptil|avian|gryphon|griffon/i;

    function playerName() { return context.powerUserSettings.personas?.[playerAvatar()] || 'the adventurer'; }
    function playerPersonaText() {
        const av = playerAvatar();
        const pd = context.powerUserSettings.persona_descriptions?.[av] || {};
        const rd = getPlayerRpgData();
        return [pd.description, rd?.metadata?.character_class, rd?.metadata?.background, playerName()].filter(Boolean).join(' · ');
    }
    // What a conception will ultimately yield, decided at conception time.
    function resolveConceptionKind(npcName) {
        // The Crystal Curse (on either partner) overrides all — the issue is soulgems.
        if (isCrystalCursed('player') || isCrystalCursed(npcName)) return 'crystal';
        const npc = (currentGameState.npcRoster || []).find(n => n.name === npcName);
        if (EGG_RACE.test(npc?.race || '')) return 'egg';
        if (/soul[\s-]?crystal|soulshard|soul[\s-]?mage|soul[\s-]?wizard|necromancer|\blich\b|soulforge/i.test(playerPersonaText())) return 'crystal';
        return 'live';
    }
    function birthKindFor(npcName, override) {
        if (override && ['live', 'egg', 'crystal'].includes(override)) return override;
        const rel = getRelationship(npcName);
        return rel.conceptionKind || resolveConceptionKind(npcName);
    }
    function awardPowerTokens(n) {
        const rd = getPlayerRpgData(); if (!rd) return 0;
        rd.stats.power_tokens = (rd.stats.power_tokens || 0) + n;
        savePlayer();
        return rd.stats.power_tokens;
    }
    // Flavor name for a newborn, tinged by the mother's nature + the bond with you.
    function generateOffspringName(mother, rel, kind) {
        const R = () => Math.random();
        const pick = a => a[Math.floor(R() * a.length)];
        if (kind === 'crystal') return `Soulshard of ${mother?.name || 'the vessel'}`;   // a designation, not a name
        const pers = (mother?.personality || '').toLowerCase();
        const gentle = (rel?.affection || 0) >= 7 || /shy|gentle|warm|kind|soft|sweet|tender|motherly|elegant/.test(pers);
        const fierce = kind === 'egg' || /gruff|blunt|fierce|imperious|cranky|shrewd|sharp|proud|suspicious/.test(pers);
        const pre = fierce ? ['Vha', 'Zar', 'Rax', 'Kor', 'Dra', 'Vex', 'Mor', 'Ryn', 'Thal', 'Gorm']
            : gentle ? ['Ael', 'Lir', 'Nia', 'Sov', 'Eli', 'Mir', 'Wen', 'Fen', 'Ysa', 'Rina']
                : ['Ada', 'Ker', 'Bel', 'Tam', 'Oren', 'Sil', 'Hal', 'Ven', 'Cor', 'Del'];
        const suf = fierce ? ['rax', 'goth', 'mir', 'ka', 'zel', 'dan', 'ux', 'arr', 'oth']
            : gentle ? ['a', 'ith', 'wyn', 'elle', 'ora', 'iel', 'ny', 'ara', 'een']
                : ['en', 'is', 'ric', 'ard', 'wen', 'ley', 'os', 'ian'];
        let nm = (R() < 0.35 && mother?.name ? mother.name.slice(0, 2) : pick(pre)) + pick(suf);
        return nm.charAt(0).toUpperCase() + nm.slice(1).toLowerCase();
    }
    function offspringKindWord(kind, n) {
        if (kind === 'egg') return n > 1 ? 'eggs' : 'egg';
        if (kind === 'crystal') return n > 1 ? 'soul-crystals' : 'soul-crystal';
        return n > 1 ? 'children' : 'child';
    }
    /**
     * A birth: `count` young emerge from `npcName`. Awards Power Tokens, creates
     * lingering offspring records at the mother's home, decrements her pregnancy
     * count (resetting progress when the last one is out), and logs it. When
     * unattended (she births alone off-screen), stays silent and flags the
     * reunion system instead.
     */
    function resolveBirth(npcName, count, kindOverride, attended = true) {
        const rel = getRelationship(npcName);
        const carrying = rel.pregnancies || 0;
        if (carrying <= 0) { if (attended) sendGhostMessage(`(${npcName} has nothing to deliver right now.)`); return null; }
        const n = Math.max(1, Math.min(count || 1, carrying));
        const kind = birthKindFor(npcName, kindOverride);
        const mother = (currentGameState.npcRoster || []).find(n2 => n2.name === npcName);
        const homeLoc = mother?.homeLocation || rel.stashedAt || currentGameState.currentLocation;
        const step = currentGameState.timeStep || 0, day = currentGameState.dayCount;
        const born = [];
        currentGameState.offspring = currentGameState.offspring || [];
        for (let i = 0; i < n; i++) {
            const nm = generateOffspringName(mother, rel, kind);
            born.push({
                id: `${npcName}-${step}-${i}-${Math.floor(Math.random() * 1e6)}`,
                name: nm, motherName: npcName, fatherName: playerName(), kind,
                bornStep: step, bornDay: day, locationId: homeLoc,
                hatched: kind !== 'egg', hatchStep: kind === 'egg' ? step + EGG_HATCH_PERIODS : null,
            });
        }
        currentGameState.offspring.push(...born);
        rel.pregnancies = carrying - n;
        if (rel.pregnancies <= 0) { rel.pregnancy_progress = 0; rel.conceptionKind = null; }
        const tokens = kind === 'crystal' ? (getPlayerRpgData()?.stats.power_tokens || 0) : awardPowerTokens(POWER_TOKEN_PER_BIRTH * n);
        rel.lastBirth = { kind, count: n, step, day, at: homeLoc, attended };
        if (!attended) rel.bornAlone = { kind, count: n, at: homeLoc, step };   // for the reunion note
        saveCurrentState();

        if (attended) {
            const names = born.map(b => b.name).join(', ');
            const tokLine = kind === 'crystal'
                ? ` The crystals are inert and non-viable — no Power Token.`
                : ` ⭐ +${POWER_TOKEN_PER_BIRTH * n} Power Token${n > 1 ? 's' : ''} (total ${tokens}).`;
            sendGhostMessage(`👶 **Birth!** ${npcName} brings forth ${n} ${offspringKindWord(kind, n)}: **${names}**${kind === 'egg' ? ' — they will hatch in ~2 days' : ''}.${tokLine}` +
                (rel.pregnancies > 0 ? ` (${rel.pregnancies} still to come.)` : ''));
        }
        return { born, kind, tokens, remaining: rel.pregnancies };
    }
    // Overdue mothers you never came back for deliver ALONE, off-screen. Called
    // from advancePregnancies once a pregnancy passes the solo-birth threshold.
    function autoBirthOffscreen(npcName) {
        const rel = getRelationship(npcName);
        resolveBirth(npcName, rel.pregnancies || 1, null, false);   // silent; flags rel.bornAlone
    }
    // Eggs hatch a couple of days after being laid.
    function hatchEggs(quiet = false) {
        const step = currentGameState.timeStep || 0;
        for (const o of (currentGameState.offspring || [])) {
            if (o.kind === 'egg' && !o.hatched && o.hatchStep != null && step >= o.hatchStep) {
                o.hatched = true;
                if (!quiet && o.locationId === currentGameState.currentLocation) {
                    sendGhostMessage(`🥚➡️ **${o.name}** hatches — ${o.motherName}'s young stirs to life here.`);
                }
            }
        }
        saveCurrentState();
    }
    // A short footnote describing the offspring lingering at a location.
    function offspringFootnote(locationId) {
        const here = (currentGameState.offspring || []).filter(o => o.locationId === locationId);
        if (!here.length) return '';
        const bits = here.map(o => {
            if (o.kind === 'egg' && !o.hatched) return `🥚 ${o.name} (${o.motherName}'s unhatched egg)`;
            if (o.kind === 'egg') return `🐣 ${o.name} (${o.motherName}'s hatchling)`;
            if (o.kind === 'crystal') return `💎 ${o.name} (a dull soul-crystal — spell-fuel; crush for Mana)`;
            return `👶 ${o.name} (${o.motherName}'s child)`;
        });
        return `\n\n🏠 About the area: ${bits.join(', ')}.`;
    }

    // ========================================================================
    // CRYSTAL CURSE — a dark affliction (see the RPG Custodian lorebook) that
    // turns the afflicted's issue to inert soulgems. Can be laid on the male
    // player OR a female NPC. PERMANENT until broken by magic; a timed casting
    // may instead be given a duration. Drives conceptionKind = 'crystal'.
    // ========================================================================
    function curseActive(c) {
        return !!(c && c.active) && (c.expiresStep == null || (currentGameState.timeStep || 0) < c.expiresStep);
    }
    function isCrystalCursed(target) {
        if (!target || target === 'player') return curseActive(getPlayerRpgData()?.crystalCurse);
        return curseActive(getRelationship(target).crystalCurse);
    }
    function applyCrystalCurse(target, duration, breakCondition) {
        const exp = duration && duration > 0 ? (currentGameState.timeStep || 0) + duration : null;
        const rec = { active: true, expiresStep: exp, appliedStep: currentGameState.timeStep || 0, breakCondition: breakCondition || null, justCreated: true };
        if (!target || target === 'player') { const rd = getPlayerRpgData(); if (!rd) return; rd.crystalCurse = rec; }
        else { getRelationship(target).crystalCurse = rec; }
        const self = (!target || target === 'player');
        const dur = exp == null ? 'It is **permanent** until broken by magic.' : `It will hold for ${duration} time period(s) unless broken sooner.`;
        const brk = rec.breakCondition ? `\n_Broken only when: ${rec.breakCondition}_` : '';
        sendGhostMessage(`💠🩸 **Crystal Curse laid.** ${self ? 'You are' : `${target} is`} now afflicted — any child ${self ? 'you sire' : 'she bears'} will be born an inert soulgem, not living young. ${dur}${brk}`);
        savePlayer();
    }
    function liftCrystalCurse(target) {
        if (!isCrystalCursed(target)) { sendGhostMessage(`(No active Crystal Curse to lift${target && target !== 'player' ? ` from ${target}` : ''}.)`); return; }
        const self = (!target || target === 'player');
        if (self) { const rd = getPlayerRpgData(); if (rd) rd.crystalCurse = null; }
        else { getRelationship(target).crystalCurse = null; }
        sendGhostMessage(`✨💠 **Crystal Curse broken!** ${self ? 'You are' : `${target} is`} freed of the affliction — ${self ? 'your' : 'her'} bloodline can bear living young once more.`);
        savePlayer();
    }
    // --- Debuff contest (the seed of the spell system): a caster's power vs the
    // victim's Ruggedness to resist. Reusable for every future curse/debuff. ---
    const CURSE_RESIST_BASE = 8;   // DC = base + target's Ruggedness
    function ruggednessOf(target) {
        if (!target || target === 'player') return effectiveStat('ruggedness');
        const npc = (currentGameState.npcRoster || []).find(n => n.name === target);
        return Math.max(1, (npc?.ruggedness ?? 3) + npcStatMod(target, 'ruggedness'));
    }
    // attackVal = caster's Craftiness (player) OR a proxy power level (NPC/trap/item).
    function debuffContest(attackVal, targetName) {
        const resist = ruggednessOf(targetName);
        const dc = CURSE_RESIST_BASE + resist;
        const d1 = rollDie(), d2 = rollDie();
        const total = d1 + d2 + attackVal;
        return { success: total >= dc, total, dc, d1, d2, dice: d1 + d2, attackVal, resist };
    }
    // Resolve an apply_curse: figure the attacker's power, run the resist contest
    // (unless story-forced), and lay the Crystal Curse on a success.
    function tryApplyCrystalCurse(eff) {
        const target = eff.target || 'player';
        let attack, attackerLabel;
        if (eff.power != null) { attack = Number(eff.power) || 0; attackerLabel = eff.source || 'the dark magic'; }           // trap / cursed item: power proxies the caster
        else if (eff.caster && eff.caster !== 'player') { attack = ruggednessOf(eff.caster); attackerLabel = eff.caster; }   // NPC caster w/o stated power → rough proxy
        else { attack = effectiveStat('craftiness'); attackerLabel = playerName(); }                                         // the player casts with Craftiness
        if (eff.contest === false) { applyCrystalCurse(target, eff.duration, eff.break_condition); return; }   // an inescapable / narrative-forced curse
        const c = debuffContest(attack, target);
        const targetLabel = target === 'player' ? 'you' : target;
        sendGhostMessage(`💠🎲 **Crystal Curse — resist contest**: ${attackerLabel} (power ${attack}) vs ${targetLabel}'s Ruggedness ${c.resist} → 2d6 [${c.dice}] + ${attack} = **${c.total}** vs DC ${c.dc} → ${c.success ? '💠 **the curse takes hold!**' : '🛡️ **RESISTED** — the hex slides off.'}`);
        if (c.success) applyCrystalCurse(target, eff.duration, eff.break_condition);
    }

    // --- Mana + soul crystals (spell-fuel). A soul crystal item = +1 Mana. ---
    function maxMana() { return Math.max(1, effectiveStat('craftiness')); }
    function restoreMana(n) {
        const rd = getPlayerRpgData(); if (!rd) return 0;
        const before = rd.stats.mana || 0;
        rd.stats.mana = Math.min(maxMana(), before + n);
        savePlayer();
        return rd.stats.mana - before;
    }
    function isSoulCrystalName(name) { return /soul[\s_-]?crystal|soulshard|soul[\s_-]?gem|soulgem|mana crystal/i.test(String(name || '')); }
    // Free-form Mana replenishment from any arcane source (a font/pool of liquid
    // mana, a mana potion, meditating at a ley-line, absorbing a spell). amount =
    // points, or 'full'/null for a brimming source. The Custodian's `restore_mana`.
    function restoreManaEffect(target, amount) {
        const rd = getPlayerRpgData(); if (!rd) return;   // only the player tracks Mana for now
        const full = amount == null || amount === 'full' || amount === 'max';
        const before = rd.stats.mana || 0, max = maxMana();
        rd.stats.mana = full ? max : Math.min(max, before + (Number(amount) || 0));
        savePlayer();
        const gained = rd.stats.mana - before;
        sendGameMasterMessage(`🔮 Arcane energy flows into you${gained > 0 ? ` (+${gained} Mana)` : ''} — Mana **${rd.stats.mana}/${max}**${gained <= 0 ? ' (already brimming)' : ''}.`);
    }

    // Timed curses (the rarer, non-permanent castings) fade when they expire.
    function pruneCurses(quiet = false) {
        const rd = getPlayerRpgData(); if (!rd) return;
        const step = currentGameState.timeStep || 0;
        const expire = (holder, label) => {
            const c = holder.crystalCurse;
            if (c && c.active && c.expiresStep != null && step >= c.expiresStep) {
                holder.crystalCurse = null;
                if (!quiet) sendGhostMessage(`💠 The Crystal Curse fades from ${label}.`);
            }
        };
        expire(rd, 'you');
        for (const [name, rel] of Object.entries(rd.relationships || {})) expire(rel, name);
        savePlayer();
    }

    // ========================================================================
    // BESPOKE STATUS EFFECTS — the Custodian can invent positive or negative
    // effects with arbitrary stat modifiers and a natural-language END CONDITION,
    // judged each turn by the task-satisfied checker (which quests can borrow).
    // ========================================================================
    function playerCustomEffects() { return (getPlayerRpgData()?.customEffects || []).filter(e => e.active !== false); }
    function playerStatusesOnly() { return playerCustomEffects().filter(e => e.category !== 'quest'); }
    function playerObjectives() { return playerCustomEffects().filter(e => e.category === 'quest'); }
    // A status's mods apply WHENEVER it is active (the status being active IS the
    // condition — unlike equipment, there is no situational sub-condition). Works
    // for any stat name, including npc-only 'fertility'/'stamina'.
    function effectStatMod(effects, stat) {
        return (effects || []).filter(e => e.active !== false).reduce((sum, e) =>
            sum + (e.mods || []).filter(m => m.stat === stat).reduce((a, m) => a + (Number(m.amount) || 0), 0), 0);
    }
    function customStatMod(stat) { return effectStatMod(getPlayerRpgData()?.customEffects, stat); }
    // NPC-side equivalent — folds an NPC's own bespoke effects into her real
    // numbers (fertility, stamina, ruggedness, resist DC…). Replaces npcBuffFor.
    function npcStatMod(npcName, stat) { return effectStatMod(getRelationship(npcName).customEffects, stat); }
    function npcActiveEffects(npcName) { return (getRelationship(npcName).customEffects || []).filter(e => e.active !== false); }
    function effectLine(e) { const el = statusEndsLabel(e); return `${effectIcon(e)} ${e.name}${statusModString(e.mods)}${el ? ` (${el})` : ''}`; }
    function statusIcon(pol) { return pol === 'positive' ? '🌟' : pol === 'negative' ? '☠️' : '✨'; }
    // Unified effect vocabulary — buff/debuff/pact/blessing/vow/curse/quest are all
    // one thing (an effect that is applied and later ends); `kind` just picks the face.
    const KIND_ICON = { buff: '🌟', blessing: '🌟', boon: '🌟', debuff: '☠️', disease: '🤢', poison: '🧪', curse: '💠', hex: '💠', pact: '🤝', vow: '🤝', oath: '🤝', deal: '🤝', quest: '📜', task: '📜', errand: '📜', status: '✨' };
    function effectIcon(e) { return KIND_ICON[String(e?.kind || '').toLowerCase()] || statusIcon(e?.polarity); }
    function statusModString(mods) {
        return (mods || []).length ? ` [${mods.map(m => `${(Number(m.amount) || 0) >= 0 ? '+' : ''}${m.amount} ${m.stat}${m.condition ? ` (${m.condition})` : ''}`).join(', ')}]` : '';
    }
    function statusEndsLabel(e) {
        const bits = [];
        if (e.expiresOnCheck) bits.push(`next ${e.expiresOnCheck} trial`);
        if (e.expiresStep != null) bits.push(`${Math.max(0, e.expiresStep - (currentGameState.timeStep || 0))} periods left`);
        if (e.endCondition) bits.push(e.endCondition);
        return bits.join(', or ');
    }
    function rewardLabel(r) {
        if (!r) return '';
        const b = [];
        if (r.gold) b.push(`${r.gold} gold`);
        if (r.xp) b.push(`${r.xp} XP`);
        if (r.tokens) b.push(`⭐ ${r.tokens} Power Token${r.tokens > 1 ? 's' : ''}`);
        if (r.item) b.push(prettyItem(r.item));
        return b.join(', ');
    }
    function grantReward(r) {
        if (!r) return;
        if (r.gold) addGold(r.gold);
        if (r.xp) { const rd = getPlayerRpgData(); if (rd) rd.stats.experience = (rd.stats.experience || 0) + r.xp; }
        if (r.tokens) awardPowerTokens(r.tokens);
        if (r.item) addItem({ id: `${String(r.item).toLowerCase().replace(/\s+/g, '-')}-${currentGameState.timeStep || 0}-${Math.floor(Math.random() * 1e5)}`, name: r.item, desc: '' });
        savePlayer();
    }
    // A quest, oath, pact, or errand IS a "silent status" — same store, same
    // end-condition watcher. category:'quest' completes with a reward when met.
    function addCustomStatus(target, spec) {
        const dur = Number(spec.duration) > 0 ? Math.floor(Number(spec.duration)) : null;   // time-increment lifespan
        const category = spec.category === 'quest' ? 'quest' : 'status';
        const rec = {
            id: `st-${currentGameState.timeStep || 0}-${Math.floor(Math.random() * 1e6)}`,
            name: spec.name || (category === 'quest' ? 'a task' : 'a strange effect'),
            category,
            kind: (spec.kind && String(spec.kind).toLowerCase()) || (category === 'quest' ? 'quest' : 'status'),
            polarity: spec.polarity === 'positive' ? 'positive' : spec.polarity === 'negative' ? 'negative' : 'neutral',
            desc: spec.desc || '',
            mods: Array.isArray(spec.mods) ? spec.mods.filter(m => m && m.stat) : [],
            endCondition: spec.endCondition || spec.end_condition || spec.objective || null,
            expiresOnCheck: (spec.expiresOnCheck || spec.expires_on_check) ? String(spec.expiresOnCheck || spec.expires_on_check).toLowerCase() : null,  // spent on next trial of that stat
            reward: spec.reward || null,
            expiresStep: dur ? (currentGameState.timeStep || 0) + dur : null,   // deterministic timer (reuses buff-style expiry)
            active: true, createdStep: currentGameState.timeStep || 0,
            justCreated: true,   // immune to its own end-check on the turn it's applied
        };
        const isPlayer = (!target || target === 'player');
        const holder = isPlayer ? getPlayerRpgData() : getRelationship(target);
        if (!holder) return null;
        holder.customEffects = holder.customEffects || [];
        holder.customEffects.push(rec);
        // A positive STAMINA mod (a stamina potion/invigorating draught) also tops
        // up current Stamina by that much and revives from unconsciousness — the
        // extra headroom is felt now, not just as a raised max.
        const staMod = rec.mods.filter(m => m.stat === 'stamina').reduce((a, m) => a + (Number(m.amount) || 0), 0);
        if (staMod > 0) {
            if (isPlayer) {
                holder.stats.stamina = Math.min(maxStamina(), (holder.stats.stamina ?? maxStamina()) + staMod);
                if (holder.stats.stamina > 0) holder.stats.unconscious = false;
            } else {
                holder.npcStamina = Math.min(npcMaxStamina(target), (holder.npcStamina ?? npcMaxStamina(target)) + staMod);
                if (holder.npcStamina > 0) holder.npcUnconscious = false;
            }
        }
        savePlayer();
        const ends = [rec.expiresOnCheck ? `your next ${rec.expiresOnCheck} trial` : null, dur ? `${dur} time period${dur > 1 ? 's' : ''} pass` : null, rec.endCondition].filter(Boolean).join(', or ');
        if (category === 'quest') {
            const rw = rewardLabel(rec.reward);
            sendGhostMessage(`📜 **New objective: ${rec.name}** — ${rec.endCondition || rec.desc || 'see it through'}.${statusModString(rec.mods)}${rw ? `\n_Reward: ${rw}._` : ''}`);
        } else {
            const who = (!target || target === 'player') ? 'You gain' : `${target} gains`;
            const kindWord = rec.kind && rec.kind !== 'status' ? rec.kind : `${rec.polarity} status`;
            sendGhostMessage(`${effectIcon(rec)} **${rec.name}** — ${who} a ${kindWord}.${statusModString(rec.mods)}${rec.desc ? ` ${rec.desc}` : ''}${ends ? `\n_Ends when: ${ends}._` : ''}`);
        }
        return rec;
    }
    // Finish a quest-objective: grant its reward, announce, remove it.
    function completeObjective(target, e) {
        const holder = (!target || target === 'player') ? getPlayerRpgData() : getRelationship(target);
        if (!holder?.customEffects) return;
        holder.customEffects = holder.customEffects.filter(x => x !== e);
        grantReward(e.reward);
        const rw = rewardLabel(e.reward);
        sendGhostMessage(`🏆 **Objective complete: ${e.name}!**${rw ? ` Reward: ${rw}.` : ''}`);
        savePlayer();
    }
    // Time-based expiry for custom statuses (reuses the buff-duration pattern).
    function pruneCustomStatuses(quiet = false) {
        const rd = getPlayerRpgData(); if (!rd) return;
        const step = currentGameState.timeStep || 0;
        const expire = (holder, label) => {
            if (!holder.customEffects?.length) return;
            const gone = holder.customEffects.filter(e => e.expiresStep != null && step >= e.expiresStep);
            if (!gone.length) return;
            holder.customEffects = holder.customEffects.filter(e => !gone.includes(e));
            if (!quiet) for (const e of gone) sendGhostMessage(e.category === 'quest'
                ? `⌛ Objective **${e.name}** expired — the chance has passed.`
                : `⌛ ${label} **${e.name}** ${e.polarity === 'positive' ? 'fades' : 'passes'}.`);
        };
        expire(rd, 'Your');
        for (const [name, rel] of Object.entries(rd.relationships || {})) {
            expire(rel, `${name}'s`);
            // Arousal cools by 1 per time period toward calm (romance-redesign
            // §D) — bodies cool off; affection doesn't. Step-guarded so a
            // repeated prune in the same period can't double-decay.
            if ((rel.arousal || 1) > 1 && rel.arousalDecayStep !== step) {
                rel.arousal -= 1;
                rel.arousalDecayStep = step;
            }
        }
        savePlayer();
    }
    function removeCustomStatus(target, name, reason) {
        const holder = (!target || target === 'player') ? getPlayerRpgData() : getRelationship(target);
        if (!holder?.customEffects) return false;
        const want = String(name || '').toLowerCase();
        const removed = holder.customEffects.filter(e => e.name.toLowerCase() === want || (want && e.name.toLowerCase().includes(want)));
        if (!removed.length) return false;
        holder.customEffects = holder.customEffects.filter(e => !removed.includes(e));
        savePlayer();
        for (const e of removed) sendGhostMessage(`✅ **${e.name}** ends${reason ? ` — ${reason}` : ''}.`);
        return true;
    }
    // Permanent stat change (a level-up boon, a curse that drains, a blessing that
    // etches itself in). Distinct from timed buffs and conditional statuses.
    function adjustStat(target, stat, amount) {
        if (!target || target === 'player') {
            const rd = getPlayerRpgData();
            if (!rd || !(stat in (rd.stats || {}))) return;
            rd.stats[stat] = Math.max(0, (rd.stats[stat] || 0) + (Number(amount) || 0));
            savePlayer();
            sendGhostMessage(`📊 Your **${stat}** ${amount >= 0 ? 'rises' : 'falls'} by ${Math.abs(amount)} → **${rd.stats[stat]}** (permanent).`);
        } else {
            const npc = (currentGameState.npcRoster || []).find(n => n.name === target);
            if (npc && stat in npc) { npc[stat] = Math.max(0, (npc[stat] || 0) + (Number(amount) || 0)); saveCurrentState(); }
        }
    }

    // === Task-satisfied checker: the Custodian judges whether natural-language
    // conditions have JUST been met by the story. Powers status end-conditions,
    // curse-break conditions, and (reusable) quest objectives. ===
    async function evaluateConditions(items) {
        if (!items.length) return {};
        const sys = `You are the RPG rules JUDGE, and you are VERY STRICT. Given the recent story and a numbered list of CONDITIONS, decide for EACH whether the story shows it FULLY and UNAMBIGUOUSLY COMPLETED — the whole thing actually finished, on-screen, with its effect realized. Default to FALSE. A condition is NOT met by any of: approaching, arriving, asking, offering, agreeing, intending, preparing, beginning, attempting, examining, tending, or being about to do it. For a CURE/TREATMENT specifically: the remedy must be ADMINISTERED to the patient AND shown TAKING EFFECT (they drink/receive it and visibly recover) — a healer looking at, reaching for, mixing, or promising a remedy is FALSE. For a time span ("rest a full day"): that much time must have actually passed. It is far better to leave an effect running one extra turn than to end it early — when there is ANY doubt, answer false. Output ONLY a JSON object mapping each id to true or false, nothing else.`;
        const list = items.map(it => `- id "${it.id}": ${it.text}`).join('\n');
        const prompt = `RECENT STORY:\n${recentSceneForAnalyzer()}\n\nCONDITIONS TO JUDGE:\n${list}\n\nOutput JSON like {"<id>": true|false, ...}.`;
        try {
            const parsed = await generateJson({ prompt, systemPrompt: sys, budget: 300 });
            return (parsed && typeof parsed === 'object') ? parsed : {};
        } catch (e) { console.error('RPG Custodian: condition eval failed', e); return {}; }
    }
    // Run after a turn's story resolves: end statuses / break curses whose
    // condition the story just satisfied. One judge call per turn (only if pending).
    async function checkPendingConditions() {
        const rd = getPlayerRpgData(); if (!rd) return;
        const pending = [];
        // An effect is not eligible to end on the very turn it was applied (its own
        // arrival narration must not be mistaken for its resolution). Clear the flag
        // as we pass, so it becomes checkable from the NEXT turn on.
        const regStatuses = (holder, target) => {
            for (const e of (holder.customEffects || [])) {
                if (e.active === false || !e.endCondition) continue;
                if (e.justCreated) { e.justCreated = false; continue; }
                pending.push({ kind: e.category === 'quest' ? 'quest' : 'status', id: e.id, text: e.endCondition, target, name: e.name, ref: e });
            }
        };
        const regCurse = (holder, target) => {
            const c = holder.crystalCurse;
            if (!c || !c.active || !c.breakCondition) return;
            if (c.justCreated) { c.justCreated = false; return; }
            pending.push({ kind: 'curse', id: `curse-${target}`, text: c.breakCondition, target });
        };
        regStatuses(rd, 'player'); regCurse(rd, 'player');
        for (const [name, rel] of Object.entries(rd.relationships || {})) { regStatuses(rel, name); regCurse(rel, name); }
        savePlayer();
        if (!pending.length) return;
        const verdict = await evaluateConditions(pending.map(p => ({ id: p.id, text: p.text })));
        for (const p of pending) {
            if (verdict[p.id] !== true) continue;
            if (p.kind === 'quest') completeObjective(p.target, p.ref);
            else if (p.kind === 'status') removeCustomStatus(p.target, p.name, 'its condition was met');
            else if (p.kind === 'curse') liftCrystalCurse(p.target);
        }
    }

    // ========================================================================
    // EQUIPMENT — items carry a Custodian-appraised effect shown beside the name.
    // Wearable gear (a weapon, an amulet) is equipped for a flat stat bonus;
    // consumables are used. Contextual effects ("+1 craftiness IN NATURE") are
    // surfaced to the Custodian, which weighs them into the DC.
    // ========================================================================
    function equipStatMod(stat) {
        const rd = getPlayerRpgData(); if (!rd) return 0;
        return (rd.inventory?.items || []).filter(i => i.equipped && i.mod && i.mod.stat === stat && !i.mod.condition).reduce((a, i) => a + (Number(i.mod.amount) || 0), 0);
    }
    function itemIsConsumable(item) {
        if (item.usage) return item.usage === 'consume';                       // Custodian-appraised
        if (item.effect?.type === 'stat_boost') return true;
        if (isSoulCrystalName(item.name)) return true;
        return /potion|elixir|draught|tonic|brew|ale|food|bread|meal|apple|ration|scroll|philtre|remedy|salve|antidote|tea|water|milk/i.test(item.name);
    }
    function itemLabel(item) {
        const eff = item.effectText ? `  — ${item.effectText}` : '';
        return `${item.equipped ? '✅ ' : ''}${prettyItem(item.name)}${eff}`;
    }
    // Inventory-click behavior: consume it, or toggle-equip it.
    function toggleOrUseItem(item) {
        if (itemIsConsumable(item)) { useItem(item); return; }
        item.equipped = !item.equipped;
        savePlayer(); renderActionBar();
        sendGhostMessage(item.equipped
            ? `🎽 Equipped **${prettyItem(item.name)}**${item.effectText ? ` — ${item.effectText}` : ''}.`
            : `👝 Removed **${prettyItem(item.name)}**.`);
    }
    function setEquipItemByName(name, on) {
        const it = useItemByNameFuzzy(name);
        if (!it) return;
        if (on && itemIsConsumable(it)) { useItem(it); return; }   // "equip the potion" → just use it
        it.equipped = on;
        savePlayer(); renderActionBar();
        sendGhostMessage(on
            ? `🎽 Equipped **${prettyItem(it.name)}**${it.effectText ? ` — ${it.effectText}` : ''}.`
            : `👝 Removed **${prettyItem(it.name)}**.`);
    }
    function equippedItemsSummary() {
        const rd = getPlayerRpgData();
        return (rd?.inventory?.items || []).filter(i => i.equipped).map(i => `${prettyItem(i.name)}${i.effectText ? ` (${i.effectText})` : ''}`);
    }

    // The Custodian appraises each new item — a brief effect shown next to its
    // name, plus a structured flat/contextual modifier. Queued so appraisals run
    // one at a time AFTER generation is idle (never racing the analyzer).
    const _appraiseQueue = [];
    let _appraising = false;
    function queueAppraise(item) { if (item && !item.effectText) { _appraiseQueue.push(item); processAppraiseQueue(); } }
    async function processAppraiseQueue() {
        if (_appraising) return;
        _appraising = true;
        try {
            while (_appraiseQueue.length) {
                const item = _appraiseQueue.shift();
                if (!item || item.effectText) continue;
                if (!(await waitForGenerationIdle(15000))) { continue; }
                await appraiseItem(item);
            }
        } finally { _appraising = false; }
    }
    async function appraiseItem(item) {
        try {
            const sys = `You are the RPG ITEM APPRAISER. Given an item, invent a BRIEF, BALANCED equipment effect. Output ONLY JSON:\n{"effect":"<max ~6 words shown next to the name, e.g. '+1 Craftiness in nature', 'No penalty in the dark', '+1 Ruggedness for combat'>","usage":"equip"|"consume","slot":"weapon|offhand|armor|head|accessory|tool|none","stat":"ruggedness|charm|craftiness|virility"|null,"amount":<integer, usually 1, rarely 2>,"condition":"<short phrase for WHEN a stat bonus applies, or empty string if always>"}\nRules: wearable gear/tools/weapons/jewelry → "equip"; potions/food/scrolls/one-use → "consume" (and usually stat null). Keep bonuses small. If the effect is purely situational (light source, etc.) set stat null.`;
            const prompt = `Item: "${prettyItem(item.name)}"${item.desc ? ` — ${item.desc}` : ''}.`;
            const p = await generateJson({ prompt, systemPrompt: sys, budget: 160 });
            if (!p) return;
            item.effectText = (p.effect && String(p.effect).trim()) || item.effectText || '';
            if (p.usage === 'consume' || p.usage === 'equip') item.usage = p.usage;
            if (p.slot && p.slot !== 'none') item.slot = p.slot;
            const stat = ['ruggedness', 'charm', 'craftiness', 'virility'].includes(p.stat) ? p.stat : null;
            if (stat && Number(p.amount)) item.mod = { stat, amount: Number(p.amount), condition: (p.condition && String(p.condition).trim()) ? String(p.condition).trim() : null };
            savePlayer();
            renderActionBar();
        } catch (e) { console.error('RPG Custodian: appraise failed', e); }
    }

    // --- Contextual action bar (buttons above the input) ---
    function openActionPopup(title, items) {
        $('#rpg-action-popup').remove();
        const pop = $('<div id="rpg-action-popup" class="rpg-popup"></div>');
        pop.append($('<div class="rpg-popup-title"></div>').text(title));
        for (const item of items) {
            const row = $('<div class="rpg-menu-item"></div>');
            row.html(`${item.icon} ${$('<span>').text(item.label).html()}` + (item.sub ? `<div class="rpg-item-sub"></div>` : ''));
            if (item.sub) row.find('.rpg-item-sub').text(item.sub);
            row.on('click', async (e) => {
                e.stopPropagation();
                $('#rpg-action-popup').remove();
                try { await item.action(); } catch (err) { console.error('RPG Custodian: action failed', err); }
            });
            pop.append(row);
        }
        $('body').append(pop);
        // Center-bottom above the input.
        const bar = document.getElementById('rpg-action-bar');
        const anchorTop = bar ? bar.getBoundingClientRect().top : window.innerHeight - 120;
        const el = pop[0];
        const left = Math.max(8, Math.min((window.innerWidth - el.offsetWidth) / 2, window.innerWidth - el.offsetWidth - 8));
        let top = anchorTop - el.offsetHeight - 8;
        if (top < 8) top = 8;
        pop.css({ left: `${left}px`, top: `${top}px` });
        setTimeout(() => $(document).one('click.rpgActionPop', () => $('#rpg-action-popup').remove()), 0);
    }

    function ensureActionBar() {
        if (document.getElementById('rpg-action-bar')) return;
        const bar = $('<div id="rpg-action-bar"></div>');
        const sendForm = $('#send_form');
        if (sendForm.length) sendForm.before(bar);
        else $('#rightSendForm').before(bar);
    }

    function renderActionBar() {
        if (!currentGameState.isActive) { $('#rpg-action-bar').remove(); return; }
        ensureActionBar();
        const bar = $('#rpg-action-bar');
        bar.empty();

        const mkBtn = (label, handler) => {
            const b = $('<button class="rpg-action-btn"></button>').html(label);
            b.on('click', (e) => { e.stopPropagation(); handler(); });
            return b;
        };

        // Core verbs
        bar.append(mkBtn('🚶 Move', () => {
            const loc = currentGameState.worldData.locations[currentGameState.currentLocation];
            const items = (loc.connections || []).map(c => ({
                icon: '🚪', label: currentGameState.worldData.locations[c]?.name || c,
                action: () => moveCommand({}, c),
            }));
            openActionPopup('Travel to…', items);
        }));
        bar.append(mkBtn('👀 Look', () => {
            const present = getNpcsAt(currentGameState.currentLocation);
            const items = [
                { icon: '🏞️', label: 'Examine your surroundings', action: () => lookCommand({}, '') },
                { icon: '🪞', label: 'Look at yourself', sub: 'your stats, stamina, gold & buffs', action: () => examineSelf() },
            ];
            for (const npc of present) items.push({ icon: '🔍', label: `Look at ${npc.name}`, sub: npc.role, action: () => examineNpc(npc.name) });
            openActionPopup('Look at…', items);
        }));
        bar.append(mkBtn('⏳ Wait', () => waitCommand({}, '')));
        bar.append(mkBtn(`🎒 Items${getGold() ? ` (${getGold()}g)` : ''}`, () => openInventory()));
        // No per-NPC mechanical buttons (shop/wrestle/quest) — those are handled
        // through natural language via the Intent Analyzer. The bar stays to the
        // simple, always-useful verbs only.
    }

    // ========================================================================
    // INTENT ANALYZER — emergent natural-language → mechanics
    // ========================================================================
    // Per player action (core-mechanics §11), resolve BEFORE narrating:
    //   1) A separate analyzer LLM call classifies the NL action: does it
    //      challenge a stat (skill check) and/or change state (items/gold)?
    //   2) The engine rolls (if a check) and applies effects — deterministic.
    //   3) A silent system line records the mechanical result.
    //   4) The Game Master narrates that result briefly (LLM).
    //   5) The addressed NPC reacts to the result from her OWN card (LLM).
    // The GM never speaks NPC lines; NPCs are never scripted.

    const NON_ANALYZED_TYPES = new Set(['quiet', 'impersonate', 'continue', 'regenerate', 'swipe', 'ask_command']);

    const INTENT_SCHEMA = {
        type: 'object',
        properties: {
            mechanical: { type: 'boolean' },
            check: {
                type: ['object', 'null'],
                properties: {
                    stat: { type: 'string', enum: ['ruggedness', 'charm', 'craftiness', 'virility'] },
                    difficulty: { type: 'integer' },
                    reason: { type: 'string' },
                },
            },
            effects_on_success: { type: 'array', items: { type: 'object' } },
            effects_on_failure: { type: 'array', items: { type: 'object' } },
            target_npc: { type: ['string', 'null'] },
            narration_hint: { type: 'string' },
        },
        required: ['mechanical'],
    };

    function statsContextForAnalyzer() {
        const rd = getPlayerRpgData();
        if (!rd) return 'no character';
        let s = `ruggedness ${effectiveStat('ruggedness')} (strength/stamina/physical feats), ` +
            `charm ${effectiveStat('charm')} (social/persuasion/seduction), ` +
            `craftiness ${effectiveStat('craftiness')} (intellect/magic/perception/guile/spotting lies), ` +
            `virility ${effectiveStat('virility')} (fertility); ` +
            `Stamina ${getStamina()}/${maxStamina()} (HP for combat & sex), Mana ${rd.stats.mana ?? 0}/${maxMana()} (magic pool); ` +
            `gold ${rd.inventory.currency}; inventory [${rd.inventory.items.map(i => i.name).join(', ') || 'empty'}]`;
        const worn = equippedItemsSummary();
        if (worn.length) s += `; EQUIPPED (factor situational bonuses into your DC): ${worn.join(', ')}`;
        const statuses = playerCustomEffects();
        if (statuses.length) s += `; active statuses: ${statuses.map(e => `${e.name}${statusModString(e.mods)}`).join(', ')}`;
        return s;
    }

    function presentNpcContextForAnalyzer() {
        const present = getNpcsAt(currentGameState.currentLocation);
        if (!present.length) return 'none';
        return present.map(n => {
            const t = affectionTier(getNpcAffection(n.name));
            const ar = getRelationship(n.name).arousal || 1;
            let s = `${n.name} (${n.role || 'townsperson'}) [disposition toward player: ${t.label}, affection ${getNpcAffection(n.name)}; arousal ${arousalTier(ar).label} ${ar}/10 — warmer disposition AND higher arousal both lower the DC of charming/persuading her; a Wary, Calm NPC resists hardest]`;
            if (n.wrestle) s += ` [a physical contest/wrestle against her is a ${n.wrestle.stat} check, difficulty ${n.wrestle.difficulty}]`;
            if (n.shopInventory) s += ` [MERCHANT, sells: ${n.shopInventory.map(i => `"${i.name}" ${i.price}g`).join(', ')}]`;
            return s;
        }).join('; ');
    }

    function exitsContextForAnalyzer() {
        const loc = currentGameState.worldData.locations[currentGameState.currentLocation];
        const conns = loc?.connections || [];
        if (!conns.length) return 'none';
        return conns.map(c => `"${currentGameState.worldData.locations[c]?.name || c}"`).join(', ');
    }

    // GM messages that are pure MECHANICAL notifications (travel, time passing,
    // scene/look dumps) — noise for the Custodian's judgement, so we keep them out
    // of its story budget. (Ghost/system logs and the character sheet are already
    // excluded by is_system.) Narrative prose, examine, and dialogue are kept.
    const GM_MECHANICAL_PREFIX = /^\s*(🚶|⏰|🗓️|👀|📦|🎒)/;
    function isStoryMessage(m) {
        if (m.is_system) return false;                          // ghost logs, character sheet, skill-check readouts
        if (!(m.mes || '').trim()) return false;
        if (m.name === 'RPG Custodian') return false;
        if (m.name === 'Game Master' && GM_MECHANICAL_PREFIX.test(m.mes)) return false;   // travel/time/look notifications
        return true;
    }
    /**
     * A LONG linear story window for GM description/narration prompts. Walks
     * backwards through story messages (spam-filtered, UNtruncated) until the
     * char budget is spent. Frontier models take huge inputs happily — the
     * stingy analyzer window is what left descriptions blind to the evening
     * the player just spent. Default ~40k chars ≈ 10k tokens.
     */
    // Travel & time notices form the window's location/time SPINE — without
    // them the story reads as one unbroken scene and descriptions linger in
    // places the player already left. (Look/inventory noise stays excluded.)
    const STORY_SPINE_PREFIX = /^\s*(🚶|⏰|🗓️)/;
    function recentStoryWindow(maxChars = 40000) {
        const chat = getCtx().chat || [];
        const lines = [];
        let used = 0;
        for (let i = chat.length - 1; i >= 0 && used < maxChars; i--) {
            const m = chat[i];
            const spine = m.name === 'Game Master' && STORY_SPINE_PREFIX.test(m.mes || '');
            if (!isStoryMessage(m) && !spine) continue;
            const line = `${m.is_user ? 'Player' : m.name}: ${String(m.mes).replace(/\s+/g, ' ')}`;
            used += line.length;
            lines.push(line);
        }
        return lines.length ? lines.reverse().join('\n') : '(scene just beginning)';
    }

    function recentSceneForAnalyzer() {
        const chat = getCtx().chat || [];
        // A wide, spam-filtered window: the Custodian spends its whole story budget
        // on actual narrative + dialogue (the set-up for the player's action — an
        // NPC's offer, a bargain, a handed-over item), not travel/time/sheet noise.
        const lines = chat.filter(isStoryMessage)
            .slice(-12)                                          // doubled from 6
            .map(m => `${m.is_user ? 'Player' : m.name}: ${String(m.mes).replace(/\s+/g, ' ').slice(0, 400)}`);
        return lines.length ? lines.join('\n') : '(scene just beginning)';
    }

    async function analyzeIntent(playerText) {
        const sys = `You are the INTENT ANALYZER for a fantasy RPG. Think like a seasoned tabletop Game Master. You do NOT roleplay or narrate. You output ONLY one JSON object.

=== WHEN TO ROLL A CHECK (2d6 + the character's stat vs a DC) ===
Call a check when the action is genuinely UNCERTAIN for this character AND both success and failure would be dramatic. These almost ALWAYS warrant a check — do not skip them:
- Combat, fighting creatures or people, brawling, wrestling, physical danger → ruggedness.
- Risky feats of strength / endurance / agility (climbing a sheer cliff under threat, forcing a jammed door) → ruggedness.
- Seducing, kissing, persuading, intimidating, haggling hard with, or charming a present NPC against their inclination → charm.
- A PROPOSITION — the FIRST time the player asks for/initiates something she could refuse (a first kiss, an invitation to bed, escalating to a new act) → a CHARM check. DC scales with BOLDNESS of the ask and is LOWERED by her affection AND her current arousal (a Smitten or aroused woman wants to believe him; a Wary, calm one strongly resists). The check decides whether she ACCEPTS HIS FRAMING — reads his words as sincere, trustworthy, in her interest — NOT whether she likes him more. NEVER emit adjust_affection or adjust_arousal on either branch of a charm check: her feelings move only through her own reactions, which the engine reads separately. Success = she goes along with what he said or asked; failure = she is not persuaded and reacts to what she actually perceives (which may be amusement, suspicion, or delight at catching him — her call, not automatically coldness).
- If SHE offered or initiated it — her own invitation, her own advance — the player ACCEPTING is NEVER a proposition and rolls NOTHING. There is nothing to persuade. Only the player pushing PAST what she has herself offered rolls charm.
- BUT once she has CONSENTED and intimacy is already UNDERWAY (the recent scene shows them kissing / having sex / in bed together), do NOT roll charm again for continued consensual acts — thrusts, pace, positions, "keep going", finishing. Those are NOT new propositions. Just narrate and emit orgasm effects as they occur. Only roll charm again if he pushes a genuinely NEW boundary she might refuse.
- Deceiving/lying to, reading true intent, casting a spell, solving a hard puzzle, spotting something hidden → craftiness.
- Crafting, carving, building, or repairing something useful → craftiness.
If the player's action pursues one of his ACTIVE OBJECTIVES (listed below), roll whatever check the attempt itself deserves — the engine's judge notices completion on its own; NEVER emit a completion effect for an objective.

=== WHEN NOT TO ROLL ===
- Trivial / foregone actions (grab a stick off the ground, walk, look around, sit) → "check": null; add effects only if something is actually gained.
- Buying an item, using/consuming an item you HOLD, accepting or turning in a quest → deterministic, "check": null.
- Pure talk, greetings, emoting, questions with no stakes → "mechanical": false — but STILL set target_npc so the addressed NPC replies.

=== DIFFICULTY (2d6 + stat vs DC; stat 3 = average novice) ===
STAT SCALE: 1-2 feeble, 3 novice, 4-5 capable, 6-7 skilled, 8-9 exceptional, 10+ legendary.
LADDER (absolute difficulty): Easy 8, Moderate 10, Hard 12, Very Hard 14, Legendary 16, Near-impossible 18. Use an NPC's or quest's authored difficulty EXACTLY when given.
Only roll if uncertain for THIS character: roughly (DC − their stat) between 5 and 11. If (DC − stat) ≤ 4 they can't really fail — skip the roll and apply the effect. "reason" reads like a GM's aside on why the moment is worth a roll.

=== EFFECTS ("effects_on_success"/"effects_on_failure": arrays of {type,...}) ===
  {"type":"move","destination":"..."}  the player travels/walks/heads to a CONNECTED location (see EXITS). Deterministic, no check. The player can only reach a directly-connected location; a distant place is not reachable in one step.
  {"type":"advance_time","periods":N}  narrative time passes. Each period is a step Morning→Day→Evening→Night→(next) Morning. A FULL DAY IS EXACTLY 4 PERIODS — for an explicit span of days use N = days×4 EXACTLY: "one day" = 4, "two days" = 8, "three days" = 12, "a week" = 28. For a time-of-day span, count periods from CURRENT TIME to the target: from Morning "long into the evening" = 2; "that night"/"until nightfall" = to Night; "sleep until morning" = to next Morning.
  {"type":"add_party","npc":"..."}  a present NPC agrees to travel WITH the player or to spend extended time together (join me, come along, let's spend the day together, share stories into the evening). She then follows the player everywhere until dismissed.
  {"type":"remove_party","npc":"..."}  a companion parts ways / is dismissed / stays behind.
  {"type":"buy_item","name":"..."}   buy from a PRESENT merchant. The engine charges the price — do NOT also emit adjust_gold.
  {"type":"use_item","name":"..."}   consume/use an item the player HOLDS (drink a potion, crush a soul crystal, etc.). SOUL CRYSTALS: the inert gems born under the Crystal Curse are collectible spell-fuel — when the player GATHERS/pockets them emit add_item "soul crystal" (one per crystal); when he CRUSHES/channels/uses one emit use_item "soul crystal" (the engine restores 1 Mana and consumes it).
  {"type":"adjust_gold","amount":N}  ONLY for ad-hoc gold NOT covered above (finding coins, a bribe, gambling).
  {"type":"add_item","name":"..."} / {"type":"remove_item","name":"..."}
  {"type":"adjust_affection","npc":"...","amount":N}  ONLY for an external/mechanical cause acting on her feelings: a charm potion, a love or hate spell, a curse, a magical aura. NEVER for conversation, kindness, flirting, seduction, gifts, or check outcomes — the engine reads her own reactions and moves affection itself.
  {"type":"adjust_arousal","npc":"...","amount":N}  ONLY for an external/physical-mechanical cause: an aphrodisiac, a lust spell, an alchemical heat. NEVER for flirtation, teasing, or foreplay in the scene — the engine reads her reactions and moves arousal itself.
  {"type":"orgasm","actor":"player"|"npc","npc":"HerName","internal":true/false,"count":N}  a CLIMAX just happened. ALWAYS include "npc" (the partner). For a PLAYER climax, set "internal":true if he finished INSIDE her during P-in-V (this triggers the fertilization roll) or "internal":false if he pulled out / finished externally (no fertilization). Both cost 1 Stamina. If unstated whether he pulled out, assume internal:true. count = climaxes in this action (default 1). An NPC climax costs her 1 Stamina.
  {"type":"damage","target":"player"|"npc","npc":"HerName","amount":N}  Stamina lost to a combat hit/injury.
  {"type":"heal","target":"player"|"HerName","amount":N or "full"}  RESTORATION magic / a healing draught / a mending spell / bandaging restores CURRENT Stamina to someone (player or a present NPC) — WITHOUT passing time and without raising their max. amount = how many Stamina points mended (a minor cure ~2, a strong heal ~4), or "full" for a complete restoration. It also revives an unconscious target. Use this for healing spells, restoration potions, first aid, laying-on-of-hands, etc. (Distinct from "rest", which restores EVERYONE and passes time, and from an add_status with a stamina mod, which temporarily raises the MAX pool.)
  {"type":"restore_mana","target":"player","amount":N or "full"}  arcane energy replenishes the player's MANA (his magic pool, max = Craftiness). Emit for ANY source that would refill magic: drinking from a font/POOL of liquid mana, quaffing a mana potion, meditating at a ley-line or shrine, absorbing ambient/loose magic, channelling a node. amount = points restored, or "full" for a brimming/abundant source (a whole pool). (For crushing a single soul crystal use use_item instead → +1 Mana.) Do NOT invent the number narratively — the engine applies it.
  {"type":"rest"}  the player rests/naps/sleeps/camps — restores EVERYONE'S Stamina to full and passes exactly ONE time period. Emit this whenever the player sleeps, naps, camps, or takes a proper rest.
  {"type":"apply_curse","curse":"crystal","target":"player"|"HerName","caster":"player"|"HerName"?,"power":N?,"duration":N?,"contest":true}  the CRYSTAL CURSE (soulgem hex) is cast on someone. target = victim ("player" the man, or a female NPC). The engine runs a RESIST CONTEST — the caster's power vs the victim's Ruggedness — so specify who/what is casting: for the PLAYER casting, omit caster/power (his Craftiness is used); for an NPC/enemy caster set "caster":"HerName"; for a TRAP or CURSED ITEM set "power":N as its magic strength (proxy for a caster, ~2 weak, 4 average, 7 potent). PERMANENT by default (omit duration); give duration (time periods) only for a temporary casting. Set "contest":false ONLY for an unavoidable, story-forced curse (no roll). While cursed, any child that person sires/bears is born an inert soulgem. Emit when such a curse is cast in the narrative.
  {"type":"lift_curse","curse":"crystal","target":"player"|"HerName"}  the Crystal Curse is BROKEN by magic — a cleansing rite, holy light, a counter-hex, a wish, a cure. Emit when the curse is lifted/dispelled/broken in the narrative. (apply_curse also accepts "break_condition":"<plain-English condition that will break it>", e.g. "broken by a loving kiss" — the engine watches the story and lifts it automatically when that happens.)
  {"type":"add_status","target":"player"|"HerName","name":"...","kind":"buff|debuff|blessing|curse|pact|vow|disease|poison|status","polarity":"positive"|"negative","desc":"what it does","mods":[{"stat":"ruggedness|charm|craftiness|virility|fertility|stamina","amount":N}],"duration":N,"expires_on_check":"ruggedness|charm|craftiness|virility","end_condition":"plain-English condition that ends it"}  INVENT a bespoke applied effect. A buff, debuff, blessing, curse, hex, pact, vow, oath, disease, poison, inspiration, drunkenness, a potion's effect — these are ALL the same thing: something APPLIED to a character that later ENDS. Works on the player OR any NPC (target her name). Set "kind" to the fitting label (it picks the icon/framing). HOW IT ENDS — give any of: "duration" (time periods), "end_condition" (a story event), or "expires_on_check" (a stat name) for a SINGLE-USE PRE-BUFF that is spent the very next time the character attempts a trial of that stat — a combat-prep draught ("+3 ruggedness, gone after your next fight"), a courage tonic before one daring roll, a focus charm for the next lore check. Watch for these one-shot "before I try this, I…" boosts and give them expires_on_check on the matching stat. Combine ends freely (whichever fires first). See STAT MODS & SCALE below for amounts. (A pact/vow that also has a GOAL to fulfil for a reward → use add_objective instead.)
    HOW IT ENDS — give it a "duration" in time periods AND/OR an "end_condition", and it ends when EITHER happens (whichever comes first). A "duration" is a deterministic timer (4 periods = one day) — invent a sensible lifespan so nothing lingers forever (a bad hangover ~4; a wolf-fever sickness ~12; a fleeting inspiration ~2; a grievous curse-like affliction longer or omit for indefinite). An "end_condition" is a narrative escape hatch judged by the engine ("when cured with medicine", "if you harm an innocent", "once the sun rises") — use it when a specific event should end it early. Most lingering afflictions want BOTH, e.g. duration 12 AND end_condition "when treated with a cure" → "12 periods pass, or when cured". Omit both only for something truly permanent. CRUCIAL — do this WHENEVER the story inflicts or bestows something that LINGERS past this single moment, not just a blessing or hex: an illness/disease/infection, a poison or venom, a festering or draining wound, exhaustion, a fear or despair, an inspiration or resolve, an enchantment/charm, drunkenness, a mark or oath, etc. Do NOT let such a thing evaporate as mere flavor, and do NOT collapse a lingering affliction into one-off "damage" — if the narrative says a character is left weakened/sickened/poisoned/emboldened in an ONGOING way, that is a STATUS. Read the fiction and give it the FITTING mod: something that saps physical strength lowers ruggedness (negative amount), something dulling the mind lowers craftiness, something disfiguring lowers charm, a boon raises the apt stat (small, ±1–3). A mod applies for the WHOLE time the status is active — do NOT add any per-mod condition (the status being active IS the condition). A status may also be purely narrative with no mods. end_condition is a natural-language trigger the engine WATCHES and auto-ends the status when met — infer what would plausibly end THIS effect (e.g. a sickness ends when it is cured/treated by medicine; drunkenness when slept off; a fear when the threat is gone). Omit only if truly indefinite. This is the main tool for the world to leave a lasting mark on a character — reach for it.
  {"type":"add_objective","name":"short title","objective":"plain-English condition that COMPLETES it","reward":{"gold":N,"xp":N,"tokens":N,"item":"name"},"duration":N,"mods":[{"stat":"...","amount":N}]}  the player TAKES ON a task, quest, errand, promise, oath, deal, or PACT — a villager's request, a fey bargain, a personal vow ("I'll find the lost locket", "I swear to guard her", "I accept your pact, fair one"). This is a tracked objective — a "silent status" the engine WATCHES; when its objective is met in the story it AUTO-COMPLETES and grants the reward. reward is optional (any of gold/xp/power tokens/an item). duration is optional (a time-limited task fails if not done in time). mods are optional stat changes that hold WHILE a pact/oath is in force (a fey pact granting +2 craftiness until it's fulfilled or broken) — omit for an ordinary errand. Emit whenever the player accepts or undertakes ANY goal, however small — INCLUDING when the acceptance is just one beat of a message that also travels, converses, or does other things ("Yeah, I'll take the job — lead the way" emits add_objective AND the move; the job is NEVER dropped in favor of the other effects).
  {"type":"remove_status","target":"player"|"HerName","name":"...","reason":"why"}  end a named status effect or abandon an objective now (dispelled, cured, willed away, given up).
  {"type":"adjust_stat","target":"player"|"HerName","stat":"ruggedness|charm|craftiness|virility","amount":N}  a PERMANENT change to a core stat (a hard-won training gain, a level of mastery, a permanent drain from dark magic). Use sparingly — for temporary changes use add_status.
  {"type":"equip_item","name":"..."}  the player equips/dons/wears/wields a piece of gear he holds (a sword, armor, an amulet). {"type":"unequip_item","name":"..."} he removes/sheathes/takes it off. (Consumables are use_item, not equip.)
  {"type":"birth","npc":"HerName","count":N,"kind":"live"|"egg"|"crystal"}  a BIRTH is happening in the scene — a mother AT or OVER term (Birth Overdue) is delivering: labor/pushing/crowning, laying an egg, or producing a crystal. Emit ONE per message for however many emerge in THAT message (count = born right now; e.g. triplets delivered one at a time across three messages → three births of count 1, or all at once → one birth of count 3). Never emit more than she is carrying. kind: "egg" for egg-laying mothers (dragons, harpies, other monster-girls), "crystal" if the sire's magic makes inert soul-crystals (a soul-mage / necromancer father), else "live". You may OMIT kind — the engine infers it from her race and the father. Do NOT invent Power Tokens, offspring, or names — the engine awards the tokens and names the young. Only emit when a birth actually occurs in the narrative.
  {"type":"examine","npc":"HerName"}  the player looks over / examines / studies / sizes up / inspects / ADMIRES a PRESENT NPC — including looking her up and down, drinking in the sight of her, taking in her sleeping form, or appraising her appearance. The engine shows her stats and a status-flavored description. Emit whenever the player deliberately takes in or appraises a specific NPC's body/appearance/condition, EVEN when it is one beat inside a larger described action (e.g. "…stepping back, looking her up and down, admiring her sleeping form, before leaving" → emit examine for her). Do NOT skip it just because other things also happen in the same message. A deliberate visual appraisal ALWAYS emits examine no matter what else the message contains — action, travel, or DIALOGUE. Talking with her at the same time does not make the look incidental: "I ask about her wares while letting my eyes wander over her" → emit examine for her AND still let the conversation proceed (target_npc stays set; she replies as normal). (Skip only for an incidental glance with no appraisal.) Use npc:"self" when the player checks himself over / takes stock of his own condition / looks at his own stats, gear, or gold — the engine shows HIS readout.
Empty array when nothing changes.

STAT MODS & SCALE (for add_status/add_objective mods on ANY character, player OR npc): a mod applies the whole time the effect is active. The core stats — ruggedness, charm, craftiness, virility — run ~1–10, so mod them by a SMALL integer ±1 to ±3 (up to ±5 for potent magic). Two special NPC stats may also be modded: FERTILITY is a PERCENTAGE (0–100%), so a fertility mod must be big to matter, +10 to +30 (a strong fertility potion ≈ +20). STAMINA is the small combat/sex HP pool (~1–10), so a stamina mod is +1 to +3 (up to +5); a POSITIVE stamina mod also tops up current Stamina and revives the unconscious. Simple consumables are just a short-duration add_status: a strength draught → kind "buff", mods [{stat:"ruggedness",amount:2}], duration 4; a shared fertility potion → player kind "buff" mods [{stat:"virility",amount:2}] AND on her mods [{stat:"fertility",amount:20}]; a poison → kind "debuff"/"poison", negative mod.
GRANTED BOONS (watch the scene): if an NPC OFFERED to grant power/strength/a blessing (naming a stat) in the RECENT SCENE and the player's action ACCEPTS it — kneeling to receive it, drinking a potion she handed over, submitting to a laying-on-of-hands — you MUST emit an add_status for that boon on the player, even though the granting WORDS came from the NPC. The player's acceptance is the trigger. Pick the stat from the offer; magnitude fits its power (a dragon's blessing of Ruggedness → +3 to +5). Do NOT let these slip through as pure talk.

STAMINA & SEX: Stamina is the shared HP pool (max = Ruggedness). Each orgasm and each combat hit costs Stamina; at 0 the character falls unconscious. When narrating intimacy, emit an "orgasm" effect for each climax as it occurs (mark internal true only for finishing inside during P-in-V). Do NOT invent fertilization results yourself — the engine rolls them; just emit the orgasm effect.

COMPANIONS & TIME (deterministic, no check — do not miss these):
- Whenever the player and a PRESENT NPC will TRAVEL TOGETHER or SPEND EXTENDED TIME TOGETHER, emit {"type":"add_party","npc":"HerName"} AND set target_npc to her. This applies in BOTH directions:
  • the player invites/leads her: "come with me", "walk with me", "join me", "let's travel together", "spend the day/evening together", "share stories into the evening", "stay with me tonight".
  • the player agrees to go WITH her / follow her / accompany her: "lead the way", "I'll come with you", "show me your home", "take me there", "I'd love to see your place/home", "let's go to yours", "after you".
  She then travels with the player until dismissed. If the outing goes to a location, ALSO emit move; if it spans time, ALSO emit advance_time.
- Parting ways / dismissing her / LEAVING HER BEHIND (tucking her into bed and leaving, letting her rest while you go on, setting off WITHOUT her, "leaving her to sleep", "leaving her alone", "go on alone") → {"type":"remove_party","npc":"HerName"}. If she is a companion and you depart without her, you MUST drop her — do not let her silently follow.
- Any action that SPANS TIME → also emit {"type":"advance_time","periods":N}, computing N from CURRENT TIME to the described time of day. "Share stories into the evening" from Morning = add_party + advance_time periods 2.

A SINGLE MESSAGE OFTEN DESCRIBES A SEQUENCE — emit EVERY applicable effect, and ORDER THEM IN THE SEQUENCE THEY HAPPEN. The order is not cosmetic: the engine applies these effects in the exact order you list them, and that order decides WHERE things land. A companion is only carried by a move you place BEFORE her remove_party; a move you place AFTER remove_party leaves her behind. Two opposite examples:
  • Leave her HERE, then go: "I carry Fern to her bed and tuck her in, then step back, looking her over, before setting off into the woods alone" → [{"type":"examine","npc":"Fern"},{"type":"remove_party","npc":"Fern"},{"type":"move","destination":"forest"}] (drop her at the current spot, THEN travel without her).
  • Accept a job AND set off: "Yeah, I'll take the guard job — lead the way and introduce me" → [{"type":"add_objective","name":"Guard the Velvet Rose","objective":"guard the establishment for the night without incident","reward":{"gold":10}},{"type":"add_party","npc":"Bryony"},{"type":"move","destination":"brothel"}] (the ACCEPTED JOB is emitted first and is NEVER dropped just because the message also travels or converses).
  • Carry her TO somewhere and leave her THERE: "I look over Fern's sleeping face, then gather her up and carry her to the inn, laying her in a bed to rest before slipping out" → [{"type":"examine","npc":"Fern"},{"type":"move","destination":"inn"},{"type":"remove_party","npc":"Fern"}] (carry her along on the move, THEN drop her at the inn).
Do not collapse a multi-step action down to one effect, and do not reorder its steps.

WATCH THE INVENTORY. Whenever an action GAINS, LOSES, CONSUMES, gives away, or TRANSFORMS an item, you MUST emit the matching add_item / remove_item. In particular:
- CRAFTING/CARVING/COMBINING an item the player holds into a new one → on success emit BOTH remove_item (the input, using its EXACT name from the inventory list) AND add_item (the crafted result). e.g. carving a "sturdy_branch" into a staff → effects_on_success: [{"type":"remove_item","name":"sturdy_branch"},{"type":"add_item","name":"carved staff"}].
- Giving/dropping/selling an item → remove_item. Finding/receiving/looting one → add_item.
Use the EXACT item names shown in the player's inventory for remove_item.

"target_npc": the present NPC the player addresses or acts upon, so they react (exact name). null only if truly solitary.
"narration_hint": ≤10 words describing the attempted action.
"mechanical": true if any check OR effect applies; false only for pure stakeless talk.

OUTPUT EXACTLY THIS JSON SHAPE (keep it compact — "reason" ≤ 12 words):
{"mechanical":true,"check":{"stat":"ruggedness","difficulty":8,"reason":"short why"},"effects_on_success":[],"effects_on_failure":[],"target_npc":"Name","narration_hint":"short"}
Use "check":null when no roll. Do NOT think out loud, do NOT use <think> tags or any prose — output ONLY the JSON object, starting with "{" and nothing before it.`;

        const prompt = `RECENT SCENE:
${recentSceneForAnalyzer()}

PLAYER ACTION: "${playerText}"
PLAYER STATS: ${statsContextForAnalyzer()}
CURRENT TIME: ${TIME_PERIODS[currentGameState.currentTime].name} (Day ${currentGameState.dayCount}) [order: Morning→Day→Evening→Night]
LOCATION: ${currentGameState.worldData.locations[currentGameState.currentLocation]?.name}
EXITS (connected locations you can travel to): ${exitsContextForAnalyzer()}
PRESENT NPCS: ${presentNpcContextForAnalyzer()}${(currentGameState.party || []).length ? `\nIN YOUR PARTY (travelling with you): ${currentGameState.party.join(', ')}` : ''}
ACTIVE OBJECTIVES (engine-judged — never emit completion for these): ${playerObjectives().map(e => `"${e.name}" — ${e.endCondition || 'ongoing'}`).join('; ') || 'none'}`;

        // Plain-JSON prompting (no jsonSchema — DeepSeek's structured-output mode
        // returned empty intermittently). Retry once on an empty/unparseable reply.
        if (window.RPGC_LOG_PROMPT) console.log('RPG Custodian: ANALYZER PROMPT\n' + prompt);
        for (let attempt = 0; attempt < 2; attempt++) {
            try {
                // Attempt 0: think-first — the Custodian keeps its reasoning,
                // with headroom so thinking can't starve the JSON. Attempt 1:
                // prefill '{' rescue, which skips the thinking channel.
                const raw = await context.generateRaw(attempt === 0
                    ? { prompt, systemPrompt: sys, responseLength: 900 + THINK_HEADROOM }
                    : { prompt, systemPrompt: sys, responseLength: 900, prefill: '{' });
                if (window.RPGC_LOG_PROMPT) console.log('RPG Custodian: ANALYZER RAW =', String(raw).slice(0, 500));
                let parsed = parseIntent(raw);
                if (!parsed) parsed = parseIntent('{' + String(raw || ''));  // prefill may be stripped from the echo
                if (parsed) return normalizeIntent(parsed);
                console.warn(`RPG Custodian: analyzer empty/unparseable (attempt ${attempt + 1}), raw:`, String(raw || '').slice(0, 160));
            } catch (e) {
                console.error(`RPG Custodian: analyzer call failed (attempt ${attempt + 1})`, e);
            }
            await new Promise(r => setTimeout(r, 600));
        }
        return { mechanical: false };
    }

    // Strip a reasoning model's thinking blocks so only the answer remains.
    // Reasoning models think from the SAME token budget as their answer — the
    // API exposes no separate thinking budget. So LLM calls here run
    // THINK-FIRST: generous headroom on top of the answer budget, think block
    // stripped afterwards — the model keeps its reasoning. Only when thinking
    // consumed the whole budget (nothing usable survived the strip/parse) does
    // a rescue retry use a prefill, which starts the assistant turn directly
    // and skips the thinking channel entirely.
    const THINK_HEADROOM = 900;

    /**
     * Prose call: think-first with headroom, strip, prefill-rescue on empty.
     * rescuePrefill is re-prepended if the backend didn't echo it. Returns ''
     * only if both passes produced nothing.
     */
    async function generateProse({ prompt, systemPrompt, budget, rescuePrefill = '' }) {
        let text = '';
        try {
            text = stripReasoning(await context.generateRaw({ prompt, systemPrompt, responseLength: budget + THINK_HEADROOM }));
        } catch (e) { console.warn('RPG Custodian: prose call failed, trying prefill rescue', e); }
        if (!text) {
            const raw = await context.generateRaw({ prompt, systemPrompt, responseLength: budget, prefill: rescuePrefill || undefined });
            text = stripReasoning(raw);
            if (text && rescuePrefill && !text.startsWith(rescuePrefill.trim())) text = rescuePrefill + text;
        }
        return text;
    }

    /**
     * JSON call: think-first with headroom, parse, prefill-'{' rescue.
     * Returns the parsed object, or null.
     */
    async function generateJson({ prompt, systemPrompt, budget }) {
        try {
            const parsed = parseIntent(await context.generateRaw({ prompt, systemPrompt, responseLength: budget + THINK_HEADROOM }));
            if (parsed) return parsed;
        } catch (e) { console.warn('RPG Custodian: json call failed, trying prefill rescue', e); }
        const raw = await context.generateRaw({ prompt, systemPrompt, responseLength: budget, prefill: '{' });
        return parseIntent(raw) || parseIntent('{' + String(raw || ''));
    }

    function stripReasoning(s) {
        return String(s || '')
            .replace(/<think>[\s\S]*?<\/think>/gi, '')
            .replace(/<thinking>[\s\S]*?<\/thinking>/gi, '')
            .replace(/<think>[\s\S]*$/gi, '')      // unterminated (truncated) think block
            .replace(/<thinking>[\s\S]*$/gi, '')   // unterminated <thinking> variant
            .trim();
    }

    // Returns a parsed object, or null when nothing usable was produced.
    function parseIntent(raw) {
        if (raw && typeof raw === 'object') return raw;
        let text = stripReasoning(raw);
        if (!text) return null;
        // Strip code fences if present
        text = text.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
        try { return JSON.parse(text); } catch { /* try to extract / repair */ }
        const m = text.match(/\{[\s\S]*\}/);
        if (m) { try { return JSON.parse(m[0]); } catch { /* fall through */ } }
        // Repair a response truncated mid-JSON: cut to the last complete field,
        // close any open string, and balance braces/brackets.
        const repaired = repairTruncatedJson(text.startsWith('{') ? text : (text.slice(text.indexOf('{'))));
        if (repaired) { try { return JSON.parse(repaired); } catch { /* give up */ } }
        return null;
    }

    function repairTruncatedJson(s) {
        if (!s || s[0] !== '{') return null;
        let str = s;
        // Drop a dangling partial field after the last complete "," or "{"
        const lastComma = str.lastIndexOf(',');
        const lastBrace = str.lastIndexOf('{');
        // If we're mid-string/value, trim back to the last structural boundary.
        if (!/[}\]]\s*$/.test(str)) str = str.slice(0, Math.max(lastComma, lastBrace + 1)).replace(/,\s*$/, '');
        // Balance quotes
        const quotes = (str.match(/"/g) || []).length;
        if (quotes % 2 !== 0) str += '"';
        // Balance brackets/braces
        const opens = (str.match(/[{[]/g) || []);
        const closes = (str.match(/[}\]]/g) || []);
        const need = opens.length - closes.length;
        for (let i = 0; i < need; i++) {
            const o = opens[opens.length - 1 - i];
            str += o === '{' ? '}' : ']';
        }
        return str;
    }

    // Normalize model quirks: accept "dc" alias, ensure arrays exist.
    function normalizeIntent(intent) {
        if (!intent || typeof intent !== 'object') return { mechanical: false };
        if (intent.check && intent.check.dc != null && intent.check.difficulty == null) {
            intent.check.difficulty = intent.check.dc;
        }
        intent.effects_on_success = Array.isArray(intent.effects_on_success) ? intent.effects_on_success : [];
        intent.effects_on_failure = Array.isArray(intent.effects_on_failure) ? intent.effects_on_failure : [];
        return intent;
    }

    function applyEffects(effects) {
        let list = (effects || []).slice();
        // Defensive dedup: buy_item owns its gold, so drop any redundant
        // adjust_gold the analyzer emitted alongside it.
        const hasBuy = list.some(e => e.type === 'buy_item');
        if (hasBuy) list = list.filter(e => e.type !== 'adjust_gold');
        for (const eff of list) {
            switch (eff.type) {
                case 'add_item':
                    addItem({ id: `${String(eff.name || 'item').toLowerCase().replace(/\s+/g, '-')}-${Date.now()}`, name: eff.name || 'item', desc: eff.desc || '' });
                    break;
                case 'remove_item': {
                    const rd = getPlayerRpgData();
                    const i = findItemIndex(rd.inventory.items, eff.name);
                    if (i >= 0) { rd.inventory.items.splice(i, 1); savePlayer(); }
                    else sendGhostMessage(`(couldn't find "${eff.name}" to remove)`);
                    break;
                }
                case 'adjust_gold': addGold(eff.amount || 0); break;
                case 'adjust_affection': adjustNpcAffection(eff.npc, eff.amount || 0); break;
                case 'buy_item': buyItemByName(eff.name); break;
                case 'use_item': useItemByName(eff.name); break;
                case 'orgasm':
                    if ((eff.actor || 'player') === 'player') resolvePlayerOrgasm(eff.npc, eff.internal !== false, eff.count || 1);
                    else if (eff.npc) { const rel = spendNpcStamina(eff.npc, eff.count || 1); sendGhostMessage(`💦 ${eff.npc} climaxes — Stamina ${rel.npcStamina}/${npcMaxStamina(eff.npc)}${rel.npcUnconscious ? ' — she swoons into blissful unconsciousness!' : ''}`); }
                    break;
                case 'damage':
                    if ((eff.target || 'player') === 'player') { spendStamina(eff.amount || 1); sendGhostMessage(`💢 You take ${eff.amount || 1} — Stamina ${getStamina()}/${maxStamina()}${getPlayerRpgData()?.stats.unconscious ? ' — you black out!' : ''}`); }
                    else if (eff.npc) { const rel = spendNpcStamina(eff.npc, eff.amount || 1); sendGhostMessage(`⚔️ ${eff.npc} takes ${eff.amount || 1} — Stamina ${rel.npcStamina}/${npcMaxStamina(eff.npc)}${rel.npcUnconscious ? ' — she goes down!' : ''}`); }
                    break;
                case 'adjust_arousal': { const rel = getRelationship(eff.npc); rel.arousal = Math.max(1, Math.min(10, (rel.arousal || 1) + (eff.amount || 0))); savePlayer(); break; }
                case 'heal': healStamina(eff.target || (eff.npc ? eff.npc : 'player'), eff.amount); break;
                case 'restore_mana': restoreManaEffect(eff.target || 'player', eff.amount); break;
                case 'birth': resolveBirth(eff.npc, eff.count || 1, eff.kind, true); break;
                case 'apply_curse': if ((eff.curse || 'crystal') === 'crystal') tryApplyCrystalCurse(eff); break;
                case 'lift_curse': if ((eff.curse || 'crystal') === 'crystal') liftCrystalCurse(eff.target); break;
                case 'add_status': addCustomStatus(eff.target, eff); break;
                case 'add_objective': addCustomStatus(eff.target, { ...eff, category: 'quest' }); break;
                case 'remove_status': removeCustomStatus(eff.target, eff.name, eff.reason); break;
                case 'adjust_stat': adjustStat(eff.target, eff.stat, eff.amount || 0); break;
                case 'equip_item': setEquipItemByName(eff.name, true); break;
                case 'unequip_item': setEquipItemByName(eff.name, false); break;
                default: break;
            }
        }
    }

    /**
     * NL travel: resolve a destination (id or fuzzy name) to a CONNECTED
     * location and travel there. Enforces adjacency for location coherency —
     * you can't leap to a distant place in one step.
     */
    // When travel fails, the STORY must know — the 🚫 ghost is filtered from
    // story windows, and without this note the GM (and then the NPC) narrated
    // arriving at places the engine never moved them to.
    let travelIssueNote = null;

    // BFS over the location graph: "head to the shop" from the outskirts
    // routes through town square instead of failing on non-adjacency.
    // Returns the hop list (excluding start), or null if unreachable.
    function findPath(fromId, toId) {
        const world = currentGameState.worldData;
        const prev = { [fromId]: null };
        const q = [fromId];
        while (q.length) {
            const cur = q.shift();
            if (cur === toId) {
                const path = [];
                for (let n = toId; n !== fromId; n = prev[n]) path.unshift(n);
                return path;
            }
            for (const c of (world.locations[cur]?.connections || [])) {
                if (!(c in prev)) { prev[c] = cur; q.push(c); }
            }
        }
        return null;
    }

    async function doNlMove(dest) {
        const world = currentGameState.worldData;
        const want = String(dest || '').toLowerCase().trim();
        if (!want) return false;
        const targetId = Object.keys(world.locations).find(id => {
            const nm = (world.locations[id]?.name || id).toLowerCase();
            return id.toLowerCase() === want || nm === want || nm.includes(want) || want.includes(nm);
        });
        if (!targetId) {
            travelIssueNote = `IMPORTANT: the player tried to travel to "${dest}", but no such place is known here. The party ENDS UP STILL AT ${locName(currentGameState.currentLocation)} — you may play it for a light comic beat (setting off confidently, getting turned around, sheepishly ending where they started), but do NOT narrate them arriving anywhere new.`;
            sendGhostMessage(`🚫 No place called "${dest}" around here.`);
            return false;
        }
        if (targetId === currentGameState.currentLocation) return false;   // already here
        const path = findPath(currentGameState.currentLocation, targetId);
        if (!path) {
            travelIssueNote = `IMPORTANT: the player tried to travel to ${locName(targetId)}, but NO ROUTE exists from ${locName(currentGameState.currentLocation)}. The party ENDS UP STILL AT ${locName(currentGameState.currentLocation)} — you may play the failed attempt for a light comic beat (a wrong turn, an impassable thicket, ending back where they started), but do NOT narrate them arriving at ${locName(targetId)}.`;
            sendGhostMessage(`🚫 There's no way through to ${world.locations[targetId]?.name || dest} from here.`);
            return false;
        }
        // Walk every leg — each emits its own 🚶 notice, so the story spine
        // records the actual route taken (and presence syncs at each stop).
        for (const hop of path) await moveCommand({}, hop);
        return true;
    }

    // Fuzzy inventory match — tolerant of underscores/spacing/partial names
    // (analyzer may say "branch" for "sturdy_branch", or "staff" for "carved staff").
    function normalizeName(s) { return String(s || '').toLowerCase().replace(/[_\s]+/g, ' ').trim(); }
    function prettyItem(s) { return String(s || '').replace(/_/g, ' '); }
    function findItemIndex(items, name) {
        const want = normalizeName(name);
        if (!want) return -1;
        let i = items.findIndex(it => normalizeName(it.name) === want);
        if (i >= 0) return i;
        i = items.findIndex(it => normalizeName(it.name).includes(want) || want.includes(normalizeName(it.name)));
        return i;
    }
    function useItemByNameFuzzy(name) {
        const rd = getPlayerRpgData();
        const i = findItemIndex(rd?.inventory.items || [], name);
        return i >= 0 ? rd.inventory.items[i] : null;
    }

    function buyItemByName(name) {
        const present = getNpcsAt(currentGameState.currentLocation);
        for (const npc of present) {
            const item = (npc.shopInventory || []).find(i => i.name.toLowerCase() === String(name).toLowerCase());
            if (item) { buyItem(npc, item); return; }
        }
        sendGhostMessage(`❌ No present merchant sells "${name}".`);
    }
    function useItemByName(name) {
        const item = useItemByNameFuzzy(name);
        if (item) useItem(item);
        // else: not a tracked inventory item — likely a narrative consumable
        // (a potion just handed over). Stay silent; any mechanical effect comes
        // from an accompanying add_status effect.
    }

    function effectsSummary(effects) {
        // These emit their own rich ghost messages — don't also echo them here.
        const SELF_NARRATING = new Set(['birth', 'orgasm', 'damage', 'heal', 'restore_mana', 'adjust_arousal', 'apply_curse', 'lift_curse', 'add_status', 'add_objective', 'remove_status', 'adjust_stat', 'equip_item', 'unequip_item']);
        return (effects || []).filter(e => !SELF_NARRATING.has(e.type)).map(e => {
            if (e.type === 'add_item') return `+${e.name}`;
            if (e.type === 'remove_item') return `-${e.name}`;
            if (e.type === 'adjust_gold') return `${e.amount >= 0 ? '+' : ''}${e.amount}g`;
            if (e.type === 'adjust_affection') return `${e.npc} affection ${e.amount >= 0 ? '+' : ''}${e.amount}`;
            return e.type;
        }).join(', ');
    }

    async function narrateResult(playerText, intent, check) {
        const sys = `You are the GAME MASTER narrator of a fantasy RPG. In 1-2 vivid sentences, narrate the RESULT of the player's action from the mechanical outcome given. Keep it grounded in WHERE the scene is happening (the stated location) — do not drift the action to another place. Narrate only the world and the player's action/outcome. Do NOT speak, act, or write dialogue for any named NPC — they respond for themselves. If you need to reason first, do it inside <think></think> tags; the narration itself is pure prose. Be concise.`;
        let outcome;
        if (check) outcome = `${check.statName} check (DC ${check.difficulty}): rolled ${check.total} → ${check.success ? 'SUCCESS' : 'FAILURE'}.`;
        else if (intent?.mechanical) outcome = 'The action succeeds automatically (no roll needed).';
        else outcome = 'A minor, unremarkable action — just narrate the moment briefly.';
        const effList = check ? (check.success ? intent.effects_on_success : intent.effects_on_failure) : (intent?.effects_on_success || []);
        const eff = effectsSummary(effList);
        const koNpcs = getNpcsAt(currentGameState.currentLocation).filter(n => getRelationship(n.name).npcUnconscious).map(n => n.name);
        const koNote = koNpcs.length
            ? `\nIMPORTANT: ${koNpcs.join(' and ')} ${koNpcs.length > 1 ? 'are' : 'is'} UNCONSCIOUS (out cold, no Stamina). Do NOT narrate ${koNpcs.length > 1 ? 'them' : 'her'} waking, speaking, moving, or reacting — ${koNpcs.length > 1 ? 'they remain' : 'she remains'} completely limp and unresponsive.`
            : '';
        // A status/curse applied THIS turn must be narrated as taking hold, never
        // as fading — otherwise the prose contradicts the mechanic just created.
        const fresh = (getPlayerRpgData()?.customEffects || []).filter(e => e.justCreated).map(e => e.name);
        if (getPlayerRpgData()?.crystalCurse?.justCreated) fresh.push('the Crystal Curse');
        const freshNote = fresh.length
            ? `\nIMPORTANT: ${fresh.join(' and ')} has JUST taken hold on the player — narrate it SETTLING IN and gripping him. Do NOT narrate it fading, receding, being shrugged off, or resolved.`
            : '';
        const prompt = `Setting (keep the scene HERE): ${currentSceneLabel()}.${currentLocationDesc() ? ` ${currentLocationDesc()}` : ''}
RECENT STORY (continuity — the scene as it stands; narrate ONLY the new action's result, consistent with where this finds everyone):
${recentStoryWindow(8000)}
Player attempted: "${playerText}" (${intent?.narration_hint || ''})
Mechanical outcome: ${outcome}${eff ? `\nState change: ${eff}` : ''}${koNote}${freshNote}${travelIssueNote ? `\n${travelIssueNote}` : ''}
Narrate the result briefly, grounded in this location and the story's current beat.`;
        try {
            return await generateProse({ prompt, systemPrompt: sys, budget: 400, rescuePrefill: 'The ' });
        } catch (e) { console.error('RPG Custodian: narration failed', e); return null; }
    }

    async function triggerNpcReply(npcName) {
        if (!npcName) return;
        const present = getNpcsAt(currentGameState.currentLocation).map(n => n.name);
        if (!present.includes(npcName)) return;
        // A KO'd NPC can't respond — skip her generation (the KO-aware GM
        // narration covers the scene); log a quiet note.
        if (getRelationship(npcName).npcUnconscious) {
            sendGhostMessage(`💤 ${npcName} is unconscious and cannot respond.`);
            return;
        }
        // Wait for any in-flight generation to finish before /trigger (avoids the
        // "cannot run while reply is generating" toast); quietly skip if it never
        // frees up rather than spamming an error.
        if (!(await waitForGenerationIdle(10000))) {
            console.warn('RPG Custodian: generation still busy — skipping NPC trigger for', npcName);
            return;
        }
        // If time has passed since she last saw the player, kick-start her reply
        // with a reunion note (relationship, elapsed time, what she's been up to).
        const reunion = buildReunionNote(npcName);
        if (reunion) context.setExtensionPrompt(REUNION_PROMPT_KEY, reunion, 1, 0);   // depth 0 = closest to the generation
        // A charm roll this turn? The first addressed NPC consumes its
        // interpretation — how she read his words — as a one-shot note.
        const charmNote = pendingCharmNote; pendingCharmNote = null;
        if (charmNote) context.setExtensionPrompt(CHARM_PROMPT_KEY, charmNote, 1, 0);
        const preReplyLen = (getCtx().chat || []).length;
        try {
            await context.executeSlashCommandsWithOptions(`/trigger await=true ${npcName}`, { source: 'rpg-custodian' });
        } catch (e) { console.error('RPG Custodian: trigger NPC failed', e); }
        finally {
            if (reunion) context.setExtensionPrompt(REUNION_PROMPT_KEY, '', 1, 0);     // one-shot: clear after this reply
            if (charmNote) context.setExtensionPrompt(CHARM_PROMPT_KEY, '', 1, 0);
            noteSeen(npcName);                                                         // she has now seen him this moment
            savePlayer();
        }
        // Her reply is on the page — read it against her bands (reaction judge).
        await judgeNpcReaction(npcName, preReplyLen);
    }

    // Poll until no generation is in progress (or timeout).
    async function waitForGenerationIdle(timeoutMs = 10000) {
        const started = Date.now();
        while (isGenerating() && (Date.now() - started) < timeoutMs) {
            await new Promise(r => setTimeout(r, 100));
        }
        return !isGenerating();
    }

    /**
     * The heart of the emergent loop: analyze the player's action, resolve
     * mechanics, log + narrate the result, then let the addressed NPC react.
     */
    async function orchestratePlayerAction(playerText) {
        currentGameState.rpgSuppressNextGen = false;   // /trigger below must not be suppressed
        currentGameState.rpgOrchestrating = true;
        pendingCharmNote = null;                       // never leak a stale charm read into a new turn
        travelIssueNote = null;                        // ditto for last turn's failed-travel note
        const dismissedThisTurn = [];   // companions dismissed this turn (already gave their farewell)
        try {
            const intent = await analyzeIntent(playerText);
            console.log('RPG Custodian: intent =', JSON.stringify(intent));

            if (intent && intent.mechanical) {
                let check = null;
                let effects = intent.effects_on_success;
                if (intent.check && intent.check.stat) {
                    // Safety net against over-eager checks: if the character
                    // literally cannot fail (even a min 2d6 roll clears the DC),
                    // auto-succeed instead of theatrically rolling.
                    const delta = intent.check.difficulty - effectiveStat(intent.check.stat);
                    if (delta <= 2) {
                        sendGhostMessage(`✔️ ${intent.narration_hint || 'Action'} — trivial for you (${intent.check.stat}); no roll needed.`);
                        effects = intent.effects_on_success;
                        if (intent.check.stat === 'charm') pendingCharmNote = buildCharmInterpretationNote(null);
                    } else {
                        check = skillCheck(intent.check.stat, intent.check.difficulty);
                        if (check.statName === 'charm') pendingCharmNote = buildCharmInterpretationNote(check);
                        effects = check.success ? intent.effects_on_success : intent.effects_on_failure;
                        sendGhostMessage(skillCheckLine(check, intent.narration_hint || 'Action') +
                            (intent.check.reason ? `\n_${intent.check.reason}_` : ''));
                        consumeCheckEffects(intent.check.stat);   // spend one-use pre-buffs (pass OR fail — the charge is used)
                        if (check.success) {
                            const xp = awardCheckXp(check);
                            if (xp) sendGhostMessage(`✨ +${xp} XP`);
                        }
                    }
                }
                // Safety net: a player orgasm must know its partner to roll
                // fertilization. If the Custodian omitted npc, fill it from the
                // addressed NPC or the sole present one.
                const partner = intent.target_npc || (getNpcsAt(currentGameState.currentLocation)[0]?.name);
                for (const e of (effects || [])) {
                    if (e.type === 'orgasm' && (e.actor || 'player') === 'player' && !e.npc) e.npc = partner;
                }

                // Async/world effects (examine, party, travel, time) are applied in
                // the EXACT ORDER the Custodian emitted them — because that order IS
                // the narrative sequence, and it determines WHERE things land. Two
                // opposite turns rely on this:
                //   "tuck her in here, then walk off alone" → [remove_party, move]
                //      → she's dropped HERE, you leave without her.
                //   "carry her to the inn and leave her there" → [move, remove_party]
                //      → she's carried along (still party), dropped at the INN.
                // A party member is only dragged by a move that happens BEFORE she's
                // removed. Non-async effects (items, gold, etc.) go through applyEffects.
                const ASYNC_TYPES = ['move', 'add_party', 'remove_party', 'advance_time', 'rest', 'examine'];
                const otherEffects = (effects || []).filter(e => !ASYNC_TYPES.includes(e.type));
                let moved = false;
                for (const e of (effects || [])) {
                    switch (e.type) {
                        case 'examine': {
                            const tgt = String(e.npc || '').toLowerCase();
                            const selfName = (context.powerUserSettings.personas?.[playerAvatar()] || '').toLowerCase();
                            if (!e.npc || ['self', 'myself', 'yourself', 'me', 'player', selfName].includes(tgt)) examineSelf();
                            else await examineNpc(e.npc);
                            break;
                        }
                        case 'add_party': await addToParty(e.npc); break;
                        case 'remove_party': dismissedThisTurn.push(e.npc); await removeFromParty(e.npc); break;
                        case 'move': moved = await doNlMove(e.destination) || moved; break;
                        case 'rest': await doRest(); break;
                        case 'advance_time': await advanceTimeBy(e.periods || 1); break;
                        default: break;   // sync effect — handled by applyEffects below
                    }
                }
                applyEffects(otherEffects);
                const eff = effectsSummary(otherEffects);
                if (eff) sendGhostMessage(`📦 ${eff}`);
                // Skip the generic narration ONLY for a pure travel or pure
                // examine turn (moveCommand / examineNpc already produce their own
                // description). A COMPOUND turn — e.g. look her over, leave her,
                // then walk off — still gets GM narration for the rest of it.
                const pureMove = moved && !check && (effects || []).every(e => e.type === 'move');
                const pureExamine = !moved && !check && (effects || []).length > 0 && (effects || []).every(e => e.type === 'examine');
                if (!pureMove && !pureExamine) {
                    const gm = await narrateResult(playerText, intent, check);
                    if (gm) sendGameMasterMessage(gm);
                }
                renderActionBar();
            }

            // React. Who replies is decided DETERMINISTICALLY from the player's
            // words (the analyzer's target_npc guess is unreliable with 2+ present):
            // a directly-named NPC, or the whole group when addressed collectively.
            const addressed = detectAddressedNpcs(playerText);
            const targets = (addressed.length ? addressed
                : (intent?.target_npc && getNpcsAt(currentGameState.currentLocation).some(n => n.name === intent.target_npc) ? [intent.target_npc] : []))
                .filter(n => !dismissedThisTurn.includes(n));   // a dismissed companion already said her goodbye
            if (targets.length) {
                for (const name of targets) await triggerNpcReply(name);   // each replies in turn
            } else if (intent && !intent.mechanical) {
                const gm = await narrateResult(playerText, intent, null);
                if (gm) sendGameMasterMessage(gm);
            }

            // Now that the turn's story is on the page, let the Custodian judge
            // whether any status/curse break-condition was just satisfied.
            await checkPendingConditions();
        } catch (e) {
            console.error('RPG Custodian: orchestration error', e);
        } finally {
            currentGameState.rpgOrchestrating = false;
        }
    }

    // Orchestration is driven by the user's MESSAGE_SENT event (reliable for
    // EVERY action, even solitary ones no NPC would reply to). The interceptor
    // exists only to SUPPRESS the group's premature auto-reply for that turn.
    window.rpgCustodianInterceptor = async (chat, contextSize, abort, type) => {
        try {
            if (!currentGameState.isActive) return;
            if (type && NON_ANALYZED_TYPES.has(type)) return;
            if (getCtx().groupId !== currentGameState.groupId) return;
            if (currentGameState.rpgSuppressNextGen) {
                // Keep aborting EVERY auto-reply this turn (the group may try more
                // than one member). Orchestration clears the flag before it fires
                // its own /trigger. Not clearing here prevents a stray group
                // generation from holding the generation lock.
                abort(true);
            }
        } catch (e) {
            console.error('RPG Custodian: interceptor error', e);
        }
    };

    // Serialize orchestrations so rapid actions can't run concurrent LLM calls.
    let orchestrationChain = Promise.resolve();
    function scheduleOrchestration(text) {
        orchestrationChain = orchestrationChain
            .then(() => new Promise(r => setTimeout(r, 350)))   // let any aborted gen settle
            .then(() => orchestratePlayerAction(text))
            .catch(e => console.error('RPG Custodian: orchestration chain error', e));
    }

    // Every player message in an active session flows through here.
    function onUserMessage(mesId) {
        try {
            if (!currentGameState.isActive) return;
            if (getCtx().groupId !== currentGameState.groupId) return;
            const chat = getCtx().chat;
            const msg = (typeof mesId === 'number' && chat[mesId]) ? chat[mesId] : [...chat].reverse().find(m => m.is_user);
            if (!msg || !msg.is_user) return;
            const sig = `${msg.send_date}|${(msg.mes || '').length}`;
            if (currentGameState.lastActionSig === sig) return;
            currentGameState.lastActionSig = sig;
            currentGameState.rpgSuppressNextGen = true;   // tell the interceptor to cancel auto-reply
            scheduleOrchestration(msg.mes || '');
        } catch (e) {
            console.error('RPG Custodian: onUserMessage error', e);
        }
    }

    /**
     * Switch to Game Master character chat
     */
    async function switchToGameMaster() {
        try {
            // Find Game Master character by avatar filename
            const characters = context.characters;
            const gameMasterIndex = characters.findIndex(char => 
                char.avatar === 'Game Master.png'
            );
            
            if (gameMasterIndex === -1) {
                console.error('RPG Custodian: Game Master character not found, attempting to create...');
                await ensureGameMasterExists();
                
                // Try to find again after creation attempt
                const updatedCharacters = context.characters;
                const newGameMasterIndex = updatedCharacters.findIndex(char => 
                    char.avatar === 'Game Master.png'
                );
                
                if (newGameMasterIndex === -1) {
                    console.error('RPG Custodian: Failed to create Game Master character');
                    return;
                }
                
                await context.selectCharacterById(newGameMasterIndex);
                console.log('RPG Custodian: Successfully switched to newly created Game Master');
                return;
            }
            
            console.log(`RPG Custodian: Found Game Master at index ${gameMasterIndex}`);
            
            // Switch to the Game Master character using SillyTavern's API
            await context.selectCharacterById(gameMasterIndex);
            
            console.log('RPG Custodian: Successfully switched to Game Master');
            
        } catch (error) {
            console.error('RPG Custodian: Error switching to Game Master:', error);
        }
    }

    // Debug/testing hook — lets the headless harness introspect live game state.
    window.rpgCustodianDebug = {
        player: () => getPlayerRpgData(),
        avatar: () => playerAvatar(),
        state: () => currentGameState,
        gold: () => getGold(),
        effectiveStat: (s) => effectiveStat(s),
        createCharacter: () => createRPGCharacterCommand(),
        newGame: (w) => newGame(w),
        boost: (stat, amt) => addBoost(stat, amt, 'debug'),
        rollCheck: (stat, dc) => { const c = skillCheck(stat, dc || 8); consumeCheckEffects(stat); return c; },
        addGold: (n) => addGold(n),
        teleport: async (locId) => { currentGameState.currentLocation = locId; await syncPresence(); renderActionBar(); },
        act: (text) => orchestratePlayerAction(text),
        busy: () => !!currentGameState.rpgOrchestrating,
        orgasm: (npc, internal, count) => resolvePlayerOrgasm(npc, internal !== false, count || 1),
        buff: (target, stat, amt, source) => addCustomStatus(target || 'player', { name: source || 'debug elixir', kind: amt >= 0 ? 'buff' : 'debuff', polarity: amt >= 0 ? 'positive' : 'negative', mods: [{ stat, amount: amt }], duration: 4 }),
        heal: (target, amt) => healStamina(target || 'player', amt),
        reunionNote: (n) => buildReunionNote(n),
        sched: (n) => scheduleSummary((currentGameState.npcRoster || []).find(x => x.name === n) || {}),
        rel: (n) => getRelationship(n),
        presence: (loc) => getNpcsAt(loc || currentGameState.currentLocation).map(n => n.name),
        tick: (n) => { for (let i = 0; i < (n || 1); i++) advanceTime(false); syncPresence(); },
        addParty: (n) => addToParty(n),
        removeParty: (n) => removeFromParty(n),
        reunionNote2: (n) => buildReunionNote(n),
        birth: (n, count, kind) => resolveBirth(n, count || 1, kind, true),
        curse: (target, duration) => applyCrystalCurse(target || 'player', duration),
        castCurse: (eff) => tryApplyCrystalCurse(eff || {}),
        uncurse: (target) => liftCrystalCurse(target || 'player'),
        isCursed: (target) => isCrystalCursed(target || 'player'),
        mana: () => ({ cur: getPlayerRpgData()?.stats.mana, max: maxMana() }),
        addStatus: (target, spec) => addCustomStatus(target || 'player', spec || {}),
        addObjective: (spec) => addCustomStatus('player', { ...(spec || {}), category: 'quest' }),
        objectives: () => playerObjectives(),
        statuses: (target) => ((!target || target === 'player') ? getPlayerRpgData()?.customEffects : getRelationship(target).customEffects) || [],
        checkConditions: () => checkPendingConditions(),
        appraise: (item) => appraiseItem(item),
        equipped: () => equippedItemsSummary(),
        items: () => (getPlayerRpgData()?.inventory.items || []).map(i => ({ name: i.name, equipped: !!i.equipped, effect: i.effectText, usage: i.usage, mod: i.mod })),
        curseWithBreak: (target, cond) => applyCrystalCurse(target || 'player', null, cond),
        giveItem: (name) => addItem({ id: `${String(name).toLowerCase().replace(/\s+/g, '-')}-${Date.now()}`, name, desc: '' }),
        useItemNamed: (name) => useItemByName(name),
        conceptionKind: (n) => resolveConceptionKind(n),
        lorebook: async () => await loadWorldInfo(RPG_LOREBOOK_NAME),
        gmWorld: () => (context.characters || []).find(c => c.avatar === 'Game Master.png')?.data?.extensions?.world,
        offspring: () => currentGameState.offspring || [],
        setPreg: (n, count, pct, kind) => { const r = getRelationship(n); r.pregnancies = count; r.pregnancy_progress = pct; if (kind) r.conceptionKind = kind; savePlayer(); return r; },
        tokens: () => getPlayerRpgData()?.stats.power_tokens,
        statusText: () => { projectPlayerStatus(); const ep = getCtx().extensionPrompts || context.extensionPrompts || {}; return ep[STATUS_PROMPT_KEY]?.value || '(none)'; },
        hurt: (target, amt) => (target && target !== 'player') ? spendNpcStamina(target, amt || 1) : spendStamina(amt || 1),
        examineSelf: () => examineSelf(),
        examineNpc: (n) => examineNpc(n),
        setAffection: (n, v) => { const r = getRelationship(n); r.affection = Math.max(0, Math.min(10, v)); savePlayer(); return r.affection; },
        setArousal: (n, v) => { const r = getRelationship(n); r.arousal = Math.max(1, Math.min(10, v)); savePlayer(); return r.arousal; },
        judgeReaction: (n, preLen) => judgeNpcReaction(n, preLen ?? Math.max(0, (getCtx().chat || []).length - 1)),
        spendNpcStamina: (n, amt) => spendNpcStamina(n, amt || 1),
        nlMove: (d) => doNlMove(d),
        travelIssue: () => travelIssueNote,
        clearLegacyQuests: () => { const rd = getPlayerRpgData(); if (rd && rd.quests) { delete rd.quests; savePlayer(); return 'legacy card-quest state removed'; } return 'nothing to clear'; },
        charmNote: (tier) => buildCharmInterpretationNote(tier ? { tier, success: tier === 'success' || tier === 'critical' } : null),
        maxStamina: () => maxStamina(),
        stamina: () => getStamina(),
        npcStamina: (n) => ({ cur: getRelationship(n).npcStamina, max: npcMaxStamina(n) }),
    };

    // Initialize the extension when loaded
    init();
});