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
import { loadWorldInfo, saveWorldInfo, createWorldInfoEntry, updateWorldInfoList, world_info, world_names } from '../../../world-info.js';

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

    // Day of the week. Fresh games anchor Day 1 to the REAL-LIFE weekday at
    // New Game time (startWeekday); every later date derives from dayCount so
    // the calendar stays consistent across saves.
    const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    function weekdayName(day = currentGameState.dayCount, startWeekday = currentGameState.startWeekday) {
        const anchor = Number.isInteger(startWeekday) ? startWeekday : new Date().getDay();
        return WEEKDAYS[(((anchor + (day || 1) - 1) % 7) + 7) % 7];
    }
    // Legacy saves predate weekday tracking — anchor them so TODAY in-game
    // lands on the real-life weekday at load, same rule as a fresh world.
    function backfillStartWeekday(day) {
        return (((new Date().getDay() - ((day || 1) - 1)) % 7) + 7) % 7;
    }
    function saveWeekdayName(save) {
        return weekdayName(save?.day ?? 1, Number.isInteger(save?.startWeekday) ? save.startWeekday : backfillStartWeekday(save?.day));
    }
    
    // === Authored worlds (world-management phase 2) ===
    // Shipped worlds are read-only files under game-worlds/fresh-worlds/.
    // Authored worlds live in extensionSettings — atomic with ST's settings
    // persistence, no file-write APIs needed. Their cast card data embeds in
    // the world object itself (castData) instead of shipping JSON files.
    function authoredWorlds() {
        context.extensionSettings[extensionName] = context.extensionSettings[extensionName] || {};
        const s = context.extensionSettings[extensionName];
        s.authoredWorlds = s.authoredWorlds || {};
        return s.authoredWorlds;
    }

    /** Unified world loader: authored (settings) first, then shipped (file). */
    async function loadWorldData(worldId) {
        const authored = authoredWorlds()[worldId];
        if (authored) return structuredClone(authored);
        try {
            const worldPath = `scripts/extensions/third-party/rpg-custodian/game-worlds/fresh-worlds/${worldId}/${worldId}.json`;
            const response = await fetch(worldPath);
            if (!response.ok) return null;
            return await response.json();
        } catch { return null; }
    }

    function slugify(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''); }

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

        // The character list loads asynchronously at app boot — everything
        // below (GM ensure, migration) reads it, so fetch it FIRST. Without
        // this the GM was 'not found' on every cold load and re-created.
        try { await context.getCharacters(); } catch (e) { console.warn('RPG Custodian: character list fetch at init failed', e); }

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
        // …and catch character replies vanilla ST produced on its own (continue
        // button, swipe arrows, send-with-empty-field) so they still mark her
        // as having seen him and still face the reaction judge.
        context.eventSource.on(context.eventTypes.MESSAGE_RECEIVED, onNpcMessageLanded);

        // Single-card migration: fold legacy RPGC_ copies into their originals
        // (groups re-pointed, copies deleted). Idempotent; no-ops when clean.
        await migrateSingleCards();

        // In-chat avatar tap → her cast editor (active-world cast only).
        // Capture phase so it wins over ST's default avatar-zoom handler;
        // anyone not in the playing world's editable cast falls through
        // to vanilla behavior untouched.
        document.addEventListener('click', (ev) => {
            const av = ev.target?.closest?.('#chat .mes .avatar');
            if (!av) return;
            const mes = av.closest('.mes');
            const name = mes?.getAttribute('ch_name');
            if (!name || mes.getAttribute('is_user') === 'true' || mes.getAttribute('is_system') === 'true') return;
            if (!currentGameState.isActive) return;
            const worldId = currentGameState.worldData?.worldId;
            if (!authoredWorlds()[worldId]?.castData?.[name]) return;   // GM, player, non-cast → default zoom
            ev.preventDefault(); ev.stopPropagation();
            openCastForm(worldId, name, { quick: true });
        }, true);

        console.log('RPG Custodian: Extension initialized');
    }

    /** One-time single-card migration: every legacy RPGC_ copy whose ORIGINAL
     *  still exists gets folded away — groups swap to the original (Dyna's
     *  call: the original's avatar art wins), then the copy is deleted (chat
     *  files kept). A copy with no original IS the single card and stays. */
    async function migrateSingleCards() {
        try {
            const chars = getCtx().characters || [];
            const copies = chars.filter(c => String(c.avatar).startsWith('RPGC_'));
            let folded = 0;
            for (const copy of copies) {
                const orig = chars.find(c => c.name === copy.name && !String(c.avatar).startsWith('RPGC_'));
                if (!orig) continue;
                for (const g of (getCtx().groups || [])) {
                    let changed = false;
                    for (const key of ['members', 'disabled_members']) {
                        const arr = g[key] || [];
                        const i = arr.indexOf(copy.avatar);
                        if (i >= 0) {
                            if (!arr.includes(orig.avatar)) arr[i] = orig.avatar; else arr.splice(i, 1);
                            changed = true;
                        }
                    }
                    if (changed) { try { await editGroup(g.id, false, false); } catch (e) { console.error('RPG Custodian: group migration failed', g.id, e); } }
                }
                try {
                    await fetch('/api/characters/delete', {
                        method: 'POST', headers: context.getRequestHeaders(),
                        body: JSON.stringify({ avatar_url: copy.avatar, delete_chats: false }),
                    });
                    folded++;
                    ensureRpgTag(orig.avatar);
                    console.log(`RPG Custodian: folded ${copy.avatar} into ${orig.avatar}`);
                } catch (e) { console.error('RPG Custodian: could not delete', copy.avatar, e); }
            }
            if (folded) await context.getCharacters();
        } catch (e) { console.error('RPG Custodian: single-card migration failed', e); }
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
                // An authored world with the same id SHADOWS the shipped one —
                // otherwise the menu lists "prototype-town" twice and which
                // copy loads becomes list-order luck.
                if (authoredWorlds()[worldName]) continue;
                try {
                    const worldPath = `scripts/extensions/third-party/rpg-custodian/game-worlds/fresh-worlds/${worldName}/${worldName}.json`;
                    const response = await fetch(worldPath);

                    if (response.ok) {
                        const worldData = await response.json();
                        loadedWorlds.push({
                            name: worldName,
                            displayName: worldData.name || worldName,
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

            // Authored worlds need no registration — existing IS registration.
            for (const [id, w] of Object.entries(authoredWorlds())) {
                loadedWorlds.push({
                    name: id,
                    displayName: w.name || id,
                    description: w.description || '',
                    emoji: '✍️',
                    authored: true,
                });
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
    // === World Manager (world-management §1, phase 2) ===
    // List → per-world actions. Create/Delete are live; Edit (map builder),
    // Export, and Import arrive with phases 3/6.
    const wmToast = (msg, kind = 'info') => { try { toastr[kind](msg); } catch { console.log('RPG Custodian:', msg); } };

    function openWorldManager() {
        const items = [
            { icon: '➕', label: 'Create a new world', sub: 'name, description & first location — build it out in the map editor later', action: () => createWorldMinimal() },
            { icon: '📥', label: 'Import world bundle', sub: 'a .rpgworld file exported from any RPG Custodian', action: () => { $('#rpg-world-file').remove(); const inp = $('<input id="rpg-world-file" type="file" accept=".rpgworld,.zip,application/zip" style="display:none">'); $('body').append(inp); inp.on('change', function () { importWorldBundle(this.files?.[0]); }); inp.trigger('click'); } },
        ];
        for (const w of availableWorldsCache) {
            items.push({
                icon: w.emoji || '🗺️',
                label: w.displayName || w.name,
                sub: `${w.authored ? 'authored' : 'shipped'}${w.description ? ` — ${w.description.slice(0, 70)}` : ''}`,
                action: () => openWorldActions(w),
            });
        }
        openActionPopup('🌍 Worlds', items);
    }

    function openWorldActions(w) {
        const save = getSaveFor(w.name);
        const items = [
            ...(save ? [{ icon: '▶️', label: 'Continue', sub: `Day ${save.day ?? 1} (${saveWeekdayName(save)}), ${['Morning', 'Day', 'Evening', 'Night'][save.time ?? 0] || ''}`, action: () => continueGame(w.name) }] : []),
            { icon: '🎲', label: 'New Game', sub: `start fresh in ${w.displayName || w.name}`, action: () => newGame(w.name) },
            { icon: '✏️', label: 'Edit world', sub: w.authored ? 'open the map builder' : 'creates an editable copy that overrides the shipped files', action: () => openMapEditor(w.name) },
            { icon: '👥', label: 'Cast', sub: w.authored ? 'add, edit, or remove world characters' : 'creates an editable copy that overrides the shipped files', action: () => openCastManager(w.name) },
            { icon: '📤', label: 'Export bundle', sub: 'a shareable .rpgworld file (world + backgrounds)', action: () => exportWorldBundle(w.name) },
        ];
        if (w.authored) {
            items.push({ icon: '🗑️', label: 'Delete world', sub: 'removes it permanently (saves referencing it will not load)', action: () => deleteAuthoredWorld(w.name) });
        } else {
            items.push({ icon: '🚫', label: 'Deregister', sub: 'hides it from lists; files stay on disk', action: () => deregisterWorldFromManager(w.name) });
        }
        openActionPopup(`${w.emoji || '🗺️'} ${w.displayName || w.name}`, items);
    }

    async function createWorldMinimal() {
        const name = (prompt('World name?') || '').trim();
        if (!name) return;
        const id = slugify(name);
        const conflict = !id
            || availableWorldsCache.some(x => x.name === id || (x.displayName || '').toLowerCase() === name.toLowerCase())
            || authoredWorlds()[id];
        if (conflict) {
            wmToast(`"${name}" conflicts with an existing world — pick another name.`, 'warning');
            return createWorldMinimal();
        }
        const description = (prompt('One-line description of the world?') || '').trim();
        const firstLocName = (prompt('Name of the starting location?') || '').trim() || 'The Crossroads';
        const locId = slugify(firstLocName) || 'start';
        authoredWorlds()[id] = {
            worldId: id,
            name,
            description,
            startingLocation: locId,
            locations: {
                [locId]: { name: firstLocName, description: '', connections: [], background: '' },
            },
            cast: [],
            castData: {},
        };
        context.saveSettingsDebounced();
        await loadRegisteredWorlds();
        wmToast(`World "${name}" created — starting at ${firstLocName}. Build it out in the map editor, or start a New Game to walk its first ground.`, 'success');
    }

    async function deleteAuthoredWorld(id) {
        const w = authoredWorlds()[id];
        if (!w) return;
        if (!confirm(`Delete world "${w.name || id}" permanently? Saves referencing it will no longer load.`)) return;
        delete authoredWorlds()[id];
        context.saveSettingsDebounced();
        await loadRegisteredWorlds();
        wmToast(`World "${w.name || id}" deleted.`, 'success');
    }

    async function deregisterWorldFromManager(id) {
        if (!confirm(`Deregister "${id}"? Its files stay on disk; re-add it anytime with /rpg-register-world.`)) return;
        saveWorldRegistry(getWorldRegistry().filter(x => x !== id));
        await loadRegisteredWorlds();
        wmToast(`World "${id}" deregistered.`, 'success');
    }

    // ========================================================================
    // PLAYER CHARACTER EDITOR
    // ========================================================================
    // Direct edit of the hero's numbers (stats, pools, purse, progression) +
    // a bespoke-status forge: describe an effect in words, the Custodian
    // designs the record (name/kind/mods/ends), the engine applies it.

    function openPlayerEditor() {
        const rd = getPlayerRpgData();
        if (!rd) { wmToast('No RPG character yet — use Create Character first.', 'warning'); return; }
        $('#rpg-player-overlay').remove();
        const s = rd.stats;
        const num = (id, label, val, min, max) => `<label>${label} <input id="${id}" type="number" min="${min}" max="${max}" value="${val}"></label>`;
        const ov = $(`
            <div id="rpg-player-overlay">
                <div class="rpg-form-panel">
                    <div class="rpg-popup-title">🧬 Edit Character</div>
                    <div class="cf-row">
                        ${num('pe-rug', '💪 Ruggedness', s.ruggedness ?? 3, 1, 10)}
                        ${num('pe-charm', '😏 Charm', s.charm ?? 3, 1, 10)}
                    </div>
                    <div class="cf-row">
                        ${num('pe-craft', '🦊 Craftiness', s.craftiness ?? 3, 1, 10)}
                        ${num('pe-vir', '🔥 Virility', s.virility ?? 3, 1, 10)}
                    </div>
                    <div class="cf-row">
                        ${num('pe-stam', `❤️ Stamina (max ${maxStamina()})`, getStamina(), 0, 99)}
                        ${num('pe-mana', `🔮 Mana (max ${maxMana()})`, s.mana ?? 0, 0, 99)}
                    </div>
                    <div class="cf-row">
                        ${num('pe-gold', '🪙 Gold', getGold(), 0, 999999)}
                        ${num('pe-level', '🎚️ Level', s.level ?? 1, 1, 99)}
                    </div>
                    <div class="cf-row">
                        ${num('pe-xp', '✨ XP', s.experience ?? 0, 0, 999999)}
                        ${num('pe-tokens', '⭐ Power Tokens', s.power_tokens ?? 0, 0, 9999)}
                    </div>
                    <div id="pe-effects"></div>
                    <div id="pe-inv"></div>
                    <div class="cf-row">
                        <input id="pe-item-name" type="text" placeholder="new item name — the Custodian appraises its effect">
                        <button type="button" id="pe-item-add" class="rpg-map-btn" title="Add item">➕</button>
                    </div>
                    <label>🪄 Request a bespoke effect from the Custodian
                        <textarea id="pe-status-req" rows="3" placeholder="e.g. a lingering wolf-bite fever, weakening me until cured · a road-blessing, +1 charm for a day · a one-use battle draught for my next fight · a fey pact: +2 craftiness while I owe the errand"></textarea>
                    </label>
                    <button type="button" id="pe-forge" class="rpg-map-btn">🪄 Forge effect <span id="pe-throbber" style="display:none">⏳</span></button>
                    <div id="pe-forge-result"></div>
                    <div class="mp-buttons">
                        <button id="pe-save" class="rpg-map-btn">💾 Save</button>
                        <button id="pe-close" class="rpg-map-btn">Close</button>
                    </div>
                </div>
            </div>`);
        $('body').append(ov);
        // Active effects & objectives, each with a remove control.
        const renderEffects = () => {
            const list = $('#pe-effects').empty();
            const fx = playerCustomEffects();
            if (!fx.length) return;
            list.append('<div class="pe-fx-title">Active effects & objectives:</div>');
            for (const e of fx) {
                const row = $('<div class="pe-fx-row"></div>');
                row.append($('<span class="pe-fx-label"></span>').text(`${effectIcon(e)} ${e.name}${statusModString(e.mods)}`));
                const del = $('<button type="button" class="rpg-map-btn pe-fx-del" title="Remove">✖</button>');
                del.on('click', () => {
                    const rd2 = getPlayerRpgData();
                    rd2.customEffects = (rd2.customEffects || []).filter(x => x !== e && x.id !== e.id);
                    savePlayer();
                    wmToast(`${e.name} dispelled.`, 'success');
                    projectPlayerStatus(); renderActionBar();
                    renderEffects();
                });
                row.append(del);
                list.append(row);
            }
        };
        renderEffects();

        // Inventory: list with remove controls + add-by-name (the appraisal
        // queue invents the effect, chat-silently, same as any acquired item).
        const renderInv = () => {
            const list = $('#pe-inv').empty();
            const items = getPlayerRpgData()?.inventory?.items || [];
            list.append('<div class="pe-fx-title">Inventory:</div>');
            if (!items.length) { list.append('<div class="pe-fx-title" style="opacity:.6">— empty —</div>'); return; }
            for (const it of items) {
                const row = $('<div class="pe-fx-row"></div>');
                row.append($('<span class="pe-fx-label"></span>').text(`${it.equipped ? '🗡️' : '📦'} ${prettyItem(it.name)}${it.effectText ? ` — ${it.effectText}` : ' — appraising…'}`));
                const del = $('<button type="button" class="rpg-map-btn pe-fx-del" title="Remove">✖</button>');
                del.on('click', () => {
                    removeItemById(it.id);
                    wmToast(`${prettyItem(it.name)} removed.`, 'success');
                    renderActionBar(); renderInv();
                });
                row.append(del);
                list.append(row);
            }
        };
        renderInv();
        $('#pe-item-add').on('click', (e) => {
            e.stopPropagation();
            const nm = String($('#pe-item-name').val() || '').trim();
            if (!nm) return;
            addItem({ id: `${slugify(nm)}-${Date.now()}`, name: nm, desc: '' });
            $('#pe-item-name').val('');
            renderInv();
        });
        // Appraisals land async — refresh the list until none are pending.
        const invTimer = setInterval(() => {
            if (!document.getElementById('rpg-player-overlay')) { clearInterval(invTimer); return; }
            if ((getPlayerRpgData()?.inventory?.items || []).some(i => !i.effectText)) renderInv();
            else if ($('#pe-inv .pe-fx-label:contains("appraising")').length) renderInv();
        }, 1500);

        $('#pe-close').on('click', () => $('#rpg-player-overlay').remove());
        $('#pe-save').on('click', () => {
            const v = (id, min, max) => Math.max(min, Math.min(max, Number($(`#${id}`).val()) || 0));
            s.ruggedness = v('pe-rug', 1, 10); s.charm = v('pe-charm', 1, 10);
            s.craftiness = v('pe-craft', 1, 10); s.virility = v('pe-vir', 1, 10);
            s.level = v('pe-level', 1, 99);
            s.experience = v('pe-xp', 0, 999999);
            s.power_tokens = v('pe-tokens', 0, 9999);
            s.mana = Math.min(v('pe-mana', 0, 99), maxMana());
            s.stamina = Math.min(v('pe-stam', 0, 99), maxStamina());
            if (s.stamina > 0) s.unconscious = false;
            rd.inventory.currency = v('pe-gold', 0, 999999);
            savePlayer();
            projectPlayerStatus(); renderActionBar();
            $('#rpg-player-overlay').remove();
            wmToast('Character updated.', 'success');
        });
        $('#pe-forge').on('click', async function () {
            const text = String($('#pe-status-req').val() || '').trim();
            if (!text) return;
            const btn = $(this);
            btn.prop('disabled', true); $('#pe-throbber').show();
            try {
                const rec = await forgeBespokeStatus(text);
                $('#pe-forge-result').html(rec
                    ? `<div class="pe-forged">${effectIcon(rec)} <b></b>${statusModString(rec.mods)} — applied.</div>`
                    : `<div class="pe-forged">The Custodian couldn't shape that one — try rewording.</div>`);
                if (rec) { $('#pe-forge-result .pe-forged b').text(rec.name); $('#pe-status-req').val(''); renderEffects(); }
            } catch (e) {
                console.error('RPG Custodian: bespoke forge failed', e);
                $('#pe-forge-result').text('The forge sputtered — check the console.');
            } finally { btn.prop('disabled', false); $('#pe-throbber').hide(); }
        });
    }

    /** The Custodian designs an effect record from the player's words.
     *  target: 'player' or an NPC name. */
    async function forgeBespokeStatus(text, target = 'player') {
        const forNpc = target && target !== 'player';
        const sys = `You are the RPG CUSTODIAN. Design a bespoke applied effect from a plain-language request. Output ONLY JSON:
{"name":"short evocative name","kind":"buff|debuff|blessing|curse|pact|vow|disease|poison|status","polarity":"positive"|"negative","desc":"one line of what it does","mods":[{"stat":"ruggedness|charm|craftiness|virility|stamina${forNpc ? '|fertility' : ''}","amount":N}],"duration":N,"end_condition":"plain-English story event that ends it, or omit","expires_on_check":"a stat name for a ONE-USE pre-buff spent on the next trial of that stat, or omit"}
Rules: core stats run ~1-10, so mods are SMALL integers ±1..±3 (±5 only for potent magic).${forNpc ? ' FERTILITY is a percentage (0-100), so fertility mods are +10..+30.' : ''} duration is in time periods (4 per day) — always give lingering NEGATIVE effects a duration backstop even when they have an end_condition. Honor the SPIRIT of the request: a one-use "before my next fight" boost gets expires_on_check; a curse gets an end_condition worth roleplaying toward. Invent flavor freely; never refuse.`;
        const prompt = forNpc
            ? `The effect is applied to the NPC ${target}. Request: "${text}"`
            : `Player's request: "${text}"\nPlayer right now: ${statsContextForAnalyzer()}`;
        const p = await generateJson({ prompt, systemPrompt: sys, budget: 300 });
        if (!p || !p.name) return null;
        return addCustomStatus(target, p, true);   // quiet: the editors are meta, not story
    }

    /** Live NPC effects panel — sandbox forge/remove on a cast member.
     *  Statuses are per-save state, so this needs an active session that
     *  actually contains her. */
    function openNpcEffectsPanel(name) {
        if (!currentGameState.isActive || !(currentGameState.npcRoster || []).some(n => n.name === name)) {
            wmToast(`Live effects need an active game session with ${name} in its cast — start or continue one first.`, 'warning');
            return;
        }
        $('#rpg-cast-overlay').remove();
        const ov = $(`
            <div id="rpg-cast-overlay">
                <div class="rpg-form-panel">
                    <div class="rpg-popup-title">✨ ${$('<i>').text(name).html()} — live effects</div>
                    <div id="ne-effects"></div>
                    <label>🪄 Request a bespoke effect from the Custodian
                        <textarea id="ne-req" rows="3" placeholder="e.g. a fertility blessing from the spring rites · a jealous hex sapping her charm until forgiven · feverish and weak until nursed back to health"></textarea>
                    </label>
                    <button type="button" id="ne-forge" class="rpg-map-btn">🪄 Forge effect <span id="ne-throbber" style="display:none">⏳</span></button>
                    <div id="ne-result"></div>
                    <div class="mp-buttons"><button id="ne-close" class="rpg-map-btn">Close</button></div>
                </div>
            </div>`);
        $('body').append(ov);
        const renderFx = () => {
            const list = $('#ne-effects').empty();
            const fx = npcActiveEffects(name);
            if (!fx.length) { list.append('<div class="pe-fx-title">No active effects.</div>'); return; }
            list.append('<div class="pe-fx-title">Active effects:</div>');
            for (const e of fx) {
                const row = $('<div class="pe-fx-row"></div>');
                row.append($('<span class="pe-fx-label"></span>').text(effectDetailLine(e)));
                const del = $('<button type="button" class="rpg-map-btn pe-fx-del" title="Remove">✖</button>');
                del.on('click', () => {
                    const rel = getRelationship(name);
                    rel.customEffects = (rel.customEffects || []).filter(x => x !== e && x.id !== e.id);
                    savePlayer();
                    wmToast(`${e.name} removed from ${name}.`, 'success');
                    projectPlayerStatus();
                    renderFx();
                });
                row.append(del);
                list.append(row);
            }
        };
        renderFx();
        $('#ne-close').on('click', () => $('#rpg-cast-overlay').remove());
        $('#ne-forge').on('click', async function () {
            const text = String($('#ne-req').val() || '').trim();
            if (!text) return;
            const btn = $(this);
            btn.prop('disabled', true); $('#ne-throbber').show();
            try {
                const rec = await forgeBespokeStatus(text, name);
                $('#ne-result').html(rec
                    ? `<div class="pe-forged">${effectIcon(rec)} <b></b>${statusModString(rec.mods)} — applied to ${$('<i>').text(name).html()}.</div>`
                    : '<div class="pe-forged">The Custodian couldn\'t shape that one — try rewording.</div>');
                if (rec) { $('#ne-result .pe-forged b').text(rec.name); $('#ne-req').val(''); projectPlayerStatus(); renderFx(); }
            } catch (e) {
                console.error('RPG Custodian: NPC forge failed', e);
                $('#ne-result').text('The forge sputtered — check the console.');
            } finally { btn.prop('disabled', false); $('#ne-throbber').hide(); }
        });
    }

    // ========================================================================
    // WORLD BUNDLES — export/import (world-management §6, phase 6)
    // ========================================================================
    // A .rpgworld bundle is a zip: world.json (the full authored world,
    // castData included) + the background images its locations reference.
    // Import validates, walks name conflicts with rename prompts, uploads
    // missing backgrounds, and installs as an authored world. Cast characters
    // materialize from castData on first play (ensureCastExists), so no
    // character files travel in the bundle.

    async function ensureJSZip() {
        if (window.JSZip) return window.JSZip;
        await new Promise((res, rej) => {
            const sc = document.createElement('script');
            sc.src = '/lib/jszip.min.js';
            sc.onload = res; sc.onerror = () => rej(new Error('jszip load failed'));
            document.head.appendChild(sc);
        });
        return window.JSZip;
    }

    async function exportWorldBundle(worldId) {
        let world = authoredWorlds()[worldId];
        if (!world) world = await materializeShippedWorld(worldId);
        if (!world) { wmToast(`World "${worldId}" could not be loaded.`, 'error'); return; }
        wmToast('Building bundle…', 'info');
        try {
            const JSZip = await ensureJSZip();
            const zip = new JSZip();
            zip.file('world.json', JSON.stringify({ format: 'rpg-custodian-world', version: 1, world }, null, 1));
            // Backgrounds the world references (map image + per-location scenes)
            const bgs = new Set([world.mapImage, ...Object.values(world.locations || {}).map(l => l.background)].filter(Boolean));
            for (const bg of bgs) {
                try {
                    const r = await fetch(`backgrounds/${encodeURIComponent(bg)}`);
                    if (r.ok) zip.file(`backgrounds/${bg}`, await r.blob());
                } catch { /* missing background file — bundle without it */ }
            }
            // The world's bound lorebook travels too
            if (world.lorebook) {
                try {
                    const lb = await loadWorldInfo(world.lorebook);
                    if (lb?.entries) zip.file('lorebook.json', JSON.stringify({ name: world.lorebook, data: lb }));
                } catch { /* book missing — bundle without it */ }
            }
            const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = `${world.worldId || worldId}.rpgworld`;
            document.body.appendChild(a); a.click(); a.remove();
            setTimeout(() => URL.revokeObjectURL(a.href), 30000);
            wmToast(`Exported ${a.download} (${bgs.size} background${bgs.size === 1 ? '' : 's'} bundled).`, 'success');
        } catch (e) { console.error('RPG Custodian: export failed', e); wmToast('Export failed — check the console.', 'error'); }
    }

    async function importWorldBundle(file) {
        if (!file) { $('#rpg-world-file').remove(); return; }
        try {
            const JSZip = await ensureJSZip();
            const zip = await JSZip.loadAsync(await file.arrayBuffer());
            const manifestFile = zip.file('world.json');
            if (!manifestFile) { wmToast('Not a world bundle — no world.json inside.', 'error'); return; }
            const manifest = JSON.parse(await manifestFile.async('string'));
            if (manifest.format !== 'rpg-custodian-world' || !manifest.world?.locations) {
                wmToast('Not a valid RPG Custodian world bundle.', 'error'); return;
            }
            const world = manifest.world;

            // World name conflict → rename prompt (no silent overwrites)
            const taken = (id, nm) => availableWorldsCache.some(x => x.name === id || (x.displayName || '').toLowerCase() === nm.toLowerCase()) || !!authoredWorlds()[id];
            while (taken(slugify(world.name || world.worldId), String(world.name || world.worldId))) {
                const nn = (prompt(`A world named "${world.name}" already exists. New name for the imported world?`) || '').trim();
                if (!nn) { wmToast('Import cancelled.', 'info'); return; }
                world.name = nn;
            }
            world.worldId = slugify(world.name || world.worldId);

            // Cast name conflicts (RPGC copy or another world's cast) → rename
            world.castData = world.castData || {};
            for (const name of [...(world.cast || [])]) {
                const clash = getCtx().characters.some(c => c.avatar === `RPGC_${name}.png`)
                    || Object.values(authoredWorlds()).some(w2 => w2 !== world && (w2.cast || []).includes(name));
                if (!clash) continue;
                const nn = (prompt(`Cast member "${name}" conflicts with an existing character. New name for her in this world?`) || '').trim();
                if (!nn || nn === name) continue;   // keep — shared-name caveat applies
                world.cast = world.cast.map(n => (n === name ? nn : n));
                if (world.castData[name]) {
                    world.castData[nn] = world.castData[name];
                    delete world.castData[name];
                    (world.castData[nn].data || world.castData[nn]).name = nn;
                    world.castData[nn].name = nn;
                }
            }

            // Upload bundled backgrounds that aren't installed yet
            let bgUp = 0;
            const existing = new Set(((await (await fetch('/api/backgrounds/all', { method: 'POST', headers: context.getRequestHeaders(), body: '{}' })).json()).images) || []);
            for (const [path, entry] of Object.entries(zip.files)) {
                if (entry.dir || !path.startsWith('backgrounds/')) continue;
                const bgName = path.slice('backgrounds/'.length);
                if (!bgName || existing.has(bgName)) continue;
                const fd = new FormData();
                fd.append('avatar', new File([await entry.async('blob')], bgName));
                const r = await fetch('/api/backgrounds/upload', { method: 'POST', headers: context.getRequestHeaders({ omitContentType: true }), body: fd });
                if (r.ok) bgUp++;
            }

            // Bundled lorebook: install unless a book of that name already exists
            const lbFile = zip.file('lorebook.json');
            if (lbFile) {
                try {
                    const lb = JSON.parse(await lbFile.async('string'));
                    if (lb?.name && lb.data?.entries) {
                        if ((world_names || []).includes(lb.name)) {
                            wmToast(`Lorebook "${lb.name}" already exists — the world will use your copy.`, 'info');
                        } else {
                            await saveWorldInfo(lb.name, lb.data, true);
                            await updateWorldInfoList();
                        }
                        world.lorebook = lb.name;
                    }
                } catch (e) { console.warn('RPG Custodian: bundled lorebook skipped', e); }
            }

            authoredWorlds()[world.worldId] = world;
            context.saveSettingsDebounced();
            await loadRegisteredWorlds();
            wmToast(`World "${world.name}" imported (${Object.keys(world.locations).length} locations, ${(world.cast || []).length} cast, ${bgUp} background${bgUp === 1 ? '' : 's'} added${world.lorebook ? `, lorebook "${world.lorebook}"` : ''}).`, 'success');
        } catch (e) { console.error('RPG Custodian: import failed', e); wmToast('Import failed — check the console.', 'error'); }
        finally { $('#rpg-world-file').remove(); }
    }

    // ========================================================================
    // CAST ONBOARDING WIZARD (world-management §4, phase 4)
    // ========================================================================
    // Any V2 character — already-installed or imported from a card file —
    // becomes world cast through the RPG-ify form, which writes the
    // rpg_custodian extensions block into the world's embedded castData.
    // Adopting a character means the world manages its card from then on
    // (ensureCastExists refreshes it; greetings are stripped in RPG use).

    // Toggle buttons instead of checkboxes: ST's global CSS restyles native
    // checkboxes in ways that break rendering AND taps outside its own
    // markup — a plain button with state is mobile-proof.
    function setToggle($btn, on) {
        $btn.attr('data-on', on ? '1' : '0').toggleClass('rpg-toggle-on', !!on).find('b').text(on ? 'Yes' : 'No');
    }
    function getToggle($btn) { return $btn.attr('data-on') === '1'; }
    $(document).on('click', '.rpg-toggle', function (e) { e.stopPropagation(); setToggle($(this), !getToggle($(this))); });

    /** Location-anchoring hygiene: phrases like "always perched behind the
     *  counter" make models relocate the NPC there forever (the Wren lesson). */
    function anchorWarnings(text) {
        const rx = /\b(always|usually|often|can be found|is found|never leaves)\b[^.]{0,40}\b(sitting|sits|standing|stands|perched|behind|at the|in the|inside)\b|behind the counter|in (his|her) (shop|store|stall|inn|tavern|tower|hut)|spends (his|her) (days?|time) (in|at)/gi;
        return String(text || '').match(rx) || [];
    }

    async function openCastManager(worldId) {
        let world = authoredWorlds()[worldId];
        if (!world) world = await materializeShippedWorld(worldId);
        if (!world) { wmToast(`World "${worldId}" could not be loaded.`, 'error'); return; }
        const items = [
            { icon: '➕', label: 'Add from installed characters', sub: 'pick any character you already have', action: () => openCastPicker(worldId) },
            { icon: '📁', label: 'Import a card file', sub: 'V2 card as .json or .png', action: () => { $('#rpg-cast-file').remove(); const inp = $('<input id="rpg-cast-file" type="file" accept=".json,.png,application/json,image/png" style="display:none">'); $('body').append(inp); inp.on('change', function () { importCastCardFile(worldId, this.files?.[0]); }); inp.trigger('click'); } },
        ];
        for (const name of (world.cast || [])) {
            const rc = (world.castData?.[name]?.data || world.castData?.[name] || {}).extensions?.rpg_custodian || {};
            items.push({
                icon: rc.secret ? '🕵️' : '👤',
                label: name,
                sub: `${rc.role || 'no role yet'} — home: ${world.locations?.[rc.home_location]?.name || rc.home_location || 'unset'}`,
                action: () => openCastMemberActions(worldId, name),
            });
        }
        openActionPopup(`👥 Cast of ${world.name || worldId}`, items);
    }

    function openCastMemberActions(worldId, name) {
        openActionPopup(`👤 ${name}`, [
            { icon: '✏️', label: 'Edit RPG details', action: () => openCastForm(worldId, name) },
            { icon: '✨', label: 'Live effects', sub: 'forge or remove statuses on her in the running game', action: () => openNpcEffectsPanel(name) },
            { icon: '🗑️', label: 'Remove from cast', sub: 'the character itself stays installed', action: () => {
                if (!confirm(`Remove ${name} from this world's cast?`)) return;
                const world = authoredWorlds()[worldId];
                world.cast = (world.cast || []).filter(n => n !== name);
                if (world.castData) delete world.castData[name];
                context.saveSettingsDebounced();
                removeRpgTagIfUnused(name);
                wmToast(`${name} removed from the cast.`, 'success');
                openCastManager(worldId);
            } },
        ]);
    }

    function openCastPicker(worldId) {
        const world = authoredWorlds()[worldId];
        $('#rpg-cast-overlay').remove();
        const existing = new Set(world.cast || []);
        const chars = getCtx().characters.filter(c => c.name !== 'Game Master' && !existing.has(c.name));
        const ov = $(`
            <div id="rpg-cast-overlay">
                <div class="rpg-form-panel">
                    <div class="rpg-popup-title">➕ Add cast member</div>
                    <input id="cast-filter" type="text" placeholder="filter characters…">
                    <div id="cast-list"></div>
                    <div class="mp-buttons"><button id="cast-pick-cancel" class="rpg-map-btn">Cancel</button></div>
                </div>
            </div>`);
        $('body').append(ov);
        const renderList = () => {
            const q = String($('#cast-filter').val() || '').toLowerCase();
            const list = $('#cast-list').empty();
            for (const c of chars.filter(c => c.name.toLowerCase().includes(q)).slice(0, 60)) {
                const row = $('<div class="rpg-menu-item"></div>').text(`👤 ${c.name}`);
                row.on('click', () => { $('#rpg-cast-overlay').remove(); adoptCharacter(worldId, c); });
                list.append(row);
            }
        };
        $('#cast-filter').on('input', renderList);
        $('#cast-pick-cancel').on('click', (e) => { e.stopPropagation(); $('#rpg-cast-overlay').remove(); openCastManager(worldId); });
        renderList();
    }

    async function importCastCardFile(worldId, file) {
        // NOTE: the file input stays in the DOM until the upload finishes —
        // removing it first invalidated the File handle mid-fetch.
        if (!file) { $('#rpg-cast-file').remove(); return; }
        try {
            // Snapshot into memory first: streaming the input's File directly
            // into a multipart fetch intermittently drops the connection.
            const payload = new File([await file.arrayBuffer()], file.name, { type: file.type });
            const fd = new FormData();
            fd.append('avatar', payload);
            fd.append('file_type', file.name.split('.').pop().toLowerCase());
            const r = await fetch('/api/characters/import', { method: 'POST', headers: context.getRequestHeaders({ omitContentType: true }), body: fd });
            if (!r.ok) throw new Error(String(r.status));
            const data = await r.json();
            await context.getCharacters();
            const char = getCtx().characters.find(c => c.avatar === data.file_name || c.avatar === `${data.file_name}.png`)
                || getCtx().characters.find(c => c.name === String(data.file_name).replace(/\.png$/, ''));
            if (!char) { wmToast('Imported, but the character could not be located afterwards.', 'error'); return; }
            adoptCharacter(worldId, char);
        } catch (e) { console.error('RPG Custodian: card import failed', e); wmToast('Card import failed.', 'error'); }
        finally { $('#rpg-cast-file').remove(); }
    }

    /** Snapshot a live ST character into an embeddable castData card. */
    function cardFromLiveChar(char) {
        const d = char.data || {};
        return {
            name: char.name,
            description: d.description ?? char.description ?? '',
            personality: d.personality ?? char.personality ?? '',
            scenario: d.scenario ?? char.scenario ?? '',
            mes_example: d.mes_example ?? char.mes_example ?? '',
            creator_notes: d.creator_notes ?? '',
            system_prompt: d.system_prompt || '',
            post_history_instructions: d.post_history_instructions || '',
            creator: d.creator || '',
            character_version: d.character_version || '',
            tags: structuredClone(d.tags || []),
            extensions: structuredClone(d.extensions || {}),
        };
    }

    function adoptCharacter(worldId, char) {
        const world = authoredWorlds()[worldId];
        if ((world.cast || []).includes(char.name)) { wmToast(`${char.name} is already in this cast.`, 'warning'); return; }
        world.castData = world.castData || {};
        const cd = cardFromLiveChar(char);
        // Remember where the portrait lives — the RPGC_ world copy is created
        // from this JSON later, and without a source the create API paints the
        // default silhouette over her face.
        cd.extensions.rpg_custodian = { ...(cd.extensions.rpg_custodian || {}), source_avatar: char.avatar };
        world.castData[char.name] = cd;
        ensureRpgTag(char.avatar);
        openCastForm(worldId, char.name, { adopting: true });
    }

    /** The RPG-ify form: writes the rpg_custodian block into castData. */
    function openCastForm(worldId, name, opts = {}) {
        const world = authoredWorlds()[worldId];
        const card = world.castData?.[name];
        if (!card) { wmToast(`No card data for ${name}.`, 'error'); return; }
        const rc = card.extensions?.rpg_custodian || {};
        $('#rpg-cast-overlay').remove();

        const locOptions = Object.entries(world.locations || {}).map(([id, l]) => `<option value="${id}">${$('<i>').text(l.name || id).html()}</option>`).join('');
        const periods = ['Morning', 'Day', 'Evening', 'Night'];
        const warns = anchorWarnings(card.description);
        const ov = $(`
            <div id="rpg-cast-overlay">
                <div class="rpg-form-panel">
                    <div class="rpg-popup-title">🎭 ${$('<i>').text(name).html()} — RPG details</div>
                    ${(() => {
                        const chars = getCtx().characters || [];
                        const pav = [castCharFor(name)?.avatar, rc.source_avatar, chars.find(c => c.name === name && !String(c.avatar).startsWith('RPGC_'))?.avatar]
                            .find(a => a && chars.some(c => c.avatar === a));
                        return pav ? `<div class="cf-portrait-wrap"><img id="cf-portrait" src="/characters/${encodeURIComponent(pav)}" alt=""><button id="cf-portrait-full" class="rpg-map-btn" title="Full screen">⛶</button></div>` : '';
                    })()}
                    ${warns.length ? `<div class="cast-warn">⚠️ Location-anchored phrasing in her card description may pin her to one spot in narration: <b>${$('<i>').text(warns.join(' · ')).html()}</b> — consider rewording the card.</div>` : ''}
                    <label>Role (public identity) <input id="cf-role" type="text" placeholder="innkeeper, wandering knight, witch…"></label>
                    <div class="cf-row">
                        <label>Race <input id="cf-race" type="text"></label>
                        <label>Age <input id="cf-age" type="text"></label>
                    </div>
                    <div class="cf-row">
                        <label>Fertility mod (%) <input id="cf-fert" type="number" min="-40" max="100"></label>
                        <label>Ruggedness <input id="cf-rug" type="number" min="1" max="10"></label>
                    </div>
                    <div id="cf-fert-calc" class="cf-fert-calc"></div>
                    <div class="cf-row">
                        <label>Womb type <select id="cf-womb">
                            <option value="">Auto (by race)</option>
                            <option value="live">Baby (live birth)</option>
                            <option value="egg">Egg</option>
                            <option value="crystal">Crystal</option>
                        </select></label>
                        <label>Pregnancies carried <input id="cf-pregs" type="number" min="0" max="20"></label>
                    </div>
                    <label>Pregnancy progress % (5 conception → 100 term, 150 max) <input id="cf-prog" type="number" min="0" max="150"></label>
                    <div class="cf-row">
                        <label>Initial affection (0–10) <input id="cf-aff" type="number" min="0" max="10"></label>
                        <label>Initial arousal (0–10) <input id="cf-aro" type="number" min="0" max="10"></label>
                    </div>
                    <label>Current stamina — live game only, applied by ⚡ <input id="cf-stam" type="number" min="0" max="99"></label>
                    <label>🧠 Character note — her forefront thoughts / current objective <span id="cf-note-state"></span>
                        <textarea id="cf-note" rows="2" placeholder="auto-saves as you type; future task & mind-altering systems write here too"></textarea>
                    </label>
                    <label>Home <select id="cf-home">${locOptions}</select></label>
                    <div class="cf-sched">${periods.map(p => `<label>${p} <select class="cf-period" data-p="${p}">${locOptions}</select></label>`).join('')}</div>
                    <button type="button" id="cf-secret" class="rpg-toggle">🕵️ Secret (unknown to other NPCs): <b>No</b></button>
                    <label>Shop category (if merchant) <input id="cf-shop" type="text" placeholder="alchemist, smith, general…"></label>
                    <div class="mp-buttons">
                        <button id="cf-save" class="rpg-map-btn">💾 Save</button>
                        <button id="cf-apply" class="rpg-map-btn" title="Save to the world AND update her in the running game (affection, arousal, stats, schedule)">⚡ Save + apply to game</button>
                        <button id="cf-cancel" class="rpg-map-btn">Cancel</button>
                    </div>
                </div>
            </div>`);
        $('body').append(ov);
        $('#cf-role').val(rc.role || '');
        $('#cf-race').val(rc.race || '');
        $('#cf-age').val(rc.age || '');
        $('#cf-fert').val(rc.fertility ?? 10);
        $('#cf-rug').val(rc.ruggedness ?? 2);
        $('#cf-womb').val(['live', 'egg', 'crystal'].includes(rc.womb_type) ? rc.womb_type : '');
        $('#cf-pregs').val(rc.base_stats?.pregnancies ?? 0);
        $('#cf-prog').val(rc.base_stats?.pregnancy_progress ?? 0);
        $('#cf-aff').val(rc.base_stats?.affection ?? 0);
        $('#cf-aro').val(rc.base_stats?.arousal ?? 0);
        // Live cycle preview: the mod is on top of the 8-step moon cycle —
        // show what it buys (fertile days per cycle + peak) before saving.
        const fertCalc = () => {
            const mod = Number($('#cf-fert').val()) || 0;
            const days = MOON_CYCLE.filter(p => Math.max(0, Math.min(100, p.pct + mod)) > 0).length;
            const peak = Math.max(0, Math.min(100, 40 + mod));
            $('#cf-fert-calc').text(`🌱 ${days} of 8 cycle days fertile · peak ${peak}% at 🌕 (cycle 🌑0 🌒10 🌓20 🌔30 🌕40 🌖30 🌗20 🌘10 + mod)`);
        };
        let fertTimer = null;
        $('#cf-fert').on('input', () => { clearTimeout(fertTimer); fertTimer = setTimeout(fertCalc, 350); });
        fertCalc();
        // Current stamina is per-save state: only meaningful with a running
        // session in this world that has her on stage.
        {
            const live = currentGameState.isActive && currentGameState.worldData?.worldId === worldId
                && (currentGameState.npcRoster || []).some(n => n.name === name);
            if (live) $('#cf-stam').val(getRelationship(name).npcStamina ?? npcMaxStamina(name)).attr('max', npcMaxStamina(name));
            else $('#cf-stam').prop('disabled', true).attr('placeholder', 'no running game');
        }

        // 🧠 Character note (ST depth_prompt): her forefront thoughts/objective.
        // Debounced 2s auto-save into castData + version bump; hot-pushed onto
        // her live card when a session has her on stage. Future NPC-task and
        // mind-altering systems write this same field.
        $('#cf-note').val(card.extensions?.depth_prompt?.prompt || '');
        let noteTimer = null;
        $('#cf-note').on('input', function () {
            $('#cf-note-state').text('… typing');
            clearTimeout(noteTimer);
            noteTimer = setTimeout(async () => {
                const val = String($('#cf-note').val() || '').trim();
                card.extensions = card.extensions || {};
                card.extensions.depth_prompt = { prompt: val, depth: card.extensions.depth_prompt?.depth ?? 4, role: card.extensions.depth_prompt?.role || 'system' };
                const rc3 = card.extensions.rpg_custodian;
                if (rc3) rc3.card_version = ((parseFloat(rc3.card_version || '1.0') || 1) + 0.1).toFixed(1);
                context.saveSettingsDebounced();
                const live = currentGameState.isActive && currentGameState.worldData?.worldId === worldId && castCharFor(name);
                if (live) {
                    try { await mergeRpgIntoCard(castCharFor(name), card); }
                    catch (e) { console.error('RPG Custodian: live note push failed', e); }
                }
                $('#cf-note-state').text(live ? '✓ saved & live' : '✓ saved');
            }, 2000);
        });
        $('#cf-home').val(rc.home_location && world.locations[rc.home_location] ? rc.home_location : world.startingLocation);
        for (const p of periods) $(`.cf-period[data-p="${p}"]`).val(rc.schedule?.[p] && world.locations[rc.schedule[p]] ? rc.schedule[p] : $('#cf-home').val());
        $('#cf-home').on('change', function () { for (const p of periods) $(`.cf-period[data-p="${p}"]`).val(this.value); });
        setToggle($('#cf-secret'), !!rc.secret);
        $('#cf-shop').val(rc.shop || '');
        // Portrait → full screen (the vanilla avatar-zoom behavior, relocated
        // here). Overlay parents to the cast overlay, never body (ST layout).
        const openPortraitFull = (e) => {
            e.stopPropagation();
            const src = $('#cf-portrait').attr('src');
            if (!src) return;
            const fs = $(`<div class="cf-portrait-fs"><img src="${src}" alt=""></div>`);
            fs.on('click', () => fs.remove());
            $('#rpg-cast-overlay').append(fs);
        };
        $('#cf-portrait, #cf-portrait-full').on('click', openPortraitFull);
        $('#cf-cancel').on('click', (e) => {
            e.stopPropagation();
            $('#rpg-cast-overlay').remove();
            if (opts.adopting) delete world.castData[name];   // adoption not completed
            if (!opts.quick) openCastManager(worldId);   // flow back to the cast list (quick-access closes outright)
        });
        const saveCastForm = (applyLive) => {
            const schedule = {};
            for (const p of periods) schedule[p] = $(`.cf-period[data-p="${p}"]`).val();
            card.extensions = card.extensions || {};
            const prev = card.extensions.rpg_custodian || {};
            card.extensions.rpg_custodian = {
                ...prev,
                version: prev.version || '1.0',
                role: String($('#cf-role').val() || '').trim(),
                race: String($('#cf-race').val() || '').trim(),
                age: String($('#cf-age').val() || '').trim(),
                fertility: Math.max(-40, Math.min(100, Number($('#cf-fert').val()) || 0)),
                ruggedness: Math.max(1, Math.min(10, Number($('#cf-rug').val()) || 2)),
                womb_type: ['live', 'egg', 'crystal'].includes($('#cf-womb').val()) ? $('#cf-womb').val() : undefined,
                home_location: $('#cf-home').val(),
                schedule,
                secret: getToggle($('#cf-secret')) || undefined,
                shop: String($('#cf-shop').val() || '').trim() || undefined,
                base_stats: {
                    ...(prev.base_stats || { familiarity: 0 }),
                    affection: Math.max(0, Math.min(10, Number($('#cf-aff').val()) || 0)),
                    arousal: Math.max(0, Math.min(10, Number($('#cf-aro').val()) || 0)),
                    pregnancies: Math.max(0, Math.min(20, Number($('#cf-pregs').val()) || 0)),
                    pregnancy_progress: Math.max(0, Math.min(150, Number($('#cf-prog').val()) || 0)),
                },
                card_version: ((parseFloat(prev.card_version || '1.0') || 1.0) + 0.1).toFixed(1),
            };
            if (!(world.cast || []).includes(name)) world.cast = [...(world.cast || []), name];
            context.saveSettingsDebounced();

            // ⚡ Also push the saved values into the RUNNING game: relationship
            // affection/arousal set to the authored values, and the live roster
            // entry updated so role/stats/schedule changes bite without restart.
            if (applyLive) {
                const active = currentGameState.isActive && currentGameState.worldData?.worldId === worldId;
                if (!active) {
                    wmToast('No running game in this world — saved to world data; it applies on the next New Game or Continue.', 'warning');
                } else {
                    const rc2 = card.extensions.rpg_custodian;
                    const rel = getRelationship(name);
                    rel.affection = rc2.base_stats.affection;
                    rel.arousal = rc2.base_stats.arousal;
                    rel.pregnancies = rc2.base_stats.pregnancies || 0;
                    rel.pregnancy_progress = rc2.base_stats.pregnancy_progress || 0;
                    const npc = (currentGameState.npcRoster || []).find(n => n.name === name);
                    if (npc) {
                        Object.assign(npc, { role: rc2.role, race: rc2.race, age: rc2.age, fertility: rc2.fertility, ruggedness: rc2.ruggedness, secret: !!rc2.secret, homeLocation: rc2.home_location, schedule: rc2.schedule, baseStats: rc2.base_stats, wombType: rc2.womb_type || null });
                        // Current stamina (after the roster update so the new
                        // ruggedness sets the cap). Direct set — KO/wake flags
                        // follow, no post-coital valve.
                        const stamRaw = $('#cf-stam').val();
                        if (stamRaw !== '' && !$('#cf-stam').prop('disabled')) {
                            const maxSta = npcMaxStamina(name);
                            rel.npcStamina = Math.max(0, Math.min(maxSta, Number(stamRaw) || 0));
                            if (rel.npcStamina > 0) { rel.npcUnconscious = false; rel.stashedAt = null; rel.koStep = null; }
                            else { rel.npcUnconscious = true; rel.koStep = currentGameState.timeStep || 0; }
                        }
                    } else {
                        wmToast(`${name} is new to this cast — she takes the stage fully on the next Continue.`, 'info');
                    }
                    // Pregnancy coherence AFTER the roster update (kind
                    // resolution reads her authored womb type).
                    if ((rel.pregnancies || 0) > 0) {
                        if ((rel.pregnancy_progress || 0) <= 0) rel.pregnancy_progress = 5;
                        rel.conceptionKind = ['live', 'egg', 'crystal'].includes(rc2.womb_type) ? rc2.womb_type : (rel.conceptionKind || resolveConceptionKind(name));
                    } else { rel.conceptionKind = null; rel.pregnancy_progress = 0; }
                    savePlayer(); saveCurrentState();
                    syncPresence(); projectPlayerStatus();
                    wmToast(`${name}'s current-game state updated (affection ${rel.affection}, arousal ${rel.arousal}${rel.npcStamina != null ? `, stamina ${rel.npcStamina}/${npcMaxStamina(name)}` : ''}${rel.pregnancies ? `, carrying ${rel.pregnancies} @ ${rel.pregnancy_progress}% (${rel.conceptionKind})` : ''}).`, 'success');
                }
            }

            $('#rpg-cast-overlay').remove();
            wmToast(`${name} ${opts.adopting ? 'joined the cast of' : 'updated in'} ${world.name || worldId}.`, 'success');
            if (!opts.quick) openCastManager(worldId);   // flow back to the cast list (quick-access closes outright)
        };
        $('#cf-save').on('click', (e) => { e.stopPropagation(); saveCastForm(false); });
        $('#cf-apply').on('click', (e) => { e.stopPropagation(); saveCastForm(true); });
    }

    // ========================================================================
    // GRAPHICAL MAP BUILDER (world-management §3, phase 3)
    // ========================================================================
    // Full-screen, touch-first node editor. Nodes = locations, anchored to a
    // custom background image by RELATIVE coords (x,y ∈ 0..1) so they stay
    // pinned at every zoom. Pointer Events throughout (mouse + touch unified);
    // taps distinguish from drags by a movement threshold — never
    // preventDefault a plain tap (kills the synthesized click on mobile).
    let mapEd = null;   // live editor state while open

    /** Editing a SHIPPED world materializes an editable authored copy under
     *  the SAME id — loadWorldData prefers authored, so saves keep working.
     *  Delete the copy to revert to the shipped version. */
    async function materializeShippedWorld(id) {
        const world = await loadWorldData(id);
        if (!world) return null;
        world.worldId = world.worldId || id;
        world.castData = world.castData || {};
        for (const castName of (world.cast || [])) {
            if (world.castData[castName]) continue;
            try {
                const r = await fetch(`scripts/extensions/third-party/rpg-custodian/game-worlds/fresh-worlds/${id}/characters/${encodeURIComponent(castName)}.json`);
                if (r.ok) world.castData[castName] = await r.json();
            } catch { /* cast member stays file-backed if unreadable */ }
        }
        authoredWorlds()[id] = world;
        context.saveSettingsDebounced();
        wmToast(`Editable copy of "${world.name}" created — it now overrides the shipped files. Delete it in the World Manager to revert.`, 'info');
        return world;
    }

    /**
     * Bind a world's lorebook as the GM's ADDITIONAL character book
     * (charLore) — the default RPG book stays on the GM's primary slot, and
     * the world's book swaps in/out exclusively with the world being played.
     */
    function applyWorldLorebook(worldData) {
        try {
            const book = worldData?.lorebook || null;
            world_info.charLore = world_info.charLore || [];
            const idx = world_info.charLore.findIndex(e => e.name === 'Game Master');
            if (book) {
                if (idx >= 0) world_info.charLore[idx].extraBooks = [book];
                else world_info.charLore.push({ name: 'Game Master', extraBooks: [book] });
                console.log('RPG Custodian: world lorebook bound to GM:', book);
            } else if (idx >= 0) {
                world_info.charLore.splice(idx, 1);
            }
            context.saveSettingsDebounced();
        } catch (e) { console.error('RPG Custodian: world lorebook binding failed', e); }
    }

    /** Map-editor picker: bind an existing book, upload one, or unbind. */
    function openLorebookPicker() {
        const world = mapEd.world;
        $('#rpg-cast-overlay').remove();
        const ov = $(`
            <div id="rpg-cast-overlay">
                <div class="rpg-form-panel">
                    <div class="rpg-popup-title">📖 World lorebook — GM lore for this world only</div>
                    <div class="pe-fx-title">Current: <b id="lb-current"></b></div>
                    <input id="lb-filter" type="text" placeholder="filter lorebooks…">
                    <div id="lb-list"></div>
                    <div class="mp-buttons">
                        <button type="button" id="lb-upload" class="rpg-map-btn">📁 Upload .json</button>
                        <button type="button" id="lb-none" class="rpg-map-btn">🚫 Unbind</button>
                        <button type="button" id="lb-cancel" class="rpg-map-btn">Close</button>
                    </div>
                </div>
            </div>`);
        $('body').append(ov);
        const setBook = (name) => {
            if (name) world.lorebook = name; else delete world.lorebook;
            context.saveSettingsDebounced();
            if (currentGameState.isActive && currentGameState.worldData?.worldId === mapEd.worldId) applyWorldLorebook(world);
            $('#lb-current').text(world.lorebook || 'none');
            renderBooks();
            wmToast(name ? `"${name}" bound to this world's GM.` : 'World lorebook unbound.', 'success');
        };
        const renderBooks = () => {
            const q = String($('#lb-filter').val() || '').toLowerCase();
            const list = $('#lb-list').empty();
            for (const n of (world_names || []).filter(n => n.toLowerCase().includes(q))) {
                const row = $('<div class="rpg-menu-item"></div>').text(`${n === world.lorebook ? '✅ ' : '📖 '}${n}`);
                row.on('click', (e) => { e.stopPropagation(); setBook(n); });
                list.append(row);
            }
            if (!list.children().length) list.append('<div class="pe-fx-title" style="opacity:.6">— no lorebooks —</div>');
        };
        $('#lb-current').text(world.lorebook || 'none');
        $('#lb-filter').on('input', renderBooks);
        renderBooks();
        $('#lb-cancel').on('click', (e) => { e.stopPropagation(); $('#rpg-cast-overlay').remove(); });
        $('#lb-none').on('click', (e) => { e.stopPropagation(); setBook(null); });
        $('#lb-upload').on('click', (e) => {
            e.stopPropagation();
            $('#lb-file').remove();
            const inp = $('<input id="lb-file" type="file" accept=".json,application/json" style="display:none">');
            $('body').append(inp);
            inp.on('change', async function () {
                const f = this.files?.[0];
                if (!f) { $('#lb-file').remove(); return; }
                try {
                    const data = JSON.parse(await f.text());
                    if (!data.entries || typeof data.entries !== 'object') { wmToast('Not a World Info file (no entries).', 'error'); return; }
                    let name = f.name.replace(/\.json$/i, '');
                    while ((world_names || []).includes(name)) {
                        const nn = (prompt(`A lorebook named "${name}" already exists. New name?`) || '').trim();
                        if (!nn) { wmToast('Upload cancelled.', 'info'); return; }
                        name = nn;
                    }
                    await saveWorldInfo(name, data, true);
                    await updateWorldInfoList();
                    setBook(name);
                } catch (err) { console.error('RPG Custodian: lorebook upload failed', err); wmToast('Lorebook upload failed.', 'error'); }
                finally { $('#lb-file').remove(); }
            });
            inp.trigger('click');
        });
    }

    async function openMapEditor(worldId) {
        let world = authoredWorlds()[worldId];
        if (!world) world = await materializeShippedWorld(worldId);
        if (!world) { wmToast(`World "${worldId}" could not be loaded.`, 'error'); return; }

        // First open of a coordless world: lay nodes out on a circle.
        const ids = Object.keys(world.locations || {});
        const coordless = ids.filter(id => world.locations[id].x == null);
        coordless.forEach((id, i) => {
            const a = (2 * Math.PI * ids.indexOf(id)) / Math.max(1, ids.length);
            world.locations[id].x = 0.5 + 0.33 * Math.cos(a);
            world.locations[id].y = 0.5 + 0.33 * Math.sin(a);
        });

        mapEd = { worldId, world, sel: [], connectFrom: null, view: { tx: 0, ty: 0, scale: 1 }, stageW: 1600, stageH: 1200, pointers: new Map(), drag: null };

        const ed = $(`
            <div id="rpg-map-editor">
                <div id="rpg-map-topbar">
                    <button class="rpg-map-btn" data-act="close" title="Save & close">✖</button>
                    <span id="rpg-map-title"></span>
                    <span id="rpg-map-ctx"></span>
                </div>
                <div id="rpg-map-viewport">
                    <div id="rpg-map-stage">
                        <img id="rpg-map-bgimg" draggable="false" style="display:none">
                        <svg id="rpg-map-lines"></svg>
                    </div>
                </div>
                <div id="rpg-map-zoombar">
                    <button class="rpg-map-btn" data-act="zoomout" title="Zoom out">−</button>
                    <button class="rpg-map-btn" data-act="zoomin" title="Zoom in">＋</button>
                    <input id="rpg-map-nodescale" type="range" min="0.4" max="2.5" step="0.05" title="Node size">
                </div>
                <input id="rpg-map-bgfile" type="file" accept="image/*" style="display:none">
            </div>`);
        $('body').append(ed);
        $('#rpg-map-title').text(world.name || worldId);
        $('#rpg-map-nodescale').val(world.nodeScale || 1);

        // Background image (if any) sets the stage's natural size.
        if (world.mapImage) {
            const img = document.getElementById('rpg-map-bgimg');
            img.onload = () => { mapEd.stageW = img.naturalWidth; mapEd.stageH = img.naturalHeight; mapRenderAll(); mapFitView(); };
            img.src = `backgrounds/${encodeURIComponent(world.mapImage)}`;
            img.style.display = '';
        }

        bindMapEditorEvents();
        mapRenderAll();
        mapFitView();
        mapRefreshTopbar();
    }

    function closeMapEditor() {
        if (!mapEd) return;
        mapEd.world.nodeScale = Number($('#rpg-map-nodescale').val()) || 1;
        context.saveSettingsDebounced();
        const editedActive = currentGameState.isActive && currentGameState.worldData?.worldId === mapEd.worldId;
        const worldId = mapEd.worldId;
        $('#rpg-map-editor').remove();
        $('#rpg-map-panel').remove();
        mapEd = null;
        loadRegisteredWorlds();
        if (editedActive) {
            // The live game keeps pace with the edit immediately.
            currentGameState.worldData = structuredClone(authoredWorlds()[worldId]);
            syncPresence(); renderActionBar(); projectPlayerStatus();
        }
        wmToast('World saved.', 'success');
    }

    // ---- rendering ----
    function mapApplyView() {
        const v = mapEd.view;
        $('#rpg-map-stage').css('transform', `translate(${v.tx}px, ${v.ty}px) scale(${v.scale})`);
    }
    function mapFitView() {
        const vp = document.getElementById('rpg-map-viewport');
        if (!vp) return;
        const s = Math.min(vp.clientWidth / mapEd.stageW, vp.clientHeight / mapEd.stageH) * 0.92;
        mapEd.view.scale = Math.max(0.05, s);
        mapEd.view.tx = (vp.clientWidth - mapEd.stageW * mapEd.view.scale) / 2;
        mapEd.view.ty = (vp.clientHeight - mapEd.stageH * mapEd.view.scale) / 2;
        mapApplyView();
    }
    function mapRenderAll() {
        const stage = $('#rpg-map-stage');
        stage.css({ width: `${mapEd.stageW}px`, height: `${mapEd.stageH}px` });
        stage.find('.rpg-map-node').remove();
        const scale = Number($('#rpg-map-nodescale').val()) || 1;
        for (const [id, loc] of Object.entries(mapEd.world.locations || {})) {
            const node = $(`<div class="rpg-map-node" data-id="${id}"></div>`);
            node.text(loc.name || id);
            if (id === mapEd.world.startingLocation) node.prepend('⭐ ');
            if ((Number(loc.secret) || 0) > 0) node.prepend((Number(loc.secret) >= 2 ? '🕳️ ' : '🤫 '));
            if (mapEd.sel.includes(id)) node.addClass('rpg-map-sel');
            node.css({ left: `${(loc.x ?? 0.5) * mapEd.stageW}px`, top: `${(loc.y ?? 0.5) * mapEd.stageH}px`, fontSize: `${14 * scale}px`, padding: `${6 * scale}px ${10 * scale}px` });
            stage.append(node);
        }
        mapRenderLines();
    }
    function mapRenderLines() {
        const svg = document.getElementById('rpg-map-lines');
        if (!svg) return;
        svg.setAttribute('viewBox', `0 0 ${mapEd.stageW} ${mapEd.stageH}`);
        svg.setAttribute('width', mapEd.stageW); svg.setAttribute('height', mapEd.stageH);
        const seen = new Set(); let html = '';
        for (const [id, loc] of Object.entries(mapEd.world.locations || {})) {
            for (const c of (loc.connections || [])) {
                const key = [id, c].sort().join('|');
                if (seen.has(key) || !mapEd.world.locations[c]) continue;
                seen.add(key);
                const o = mapEd.world.locations[c];
                const x1 = (loc.x ?? 0.5) * mapEd.stageW, y1 = (loc.y ?? 0.5) * mapEd.stageH;
                const x2 = (o.x ?? 0.5) * mapEd.stageW, y2 = (o.y ?? 0.5) * mapEd.stageH;
                html += `<line class="rpg-map-line" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"></line>` +
                    `<line class="rpg-map-linehit" data-a="${id}" data-b="${c}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"></line>`;
            }
        }
        svg.innerHTML = html;
    }
    function mapRefreshTopbar() {
        const n = mapEd.sel.length;
        const ctx = $('#rpg-map-ctx').empty();
        const btn = (act, label, title) => ctx.append($(`<button class="rpg-map-btn" data-act="${act}" title="${title}">${label}</button>`));
        btn('add', '➕', 'Add a place');
        btn('bg', '🖼️', 'Set map background image');
        btn('lore', '📖', "Bind this world's GM lorebook");
        if (mapEd.connectFrom) btn('connect', '🔗✔', 'Tap nodes to link/unlink, then tap here to finish');
        else if (n === 1) { btn('edit', '✏️', 'Edit this place'); btn('connect', '🔗', 'Connect: tap other nodes to link'); btn('del', '🗑️', 'Delete this place'); }
        else if (n >= 2) { btn('join', '🔗', 'Join all selected'); btn('unjoin', '✂️', 'Unjoin selected'); btn('del', '🗑️', 'Delete selected'); }
    }

    // ---- map editor interactions ----
    function bindMapEditorEvents() {
        const vp = document.getElementById('rpg-map-viewport');

        $('#rpg-map-editor').on('click', '.rpg-map-btn', async function (e) {
            e.stopPropagation();
            const act = $(this).data('act');
            if (act === 'close') closeMapEditor();
            else if (act === 'zoomin') mapZoom(1.3);
            else if (act === 'zoomout') mapZoom(1 / 1.3);
            else if (act === 'add') mapAddNode();
            else if (act === 'bg') $('#rpg-map-bgfile').trigger('click');
            else if (act === 'lore') openLorebookPicker();
            else if (act === 'edit') openMapNodePanel(mapEd.sel[0]);
            else if (act === 'del') mapDeleteSelected();
            else if (act === 'join') { mapJoin(true); }
            else if (act === 'unjoin') { mapJoin(false); }
            else if (act === 'connect') { mapEd.connectFrom = mapEd.connectFrom ? null : mapEd.sel[0]; mapRefreshTopbar(); }
        });

        $('#rpg-map-nodescale').on('input', () => { mapEd.world.nodeScale = Number($('#rpg-map-nodescale').val()) || 1; mapRenderAll(); });

        $('#rpg-map-bgfile').on('change', async function () {
            const file = this.files?.[0];
            if (!file) return;
            try {
                const fd = new FormData();
                fd.append('avatar', file);
                const r = await fetch('/api/backgrounds/upload', { method: 'POST', headers: context.getRequestHeaders({ omitContentType: true }), body: fd, cache: 'no-cache' });
                if (!r.ok) throw new Error(String(r.status));
                const bg = await r.text();
                mapEd.world.mapImage = bg;
                const img = document.getElementById('rpg-map-bgimg');
                img.onload = () => { mapEd.stageW = img.naturalWidth; mapEd.stageH = img.naturalHeight; mapRenderAll(); mapFitView(); };
                img.src = `backgrounds/${encodeURIComponent(bg)}`;
                img.style.display = '';
                context.saveSettingsDebounced();
            } catch (err) { console.error('RPG Custodian: map bg upload failed', err); wmToast('Background upload failed.', 'error'); }
        });

        // Unified pointer handling: node-drag, pan, pinch, line-tap — tap =
        // select. NOTE: setPointerCapture retargets the composed click away
        // from stage children, so line taps MUST ride this pipeline; a
        // delegated click handler on the SVG never fires.
        const TAP_PX = 7;
        vp.addEventListener('pointerdown', (e) => {
            vp.setPointerCapture(e.pointerId);
            const nodeEl = e.target.closest?.('.rpg-map-node');
            const lineEl = e.target.closest?.('.rpg-map-linehit');
            mapEd.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
            if (mapEd.pointers.size === 2) {
                // second finger → become a pinch, cancel any drag
                const [p1, p2] = [...mapEd.pointers.values()];
                mapEd.drag = { kind: 'pinch', dist: Math.hypot(p1.x - p2.x, p1.y - p2.y), scale0: mapEd.view.scale };
            } else if (nodeEl) {
                const id = nodeEl.dataset.id;
                const loc = mapEd.world.locations[id];
                mapEd.drag = { kind: 'node', id, sx: e.clientX, sy: e.clientY, x0: loc.x, y0: loc.y, moved: false };
            } else if (lineEl) {
                mapEd.drag = { kind: 'line', a: lineEl.dataset.a, b: lineEl.dataset.b, sx: e.clientX, sy: e.clientY, moved: false };
            } else {
                mapEd.drag = { kind: 'pan', sx: e.clientX, sy: e.clientY, tx0: mapEd.view.tx, ty0: mapEd.view.ty, moved: false };
            }
        });
        vp.addEventListener('pointermove', (e) => {
            if (!mapEd?.drag || !mapEd.pointers.has(e.pointerId)) return;
            mapEd.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
            const d = mapEd.drag;
            if (d.kind === 'pinch' && mapEd.pointers.size >= 2) {
                const [p1, p2] = [...mapEd.pointers.values()];
                const dist = Math.hypot(p1.x - p2.x, p1.y - p2.y);
                if (d.dist > 0) mapSetScale(d.scale0 * (dist / d.dist), (p1.x + p2.x) / 2, (p1.y + p2.y) / 2);
                return;
            }
            const dx = e.clientX - d.sx, dy = e.clientY - d.sy;
            if (!d.moved && Math.hypot(dx, dy) < TAP_PX) return;
            d.moved = true;
            if (d.kind === 'node') {
                const loc = mapEd.world.locations[d.id];
                loc.x = Math.min(1, Math.max(0, d.x0 + dx / (mapEd.stageW * mapEd.view.scale)));
                loc.y = Math.min(1, Math.max(0, d.y0 + dy / (mapEd.stageH * mapEd.view.scale)));
                const el = document.querySelector(`.rpg-map-node[data-id="${CSS.escape(d.id)}"]`);
                if (el) { el.style.left = `${loc.x * mapEd.stageW}px`; el.style.top = `${loc.y * mapEd.stageH}px`; }
                mapRenderLines();
            } else if (d.kind === 'pan') {
                mapEd.view.tx = d.tx0 + dx; mapEd.view.ty = d.ty0 + dy;
                mapApplyView();
            }
        });
        const endPointer = (e) => {
            const d = mapEd?.drag;
            mapEd?.pointers.delete(e.pointerId);
            if (!d) return;
            if (d.kind === 'pinch') { if (mapEd.pointers.size < 2) mapEd.drag = null; return; }
            mapEd.drag = null;
            if (d.moved) { context.saveSettingsDebounced(); return; }
            // A TAP: select/deselect or connect
            if (d.kind === 'node') {
                if (mapEd.connectFrom && d.id !== mapEd.connectFrom) {
                    const linked = (mapEd.world.locations[mapEd.connectFrom].connections || []).includes(d.id);
                    mapConnect(mapEd.connectFrom, d.id, !linked);
                    mapRenderLines();
                } else if (mapEd.sel.includes(d.id)) {
                    mapEd.sel = mapEd.sel.filter(x => x !== d.id);
                    mapRenderAll(); mapRefreshTopbar();
                } else {
                    mapEd.sel.push(d.id);
                    mapRenderAll(); mapRefreshTopbar();
                }
            } else if (d.kind === 'line') {
                const an = mapEd.world.locations[d.a]?.name || d.a, bn = mapEd.world.locations[d.b]?.name || d.b;
                if (confirm(`Remove the path between "${an}" and "${bn}"?`)) {
                    mapConnect(d.a, d.b, false);
                    mapRenderLines();
                }
            } else if (d.kind === 'pan') {
                mapEd.sel = []; mapEd.connectFrom = null;
                mapRenderAll(); mapRefreshTopbar();
            }
        };
        vp.addEventListener('pointerup', endPointer);
        vp.addEventListener('pointercancel', endPointer);
        vp.addEventListener('wheel', (e) => { e.preventDefault(); mapZoom(e.deltaY < 0 ? 1.15 : 1 / 1.15, e.clientX, e.clientY); }, { passive: false });
    }

    function mapZoom(factor, cx, cy) {
        const vp = document.getElementById('rpg-map-viewport');
        mapSetScale(mapEd.view.scale * factor, cx ?? vp.clientWidth / 2, cy ?? vp.clientHeight / 2);
    }
    function mapSetScale(scale, cx, cy) {
        scale = Math.min(8, Math.max(0.05, scale));
        const v = mapEd.view;
        // keep the point under (cx,cy) fixed while scaling
        v.tx = cx - ((cx - v.tx) / v.scale) * scale;
        v.ty = cy - ((cy - v.ty) / v.scale) * scale;
        v.scale = scale;
        mapApplyView();
    }

    // ---- node CRUD ----
    function mapAddNode() {
        const vp = document.getElementById('rpg-map-viewport');
        const n = Object.keys(mapEd.world.locations).length + 1;
        let id = `place-${n}`;
        while (mapEd.world.locations[id]) id += 'x';
        // land it at the current viewport center
        let cx = ((vp.clientWidth / 2) - mapEd.view.tx) / (mapEd.stageW * mapEd.view.scale);
        let cy = ((vp.clientHeight / 2) - mapEd.view.ty) / (mapEd.stageH * mapEd.view.scale);
        // Nudge until clear of existing nodes — stacked newborns are untappable.
        const tooClose = () => Object.values(mapEd.world.locations).some(l => Math.hypot((l.x ?? 0.5) - cx, (l.y ?? 0.5) - cy) < 0.05);
        for (let k = 0; k < 40 && tooClose(); k++) { cx += 0.055 * Math.cos(k * 2.4); cy += 0.055 * Math.sin(k * 2.4); }
        mapEd.world.locations[id] = { name: `New Place ${n}`, description: '', connections: [], background: '', x: Math.min(1, Math.max(0, cx)), y: Math.min(1, Math.max(0, cy)) };
        mapEd.sel = [id];
        mapRenderAll(); mapRefreshTopbar();
        openMapNodePanel(id);
    }
    function mapConnect(a, b, on) {
        const A = mapEd.world.locations[a], B = mapEd.world.locations[b];
        if (!A || !B || a === b) return;
        A.connections = A.connections || []; B.connections = B.connections || [];
        if (on) {
            if (!A.connections.includes(b)) A.connections.push(b);
            if (!B.connections.includes(a)) B.connections.push(a);
        } else {
            A.connections = A.connections.filter(x => x !== b);
            B.connections = B.connections.filter(x => x !== a);
        }
        context.saveSettingsDebounced();
    }
    function mapJoin(on) {
        for (let i = 0; i < mapEd.sel.length; i++) {
            for (let j = i + 1; j < mapEd.sel.length; j++) mapConnect(mapEd.sel[i], mapEd.sel[j], on);
        }
        mapRenderLines();
    }
    function mapDeleteSelected() {
        const doomed = mapEd.sel.filter(id => id !== mapEd.world.startingLocation);
        if (mapEd.sel.includes(mapEd.world.startingLocation)) wmToast('The starting location cannot be deleted — move the ⭐ first (Edit → starting location).', 'warning');
        if (!doomed.length) return;
        const names = doomed.map(id => mapEd.world.locations[id]?.name || id).join(', ');
        // Warn about cast who live/work at doomed places (homes survive as dangling ids until reassigned)
        const refs = Object.entries(mapEd.world.castData || {}).filter(([, card]) => {
            const rc = (card.data || card).extensions?.rpg_custodian || {};
            return doomed.includes(rc.home_location) || Object.values(rc.schedule || {}).some(l => doomed.includes(l));
        }).map(([n]) => n);
        if (!confirm(`Delete ${names}?${refs.length ? ` NOTE: ${refs.join(', ')} live or work there — reassign them later.` : ''}`)) return;
        for (const id of doomed) {
            delete mapEd.world.locations[id];
            for (const loc of Object.values(mapEd.world.locations)) loc.connections = (loc.connections || []).filter(c => c !== id);
        }
        mapEd.sel = []; mapEd.connectFrom = null;
        context.saveSettingsDebounced();
        mapRenderAll(); mapRefreshTopbar();
    }

    // ---- background picker: scrolling thumbnail grid over ST's backgrounds ----
    async function openBgPicker(current, onPick) {
        $('#rpg-bg-picker').remove();
        let images = [];
        try {
            const r = await fetch('/api/backgrounds/all', { method: 'POST', headers: context.getRequestHeaders(), body: '{}' });
            images = (await r.json()).images || [];
        } catch (e) { console.error('RPG Custodian: backgrounds list failed', e); wmToast('Could not load backgrounds.', 'error'); return; }
        const ov = $(`
            <div id="rpg-bg-picker">
                <div class="rpg-form-panel">
                    <div class="rpg-popup-title">🖼️ Scene background</div>
                    <input id="bgp-filter" type="text" placeholder="filter backgrounds…">
                    <div id="bgp-grid"></div>
                    <div class="mp-buttons">
                        <button type="button" id="bgp-none" class="rpg-map-btn">🚫 None</button>
                        <button type="button" id="bgp-cancel" class="rpg-map-btn">Cancel</button>
                    </div>
                </div>
            </div>`);
        $('body').append(ov);
        const render = () => {
            const q = String($('#bgp-filter').val() || '').toLowerCase();
            const grid = $('#bgp-grid').empty();
            for (const f of images.filter(f => f.toLowerCase().includes(q))) {
                const cell = $(`<div class="bgp-cell${f === current ? ' bgp-current' : ''}"></div>`);
                cell.append($(`<img loading="lazy" src="/thumbnail?type=bg&file=${encodeURIComponent(f)}">`));
                cell.append($('<div class="bgp-name"></div>').text(f.replace(/\.[^.]+$/, '')));
                cell.on('click', (e) => { e.stopPropagation(); $('#rpg-bg-picker').remove(); onPick(f); });
                grid.append(cell);
            }
            if (!grid.children().length) grid.append('<div class="pe-fx-title">No matches.</div>');
        };
        $('#bgp-filter').on('input', render);
        $('#bgp-none').on('click', (e) => { e.stopPropagation(); $('#rpg-bg-picker').remove(); onPick(''); });
        $('#bgp-cancel').on('click', (e) => { e.stopPropagation(); $('#rpg-bg-picker').remove(); });
        render();
    }

    // ---- the Edit Location panel ----
    function openMapNodePanel(id) {
        const loc = mapEd.world.locations[id];
        if (!loc) return;
        $('#rpg-map-panel').remove();
        const p = $(`
            <div id="rpg-map-panel">
                <div class="rpg-popup-title">✏️ Edit Location</div>
                <label>Name <input id="mp-name" type="text"></label>
                <label>Alternate names <input id="mp-alt" type="text" placeholder="comma, separated, aliases"></label>
                <label>Description <textarea id="mp-desc" rows="4"></textarea></label>
                <label>Tags <input id="mp-tags" type="text" placeholder="danger:low, shop:alchemist, …"></label>
                <label>Scene background
                    <button type="button" id="mp-bg-btn" class="rpg-toggle"><img id="mp-bg-thumb" style="display:none"> <span id="mp-bg-name">None</span></button>
                </label>
                <label>Secrecy <select id="mp-secret">
                    <option value="0">0 — public (all NPCs know it)</option>
                    <option value="1">1 — unknown (NPCs don't know; on your menus)</option>
                    <option value="2">2 — hidden (found only through the story)</option>
                </select></label>
                <button type="button" id="mp-start" class="rpg-toggle">⭐ Starting location: <b>No</b></button>
                <div class="mp-buttons">
                    <button id="mp-save" class="rpg-map-btn">💾 Save</button>
                    <button id="mp-cancel" class="rpg-map-btn">Cancel</button>
                </div>
            </div>`);
        // Parent to the editor overlay, NOT body: ST's mobile body can be
        // transformed, which breaks position:fixed coordinates (the panel
        // rendered 600px above the viewport). Absolute inside the full-screen
        // editor is viewport-aligned by construction.
        $('#rpg-map-editor').append(p);
        $('#mp-name').val(loc.name || '');
        $('#mp-alt').val((loc.alternate_names || []).join(', '));
        $('#mp-desc').val(loc.description || '');
        $('#mp-tags').val((loc.tags || []).join(', '));
        let pickedBg = loc.background || '';
        const showBg = () => {
            $('#mp-bg-name').text(pickedBg || 'None — tap to choose');
            const img = document.getElementById('mp-bg-thumb');
            if (pickedBg) { img.src = `/thumbnail?type=bg&file=${encodeURIComponent(pickedBg)}`; img.style.display = ''; }
            else img.style.display = 'none';
        };
        showBg();
        $('#mp-bg-btn').on('click', (e) => { e.stopPropagation(); openBgPicker(pickedBg, (f) => { pickedBg = f; showBg(); }); });
        $('#mp-secret').val(String(Number(loc.secret) || 0));
        setToggle($('#mp-start'), mapEd.world.startingLocation === id);
        $('#mp-cancel').on('click', () => $('#rpg-map-panel').remove());
        $('#mp-save').on('click', () => {
            loc.name = ($('#mp-name').val() || '').trim() || loc.name;
            loc.alternate_names = String($('#mp-alt').val() || '').split(',').map(s => s.trim()).filter(Boolean);
            loc.description = String($('#mp-desc').val() || '').trim();
            loc.tags = String($('#mp-tags').val() || '').split(',').map(s => s.trim()).filter(Boolean);
            loc.background = pickedBg;
            const sec = Number($('#mp-secret').val()) || 0;
            if (sec) loc.secret = sec; else delete loc.secret;
            if (getToggle($('#mp-start'))) mapEd.world.startingLocation = id;
            context.saveSettingsDebounced();
            $('#rpg-map-panel').remove();
            mapRenderAll(); mapRefreshTopbar();
        });
    }

    function toggleRpgMenu() {
        const existing = $('#rpg-menu-popup');
        if (existing.length) {
            existing.remove();
            return;
        }

        const save = getCurrentSave();
        const items = [];

        if (save) {
            items.push({ icon: '▶️', label: `Continue (${save.world}, Day ${save.day ?? 1} — ${saveWeekdayName(save)})`, action: continueGame });
        }
        // New games start from the Worlds manager (world → 🎲 New Game).
        items.push({ icon: '🌍', label: 'Worlds (play, create, manage)', action: () => openWorldManager() });
        items.push({ icon: '✨', label: 'Create Character', action: () => createRPGCharacterCommand() });
        items.push({ icon: '👤', label: 'Character Sheet', action: () => showRPGCharacterInfoCommand({}, '') });
        items.push({ icon: '🧬', label: 'Edit Character', action: () => openPlayerEditor() });
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
        for (const castName of (worldData.cast || [])) {
            const char = castCharFor(castName);
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
     * Present NPCs are un-muted; EVERYONE else is muted — the Game Master
     * included.
     *
     * The GM used to stay enabled on the theory that talkativeness 0 kept it
     * quiet. It does not. Sending an empty message is not user input, and ST's
     * MANUAL strategy answers that with
     *     shuffle(enabledMembers).slice(0, 1)
     * — one enabled member picked AT RANDOM, talkativeness ignored entirely
     * (group-chats.js). With the GM enabled it could be the one drafted, and
     * it would free-narrate a scene the engine never resolved, which is the
     * one thing the GM must never do. Muting costs nothing: GM messages are
     * pushed straight into the chat by sendGameMasterMessage, never generated
     * through the group, and a deliberate trigger passes force_chid, which ST
     * honors ahead of the enabled list.
     */
    async function syncPresence() {
        if (!currentGameState.isActive || !currentGameState.groupId) return;
        const group = (getCtx().groups || []).find(g => g.id === currentGameState.groupId);
        if (!group) {
            console.warn('RPG Custodian: syncPresence could not find group', currentGameState.groupId);
            return;
        }

        const presentAvatars = getNpcsAt(currentGameState.currentLocation).map(npc => castCharFor(npc.name)?.avatar || `${npc.name}.png`);
        const disabled = [];
        for (const avatar of group.members) {
            if (!presentAvatars.includes(avatar)) disabled.push(avatar);   // GM included — see above
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
        } else {
            // Reconcile membership with the resolved cast avatars — e.g. when
            // adopted originals migrate to their RPGC_ world copies, a stale
            // member list would leave the real cast un-triggerable.
            const expected = ['Game Master.png', ...(worldData.cast || []).map(n => castCharFor(n)?.avatar).filter(Boolean)];
            if (JSON.stringify([...expected].sort()) !== JSON.stringify([...group.members].sort())) {
                console.log('RPG Custodian: reconciling group members →', expected.join(', '));
                group.members = expected;
                try { await editGroup(groupId, true, false); } catch (e) { console.error('RPG Custodian: group member reconcile failed', e); }
            }
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
    async function continueGame(worldId = null) {
        const save = worldId ? getSaveFor(worldId) : getCurrentSave();
        if (!save) {
            wmToast('No save found for that world — start a New Game.', 'warning');
            return;
        }
        // Continuing a world makes it the most-recently-played one.
        context.extensionSettings[extensionName].currentSave = save;

        const currentBackground = background_settings.name;
        if (currentBackground && currentBackground !== '__transparent.png' && !currentGameState.isActive) {
            setSavedBackground(currentBackground);
        }

        const worldData = await loadWorldData(save.world);
        if (!worldData) {
            sendGhostMessage(`❌ Saved world "${save.world}" could not be loaded.`);
            return;
        }

        currentGameState.worldData = worldData;
        currentGameState.currentTime = save.time ?? 0;
        currentGameState.dayCount = save.day ?? 1;
        currentGameState.startWeekday = Number.isInteger(save.startWeekday) ? save.startWeekday : backfillStartWeekday(save.day);
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
        applyWorldLorebook(worldData);   // this world's GM lore (exclusive), on top of the default book

        await syncPresence();
        projectPlayerStatus();
        updateTimeDisplay();

        // Presence cooperation: history from before witness-stamping becomes
        // universal, so enabling the Presence extension doesn't blind the
        // cast to everything that already happened.
        {
            let stamped = 0;
            const toOriginal = (av) => {
                if (!String(av).startsWith('RPGC_')) return av;
                const nm = String(av).replace(/^RPGC_/, '').replace(/\.png$/, '');
                const orig = getCtx().characters.find(c => c.name === nm && !String(c.avatar).startsWith('RPGC_'));
                return orig ? orig.avatar : av;
            };
            for (const m of (getCtx().chat || [])) {
                if (!m.present) { m.present = ['presence_universal_tracker']; stamped++; }
                else if (Array.isArray(m.present) && m.present.some(av => String(av).startsWith('RPGC_'))) {
                    const mapped = m.present.map(toOriginal);
                    if (JSON.stringify(mapped) !== JSON.stringify(m.present)) { m.present = mapped; stamped++; }
                }
            }
            if (stamped) { try { await getCtx().saveChat(); } catch (e) { console.warn('RPG Custodian: presence backfill save failed', e); } }
        }

        const location = worldData.locations[currentGameState.currentLocation];
        await setBackground(location.background);

        const time = TIME_PERIODS[currentGameState.currentTime];
        sendGameMasterMessage(`💾 **Game Loaded: ${worldData.name}**\n\n🗓️ Day ${currentGameState.dayCount} (${weekdayName()}), ${time.emoji} ${time.name}\n\n📍 **${location.name}**${presenceLine(currentGameState.currentLocation)}`);
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
            startWeekday: currentGameState.startWeekday ?? null,
            timeStep: currentGameState.timeStep || 0,
            groupId: currentGameState.groupId || null,
            party: currentGameState.party || [],
            offspring: currentGameState.offspring || [],
            timestamp: new Date().toISOString(),
        };
        // Per-world save slots: each world keeps its own save; currentSave
        // remains the most-recently-played pointer for the quick Continue.
        const s = context.extensionSettings[extensionName];
        s.saves = s.saves || {};
        s.saves[currentGameState.worldData.worldId] = s.currentSave;
        context.saveSettingsDebounced();
    }

    /** The save slot for a specific world (falls back to legacy currentSave). */
    function getSaveFor(worldId) {
        const s = context.extensionSettings[extensionName] || {};
        if (s.saves?.[worldId]) return s.saves[worldId];
        const cur = getCurrentSave();
        return cur && cur.world === worldId ? cur : null;
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
        
        return currentLocationData.connections.filter(c => (Number(currentGameState.worldData.locations[c]?.secret) || 0) < 2).map(connectionKey => {
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
            currentGameState.startWeekday = null;
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
            sendGameMasterMessage(`🚶 **You traveled to: ${targetLocationData.name}**${presenceLine(targetLocation)}`);

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
                const visExits = visibleConnections(currentGameState.currentLocation);
                if (visExits.length > 0) {
                    const exitNames = visExits.map(connectionKey => {
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
                timeMessage += `\n\n🗓️ **A new day has begun!** (Day ${timeResult.dayCount} — ${weekdayName(timeResult.dayCount)})`;
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
            const dateMessage = `📅 **Current Date & Time**\n\n🗓️ **Day ${currentGameState.dayCount} — ${weekdayName()}**\n${currentTime.emoji} **${currentTime.name}**`;
            
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
            button.attr('title', `${currentTime.name} - Day ${currentGameState.dayCount} (${weekdayName()})`);
        } else {
            button.text('RPG');
            button.attr('title', 'rpg-menu');
        }
    }

    /**
     * Send a ghost message (hidden from AI context)
     */
    // === Presence-extension cooperation ===
    // The SillyTavern-Presence extension hides messages from group members who
    // weren't stamped as witnesses (mes.present, by avatar; it already honors
    // our disabled_members muting). Engine-pushed messages bypass the events
    // it stamps on, so we stamp them ourselves: witnessed by the scene's
    // present cast plus the GM (who sees everything).
    function stampPresence(message) {
        const present = getNpcsAt(currentGameState.currentLocation || '').map(n => castCharFor(n.name)?.avatar || `${n.name}.png`);
        message.present = [...present, 'Game Master.png'];
    }

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
        stampPresence(message);
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
        stampPresence(message);
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
            // Load world data (authored settings-world or shipped file-world)
            const worldData = await loadWorldData(worldName);
            if (!worldData) {
                sendGhostMessage(`❌ Error: World "${worldName}" not found. Check that the world exists.`);
                return;
            }
            const startingLocation = worldData.locations[worldData.startingLocation];

            if (!startingLocation) {
                sendGhostMessage(`❌ Error: Starting location "${worldData.startingLocation}" not found in world "${worldName}".`);
                return;
            }

            // Initialize game state (fresh game starts at Morning, Day 1,
            // anchored to the real-life current day of the week)
            currentGameState.worldData = worldData;
            currentGameState.currentTime = 0;
            currentGameState.dayCount = 1;
            currentGameState.startWeekday = new Date().getDay();
            currentGameState.party = [];
            currentGameState.offspring = [];
            currentGameState.timeStep = 0;

            // A NEW game ALWAYS starts at the world's starting location.
            // (Legacy code resumed the persona's last spot in this world —
            // replaying a world spawned you wherever you last stood, e.g. a
            // secret prison with no visible exits, while the banner printed
            // the starting room. Resuming is Continue's job, never New Game's.)
            currentGameState.currentLocation = worldData.startingLocation;
            const rpgData = getCurrentRPGData();
            if (rpgData) {
                updateCurrentRPGData({
                    world_state: {
                        current_location: worldData.startingLocation,
                        visited_locations: [worldData.startingLocation],
                    },
                });
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
            applyWorldLorebook(worldData);   // this world's GM lore (exclusive), on top of the default book

            // Every new game plays in its own chat file — the previous
            // playthrough's log stays intact in the group's past chats. (The
            // old clearChat() here only wiped the DOM; the stale log came back
            // on reload.) A just-created group already starts on a fresh chat.
            if (groupPreexisted) {
                await createNewGroupChat(groupId);
            }
            // Cards keep their greetings; the fresh GAME chat does not — clear
            // the auto-seeded intros before the engine posts its banner.
            {
                const c = getCtx().chat || [];
                if (c.length) { c.splice(0, c.length); $('#chat').children('.mes').remove(); }
            }
            await syncPresence();
            projectPlayerStatus();

            // Update time display
            updateTimeDisplay();

            // Set background to starting location
            await setBackground(startingLocation.background);

            // Send game start message and persist it into the new chat file
            // (nothing else saves the chat until the first generation)
            sendGameMasterMessage(`🎲 **New Game Started: ${worldData.name}**\n\n${worldData.description}\n\n🗓️ Day 1 (${weekdayName()}), ${TIME_PERIODS[0].emoji} ${TIME_PERIODS[0].name}\n\n📍 **${startingLocation.name}**${presenceLine(currentGameState.currentLocation)}`);
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
        if (!backgroundFileName) return;   // authored worlds may not have one yet
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

            const GM_CARD_VERSION = '2.2';   // bump when templates/Game Master.json changes
            const liveVersion = gameMaster?.data?.extensions?.rpg_custodian?.card_version;
            if (gameMaster && !cardHasGreeting(gameMaster) && Number(gameMaster.talkativeness) === 0 && liveVersion === GM_CARD_VERSION) {
                console.log('RPG Custodian: Game Master character already exists');
                ensureRpgTag('Game Master.png');
                return;
            }

            console.log(gameMaster
                ? `RPG Custodian: Game Master card out of date (${liveVersion || 'unversioned'} → ${GM_CARD_VERSION}), recreating...`
                : 'RPG Custodian: Game Master not found, creating from template...');
            await createGameMasterFromTemplate();
            ensureRpgTag('Game Master.png');

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
    /** Best-available portrait for a (re)created card, or null. Priority:
     *  the adopted original recorded at adoption → an on-disk original with
     *  the same name → the existing world copy's current face (refreshes must
     *  not wipe a portrait back to the silhouette). */
    async function resolvePortraitBlob(charData, fileName) {
        try {
            const chars = getCtx().characters || [];
            const rc = charData.extensions?.rpg_custodian || {};
            const candidates = [
                rc.source_avatar,
                chars.find(c => c.name === charData.name && !String(c.avatar).startsWith('RPGC_') && c.avatar !== `${fileName}.png`)?.avatar,
                `${fileName}.png`,
            ].filter(av => av && chars.some(c => c.avatar === av));
            for (const av of candidates) {
                for (const url of [`/characters/${encodeURIComponent(av)}`, `/thumbnail?type=avatar&file=${encodeURIComponent(av)}`]) {
                    try {
                        const r = await fetch(url);
                        if (r.ok) { const b = await r.blob(); if (b.size > 0 && /image/.test(b.type || 'image/png')) return b; }
                    } catch { /* next url */ }
                }
            }
        } catch (e) { console.warn('RPG Custodian: portrait lookup failed', e); }
        return null;
    }

    // === ST tag system: every engine-managed card wears the RPG-C tag ===
    const RPG_TAG_NAME = 'RPG-C';
    function ensureRpgTag(avatar) {
        try {
            if (!avatar) return;
            const ctx = getCtx();
            let tag = (ctx.tags || []).find(t => String(t.name).toLowerCase() === RPG_TAG_NAME.toLowerCase());
            if (!tag) {
                tag = {
                    id: crypto.randomUUID(), name: RPG_TAG_NAME,
                    folder_type: 'NONE', filter_state: 'UNDEFINED',
                    sort_order: Math.max(0, ...(ctx.tags || []).map(t => t.sort_order || 0)) + 1,
                    is_hidden_on_character_card: false, color: '', color2: '', create_date: Date.now(),
                };
                ctx.tags.push(tag);
            }
            ctx.tagMap[avatar] = ctx.tagMap[avatar] || [];
            if (!ctx.tagMap[avatar].includes(tag.id)) {
                ctx.tagMap[avatar].push(tag.id);
                context.saveSettingsDebounced();
            }
        } catch (e) { console.warn('RPG Custodian: RPG-C tagging failed for', avatar, e); }
    }
    /** Untag when she leaves her LAST cast — other worlds may still claim her. */
    function removeRpgTagIfUnused(name) {
        try {
            const stillCast = Object.values(authoredWorlds() || {}).some(w => (w.cast || []).includes(name));
            if (stillCast) return;
            const ctx = getCtx();
            const tag = (ctx.tags || []).find(t => String(t.name).toLowerCase() === RPG_TAG_NAME.toLowerCase());
            const char = castCharFor(name);
            if (!tag || !char || !ctx.tagMap[char.avatar]) return;
            ctx.tagMap[char.avatar] = ctx.tagMap[char.avatar].filter(id => id !== tag.id);
            context.saveSettingsDebounced();
        } catch (e) { console.warn('RPG Custodian: RPG-C untagging failed for', name, e); }
    }

    /** Write one field of an existing card IN PLACE via ST's edit-attribute —
     *  image and every other field untouched. Never use the create API on a
     *  card that already exists (that is what wiped portraits and greetings). */
    async function writeCardField(char, field, value) {
        const r = await fetch('/api/characters/edit-attribute', {
            method: 'POST', headers: context.getRequestHeaders(),
            body: JSON.stringify({ avatar_url: char.avatar, ch_name: char.name, field, value }),
        });
        if (!r.ok) throw new Error(`edit-attribute ${field}: ${r.status}`);
    }
    /** Fold the world's rpg_custodian block (+ talkativeness 0, + depth_prompt)
     *  into an existing card's extensions — the single-card architecture's only
     *  write path for adopted originals. Spec-legal: vanilla ST ignores the block. */
    async function mergeRpgIntoCard(char, cardData) {
        const ext = structuredClone(char.data?.extensions || {});
        ext.rpg_custodian = structuredClone(cardData.extensions?.rpg_custodian || {});
        ext.talkativeness = 0;   // house rule: every card speaks only when triggered
        if (cardData.extensions?.depth_prompt !== undefined) ext.depth_prompt = structuredClone(cardData.extensions.depth_prompt);
        await writeCardField(char, 'extensions', ext);
        try { await writeCardField(char, 'talkativeness', '0'); } catch { /* some cards lack the root field */ }
        await context.getCharacters();
    }

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
            // Cards keep their authored greeting — fresh RPG chats clear the
            // auto-seeded intros at the CHAT level instead (startRpgSession).
            formData.append('first_mes', charData.first_mes || '');
            formData.append('mes_example', charData.mes_example || '');
            formData.append('creator_notes', charData.creator_notes || '');
            formData.append('system_prompt', charData.system_prompt || '');
            formData.append('post_history_instructions', charData.post_history_instructions || '');
            formData.append('creator', charData.creator || '');
            formData.append('character_version', charData.character_version || '');
            // RPG cards never auto-speak: talkativeness 0 on BOTH spec
            // surfaces (V1 root via this field, V2 via the extensions blob).
            // Omitting the field let ST default V1 to 0.5 while our extensions
            // said 0 → "Spec v2 data mismatch" warnings on every load.
            formData.append('talkativeness', '0');

            // Handle tags
            if (charData.tags && charData.tags.length > 0) {
                formData.append('tags', charData.tags.join(','));
            }
            
            // Add extensions data (normalized: talkativeness 0 always).
            // portrait_v marks that this card was created portrait-aware, so
            // pre-fix silhouette copies self-heal exactly once on next start.
            const ext = structuredClone(charData.extensions || {});
            ext.talkativeness = 0;
            ext.rpg_custodian = { ...(ext.rpg_custodian || {}), portrait_v: 1 };
            formData.append('extensions', JSON.stringify(ext));

            // Attach her actual face — without an avatar file, the create API
            // paints the default silhouette.
            const portrait = await resolvePortraitBlob(charData, fileName);
            if (portrait) formData.append('avatar', portrait, `${fileName}.png`);

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
     * Resolve the CHARACTER that embodies a cast member — single-card
     * architecture: the ORIGINAL card by name is the one that plays; all
     * engine data lives namespaced in data.extensions.rpg_custodian and the
     * only write path is mergeRpgIntoCard (in-place edit-attribute — never
     * the create API, which is what once nuked seven original cards).
     * Legacy RPGC_ copies resolve only when no original exists (they ARE the
     * single card on accounts that never had an original).
     */
    function castCharFor(name) {
        const chars = getCtx().characters;
        return chars.find(c => c.avatar === `${name}.png`)                                       // canonical file — the single card
            || chars.find(c => c.name === name && !String(c.avatar).startsWith('RPGC_'))          // original under a variant filename
            || chars.find(c => c.avatar === `RPGC_${name}.png`)                                    // legacy copy with no original
            || null;
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
                // Authored worlds embed cast card data; shipped worlds file it.
                let cardData = worldData.castData?.[castName];
                if (!cardData) {
                    const cardPath = `scripts/extensions/third-party/rpg-custodian/game-worlds/fresh-worlds/${worldData.worldId}/characters/${encodeURIComponent(castName)}.json`;
                    const response = await fetch(cardPath);
                    if (!response.ok) {
                        console.warn(`RPG Custodian: Cast card "${castName}" not found at ${cardPath}`);
                        continue;
                    }
                    cardData = await response.json();
                }
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
                    wombType: rpgMeta.womb_type || null,     // authored offspring kind (beats race inference)
                    baseStats: rpgMeta.base_stats || null,   // world-authored initial affection/arousal/pregnancy
                });

                // Create if missing, or refresh in place if the on-disk card is
                // an older version than the world ships (self-healing so New Game
                // always gives the current cast without manual deletion). A live
                // card that still carries a greeting also refreshes (greetings
                // are stripped at creation and would spam fresh group chats).
                // ONLY world-owned cards are ever created/refreshed — adopted
                // originals stay untouched; their world copy lives at RPGC_<name>.
                // Prefer the exact card that was ADOPTED (source_avatar) — with
                // duplicate names on an account, resolution stays deterministic.
                const existing = (rpgMeta.source_avatar && getCtx().characters.find(c => c.avatar === rpgMeta.source_avatar))
                    || castCharFor(castName);
                const liveVersion = existing?.data?.extensions?.rpg_custodian?.card_version;
                const srcVersion = rpgMeta.card_version;
                if (!existing) {
                    // No card anywhere (shipped world / bundle import on a fresh
                    // account): create it ONCE under its plain name.
                    console.log(`RPG Custodian: Creating cast member "${castName}"...`);
                    await createCharacterFromCardData(cardData, castName);
                } else if (liveVersion !== srcVersion
                    || Number(existing.talkativeness) !== 0
                    || Number(existing.data?.extensions?.talkativeness ?? 0) !== 0) {
                    // Single-card architecture: fold the world's rpg block into
                    // the ORIGINAL in place — art, greeting, prose untouched.
                    console.log(`RPG Custodian: Folding world data into "${castName}" (${liveVersion || 'none'} → ${srcVersion})`);
                    await mergeRpgIntoCard(existing, cardData);
                }
                ensureRpgTag((existing || castCharFor(castName))?.avatar);
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
            // Likewise an NPC under an immobilizing status (bound, paralyzed,
            // ensnared…) is pinned where it took hold until the status ends.
            const pin = (rel?.customEffects || []).find(e => e.active !== false && e.immobilizes && e.pinnedAt);
            if (pin) return locationId === pin.pinnedAt;
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
        parts.push(`💗 Disposition: **${affectionTier(getNpcAffection(npcName)).label}** (affection ${getNpcAffection(npcName)}/10)`);
        parts.push(`🔥 Arousal: **${arousalTier(getNpcArousal(npcName)).label}** (${getNpcArousal(npcName)}/10)`);
        parts.push(`❤️ Stamina: ${rel.npcStamina ?? npcMaxStamina(npcName)}/${npcMaxStamina(npcName)}${rel.npcUnconscious ? ' — UNCONSCIOUS' : ''}`);
        {
            // Mechanical readout only — the cycle must never flavor the LLM
            // appearance blurb below (it reads body state, not the calendar).
            const ph = cyclePhase(npcName);
            const mod = (Number(npc?.fertility) || 0) + npcStatMod(npcName, 'fertility');
            parts.push(`🌱 Fertility: ${fertilityPercent(npcName)}% — ${ph.emoji} ${ph.label} (cycle ${ph.pct}%${mod ? `, mod ${mod > 0 ? '+' : ''}${mod}%` : ''})`);
        }
        if (npc?.wrestle) parts.push(`🤼 Contest DC: ${npc.wrestle.difficulty}`);
        if ((rel.pregnancies || 0) > 0) { const pb = pregnancyBand(npcName, 'third'); parts.push(`🤰 Pregnancy: ${pb.countWord} — ${pb.stage} (${rel.pregnancy_progress || 0}%)`); }
        for (const e of npcActiveEffects(npcName)) parts.push(effectDetailLine(e));
        if (isCrystalCursed(npcName)) parts.push(`💠 **Crystal Curse** — her issue turns to soulgems (${(getRelationship(npcName).crystalCurse?.expiresStep == null) ? 'permanent until broken' : `${Math.max(0, getRelationship(npcName).crystalCurse.expiresStep - (currentGameState.timeStep || 0))} periods left`})`);
        if (isInParty(npcName)) parts.push('🧑‍🤝‍🧑 Travelling with you');
        const idLine = [npc?.role, npc?.race, npc?.age].filter(Boolean).join(', ');
        sendGhostMessage(`🔍 **${npcName}**${idLine ? ` — ${idLine}` : ''}\n${parts.join('\n')}`);

        // 2) Status-flavored appearance (LLM), grounded in her card + the live
        // scene. Think-first via generateProse: reasoning models keep their
        // thinking (headroom + strip), prefill only as rescue.
        const flavor = [];
        if (rel.npcUnconscious) flavor.push('unconscious, limp and unresponsive');
        else if (getNpcArousal(npcName) >= 3) flavor.push(arousalTier(getNpcArousal(npcName)).band);
        const stamNow = rel.npcStamina ?? npcMaxStamina(npcName);
        if (!rel.npcUnconscious && stamNow < npcMaxStamina(npcName)) {
            flavor.push(stamNow <= npcMaxStamina(npcName) / 3 ? 'utterly spent, barely upright' : 'worn and tired');
        }
        if ((rel.pregnancies || 0) > 0) { const pb = pregnancyBand(npcName, 'third'); if (pb) flavor.push(`pregnant with ${pb.countWord} of the player's, ${pb.stage} — ${pb.band}`); }
        for (const e of npcActiveEffects(npcName)) flavor.push(e.selfNote ? `under the effect of ${e.name}: ${e.selfNote}` : `under the effect of ${e.name}${e.desc ? ` (${e.desc})` : ''}`);
        const t = affectionTier(getNpcAffection(npcName));
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
        if (currentGameState.dayCount > startDay) msg += ` (Day ${currentGameState.dayCount}, ${weekdayName()})`;
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

    // === NPC status self-knowledge & lifecycle reactions ===
    // An afflicted/blessed NPC KNOWS her own condition: a natural description
    // (how it feels to her, how long it holds, what ends it) is generated ONCE
    // at application and projected while active. And when a status begins,
    // wears off, or is broken IN PLAY (never by admin-menu edits), she gets a
    // one-shot reaction note — the reunion-comment pattern — so her next reply
    // acknowledges it.

    async function generateStatusSelfNote(target, rec) {
        try {
            if (!(await waitForGenerationIdle(20000))) return;
            const ends = statusEndsLabel(rec);
            const sys = `You are the RPG narrator. In 1-2 third-person sentences, describe how the effect "${rec.name}" feels and shows for ${target} from her OWN awareness: what she notices in her body or mind, roughly how long it will hold, and what she senses would end it. Ground it strictly in the given facts; invent sensation, not mechanics. Output only the description.`;
            const prompt = `Effect on ${target}: "${rec.name}" (${rec.kind}${statusModString(rec.mods)})${rec.desc ? ` — ${rec.desc}` : ''}. Ends: ${ends || 'permanent until broken'}.`;
            const text = await generateProse({ prompt, systemPrompt: sys, budget: 130, rescuePrefill: 'She ' });
            if (text) { rec.selfNote = text.trim(); savePlayer(); projectPlayerStatus(); }
        } catch (e) { console.warn('RPG Custodian: status self-note generation failed', e); }
    }

    /** Queue a one-shot status reaction for her next reply (in-play events only).
     *  Each fragment is stamped with the timeStep it happened at, so a note
     *  consumed days later (she was off-screen) can be reworded — "just worn
     *  off" must not survive a three-day gap. */
    function queueStatusReaction(target, text) {
        if (!target || target === 'player') return;
        const rel = getRelationship(target);
        if (!Array.isArray(rel.statusReactionNotes)) {
            rel.statusReactionNotes = rel.statusReactionNote            // migrate any pre-array note
                ? [{ text: rel.statusReactionNote, step: currentGameState.timeStep || 0 }] : [];
            rel.statusReactionNote = null;
        }
        rel.statusReactionNotes.push({ text, step: currentGameState.timeStep || 0 });
        savePlayer();
    }
    /** Render queued fragments for injection, aging stale ones honestly. */
    function renderStatusReactionNotes(rel) {
        const raw = Array.isArray(rel.statusReactionNotes) ? rel.statusReactionNotes
            : rel.statusReactionNote ? [{ text: rel.statusReactionNote, step: currentGameState.timeStep || 0 }] : [];
        if (!raw.length) return null;
        const now = currentGameState.timeStep || 0;
        return raw.map(n => {
            const elapsed = now - (n.step ?? now);
            if (elapsed < 1) return n.text;                              // fresh — "just" is true
            return `(This happened about ${elapsedPhrase(elapsed)} ago — old news to you by now, though he may not know:) ${n.text.replace(/\bJUST\b/g, 'since').replace(/\bjust\b/g, 'since')}`;
        }).join(' ');
    }
    const STATUSREACT_PROMPT_KEY = 'RPG_CUSTODIAN_STATUS_REACT';

    // === Whereabouts knowledge (Custodian-gated) ===
    // Locals know each other's routines, so an NPC asked "where's Fern?" can
    // answer honestly — but only when the Custodian judges the conversation
    // calls for it (a one-shot note, never standing context bloat). Secret
    // NPCs are omitted entirely; an NPC currently at a SECRET place gets a
    // "nobody's quite sure where she gets to" instead of a leak.
    const WHEREABOUTS_PROMPT_KEY = 'RPG_CUSTODIAN_WHEREABOUTS';
    let pendingWhereaboutsNote = null;

    function buildWhereaboutsNote() {
        const player = context.powerUserSettings.personas?.[playerAvatar()] || 'the adventurer';
        const lines = [];
        for (const npc of (currentGameState.npcRoster || [])) {
            if (npc.secret) continue;
            const rel = getRelationship(npc.name);
            let where;
            const pin = (rel.customEffects || []).find(e => e.active !== false && e.immobilizes && e.pinnedAt);
            if (rel.npcUnconscious && rel.stashedAt) where = `laid up at ${locName(rel.stashedAt)}`;
            else if (pin && locSecret(pin.pinnedAt) === 0) where = `at ${locName(pin.pinnedAt)} — held there by her condition (${pin.name})`;
            else if (pin) where = 'nobody is quite sure where she gets to at this hour';
            else if (isInParty(npc.name)) where = `off with ${player} — they were seen leaving together`;
            else {
                const locId = scheduledLocationFor(npc.name);
                where = (locId && locSecret(locId) === 0)
                    ? `at ${locName(locId)}, as her routine has it this time of day`
                    : 'nobody is quite sure where she gets to at this hour';
            }
            lines.push(`${npc.name}, the ${npc.role || 'resident'} — ${where}`);
        }
        if (!lines.length) return null;
        return `[Where folk are at this hour — daily routines are common local knowledge, and she may share this freely if asked:]\n${lines.join('\n')}`;
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
            const t = affectionTier(getNpcAffection(npcName));    // effective: status deltas/caps included
            const a = arousalTier(getNpcArousal(npcName));

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
Her disposition band she was told to play (${t.label}, affection ${getNpcAffection(npcName)}/10): she ${t.band}
Her physical band (${a.label}, arousal ${getNpcArousal(npcName)}/10): ${a.band}
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
            const beforeTier = affectionTier(getNpcAffection(npcName)).label;
            if (dAff) rel.affection = Math.max(0, Math.min(10, (rel.affection || 0) + dAff));
            if (dAro) setNpcArousalRaw(npcName, (rel.arousal ?? 0) + dAro);
            savePlayer();

            // Every increment is shown to the player (Dyna's call) — with a
            // flourish line added when a tier boundary is crossed. Displays are
            // EFFECTIVE values (status deltas/caps folded in) — what she plays.
            const bits = [];
            if (dAff) bits.push(`💗 affection ${dAff > 0 ? '+' : ''}${dAff} → ${getNpcAffection(npcName)}/10 (${affectionTier(getNpcAffection(npcName)).label})`);
            if (dAro) bits.push(`🔥 arousal ${dAro > 0 ? '+' : ''}${dAro} → ${getNpcArousal(npcName)}/10 (${arousalTier(getNpcArousal(npcName)).label})`);
            const afterTier = affectionTier(getNpcAffection(npcName)).label;
            const shift = afterTier !== beforeTier
                ? `\n${dAff > 0 ? `💗 Something shifts in ${npcName} — **${beforeTier} → ${afterTier}**.` : `💔 ${npcName} pulls back — **${beforeTier} → ${afterTier}**.`}`
                : '';
            if (bits.length) sendGhostMessage(`${npcName}: ${bits.join(' · ')}${shift}`);
            if (shift) projectPlayerStatus();   // she plays the new band from the next line
        } catch (e) { console.error('RPG Custodian: reaction judge failed', e); }
    }
    function buildReunionNote(npcName) {
        const rel = getRelationship(npcName);
        if (rel.lastSeenStep == null) return null;                         // never met → no reunion
        const elapsed = (currentGameState.timeStep || 0) - rel.lastSeenStep;
        if (elapsed < 1) return null;                                      // seen just now / together
        const npc = (currentGameState.npcRoster || []).find(n => n.name === npcName);
        const player = context.powerUserSettings.personas?.[playerAvatar()] || 'the adventurer';
        const t = affectionTier(getNpcAffection(npcName));
        const dur = elapsedPhrase(elapsed);
        const role = npc?.role ? ` (${aOrAn(npc.role)})` : '';
        const pregBand = rel.pregnancies > 0 ? pregnancyBand(npcName, 'second') : null;
        const preg = pregBand
            ? ` YOUR PREGNANCY — you have carried ${pregBand.countWord} of his through this absence and it progressed without him (${pregBand.stage}): ${pregBand.band}`
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
    // The when/where ground truth, injected SEPARATELY at depth 0 — immediately
    // adjacent to the generation point, in every generation path (trigger,
    // swipe, regenerate, continue). The big status block below rides at depth
    // 4, which in a verbose scene puts it thousands of tokens above the reply
    // being written: far enough that models invented their own day of the week
    // rather than reading ours. Facts that must never be confabulated live
    // here, short enough to stay salient and not invite fixation.
    const SCENE_PROMPT_KEY = 'RPG_CUSTODIAN_SCENE';
    function sceneGroundTruth() {
        const period = TIME_PERIODS[currentGameState.currentTime];
        return `[NOW — ${weekdayName()}, ${period ? period.name.toLowerCase() : 'day'} of day ${currentGameState.dayCount}. Place: ${locName(currentGameState.currentLocation)}. This is the true day, time, and place; anything said or thought about them matches it.]`;
    }
    function projectPlayerStatus() {
        const rd = currentGameState.isActive ? getPlayerRpgData() : null;
        context.setExtensionPrompt(SCENE_PROMPT_KEY, rd ? sceneGroundTruth() : '', 1, 0);
        if (!rd) { context.setExtensionPrompt(STATUS_PROMPT_KEY, '', 1, 4); return; }
        const s = rd.stats;
        const name = context.powerUserSettings.personas?.[playerAvatar()] || 'The adventurer';
        const items = rd.inventory.items.map(i => prettyItem(i.name));
        const lines = [
            // The scene anchor — FIRST, so every reply/narration is grounded in
            // WHERE and WHEN this is happening. NPCs must speak/act as being here.
            `[SCENE — this is happening at: ${currentSceneLabel()} (Day ${currentGameState.dayCount} — today is ${weekdayName()}).${currentLocationDesc() ? ` ${currentLocationDesc()}` : ''} Everyone present is HERE, in this place; ground all dialogue, action, and description in this exact setting — do not drift to another location.]`,
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
            const t = affectionTier(getNpcAffection(npc.name));
            const a = arousalTier(getNpcArousal(npc.name));
            let d = `${npc.name} (${t.label}${isInParty(npc.name) ? ', travelling with you' : ''}): ${npc.name} ${t.band}`;
            if (getNpcArousal(npc.name) >= 3) d += ` Physically (${a.label}): ${a.band}`;
            if (rel.pregnancies > 0) {
                const pb = pregnancyBand(npc.name, 'third');
                if (pb) d += ` HER PREGNANCY — she is pregnant with ${pb.countWord} of his, ${pb.stage}, and it is progressing as follows: ${pb.band}`;
            }
            // Cycle extremes only (peak / anti-peak), and only when not already
            // carrying. Deliberately terse and unflavored: a plain fact she
            // knows, small enough that she won't fixate on it unprompted —
            // each character flavors it her own way IF it comes up.
            if (!(rel.pregnancies > 0)) {
                const step = cycleStep(npc.name);
                const guarded = getNpcAffection(npc.name) <= 4;
                if (step === 4) d += guarded
                    ? ` Today happens to be the peak of her fertility cycle — something she'd keep to herself around him.`
                    : ` Today happens to be the peak of her fertility cycle.`;
                else if (step === 0) d += ` Today is her unfertile "safe day."`;
            }
            const npcFx = npcActiveEffects(npc.name);
            if (npcFx.length) d += ` Under effects (she KNOWS her own condition, and any physical, magical, or social constraint stated in them BINDS what she can actually do and say — a bound woman cannot walk, a silenced one cannot speak, a promise made weighs on her): ${npcFx.map(e => e.selfNote ? `${e.name} — ${e.selfNote}` : effectDetailLine(e)).join(' | ')}`;
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
        // Places likewise — but ONLY public ones (secret level 0): secret
        // locations exist for NPCs only once the story reveals them.
        const known = (currentGameState.npcRoster || []).filter(n => !n.secret);
        if (known.length) {
            lines.push('', '[Common local knowledge — everyone here knows of these people and places; NEVER invent or swap names/roles:]',
                known.map(n => `${n.name}, the ${n.role || 'resident'}${n.homeLocation ? ` (${locName(n.homeLocation)})` : ''}`).join(' · '));
            const pubPlaces = Object.values(currentGameState.worldData?.locations || {}).filter(l => !(Number(l.secret) >= 1)).map(l => l.name);
            if (pubPlaces.length) lines.push(`Places: ${pubPlaces.join(' · ')}`);
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
        if (!rd) return { affection: 0, arousal: 0, familiarity: 0, pregnancies: 0, pregnancy_progress: 0 };
        rd.relationships = rd.relationships || {};
        if (!rd.relationships[npcName]) {
            // First meeting: seed from the world-authored starting values on
            // her card (base_stats), so authors can ship a warmer-by-default
            // childhood friend or an already-smitten admirer.
            const bs = (currentGameState.npcRoster || []).find(n => n.name === npcName)?.baseStats || {};
            rd.relationships[npcName] = {
                affection: Math.max(0, Math.min(10, Number(bs.affection) || 0)),
                arousal: Math.max(0, Math.min(10, Number(bs.arousal) || 0)),
                familiarity: 0,
                pregnancies: Math.max(0, Number(bs.pregnancies) || 0),
                pregnancy_progress: Math.max(0, Math.min(150, Number(bs.pregnancy_progress) || 0)),
            };
            // Record assigned FIRST — resolveConceptionKind reads relationships
            // (curse check) and must find this one instead of recursing.
            if (rd.relationships[npcName].pregnancies > 0) {
                rd.relationships[npcName].conceptionKind = resolveConceptionKind(npcName);
                if (rd.relationships[npcName].pregnancy_progress <= 0) rd.relationships[npcName].pregnancy_progress = 5;
            }
        }
        return rd.relationships[npcName];
    }
    // EFFECTIVE affection/arousal: the raw score shifted by any active status
    // deltas (heartbreak −5 "until he makes it up to her") and ceiling'd by any
    // active caps (numbing, frigidity). Raw rel.affection/arousal stay the
    // durable truth the judge moves; every band, display, and DC reads THESE.
    function getNpcAffection(name) {
        const rel = getRelationship(name);
        const v = Math.max(0, Math.min(10, (rel.affection || 0) + npcStatMod(name, 'affection')));
        const cap = npcStatCap(name, 'affection');
        return cap != null ? Math.min(v, Math.max(0, cap)) : v;
    }
    function getNpcArousal(name) {
        const rel = getRelationship(name);
        const v = Math.max(0, Math.min(10, (rel.arousal ?? 0) + npcStatMod(name, 'arousal')));
        const cap = npcStatCap(name, 'arousal');
        return cap != null ? Math.min(v, Math.max(0, cap)) : v;
    }
    // Canonical raw-arousal write: clamps 1–10 AND to any active cap, so a
    // capped woman doesn't silently bank arousal that springs back later.
    function setNpcArousalRaw(name, v) {
        const rel = getRelationship(name);
        const cap = npcStatCap(name, 'arousal');
        rel.arousal = Math.max(0, Math.min(10, cap != null ? Math.min(v, Math.max(0, cap)) : v));
        return rel.arousal;
    }
    function adjustNpcAffection(name, delta) {
        const rel = getRelationship(name);
        rel.affection = Math.max(0, Math.min(10, (rel.affection || 0) + delta));  // clamp 0–10
        if (delta) sendGhostMessage(`${name}: 💗 affection ${delta > 0 ? '+' : ''}${delta} → ${getNpcAffection(name)}/10 (${affectionTier(getNpcAffection(name)).label})`);
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
            band: 'sees him as a stranger, and strangers are simply not her concern. Inwardly her wall is up; whatever she privately makes of him stays behind her eyes, and her words go to her own business and the task in front of her. She keeps physical distance, angles herself half-away, and lets no touch happen or linger. Freely given: civility, trade, directions, small talk about neutral things — the weather, the prices, the road — with an exit in view. She would NOT yet: seek out his company, confide anything personal, tell him what she makes of him, share private space with him, or accept flirtation as anything but noise — and she does not extend invitations of any kind herself.' };
        if (v <= 2)  return { label: 'Cordial', desc: 'is polite but reserved with you, still keeping a careful distance',
            band: 'finds him tolerable company, but owes him nothing. She is polite and businesslike, will chat within arm\'s reach of her comfort, and may laugh at a good line — then put the counter back between them. Conversation runs on the day\'s business, the town, the work at hand; her opinions of him, good or bad, stay her own. Freely given: conversation, fair dealing, casual company in public places. She would NOT yet: make time for him on purpose, share meals alone, speak of her past or feelings, say what she privately thinks of him, tolerate more than incidental touch, or invite him anywhere private.' };
        if (v <= 4)  return { label: 'Warming', desc: 'is growing comfortable around you and offers small, genuine kindnesses',
            band: 'has decided she likes having him around. Her guard lowers in increments: she remembers what he says, offers small unprompted kindnesses, lingers a little in his company, and begins to let slip what she actually thinks — a real opinion here, an honest reaction there. Body language eases — she faces him fully, allows brief friendly touch, sits nearer than strictly necessary. Freely given: real conversation, small favors, shared time in public, honest answers to honest questions. She would NOT yet: call it anything, invite him into her private spaces or her bed, accept overt romantic advances without pulling back — desire may flicker, but trust has not caught up.' };
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
        const a = Math.max(0, Math.min(10, v ?? 0));
        if (a <= 2) return { label: 'Calm', band: 'Her body is at ease — breathing even, skin cool, attention undistracted by him physically.' };
        if (a <= 4) return { label: 'Stirred', band: 'Something about him has her faintly stirred — glances that last a half-second too long, a warmth in her cheeks she could still deny, small self-conscious adjustments of hair and clothing.' };
        if (a <= 6) return { label: 'Flushed', band: 'Her body is plainly interested — color in her face, breath a touch short, finding reasons to stand near him, touches that linger. She knows it, and is hiding it imperfectly.' };
        if (a <= 8) return { label: 'Aching', band: 'Desire has real hold of her — flushed skin, quickened breath, restless hands, drawing close to him without deciding to. Composure takes active effort and keeps slipping.' };
        return { label: 'Desperate', band: 'Her body has overruled her pride — trembling, breathless, pressing near, barely keeping her hands from him. Every sense is full of him, and it shows in everything she does.' };
    }

    // === Stamina: the unified HP pool for combat AND sex (core-mechanics §5b) ===
    // Max = Ruggedness, plus any timed 'stamina' buff (a stamina potion).
    function maxStamina() {
        const cap = customStatCap('stamina');
        const base = Math.max(1, effectiveStat('ruggedness') + customStatMod('stamina'));
        return cap != null ? Math.max(1, Math.min(base, cap)) : base;
    }
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
        const cap = npcStatCap(npcName, 'stamina');
        const base = Math.max(1, (npc?.ruggedness ?? 3) + npcStatMod(npcName, 'ruggedness') + npcStatMod(npcName, 'stamina'));
        return cap != null ? Math.max(1, Math.min(base, cap)) : base;
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
        const aroBefore = rel.arousal ?? 0;
        if (rel.npcStamina <= 0) setNpcArousalRaw(npcName, Math.min(aroBefore, 2));
        else if (rel.npcStamina === 1) setNpcArousalRaw(npcName, Math.min(aroBefore, 5));
        if ((rel.arousal ?? 0) < aroBefore) {
            sendGhostMessage(`${npcName}: 😮‍💨 ${rel.npcStamina <= 0 ? 'utterly satisfied' : 'running out of steam'} — 🔥 arousal settles to ${getNpcArousal(npcName)}/10 (${arousalTier(getNpcArousal(npcName)).label})`);
        }
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
    // 8-day fertility cycle, one step per new day, visualized as moon phases.
    // The CYCLE is the base fertility; the card's fertility value is a flat
    // MOD on top of it (author-tuned by age/race), plus timed status effects.
    const MOON_CYCLE = [
        { emoji: '🌑', pct: 0, label: 'dark-moon ebb' },
        { emoji: '🌒', pct: 10, label: 'waxing crescent' },
        { emoji: '🌓', pct: 20, label: 'first quarter' },
        { emoji: '🌔', pct: 30, label: 'waxing gibbous' },
        { emoji: '🌕', pct: 40, label: 'full-moon peak' },
        { emoji: '🌖', pct: 30, label: 'waning gibbous' },
        { emoji: '🌗', pct: 20, label: 'last quarter' },
        { emoji: '🌘', pct: 10, label: 'waning crescent' },
    ];
    // Her start position is a stable pseudo-random seed from who she is
    // (age + name): no stored state, survives every save, and same-age
    // characters still land on different days.
    function cycleSeedOf(npc) {
        const s = `${npc?.name || ''}|${npc?.age || ''}`;
        let h = 0;
        for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
        return h % MOON_CYCLE.length;
    }
    function cycleStep(npcName, day = currentGameState.dayCount) {
        const npc = (currentGameState.npcRoster || []).find(n => n.name === npcName) || { name: npcName };
        return (cycleSeedOf(npc) + Math.max(1, day || 1) - 1) % MOON_CYCLE.length;
    }
    function cyclePhase(npcName) { return MOON_CYCLE[cycleStep(npcName)]; }
    function fertilityPercent(npcName) {
        const npc = (currentGameState.npcRoster || []).find(n => n.name === npcName);
        const mod = (Number(npc?.fertility) || 0) + npcStatMod(npcName, 'fertility');
        return Math.max(0, Math.min(100, cyclePhase(npcName).pct + mod));
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
    // ========================================================================
    // PREGNANCY AS A PROJECTED BAND (not a raw percentage)
    // ========================================================================
    // Every other stat reaches the models as behavior (affectionTier,
    // arousalTier); pregnancy alone used to leak "2nd Trimester stage, 60%
    // developed" — a chart reading no woman would think in, leaving the model
    // to invent what 60% feels like.
    //
    // COMPOSED, NOT ENUMERATED. kind (3) × stage (7) × count (5 buckets) is
    // 105 combinations, and eight cold soulgems at overdue is genuinely a
    // different experience from one egg at mid-term — but 5 vs 6 children is
    // not, so counts collapse into buckets. Each band is built from a stage
    // core (21) + a burden clause when she carries more than one (5 tiers) +
    // a per-kind multiple-sensation. Templates carry {she}/{her}/{is} tokens
    // so one set of text serves both third person (what others perceive) and
    // second person (her own reunion briefing).
    const PREG_NOUNS = {
        live: { one: 'child', many: 'children' },
        egg: { one: 'egg', many: 'eggs' },
        crystal: { one: 'soulgem', many: 'soulgems' },
    };
    // Where she carries them. EVERY sentence that places the young in space
    // must name a body part: "eight soulgems jostling inside her" reads just
    // as easily as a satchel of gems, and a model given that will happily play
    // her hauling them around. {carrier} keeps the pregnancy inescapable.
    const PREG_CARRIER = { live: 'womb', egg: 'womb', crystal: 'womb' };
    // What several of them FEEL like together. Keyed by burden tier, not just
    // by kind — one fixed sensation per womb type meant a whole twin pregnancy
    // described itself with the same kicks-collide clause every time. These
    // evolve as she progresses, so the arc reads differently at each stage
    // while staying deterministic for any given state.
    const PREG_MULTI_SENSE = {
        // Each is a noun-plus-participle absolute clause so it can hang off
        // "she feels …" or sit between dashes, and none may reuse a word or
        // sensation its own stage sentence already spent.
        live: {
            showing: 'elbows and heels mapping themselves across the taut curve of {her} middle',
            heavy: 'a slow constant shifting as they trade places inside {herO}',
            overdue: 'a steady press outward against the walls of {her} womb',
        },
        egg: {
            showing: 'the shells clicking softly whenever {she} {turns}',
            heavy: 'a smooth heavy grinding as they settle against one another',
            overdue: 'a low shifting knock with every breath {she} {takes}',
        },
        crystal: {
            showing: 'their smooth flanks nudging and settling against one another',
            heavy: 'a cool tingling as the facets graze together',
            overdue: 'a muffled peal of little bells shifting low in {her} pelvis',
        },
    };
    // Stage cores. Tokens come in two families: PERSON ({she}/{her}/{is} —
    // third person for what others perceive, second for her own briefing) and
    // NUMBER ({TheYoung}/{They}/{isare}/{shifts} — one egg must never be
    // "shells"). Crystals are deliberately written light: cool, chiming,
    // faintly musical curiosities, not body horror. This is a warm game.
    const PREG_STAGE_CORE = {
        live: [
            `Something has just taken root in the lining of {her} womb — far too small to feel and far too early to show. If {she} {knows} at all, it is instinct, or the calendar, or a smug little suspicion {she} {cannot} yet justify.`,
            `{Her} womb has taken, and {her} body has started rearranging itself around the news: breasts fuller and tender enough that a careless touch makes {herO} catch {her} breath, a queasy hour most mornings, and a bone-deep sleepiness that ambushes {herO} mid-sentence.`,
            `There is no hiding it in anything close-fitting now — {her} waist has thickened, {her} hips have begun to soften and spread, and {her} appetite has developed opinions {she} {does} not remember agreeing to.`,
            `{Her} belly has rounded in earnest, firm and high below the navel. {Her} breasts have grown heavy and {her} areolae have darkened; everything about {herO} runs warmer and more sensitive than {she} {is} used to, which {she} {is} not entirely sorry about.`,
            `{She} {is} gloriously, unmistakably pregnant, and the quickening has arrived — flutters graduated into proper kicks {she} {can} catch under {her} palm. There is a new sway in {her} hips, a flush of blood in {her} skin, and {she} {has} never been so aware of being touched.`,
            `{She} {is} vast and near {her} time, the swell of {her} womb crowded up under {her} ribs. Practice pangs tighten across {her} belly without warning, {her} pelvis aches, and sleep is a nightly negotiation with pillows — yet {she} {is} ripe and warm and privately rather pleased with what {her} body is managing.`,
            `{She} {is} past {her} date and {her} body knows it: the weight has dropped low into {her} pelvis, {her} cervix has begun to soften and open, and the tightenings come in waves that mean business. {She} {cannot} travel far or think about much else, and {she} {is} thoroughly finished being patient about it.`,
        ],
        egg: [
            `Something has just settled in {her} womb — far too early to feel; only instinct, or the count of days, or a certain private smugness would tell {herO} that {she} {is} gravid at all.`,
            `Something is forming low in {her} womb: an unfamiliar fullness, a pleasant heat banked beneath {her} ribs, and a hunger that has begun to badly outrun {her} meals.`,
            `{TheYoung} {isare} taking shape in {her} oviduct — {she} {can} feel the curve of {them} sitting low and firm where {she} used to be soft, and {they} {changes} how {she} {sits}, how {she} {moves}, and how often {she} {needs} to stretch.`,
            `{Her} middle has swelled smooth and taut, and {she} {has} gone warm all over with it. {TheYoung} {shifts} when {she} {moves}, {her} hips have loosened, and {she} {has} begun to favor warm dark corners without quite deciding to.`,
            `{She} {is} splendidly gravid, {her} belly heavy and drum-tight. {She} {feels} {theYoung} settle and press against {her} pelvis, {her} whole body has gone sensitive and slick-warm, and the urge to build a nest has stopped being subtle.`,
            `{Her} belly is swollen near to bursting, {theYoung} hard and unmistakable beneath the skin of it. {Her} hips ache, {her} body has begun to slacken and slicken in preparation, and the nesting urge has become an itch {she} {cannot} scratch sitting still.`,
            `{She} {is} ready to lay and long past ready — {theYoung} riding low against {her} pelvis, {her} muscles clenching in slow deliberate waves, {her} body open and eager to be rid of the weight. Every instinct in {herO} is bellowing for a nest, and {she} {is} well beyond caring who watches.`,
        ],
        crystal: [
            `Something has just settled in {her} womb — nothing to feel yet beyond a faint, pleasant coolness low in {her} womb that {she} might blame on the weather.`,
            `What has rooted in {herO} is not quite flesh: a cool, oddly comfortable weight low in {her} womb, and the faint sense of something smooth taking shape.`,
            `{TheYoung} {isare} setting in {her} womb — smooth, cool, and perfectly still. {She} {feels} no kicking, only a curious weight low in {her} pelvis and, now and then, the faintest hum under a palm laid against it.`,
            `{Her} belly has rounded around {theYoung}. {They} {isare} cool from within and {tingles} pleasantly when {she} {moves}, chiming faint and clear as glass touched with a fingernail.`,
            `{Her} pregnancy shows plainly now, {her} belly heavy with {theYoung}: cool, glimmering, and softly musical. No kick, no flutter — only a bright little chime when {she} {moves}, and a tingle that runs agreeably up {her} spine.`,
            `{Her} belly is round and heavy with crystal, the skin of it taut over smooth curves that catch the light. Nothing in there stirs on its own — only a dense chill weight, and the faint singing of {theYoung} whenever {she} {moves}.`,
            `{She} {is} past due to be delivered of {them} — {theYoung} cool and chiming and gloriously heavy, {her} body ready to be rid of them. {She} {can} think of scarcely anything else, though it troubles {herO} far less than {she} expected.`,
        ],
    };
    // Burden of carrying MULTIPLES, scaled by how far along she is. Stages
    // where nothing is detectable yet get no clause at all — eight of them at
    // implantation still feels like nothing.
    const PREG_BURDEN = {
        unfelt: null,
        // `n` arrives as a complete phrase ("twins", "8 soulgems"), so these
        // must read correctly with a plural subject and never re-count it
        // ("twins of them" / "8 soulgems of them"). Verbs whose subject is a
        // body part rather than the woman stay literal — {is} would conjugate
        // to "your body are".
        // Each tier gets its OWN framing. Earlier drafts rang four changes on
        // "more than one would explain" and the repetition showed badly.
        early: (n, sense) => `And there {isare} ${n} in {her} {carrier} — {she} {is} already showing more than {she} {has} any right to this early.`,
        rising: (n, sense) => `${n} at once have {her} belly rounding fast: {she} {is} already the size a woman carrying one would not reach for another month or two.`,
        showing: (n, sense) => `${n} jostle for room in {her} {carrier}, ${sense}, and {she} {looks} months further along than {she} truly {is}.`,
        // The sensations are noun phrases, so they need a verb to hang on in a
        // list of clauses ("…every movement is a negotiation, and a slow
        // constant shifting" breaks the parallel) or a parenthetical of their own.
        heavy: (n, sense) => `With ${n} packed into {her} {carrier} {she} {is} magnificently, absurdly huge — no position lasts a minute, standing up is a project of its own, and {she} {feels} ${sense}.`,
        overdue: (n, sense) => `${n}, all of them overdue, make a frankly ridiculous load for one {carrier} — ${sense} — and {she} {is} at the absolute limit of what {she} {can} hold.`,
    };
    function pregStageIdx(pct) {
        const p = Number(pct) || 0;
        if (p < 10) return 0;
        if (p < 25) return 1;
        if (p < 35) return 2;
        if (p < 60) return 3;
        if (p < 80) return 4;
        if (p < 100) return 5;
        return 6;
    }
    // One tier per stage from Fetal on, so no two consecutive stages describe
    // the multiples with the same sentence.
    const PREG_BURDEN_TIER = ['unfelt', 'unfelt', 'early', 'rising', 'showing', 'heavy', 'overdue'];
    // 5 and 6 are not materially different experiences; 1, 2, 3, a handful, and
    // a great many are.
    const NUM_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
    function pregCountWord(kind, n) {
        if (n <= 1) return kind === 'live' ? 'one child' : `one ${PREG_NOUNS[kind].one}`;
        if (n === 2) return kind === 'live' ? 'twins' : `two ${PREG_NOUNS[kind].many}`;
        if (n === 3) return kind === 'live' ? 'triplets' : `three ${PREG_NOUNS[kind].many}`;
        // Spelled out — the phrase can open a sentence in the burden clause.
        return `${NUM_WORDS[n] || n} ${PREG_NOUNS[kind].many}`;
    }
    // PERSON tokens — always a woman (this is a hetero romance game); the only
    // thing that varies is whether the text describes her to others or to her.
    //
    // {her} and {herO} are BOTH "her" in third person and must not be merged:
    // English collapses the possessive and the object form, but the second
    // person does not. "her belly" → "your belly" (possessive, {her}), while
    // "rooted in her" → "rooted in you" (object, {herO}). Using {her} for an
    // object produced "taken root in your", which is broken.
    const PREG_TOKENS = {
        third: { She: 'She', she: 'she', Her: 'Her', her: 'her', herO: 'her', is: 'is', has: 'has', knows: 'knows', feels: 'feels', moves: 'moves', tires: 'tires', sits: 'sits', does: 'does', can: 'can', cannot: 'cannot', turns: 'turns', takes: 'takes', needs: 'needs', carries: 'carries', looks: 'looks' },
        second: { She: 'You', she: 'you', Her: 'Your', her: 'your', herO: 'you', is: 'are', has: 'have', knows: 'know', feels: 'feel', moves: 'move', tires: 'tire', sits: 'sit', does: 'do', can: 'can', cannot: 'cannot', turns: 'turn', takes: 'take', needs: 'need', carries: 'carry', looks: 'look' },
    };
    // NUMBER tokens — one egg is a shell, not "shells". {oneYoung} stays
    // singular regardless of count (for "what a single egg would explain").
    function pregNumberTokens(kind, count) {
        const n = PREG_NOUNS[kind];
        const carrier = PREG_CARRIER[kind] || 'womb';
        return count === 1
            ? { carrier, TheYoung: `The ${n.one}`, theYoung: `the ${n.one}`, They: 'It', they: 'it', them: 'it', isare: 'is', shifts: 'shifts', tingles: 'tingles', changes: 'changes', young: n.one, oneYoung: n.one }
            : { carrier, TheYoung: `The ${n.many}`, theYoung: `the ${n.many}`, They: 'They', they: 'they', them: 'them', isare: 'are', shifts: 'shift', tingles: 'tingle', changes: 'change', young: n.many, oneYoung: n.one };
    }
    function renderPregTokens(text, person, kind, count) {
        const map = { ...(PREG_TOKENS[person] || PREG_TOKENS.third), ...pregNumberTokens(kind, count) };
        return String(text).replace(/\{(\w+)\}/g, (m, k) => (k in map ? map[k] : m));
    }
    /**
     * The projected pregnancy band. `person`: 'third' (others perceive her) or
     * 'second' (she reads it about herself).
     * Returns null when she carries nothing.
     */
    function pregnancyBand(npcName, person = 'third') {
        const rel = getRelationship(npcName);
        const count = Math.max(0, Number(rel.pregnancies) || 0);
        if (!count) return null;
        const kind = ['live', 'egg', 'crystal'].includes(rel.conceptionKind) ? rel.conceptionKind : 'live';
        const pct = Number(rel.pregnancy_progress) || 0;
        const idx = pregStageIdx(pct);
        const countWord = pregCountWord(kind, count);
        const parts = [PREG_STAGE_CORE[kind][idx]];
        if (count >= 2) {
            const tier = PREG_BURDEN_TIER[idx];
            const burden = PREG_BURDEN[tier];
            // The clause opens a sentence, and the count phrase may lead it
            // ("twins, all past due…"), so it has to be capitalized.
            // The sensation is tier-specific, so it evolves across the arc.
            if (burden) { const c = burden(countWord, PREG_MULTI_SENSE[kind][tier] || ''); parts.push(c.charAt(0).toUpperCase() + c.slice(1)); }
        }
        const band = renderPregTokens(parts.join(' '), person, kind, count);
        return {
            label: `${PREGNANCY_STAGES[idx].name} · ${countWord}`,
            stage: PREGNANCY_STAGES[idx].name,
            count, kind, pct, countWord, band,
        };
    }

    // Called on every Increment Time event — grows each active pregnancy 5%.
    function advancePregnancies(quiet = false) {
        const rd = getPlayerRpgData(); if (!rd) return;
        for (const [name, rel] of Object.entries(rd.relationships || {})) {
            // Any NPC carrying (pregnancies > 0) grows, even if progress was still 0.
            let announced = false;
            if ((rel.pregnancies || 0) > 0 && (rel.pregnancy_progress || 0) < OVERDUE_SOLO_BIRTH_PCT) {
                const before = rel.pregnancy_progress || 0;
                rel.pregnancy_progress = Math.min(OVERDUE_SOLO_BIRTH_PCT, before + 5);
                const s0 = pregnancyStage(before), s1 = pregnancyStage(rel.pregnancy_progress);
                if (!quiet && s1 && s1 !== s0) {
                    announced = true;
                    const carry = rel.pregnancies > 1 ? ` (${rel.pregnancies} fetuses)` : '';
                    sendGhostMessage(`🤰 ${name}'s pregnancy${carry} enters the **${s1}** stage — ${rel.pregnancy_progress}%.` +
                        (s1 === 'Fetal' ? ' She can no longer conceive further until this pregnancy ends.' :
                            s1 === 'Birth Overdue' ? ' She is at term and ready to give birth!' : ''));
                }
            }
            // Overdue mothers NAG every time step (not just the stage
            // transition) until the birth actually happens.
            if (!quiet && !announced && (rel.pregnancies || 0) > 0 && (rel.pregnancy_progress || 0) >= 100) {
                const carry = rel.pregnancies > 1 ? ` (carrying ${rel.pregnancies})` : '';
                sendGhostMessage(`🤰 ${name} is **overdue**${carry} — ${rel.pregnancy_progress}%. She needs to give birth!`);
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
        // Authored womb type beats race inference (cast editor).
        if (['live', 'egg', 'crystal'].includes(npc?.wombType)) return npc.wombType;
        if (EGG_RACE.test(npc?.race || '')) return 'egg';
        if (/soul[\s-]?crystal|soulshard|soul[\s-]?mage|soul[\s-]?wizard|necromancer|\blich\b|soulforge/i.test(playerPersonaText())) return 'crystal';
        return 'live';
    }
    function birthKindFor(npcName, override) {
        const rel = getRelationship(npcName);
        // What she carries was decided AT CONCEPTION and is engine ground
        // truth — the Custodian's kind is only a fallback for a pregnancy that
        // predates the record, NEVER an override. It reasons from what it can
        // see (Seline is human, so: a child) and cannot know a magically
        // egg-bearing womb, so letting it win turned a laid egg into a baby.
        if (['live', 'egg', 'crystal'].includes(rel.conceptionKind)) return rel.conceptionKind;
        if (override && ['live', 'egg', 'crystal'].includes(override)) return override;
        return resolveConceptionKind(npcName);
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
    // A mod may be a CAP instead of a delta: {stat, cap} — the stat cannot rise
    // above cap while the effect is active (numbing, exhaustion, a ward). The
    // lowest active cap wins; null = uncapped.
    function effectStatCap(effects, stat) {
        const caps = (effects || []).filter(e => e.active !== false)
            .flatMap(e => (e.mods || []).filter(m => m.stat === stat && m.cap != null).map(m => Number(m.cap)))
            .filter(c => !isNaN(c));
        return caps.length ? Math.min(...caps) : null;
    }
    function customStatCap(stat) { return effectStatCap(getPlayerRpgData()?.customEffects, stat); }
    function npcStatCap(npcName, stat) { return effectStatCap(getRelationship(npcName).customEffects, stat); }
    // NPC-side equivalent — folds an NPC's own bespoke effects into her real
    // numbers (fertility, stamina, ruggedness, resist DC…). Replaces npcBuffFor.
    function npcStatMod(npcName, stat) { return effectStatMod(getRelationship(npcName).customEffects, stat); }
    function npcActiveEffects(npcName) { return (getRelationship(npcName).customEffects || []).filter(e => e.active !== false); }
    function effectLine(e) { const el = statusEndsLabel(e); return `${effectIcon(e)} ${e.name}${statusModString(e.mods)}${el ? ` (${el})` : ''}`; }
    /** Full detail line: description + how it ends (times, conditions, triggers). */
    function effectDetailLine(e) {
        const el = statusEndsLabel(e);
        return `${effectIcon(e)} ${e.name}${statusModString(e.mods)}${e.desc ? ` — ${e.desc}` : ''} · ends: ${el || 'permanent'}`;
    }
    function statusIcon(pol) { return pol === 'positive' ? '🌟' : pol === 'negative' ? '☠️' : '✨'; }
    // Unified effect vocabulary — buff/debuff/pact/blessing/vow/curse/quest are all
    // one thing (an effect that is applied and later ends); `kind` just picks the face.
    const KIND_ICON = { buff: '🌟', blessing: '🌟', boon: '🌟', debuff: '☠️', disease: '🤢', poison: '🧪', curse: '💠', hex: '💠', pact: '🤝', vow: '🤝', oath: '🤝', deal: '🤝', quest: '📜', task: '📜', errand: '📜', status: '✨' };
    function effectIcon(e) { return KIND_ICON[String(e?.kind || '').toLowerCase()] || statusIcon(e?.polarity); }
    function statusModString(mods) {
        return (mods || []).length ? ` [${mods.map(m => m.cap != null
            ? `${m.stat} capped at ${m.cap}`
            : `${(Number(m.amount) || 0) >= 0 ? '+' : ''}${m.amount} ${m.stat}${m.condition ? ` (${m.condition})` : ''}`).join(', ')}]` : '';
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
    function addCustomStatus(target, spec, quiet = false) {
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
        // An immobilizing state pins an NPC where it takes hold — her schedule
        // stops walking her around until the status ends (pin dies with it).
        if (spec.immobilizes && !isPlayer) {
            rec.immobilizes = true;
            const present = getNpcsAt(currentGameState.currentLocation).some(n => n.name === target);
            rec.pinnedAt = present ? currentGameState.currentLocation : scheduledLocationFor(target);
        }
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
        // A stamina CAP bites immediately — current can't sit above the new max
        // (lethargy drains her NOW; when it lifts, she stays drained until rest).
        if (rec.mods.some(m => m.stat === 'stamina' && m.cap != null)) {
            if (isPlayer) holder.stats.stamina = Math.min(holder.stats.stamina ?? maxStamina(), maxStamina());
            else if (holder.npcStamina != null) holder.npcStamina = Math.min(holder.npcStamina, npcMaxStamina(target));
        }
        savePlayer();
        const ends = [rec.expiresOnCheck ? `your next ${rec.expiresOnCheck} trial` : null, dur ? `${dur} time period${dur > 1 ? 's' : ''} pass` : null, rec.endCondition].filter(Boolean).join(', or ');
        if (quiet) {
            // Editor/meta callers: no chat message — a chat may not even be open.
        } else if (category === 'quest') {
            const rw = rewardLabel(rec.reward);
            sendGhostMessage(`📜 **New objective: ${rec.name}** — ${rec.endCondition || rec.desc || 'see it through'}.${statusModString(rec.mods)}${rw ? `\n_Reward: ${rw}._` : ''}`);
        } else {
            const who = (!target || target === 'player') ? 'You gain' : `${target} gains`;
            const kindWord = rec.kind && rec.kind !== 'status' ? rec.kind : `${rec.polarity} status`;
            sendGhostMessage(`${effectIcon(rec)} **${rec.name}** — ${who} a ${kindWord}.${statusModString(rec.mods)}${rec.desc ? ` ${rec.desc}` : ''}${ends ? `\n_Ends when: ${ends}._` : ''}`);
        }
        // NPC self-knowledge (generated once, async) + in-play application reaction
        if (!isPlayer) {
            generateStatusSelfNote(target, rec);
            if (!quiet && category !== 'quest') {
                queueStatusReaction(target, `The effect "${rec.name}"${rec.desc ? ` (${rec.desc})` : ''} has JUST taken hold of her — she feels it settling in right now.`);
            }
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
        const expire = (holder, label, npcName = null) => {
            if (!holder.customEffects?.length) return;
            const gone = holder.customEffects.filter(e => e.expiresStep != null && step >= e.expiresStep);
            if (!gone.length) return;
            holder.customEffects = holder.customEffects.filter(e => !gone.includes(e));
            if (!quiet) for (const e of gone) {
                sendGhostMessage(e.category === 'quest'
                    ? `⌛ Objective **${e.name}** expired — the chance has passed.`
                    : `⌛ ${label} **${e.name}** ${e.polarity === 'positive' ? 'fades' : 'passes'}.`);
                if (npcName && e.category !== 'quest') queueStatusReaction(npcName, `Her "${e.name}" has just worn off with time — she feels it fading away.`);
            }
        };
        expire(rd, 'Your');
        for (const [name, rel] of Object.entries(rd.relationships || {})) {
            expire(rel, `${name}'s`, name);
            // Arousal cools by 2 per time period toward calm (romance-redesign
            // §D; raised from 1, Dyna 2026-07-28 — it lingered too long) —
            // bodies cool off; affection doesn't. Step-guarded so a repeated
            // prune in the same period can't double-decay.
            if ((rel.arousal ?? 0) > 0 && rel.arousalDecayStep !== step) {
                rel.arousal = Math.max(0, (rel.arousal ?? 0) - 2);
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
        for (const e of removed) {
            sendGhostMessage(`✅ **${e.name}** ends${reason ? ` — ${reason}` : ''}.`);
            if (target && target !== 'player') queueStatusReaction(target, `The effect "${e.name}" on her has JUST ended${reason ? ` — ${reason}` : ''}. She feels it lift.`);
        }
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
        // SCOPE: an NPC's condition is only judgeable when SHE is in the
        // current scene — the on-screen story is the only legitimate evidence
        // of it completing. (A distant NPC — or one from another world
        // entirely, since relationships are persona-global — must never have
        // her statuses ended by scenes she isn't in. Timers remain the
        // world-agnostic backstop.) Player conditions always judge.
        const inScene = new Set(getNpcsAt(currentGameState.currentLocation).map(n => n.name));
        for (const p of (currentGameState.party || [])) inScene.add(p);
        const regStatuses = (holder, target) => {
            const eligible = target === 'player' || inScene.has(target);
            for (const e of (holder.customEffects || [])) {
                if (e.active === false || !e.endCondition) continue;
                if (e.justCreated) { e.justCreated = false; continue; }
                if (!eligible) continue;
                pending.push({ kind: e.category === 'quest' ? 'quest' : 'status', id: e.id, text: e.endCondition, target, name: e.name, ref: e });
            }
        };
        const regCurse = (holder, target) => {
            const c = holder.crystalCurse;
            if (!c || !c.active || !c.breakCondition) return;
            if (c.justCreated) { c.justCreated = false; return; }
            if (target !== 'player' && !inScene.has(target)) return;
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
        // Disarm any stale dismiss listener from a previous popup — a bubbling
        // click from OUTSIDE a popup row (e.g. a form's Save button reopening
        // a popup) would otherwise instantly kill the new popup.
        $(document).off('click.rpgActionPop');
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
            const items = visibleConnections(currentGameState.currentLocation).map(c => ({
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
            const ar = getNpcArousal(n.name);
            let s = `${n.name} (${n.role || 'townsperson'}) [disposition toward player: ${t.label}, affection ${getNpcAffection(n.name)}; arousal ${arousalTier(ar).label} ${ar}/10 — warmer disposition AND higher arousal both lower the DC of charming/persuading her; a Wary, Calm NPC resists hardest]`;
            if (n.wrestle) s += ` [a physical contest/wrestle against her is a ${n.wrestle.stat} check, difficulty ${n.wrestle.difficulty}]`;
            if (n.shopInventory) s += ` [MERCHANT, sells: ${n.shopInventory.map(i => `"${i.name}" ${i.price}g`).join(', ')}]`;
            const fx = npcActiveEffects(n.name);
            if (fx.length) s += ` [ALREADY under effects (don't re-apply these; honor any constraint they state when judging what she/the scene can do): ${fx.map(e => `"${e.name}"${statusModString(e.mods)}${e.desc ? ` — ${e.desc}` : ''}`).join('; ')}]`;
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
    const GM_MECHANICAL_PREFIX = /^\s*(🚶|🌀|⏰|🗓️|👀|📦|🎒)/;
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
    const STORY_SPINE_PREFIX = /^\s*(🚶|🌀|⏰|🗓️)/;
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
            .map(m => `${m.is_user ? 'Player' : m.name}: ${String(m.mes).replace(/\s+/g, ' ').slice(0, 800)}`);
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
A single message often contains SEVERAL effects — a look taken while talking, a job accepted while setting off, a place entered while greeting someone. Emit ALL of them, in narrative order. NEVER let one effect crowd out another: dialogue does not cancel a travel, a travel does not cancel an acceptance, a look does not replace a move.
  {"type":"move","destination":"..."}  the player travels to / heads for / walks to / steps INTO any KNOWN PLACE (see the list). Give the place he actually INTENDS to reach — copy its name AS LISTED in KNOWN PLACES (the player may call it something else: "the secret tunnel", "her shop" — you translate to the listed name) — the engine finds the route there automatically, however many stops it takes; never substitute an intermediate stop for the real destination. Entering, going inside, or arriving at a named place IS a move — emit it even when the message also looks around, greets someone, or converses (emit the move FIRST, then the rest). SECRET-tagged places are fully valid destinations exactly like any other — the tag only describes NPC knowledge and menus, never routability; using a hidden entrance, lifting the false bush, slipping through the gap IS a move there. Deterministic, no check.
  {"type":"event_teleport","destination":"..."}  the STORY translocates the party INSTANTLY — a spell or ritual, a portal or rift, an entity spiriting them away, strange technology, a summons taking hold. No walking and no route: any KNOWN PLACE is a valid destination, INCLUDING places no path joins to the map at all (pocket dimensions, sealed sanctums, other planes). The player and any party companions arrive together in a single beat. Emit it when the narrative performs the translocation — the player steps through the rift, accepts an entity's offer to be whisked away, is pulled bodily into somewhere else. Ordinary walking, riding, or climbing to a reachable place stays "move". Deterministic, no check.
  {"type":"advance_time","periods":N}  narrative time passes. Each period is a step Morning→Day→Evening→Night→(next) Morning. A FULL DAY IS EXACTLY 4 PERIODS — for an explicit span of days use N = days×4 EXACTLY: "one day" = 4, "two days" = 8, "three days" = 12, "a week" = 28. For a time-of-day span, count periods from CURRENT TIME to the target: from Morning "long into the evening" = 2; "that night"/"until nightfall" = to Night; "sleep until morning" = to next Morning.
  {"type":"add_party","npc":"..."}  a present NPC agrees to travel WITH the player or to spend extended time together (join me, come along, let's spend the day together, share stories into the evening). She then follows the player everywhere until dismissed.
  {"type":"remove_party","npc":"..."}  a companion parts ways / is dismissed / stays behind.
  {"type":"buy_item","name":"..."}   buy from a PRESENT merchant. The engine charges the price — do NOT also emit adjust_gold.
  {"type":"use_item","name":"..."}   consume/use an item the player HOLDS (drink a potion, crush a soul crystal, etc.). SOUL CRYSTALS: the inert gems born under the Crystal Curse are collectible spell-fuel — when the player GATHERS/pockets them emit add_item "soul crystal" (one per crystal); when he CRUSHES/channels/uses one emit use_item "soul crystal" (the engine restores 1 Mana and consumes it).
  {"type":"adjust_gold","amount":N}  ONLY for ad-hoc gold NOT covered above (finding coins, a bribe, gambling).
  {"type":"whereabouts"}  the player asks a present NPC where somebody is, how to find them, whether they've seen someone, or when somebody would be somewhere → emit this and the engine hands the addressed NPC honest local knowledge of where everyone is right now (daily routines are common knowledge in a small community). NEVER invent someone's location yourself — emit this and let her answer from what the engine provides.
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
  {"type":"add_status","target":"player"|"HerName","name":"...","kind":"buff|debuff|blessing|curse|pact|vow|disease|poison|status","polarity":"positive"|"negative","desc":"what it does","mods":[{"stat":"ruggedness|charm|craftiness|virility|fertility|stamina|affection|arousal","amount":N} or {"stat":"...","cap":N}],"duration":N,"expires_on_check":"ruggedness|charm|craftiness|virility","end_condition":"plain-English condition that ends it"}  INVENT a bespoke applied effect. A buff, debuff, blessing, curse, hex, pact, vow, oath, disease, poison, inspiration, drunkenness, a potion's effect — these are ALL the same thing: something APPLIED to a character that later ENDS. Works on the player OR any NPC (target her name). Set "kind" to the fitting label (it picks the icon/framing). HOW IT ENDS — give any of: "duration" (time periods), "end_condition" (a story event), or "expires_on_check" (a stat name) for a SINGLE-USE PRE-BUFF that is spent the very next time the character attempts a trial of that stat — a combat-prep draught ("+3 ruggedness, gone after your next fight"), a courage tonic before one daring roll, a focus charm for the next lore check. Watch for these one-shot "before I try this, I…" boosts and give them expires_on_check on the matching stat. Combine ends freely (whichever fires first). See STAT MODS & SCALE below for amounts. (A pact/vow that also has a GOAL to fulfil for a reward → use add_objective instead.) NARRATIVE-ONLY EFFECTS — "mods" may be an EMPTY list []: whenever the story shows something DONE TO a character that meaningfully constrains, compels, transforms, or obliges her — physically, magically, or socially — apply a status even when no number changes: put the constraint BLUNTLY in "desc" (exactly what she now cannot do, or must do) and give it an end. Being done-to is the trigger; it needs no spell name, potion, or system word — restraints, bindings, vows extracted, magical compulsions, states imposed on a body or mind all qualify. Invent freely; do not wait for the player to name an effect.
    HOW IT ENDS — give it a "duration" in time periods AND/OR an "end_condition", and it ends when EITHER happens (whichever comes first). A "duration" is a deterministic timer (4 periods = one day) — invent a sensible lifespan so nothing lingers forever (a bad hangover ~4; a wolf-fever sickness ~12; a fleeting inspiration ~2; a grievous curse-like affliction longer or omit for indefinite). An "end_condition" is a narrative escape hatch judged by the engine ("when cured with medicine", "if you harm an innocent", "once the sun rises") — use it when a specific event should end it early. Most lingering afflictions want BOTH, e.g. duration 12 AND end_condition "when treated with a cure" → "12 periods pass, or when cured". Omit both only for something truly permanent. CRUCIAL — do this WHENEVER the story inflicts or bestows something that LINGERS past this single moment, not just a blessing or hex: an illness/disease/infection, a poison or venom, a festering or draining wound, exhaustion, a fear or despair, an inspiration or resolve, an enchantment/charm, drunkenness, a mark or oath, etc. Do NOT let such a thing evaporate as mere flavor, and do NOT collapse a lingering affliction into one-off "damage" — if the narrative says a character is left weakened/sickened/poisoned/emboldened in an ONGOING way, that is a STATUS. Read the fiction and give it the FITTING mod: something that saps physical strength lowers ruggedness (negative amount), something dulling the mind lowers craftiness, something disfiguring lowers charm, a boon raises the apt stat (small, ±1–3). A mod applies for the WHOLE time the status is active — do NOT add any per-mod condition (the status being active IS the condition). A status may also be purely narrative with no mods. end_condition is a natural-language trigger the engine WATCHES and auto-ends the status when met — infer what would plausibly end THIS effect (e.g. a sickness ends when it is cured/treated by medicine; drunkenness when slept off; a fear when the threat is gone). Omit only if truly indefinite. This is the main tool for the world to leave a lasting mark on a character — reach for it.
  {"type":"add_objective","name":"short title","objective":"plain-English condition that COMPLETES it","reward":{"gold":N,"xp":N,"tokens":N,"item":"name"},"duration":N,"mods":[{"stat":"...","amount":N}]}  the player TAKES ON a task, quest, errand, promise, oath, deal, or PACT — a villager's request, a fey bargain, a personal vow ("I'll find the lost locket", "I swear to guard her", "I accept your pact, fair one"). This is a tracked objective — a "silent status" the engine WATCHES; when its objective is met in the story it AUTO-COMPLETES and grants the reward. reward is optional (any of gold/xp/power tokens/an item). duration is optional (a time-limited task fails if not done in time). mods are optional stat changes that hold WHILE a pact/oath is in force (a fey pact granting +2 craftiness until it's fulfilled or broken) — omit for an ordinary errand. Emit whenever the player accepts or undertakes ANY goal, however small — INCLUDING when the acceptance is just one beat of a message that also travels, converses, or does other things ("Yeah, I'll take the job — lead the way" emits add_objective AND the move; the job is NEVER dropped in favor of the other effects).
  {"type":"remove_status","target":"player"|"HerName","name":"...","reason":"why"}  end a named status effect or abandon an objective now (dispelled, cured, willed away, given up).
  {"type":"adjust_stat","target":"player"|"HerName","stat":"ruggedness|charm|craftiness|virility","amount":N}  a PERMANENT change to a core stat (a hard-won training gain, a level of mastery, a permanent drain from dark magic). Use sparingly — for temporary changes use add_status.
  {"type":"equip_item","name":"..."}  the player equips/dons/wears/wields a piece of gear he holds (a sword, armor, an amulet). {"type":"unequip_item","name":"..."} he removes/sheathes/takes it off. (Consumables are use_item, not equip.)
  {"type":"birth","npc":"HerName","count":N,"kind":"live"|"egg"|"crystal"}  a BIRTH is happening in the scene — a mother AT or OVER term (Birth Overdue) is delivering: labor/pushing/crowning, laying an egg, or producing a crystal. Emit ONE per message for however many emerge in THAT message (count = born right now; e.g. triplets delivered one at a time across three messages → three births of count 1, or all at once → one birth of count 3). Never emit more than she is carrying. kind: "egg" for egg-laying mothers (dragons, harpies, other monster-girls), "crystal" if the sire's magic makes inert soul-crystals (a soul-mage / necromancer father), else "live". You may OMIT kind — the engine infers it from her race and the father. Do NOT invent Power Tokens, offspring, or names — the engine awards the tokens and names the young. Only emit when a birth actually occurs in the narrative.
  {"type":"examine","npc":"HerName"}  the player looks over / examines / studies / sizes up / inspects / ADMIRES a PRESENT NPC — including looking her up and down, drinking in the sight of her, taking in her sleeping form, or appraising her appearance. The engine shows her stats and a status-flavored description. Emit whenever the player deliberately takes in or appraises a specific NPC's body/appearance/condition, EVEN when it is one beat inside a larger described action (e.g. "…stepping back, looking her up and down, admiring her sleeping form, before leaving" → emit examine for her). Do NOT skip it just because other things also happen in the same message. A deliberate visual appraisal ALWAYS emits examine no matter what else the message contains — action, travel, or DIALOGUE. Talking with her at the same time does not make the look incidental: "I ask about her wares while letting my eyes wander over her" → emit examine for her AND still let the conversation proceed (target_npc stays set; she replies as normal). (Skip only for an incidental glance with no appraisal.) Use npc:"self" when the player checks himself over / takes stock of his own condition / looks at his own stats, gear, or gold — the engine shows HIS readout.
Empty array when nothing changes.

STAT MODS & SCALE (for add_status/add_objective mods on ANY character, player OR npc): a mod applies the whole time the effect is active. The core stats — ruggedness, charm, craftiness, virility — run ~1–10, so mod them by a SMALL integer ±1 to ±3 (up to ±5 for potent magic). Two special NPC stats may also be modded: FERTILITY is a PERCENTAGE (0–100%), so a fertility mod must be big to matter, +10 to +30 (a strong fertility potion ≈ +20). STAMINA is the small combat/sex HP pool (~1–10), so a stamina mod is +1 to +3 (up to +5); a POSITIVE stamina mod also tops up current Stamina and revives the unconscious. Simple consumables are just a short-duration add_status: a strength draught → kind "buff", mods [{stat:"ruggedness",amount:2}], duration 4; a shared fertility potion → player kind "buff" mods [{stat:"virility",amount:2}] AND on her mods [{stat:"fertility",amount:20}]; a poison → kind "debuff"/"poison", negative mod. Two more NPC-only moddable stats: AFFECTION and AROUSAL (each 0–10) — a status may shift them temporarily while it holds (an emotional wound she carries until amends are made, an enchantment of the heart, a draught that stirs or stills the blood); the shift reverses when the effect ends, unlike adjust_affection/adjust_arousal which move the real score. CAPS: any mod may be {"stat":...,"cap":N} INSTEAD of an amount — the stat cannot rise above N while the effect is active, however it is pushed. Caps fit effects that deaden, exhaust, or seal a capacity rather than subtract from it; they work on arousal, stamina, and affection.
GRANTED BOONS (watch the scene): if an NPC OFFERED to grant power/strength/a blessing (naming a stat) in the RECENT SCENE and the player's action ACCEPTS it — kneeling to receive it, drinking a potion she handed over, submitting to a laying-on-of-hands — you MUST emit an add_status for that boon on the player, even though the granting WORDS came from the NPC. The player's acceptance is the trigger. Pick the stat from the offer; magnitude fits its power (a dragon's blessing of Ruggedness → +3 to +5). Do NOT let these slip through as pure talk.
IMPOSED STATES (watch the scene): if an action LEAVES a character in a lasting imposed state — physically restrained so she cannot move freely, prevented from speaking, compelled or entranced, placed under a promise or obligation, or anything else DONE TO her that persists past this message — you MUST emit add_status for it (alongside any check or talk in the same intent), EVEN IF the imposition is playful, consensual, or completely mundane: ropes need no magic to count. The status is how the game REMEMBERS her state — without it she is inexplicably free again next turn. mods may be [] (state the constraint bluntly in desc) and the end_condition is whatever would release her. If the state stops her from taking herself elsewhere, add "immobilizes":true — the engine then pins her in place (her daily routine stops walking her around) until it ends. Emit remove_status the moment the story releases her. A promise, vow, or obligation an NPC HERSELF takes on (once she actually agrees in the scene — pure talk counts) is HER imposed state: add_status on HER, kind "vow", mods [], desc stating what she pledged, end_condition when it is fulfilled or released. (add_objective is ONLY for tasks the PLAYER takes on — never for hers.) Likewise a genuine BETRAYAL or cruelty she suffers at the player's hands — robbing her, humiliating her, breaking a promise, wrecking what she cares for IN FRONT OF HER — wounds her heart: add_status on her with a temporary negative affection mod (scale it to the wound), ending only when he truly makes it up to her. If the betraying act rides a check she WITNESSES, the attempt itself is the betrayal — the SAME wound status goes in BOTH effects_on_success AND effects_on_failure (being caught trying cuts as deep as succeeding). Worked example — snatching her purse in front of her: check craftiness for the grab; effects_on_success [adjust_gold, add_status wound on her]; effects_on_failure [add_status THE SAME wound on her] — whatever the dice say, she watched him try.

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
KNOWN PLACES (any is a valid move destination — the engine routes there automatically): ${knownPlacesForAnalyzer()} (adjacent right now: ${exitsContextForAnalyzer()})
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
                case 'whereabouts': pendingWhereaboutsNote = buildWhereaboutsNote(); break;
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
                case 'adjust_arousal': { const rel = getRelationship(eff.npc); setNpcArousalRaw(eff.npc, (rel.arousal ?? 0) + (eff.amount || 0)); if (eff.amount) sendGhostMessage(`${eff.npc}: 🔥 arousal ${eff.amount > 0 ? '+' : ''}${eff.amount} → ${getNpcArousal(eff.npc)}/10 (${arousalTier(getNpcArousal(eff.npc)).label})`); savePlayer(); break; }
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
    // === Location secrecy (world-management §3.4) ===
    // 0 = public (NPCs know it, on menus) · 1 = unknown to NPCs (still on the
    // player's menus) · 2 = hidden (off menus AND out of NPC context). The
    // CUSTODIAN always knows every location — it is a silent arbiter, so
    // secrets in its context cannot leak; secrecy applies only at the leaky
    // surfaces (NPC/GM projections and player-facing menus).
    function locSecret(id) { return Number(currentGameState.worldData?.locations?.[id]?.secret) || 0; }
    // Connections shown on player-facing menus (Move popup, /move enum, look exits).
    function visibleConnections(fromId) {
        const loc = currentGameState.worldData?.locations?.[fromId];
        return (loc?.connections || []).filter(c => locSecret(c) < 2);
    }
    function knownPlacesForAnalyzer() {
        return Object.entries(currentGameState.worldData?.locations || {}).map(([id, l]) => {
            const s = Number(l.secret) || 0;
            const tag = s >= 2 ? " (secret: unknown to NPCs, not on the player's menus)" : s === 1 ? " (NPCs don't know of it)" : '';
            return `"${l.name || id}"${tag}`;
        }).join(', ');
    }

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

    /** Fuzzy place-name resolution shared by walking and teleportation. */
    function resolveLocationId(dest) {
        const world = currentGameState.worldData;
        const want = String(dest || '').toLowerCase().trim();
        if (!want) return null;
        let targetId = Object.keys(world.locations).find(id => {
            const names = [world.locations[id]?.name || id, ...(world.locations[id]?.alternate_names || [])];
            return id.toLowerCase() === want || names.some(n => {
                const nm = String(n).toLowerCase();
                return nm === want || nm.includes(want) || want.includes(nm);
            });
        });
        // Substring missed? Token-overlap fallback: "the secret tunnel" shares
        // no substring with "Hidden Tunnel" (synonym descriptors), but the noun
        // does. Pick the UNIQUE best-scoring place; ties or zero stay unmatched.
        if (!targetId) {
            const stop = new Set(['the', 'a', 'an', 'of', 'to', 'at', 'in']);
            const toks = (s) => String(s).toLowerCase().split(/[^a-z0-9]+/).filter(t => t && !stop.has(t));
            const wantT = toks(want);
            if (wantT.length) {
                let best = null, bestScore = 0, tied = false;
                for (const id of Object.keys(world.locations)) {
                    const names = [world.locations[id]?.name || id, ...(world.locations[id]?.alternate_names || [])];
                    const score = Math.max(...names.map(n => {
                        const nt = new Set(toks(n));
                        return wantT.filter(t => nt.has(t)).length;
                    }));
                    if (score > bestScore) { best = id; bestScore = score; tied = false; }
                    else if (score === bestScore && score > 0 && id !== best) tied = true;
                }
                if (best && bestScore > 0 && !tied) targetId = best;
            }
        }
        return targetId || null;
    }

    /** Arrival machinery shared by every way of changing location: state,
     *  persona world_state, background, presence, notice, save. */
    async function arriveAt(targetId, notice) {
        currentGameState.currentLocation = targetId;
        const rpgData = getCurrentRPGData();
        if (rpgData) {
            updateCurrentRPGData({
                world_state: {
                    current_location: targetId,
                    visited_locations: [...(rpgData.world_state.visited_locations || []), targetId].filter((v, i, a) => a.indexOf(v) === i),
                },
            });
        }
        await setBackground(currentGameState.worldData.locations[targetId]?.background);
        await syncPresence();
        sendGameMasterMessage(notice);
        saveCurrentState();
    }

    /** Story-driven translocation: a spell, portal, or entity moves the party
     *  INSTANTLY — no route, no adjacency, valid to node-isolated places
     *  (pocket dimensions). Party members ride along by presence rules. */
    async function doEventTeleport(dest) {
        const world = currentGameState.worldData;
        const targetId = resolveLocationId(dest);
        if (!targetId) {
            travelIssueNote = `IMPORTANT: the story tried to transport the player to "${dest}", but no such place is known here. The party REMAINS AT ${locName(currentGameState.currentLocation)} — the magic fizzles, the way does not open; do NOT narrate them arriving anywhere new.`;
            sendGhostMessage(`🚫 No place called "${dest}" to be spirited away to.`);
            return false;
        }
        if (targetId === currentGameState.currentLocation) return false;
        await arriveAt(targetId, `🌀 **You are spirited away to: ${world.locations[targetId]?.name || targetId}**${presenceLine(targetId)}`);
        return true;
    }

    async function doNlMove(dest) {
        const world = currentGameState.worldData;
        const targetId = resolveLocationId(dest);
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
        const SELF_NARRATING = new Set(['birth', 'orgasm', 'damage', 'heal', 'restore_mana', 'adjust_affection', 'adjust_arousal', 'apply_curse', 'lift_curse', 'add_status', 'add_objective', 'remove_status', 'adjust_stat', 'equip_item', 'unequip_item', 'whereabouts']);
        return (effects || []).filter(e => !SELF_NARRATING.has(e.type)).map(e => {
            if (e.type === 'add_item') return `+${e.name}`;
            if (e.type === 'remove_item') return `-${e.name}`;
            if (e.type === 'adjust_gold') return `${e.amount >= 0 ? '+' : ''}${e.amount}g`;
            if (e.type === 'adjust_affection') return `${e.npc} affection ${e.amount >= 0 ? '+' : ''}${e.amount}`;
            return e.type;
        }).join(', ');
    }

    async function narrateResult(playerText, intent, check) {
        const sys = `You are the GAME MASTER narrator of a fantasy RPG. In 1-2 vivid sentences, narrate the RESULT of the player's action from the mechanical outcome given. Keep it grounded in WHERE the scene is happening (the stated location) — do not drift the action to another place. Narrate only the world and the player's action/outcome. You NEVER give a named NPC dialogue, expressions, gestures, reactions, or movements — not one spoken word, not a frozen smirk, not a turn away. Each NPC responds for HERSELF after you; your narration must END before any NPC reacts, covering only the player's side and the ambient scene. If you need to reason first, do it inside <think></think> tags; the narration itself is pure prose. Be concise.`;
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
        // Whereabouts knowledge, when the Custodian judged the ask warrants it
        const whereNote = pendingWhereaboutsNote; pendingWhereaboutsNote = null;
        if (whereNote) context.setExtensionPrompt(WHEREABOUTS_PROMPT_KEY, whereNote, 1, 0);
        // In-play status lifecycle reaction (applied/lifted/worn-off since her
        // last reply) — one-shot, reunion-comment style
        const relForNote = getRelationship(npcName);
        const statusNote = renderStatusReactionNotes(relForNote);
        if (statusNote) {
            context.setExtensionPrompt(STATUSREACT_PROMPT_KEY, `[What ${npcName} is feeling right now — weave a genuine reaction into her reply:] ${statusNote}`, 1, 0);
            relForNote.statusReactionNotes = null;
            relForNote.statusReactionNote = null;
        }
        const preReplyLen = (getCtx().chat || []).length;
        try {
            await context.executeSlashCommandsWithOptions(`/trigger await=true ${npcName}`, { source: 'rpg-custodian' });
        } catch (e) { console.error('RPG Custodian: trigger NPC failed', e); }
        finally {
            if (reunion) context.setExtensionPrompt(REUNION_PROMPT_KEY, '', 1, 0);     // one-shot: clear after this reply
            if (charmNote) context.setExtensionPrompt(CHARM_PROMPT_KEY, '', 1, 0);
            if (whereNote) context.setExtensionPrompt(WHEREABOUTS_PROMPT_KEY, '', 1, 0);
            if (statusNote) context.setExtensionPrompt(STATUSREACT_PROMPT_KEY, '', 1, 0);
            noteSeen(npcName);                                                         // she has now seen him this moment
            savePlayer();
        }
        // Her reply is on the page — read it against her bands (reaction judge).
        // Stamp the index so the out-of-band handler can't judge it twice.
        getRelationship(npcName).lastJudgedMesId = preReplyLen;
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
        pendingWhereaboutsNote = null;                 // ditto for whereabouts knowledge
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
                const ASYNC_TYPES = ['move', 'event_teleport', 'add_party', 'remove_party', 'advance_time', 'rest', 'examine'];
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
                        case 'event_teleport': moved = await doEventTeleport(e.destination) || moved; break;
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
                // A charm exchange with an NPC who is about to reply is HER
                // scene: the check line + interpretation note + her own reply
                // carry the outcome. GM narration here was speaking her
                // reactions for her (voice-stealing) — skip it entirely.
                const charmExchange = intent?.check?.stat === 'charm' && detectAddressedNpcs(playerText).length > 0;
                if (!pureMove && !pureExamine && !charmExchange) {
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

    // Vanilla SillyTavern can make a character speak WITHOUT a player message:
    // the ▶ continue button, swipe arrows, and send-with-empty-field all
    // generate straight from ST, bypassing orchestration entirely. The scene
    // context still reaches them (extension prompts are global and persist),
    // but the POST-reply systems used to be skipped — so a reply produced that
    // way never moved affection and never marked her as having seen the player,
    // which later mis-fired the reunion note. Catch those replies here.
    //
    // Judged strictly once per chat index (monotonic): a swipe re-rolls the
    // SAME index, so re-rolling can never farm affection, while a genuinely new
    // utterance always lands.
    async function onNpcMessageLanded(mesId) {
        try {
            if (!currentGameState.isActive) return;
            if (currentGameState.rpgOrchestrating) return;       // our own path already handles these
            if (getCtx().groupId !== currentGameState.groupId) return;
            const chat = getCtx().chat || [];
            const idx = typeof mesId === 'number' ? mesId : chat.length - 1;
            const msg = chat[idx];
            if (!msg || msg.is_user || msg.is_system) return;
            const name = msg.name;
            if (!name || name === 'Game Master') return;
            if (!(currentGameState.npcRoster || []).some(n => n.name === name)) return;

            const rel = getRelationship(name);
            if ((rel.lastJudgedMesId ?? -1) >= idx) return;      // swipe/continue of an already-judged line
            rel.lastJudgedMesId = idx;
            noteSeen(name);                                      // she HAS just spoken with him
            savePlayer();
            await judgeNpcReaction(name, idx);
        } catch (e) {
            console.error('RPG Custodian: out-of-band reply handling failed', e);
        }
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
        weekday: (day) => weekdayName(day),
        cycle: (n, day) => ({ step: cycleStep(n, day), ...MOON_CYCLE[cycleStep(n, day)], fert: fertilityPercent(n) }),
        gold: () => getGold(),
        effectiveStat: (s) => effectiveStat(s),
        createCharacter: () => createRPGCharacterCommand(),
        newGame: (w) => newGame(w),
        continueGame: (w) => continueGame(w),
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
        statusNote: (n) => renderStatusReactionNotes(getRelationship(n)),
        eventTeleport: (d) => doEventTeleport(d),
        addParty: (n) => addToParty(n),
        adoptCast: (worldId, charName) => {   // headless adoption (no form UI): castData + rpg block, world-ready
            const world = authoredWorlds()[worldId]; const char = getCtx().characters.find(c => c.name === charName);
            if (!world || !char) return null;
            const cd = cardFromLiveChar(char);
            cd.extensions.rpg_custodian = { ...(cd.extensions.rpg_custodian || {}), source_avatar: char.avatar, role: 'villager', home_location: world.startingLocation, card_version: '1.1' };
            world.castData = world.castData || {}; world.castData[charName] = cd;
            if (!(world.cast || []).includes(charName)) world.cast = [...(world.cast || []), charName];
            context.saveSettingsDebounced(); return cd.extensions.rpg_custodian;
        },
        checkConditions: () => checkPendingConditions(),
        appraise: (item) => appraiseItem(item),
        equipped: () => equippedItemsSummary(),
        items: () => (getPlayerRpgData()?.inventory.items || []).map(i => ({ name: i.name, equipped: !!i.equipped, effect: i.effectText, usage: i.usage, mod: i.mod })),
        curseWithBreak: (target, cond) => applyCrystalCurse(target || 'player', null, cond),
        giveItem: (name) => addItem({ id: `${String(name).toLowerCase().replace(/\s+/g, '-')}-${Date.now()}`, name, desc: '' }),
        useItemNamed: (name) => useItemByName(name),
        conceptionKind: (n) => resolveConceptionKind(n),
        pregBand: (n, person) => pregnancyBand(n, person || 'third'),
        castForm: (w, n) => openCastForm(w, n, { quick: true }),
        lorebook: async () => await loadWorldInfo(RPG_LOREBOOK_NAME),
        gmWorld: () => (context.characters || []).find(c => c.avatar === 'Game Master.png')?.data?.extensions?.world,
        offspring: () => currentGameState.offspring || [],
        setPreg: (n, count, pct, kind) => { const r = getRelationship(n); r.pregnancies = count; r.pregnancy_progress = pct; if (kind) r.conceptionKind = kind; savePlayer(); return r; },
        tokens: () => getPlayerRpgData()?.stats.power_tokens,
        statusText: () => { projectPlayerStatus(); const ep = getCtx().extensionPrompts || context.extensionPrompts || {}; return ep[STATUS_PROMPT_KEY]?.value || '(none)'; },
        sceneText: () => { projectPlayerStatus(); const ep = getCtx().extensionPrompts || context.extensionPrompts || {}; const e = ep[SCENE_PROMPT_KEY]; return e ? { value: e.value, position: e.position, depth: e.depth, role: e.role } : '(none)'; },
        hurt: (target, amt) => (target && target !== 'player') ? spendNpcStamina(target, amt || 1) : spendStamina(amt || 1),
        examineSelf: () => examineSelf(),
        examineNpc: (n) => examineNpc(n),
        setAffection: (n, v) => { const r = getRelationship(n); r.affection = Math.max(0, Math.min(10, v)); savePlayer(); return r.affection; },
        setArousal: (n, v) => { const a = setNpcArousalRaw(n, v); savePlayer(); return a; },
        npcEff: (n) => ({ aff: getNpcAffection(n), aro: getNpcArousal(n), staMax: npcMaxStamina(n), sta: getRelationship(n).npcStamina }),
        analyzerNpcs: () => presentNpcContextForAnalyzer(),
        judgeReaction: (n, preLen) => judgeNpcReaction(n, preLen ?? Math.max(0, (getCtx().chat || []).length - 1)),
        spendNpcStamina: (n, amt) => spendNpcStamina(n, amt || 1),
        nlMove: (d) => doNlMove(d),
        refreshWorlds: () => loadRegisteredWorlds(),
        makeLorebook: async (name) => { await saveWorldInfo(name, { entries: { 0: { uid: 0, key: ['test'], keysecondary: [], comment: 'test-entry', content: 'Test lore content.', constant: false, selective: true, order: 100, position: 0, disable: false } } }, true); await updateWorldInfoList(); return name; },
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