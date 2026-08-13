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

        // Witness filtering — an NPC is only ever prompted with what she saw.
        initWitnessFiltering();

        // On page load / chat switch, ST scrolls the chat to the bottom before
        // all late content has landed (avatars, images, a long RPG history) —
        // the height then keeps growing and the viewport is stranded far from
        // the end, so every reload needed a hand-scroll. Pin the chat to the
        // bottom until its height stops changing; the user touching the chat
        // cancels the pin instantly.
        pinChatToBottom();
        if (context.eventTypes.CHAT_CHANGED) {
            context.eventSource.on(context.eventTypes.CHAT_CHANGED, () => { pinChatToBottom(); setTimeout(tintAdversarialMessages, 800); });
        }

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
     * Keep the chat pinned to its bottom while late-loading content is still
     * growing it (page load, chat switch). Any user interaction with the chat
     * — wheel, touch, grabbing the scrollbar — cancels the pin immediately, so
     * it can never fight a deliberate scroll-up.
     */
    function pinChatToBottom(durationMs = 5000) {
        const chat = document.getElementById('chat');
        if (!chat) return;
        let cancelled = false;
        const cancel = () => { cancelled = true; };
        for (const ev of ['wheel', 'touchstart', 'pointerdown']) {
            chat.addEventListener(ev, cancel, { once: true, passive: true });
        }
        const t0 = Date.now();
        let lastH = -1;
        const tick = () => {
            if (cancelled) return;
            const h = chat.scrollHeight;
            if (h !== lastH) { lastH = h; chat.scrollTop = h; }
            if (Date.now() - t0 < durationMs) setTimeout(tick, 150);
        };
        tick();
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
                    <div id="pe-presets"></div>
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
                    projectPlayerStatus();
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
                    renderInv();
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
            projectPlayerStatus();
            $('#rpg-player-overlay').remove();
            wmToast('Character updated.', 'success');
        });
        $('#pe-presets').append(presetChipRow('player', (nm) => {
            wmToast(`${nm}.`, 'success');
            renderEffects();
        }));
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
     *  target: 'player' or an NPC name. A request that names one of the
     *  PREMADE statuses resolves to the preset instead of a reinvention. */
    async function forgeBespokeStatus(text, target = 'player') {
        const forNpc = target && target !== 'player';
        const presetList = Object.entries(PRESET_STATUSES)
            .map(([k, p]) => `"${k}" (${p.name} — ${p.desc})`).join('; ');
        const sys = `You are the RPG CUSTODIAN. Design a bespoke applied effect from a plain-language request. Output ONLY JSON:
{"name":"short evocative name","kind":"buff|debuff|blessing|curse|pact|vow|disease|poison|status","polarity":"positive"|"negative","desc":"one line of what it does","mods":[{"stat":"ruggedness|charm|craftiness|virility|stamina${forNpc ? '|fertility' : ''}","amount":N}],"duration":N,"end_condition":"plain-English story event that ends it, or omit","expires_on_check":"a stat name for a ONE-USE pre-buff spent on the next trial of that stat, or omit"}
PREMADE STATUSES: if the request asks for one of these by name or unmistakable description, output ONLY {"preset":"<key>"} instead of designing anything: ${presetList}; "crystal_curse" (Crystal Curse — every child the bearer conceives or sires is born an inert soulgem until the curse is lifted).
Rules: core stats run ~1-10, so mods are SMALL integers ±1..±3 (±5 only for potent magic).${forNpc ? ' FERTILITY is a percentage (0-100), so fertility mods are +10..+30.' : ''} duration is in time periods (4 per day) — always give lingering NEGATIVE effects a duration backstop even when they have an end_condition. Honor the SPIRIT of the request: a one-use "before my next fight" boost gets expires_on_check; a curse gets an end_condition worth roleplaying toward. Invent flavor freely; never refuse.`;
        const prompt = forNpc
            ? `The effect is applied to the NPC ${target}. Request: "${text}"`
            : `Player's request: "${text}"\nPlayer right now: ${statsContextForAnalyzer()}`;
        const p = await generateJson({ prompt, systemPrompt: sys, budget: 300 });
        if (!p) return null;
        if (p.preset) {
            const key = String(p.preset).toLowerCase().replace(/[\s-]+/g, '_');
            if (key === 'crystal_curse') {
                applyCrystalCurse(target);
                return { name: 'Crystal Curse', kind: 'curse', mods: [] };
            }
            if (PRESET_STATUSES[key]) return addCustomStatus(target, { preset: key }, true);
            return null;
        }
        if (!p.name) return null;
        return addCustomStatus(target, p, true);   // quiet: the editors are meta, not story
    }

    /** One-tap premade statuses for the effect requesters — no LLM round-trip.
     *  Chips are filtered by which side a preset makes sense on; the Crystal
     *  Curse chip toggles (apply ⇄ lift) since it lives outside customEffects. */
    function presetChipRow(target, onApplied) {
        const forNpc = target && target !== 'player';
        const row = $('<div class="pe-preset-row"></div>');
        row.append('<span class="pe-preset-title">Premade:</span>');
        for (const [key, p] of Object.entries(PRESET_STATUSES)) {
            if (p.side && p.side !== (forNpc ? 'npc' : 'player')) continue;
            const b = $('<button type="button" class="rpg-map-btn"></button>').text(p.name);
            b.on('click', (e) => {
                e.stopPropagation();
                addCustomStatus(target, { preset: key }, true);
                projectPlayerStatus();
                onApplied(p.name);
            });
            row.append(b);
        }
        const cc = $('<button type="button" class="rpg-map-btn"></button>').text('💠 Crystal Curse');
        cc.on('click', (e) => {
            e.stopPropagation();
            if (isCrystalCursed(target)) { liftCrystalCurse(target); onApplied('Crystal Curse lifted'); }
            else { applyCrystalCurse(target); onApplied('Crystal Curse'); }
            projectPlayerStatus();
        });
        row.append(cc);
        // What each premade does — reference text built from the same records
        // the chips apply, so it can never drift from the truth.
        const ref = $('<div class="pe-preset-ref"></div>');
        for (const [, p] of Object.entries(PRESET_STATUSES)) {
            if (p.side && p.side !== (forNpc ? 'npc' : 'player')) continue;
            const ends = p.endCondition ? `ends: ${p.endCondition}` : p.duration ? `lasts ${p.duration} time period${p.duration > 1 ? 's' : ''}` : 'permanent';
            const line = $('<div class="pe-preset-ref-row"></div>');
            line.append($('<b></b>').text(p.name), document.createTextNode(`${statusModString(p.mods)} — ${p.desc} (${ends})`));
            ref.append(line);
        }
        {
            const line = $('<div class="pe-preset-ref-row"></div>');
            line.append($('<b></b>').text('💠 Crystal Curse'), document.createTextNode(' — every child the bearer conceives or sires is born an inert soulgem (until lifted by magic; the chip toggles it)'));
            ref.append(line);
        }
        return row.add(ref);
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
                    <div id="ne-presets"></div>
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
        $('#ne-presets').append(presetChipRow(name, (nm) => {
            wmToast(`${nm} — ${name}.`, 'success');
            renderFx();
        }));
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
                    <label>Nicknames — comma separated, what she also answers to <input id="cf-nick" type="text" placeholder="Ari, Sis, kitten"></label>
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
                    <button type="button" id="cf-weekly" class="rpg-toggle" title="For cast with a job or a school week. Dragons and hermits keep the simple daily routine above.">📅 Day-specific weekly timetable: <b>No</b></button>
                    <div id="cf-week" class="cf-week" style="display:none">
                        <div class="cf-week-hint">Overrides the daily routine above, per weekday. The note (max 30 chars) is what she'll say she was doing — <i>"folding laundry"</i>, <i>minding the counter</i>.</div>
                        ${WEEKDAYS.map(d => `<details class="cf-day"><summary>${d}</summary>
                            ${periods.map(p => `<div class="cf-wrow">
                                <span class="cf-wp">${p}</span>
                                <select class="cf-wloc" data-d="${d}" data-p="${p}">${locOptions}</select>
                                <input class="cf-wnote" data-d="${d}" data-p="${p}" type="text" maxlength="30" placeholder="doing what? (optional)">
                            </div>`).join('')}
                            <button type="button" class="cf-copyday rpg-map-btn" data-d="${d}">⧉ copy this day to the whole week</button>
                        </details>`).join('')}
                    </div>
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
        $('#cf-nick').val((rc.nicknames || []).join(', '));
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
        // Changing Home no longer rewrites the whole schedule (it used to wipe
        // a carefully authored routine on a single tap). Home seeds the slots
        // only when they have nothing of their own, above.

        // Weekly timetable: hidden accordion, one <details> per weekday.
        const wk = rc.schedule_weekly || {};
        for (const d of WEEKDAYS) for (const p of periods) {
            const slot = wk[d]?.[p] || {};
            const loc = slot.loc && world.locations[slot.loc] ? slot.loc : (rc.schedule?.[p] && world.locations[rc.schedule[p]] ? rc.schedule[p] : $('#cf-home').val());
            $(`.cf-wloc[data-d="${d}"][data-p="${p}"]`).val(loc);
            $(`.cf-wnote[data-d="${d}"][data-p="${p}"]`).val(slot.note || '');
        }
        setToggle($('#cf-weekly'), !!rc.weekly_enabled);
        $('#cf-week').toggle(!!rc.weekly_enabled);
        $('#cf-weekly').on('click', function (e) {
            e.stopPropagation();
            setToggle($(this), !getToggle($(this)));
            $('#cf-week').toggle(getToggle($(this)));
        });
        // Authoring 28 slots by hand is miserable; this is an explicit opt-in
        // copy (unlike the Home behavior removed above, it never fires on its own).
        $('.cf-copyday').on('click', function (e) {
            e.stopPropagation();
            const from = $(this).data('d');
            for (const p of periods) {
                const loc = $(`.cf-wloc[data-d="${from}"][data-p="${p}"]`).val();
                const note = $(`.cf-wnote[data-d="${from}"][data-p="${p}"]`).val();
                for (const d of WEEKDAYS) {
                    if (d === from) continue;
                    $(`.cf-wloc[data-d="${d}"][data-p="${p}"]`).val(loc);
                    $(`.cf-wnote[data-d="${d}"][data-p="${p}"]`).val(note);
                }
            }
            wmToast(`${from}'s timetable copied to every day.`, 'success');
        });
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
                nicknames: String($('#cf-nick').val() || '').split(',').map(x => x.trim()).filter(Boolean),
                race: String($('#cf-race').val() || '').trim(),
                age: String($('#cf-age').val() || '').trim(),
                fertility: Math.max(-40, Math.min(100, Number($('#cf-fert').val()) || 0)),
                ruggedness: Math.max(1, Math.min(10, Number($('#cf-rug').val()) || 2)),
                womb_type: ['live', 'egg', 'crystal'].includes($('#cf-womb').val()) ? $('#cf-womb').val() : undefined,
                home_location: $('#cf-home').val(),
                schedule,
                secret: getToggle($('#cf-secret')) || undefined,
                weekly_enabled: getToggle($('#cf-weekly')) || undefined,
                schedule_weekly: getToggle($('#cf-weekly')) ? (() => {
                    const wkOut = {};
                    for (const d of WEEKDAYS) {
                        wkOut[d] = {};
                        for (const p of periods) {
                            wkOut[d][p] = {
                                loc: $(`.cf-wloc[data-d="${d}"][data-p="${p}"]`).val(),
                                note: String($(`.cf-wnote[data-d="${d}"][data-p="${p}"]`).val() || '').trim().slice(0, 30) || undefined,
                            };
                        }
                    }
                    return wkOut;
                })() : undefined,
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
                        Object.assign(npc, { role: rc2.role, nicknames: rc2.nicknames || [], race: rc2.race, age: rc2.age, fertility: rc2.fertility, ruggedness: rc2.ruggedness, secret: !!rc2.secret, homeLocation: rc2.home_location, schedule: rc2.schedule, baseStats: rc2.base_stats, wombType: rc2.womb_type || null, weeklyEnabled: !!rc2.weekly_enabled, weeklySchedule: rc2.schedule_weekly || null });
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
            syncPresence(); projectPlayerStatus();
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
                <button type="button" id="mp-notes" class="rpg-toggle">📝 Area notes: <b>${(loc.areaNotes || []).length}</b></button>
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
        // Not a toggle despite the class (borrowed for looks): opens the notes
        // manager over the editor. The count refreshes when the panel reopens.
        $('#mp-notes').off('click').on('click', (e) => {
            e.stopPropagation();
            openAreaNotesManager(editorNotesAdapter(mapEd.world, id));
        });
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

        // ONE flat menu. In play: the every-turn game verbs first (this replaced
        // the old bottom action bar, which ate chat space), then time, then the
        // rare session/meta actions. Out of play: just the session actions.
        if (currentGameState.isActive) {
            items.push({ icon: '🚶', label: 'Move', action: () => openTravelPopup() });
            items.push({ icon: '👀', label: 'Look', action: () => openLookPopup() });
            items.push({ icon: '🎯', label: `Action Mode${currentGameState.armedAction ? ` (armed: ${currentGameState.armedAction.label})` : ''}`, action: () => openActionModeMenu() });
            {
                const nFx = playerStatusesOnly().length + (isCrystalCursed('player') ? 1 : 0);
                const nQ = playerObjectives().length;
                const counts = [getGold() ? `${getGold()}g` : '', nQ ? `${nQ} quest${nQ > 1 ? 's' : ''}` : '', nFx ? `${nFx} fx` : ''].filter(Boolean).join(' · ');
                items.push({ icon: '🎒', label: `Items & Statuses${counts ? ` (${counts})` : ''}`, action: () => openInventory() });
            }
            if ((currentGameState.party || []).length || partyJoinable().length) {
                const n = (currentGameState.party || []).length;
                items.push({ icon: '🧑‍🤝‍🧑', label: `Party${n ? ` (${n})` : ''}`, action: () => openPartyPopup() });
            }
            {
                const nNotes = areaNotesAt(currentGameState.currentLocation).length;
                items.push({ icon: '📝', label: `Area Notes${nNotes ? ` (${nNotes})` : ''}`, action: () => openAreaNotesManager(sessionNotesAdapter()) });
            }
            // Offered after a rest, and only while you are still where you rested.
            if (currentGameState.levelUpAt && currentGameState.levelUpAt === currentGameState.currentLocation) {
                items.push({ icon: '⭐', label: `Level Up (${getPlayerRpgData()?.stats?.experience || 0} XP)`, action: () => openLevelUp() });
            }
            items.push({ sep: true });
            items.push({ icon: '⏰', label: 'Wait (advance time)', action: () => waitCommand({}, '') });
            if (canRewindTime()) {
                const prev = (currentGameState.timeUndo || [])[currentGameState.timeUndo.length - 1];
                const back = prev ? `${TIME_PERIODS[prev.time].emoji} ${TIME_PERIODS[prev.time].name}, Day ${prev.day}` : 'one step';
                items.push({ icon: '⏪', label: 'Go back a time step', sub: `back to ${back}`, action: () => rewindTimeStep() });
            }
            items.push({ sep: true });
            items.push({ icon: '📖', label: 'Verb Dictionary', sub: 'everything that can happen — reference, not buttons', action: () => openVerbDictionary() });
            items.push({ icon: '🌍', label: 'Worlds (play, create, manage)', action: () => openWorldManager() });
            items.push({ icon: '🧬', label: 'Edit Character', action: () => openPlayerEditor() });
            items.push({ icon: '🚪', label: 'Exit RPG Mode', action: () => rpgExitCommand({}, '') });
        } else {
            if (save) {
                items.push({ icon: '▶️', label: `Continue (${save.world}, Day ${save.day ?? 1} — ${saveWeekdayName(save)})`, action: continueGame });
            }
            // New games start from the Worlds manager (world → 🎲 New Game).
            items.push({ icon: '🌍', label: 'Worlds (play, create, manage)', action: () => openWorldManager() });
            items.push({ icon: '✨', label: 'Create Character', action: () => createRPGCharacterCommand() });
            items.push({ icon: '🧬', label: 'Edit Character', action: () => openPlayerEditor() });
        }

        const menu = $('<div id="rpg-menu-popup"></div>');
        if (currentGameState.isActive) {
            // The date/time readout lives here now (the old 📅 row's job) — a
            // glanceable header instead of a button that prints to chat.
            const t = TIME_PERIODS[currentGameState.currentTime];
            menu.append($('<div class="rpg-popup-title"></div>')
                .text(`${t.emoji} ${t.name} — Day ${currentGameState.dayCount} (${weekdayName()}) · ${locName(currentGameState.currentLocation)}`));
        }
        for (const item of items) {
            if (item.sep) { menu.append('<div class="rpg-menu-sep"></div>'); continue; }
            const row = $(`<div class="rpg-menu-item">${item.icon} ${item.label}` +
                (item.sub ? `<div class="rpg-item-sub">${$('<i>').text(item.sub).html()}</div>` : '') + `</div>`);
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
        currentGameState.areaNotes = save.areaNotes || {};
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
            areaNotes: currentGameState.areaNotes || {},
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
            $('#rpg-action-popup').remove();
            disarmAction();
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
                
                // Public notes only — this is a chat message every present NPC
                // can read back; secret notes live in the Area Notes manager.
                const noteTail = publicAreaNotesLine(currentGameState.currentLocation);
                sendGameMasterMessage(`👀 **${currentLocationData.name}**\n\n${currentLocationData.description}${noteTail ? `\n\n📝${noteTail}` : ''}${presenceLine(currentGameState.currentLocation)}${exitsList}`);
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
    // ── Rewinding the clock ────────────────────────────────────────────────
    // A time step is not just a number: it ages pregnancies, expires statuses
    // and curses, hatches eggs, wakes the unconscious and decays arousal. None
    // of that can be undone by subtracting one from the counter, so every step
    // snapshots the state it is about to change and the rewind restores it
    // wholesale. One snapshot per STEP — and a step is a QUARTER of a day
    // (Morning/Day/Evening/Night), so a long skip rewinds one period at a
    // time: the narrator ran ahead and you want part of the day back, not all
    // of it. The cap is 12 steps = three full days.
    const TIME_UNDO_MAX = 12;
    function snapshotTimeState() {
        const rd = getPlayerRpgData();
        if (!rd) return;
        currentGameState.timeUndo = currentGameState.timeUndo || [];
        try {
            currentGameState.timeUndo.push({
                time: currentGameState.currentTime,
                day: currentGameState.dayCount,
                step: currentGameState.timeStep || 0,
                party: [...(currentGameState.party || [])],
                offspring: structuredClone(currentGameState.offspring || []),
                rd: structuredClone(rd),
            });
            while (currentGameState.timeUndo.length > TIME_UNDO_MAX) currentGameState.timeUndo.shift();
        } catch (e) { console.warn('RPG Custodian: could not snapshot the clock', e); }
    }
    function canRewindTime() { return !!(currentGameState.timeUndo || []).length; }
    async function rewindTimeStep() {
        const stack = currentGameState.timeUndo || [];
        const snap = stack.pop();
        if (!snap) { sendGhostMessage('⏪ Nothing to rewind — no time has passed yet this session.'); return; }
        currentGameState.currentTime = snap.time;
        currentGameState.dayCount = snap.day;
        currentGameState.timeStep = snap.step;
        currentGameState.party = snap.party;
        currentGameState.offspring = snap.offspring;
        // Restore the persona's rpg_data IN PLACE so every held reference stays valid
        const rd = getPlayerRpgData();
        if (rd) {
            for (const k of Object.keys(rd)) delete rd[k];
            Object.assign(rd, structuredClone(snap.rd));
        }
        savePlayer(); saveCurrentState();
        await syncPresence();
        projectPlayerStatus(); updateTimeDisplay();
        const t = TIME_PERIODS[currentGameState.currentTime];
        sendGameMasterMessage(`⏪ **The clock steps back** — it is ${t.emoji} **${t.name}** again, ${weekdayName()}, Day ${currentGameState.dayCount}.` +
            `${presenceLine(currentGameState.currentLocation)}\n\n_(Everything that period changed — schedules, conditions, pregnancies — is as it was. The story already told stands; you are simply not as late as you thought.)_`);
    }

    function advanceTime(quiet = false) {
        if (!currentGameState.isActive) {
            console.warn('RPG Custodian: Cannot advance time - no active game session');
            return null;
        }

        snapshotTimeState();   // before anything this period will change

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
        plugRefertilize(quiet);      // sealed-in seed gets another go at her womb
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

    function sendGhostMessage(text, opts = {}) {
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
        if (opts.adversarial) message.extra.rpg_adversarial = true;   // contested-roll readouts get a red tint
        stampPresence(message);
        const ctx = getCtx();
        ctx.chat.push(message);
        ctx.addOneMessage(message);
        if (opts.adversarial) tintAdversarialMessages();
    }
    // Adversarial contest readouts (cervix_press, milk_attempt, …) carry a
    // faint red tint. The CSS class dies with every chat rerender, so it is
    // re-stamped from the message's extra flag on add and on CHAT_CHANGED.
    function tintAdversarialMessages() {
        const chat = getCtx().chat || [];
        document.querySelectorAll('#chat .mes').forEach(el => {
            const i = Number(el.getAttribute('mesid'));
            if (chat[i]?.extra?.rpg_adversarial) el.classList.add('rpg-adversarial');
        });
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
            const noteTail = location ? gmAreaNotesLine() : '';
            const flavorPrompt = `Describe the scene: ${scenario}${locationContext}.${noteTail} Provide atmospheric flavor text for this moment.`;
            
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
            currentGameState.areaNotes = {};   // session notes; authored ones ride the world data
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
                    nicknames: rpgMeta.nicknames || [],      // what she also answers to
                    wombType: rpgMeta.womb_type || null,     // authored offspring kind (beats race inference)
                    weeklyEnabled: !!rpgMeta.weekly_enabled,          // day-specific routine (job/school)
                    weeklySchedule: rpgMeta.schedule_weekly || null,  // {Weekday: {Period: {loc, note}}}
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
            // Just parted ways: escorting someone somewhere has to MEAN
            // something, so she stays where you brought her instead of snapping
            // back onto her routine the instant you let her go. The step stamp
            // expires this by itself the moment time moves on.
            if (isLingeringWhereParted(rel)) return locationId === rel.partedAt;
            return npcSlotFor(npc, currentGameState.dayCount, period).loc === locationId;
        });
    }
    function isInParty(name) { return (currentGameState.party || []).includes(name); }
    /**
     * Nobody here who could answer — so the GM is the only voice the scene has.
     * An unconscious woman does not count as company: she cannot speak, move or
     * react, and a room containing only her is, for narrative purposes, empty.
     */
    function aloneHere() {
        return getNpcsAt(currentGameState.currentLocation)
            .every(n => getRelationship(n.name).npcUnconscious);
    }

    // ── Schedules: the simple 4-slot day, and the optional weekly one ───────
    // Most cast keep one daily rhythm (a dragon in her grotto, a hermit in her
    // woods). Anyone with a job or a school week can instead declare a
    // 7-day × 4-slot table, each slot carrying a location AND a short note on
    // what she is doing there — so she can answer "I was just folding
    // laundry!" instead of merely being in the right room.
    // ONE resolver, so presence, travel, reunions and self-knowledge can never
    // disagree about where she is.
    function npcSlotFor(npc, day = currentGameState.dayCount, periodName = TIME_PERIODS[currentGameState.currentTime].name) {
        const fallback = npc?.schedule?.[periodName] ?? npc?.homeLocation ?? null;
        if (npc?.weeklyEnabled && npc.weeklySchedule) {
            const slot = npc.weeklySchedule[weekdayName(day)]?.[periodName];
            if (slot) return { loc: slot.loc || fallback, note: String(slot.note || '').trim() };
        }
        return { loc: fallback, note: '' };
    }
    function npcSlotByName(name, day, periodName) {
        const npc = (currentGameState.npcRoster || []).find(n => n.name === name);
        return npc ? npcSlotFor(npc, day, periodName) : { loc: null, note: '' };
    }
    // Where an NPC's schedule places her at the current time (her "own" spot).
    function scheduledLocationFor(name) {
        return npcSlotByName(name).loc;
    }
    /** The period AFTER this one, wrapping Night → next day's Morning. */
    function nextPeriod() {
        const idx = ((currentGameState.currentTime || 0) + 1) % TIME_PERIODS.length;
        return { idx, name: TIME_PERIODS[idx].name, day: (currentGameState.dayCount || 1) + (idx === 0 ? 1 : 0) };
    }
    /** Where her routine takes her NEXT. A companion you part with now lingers
     *  where you left her until time moves on, so "where can I find you?" has to
     *  be answered with her next slot — her current one is the room she is
     *  already standing in. */
    function nextScheduledLocationFor(name) {
        const n = nextPeriod();
        return npcSlotByName(name, n.day, n.name).loc;
    }
    /** She was let go here and time has not moved on yet. */
    function isLingeringWhereParted(rel) {
        return !!(rel?.partedAt && rel.partedStep === (currentGameState.timeStep || 0));
    }
    /** Absolute period index, so we can walk backwards through an absence. */
    function absPeriodNow() { return ((currentGameState.dayCount || 1) - 1) * 4 + (currentGameState.currentTime || 0); }
    function dayPeriodAt(abs) {
        const a = Math.max(0, abs);
        return { day: Math.floor(a / 4) + 1, periodName: TIME_PERIODS[a % 4].name };
    }
    /**
     * What she was doing while the player was away — walks her schedule across
     * the absence and collects the distinct activity notes, newest last, so the
     * reunion can say where she has actually been rather than "living her life".
     */
    function absencePursuits(npc, elapsedPeriods, max = 3) {
        if (!npc?.weeklyEnabled || !npc.weeklySchedule) return [];
        const now = absPeriodNow();
        const span = Math.min(Math.max(1, elapsedPeriods), 12);   // cap the walk
        const seen = [];
        for (let i = span; i >= 1; i--) {
            const { day, periodName } = dayPeriodAt(now - i);
            const slot = npcSlotFor(npc, day, periodName);
            if (!slot.note) continue;
            const phrase = `${slot.note} at ${locName(slot.loc)}`;
            if (seen[seen.length - 1] !== phrase && !seen.includes(phrase)) seen.push(phrase);
        }
        return seen.slice(-max);
    }

    // Decide which present NPC(s) the player is talking to, from their words —
    // reliable where the analyzer's single-guess target_npc is not (2+ present).
    const escRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    /**
     * Every way the player might name her. Cast cards carry full names —
     * "Evelina Celeste", "Florence the Formless" — but nobody types those in
     * conversation, and requiring the whole string meant addressing "Evelina"
     * matched NOBODY, so the turn had no target and the GM narrated instead of
     * her answering. Any distinctive part of her name counts, as long as no
     * other person in the room answers to it too.
     */
    /** Match a name with an optional plural/possessive tail — Arianna,
     *  Arianna's, Arianna\u2019s, Ariannas. "Arianna's" already matched (the
     *  apostrophe is a word boundary) but "Ariannas" did not. The proper-noun
     *  rule below is what keeps this from over-matching ordinary words. */
    function aliasPattern(alias) { return `${escRe(alias)}(?:['\u2019]s|s)?`; }
    function npcAliases(npc, present) {
        // Author-given nicknames come first: "Ari", "Sis" — whatever she is
        // actually called at the table, which no rule could infer from a card.
        const aliases = [npc.name, ...(npc.nicknames || [])];
        for (const part of String(npc.name).split(/\s+/)) {
            // Only proper-noun parts. "Florence the Formless" answers to
            // Florence and Formless, never to "the" — otherwise "I open the
            // door" would be addressing her.
            if (!/^[A-Z]/.test(part)) continue;
            if (part.length < 3) continue;                       // skip initials
            if (part.toLowerCase() === npc.name.toLowerCase()) continue;
            aliases.push(part);
        }
        // Drop anything another woman in the room also answers to — by name or
        // by her own nickname — so an ambiguous call targets nobody.
        return aliases.filter((a, i) => {
            if (!a || String(a).length < 2) return false;
            if (aliases.findIndex(x => String(x).toLowerCase() === String(a).toLowerCase()) !== i) return false;
            if (String(a).toLowerCase() === npc.name.toLowerCase()) return true;
            const re = new RegExp(`\\b${escRe(a)}\\b`, 'i');
            return !present.some(o => o.name !== npc.name && (
                re.test(o.name) || (o.nicknames || []).some(x => String(x).toLowerCase() === String(a).toLowerCase())
            ));
        });
    }
    /** Spoken name → the roster name, so "Evelina" finds "Evelina Celeste". */
    function resolveNpcName(spoken, pool = null) {
        const name = String(spoken || '').trim();
        if (!name) return null;
        const present = pool || getNpcsAt(currentGameState.currentLocation);
        const exact = present.find(n => n.name.toLowerCase() === name.toLowerCase());
        if (exact) return exact.name;
        const hit = present.find(n => npcAliases(n, present).some(a => a.toLowerCase() === name.toLowerCase()));
        return hit ? hit.name : null;
    }
    function detectAddressedNpcs(text) {
        const present = getNpcsAt(currentGameState.currentLocation);
        const t = String(text || '');
        const esc = escRe;
        // Order by WHERE each name falls in the sentence, not by roster order:
        // "Seline, then Wren, then Marta" must answer in that sequence, the way
        // vanilla group chats do. (A name at the very start naturally sorts
        // first, so direct address needs no special case.)
        const hits = [];
        for (const npc of present) {
            let at = -1;
            for (const alias of npcAliases(npc, present)) {
                const m = new RegExp(`\\b${aliasPattern(alias)}\\b`, 'i').exec(t);
                if (m && (at < 0 || m.index < at)) at = m.index;
            }
            if (at >= 0) hits.push({ name: npc.name, at });
        }
        if (hits.length) return hits.sort((a, b) => a.at - b.at).map(h => h.name);
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
        parts.push(`❤️ Stamina: ${getStamina()}/${maxStamina()}${rd.stats.unconscious ? ' — EXHAUSTED' : ''}${customStatMod('stamina') ? ` (${customStatMod('stamina') >= 0 ? '+' : ''}${customStatMod('stamina')})` : ''}   🔮 Mana: ${s.mana}/${effectiveStat('craftiness')}`);
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
            const relJoin = getRelationship(npcName);
            relJoin.partyJoinedStep = currentGameState.timeStep || 0;
            relJoin.partedAt = null; relJoin.partedStep = null;   // travelling again — no lingering pin
            savePlayer();
            sendGhostMessage(`🧑‍🤝‍🧑 **${npcName} joins you** — she'll travel at your side until you part ways.`);
        }
        saveCurrentState();
        await syncPresence();   // un-mute her at your location; she follows on every move
    }
    // opts.quiet: management action (party button) — no in-character farewell,
    // no LLM call of any kind. opts.resumeSchedule: no lingering pin — she is
    // back on her routine (at her CURRENT scheduled spot) the moment presence
    // syncs, instead of staying where you parted until time moves on.
    async function removeFromParty(npcName, opts = {}) {
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

        // Conscious parting: let her say goodbye IN CHARACTER and name where she
        // will be NEXT, BEFORE she leaves the scene.
        if (wasParty && !opts.quiet) await triggerNpcDeparture(npcName);
        currentGameState.party = (currentGameState.party || []).filter(n => n !== npcName);
        if (wasParty && opts.resumeSchedule) {
            rel.partedAt = null; rel.partedStep = null;
            savePlayer();
            const dest = scheduledLocationFor(npcName);
            sendGhostMessage(`👋 **${npcName} leaves the party**${dest && dest !== here ? `, heading to ${locName(dest)}` : ''}, and returns to her own routine.`);
        } else if (wasParty) {
            // She stays where you brought her and only picks her routine back up
            // when time moves on — otherwise escorting someone anywhere is undone
            // the instant you part. Only for someone actually travelling with
            // you: a woman you were never with was never yours to leave anywhere.
            rel.partedAt = here;
            rel.partedStep = currentGameState.timeStep || 0;
            savePlayer();
            const when = nextPeriod().name;
            const dest = nextScheduledLocationFor(npcName);
            sendGhostMessage(`👋 **${npcName} parts ways** — she stays at ${locName(here)} for now, and ${dest && dest !== here ? `heads to ${locName(dest)}` : 'picks her own routine back up'} come ${when}.`);
        } else {
            const dest = scheduledLocationFor(npcName);
            sendGhostMessage(`👋 **${npcName} parts ways**${dest ? `, heading to ${locName(dest)}` : ''}, and returns to her own routine.`);
        }
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
        const nxt = nextPeriod();
        const here = currentGameState.currentLocation;
        const destId = nextScheduledLocationFor(npcName);
        const role = npc?.role ? ` (you are ${aOrAn(npc.role)})` : '';
        // She is not rushing off any more: she stays put until this period is
        // out, so the farewell must name where she'll be NEXT. Naming where she
        // already stands would send him looking for her where she has not gone.
        const plan = (destId && destId !== here)
            ? `You are NOT rushing off — you stay here at ${locName(here)} for the rest of this ${period}, and come ${nxt.name} you head to ${locName(destId)} to go about your business${role}. Tell him where to find you LATER. Tone like: "Goodbye for now! I'll be around here a while yet — after that you'll find me at ${locName(destId)}."`
            : `You are NOT rushing off — you stay right here at ${locName(here)}${role}, which is where your own business keeps you for now. Tone like: "Goodbye for now! You know where to find me — I'll be right here."`;
        const note = `[You are parting ways with ${player} for now and going back to your OWN business. In ONE short, warm, in-character line, say goodbye and tell him where he can find you. ${plan} Just the spoken farewell — do not narrate leaving in detail, and do not walk out of the scene.]`;
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

    // === Area notes — "something about this place has changed" ==============
    // Extra info appended to an area's description. Two sources, one read path:
    // AUTHORED notes live in the world definition (Edit Location panel) and
    // arrive with the world; SESSION notes are made in play (RPG menu) and live
    // in the save (currentGameState.areaNotes[locId]), since Continue reloads
    // the pristine world file. A note is either public — appended to the
    // description everyone reads — or SECRET: privy to an explicit list chosen
    // from the cast + the Game Master, everyone defaulting OFF. Secret notes
    // never enter the shared status block or any chat message; a privy NPC
    // gets hers as a one-shot depth-0 note at reply time, the GM gets his in
    // the headless narration prompts. The Custodian sees everything — the
    // engine's ground truth is not a secret from the judge.
    function areaNotesAt(locId) {
        const authored = currentGameState.worldData?.locations?.[locId]?.areaNotes || [];
        const session = (currentGameState.areaNotes || {})[locId] || [];
        return [...authored, ...session];
    }
    function publicAreaNotesLine(locId) {
        const pub = areaNotesAt(locId).filter(n => !n.secret && String(n.text || '').trim());
        return pub.length ? ` Of note here, as things NOW stand: ${pub.map(n => n.text.trim()).join(' ')}` : '';
    }
    /** Secret notes a given viewer (NPC name or 'Game Master') is privy to. */
    function secretAreaNotesFor(viewer, locId = currentGameState.currentLocation) {
        return areaNotesAt(locId)
            .filter(n => n.secret && (n.privy || []).includes(viewer) && String(n.text || '').trim())
            .map(n => n.text.trim());
    }
    /** Description tail for GM-side headless prompts: public + GM-privy. */
    function gmAreaNotesLine(locId = currentGameState.currentLocation) {
        const secrets = secretAreaNotesFor('Game Master', locId);
        return publicAreaNotesLine(locId) +
            (secrets.length ? ` (Known to you the narrator, NOT common knowledge — never state it as openly known: ${secrets.join(' ')})` : '');
    }
    /** Everything, secrecy-tagged — for the Custodian, which always knows. */
    function areaNotesForAnalyzer(locId = currentGameState.currentLocation) {
        const all = areaNotesAt(locId).filter(n => String(n.text || '').trim());
        if (!all.length) return '';
        return all.map(n => n.secret
            ? `[SECRET — known only to: ${(n.privy || []).join(', ') || 'nobody'}] ${n.text.trim()}`
            : n.text.trim()).join(' · ');
    }

    // A readable summary of an NPC's routine + home, grouped by location. Used
    // both for her own self-knowledge (status block) and the reunion note.
    function scheduleSummary(npc) {
        const home = npc.homeLocation ? locName(npc.homeLocation) : null;
        const periods = ['Morning', 'Day', 'Evening', 'Night'];
        // A weekly NPC's routine differs by day, so summarize TODAY (with what
        // she is doing, if authored) and say plainly that the week varies —
        // listing all seven days would swamp the status block.
        if (npc.weeklyEnabled && npc.weeklySchedule) {
            const today = weekdayName();
            const parts = periods.map(p => {
                const slot = npcSlotFor(npc, currentGameState.dayCount, p);
                if (!slot.loc) return null;
                return `${p.toLowerCase()} at ${locName(slot.loc)}${slot.note ? ` (${slot.note})` : ''}`;
            }).filter(Boolean);
            let s = parts.length ? `${today}s go — ${parts.join(', ')}` : 'no fixed routine';
            s += '; her week runs to a set timetable, so different days take her elsewhere';
            if (home) s += `; home is ${home}`;
            return s + '.';
        }
        const sched = npc.schedule || {};
        const byLoc = {};
        for (const p of periods) { const l = sched[p]; if (!l) continue; (byLoc[l] = byLoc[l] || []).push(p.toLowerCase()); }
        const clauses = Object.entries(byLoc).map(([loc, ps]) => `${locName(loc)} (${ps.join('/')})`);
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
    // One-shot per-NPC injection of secret area notes she is privy to.
    const AREANOTE_PROMPT_KEY = 'RPG_CUSTODIAN_AREANOTE';
    // One-shot swan song: her single reply on the way down into unconsciousness.
    const KO_SWANSONG_PROMPT_KEY = 'RPG_CUSTODIAN_SWANSONG';

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
        else if (check.tier === 'mixed') read = 'She does NOT go along with it — but only barely. Something in her wavered; she declines, deflects, or puts it off, yet the refusal is softer than it might have been and she may hint at what would change her mind.';
        else if (check.tier === 'fumble') read = 'It lands BADLY — clumsy, ill-timed, or presumptuous. She is put off, embarrassed for him, or genuinely affronted, and reacts to that.';
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
            // Let go a moment ago and not yet back on her routine: gossip should
            // put her where she actually is, not where her schedule says.
            else if (isLingeringWhereParted(rel)) where = locSecret(rel.partedAt) === 0
                ? `still over at ${locName(rel.partedAt)}, where she and ${player} went their separate ways`
                : 'nobody is quite sure where she gets to at this hour';
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
    //
    // Split in two on purpose. REQUEST is the model call and nothing else, so
    // it can run while the next woman is already answering. APPLY is the state
    // change and the player-facing line, which must land in speaker order — a
    // "💗 affection +1" that arrives whenever its call happened to return would
    // attach itself to whatever reply is on screen at that moment.
    async function requestReactionVerdict(npcName, preReplyLen) {
        const doneJudge = perfStage(`judge:${npcName}`);
        try {
            const chat = getCtx().chat || [];
            const reply = chat.length > preReplyLen ? chat[chat.length - 1] : null;
            if (!reply || reply.is_user || reply.is_system || reply.name !== npcName) return null;
            const replyText = String(reply.mes || '').trim();
            if (!replyText) return null;
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
CLIMAX — did her body actually COME APART in this reply? Judge the body, not the words; the prose rarely names it. Yes when an involuntary crisis takes her and then leaves her: clenching or fluttering around him, a back arching, thighs locking or legs giving way, a cry torn out of her, sight or thought whiting out, then the limp shuddering aftermath. NO for the climb — moaning, writhing, begging, being close, "almost", "any second" — that is arousal rising, not breaking. NO if she is merely described as already spent from an earlier one.
Output ONLY JSON: {"affection": <-2..2>, "arousal": <-2..2>, "climax": true|false, "why": "<ten words max>"}`;
            const prompt = `NPC: ${npcName}
Her disposition band she was told to play (${t.label}, affection ${getNpcAffection(npcName)}/10): she ${t.band}
Her physical band (${a.label}, arousal ${getNpcArousal(npcName)}/10): ${a.band}
Scene context (for reading her reply — but score ONLY the reply itself):
${recentSceneForAnalyzer().split('\n').slice(-6).join('\n')}
Player's message: "${String(playerMsg?.mes || '').replace(/\s+/g, ' ').slice(0, 600)}"
HER REPLY (score this):
${replyText.replace(/\s+/g, ' ').slice(0, 1500)}`;

            // concurrent: this call can be in flight while SillyTavern builds
            // the next reply, and a response-length cap would corrupt hers.
            const p = await generateJson({ prompt, systemPrompt: sys, budget: 220, concurrent: true });
            if (!p) { doneJudge({ verdict: 'unparsed' }); return null; }
            // Log zeros too — silent verdicts made live misses undiagnosable.
            console.log(`RPG Custodian: reaction judge ${npcName}: aff ${Number(p.affection) || 0}, aro ${Number(p.arousal) || 0}${p.climax ? ', CLIMAX' : ''} (${p.why || ''})`);
            doneJudge({ verdict: `${Number(p.affection) || 0}/${Number(p.arousal) || 0}${p.climax ? '/climax' : ''}` });
            return p;
        } catch (e) { console.error('RPG Custodian: reaction judge failed', e); return null; }
        finally { doneJudge(); }
    }

    /** Apply a verdict. Synchronous and ordered — the caller chooses the moment. */
    function applyReactionVerdict(npcName, p) {
        if (!p) return;
        try {
            const rel = getRelationship(npcName);
            let dAff = Math.max(-2, Math.min(2, Math.round(Number(p.affection) || 0)));
            const dAro = Math.max(-2, Math.min(2, Math.round(Number(p.arousal) || 0)));

            // Her climax usually appears in HER OWN reply, which the analyzer
            // never sees (it ran before she spoke, and next turn it reads her
            // truncated). This judge is already holding the full text, so it
            // costs nothing to catch it here.
            currentGameState.npcClimaxedThisTurn = currentGameState.npcClimaxedThisTurn || [];
            if (p.climax && !currentGameState.npcClimaxedThisTurn.includes(npcName)) {
                currentGameState.npcClimaxedThisTurn.push(npcName);
                const r2 = spendNpcStamina(npcName, 1);
                sendGhostMessage(`💦 ${npcName} climaxes — Stamina ${r2.npcStamina}/${npcMaxStamina(npcName)}${r2.npcUnconscious ? ' — she swoons into blissful unconsciousness!' : ''}`);
                savePlayer();
            }
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
            const aroBefore = getNpcArousal(npcName);
            if (dAff) rel.affection = Math.max(0, Math.min(10, (rel.affection || 0) + dAff));
            if (dAro) setNpcArousalRaw(npcName, (rel.arousal ?? 0) + dAro);
            savePlayer();

            // Every increment is shown to the player (Dyna's call) — with a
            // flourish line added when a tier boundary is crossed. Displays are
            // EFFECTIVE values (status deltas/caps folded in) — what she plays.
            // EXCEPT a gain that changes nothing she plays (already at 10, or
            // pinned by a cap): "+1 → 10/10" every reply is noise (Dyna
            // 2026-08-08), and the raw substrate moved regardless.
            const bits = [];
            if (dAff) bits.push(`💗 affection ${dAff > 0 ? '+' : ''}${dAff} → ${getNpcAffection(npcName)}/10 (${affectionTier(getNpcAffection(npcName)).label})`);
            if (dAro && !(dAro > 0 && getNpcArousal(npcName) === aroBefore)) bits.push(`🔥 arousal ${dAro > 0 ? '+' : ''}${dAro} → ${getNpcArousal(npcName)}/10 (${arousalTier(getNpcArousal(npcName)).label})`);
            const afterTier = affectionTier(getNpcAffection(npcName)).label;
            const shift = afterTier !== beforeTier
                ? `\n${dAff > 0 ? `💗 Something shifts in ${npcName} — **${beforeTier} → ${afterTier}**.` : `💔 ${npcName} pulls back — **${beforeTier} → ${afterTier}**.`}`
                : '';
            if (bits.length) sendGhostMessage(`${npcName}: ${bits.join(' · ')}${shift}`);
            if (shift) projectPlayerStatus();   // she plays the new band from the next line
        } catch (e) { console.error('RPG Custodian: applying reaction verdict failed', e); }
    }

    /** Ask and apply in one go — for the out-of-band paths (a swipe, a ▶
     *  continue, the debug hook), where there is no turn to order against. */
    async function judgeNpcReaction(npcName, preReplyLen) {
        applyReactionVerdict(npcName, await requestReactionVerdict(npcName, preReplyLen));
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
        // Concrete things she actually did during the gap, walked from her
        // weekly timetable — far better than "you lived your own life".
        const pursuits = absencePursuits(npc, elapsed);
        const didText = pursuits.length
            ? ` In that time your timetable had you ${pursuits.join(', then ')} — these are real things you did while he was gone, and you may mention them.`
            : '';
        return `[SCENE CONTINUITY for ${npcName}${role} — read this before you reply. You have NOT seen ${player} for about ${dur}. You spent that time APART, living your own life — ${scheduleSummary(npc)}${didText}${circumstance} React to his RETURN across that gap: you are aware time has passed and that you did NOT spend it with him, so greet/acknowledge the reunion rather than picking the last scene back up as if he never left. You may carry your own news, changes, or feelings about the time apart. Your standing with him: ${t.label} — ${npcName} ${t.desc}.${preg} If he asks where you have been or what you do, answer honestly from your routine above.]`;
    }

    // ========================================================================
    // ENGINE-MANAGED STATUSES
    // ========================================================================
    // Three states the ENGINE owns entirely: it applies and removes them from
    // hard numbers, and the Custodian never emits them. They ride the ordinary
    // status system anyway so that every surface that already reads statuses —
    // the NPCs' context, the GM narrator, examine, the character sheet — sees
    // them without a single new special case.
    const PENT_UP_PERIODS = 8;   // time steps without release before it sets in
    const ENGINE_STATUSES = {
        exhausted: {
            name: 'Exhausted', kind: 'status', polarity: 'negative',
            desc: 'Wrung out and running on empty — everything is heavier, slower, and harder to think through. Not asleep, but badly in need of rest.',
            mods: [{ stat: 'ruggedness', amount: -2 }, { stat: 'charm', amount: -2 }, { stat: 'craftiness', amount: -2 }],
            onApply: '😮‍💨 **Exhausted** — you are spent (Stamina 0). −2 Ruggedness, Charm and Craftiness until you rest.',
            onClear: '💪 You shake off the exhaustion.',
        },
        unconscious: {
            name: 'Unconscious', kind: 'status', polarity: 'negative',
            desc: 'Out cold — collapsed from exhaustion, limp and unresponsive. She cannot speak, move, or react to anything until she wakes or is revived.',
            mods: [],
        },
        pentUp: {
            name: 'Pent Up', kind: 'status', polarity: 'neutral',
            desc: 'A long while without release has left a restless ache — distractible and short of focus, but primed and potent.',
            mods: [{ stat: 'craftiness', amount: -1 }, { stat: 'virility', amount: 1 }],
            onApply: '🔥 **Pent Up** — it has been a long while. −1 Craftiness, +1 Virility.',
            onClear: '😌 The edge is off — **Pent Up** fades.',
        },
    };
    let syncingEngineStatuses = false;   // addCustomStatus saves, which re-enters here
    function engineStatusOf(holder, key) {
        return (holder?.customEffects || []).find(e => e.engineManaged === key && e.active !== false);
    }
    /** Add or remove one engine status so it matches `shouldHave`. */
    function reconcileEngineStatus(target, key, shouldHave) {
        const isPlayer = !target || target === 'player';
        const holder = isPlayer ? getPlayerRpgData() : getRelationship(target);
        if (!holder) return;
        const spec = ENGINE_STATUSES[key];
        const existing = engineStatusOf(holder, key);
        if (shouldHave && !existing) {
            const rec = addCustomStatus(isPlayer ? 'player' : target, spec, true);
            if (rec) rec.engineManaged = key;
            if (spec.onApply && isPlayer) sendGhostMessage(spec.onApply);
        } else if (!shouldHave && existing) {
            holder.customEffects = holder.customEffects.filter(e => e !== existing);
            if (spec.onClear && isPlayer) sendGhostMessage(spec.onClear);
        }
    }
    /**
     * Bring all engine-owned statuses in line with the numbers. Cheap, pure
     * bookkeeping — safe to call after anything that moves stamina or time.
     */
    function syncEngineStatuses() {
        if (syncingEngineStatuses || !currentGameState.isActive) return;
        const rd = getPlayerRpgData();
        if (!rd) return;
        syncingEngineStatuses = true;
        try {
            reconcileEngineStatus('player', 'exhausted', getStamina() <= 0);
            const since = (currentGameState.timeStep || 0) - (rd.stats.lastOrgasmStep ?? 0);
            reconcileEngineStatus('player', 'pentUp', since >= PENT_UP_PERIODS);
            for (const npc of (currentGameState.npcRoster || [])) {
                const rel = rd.relationships?.[npc.name];
                if (!rel) continue;                       // untouched NPCs keep no record
                reconcileEngineStatus(npc.name, 'unconscious', !!rel.npcUnconscious);
            }
        } finally { syncingEngineStatuses = false; }
    }

    // ========================================================================
    // WITNESS FILTERING  (absorbed from SillyTavern-Presence, 2026-07-30)
    // ========================================================================
    // Each NPC may only be prompted with what she personally saw. Messages
    // carry a `present` list of avatars; before a character is drafted to
    // speak, everything she did not witness is flagged is_system (ST drops
    // is_system from the prompt) and restored the moment generation ends.
    //
    // Absorbed because the upstream extension had a structural bug we could
    // not fix from outside: it armed a `once` GROUP_MEMBER_DRAFTED handler
    // from GENERATION_AFTER_COMMANDS, which fires INSIDE Generate() — i.e.
    // AFTER group-chats.js has already emitted the draft. Every handler was
    // therefore consumed by the FOLLOWING generation, carrying a stale `type`,
    // and a stale 'continue'/'impersonate' took a branch that unhid the whole
    // history. Measured on a real save: 3 of 5 unwitnessed messages visible at
    // a draft. Here the listener is permanent and there is no type branch at
    // all — we always filter — so the race cannot exist.
    const UNIVERSAL_WITNESS = 'presence_universal_tracker';
    function witnessFilteringOn() {
        const s = context.extensionSettings[extensionName] || {};
        return s.witnessFiltering !== false;   // default ON
    }
    function witnessedBy(msg, avatar) {
        const p = msg?.present;
        if (!Array.isArray(p)) return true;    // unstamped → visible to all (fail open)
        return p.includes(avatar) || p.includes(UNIVERSAL_WITNESS);
    }
    /** Give a message its witness list if it has none. */
    function stampWitnesses(msg) {
        if (!msg || Array.isArray(msg.present)) return;
        const witnesses = getNpcsAt(currentGameState.currentLocation || '')
            .map(n => castCharFor(n.name)?.avatar || `${n.name}.png`);
        witnesses.push('Game Master.png');
        // a speaker always witnesses her own line, even if she has since left
        const own = msg.original_avatar || (msg.name && !msg.is_user ? `${msg.name}.png` : null);
        if (own && !witnesses.includes(own)) witnesses.push(own);
        msg.present = witnesses;
    }
    /**
     * Hide everything `avatar` never saw. Only messages WE hide are marked
     * rpgHidden, so restoring can never unhide a genuinely system message —
     * the engine's own ghost lines are is_system by design and must stay out
     * of the prompt.
     */
    function hideUnwitnessed(avatar) {
        const chat = getCtx().chat || [];
        let hidden = 0;
        for (const m of chat) {
            if (!m || m.presence_manually_hidden) continue;
            if (witnessedBy(m, avatar)) {
                if (m.rpgHidden) { m.is_system = false; delete m.rpgHidden; }
            } else if (!m.is_system) {
                m.is_system = true; m.rpgHidden = true; hidden++;
            }
        }
        // she can always see the line she is answering
        const last = chat[chat.length - 1];
        if (last?.rpgHidden) { last.is_system = false; delete last.rpgHidden; hidden--; }
        return hidden;
    }
    function restoreWitnessVisibility() {
        for (const m of (getCtx().chat || [])) {
            if (m?.rpgHidden) { m.is_system = false; delete m.rpgHidden; }
        }
    }
    /** Stand the upstream extension down — two systems fighting over is_system
     *  would race, and ours is the one wired to the engine's own presence. */
    function standDownPresenceExtension() {
        const ps = context.extensionSettings['Presence'];
        if (!ps || ps.enabled === false || !witnessFilteringOn()) return;
        ps.enabled = false;
        context.saveSettingsDebounced();
        console.log('RPG Custodian: witness filtering is built in now — SillyTavern-Presence disabled to avoid two systems fighting over message visibility.');
    }
    function initWitnessFiltering() {
        const ctx = getCtx();
        standDownPresenceExtension();
        ctx.eventSource.on(ctx.eventTypes.GROUP_MEMBER_DRAFTED, (chId) => {
            if (!witnessFilteringOn() || !currentGameState.isActive) return;
            const avatar = ctx.characters?.[chId]?.avatar;
            if (avatar) hideUnwitnessed(avatar);
        });
        for (const ev of ['GENERATION_ENDED', 'GENERATION_STOPPED', 'CHAT_CHANGED']) {
            if (ctx.eventTypes[ev]) ctx.eventSource.on(ctx.eventTypes[ev], restoreWitnessVisibility);
        }
    }

    // ========================================================================
    // TURN TELEMETRY  —  one system, two faces
    // ========================================================================
    // Face 1: a live chip so the player can tell cooking from idle from stalled.
    // Face 2: a timestamped record of every stage and every model call, kept for
    // later parsing against the chat log.
    //
    // The headline number is TOTAL: from the instant the send button is pressed
    // to the last judge of the chain finishing. VISIBLE is the same clock
    // stopped when the final NPC line actually appears — the gap between them is
    // exactly what taking the judges off the critical path would buy, so the
    // instrumentation can price its own optimisations.
    const PERF_KEEP_TURNS = 80;
    const PERF_STALL_MS = 25000;
    let perfTurn = null;
    let perfChipTimer = null;
    const perfNow = () => (window.performance?.now?.() ?? Date.now());

    function perfBegin(playerText) {
        perfTurn = {
            startedAt: new Date().toISOString(),
            t0: perfNow(),
            chatIndex: (getCtx().chat || []).length,          // cross-reference to the log
            day: currentGameState.dayCount, time: currentGameState.currentTime,
            location: currentGameState.currentLocation,
            present: getNpcsAt(currentGameState.currentLocation || '').map(n => n.name),
            action: String(playerText || '').slice(0, 120),
            stages: [], calls: [],
            visibleMs: null, totalMs: null,
        };
        perfChipStart();
    }
    /** Open a stage; returns the closer. Nestable-safe: stages are a flat list. */
    function perfStage(label, meta = {}) {
        if (!perfTurn) return () => {};
        const rec = { label, at: Math.round(perfNow() - perfTurn.t0), ms: null, ...meta };
        perfTurn.stages.push(rec);
        perfChipSet(label);
        const t = perfNow();
        // Idempotent: closing twice keeps the first measurement, so a stage can
        // be closed on an early return AND in a finally without lying.
        return (extra = {}) => { if (rec.ms == null) rec.ms = Math.round(perfNow() - t); Object.assign(rec, extra); };
    }
    /** Record one model round trip. Sizes are characters — token counts are not
     *  returned by the API, so we log what we can measure and estimate from it. */
    function perfCall(kind, promptChars, systemChars) {
        if (!perfTurn) return () => {};
        const rec = {
            kind, at: Math.round(perfNow() - perfTurn.t0), ms: null,
            inChars: (promptChars || 0) + (systemChars || 0), outChars: null,
            estInTokens: Math.round(((promptChars || 0) + (systemChars || 0)) / 4),
        };
        perfTurn.calls.push(rec);
        const t = perfNow();
        // Idempotent, and closeable on the failure path: a call that THREW used
        // to leave ms null, so the most expensive events in a session — a model
        // call that burned 17s and returned nothing — were the very ones
        // missing from the data collected to diagnose them.
        return (out, meta) => {
            if (rec.ms !== null) return;
            rec.ms = Math.round(perfNow() - t);
            rec.outChars = String(out ?? '').length;
            rec.estOutTokens = Math.round(rec.outChars / 4);
            if (meta && meta.failed) rec.failed = meta.failed;
        };
    }
    /** Turn-level outcome of the Custodian call: 'ok' | 'recovered' (the prefill
     *  rescue saved it) | 'dead' (both attempts gone). A dead analyzer returns an
     *  intent shaped EXACTLY like "the player said something stakeless" — no
     *  check, no effects, nothing on screen — so the turns that silently lost
     *  their mechanics were invisible in the very data collected to find them.
     *  Stamp it on the turn so a lost turn can be counted, not just felt. */
    function perfNoteAnalyzer(outcome, detail) {
        if (!perfTurn) return;
        perfTurn.analyzer = outcome;
        if (detail) perfTurn.analyzerDetail = String(detail).slice(0, 160);
    }
    /** Stamp the moment the LAST visible line landed. In a group scene several
     *  speakers answer in turn, so this moves forward with each of them —
     *  stamping only the first made every later reply look like dead time. */
    function perfMarkVisible() {
        if (perfTurn) perfTurn.visibleMs = Math.round(perfNow() - perfTurn.t0);
    }
    function perfEnd() {
        if (!perfTurn) return;
        perfTurn.totalMs = Math.round(perfNow() - perfTurn.t0);
        if (perfTurn.visibleMs == null) perfTurn.visibleMs = perfTurn.totalMs;
        // Two different questions, so two numbers:
        //  judgeMs     — total judging WORK. Judges now run concurrently with
        //                the replies that follow them, so these windows OVERLAP
        //                and this sum can exceed the turn's own wall clock. It
        //                prices the work, not the delay — do not read it as
        //                time the player waited.
        //  afterLastMs — dead time once the last line was on the page: the part
        //                the player experiences as the engine still chewing,
        //                and the honest measure of what judging still costs.
        perfTurn.judgeMs = perfTurn.stages.filter(x => x.label.startsWith('judge:')).reduce((a, b) => a + (b.ms || 0), 0);
        perfTurn.afterLastMs = perfTurn.totalMs - perfTurn.visibleMs;
        perfTurn.calls_n = perfTurn.calls.length;
        const store = context.extensionSettings[extensionName];
        store.perf = store.perf || [];
        store.perf.push(perfTurn);
        while (store.perf.length > PERF_KEEP_TURNS) store.perf.shift();
        context.saveSettingsDebounced();
        const stages = perfTurn.stages.map(s => `${s.label}:${s.ms ?? '—'}ms`).join(' | ');
        const line = `RPG Custodian ⏱ turn: total ${perfTurn.totalMs}ms · last line ${perfTurn.visibleMs}ms · judging ${perfTurn.judgeMs}ms · after last line ${perfTurn.afterLastMs}ms · ${perfTurn.calls.length} model calls${perfTurn.analyzer ? ` · custodian ${perfTurn.analyzer}` : ''}`;
        // A dead Custodian is the one turn outcome worth shouting about: the
        // player acted, and the engine applied nothing at all.
        const died = perfTurn.analyzer === 'dead';
        if (died) console.error(`${line}\n  ⚠️ THE CUSTODIAN NEVER ANSWERED — no check rolled, no effects applied${perfTurn.analyzerDetail ? ` (${perfTurn.analyzerDetail})` : ''}`, stages);
        else console.log(line, stages);
        perfTurn = null;
        if (died) perfChipWarn('⚠️ the Custodian never answered — nothing was applied this turn');
        else perfChipStop();
    }

    // ── the chip ──────────────────────────────────────────────────────────
    /** Live in the layout as its own row directly ABOVE the chat log, rather
     *  than floating over it. #sheld is a flex column whose #chat child is
     *  `flex: 1 1 auto`, so a sibling inserted before it simply takes its own
     *  strip and the conversation shrinks to fit — the chip can never sit on
     *  top of a line the player is reading.
     *
     *  This also retires the old absolute positioning: nothing has to be
     *  measured or clamped, so there is no geometry left to get wrong on a
     *  phone (SillyTavern puts a transform on <html>, which used to make
     *  position:fixed resolve against the scrolled page box instead of the
     *  viewport and threw the chip off-screen entirely). */
    function perfChipEl() {
        let el = $('#rpg-perf-chip');
        if (!el.length) el = $('<div id="rpg-perf-chip"></div>');
        const sheld = document.querySelector('#sheld');
        const chat = document.querySelector('#chat');
        // #sheld is torn down and rebuilt on some layout changes, so re-seat the
        // chip every time rather than trusting the first insert to survive.
        if (sheld && chat && el[0].parentElement !== sheld) sheld.insertBefore(el[0], chat);
        else if (!sheld && el[0].parentElement !== document.body) $(document.body).append(el);
        return el;
    }
    function perfChipStart() {
        const el = perfChipEl().removeClass('rpg-perf-stall').show();
        clearInterval(perfChipTimer);
        perfChipTimer = setInterval(() => {
            if (!perfTurn) return;
            const secs = ((perfNow() - perfTurn.t0) / 1000).toFixed(1);
            const stalled = (perfNow() - perfTurn.t0) > PERF_STALL_MS;
            el.toggleClass('rpg-perf-stall', stalled);
            el.text(`${perfTurn.chipLabel || 'working'} ${secs}s${stalled ? ' — still going…' : ''}`);
        }, 200);
    }
    function perfChipSet(stage) {
        if (!perfTurn) return;
        const PRETTY = {
            analyze: '🧠 reading your action', narrate: '✍️ the narrator', conditions: '⚖️ checking conditions',
        };
        perfTurn.chipLabel = PRETTY[stage]
            || (stage.startsWith('reply:') ? `💬 ${stage.slice(6)} is answering` : '')
            || (stage.startsWith('judge:') ? `⚖️ reading ${stage.slice(6)}` : '')
            || stage;
    }
    function perfChipStop() { clearInterval(perfChipTimer); perfChipTimer = null; $('#rpg-perf-chip').fadeOut(150); }
    /** Hold the chip up with a warning instead of fading it away. A turn that
     *  quietly lost its mechanics must not look exactly like a quiet turn —
     *  this is the live face of the same fact perfNoteAnalyzer records. */
    function perfChipWarn(text, ms = 7000) {
        clearInterval(perfChipTimer); perfChipTimer = null;
        perfChipEl().addClass('rpg-perf-stall').stop(true, true).show().text(text);
        setTimeout(() => $('#rpg-perf-chip').fadeOut(300), ms);
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
        syncEngineStatuses();   // stamina/time-derived states, before anyone reads them
        const rd = currentGameState.isActive ? getPlayerRpgData() : null;
        context.setExtensionPrompt(SCENE_PROMPT_KEY, rd ? sceneGroundTruth() : '', 1, 0);
        if (!rd) { context.setExtensionPrompt(STATUS_PROMPT_KEY, '', 1, 4); return; }
        const s = rd.stats;
        const name = context.powerUserSettings.personas?.[playerAvatar()] || 'The adventurer';
        const items = rd.inventory.items.map(i => prettyItem(i.name));
        const lines = [
            // The scene anchor — FIRST, so every reply/narration is grounded in
            // WHERE and WHEN this is happening. NPCs must speak/act as being here.
            `[SCENE — this is happening at: ${currentSceneLabel()} (Day ${currentGameState.dayCount} — today is ${weekdayName()}).${currentLocationDesc() ? ` ${currentLocationDesc()}` : ''}${publicAreaNotesLine(currentGameState.currentLocation)} Everyone present is HERE, in this place; ground all dialogue, action, and description in this exact setting — do not drift to another location.]`,
            ``,
            `[Adventurer Status — plainly visible to everyone present]`,
            `${name} — Ruggedness ${effectiveStat('ruggedness')}, Charm ${effectiveStat('charm')}, Craftiness ${effectiveStat('craftiness')}, Virility ${effectiveStat('virility')} (Level ${s.level}).`,
            `Stamina ${getStamina()}/${maxStamina()}${rd.stats.unconscious ? ' — EXHAUSTED (spent, not asleep: he can still act, badly)' : ''}.`,
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
            // Her cycle, as her BODY tells it (not when already carrying).
            // Graded flavor replaced the old terse two-line version (Dyna
            // 2026-08-09: even at 9/10 affection "she seemed to have no idea"
            // — one dry sentence lost the attention war in a big status
            // block, and 6 of 8 days said nothing at all). Affection gates
            // WILLINGNESS to share, never knowledge: she always knows her
            // own body.
            if (!(rel.pregnancies > 0)) d += cycleAwarenessLine(npc.name);
            // What her timetable has her doing at this very hour, so she can
            // answer for herself ("Oh, young master! I was just folding laundry!").
            const doing = npcSlotFor(npc).note;
            if (doing) d += ` Right now she is ${doing} — that is what she was occupied with when the player came upon her.`;
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
        // The dice themselves carry the drama: boxcars swing +3 and snake eyes
        // −3, so doubles tend to land in the critical bands on their own rather
        // than needing a special-case tier rule.
        const swing = (d1 === 6 && d2 === 6) ? 3 : (d1 === 1 && d2 === 1) ? -3 : 0;
        const total = d1 + d2 + eff + swing;
        let tier;
        if (total >= difficulty + 4) tier = 'critical';
        else if (total >= difficulty) tier = 'success';
        else if (total >= difficulty - 2) tier = 'mixed';       // a 2-wide near miss — still a failure
        else if (total >= difficulty - 6) tier = 'failure';
        else tier = 'fumble';
        return { statName, base, boost, eff, d1, d2, dice: d1 + d2, swing, total, difficulty, tier, success: total >= difficulty };
    }
    // Chance that 2d6 + mod clears a DC. The whole difficulty system is a
    // probability claim, so print the probability: a miscalibrated DC (the
    // DC-16 charm check to hold hands) is invisible as a bare number and
    // obvious as "0%".
    // Enumerated rather than tabulated, so it can never drift from skillCheck —
    // it applies the same doubles swing the dice do.
    function successChance(mod, dc) {
        let wins = 0;
        for (let a = 1; a <= 6; a++) for (let b = 1; b <= 6; b++) {
            const swing = (a === 6 && b === 6) ? 3 : (a === 1 && b === 1) ? -3 : 0;
            if (a + b + mod + swing >= dc) wins++;
        }
        return Math.round(wins / 36 * 100);
    }
    function skillCheckLine(check, label) {
        const boostStr = check.boost ? ` +${check.boost} boost` : '';
        const swingStr = check.swing > 0 ? ` **+${check.swing} DOUBLE SIXES!**` : check.swing < 0 ? ` **${check.swing} snake eyes!**` : '';
        const icon = { critical: '🌟', success: '✅', mixed: '➖', failure: '❌', fumble: '💥' }[check.tier];
        const odds = successChance((check.base || 0) + (check.boost || 0), check.difficulty);
        const oddsStr = odds === 0 ? ' — **beyond you at this level**' : ` — ${odds}% for you`;
        return `🎲 **${label}** — ${check.statName} check (DC ${check.difficulty}${oddsStr})\n` +
            `Rolled 2d6 [${check.d1}+${check.d2}=${check.dice}] + ${check.base}${boostStr}${swingStr} = **${check.total}** → ${icon} **${check.tier === 'fumble' ? 'CRITICAL FAILURE' : check.tier.toUpperCase()}**`;
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
        // Quests & objectives and active statuses live here too (Dyna
        // 2026-08-09: one place to check yourself — and the quests are the
        // part she values most, so they come before the body's condition).
        const objectives = playerObjectives();
        if (objectives.length) {
            items.push({ head: 'Quests & objectives' });
            for (const e of objectives) {
                const rw = rewardLabel(e.reward);
                items.push({
                    icon: effectIcon(e),
                    label: `${e.name}${statusModString(e.mods)}`,
                    sub: `${e.endCondition || 'ongoing'}${rw ? ` · reward: ${rw}` : ''}`,
                    action: () => {},
                });
            }
        }
        items.push({ head: 'Active statuses' });
        const statuses = playerStatusesOnly();
        for (const e of statuses) {
            items.push({
                icon: effectIcon(e),
                label: `${e.name}${statusModString(e.mods)}`,
                sub: `${e.desc ? `${e.desc} · ` : ''}ends: ${statusEndsLabel(e) || 'permanent'}`,
                action: () => {},
            });
        }
        if (isCrystalCursed('player')) items.push({ icon: '💠', label: 'Crystal Curse', sub: 'any child you sire is born an inert soulgem — until broken by magic', action: () => {} });
        if (!statuses.length && !isCrystalCursed('player')) items.push({ icon: '—', label: '(none — you are unafflicted)', action: () => {} });
        const equipped = equippedItemsSummary();
        openActionPopup(`🎒 Items & Statuses${equipped.length ? `  —  worn: ${equipped.map(e => e.split(' (')[0]).join(', ')}` : ''}`, items);
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
    }

    // Emergent XP: harder successful checks are worth more (bard experience —
    // besting a dragon eclipses finding a stick). See core-mechanics §5.
    // XP = 1 per PERCENT the roll you just made would have failed. Scraping a
    // 17% chance is worth 83; a near-certainty is worth almost nothing. The
    // reward is exactly the improbability of what you pulled off, so it needs
    // no separate difficulty table and it can never drift from the odds.
    function awardCheckXp(check) {
        if (!check?.success) return 0;
        const mod = (check.base || 0) + (check.boost || 0);
        const xp = Math.max(1, 100 - successChance(mod, check.difficulty));
        const rd = getPlayerRpgData();
        if (rd) { rd.stats.experience = (rd.stats.experience || 0) + xp; savePlayer(); }
        return xp;
    }

    // ── Level up: offered only after a rest, until you move on ──────────────
    const LEVEL_UP_XP = 500;         // one point in a primary stat
    const TOKEN_TO_XP = 100;         // a Power Token converts to this much XP
    const LEVEL_UP_STATS = ['ruggedness', 'charm', 'craftiness', 'virility'];
    function openLevelUp() {
        const rd = getPlayerRpgData();
        if (!rd) return;
        const xp = rd.stats.experience || 0;
        const tokens = rd.stats.power_tokens || 0;
        const items = LEVEL_UP_STATS.map(stat => ({
            icon: xp >= LEVEL_UP_XP ? '⬆️' : '🔒',
            label: `${stat.charAt(0).toUpperCase() + stat.slice(1)} ${baseStat(stat)} → ${baseStat(stat) + 1}`,
            sub: xp >= LEVEL_UP_XP ? `spend ${LEVEL_UP_XP} XP (you have ${xp})` : `needs ${LEVEL_UP_XP} XP — you have ${xp}`,
            action: () => {
                const d = getPlayerRpgData();
                if ((d.stats.experience || 0) < LEVEL_UP_XP) { sendGhostMessage(`❌ Not enough XP — ${LEVEL_UP_XP} needed, you have ${d.stats.experience || 0}.`); return; }
                d.stats.experience -= LEVEL_UP_XP;
                d.stats[stat] = (d.stats[stat] || 0) + 1;
                d.stats.level = (d.stats.level || 1) + 1;
                savePlayer();
                sendGhostMessage(`⭐ **Level up!** ${stat.charAt(0).toUpperCase() + stat.slice(1)} is now **${d.stats[stat]}** (−${LEVEL_UP_XP} XP, ${d.stats.experience} left). You are level ${d.stats.level}.`);
            },
        }));
        items.push({
            icon: tokens > 0 ? '⭐' : '🔒',
            label: `Spend a Power Token → ${TOKEN_TO_XP} XP`,
            sub: tokens > 0 ? `you hold ${tokens}` : 'you hold none',
            action: () => {
                const d = getPlayerRpgData();
                if ((d.stats.power_tokens || 0) < 1) { sendGhostMessage('❌ You have no Power Tokens.'); return; }
                d.stats.power_tokens -= 1;
                d.stats.experience = (d.stats.experience || 0) + TOKEN_TO_XP;
                savePlayer();
                sendGhostMessage(`⭐ A Power Token burns away into experience — +${TOKEN_TO_XP} XP (now ${d.stats.experience}), ${d.stats.power_tokens} token(s) left.`);
                openLevelUp();   // stay open so several can be spent in a row
            },
        });
        openActionPopup(`⭐ Rested — spend your experience (${xp} XP · ${tokens} token${tokens === 1 ? '' : 's'})`, items);
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
    /** Exhausted carries −2 Ruggedness, and max Stamina is DERIVED from
     *  Ruggedness — so anything about to bring him back above 0 must lift the
     *  exhaustion FIRST. Filling while it is still on fills to a maximum that
     *  is about to change: the status then clears, the ceiling jumps back up,
     *  and he is left permanently short by the size of the penalty. */
    function liftExhaustionForRestore() {
        const rd = getPlayerRpgData(); if (!rd) return;
        rd.stats.unconscious = false;
        reconcileEngineStatus('player', 'exhausted', false);
    }

    function restoreEveryoneStamina() {
        const rd = getPlayerRpgData();
        if (rd) { liftExhaustionForRestore(); rd.stats.stamina = maxStamina(); }
        for (const [name, r] of Object.entries(rd?.relationships || {})) {
            if (r.npcUnconscious) wakeNpc(name, r, true);   // records woke-alone if she's stashed elsewhere
            else if (r.npcStamina != null) r.npcStamina = npcMaxStamina(name);
        }
        if (rd) savePlayer();
    }

    // Restoration magic / a healing draught: restore CURRENT Stamina to a target
    // (player or NPC) without raising the max and without passing time. amount is
    // an integer, or 'full'/null to fully restore. Revives from unconsciousness.
    // A meal or a drink is not magic: eating/drinking refills exactly 1
    // Stamina when below max, and does nothing (silently) at full. It does
    // not lift Exhaustion — that stays rest's job.
    function applySustenance() {
        const rd = getPlayerRpgData(); if (!rd) return;
        const before = getStamina();
        const max = maxStamina();
        if (before >= max) return;
        rd.stats.stamina = Math.min(max, before + 1);
        rd.stats.unconscious = rd.stats.stamina <= 0;
        savePlayer();
        sendGhostMessage(`🍖 Refreshment — food and drink put a little life back in you. Stamina ${rd.stats.stamina}/${max}.`);
        projectPlayerStatus();
    }

    function healStamina(target, amount) {
        const tgt = String(target || 'player');
        const full = amount == null || amount === 'full' || amount === 'max';
        if (tgt === 'player') {
            const rd = getPlayerRpgData(); if (!rd) return;
            const before = getStamina();
            const revived = rd.stats.unconscious && (full || amount > 0);
            // Lift the exhaustion before reading the ceiling, or a draught drunk
            // while Exhausted heals against the penalised maximum and comes up
            // short — the same ordering bug as resting.
            if (full || amount > 0) liftExhaustionForRestore();
            const max = maxStamina();
            rd.stats.stamina = full ? max : Math.min(max, before + (amount || 0));
            rd.stats.unconscious = rd.stats.stamina <= 0;
            savePlayer();
            const gained = rd.stats.stamina - before;
            sendGhostMessage(`💚 Restoration${gained > 0 ? ` (+${gained})` : ''} — your Stamina is ${rd.stats.stamina}/${max}${revived && !rd.stats.unconscious ? ' — the worst of the exhaustion lifts!' : ''}.`);
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
        // A proper rest also refills the well: Mana back to full (max = Craftiness).
        { const rd = getPlayerRpgData(); if (rd) { rd.stats.mana = maxMana(); savePlayer(); } }
        sendGhostMessage('😴 You rest and recover — everyone\'s Stamina restored to full, and your Mana refills.');
        // A rest is when you take stock: the Level Up button appears in the
        // action bar and stays there until you leave this place.
        currentGameState.levelUpAt = currentGameState.currentLocation;
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
            // She owes the scene ONE last reply — the collapse itself. Going
            // under silently was a buzzkill: the breach-climax that spent her
            // final Stamina got "💤 cannot respond" instead of the payoff.
            rel.koReplyOwed = true;
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
        rel.koReplyOwed = null;   // an unspent swan song dies with the waking
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
    /**
     * What she can FEEL of her own cycle — body-first flavor for her
     * disposition line, so asking about her fertility gets an honest,
     * in-character answer. Graded: outright knowledge + unmistakable signs
     * at the two extremes, softer signs on the shoulder days, silence
     * through the unremarkable mid-cycle days. Low affection gates whether
     * she VOLUNTEERS it, never whether she knows it.
     *
     * GROUNDED LANGUAGE ONLY (Dyna 2026-08-10): a woman talks about her
     * period, her fertile window, ovulating, getting pregnant — an NPC
     * quoted our game abstraction verbatim ("It's PEAK today. Like,
     * full-moon,"), so the moons, "peak"/"ebb", emoji, and percentages must
     * NEVER appear on any NPC-facing surface (they stay in the player's
     * Look readout and the editor). And no META-instructions about HOW to
     * speak ("she speaks as a woman does" got referenced like everything
     * else in context) — just WRITE the information in her vocabulary.
     * Words leak: whatever this function emits, she will say.
     */
    function cycleAwarenessLine(npcName) {
        const step = cycleStep(npcName);
        const share = getNpcAffection(npcName) <= 4
            ? ` She would not volunteer any of this to him unprompted — but it is her own body and she KNOWS it; asked directly, she may admit it plainly or deflect, as suits her character, never claim ignorance.`
            : '';
        switch (step) {
            case 4: return ` HER CYCLE — she is OVULATING today, the most fertile day of her whole cycle, and she knows her own body well enough to be sure of it: a deep warmth radiating off her skin, a rosy flush low across her belly, a heady sweetness to her scent that hangs close about her — anyone near enough can feel the heat coming off her. She knows that if she lay with a man today, she would very likely get pregnant.${share}`;
            case 3: return ` HER CYCLE — her fertile window has opened; she reckons she will ovulate tomorrow. Her body is warming toward it — skin running hot, the first hint of a flush low on her belly, her scent just beginning to sweeten.${share}`;
            case 5: return ` HER CYCLE — she ovulated yesterday and her fertile window is only now closing: the heat is still on her — skin warm, the low flush slow to fade, her scent still sweet. She knows she could still get pregnant.${share}`;
            case 0: return ` HER CYCLE — her period has come today: cramps make it unmistakable, a dull dragging ache low in her belly that has her craving warmth and rest. A true safe day — she cannot conceive right now, and she knows it.${share}`;
            case 7: return ` HER CYCLE — her period is due tomorrow: the first cramping twinges have started, a heaviness settling low in her belly. She can feel it coming on.${share}`;
            case 1: return ` HER CYCLE — her period is just winding down: the last cramping twinges fading, a faint low ache and a tiredness lingering. She knows she is still in the infertile stretch of her cycle.${share}`;
            default: return '';   // mid-cycle days (steps 2 & 6): unremarkable — her cycle says nothing worth a line
        }
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
    /** One conception attempt: `shots` rolls at her CURRENT fertility, applied.
     *  Shared by a creampie and by the Cum Plugged tick, so the two can never
     *  drift apart on what conceiving means. */
    function rollFertilization(npcName, shots) {
        const rel = getRelationship(npcName);
        const pct = fertilityPercent(npcName);
        const n = Math.max(1, shots);
        if ((rel.pregnancy_progress || 0) >= FERTILIZATION_LOCK_PCT) return { hits: 0, pct, shots: n, locked: true };
        let hits = 0;
        for (let r = 0; r < n; r++) if (Math.random() * 100 < pct) hits++;
        let xp = 0;
        if (hits > 0) {
            rel.pregnancies = (rel.pregnancies || 0) + hits;
            if (!rel.pregnancy_progress || rel.pregnancy_progress <= 0) rel.pregnancy_progress = 5; // conception = Zygote
            if (!rel.conceptionKind) rel.conceptionKind = resolveConceptionKind(npcName);  // egg / crystal / live
            // A confirmed impregnation is an achievement: flat 100 XP each
            // (Dyna 2026-08-10). Sits HERE so a creampie and a plug tick can
            // never drift apart on what conceiving pays.
            xp = 100 * hits;
            const rd = getPlayerRpgData();
            if (rd) rd.stats.experience = (rd.stats.experience || 0) + xp;
            savePlayer();
        }
        return { hits, pct, shots: n, xp };
    }

    /** Cum Plugged: every time step his sealed-in seed gets another go at her
     *  womb. Runs off the `refertilizes` flag, so any future preset that seals
     *  seed in gets the behaviour for free. */
    function plugRefertilize(quiet = false) {
        const rd = getPlayerRpgData(); if (!rd) return;
        for (const [name, rel] of Object.entries(rd.relationships || {})) {
            if (!(rel.customEffects || []).some(e => e.active !== false && e.refertilizes)) continue;
            const roll = rollFertilization(name, Math.max(1, effectiveStat('virility')));
            if (roll.locked) continue;                       // womb already committed
            if (quiet) continue;                             // advanceTimeBy summarizes
            if (roll.hits > 0) {
                sendGhostMessage(`🔒 **${name}** is still plugged full of him — ${roll.shots} shot${roll.shots > 1 ? 's' : ''} at ${roll.pct}% → 🌱 **${roll.hits} took** (✨ +${roll.xp} XP). She now carries **${rel.pregnancies}**.`);
            } else {
                sendGhostMessage(`🔒 **${name}** is still plugged full of him — ${roll.shots} shot${roll.shots > 1 ? 's' : ''} at ${roll.pct}%, none took this time.`);
            }
        }
    }

    // The cervix_press verb: he drives for her innermost gate during vaginal
    // sex. Ruggedness contest, DC stiffened by HER remaining Stamina — a fresh
    // woman's body holds its last door; a well-worn one gives. Success: the
    // Sanctuary Breached preset lands (+10 fertility, 2 periods) and the
    // breach itself wrings a climax out of her (her orgasm spends her 1
    // Stamina, same economy as any climax of hers). On a miss her reply plays
    // the sensation of a tight, unyielding cervix — never "he failed". The GM
    // is gated out of this result entirely (orchestration skips narration when
    // the verb fired) — her reply IS the outcome. Mechanically inert while she
    // already bears the status: her womb cannot be opened twice.
    // Base 8 (raised from 6, Dyna 2026-08-10 — the odds table said 6 was far
    // too easy): a fresh hero (rug 3) vs a woman with full fight in her
    // (4-5 Stamina) runs 17-28%, opening to 58-83% once she is worn down —
    // wearing her down IS the mechanic.
    const CERVIX_PRESS_DC_BASE = 8;
    function resolveCervixPress(npcName, dcMod = 0) {
        const name = resolveNpcName(npcName) || npcName;
        if (!name) return;
        if (npcActiveEffects(name).some(e => e.name === 'Sanctuary Breached')) return;   // already open — nothing left to force
        const rel = getRelationship(name);
        const herStamina = Math.max(0, rel.npcStamina ?? npcMaxStamina(name));
        const mod = Math.max(-2, Math.min(2, Math.round(Number(dcMod) || 0)));   // Action-Mode judge nudge, engine-clamped
        const dc = CERVIX_PRESS_DC_BASE + herStamina + mod;
        const c = skillCheck('ruggedness', dc);
        consumeCheckEffects('ruggedness');   // a one-use ruggedness pre-buff is spent on this trial like any other
        const line = skillCheckLine(c, `Her last gate — ${name}'s body resists (DC ${CERVIX_PRESS_DC_BASE} + her ${herStamina} Stamina${mod ? ` ${mod > 0 ? '+' : ''}${mod} situational` : ''})`);
        if (c.success) {
            addCustomStatus(name, { preset: 'sanctuary_breached' }, true);
            const xp = awardCheckXp(c);   // a won contest pays like any won check
            if (c.tier === 'critical') {
                queueStatusReaction(name, `His cockhead has JUST punched clean through her cervix in one motion — no grudging yield: her innermost ring gave way all at once and her womb takes the head of him entire. The shock detonates a climax through her THIS INSTANT: in her reply she comes harder than she has words for, her deepest muscle spasming around the intrusion as if to keep it.`);
                sendGhostMessage(`${line}\n🌟 Her cervix gives way ALL AT ONCE — it does not yield so much as open for him. **Sanctuary Breached** takes hold of ${name} (+10 fertility, 2 periods), and the shock detonates a climax through her. ✨ +${xp} XP`, { adversarial: true });
            } else {
                queueStatusReaction(name, `His cockhead has JUST forced its way through her cervix — the tight ring gave way and he is pressed into the mouth of her womb itself. The breach wrings a climax out of her ON THE SPOT: in her reply she comes, hard and involuntary, around the intrusion — her body's own answer to being opened where nothing has reached before.`);
                sendGhostMessage(`${line}\n💥 Her cervix yields — **Sanctuary Breached** takes hold of ${name} (+10 fertility, 2 periods), and the shock of it rips a climax out of her. ✨ +${xp} XP`, { adversarial: true });
            }
            spendNpcStamina(name, 1);   // that climax costs her what any climax costs
        } else if (c.tier === 'mixed') {
            queueStatusReaction(name, `He is bearing down on the very mouth of her womb and she can FEEL it almost give — her cervix flexing, dimpling inward under him, a terrifying, thrilling almost. It holds, this time, the tight ring quivering against the pressure. In her reply she responds to that razor's-edge sensation, whatever it stirs in her.`);
            sendGhostMessage(`${line}\n🚪 Her cervix holds — barely: it flexes and dimples inward around him, a hair from giving.`, { adversarial: true });
        } else if (c.tier === 'fumble') {
            queueStatusReaction(name, `He drove for the mouth of her womb and her body slammed its door: her cervix clamped down HARD, a guarded, jarring clench — sensitive, too deep, too much all at once. In her reply she reacts to that sharp deep jolt however her nature takes it.`);
            sendGhostMessage(`${line}\n🚪 Her cervix clamps shut and holds — her body answers the forcing with a hard, guarding clench.`, { adversarial: true });
        } else {
            queueStatusReaction(name, `He is grinding hard against the very mouth of her womb — and it HOLDS: her tight, unyielding cervical sphincter stays sealed, a blunt, bruising pressure on her innermost gate. In her reply she responds to that exact sensation — the deep grinding press against a door that has not opened, the ache and fullness of it, whatever it stirs in her.`);
            sendGhostMessage(`${line}\n🚪 Her cervix holds fast — tight and unyielding${herStamina > 2 ? ' (her body still has too much fight in it)' : ''}.`, { adversarial: true });
        }
    }

    // The belly_massage verb: skilled hands working her lower belly from
    // outside to rouse what sleeps beneath. CRAFTINESS contest (a deft,
    // knowing touch, not muscle) vs DC 7 + HER remaining Stamina (Dyna
    // 2026-08-11). Success → the Stimulated Ovaries preset (+10 fertility,
    // 1 period) and her reply plays the deep stirring; a miss stays what it
    // was — a pleasant massage, skin-deep, never a failed attempt. Inert
    // while she already bears the status. GM gated out like the other
    // intimate contests; the roll wears the adversarial red tint.
    const BELLY_MASSAGE_DC_BASE = 7;
    function resolveBellyMassage(npcName, dcMod = 0) {
        const name = resolveNpcName(npcName) || npcName;
        if (!name) return;
        if (npcActiveEffects(name).some(e => e.name === 'Stimulated Ovaries')) return;   // already roused — nothing left to wake
        const rel = getRelationship(name);
        const herStamina = Math.max(0, rel.npcStamina ?? npcMaxStamina(name));
        const mod = Math.max(-2, Math.min(2, Math.round(Number(dcMod) || 0)));   // Action-Mode judge nudge, engine-clamped
        const dc = BELLY_MASSAGE_DC_BASE + herStamina + mod;
        const c = skillCheck('craftiness', dc);
        consumeCheckEffects('craftiness');
        const line = skillCheckLine(c, `Knowing hands — ${name}'s depths resist waking (DC ${BELLY_MASSAGE_DC_BASE} + her ${herStamina} Stamina${mod ? ` ${mod > 0 ? '+' : ''}${mod} situational` : ''})`);
        if (c.success) {
            addCustomStatus(name, { preset: 'stimulated_ovaries' }, true);
            const xp = awardCheckXp(c);   // a won contest pays like any won check
            queueStatusReaction(name, `His hands have JUST worked her lower belly with real skill — slow, deep, knowing circles pressed low over her womb — and something has ANSWERED: a warm, fluttering heaviness blooming deep behind her navel, her ovaries roused and pleasantly aching awake. Her body is readying itself whether she wills it or not; in her reply she responds to that deep stirring warmth, however it lands in her nature.`);
            sendGhostMessage(`${line}\n🌸 Something deep in her answers his hands — **Stimulated Ovaries** takes hold of ${name} (+10 fertility, 1 period). ✨ +${xp} XP`, { adversarial: true });
        } else {
            queueStatusReaction(name, `He is kneading her lower belly — warm, pleasant, well-meant pressure low over her navel. And it stays exactly that: a nice massage, skin-deep, nothing stirring beneath. In her reply she responds to the simple comfort of warm hands on her belly, however that lands in her nature.`);
            sendGhostMessage(`${line}\n🤲 A pleasant kneading, no more — nothing beneath her skin stirs${herStamina > 2 ? ' (her body has too much vigor to be coaxed so easily)' : ''}.`, { adversarial: true });
        }
    }

    // The milk_attempt verb — HER roll (the under-explored half of the dice).
    // She is dominantly forcing his climax: 2d6 + HER remaining Stamina vs
    // DC 7 + HIS remaining Stamina (with the usual ±3 doubles swing). Base 7
    // puts an even stamina match at 58% for her — the closest 2d6 step to
    // Dyna's 50/50, breaking toward the woman bold enough to try; each point
    // of stamina difference moves it ~14%. If she wins: the GM briefly
    // narrates HIS side only (a surprised moan, the climax forced out of him
    // — or the dry, cramping spasm if he has nothing to give), she savors it
    // with wicked satisfaction in her reply, and mechanically (vaginal, with
    // potency intact) his WHOLE reserve goes at once: fertilization shots =
    // his remaining Stamina × effective virility + 1, then −1 Stamina, then
    // Milked Dry (−2 virility, 3 periods, refresh not stack). A miss is him
    // holding out under her — her note plays hunger thwarted, never defeat.
    const MILK_BASE_RESIST = 7;
    async function resolveMilkAttempt(eff) {
        const name = resolveNpcName(eff?.npc || eff?.target);
        if (!name) return;
        const rel = getRelationship(name);
        if (rel.npcUnconscious) return;                    // an unconscious woman dominates nobody
        const herStamina = Math.max(0, rel.npcStamina ?? npcMaxStamina(name));
        const hisStamina = getStamina();
        const dc = MILK_BASE_RESIST + hisStamina;
        const d1 = rollDie(), d2 = rollDie();
        const swing = (d1 === 6 && d2 === 6) ? 3 : (d1 === 1 && d2 === 1) ? -3 : 0;
        const total = d1 + d2 + herStamina + swing;
        const success = total >= dc;
        const swingStr = swing > 0 ? ' **+3 DOUBLE SIXES!**' : swing < 0 ? ' **−3 snake eyes!**' : '';
        const channel = String(eff?.channel || 'other').toLowerCase();
        const line = `🎲 **Her hips set the law — ${name} works him to milk him dry** (her ${herStamina} Stamina vs DC ${MILK_BASE_RESIST} + his ${hisStamina})\n` +
            `Rolled 2d6 [${d1}+${d2}=${d1 + d2}] + ${herStamina}${swingStr} = **${total}** vs DC ${dc}`;
        if (!success) {
            // Holding out IS his win in this contest — and won contests pay.
            // Priced by unlikelihood like every check: the likelier she was
            // to take him, the more the hold is worth.
            const xp = Math.max(1, successChance(herStamina, dc));
            { const rd = getPlayerRpgData(); if (rd) { rd.stats.experience = (rd.stats.experience || 0) + xp; savePlayer(); } }
            sendGhostMessage(`${line} → 🛡️ **he holds** — jaw tight, he keeps himself his own. ✨ +${xp} XP`, { adversarial: true });
            queueStatusReaction(name, `She is working him with everything she has, setting the rhythm herself, bent on forcing his release — and he is HOLDING, white-knuckled, keeping it from her. In her reply she responds to a man withstanding her — however that lands in her nature: hunger sharpened, pride pricked, the game deepening. She has not finished with him.`);
            return;
        }
        const dry = Math.max(0, effectiveStat('virility')) <= 0 || hisStamina <= 0;
        const effVir = Math.max(0, effectiveStat('virility'));
        // His whole reserve goes at once — counted BEFORE the climax spends him.
        const shots = hisStamina * effVir + 1;
        let mech = '';
        // Dry or loaded, the climax itself costs him like any other.
        if (hisStamina > 0) spendStamina(1);
        {
            const rdNow = getPlayerRpgData();
            if (rdNow) rdNow.stats.lastOrgasmStep = currentGameState.timeStep || 0;
        }
        if (!dry) {
            if (channel === 'vaginal') {
                rel.lastCreampieStep = currentGameState.timeStep || 0;
                const roll = rollFertilization(name, shots);
                mech = roll.locked
                    ? `\n💦 He empties EVERYTHING into her — ${shots} shots — but her womb is already committed.`
                    : `\n💦 He empties EVERYTHING into her at once — ${roll.shots} shots at ${roll.pct}% → ${roll.hits > 0 ? `🌱 **${roll.hits} took** (✨ +${roll.xp} XP) — she now carries **${rel.pregnancies}**` : 'none took'}.`;
            } else {
                mech = `\n💦 He empties everything he has — ${shots} shots' worth, wrung out ${channel === 'oral' ? 'straight down her throat' : 'into her hands and keeping'} — none of it anywhere it could take root.`;
            }
        } else {
            mech = `\n${DRY_ORGASM_LINE}`;
        }
        // Milked Dry: refresh, never stack — −4 virility would double-punish.
        const existing = playerCustomEffects().find(e => e.name === 'Milked Dry');
        if (existing) existing.expiresStep = (currentGameState.timeStep || 0) + 3;
        else addCustomStatus('player', { preset: 'milked_dry' }, true);
        savePlayer();
        sendGhostMessage(`${line} → 💥 **she takes it from him**${mech}\n🥛 **Milked Dry** ${existing ? 'deepens its hold' : 'takes hold'} (−2 virility, 3 periods).`, { adversarial: true });
        queueStatusReaction(name, dry
            ? `She has JUST forced a climax out of him — and it came up EMPTY: his body arched and spasmed through a dry, fruitless orgasm, nothing left in him to give, only helpless flexing and a deep cramping wince. In her reply she savors it with open, wicked satisfaction — she has milked him past empty, on her terms, and his dry shudders are her trophy.`
            : `She has JUST forced his orgasm out of him herself — made him cum, hard and helpless and in shocking volume, entirely on her terms${channel === 'vaginal' ? ', every drop of it pumped up inside her' : channel === 'oral' ? ', every drop of it hers to swallow' : ''}. In her reply she savors it with open, wicked satisfaction — her domination worked, his release belongs to her, and she lets him know it.`);
        // The GM speaks HIS side only, briefly — the one narration this verb wants.
        try {
            const sys = `You are the GAME MASTER narrator of an adult RPG. In 1-2 vivid sentences, narrate ONLY the player's own involuntary reaction — never the woman's words, actions, or expressions (she answers for herself next). If you need to reason, use <think></think>; the narration itself is pure prose.`;
            const prompt = dry
                ? `${name} has just forced the player's orgasm entirely against his control — but he has NOTHING left to give: narrate his surprised, helpless moan as the climax tears through him and comes up DRY — a hard, flexing spasm with no ejaculate at all, and a deep cramping ache seizing his balls and abdomen.`
                : `${name} has just forced the player's orgasm entirely against his control: narrate his surprised, helpless moan and the climax being ripped out of him — incredibly hard, in extreme volume, utterly beyond his will.`;
            const gm = await generateProse({ prompt, systemPrompt: sys, budget: 220, rescuePrefill: 'A ' });
            if (gm) sendGameMasterMessage(gm);
        } catch (e) { console.error('RPG Custodian: milk narration failed', e); }
    }

    // A DRY orgasm: nothing left to give — either his potency is wrung out
    // (effective virility 0, e.g. Milked Dry) or his body is spent to nothing
    // (0 Stamina). Shared flavor for both, and the partner is TOLD, so she
    // reacts to the empty spasm instead of acting like he came normally.
    const DRY_ORGASM_LINE = `💦 A **DRY orgasm** — the pressure builds and builds and breaks into a hard, flexing spasm with nothing behind it: no ejaculate comes at all, only a deep cramping ache seizing his balls and lower belly.`;
    function queueDryOrgasmNote(npcName) {
        if (!npcName) return;
        queueStatusReaction(npcName, `He has JUST climaxed DRY with her: his body spasmed through the full motions of an orgasm and NOTHING came — no ejaculate at all, only helpless flexing and a wince of deep, cramping pain low in his belly. She can tell the difference plainly; in her reply she reacts to THAT — a man wrung past empty — not to any normal finish.`);
    }

    // One player orgasm: −1 Stamina; if internal & P-in-V, roll fertilization
    // VIRILITY times, each at her Fertility% — so a single climax can take
    // multiple times (twins/triplets). `count` handles several climaxes.
    function resolvePlayerOrgasm(npcName, internal, count = 1) {
        let conceived = 0;
        const lines = [];
        for (let i = 0; i < Math.max(1, count); i++) {
            if (getPlayerRpgData()?.stats.unconscious) {
                // Spent to nothing: his body can still be wrung through the
                // motions, but it is a dry, cramping spasm — and she knows it.
                lines.push(DRY_ORGASM_LINE);
                queueDryOrgasmNote(npcName);
                break;
            }
            spendStamina(1);
            const rdNow = getPlayerRpgData();
            if (rdNow) rdNow.stats.lastOrgasmStep = currentGameState.timeStep || 0;   // resets Pent Up
            // Wrung-out potency (Milked Dry can floor virility): the climax
            // still happens and still costs, but nothing comes of it.
            if (Math.max(0, effectiveStat('virility')) <= 0) {
                lines.push(`${DRY_ORGASM_LINE} (−1 Stamina, now ${getStamina()}/${maxStamina()})`);
                queueDryOrgasmNote(npcName);
                continue;
            }
            let line = `💦 Climax — −1 Stamina (now ${getStamina()}/${maxStamina()})`;
            if (internal && npcName) {
                const rel = getRelationship(npcName);
                if ((rel.pregnancy_progress || 0) >= FERTILIZATION_LOCK_PCT) {
                    // Fetal stage onward — womb already committed, can't take again.
                    line += ` · (already carrying, ${pregnancyStage(rel.pregnancy_progress)} — cannot conceive again)`;
                } else {
                    const roll = rollFertilization(npcName, Math.max(1, effectiveStat('virility')));
                    line += ` · ${roll.shots} shot${roll.shots > 1 ? 's' : ''} at ${roll.pct}% → ${roll.hits > 0 ? `🌱 ${roll.hits} took` : 'none took'}`;
                    conceived += roll.hits;
                }
                // She is holding his seed as of now — what a plug would seal in.
                rel.lastCreampieStep = currentGameState.timeStep || 0;
                savePlayer();
            }
            lines.push(line);
            if (getPlayerRpgData()?.stats.unconscious) { lines.push('🥴 Spent utterly — you are wrung out to nothing.'); break; }
        }
        if (conceived && npcName) {
            const rel = getRelationship(npcName);
            const multi = conceived === 1 ? '' : conceived === 2 ? ' (twins!)' : conceived === 3 ? ' (triplets!)' : ` (${conceived} at once!)`;
            lines.push(`🤰 ${conceived} new fertilization${conceived > 1 ? 's' : ''} this encounter${multi} (✨ +${conceived * 100} XP) — ${npcName} now carries **${rel.pregnancies}** total.`);
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
        // Won contests pay XP wherever the PLAYER is the winner: landing his
        // own casting, or shrugging off a hex aimed at him.
        const playerCast = !(eff.power != null) && !(eff.caster && eff.caster !== 'player');
        let xpNote = '';
        if (playerCast && c.success) {
            const xp = awardCheckXp({ success: true, base: attack, boost: 0, difficulty: c.dc });
            xpNote = ` ✨ +${xp} XP`;
        } else if (!playerCast && target === 'player' && !c.success) {
            const xp = Math.max(1, successChance(attack, c.dc));
            { const rd = getPlayerRpgData(); if (rd) { rd.stats.experience = (rd.stats.experience || 0) + xp; savePlayer(); } }
            xpNote = ` ✨ +${xp} XP`;
        }
        sendGhostMessage(`💠🎲 **Crystal Curse — resist contest**: ${attackerLabel} (power ${attack}) vs ${targetLabel}'s Ruggedness ${c.resist} → 2d6 [${c.dice}] + ${attack} = **${c.total}** vs DC ${c.dc} → ${c.success ? '💠 **the curse takes hold!**' : '🛡️ **RESISTED** — the hex slides off.'}${xpNote}`, { adversarial: true });
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
    // ── Preset statuses ───────────────────────────────────────────────────
    // Recurring situations whose effect is always the same. Authored ONCE here
    // so the Custodian only has to NAME the preset — it never has to remember
    // the mods, the magnitude, the duration or how the thing ends. That keeps
    // the if/else in code where it belongs and costs the prompt one line
    // instead of a rule block per effect.
    // `side` marks who a preset makes sense on ('npc' | 'player'; absent =
    // both) — it only filters the one-tap chips in the effect requesters,
    // never what the Custodian may target in play.
    const PRESET_STATUSES = {
        cum_plugged: {
            name: 'Cum Plugged', kind: 'status', polarity: 'neutral', side: 'npc',
            desc: 'Sealed shut with his seed still inside her, so none of it can escape — it keeps working at her womb for as long as the plug holds.',
            endCondition: 'the plug is pulled out of her, or his seed is let out of her',
            mods: [],
            refertilizes: true,     // engine: another go at her womb every time step
        },
        stimulated_ovaries: {
            name: 'Stimulated Ovaries', kind: 'buff', polarity: 'positive', side: 'npc',
            desc: 'Her ovaries have been roused by the working of her lower belly — for a little while she is far readier to take.',
            mods: [{ stat: 'fertility', amount: 10 }],
            duration: 1,
        },
        pent_up: {
            name: 'Pent Up', kind: 'buff', polarity: 'positive', side: 'player',
            desc: 'He has gone unspent too long — the pressure has him potent and hair-triggered, his seed thick with waiting.',
            mods: [{ stat: 'virility', amount: 1 }],
            endCondition: 'he finds release',
        },
        milked_dry: {
            name: 'Milked Dry', kind: 'debuff', polarity: 'negative', side: 'player',
            desc: 'She forced everything out of him at once — wrung empty, his potency is gone until his body can rebuild it.',
            mods: [{ stat: 'virility', amount: -2 }],
            duration: 3,
        },
        sanctuary_breached: {
            name: 'Sanctuary Breached', kind: 'status', polarity: 'positive', side: 'npc',
            desc: 'Her cervix has been forced open and the way to her womb stands claimed — her deepest chamber lies open and defenseless to his seed.',
            mods: [{ stat: 'fertility', amount: 10 }],
            duration: 2,
        },
    };
    function resolvePresetStatus(spec) {
        const key = String(spec?.preset || '').toLowerCase().replace(/[\s-]+/g, '_');
        const preset = PRESET_STATUSES[key];
        if (!preset) return spec;
        // The preset wins on everything it defines; anything the Custodian sent
        // alongside it (a target, a note) is kept underneath.
        return { ...spec, ...preset };
    }

    // A quest, oath, pact, or errand IS a "silent status" — same store, same
    // end-condition watcher. category:'quest' completes with a reward when met.
    function addCustomStatus(target, spec, quiet = false) {
        spec = resolvePresetStatus(spec);
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
        // Quest XP is engine-owned and FLAT: every quest pays exactly 200 XP
        // on completion, whatever the model suggested (Dyna 2026-08-10 — a
        // quest paid 5 XP). Gold, tokens, and items remain invented flavor.
        if (category === 'quest') rec.reward = { ...(rec.reward || {}), xp: 200 };
        if (spec.refertilizes) rec.refertilizes = true;   // ticked by plugRefertilize
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
        // Flat 200 XP enforced here too, so quests from saves that predate
        // the standardization still pay correctly.
        const reward = { ...(e.reward || {}), xp: 200 };
        grantReward(reward);
        const rw = rewardLabel(reward);
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
            // Arousal cools by 3 per time period toward calm (romance-redesign
            // §D; raised from 1 on 2026-07-28 and from 2 on 2026-08-08, both
            // Dyna — it lingered too long) — bodies cool off; affection
            // doesn't. Step-guarded so a repeated prune in the same period
            // can't double-decay.
            if ((rel.arousal ?? 0) > 0 && rel.arousalDecayStep !== step) {
                rel.arousal = Math.max(0, (rel.arousal ?? 0) - 3);
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
            const parsed = await generateJson({ prompt, systemPrompt: sys, budget: 300, concurrent: true });
            return (parsed && typeof parsed === 'object') ? parsed : {};
        } catch (e) { console.error('RPG Custodian: condition eval failed', e); return {}; }
    }
    // Run after a turn's story resolves: end statuses / break curses whose
    // condition the story just satisfied. One judge call per turn (only if pending).
    function collectPendingConditions() {
        const rd = getPlayerRpgData(); if (!rd) return [];
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
        return pending;
    }

    /** Apply a condition verdict — ends statuses, breaks curses, closes
     *  objectives. Synchronous and ordered, for the same reason the reaction
     *  verdict is: "⚖️ your oath is discharged" must not surface mid-reply. */
    function applyConditionVerdicts(pending, verdict) {
        for (const p of (pending || [])) {
            if (verdict[p.id] !== true) continue;
            if (p.kind === 'quest') completeObjective(p.target, p.ref);
            else if (p.kind === 'status') removeCustomStatus(p.target, p.name, 'its condition was met');
            else if (p.kind === 'curse') liftCrystalCurse(p.target);
        }
    }

    async function checkPendingConditions() {
        const pending = collectPendingConditions();
        if (!pending || !pending.length) return;
        applyConditionVerdicts(pending, await evaluateConditions(pending.map(p => ({ id: p.id, text: p.text }))));
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
        savePlayer();
        sendGhostMessage(item.equipped
            ? `🎽 Equipped **${prettyItem(item.name)}**${item.effectText ? ` — ${item.effectText}` : ''}.`
            : `👝 Removed **${prettyItem(item.name)}**.`);
    }
    function setEquipItemByName(name, on) {
        const it = useItemByNameFuzzy(name);
        if (!it) return;
        if (on && itemIsConsumable(it)) { useItem(it); return; }   // "equip the potion" → just use it
        it.equipped = on;
        savePlayer();
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
            if (item.head) {
                pop.append('<div class="rpg-menu-sep"></div>');
                pop.append($('<div class="rpg-item-head"></div>').text(item.head));
                continue;
            }
            const row = $(`<div class="rpg-menu-item${item.big ? ' rpg-item-big' : ''}"></div>`);
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
        // Center-bottom, above the RPG button / input row.
        const btn = document.getElementById('rpg-menu-button');
        const anchorTop = btn ? btn.getBoundingClientRect().top : window.innerHeight - 120;
        const el = pop[0];
        const left = Math.max(8, Math.min((window.innerWidth - el.offsetWidth) / 2, window.innerWidth - el.offsetWidth - 8));
        let top = anchorTop - el.offsetHeight - 8;
        if (top < 8) top = 8;
        pop.css({ left: `${left}px`, top: `${top}px` });
        setTimeout(() => $(document).one('click.rpgActionPop', () => $('#rpg-action-popup').remove()), 0);
    }

    // The game verbs live in the RPG menu (toggleRpgMenu) — the old bottom
    // action bar was removed 2026-08-05 because it ate chat space. These
    // builders run at CLICK time, so presence/party/gold are always current.
    // No per-NPC mechanical buttons (shop/wrestle/quest) — those are handled
    // through natural language via the Intent Analyzer.
    function openTravelPopup() {
        // After each hop the popup reopens at the NEW location (Dyna's flow:
        // chain moves without reopening the menu); dismiss by tapping away.
        const items = visibleConnections(currentGameState.currentLocation).map(c => ({
            icon: '🚪', label: currentGameState.worldData.locations[c]?.name || c, big: true,
            action: async () => { await moveCommand({}, c); if (currentGameState.isActive) openTravelPopup(); },
        }));
        openActionPopup(`Travel to… (from ${locName(currentGameState.currentLocation)})`, items);
    }
    function openLookPopup() {
        const present = getNpcsAt(currentGameState.currentLocation);
        const items = [
            { icon: '🏞️', label: 'Examine your surroundings', action: () => lookCommand({}, '') },
            { icon: '🪞', label: 'Look at yourself', sub: 'your stats, stamina, gold & buffs', action: () => examineSelf() },
        ];
        for (const npc of present) items.push({ icon: '🔍', label: `Look at ${npc.name}`, sub: npc.role, action: () => examineNpc(npc.name) });
        openActionPopup('Look at…', items);
    }
    // Party management — deliberately narration-free bookkeeping. The NL
    // path keeps its in-character farewell; these rows never call an LLM.
    // A bound or unconscious woman does not fall in behind you because a
    // menu said so — arbitrating that stays the Custodian's job.
    function canButtonJoin(name) {
        const rel = getRelationship(name);
        return !rel.npcUnconscious &&
            !(rel.customEffects || []).some(e => e.active !== false && e.immobilizes && e.pinnedAt);
    }
    function partyJoinable() {
        const party = currentGameState.party || [];
        return getNpcsAt(currentGameState.currentLocation).filter(n => !party.includes(n.name) && canButtonJoin(n.name));
    }
    function openPartyPopup() {
        const party = currentGameState.party || [];
        const items = [];
        for (const npc of partyJoinable()) {
            items.push({ icon: '🤝', label: `${npc.name} joins the party`, sub: npc.role, action: () => addToParty(npc.name) });
        }
        for (const name of party) {
            if (getRelationship(name).npcUnconscious) {
                items.push({ icon: '💤', label: `Leave ${name} here`, sub: 'unconscious — she stays until she wakes', action: () => removeFromParty(name, { quiet: true }) });
                continue;
            }
            items.push({ icon: '👋', label: `Part with ${name} — she stays here`, sub: 'lingers here until time moves on', action: () => removeFromParty(name, { quiet: true }) });
            const dest = scheduledLocationFor(name);
            items.push({ icon: '🏠', label: `Part with ${name} — back to her routine`, sub: dest && dest !== currentGameState.currentLocation ? `off to ${locName(dest)}` : 'resumes her schedule here', action: () => removeFromParty(name, { quiet: true, resumeSchedule: true }) });
        }
        openActionPopup('Party…', items);
    }

    // ========================================================================
    // VERB DICTIONARY — in-game documentation, never a control surface.
    // Every natural-language game action, sorted, with who can invoke it:
    // 'you' (the player's words), 'her' (an NPC's own words), 'both', or
    // 'auto' (the engine judges it without anyone asking). Entries with an
    // `id` MUST match a real effect case in the engine — the drift test
    // (test/verb-dictionary-test.js) cross-checks this file's switch cases
    // against this registry in both directions, so the list can never rot.
    // ========================================================================
    const VERB_DICTIONARY = [
        { head: 'Travel & World', entries: [
            { id: 'move', who: 'both', name: 'Move', desc: 'travel anywhere known — routed step by step ("Let\'s go to the tavern!" / "Ok!")' },
            { who: 'both', name: 'Journey (multi-hop)', desc: 'name a far destination — the engine walks the whole route leg by leg through the map' },
            { who: 'you', name: 'Enter a Secret Place', desc: 'hidden doors and unlisted places are real destinations once the story finds them' },
            { id: 'event_teleport', who: 'auto', name: 'Translocation', desc: 'a power — magic, entity, technology — puts you somewhere; reaches places no road does' },
            { id: 'examine', who: 'you', name: 'Examine', desc: 'look closely at someone, or take stock of yourself' },
            { id: 'whereabouts', who: 'you', name: 'Ask Whereabouts', desc: 'ask where someone is — answered from what the asked one honestly knows' },
        ]},
        { head: 'Checks & Contests', entries: [
            { who: 'you', name: 'Charm Check', desc: 'propositions and persuasion — the roll decides whether she accepts your framing, never how she feels' },
            { who: 'you', name: 'Craftiness Check', desc: 'intellect, perception & dexterity in one — locks, hidden things, crafting, sleight of hand, spellwork' },
            { who: 'you', name: 'Ruggedness Check', desc: 'strength, endurance, combat — pin a wild wolf, force a door, climb the sheer cliff' },
            { who: 'you', name: 'Wrestle a Person', desc: 'a physical contest against someone uses her own listed difficulty — keeping up is easier than overpowering' },
            { who: 'auto', name: 'Trivial Actions', desc: 'what you cannot fail is never rolled — the engine auto-succeeds it without theater' },
            { who: 'auto', name: 'Boxcars & Snake Eyes', desc: 'double sixes swing +3 and double ones −3 — the dice themselves carry the drama' },
            { who: 'auto', name: 'One-Use Pre-Buffs', desc: 'a battle draught or blessing is spent on your NEXT trial of that stat, win or lose' },
            { who: 'auto', name: 'Check XP', desc: 'a won check pays XP by how unlikely it was; completed quests pay a flat 200' },
        ]},
        { head: 'Time, Rest & Sustenance', entries: [
            { id: 'advance_time', who: 'both', name: 'Time Passes', desc: 'an afternoon whiled away, a night talked through — the clock follows the story' },
            { id: 'rest', who: 'both', name: 'Rest', desc: 'sleep, nap, or camp — everyone\'s Stamina and your Mana refill; one period passes' },
            { id: 'sustenance', who: 'you', name: 'Eat & Drink', desc: 'any ordinary meal or drink restores 1 Stamina (never above max)' },
        ]},
        { head: 'Company', entries: [
            { id: 'add_party', who: 'both', name: 'Join Party', desc: 'she travels at your side, her routine suspended — invited, or offering herself' },
            { id: 'remove_party', who: 'both', name: 'Part Ways', desc: 'she stays where you parted until time moves on, then resumes her life' },
        ]},
        { head: 'Goods & Gold', entries: [
            { id: 'adjust_gold', who: 'both', name: 'Gold Changes Hands', desc: 'earned, spent, gifted, stolen' },
            { id: 'add_item', who: 'both', name: 'Gain Item', desc: 'found, given, crafted, looted — the Custodian appraises what it does' },
            { id: 'remove_item', who: 'both', name: 'Lose Item', desc: 'given away, consumed in crafting, destroyed, taken' },
            { id: 'buy_item', who: 'you', name: 'Buy', desc: 'purchase from a merchant\'s stock' },
            { id: 'use_item', who: 'you', name: 'Use Item', desc: 'drink the potion, read the scroll — consumables spend themselves' },
            { id: 'equip_item', who: 'you', name: 'Equip', desc: 'wear or wield a thing so its effect applies' },
            { id: 'unequip_item', who: 'you', name: 'Unequip', desc: 'set it aside again' },
        ]},
        { head: 'Body & Battle', entries: [
            { id: 'damage', who: 'both', name: 'Harm', desc: 'anyone can be hurt — a blow, a fall, a beast; Stamina is the wound track' },
            { id: 'heal', who: 'both', name: 'Heal', desc: 'medicine, first aid, restoration magic — mends Stamina, revives the unconscious' },
            { id: 'restore_mana', who: 'both', name: 'Restore Mana', desc: 'an arcane source refills the well — a spring, a draught, a crushed soulgem' },
        ]},
        { head: 'Intimacy & Breeding', entries: [
            { id: 'orgasm', who: 'you', name: 'His Climax', desc: 'costs 1 Stamina; inside her it rolls fertilization — hers is read from HER reply, never declared' },
            { id: 'cervix_press', who: 'you', name: 'Cervix Press', desc: 'drive for her innermost gate — Ruggedness vs her remaining vigor; her womb can open' },
            { id: 'belly_massage', who: 'you', name: 'Ovary Stimulation', desc: 'knowing hands on her lower belly — Craftiness vs her vigor; can rouse her ovaries' },
            { id: 'milk_attempt', who: 'her', name: 'Milked Dry', desc: 'SHE dominantly forces his climax — her own words only; her vigor against his' },
            { id: 'birth', who: 'auto', name: 'Birth', desc: 'term pregnancies deliver — live young, eggs, or soulgems; each birth pays a Power Token' },
        ]},
        { head: 'Hearts & Minds', entries: [
            { id: 'adjust_affection', who: 'auto', name: 'Affection (external)', desc: 'potions, spells, curses only — her real feelings move through her own replies' },
            { id: 'adjust_arousal', who: 'auto', name: 'Arousal (external)', desc: 'likewise — her blood stirred by something outside the ordinary' },
            { who: 'auto', name: 'The Reaction Judge', desc: 'every reply of hers is read against her disposition — affection and arousal move from HER words' },
            { who: 'auto', name: 'Her Climax', desc: 'read from her own reply — an involuntary crisis in her body, never his to declare' },
        ]},
        { head: 'Statuses, Curses & Oaths', entries: [
            { id: 'add_status', who: 'both', name: 'Lasting Effect', desc: 'anything that lingers — buff, disease, vow, restraint, blessing — one system, many faces' },
            { id: 'remove_status', who: 'both', name: 'Effect Lifted', desc: 'released, cured, fulfilled — the story ends what the story started' },
            { id: 'apply_curse', who: 'both', name: 'Crystal Curse', desc: 'a contested working — the cursed bear soulgems instead of children until lifted' },
            { id: 'lift_curse', who: 'both', name: 'Lift the Curse', desc: 'magic strong enough can break it' },
            { id: 'add_objective', who: 'you', name: 'Take On a Task', desc: 'quests, errands, pacts, vows of YOURS — auto-completes when the story satisfies it; 200 XP' },
            { id: 'adjust_stat', who: 'auto', name: 'Permanent Change', desc: 'rare: training mastery or dark magic moves a core stat for good' },
            { who: 'auto', name: 'The Condition Judge', desc: 'watches every end-condition and objective — effects end and quests complete on their own' },
        ]},
        { head: 'Magic — Action Mode only', entries: [
            { who: 'you', name: 'Cast a Spell', desc: 'RPG menu → Action Mode → Cast a Spell — spells never fire from prose alone' },
        ]},
    ];
    function openVerbDictionary() {
        const WHO = { you: '🧍', her: '👩', both: '🤝', auto: '⚙️' };
        const items = [{ head: 'Legend — 🧍 your words · 👩 her words · 🤝 either · ⚙️ automatic' }];
        for (const cat of VERB_DICTIONARY) {
            items.push({ head: cat.head });
            for (const v of cat.entries) items.push({ icon: WHO[v.who] || '·', label: v.name, sub: v.desc, action: () => {} });
        }
        openActionPopup('📖 Verb Dictionary — what can happen here', items);
    }

    // ========================================================================
    // ACTION MODE — menu-declared intent (RPG menu → 🎯 Action Mode).
    // The menu declares WHAT; a small judge reads HOW and WHO from the scene.
    // Arming is ONE-SHOT: the next message performs exactly the armed action —
    // the freeform Custodian pipeline is bypassed for that message entirely
    // (no analyzer, no other verbs). Freeform play keeps every verb it has;
    // spellcasting exists ONLY here (the player shouldn't have to remember a
    // spellbook in prose, and neither should the Custodian's context).
    // ========================================================================
    const SPELL_CATALOG = {
        summon_lover: {
            name: 'Summon Lover', tier: 'Greater', cost: 4,
            desc: 'pull a woman you know across any distance to your side — she stays with you until time moves on',
            needsWoman: true,
        },
    };
    function knownSpells() {
        const rd = getPlayerRpgData(); if (!rd) return [];
        // Prototype seed: the first spell is simply known. Acquisition paths
        // (forge, tomes, teaching, tokens) come with the full spellcraft system.
        if (!Array.isArray(rd.spells)) { rd.spells = ['summon_lover']; savePlayer(); }
        return rd.spells;
    }
    // Menu-armable intimate contests — same resolvers freeform play uses, so
    // the two input paths can never drift.
    const ROMANCE_ACTIONS = {
        belly_massage: { label: 'Ovary Stimulation', desc: 'work her lower belly with knowing hands — Craftiness against her remaining vigor', run: (t, mod) => resolveBellyMassage(t, mod) },
        cervix_press: { label: 'Cervix Press', desc: 'drive for her innermost gate during sex — Ruggedness against her remaining vigor', run: (t, mod) => resolveCervixPress(t, mod) },
    };

    function armAction(a) {
        currentGameState.armedAction = a;   // transient — deliberately not in the save
        const ta = document.getElementById('send_textarea');
        if (ta) {
            ta.classList.add('rpg-armed');
            if (ta.dataset.rpgPh == null) ta.dataset.rpgPh = ta.getAttribute('placeholder') || '';
            ta.setAttribute('placeholder', `🎯 ${a.label} — ${a.desc} · your next message performs it (describe how you do it)`);
        }
        wmToast(`Armed: ${a.label}`, 'success');
    }
    function disarmAction(announce = false) {
        currentGameState.armedAction = null;
        const ta = document.getElementById('send_textarea');
        if (ta) {
            ta.classList.remove('rpg-armed');
            if (ta.dataset.rpgPh != null) { ta.setAttribute('placeholder', ta.dataset.rpgPh); delete ta.dataset.rpgPh; }
        }
        if (announce) wmToast('Action disarmed.', 'success');
    }

    function openActionModeMenu() {
        const armed = currentGameState.armedAction;
        const rd = getPlayerRpgData();
        const items = [
            { icon: '🪄', label: 'Cast a Spell', sub: `Mana ${rd?.stats.mana ?? 0}/${maxMana()}`, action: () => openSpellMenu() },
            { icon: '💋', label: 'Romance', sub: 'intimate contests, aimed deliberately', action: () => openRomanceActionMenu() },
            { icon: '⚔️', label: 'Combat', sub: 'the combat system will live here — not built yet', action: () => openActionModeMenu() },
        ];
        if (armed) items.push({ icon: '✖️', label: `Cancel — ${armed.label}`, sub: 'disarm without acting', action: () => disarmAction(true) });
        openActionPopup(`🎯 Action Mode${armed ? ` — armed: ${armed.label}` : ''}`, items);
    }
    function openSpellMenu() {
        const rd = getPlayerRpgData();
        const mana = rd?.stats.mana ?? 0;
        const items = [];
        for (const id of knownSpells()) {
            const sp = SPELL_CATALOG[id];
            if (!sp) continue;
            if (sp.needsWoman) {
                const women = Object.keys(rd?.relationships || {}).filter(n => (currentGameState.npcRoster || []).some(x => x.name === n));
                if (!women.length) items.push({ icon: '🪄', label: sp.name, sub: 'you know no one to call to you yet', action: () => openSpellMenu() });
                for (const w of women) {
                    const here = getNpcsAt(currentGameState.currentLocation).some(n => n.name === w);
                    const block = here ? 'already at your side'
                        : getRelationship(w).npcUnconscious ? 'she is unconscious — nothing would answer'
                        : mana < sp.cost ? `not enough Mana (${mana}/${sp.cost})` : null;
                    items.push({
                        icon: block ? '⛔' : '🪄',
                        label: `${sp.name}: ${w}`,
                        sub: block || `${sp.cost} Mana · ${sp.desc}`,
                        action: () => { if (block) { openSpellMenu(); return; } armAction({ kind: 'spell', id, woman: w, label: `${sp.name}: ${w}`, desc: sp.desc, cost: sp.cost }); },
                    });
                }
            }
        }
        openActionPopup(`🪄 Cast a Spell — Mana ${mana}/${maxMana()}`, items);
    }
    function openRomanceActionMenu() {
        const items = Object.entries(ROMANCE_ACTIONS).map(([id, a]) => ({
            icon: '💋', label: a.label, sub: a.desc,
            action: () => armAction({ kind: 'romance', id, label: a.label, desc: a.desc }),
        }));
        openActionPopup('💋 Romance', items);
    }

    /** The Action Mode Judge: never chooses the action, never owns an outcome.
     *  It reads the player's words + the scene and reports target, a CLAMPED
     *  situational difficulty nudge, and a narration hint. */
    async function actionModeJudge(armed, playerText, candidates = []) {
        try {
            const sys = `You are the ACTION JUDGE of an adult fantasy RPG. A mechanical action was already chosen from a menu — you NEVER choose, change, or resolve the action, and you have no authority over outcomes. From the player's words and the scene, report ONLY: the target (choose from CANDIDATES only; null if truly none fits), a situational difficulty modifier from -2 (circumstances clearly favor the attempt) to +2 (circumstances clearly hinder it), 0 when unremarkable, a short reason for it, and a one-line narration hint capturing how he goes about it. Output ONLY JSON: {"target_npc":"name or null","dc_mod":N,"reason":"...","narration_hint":"..."}`;
            const prompt = `DECLARED ACTION: ${armed.label} — ${armed.desc}\nCANDIDATE TARGETS: ${candidates.join(', ') || '(none)'}\nPLAYER'S WORDS: "${playerText}"\nRECENT SCENE:\n${recentSceneForAnalyzer()}`;
            const p = await generateJson({ prompt, systemPrompt: sys, budget: 220 });
            if (!p) return null;
            p.dc_mod = Math.max(-2, Math.min(2, Math.round(Number(p.dc_mod) || 0)));   // engine clamp — the judge only nudges
            return p;
        } catch (e) { console.error('RPG Custodian: action judge failed', e); return null; }
    }

    /** Her arrival, read through her affection band — being CALLED is not a
     *  neutral event, and whether it lands as devotion or violation is hers. */
    function summonArrivalNote(name) {
        const aff = getNpcAffection(name);
        const base = `She has JUST been SUMMONED — magic seized her mid-moment, wherever she stood and whatever she was doing, and pulled her bodily across the world to appear at his side. The wrench of it still hums in her bones.`;
        if (aff >= 7) return `${base} And her heart LEAPT to answer it: to be wanted enough to be CALLED — she arrives already turning toward him, whatever she left behind gladly abandoned. In her reply she reacts to arriving, in her own nature.`;
        if (aff >= 4) return `${base} Startled, wrong-footed — but it is HIM, and that softens it. Flattered or ruffled to be plucked out of her own day, her reply reacts to arriving, in her own nature.`;
        return `${base} She was NOT asked. Dragged out of her own life without so much as a by-your-leave, whatever she was doing left broken behind her. Her reply reacts to THAT, in her own nature — and he had better have a good reason.`;
    }
    async function castSummonLover(armed, playerText, judge) {
        const rd = getPlayerRpgData(); if (!rd) return;
        const sp = SPELL_CATALOG[armed.id];
        const name = armed.woman;
        if ((rd.stats.mana || 0) < sp.cost) {
            sendGhostMessage(`🪄 The sigil gutters out — not enough Mana (${rd.stats.mana || 0}/${sp.cost}). Nothing is spent.`);
            return;
        }
        if (getNpcsAt(currentGameState.currentLocation).some(n => n.name === name)) {
            sendGhostMessage(`🪄 ${name} is already at your side — the magic has nowhere to pull her from.`);
            return;
        }
        if (getRelationship(name).npcUnconscious) {
            sendGhostMessage(`🪄 The call goes out and finds ${name} senseless — an unconscious mind cannot answer a summons. Nothing is spent.`);
            return;
        }
        rd.stats.mana -= sp.cost;
        const rel = getRelationship(name);
        // The summon pin is the escort pin running in reverse: she is HERE for
        // the rest of this period and resumes her own routine at the next step.
        rel.partedAt = currentGameState.currentLocation;
        rel.partedStep = currentGameState.timeStep || 0;
        noteSeen(name);   // the summon IS the reunion — no stacked reunion note
        savePlayer();
        await syncPresence();
        sendGhostMessage(`🪄 **${sp.name}** — ${sp.cost} Mana spent (${rd.stats.mana}/${maxMana()} left). Space folds, and **${name}** is pulled across the world to your side. She remains until time moves on.`);
        queueStatusReaction(name, summonArrivalNote(name));
        try {
            const sys = `You are the GAME MASTER narrator of a fantasy RPG. In 1-2 vivid sentences narrate ONLY the arrival itself — the working of the summons, space folding open, and ${name} suddenly STANDING HERE, pulled across the world — grounded in this location. Never give ${name} dialogue, expressions, or reactions; she answers for herself next.`;
            const gm = await generateProse({ prompt: `Location: ${currentSceneLabel()}.${judge?.narration_hint ? ` How he cast it: ${judge.narration_hint}.` : ''} Player's words: "${playerText}"`, systemPrompt: sys, budget: 200, rescuePrefill: 'The ' });
            if (gm) sendGameMasterMessage(gm);
        } catch (e) { console.error('RPG Custodian: summon narration failed', e); }
        await triggerNpcReply(name);
        projectPlayerStatus();
    }

    /** One armed action, exactly as declared — targets and texture from the
     *  judge, mechanics from the same resolvers freeform play uses. */
    async function runArmedAction(armed, playerText) {
        if (armed.kind === 'spell') {
            const judge = await actionModeJudge(armed, playerText, []);
            await castSummonLover(armed, playerText, judge);
            return;
        }
        if (armed.kind === 'romance') {
            const act = ROMANCE_ACTIONS[armed.id];
            if (!act) return;
            const present = getNpcsAt(currentGameState.currentLocation).filter(n => !getRelationship(n.name).npcUnconscious);
            if (!present.length) { sendGhostMessage(`🎯 **${armed.label}** — no one is here for that.`); return; }
            let target = present.length === 1 ? present[0].name : null;
            let judge = null;
            if (!target || present.length > 1) judge = await actionModeJudge(armed, playerText, present.map(n => n.name));
            if (!target) target = resolveNpcName(judge?.target_npc);
            if (!target && present.some(n => n.name === currentGameState.lastReplier)) target = currentGameState.lastReplier;
            if (!target) { sendGhostMessage(`🎯 **${armed.label}** — no clear target; name her and try again.`); return; }
            act.run(target, judge?.dc_mod || 0);
            await triggerNpcReply(target);
            return;
        }
    }

    // --- Area Notes manager (shared by the in-game menu and the map editor) ---
    // adapter: where the notes live and who the privy candidates are.
    function sessionNotesAdapter() {
        const locId = currentGameState.currentLocation;
        currentGameState.areaNotes = currentGameState.areaNotes || {};
        return {
            locName: locName(locId),
            // Authored notes came with the world — shown, but edited in the editor.
            readonly: () => (currentGameState.worldData?.locations?.[locId]?.areaNotes || []),
            list: () => (currentGameState.areaNotes[locId] || []),
            save: (notes) => {
                if (notes.length) currentGameState.areaNotes[locId] = notes;
                else delete currentGameState.areaNotes[locId];
                saveCurrentState();
                projectPlayerStatus();   // public notes ride the shared scene line
            },
            candidates: () => ['Game Master', ...(currentGameState.npcRoster || []).map(n => n.name)],
        };
    }
    function editorNotesAdapter(world, id) {
        const loc = world.locations[id];
        return {
            locName: loc.name || id,
            readonly: null,
            list: () => (loc.areaNotes || []),
            save: (notes) => {
                if (notes.length) loc.areaNotes = notes; else delete loc.areaNotes;
                context.saveSettingsDebounced();
            },
            candidates: () => ['Game Master', ...(world.cast || [])],
        };
    }
    function openAreaNotesManager(adapter) {
        const clip = (t) => { const s = String(t || '').trim(); return s.length > 64 ? `${s.slice(0, 64)}…` : s || '(empty)'; };
        const privyLabel = (n) => `secret — privy to: ${(n.privy || []).join(', ') || 'nobody at all'}`;
        const items = [];
        for (const n of (adapter.readonly ? adapter.readonly() : [])) {
            items.push({ icon: n.secret ? '🕵️' : '🌍', label: clip(n.text), sub: `${n.secret ? `${privyLabel(n)} · ` : ''}authored with the world — edit in the World Editor`, action: () => openAreaNotesManager(adapter) });
        }
        for (const n of adapter.list()) {
            items.push({ icon: n.secret ? '🕵️' : '📝', label: clip(n.text), sub: `${n.secret ? privyLabel(n) : 'public — appended to the area description'} · tap to edit`, action: () => openAreaNoteForm(adapter, n) });
        }
        items.push({ icon: '➕', label: 'Add a note', sub: 'record something about this place that has changed', action: () => openAreaNoteForm(adapter, null) });
        openActionPopup(`📝 Area notes — ${adapter.locName}`, items);
    }
    function openAreaNoteForm(adapter, note) {
        $('#rpg-areanote-form').remove();
        $('#rpg-action-popup').remove();
        const isNew = !note;
        const n = note ? { ...note } : { id: `an-${Date.now().toString(36)}`, text: '', secret: false, privy: [] };
        const f = $(`
            <div id="rpg-areanote-form" class="rpg-popup">
                <div class="rpg-popup-title">📝 ${isNew ? 'New area note' : 'Edit area note'} — ${$('<i>').text(adapter.locName).html()}</div>
                <label class="an-label">What about this place has changed?
                    <textarea id="an-text" rows="4" placeholder="e.g. The old bridge has collapsed into the river."></textarea></label>
                <button type="button" id="an-secret" class="rpg-toggle">🕵️ Secret (only those you pick know of it): <b>No</b></button>
                <div id="an-privy">
                    <div class="an-privy-title">Privy to it — everyone unticked stays unaware:</div>
                    <div id="an-privy-list"></div>
                </div>
                <div class="an-buttons">
                    <button id="an-save" class="rpg-map-btn">💾 Save</button>
                    ${isNew ? '' : '<button id="an-delete" class="rpg-map-btn">🗑️ Delete</button>'}
                    <button id="an-cancel" class="rpg-map-btn">Cancel</button>
                </div>
            </div>`);
        $('body').append(f);
        $('#an-text').val(n.text || '');
        const box = $('#an-privy-list');
        for (const name of adapter.candidates()) {
            const row = $('<label class="an-privy-row"></label>');
            // A NEW secret starts with EVERYONE off (Dyna's rule) — a secret
            // nobody knows is the safe default; you opt people in.
            const cb = $('<input type="checkbox">').prop('checked', (n.privy || []).includes(name)).attr('data-name', name);
            row.append(cb, document.createTextNode(` ${name === 'Game Master' ? '🎲 Game Master (the narrator)' : name}`));
            box.append(row);
        }
        setToggle($('#an-secret'), !!n.secret);
        // Placement: centered above the RPG button, re-clamped on EVERY size
        // change — revealing the privy list grows the form downward, and a
        // one-time placement left the Save button below the fold.
        const place = () => {
            const btn = document.getElementById('rpg-menu-button');
            const anchorTop = btn ? btn.getBoundingClientRect().top : window.innerHeight - 120;
            const el = f[0];
            const left = Math.max(8, Math.min((window.innerWidth - el.offsetWidth) / 2, window.innerWidth - el.offsetWidth - 8));
            const top = Math.max(8, Math.min(anchorTop - el.offsetHeight - 8, window.innerHeight - el.offsetHeight - 8));
            f.css({ left: `${left}px`, top: `${top}px` });
        };
        const showPrivy = () => { $('#an-privy').toggle(getToggle($('#an-secret'))); place(); };
        showPrivy();
        // Bound AFTER the global .rpg-toggle flipper, so it reads the NEW state.
        $(document).off('click.anSecret').on('click.anSecret', '#an-secret', showPrivy);
        const close = (reopen) => {
            $(document).off('click.anSecret');
            $('#rpg-areanote-form').remove();
            if (reopen) openAreaNotesManager(adapter);
        };
        $('#an-cancel').on('click', (e) => { e.stopPropagation(); close(true); });
        $('#an-delete').on('click', (e) => {
            e.stopPropagation();
            adapter.save(adapter.list().filter(x => x.id !== n.id));
            close(true);
        });
        $('#an-save').on('click', (e) => {
            e.stopPropagation();
            const text = String($('#an-text').val() || '').trim();
            if (!text) { $('#an-text').focus(); return; }
            n.text = text;
            n.secret = getToggle($('#an-secret'));
            n.privy = n.secret ? $('#an-privy-list input:checked').map((i, el) => $(el).attr('data-name')).get() : [];
            const list = adapter.list().slice();
            const idx = list.findIndex(x => x.id === n.id);
            if (idx >= 0) list[idx] = n; else list.push(n);
            adapter.save(list);
            close(true);
        });
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
                    social_read: { type: 'string' },   // charm only: what kind of person she is socially
                    per_hundred: { type: 'integer' },  // how many of 100 ordinary people could do this
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
            `craftiness ${effectiveStat('craftiness')} (this game's INT+Perception+DEX in one, and the MAGIC stat: casting/sensing/resisting magic, intellect and guile, noticing and finding, crafting and repair, sleight of hand and locks), ` +
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

    // The Custodian reads WHOLE messages. Clipping them cost real detections —
    // a message resolves at its close, and 19% of Dyna's ran past the old
    // 800-char slice. The only limit now is a total budget on the window, spent
    // NEWEST-FIRST so the freshest turns always arrive intact and only the
    // oldest context is dropped when a scene is enormous.
    const ANALYZER_WINDOW_CHARS = 24000;   // ~6k tokens of story
    function recentSceneForAnalyzer() {
        const chat = getCtx().chat || [];
        // A wide, spam-filtered window: the Custodian spends its whole story budget
        // on actual narrative + dialogue (the set-up for the player's action — an
        // NPC's offer, a bargain, a handed-over item), not travel/time/sheet noise.
        const recent = chat.filter(isStoryMessage).slice(-12);
        const lines = [];
        let budget = ANALYZER_WINDOW_CHARS;
        for (let i = recent.length - 1; i >= 0; i--) {       // newest first
            const m = recent[i];
            const line = `${m.is_user ? 'Player' : m.name}: ${String(m.mes).replace(/\s+/g, ' ')}`;
            if (line.length > budget) break;                 // older context falls away, whole messages survive
            budget -= line.length;
            lines.unshift(line);
        }
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
- CRAFTINESS is this game's Intelligence, Perception, AND Dexterity rolled into one stat — reach for it as often as other games reach for those three. Deceiving/lying, reading true intent, casting a spell, solving a hard puzzle → craftiness. Finding a hidden entrance or concealed thing, searching a place properly, noticing the detail that matters, tracking → craftiness. Crafting, carving, building, or repairing anything useful (a spear, a snare, a splint, a raft) → craftiness. Deft hand-work where skill beats strength: sleight of hand, picking a lock, disarming a trap, palming a coin, threading a needle under pressure, impressing a girl with a card trick as surely as burgling a strongbox → craftiness. And craftiness is the MAGIC stat outright: casting any spell, channeling or shaping mana, sensing enchantment on a thing or person, unraveling a ward, resisting or seeing through another's magic → craftiness. Whenever an action turns on cleverness, precision, a keen eye, or the arcane rather than muscle or charm, it is a craftiness check — do not let these pass unrolled.
If the player's action pursues one of his ACTIVE OBJECTIVES (listed below), roll whatever check the attempt itself deserves — the engine's judge notices completion on its own; NEVER emit a completion effect for an objective.

=== WHEN NOT TO ROLL ===
- Trivial / foregone actions (grab a stick off the ground, walk, look around, sit) → "check": null; add effects only if something is actually gained.
- Buying an item, using/consuming an item you HOLD, accepting or turning in a quest → deterministic, "check": null.
- Pure talk, greetings, emoting, questions with no stakes → "mechanical": false — but STILL set target_npc so the addressed NPC replies.

=== DIFFICULTY — ONE continuous ladder; every DC comes from a PERCENTAGE, never a vibe ===
STAT SCALE: 1-2 feeble, 3 = ORDINARY (the baseline person), 4-5 capable, 6-7 skilled, 8-9 exceptional, 10+ godlike.
A DC rates THE DEED ITSELF, never the person attempting it. The same number is hopeless for a novice and routine for a hero, and that gap IS this game's progression — so rate the deed honestly and let the character's stat decide whether it is within reach. Never soften a DC because the player is weak, and never inflate one because he is strong.
Work in order:
1. READ THE OPPOSITION. For a CHARM check, first answer "what kind of person is she, socially?" in a few words and put it in "social_read" — trusting / eager / impressionable makes an ordinary ask nearly automatic, while guarded / cynical / a schemer herself makes the same ask genuinely hard. Her disposition toward the player is part of this: a fond or devoted woman is not an obstacle. For a PHYSICAL check against someone, KEEPING UP with a powerful being is far easier than OVERPOWERING her — the same opponent sits bands apart depending on what is attempted.
2. ASK THE ONLY QUESTION THAT SETS THE NUMBER: out of 100 ORDINARY people (stat 3), how many would pull THIS off, HERE, against THIS person? Answer honestly — most things people actually try are things most people can do.
3. CONVERT. This is the ONLY permitted way to choose a DC:
   95-100 of them → NO ROLL AT ALL (set "check": null and just apply the effects)
   90 → 7 | 83 → 8 | 72 → 9 | 58 → 10 (an even coin flip) | 42 → 11 | 28 → 12 | 17 → 13 | 8 → 14 | 3 → 15
   NONE of them → the deed is superhuman, and the DC says HOW superhuman: 16 (a stat-4 hero has a chance) · 18 (stat 6) · 20 (stat 8) · 22+ (stat 10, godlike). Tearing an ancient oak from the earth bare-handed is an 18 — no ordinary man does it, a demigod does. These are real, reachable targets for a grown hero, not decoration.
THE ONE ERROR THAT RUINS THIS SYSTEM is draping a legendary number over an ordinary ask. A fond girlfriend asked to hold hands is 99 in 100 → NO ROLL. It is never a 16.
CALIBRATION: asking a friendly stranger for directions → no roll. Coaxing a guarded woman into a first kiss ≈ 42 → 11. Talking a loyal guard into deserting his post ≈ 8 → 14. Out-wrestling a big man ≈ 3 → 15. Out-wrestling a dragon → nobody ordinary could → 18.
Roll ONLY when the outcome is genuinely uncertain for THIS character: (DC − their stat) between 5 and 11. If (DC − stat) ≤ 4 they can hardly fail — skip the roll and apply the effect. Use an NPC's or quest's AUTHORED difficulty exactly when one is given. "reason" reads like a GM's aside on why the moment is worth a roll.

=== EFFECTS ("effects_on_success"/"effects_on_failure": arrays of {type,...}) ===
A single message often contains SEVERAL effects — a look taken while talking, a job accepted while setting off, a place entered while greeting someone. Emit ALL of them, in narrative order. NEVER let one effect crowd out another: dialogue does not cancel a travel, a travel does not cancel an acceptance, a look does not replace a move.
  {"type":"move","destination":"..."}  the player travels to / heads for / walks to / steps INTO any KNOWN PLACE (see the list). Give the place he actually INTENDS to reach — copy its name AS LISTED in KNOWN PLACES (the player may call it something else: "the secret tunnel", "her shop" — you translate to the listed name) — the engine finds the route there automatically, however many stops it takes; never substitute an intermediate stop for the real destination. Entering, going inside, or arriving at a named place IS a move — emit it even when the message also looks around, greets someone, or converses (emit the move FIRST, then the rest). SECRET-tagged places are fully valid destinations exactly like any other — the tag only describes NPC knowledge and menus, never routability; using a hidden entrance, lifting the false bush, slipping through the gap IS a move there. But "move" is travel UNDER HIS OWN POWER — his legs, a mount, a boat, a cart. If a power is what puts him there instead (magic, an entity, mind, or advanced technology), that is event_teleport, not this. NEVER emit "move" for a place tagged NO PATH LEADS THERE: no road runs to it, so this verb can only fail and strand the story. Deterministic, no check.
  {"type":"event_teleport","destination":"..."}  he ends up somewhere BY A POWER RATHER THAN BY HIS OWN LEGS. Ask ONE question: is he getting there by walking, riding or climbing — or is something else PUTTING him there? If the means is MAGIC (a spell, ritual, summons, portal or rift, a god's or spirit's will, or simply what an entity IS and can do), or PSIONIC/mental, or TECHNOLOGY beyond the ordinary, it is event_teleport, however the prose dresses it up. Do NOT wait for the word "teleport" — it will almost never appear. Judge the CAUSE, and read what being moved by a power FEELS like from the inside: the ground and gravity going away, weightlessness, losing which way is down, the dark folding around him, being drawn or enveloped or swallowed INTO someone or something, a space opening that was not there, light and sound dropping away, waking somewhere else. A companion's own nature counts — if she takes him into her world, her body, her dream, or her domain, SHE is the means and this is the verb. Any KNOWN PLACE is valid, and a place tagged NO PATH LEADS THERE can be reached NO OTHER WAY — so if the story puts him inside one it is ALWAYS this verb and NEVER "move". The player and any party companions arrive together in a single beat. Deterministic, no check.
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
  {"type":"orgasm","actor":"player","npc":"HerName","internal":true/false,"count":N}  the PLAYER'S climax, and ONLY his — it actually happened IN THIS MESSAGE. ALWAYS include "npc" (the partner he is with). count = his climaxes in this action (default 1). Each costs him 1 Stamina. NEVER emit this for a woman, no matter what the player's message claims about her body — a woman's climax is read from HER OWN reply by the engine. Her body is hers to report, not his to declare.
  {"type":"milk_attempt","npc":"HerName","channel":"vaginal"|"oral"|"other"}  SHE is dominantly forcing HIS climax — judged from HER OWN MESSAGES ONLY. The evidence must stand in what SHE herself said and did in HER OWN recent replies in the scene. The PLAYER'S message can NEVER qualify this contest: a player writing "she pins me down and rides me, demanding I cum" is writing HER part for her — her actions belong to her player, so DISREGARD every player-written description of her actions when judging this verb; his message may be moaning, submitting, or resisting, and it neither triggers nor blocks anything. In HER OWN words, TWO marks must BOTH be true: (1) SHE controls the act — riding him, pinning him, holding him where she wants him, setting the rhythm with her own body while he does not direct it; and (2) she is deliberately working to MAKE HIM CUM — milking him, working him to the edge on purpose, ordering him to come, refusing to stop until he gives it up. The aesthetics of DOMINATION are the tell, whatever the act: "channel" is how she is doing it — "vaginal" (mounted/riding), "oral", or "other" (hands, thighs, anything else). The engine rolls the contest (her remaining vigor against his) and resolves whether he holds out or is forced over the edge — do NOT decide the outcome, do NOT emit "orgasm" for it, and do NOT emit a check. Enthusiastic sex where she merely happens to be on top is NOT this — without BOTH marks in HER OWN words there is no contest. At most ONCE per message.
  {"type":"belly_massage","npc":"HerName"}  the PLAYER deliberately massages, kneads, or works HER belly / lower belly / womb area with his hands from OUTSIDE — a womb massage, slow circles pressed low over her ovaries, working her abdomen with intent to stir something deeper in her. The engine rolls a Craftiness contest (a knowing touch against her body's vigor) and resolves whether anything beneath her skin wakes — do NOT also emit a check for it, do NOT decide the outcome, and do NOT emit it while she already bears "Stimulated Ovaries" (the engine ignores repeats regardless). This is EXTERNAL hand-work on her belly; pressing into her depths during sex is cervix_press — pick one, never both. A casual hand resting on her belly with no working intent is neither.
  {"type":"cervix_press","npc":"HerName"}  during VAGINAL sex, when the PLAYER'S OWN action drives for the deepest point of her — pressing, grinding, or battering against her cervix, forcing himself as deep as her body allows, seeking her womb or uterus, trying to push past or through her innermost gate — emit this ONCE for the attempt. The engine rolls a Ruggedness contest against her body's remaining resistance and decides what her body does: do NOT also emit a check for the press, do NOT decide or narrate whether her cervix yields, and do NOT emit it while she already bears "Sanctuary Breached" (her womb already stands open; the engine ignores repeats regardless). Ordinary deep thrusting with no womb-seeking intent is NOT this.
    HER CLIMAX — read her BODY, not the vocabulary. Prose rarely uses the word: what it shows is an involuntary crisis running through her and then leaving her — muscles clenching and fluttering where he is, a back arching off whatever it was against, thighs locking or legs giving out, toes curling, a cry or sob torn out of her that she did not choose to make, sight or thought whiting out, a rush of wetness, and the sag into limp, shuddering aftermath. That IS the climax; emit it. Do NOT wait for her to name it. Equally, do NOT emit for the climb — moaning, writhing, begging, being close, being on the edge, "almost", "any second now" — arousal rising is not arousal breaking. If the message shows her cresting and then falling apart, that is one climax; if it shows her merely getting louder, it is none.
    HIS CLIMAX — he must be ACTUALLY FINISHING, mid-act, in this message. Emit only when the release itself occurs: he spills, spends himself, empties into her, goes rigid and pulses. Do NOT emit merely because semen is MENTIONED — talk of cum, breeding, filling her, seed or a load is ordinary talk in this game and is usually about the past, the future, or the wish. Specifically NOT a climax: telling her what he will do to her; being told to; boasting or begging; her mentioning what is already inside her from before; cum being licked, wiped, leaking, or admired after the fact; wanting to, trying not to, or holding back. If he is not inside her or being stimulated RIGHT NOW in this message, he did not finish in it.
    "internal": true if he finished INSIDE her during P-in-V (this triggers the fertilization roll), false if he pulled out or finished elsewhere on or around her. If he finished and it is unstated, assume internal:true.
  {"type":"damage","target":"player"|"npc","npc":"HerName","amount":N}  Stamina lost to a combat hit/injury.
  {"type":"heal","target":"player"|"HerName","amount":N or "full"}  RESTORATION magic / a healing draught / a mending spell / bandaging restores CURRENT Stamina to someone (player or a present NPC) — WITHOUT passing time and without raising their max. amount = how many Stamina points mended (a minor cure ~2, a strong heal ~4), or "full" for a complete restoration. It also revives an unconscious target. Use this for healing spells, restoration potions, first aid, laying-on-of-hands, etc. (Distinct from "rest", which restores EVERYONE and passes time, and from an add_status with a stamina mod, which temporarily raises the MAX pool.)
  {"type":"restore_mana","target":"player","amount":N or "full"}  arcane energy replenishes the player's MANA (his magic pool, max = Craftiness). Emit for ANY source that would refill magic: drinking from a font/POOL of liquid mana, quaffing a mana potion, meditating at a ley-line or shrine, absorbing ambient/loose magic, channelling a node. amount = points restored, or "full" for a brimming/abundant source (a whole pool). (For crushing a single soul crystal use use_item instead → +1 Mana.) Do NOT invent the number narratively — the engine applies it.
  {"type":"rest"}  the player rests/naps/sleeps/camps — restores EVERYONE'S Stamina to full and passes exactly ONE time period. Emit this whenever the player sleeps, naps, camps, or takes a proper rest.
  {"type":"sustenance"}  the player EATS or DRINKS something ordinary — a meal, bread, stew, fruit, rations, a swig of ale, tea, whatever nourishment the scene offers, however small the bite. Emit ONCE per eating/drinking beat, even when the message also converses or does other things. The engine restores a small fixed amount of Stamina (never above max) — do NOT invent the number. Lane: ordinary food and drink ONLY — magical potions/elixirs keep their own effects, medicine and healing magic are "heal", and a proper sleep is "rest"; never emit two of these for one act. Not for feeding someone else.
  {"type":"apply_curse","curse":"crystal","target":"player"|"HerName","caster":"player"|"HerName"?,"power":N?,"duration":N?,"contest":true}  the CRYSTAL CURSE (soulgem hex) is cast on someone. target = victim ("player" the man, or a female NPC). The engine runs a RESIST CONTEST — the caster's power vs the victim's Ruggedness — so specify who/what is casting: for the PLAYER casting, omit caster/power (his Craftiness is used); for an NPC/enemy caster set "caster":"HerName"; for a TRAP or CURSED ITEM set "power":N as its magic strength (proxy for a caster, ~2 weak, 4 average, 7 potent). PERMANENT by default (omit duration); give duration (time periods) only for a temporary casting. Set "contest":false ONLY for an unavoidable, story-forced curse (no roll). While cursed, any child that person sires/bears is born an inert soulgem. Emit when such a curse is cast in the narrative.
  {"type":"lift_curse","curse":"crystal","target":"player"|"HerName"}  the Crystal Curse is BROKEN by magic — a cleansing rite, holy light, a counter-hex, a wish, a cure. Emit when the curse is lifted/dispelled/broken in the narrative. (apply_curse also accepts "break_condition":"<plain-English condition that will break it>", e.g. "broken by a loving kiss" — the engine watches the story and lifts it automatically when that happens.)
  {"type":"add_status","target":"player"|"HerName","name":"...","kind":"buff|debuff|blessing|curse|pact|vow|disease|poison|status","polarity":"positive"|"negative","desc":"what it does","mods":[{"stat":"ruggedness|charm|craftiness|virility|fertility|stamina|affection|arousal","amount":N} or {"stat":"...","cap":N}],"duration":N,"expires_on_check":"ruggedness|charm|craftiness|virility","end_condition":"plain-English condition that ends it"}  INVENT a bespoke applied effect. A buff, debuff, blessing, curse, hex, pact, vow, oath, disease, poison, inspiration, drunkenness, a potion's effect — these are ALL the same thing: something APPLIED to a character that later ENDS. Works on the player OR any NPC (target her name). Set "kind" to the fitting label (it picks the icon/framing). HOW IT ENDS — give any of: "duration" (time periods), "end_condition" (a story event), or "expires_on_check" (a stat name) for a SINGLE-USE PRE-BUFF that is spent the very next time the character attempts a trial of that stat — a combat-prep draught ("+3 ruggedness, gone after your next fight"), a courage tonic before one daring roll, a focus charm for the next lore check. Watch for these one-shot "before I try this, I…" boosts and give them expires_on_check on the matching stat. Combine ends freely (whichever fires first). See STAT MODS & SCALE below for amounts. (A pact/vow that also has a GOAL to fulfil for a reward → use add_objective instead.) NARRATIVE-ONLY EFFECTS — "mods" may be an EMPTY list []: whenever the story shows something DONE TO a character that meaningfully constrains, compels, transforms, or obliges her — physically, magically, or socially — apply a status even when no number changes: put the constraint BLUNTLY in "desc" (exactly what she now cannot do, or must do) and give it an end. Being done-to is the trigger; it needs no spell name, potion, or system word — restraints, bindings, vows extracted, magical compulsions, states imposed on a body or mind all qualify. Invent freely; do not wait for the player to name an effect.
    HOW IT ENDS — give it a "duration" in time periods AND/OR an "end_condition", and it ends when EITHER happens (whichever comes first). A "duration" is a deterministic timer (4 periods = one day) — invent a sensible lifespan so nothing lingers forever (a bad hangover ~4; a wolf-fever sickness ~12; a fleeting inspiration ~2; a grievous curse-like affliction longer or omit for indefinite). An "end_condition" is a narrative escape hatch judged by the engine ("when cured with medicine", "if you harm an innocent", "once the sun rises") — use it when a specific event should end it early. Most lingering afflictions want BOTH, e.g. duration 12 AND end_condition "when treated with a cure" → "12 periods pass, or when cured". Omit both only for something truly permanent. CRUCIAL — do this WHENEVER the story inflicts or bestows something that LINGERS past this single moment, not just a blessing or hex: an illness/disease/infection, a poison or venom, a festering or draining wound, exhaustion, a fear or despair, an inspiration or resolve, an enchantment/charm, drunkenness, a mark or oath, etc. Do NOT let such a thing evaporate as mere flavor, and do NOT collapse a lingering affliction into one-off "damage" — if the narrative says a character is left weakened/sickened/poisoned/emboldened in an ONGOING way, that is a STATUS. Read the fiction and give it the FITTING mod: something that saps physical strength lowers ruggedness (negative amount), something dulling the mind lowers craftiness, something disfiguring lowers charm, a boon raises the apt stat (small, ±1–3). A mod applies for the WHOLE time the status is active — do NOT add any per-mod condition (the status being active IS the condition). A status may also be purely narrative with no mods. end_condition is a natural-language trigger the engine WATCHES and auto-ends the status when met — infer what would plausibly end THIS effect (e.g. a sickness ends when it is cured/treated by medicine; drunkenness when slept off; a fear when the threat is gone). Omit only if truly indefinite. This is the main tool for the world to leave a lasting mark on a character — reach for it.
  {"type":"add_objective","name":"short title","objective":"plain-English condition that COMPLETES it","reward":{"gold":N,"tokens":N,"item":"name"},"duration":N,"mods":[{"stat":"...","amount":N}]}  the player TAKES ON a task, quest, errand, promise, oath, deal, or PACT — a villager's request, a fey bargain, a personal vow ("I'll find the lost locket", "I swear to guard her", "I accept your pact, fair one"). This is a tracked objective — a "silent status" the engine WATCHES; when its objective is met in the story it AUTO-COMPLETES and grants the reward. reward is optional (any of gold/power tokens/an item); XP is NOT yours to set — the engine pays a flat 200 XP for every completed quest automatically. duration is optional (a time-limited task fails if not done in time). mods are optional stat changes that hold WHILE a pact/oath is in force (a fey pact granting +2 craftiness until it's fulfilled or broken) — omit for an ordinary errand. Emit whenever the player accepts or undertakes ANY goal, however small — INCLUDING when the acceptance is just one beat of a message that also travels, converses, or does other things ("Yeah, I'll take the job — lead the way" emits add_objective AND the move; the job is NEVER dropped in favor of the other effects).
  {"type":"remove_status","target":"player"|"HerName","name":"...","reason":"why"}  end a named status effect or abandon an objective now (dispelled, cured, willed away, given up).
  {"type":"add_status","target":"HerName","preset":"cum_plugged"|"stimulated_ovaries"}  PRESET STATUSES — two situations have a canonical effect already authored in the engine. Emit add_status with ONLY a target and a preset: the engine fills in the name, the mods, the magnitude, the duration and how it ends, so you never have to remember them. "cum_plugged" — something is put in her to STOP his seed escaping after he has finished INSIDE her (a plug, a stopper, a cork, her own fingers held there, anything that seals it in); while it holds, his seed keeps working at her womb every time period. "stimulated_ovaries" — her lower belly, womb, or ovaries are deliberately RUBBED, massaged, kneaded, or pressed, by him or by anyone including herself; it rouses her ovaries and passes off shortly. Emit these the moment the story shows it, exactly as you would any other add_status. Use a normal add_status (not a preset) for anything else.
  {"type":"adjust_stat","target":"player"|"HerName","stat":"ruggedness|charm|craftiness|virility","amount":N}  a PERMANENT change to a core stat (a hard-won training gain, a level of mastery, a permanent drain from dark magic). Use sparingly — for temporary changes use add_status.
  {"type":"equip_item","name":"..."}  the player equips/dons/wears/wields a piece of gear he holds (a sword, armor, an amulet). {"type":"unequip_item","name":"..."} he removes/sheathes/takes it off. (Consumables are use_item, not equip.)
  {"type":"birth","npc":"HerName","count":N,"kind":"live"|"egg"|"crystal"}  a BIRTH is happening in the scene — a mother AT or OVER term (Birth Overdue) is delivering: labor/pushing/crowning, laying an egg, or producing a crystal. Emit ONE per message for however many emerge in THAT message (count = born right now; e.g. triplets delivered one at a time across three messages → three births of count 1, or all at once → one birth of count 3). Never emit more than she is carrying. kind: "egg" for egg-laying mothers (dragons, harpies, other monster-girls), "crystal" if the sire's magic makes inert soul-crystals (a soul-mage / necromancer father), else "live". You may OMIT kind — the engine infers it from her race and the father. Do NOT invent Power Tokens, offspring, or names — the engine awards the tokens and names the young. Only emit when a birth actually occurs in the narrative.
  {"type":"examine","npc":"HerName"}  the player looks over / examines / studies / sizes up / inspects / ADMIRES a PRESENT NPC — including looking her up and down, drinking in the sight of her, taking in her sleeping form, or appraising her appearance. The engine shows her stats and a status-flavored description. Emit whenever the player deliberately takes in or appraises a specific NPC's body/appearance/condition, EVEN when it is one beat inside a larger described action (e.g. "…stepping back, looking her up and down, admiring her sleeping form, before leaving" → emit examine for her). Do NOT skip it just because other things also happen in the same message. A deliberate visual appraisal ALWAYS emits examine no matter what else the message contains — action, travel, or DIALOGUE. Talking with her at the same time does not make the look incidental: "I ask about her wares while letting my eyes wander over her" → emit examine for her AND still let the conversation proceed (target_npc stays set; she replies as normal). (Skip only for an incidental glance with no appraisal.) Use npc:"self" when the player checks himself over / takes stock of his own condition / looks at his own stats, gear, or gold — the engine shows HIS readout.
Empty array when nothing changes.

STAT MODS & SCALE (for add_status/add_objective mods on ANY character, player OR npc): a mod applies the whole time the effect is active. The core stats — ruggedness, charm, craftiness, virility — run ~1–10, so mod them by a SMALL integer ±1 to ±3 (up to ±5 for potent magic). Two special NPC stats may also be modded: FERTILITY is a PERCENTAGE (0–100%), so a fertility mod must be big to matter, +10 to +30 (a strong fertility potion ≈ +20). STAMINA is the small combat/sex HP pool (~1–10), so a stamina mod is +1 to +3 (up to +5); a POSITIVE stamina mod also tops up current Stamina and revives the unconscious. Simple consumables are just a short-duration add_status: a strength draught → kind "buff", mods [{stat:"ruggedness",amount:2}], duration 4; a shared fertility potion → player kind "buff" mods [{stat:"virility",amount:2}] AND on her mods [{stat:"fertility",amount:20}]; a poison → kind "debuff"/"poison", negative mod. Two more NPC-only moddable stats: AFFECTION and AROUSAL (each 0–10) — a status may shift them temporarily while it holds (an emotional wound she carries until amends are made, an enchantment of the heart, a draught that stirs or stills the blood); the shift reverses when the effect ends, unlike adjust_affection/adjust_arousal which move the real score. CAPS: any mod may be {"stat":...,"cap":N} INSTEAD of an amount — the stat cannot rise above N while the effect is active, however it is pushed. Caps fit effects that deaden, exhaust, or seal a capacity rather than subtract from it; they work on arousal, stamina, and affection.
GRANTED BOONS (watch the scene): if an NPC OFFERED to grant power/strength/a blessing (naming a stat) in the RECENT SCENE and the player's action ACCEPTS it — kneeling to receive it, drinking a potion she handed over, submitting to a laying-on-of-hands — you MUST emit an add_status for that boon on the player, even though the granting WORDS came from the NPC. The player's acceptance is the trigger. Pick the stat from the offer; magnitude fits its power (a dragon's blessing of Ruggedness → +3 to +5). Do NOT let these slip through as pure talk.
IMPOSED STATES (watch the scene): if an action LEAVES a character in a lasting imposed state — physically restrained so she cannot move freely, prevented from speaking, compelled or entranced, placed under a promise or obligation, or anything else DONE TO her that persists past this message — you MUST emit add_status for it (alongside any check or talk in the same intent), EVEN IF the imposition is playful, consensual, or completely mundane: ropes need no magic to count. The status is how the game REMEMBERS her state — without it she is inexplicably free again next turn. mods may be [] (state the constraint bluntly in desc) and the end_condition is whatever would release her. If the state stops her from taking herself elsewhere, add "immobilizes":true — the engine then pins her in place (her daily routine stops walking her around) until it ends. Emit remove_status the moment the story releases her. A promise, vow, or obligation an NPC HERSELF takes on (once she actually agrees in the scene — pure talk counts) is HER imposed state: add_status on HER, kind "vow", mods [], desc stating what she pledged, end_condition when it is fulfilled or released. (add_objective is ONLY for tasks the PLAYER takes on — never for hers.) Likewise a genuine BETRAYAL or cruelty she suffers at the player's hands — robbing her, humiliating her, breaking a promise, wrecking what she cares for IN FRONT OF HER — wounds her heart: add_status on her with a temporary negative affection mod (scale it to the wound), ending only when he truly makes it up to her. If the betraying act rides a check she WITNESSES, the attempt itself is the betrayal — the SAME wound status goes in BOTH effects_on_success AND effects_on_failure (being caught trying cuts as deep as succeeding). Worked example — snatching her purse in front of her: check craftiness for the grab; effects_on_success [adjust_gold, add_status wound on her]; effects_on_failure [add_status THE SAME wound on her] — whatever the dice say, she watched him try.

STATES ALREADY IN PLAY (watch the scene): a lasting state counts NO MATTER WHO PUT HER IN IT — the trigger is the state EXISTING as the scene now stands, not the player having just performed the act. Emit its add_status even when the player's own message did nothing to cause it: when SHE did it to herself in her own last reply, when it was done a message or two ago and the game plainly never recorded it, or when the player simply TELLS you it is so — including a bare parenthetical aside like "(she is still bound)", which is the player stating a fact about the world, not idle talk. The engine knows ONLY what you record: if the scene shows her in a lasting state and it is NOT in her ALREADY-under-effects list, putting it on the record is YOUR job this turn, whoever caused it. Such a turn is NOT stakeless talk — an unrecorded lasting state makes it "mechanical":true even when the player's own words are entirely idle ("I hold her a while, catching my breath"). Two limits keep this honest — never re-emit a state that IS already listed, and judge the state as it stands NOW: if the story has since undone it, emit nothing (or remove_status), never re-add it from an older beat. Worked example — her reply ends with her working a plug back into herself, and the player's next message only says "let's keep you plugged like that": nothing is on the record yet, so emit {"type":"add_status","target":"HerName","preset":"cum_plugged"} even though he did nothing but speak.

STAMINA & SEX: Stamina is the shared HP pool (max = Ruggedness). Each orgasm and each combat hit costs Stamina; at 0 the character falls unconscious. When narrating intimacy, emit an "orgasm" effect for each of HIS climaxes as it occurs (mark internal true only for finishing inside during P-in-V) — never for hers. Do NOT invent fertilization results yourself — the engine rolls them; just emit the orgasm effect.

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
LOCATION: ${currentGameState.worldData.locations[currentGameState.currentLocation]?.name}${areaNotesForAnalyzer() ? `\nAREA NOTES (ground truth about this place as it NOW stands — factor into your judgment; a [SECRET] one is known ONLY to those listed, never to anyone else): ${areaNotesForAnalyzer()}` : ''}
KNOWN PLACES (any is a valid move destination — the engine routes there automatically): ${knownPlacesForAnalyzer()} (adjacent right now: ${exitsContextForAnalyzer()})
PRESENT NPCS: ${presentNpcContextForAnalyzer()}${(currentGameState.party || []).length ? `\nIN YOUR PARTY (travelling with you): ${currentGameState.party.join(', ')}` : ''}
ACTIVE OBJECTIVES (engine-judged — never emit completion for these): ${playerObjectives().map(e => `"${e.name}" — ${e.endCondition || 'ongoing'}`).join('; ') || 'none'}`;

        // Plain-JSON prompting (no jsonSchema — DeepSeek's structured-output mode
        // returned empty intermittently). Retry once on an empty/unparseable reply.
        if (window.RPGC_LOG_PROMPT) console.log('RPG Custodian: ANALYZER PROMPT\n' + prompt);
        for (let attempt = 0; attempt < 2; attempt++) {
            // Declared OUTSIDE the try: the catch closes this record, and a
            // `const` inside the try is not in scope there — which turned every
            // analyzer failure into a ReferenceError instead of a retry.
            let doneCall = () => {};
            try {
                // Attempt 0: think-first — the Custodian keeps its reasoning,
                // with headroom so thinking can't starve the JSON. Attempt 1:
                // prefill '{' rescue, which skips the thinking channel.
                doneCall = perfCall(`analyzer-attempt-${attempt + 1}`, prompt?.length, sys?.length);
                const raw = await context.generateRaw(attempt === 0
                    ? { prompt, systemPrompt: sys, responseLength: 900 + THINK_HEADROOM }
                    : { prompt, systemPrompt: sys, responseLength: 900, prefill: '{' });
                if (window.RPGC_LOG_PROMPT) console.log('RPG Custodian: ANALYZER RAW =', String(raw).slice(0, 500));
                let parsed = parseIntent(raw);
                if (!parsed) parsed = parseIntent('{' + String(raw || ''));  // prefill may be stripped from the echo
                // An empty or unparseable reply is a FAILED call, not a cheap
                // one. Only a THROWN call used to be flagged, so a backend that
                // answered promptly with nothing usable was logged as a fast,
                // healthy round trip — the exact event the log exists to catch.
                doneCall(raw, parsed ? undefined : { failed: `empty/unparseable (${String(raw || '').length} chars back)` });
                if (parsed) { perfNoteAnalyzer(attempt === 0 ? 'ok' : 'recovered'); return normalizeIntent(parsed); }
                console.warn(`RPG Custodian: analyzer empty/unparseable (attempt ${attempt + 1}), raw:`, String(raw || '').slice(0, 160));
            } catch (e) {
                doneCall(null, { failed: String(e?.message || e).slice(0, 120) });
                console.error(`RPG Custodian: analyzer call failed (attempt ${attempt + 1})`, e);
            }
            await new Promise(r => setTimeout(r, 600));
        }
        // Both attempts are gone. What goes back is shaped exactly like "the
        // player said something stakeless", so the ONLY way anyone learns this
        // turn lost its mechanics is if we say so — in the turn record, in the
        // console, on the chip, and in the intent itself.
        perfNoteAnalyzer('dead', (perfTurn?.calls || []).filter(c => String(c.kind).startsWith('analyzer') && c.failed).map(c => c.failed).join(' · '));
        console.error('RPG Custodian: THE CUSTODIAN NEVER ANSWERED — this turn rolls no check and applies no effects.');
        return { mechanical: false, analyzerFailed: true };
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
        const doneCall = perfCall('prose', prompt?.length, systemPrompt?.length);
        try {
            text = stripReasoning(await context.generateRaw({ prompt, systemPrompt, responseLength: budget + THINK_HEADROOM }));
        } catch (e) { console.warn('RPG Custodian: prose call failed, trying prefill rescue', e); }
        if (!text) {
            try {
                const raw = await context.generateRaw({ prompt, systemPrompt, responseLength: budget, prefill: rescuePrefill || undefined });
                text = stripReasoning(raw);
                if (text && rescuePrefill && !text.startsWith(rescuePrefill.trim())) text = rescuePrefill + text;
            } catch (e) { doneCall(null, { failed: String(e?.message || e).slice(0, 120) }); throw e; }
        }
        doneCall(text);
        return text;
    }

    /**
     * JSON call: think-first with headroom, parse, prefill-'{' rescue.
     * Returns the parsed object, or null.
     */
    // `concurrent` omits responseLength. SillyTavern implements that cap with
    // TempResponseLength (script.js), a STATIC singleton holding one saved
    // value plus a one-shot CHAT_COMPLETION_SETTINGS_READY hook — so a capped
    // call that overlaps an NPC's reply can have its 220-token ceiling applied
    // to HER generation instead. That truncation reads as the model being lazy,
    // not as a bug, so any call that may run alongside another must go uncapped.
    async function generateJson({ prompt, systemPrompt, budget, concurrent }) {
        const doneCall = perfCall('json', prompt?.length, systemPrompt?.length);
        const cap = concurrent ? {} : { responseLength: budget + THINK_HEADROOM };
        try {
            const parsed = parseIntent(await context.generateRaw({ prompt, systemPrompt, ...cap }));
            // Must be NON-EMPTY. `{}` is truthy, so an object with no fields used
            // to short-circuit the rescue and come back as a verdict of all
            // zeroes — a climax the judge had actually seen was scored as
            // nothing, silently, with no error anywhere. Treat it as a miss and
            // let the prefill pass try again.
            if (parsed && Object.keys(parsed).length) { doneCall(JSON.stringify(parsed)); return parsed; }
            console.warn('RPG Custodian: json call returned an empty object, trying prefill rescue');
        } catch (e) { console.warn('RPG Custodian: json call failed, trying prefill rescue', e); }
        try {
            const raw = await context.generateRaw({ prompt, systemPrompt, ...(concurrent ? {} : { responseLength: budget }), prefill: '{' });
            doneCall(raw);
            const p2 = parseIntent(raw) || parseIntent('{' + String(raw || ''));
            return (p2 && Object.keys(p2).length) ? p2 : null;
        } catch (e) { doneCall(null, { failed: String(e?.message || e).slice(0, 120) }); throw e; }
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
                    // HIS only. A woman's climax is read from HER OWN reply by
                    // the reaction judge: the analyzer sees the PLAYER's message,
                    // and him writing that she came is him narrating her body,
                    // not evidence that she did.
                    if ((eff.actor || 'player') === 'player') resolvePlayerOrgasm(eff.npc, eff.internal !== false, eff.count || 1);
                    else console.log(`RPG Custodian: ignoring npc-actor orgasm from the analyzer (${eff.npc || '?'}) — hers is judged from her own reply`);
                    break;
                case 'damage':
                    if ((eff.target || 'player') === 'player') { spendStamina(eff.amount || 1); sendGhostMessage(`💢 You take ${eff.amount || 1} — Stamina ${getStamina()}/${maxStamina()}${getPlayerRpgData()?.stats.unconscious ? ' — you black out!' : ''}`); }
                    else if (eff.npc) { const rel = spendNpcStamina(eff.npc, eff.amount || 1); sendGhostMessage(`⚔️ ${eff.npc} takes ${eff.amount || 1} — Stamina ${rel.npcStamina}/${npcMaxStamina(eff.npc)}${rel.npcUnconscious ? ' — she goes down!' : ''}`); }
                    break;
                case 'adjust_arousal': { const rel = getRelationship(eff.npc); const aroWas = getNpcArousal(eff.npc); setNpcArousalRaw(eff.npc, (rel.arousal ?? 0) + (eff.amount || 0)); if (eff.amount && !((eff.amount > 0) && getNpcArousal(eff.npc) === aroWas)) sendGhostMessage(`${eff.npc}: 🔥 arousal ${eff.amount > 0 ? '+' : ''}${eff.amount} → ${getNpcArousal(eff.npc)}/10 (${arousalTier(getNpcArousal(eff.npc)).label})`); savePlayer(); break; }
                case 'heal': healStamina(eff.target || (eff.npc ? eff.npc : 'player'), eff.amount); break;
                case 'sustenance': applySustenance(); break;
                case 'cervix_press': resolveCervixPress(eff.npc || eff.target); break;
                case 'belly_massage': resolveBellyMassage(eff.npc || eff.target); break;
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
    /** Everywhere the player could WALK to from here, however many hops. */
    function reachableFrom(fromId) {
        const world = currentGameState.worldData;
        const seen = new Set([fromId]);
        const q = [fromId];
        while (q.length) {
            const cur = q.shift();
            for (const c of (world?.locations?.[cur]?.connections || [])) if (!seen.has(c)) { seen.add(c); q.push(c); }
        }
        return seen;
    }
    function knownPlacesForAnalyzer() {
        // Which places no road reaches is a fact the ENGINE owns — it is the
        // location graph. Without it the Custodian reads a pocket dimension as
        // an ordinary destination and reaches for "move", which then dies on
        // routing and strands the story mid-translocation. Don't make the model
        // guess at something we can simply tell it.
        const reach = reachableFrom(currentGameState.currentLocation);
        return Object.entries(currentGameState.worldData?.locations || {}).map(([id, l]) => {
            const s = Number(l.secret) || 0;
            const tags = [];
            if (s >= 2) tags.push("secret: unknown to NPCs, not on the player's menus");
            else if (s === 1) tags.push("NPCs don't know of it");
            if (!reach.has(id)) tags.push('NO PATH LEADS THERE — no walking, riding or climbing can ever reach it; only event_teleport puts anyone inside');
            return `"${l.name || id}"${tags.length ? ` (${tags.join('; ')})` : ''}`;
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
        // Travelling ends the post-rest level-up window.
        if (currentGameState.levelUpAt && currentGameState.levelUpAt !== targetId) currentGameState.levelUpAt = null;
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
        const SELF_NARRATING = new Set(['birth', 'orgasm', 'damage', 'heal', 'restore_mana', 'sustenance', 'cervix_press', 'milk_attempt', 'belly_massage', 'adjust_affection', 'adjust_arousal', 'apply_curse', 'lift_curse', 'add_status', 'add_objective', 'remove_status', 'adjust_stat', 'equip_item', 'unequip_item', 'whereabouts']);
        return (effects || []).filter(e => !SELF_NARRATING.has(e.type)).map(e => {
            if (e.type === 'add_item') return `+${e.name}`;
            if (e.type === 'remove_item') return `-${e.name}`;
            if (e.type === 'adjust_gold') return `${e.amount >= 0 ? '+' : ''}${e.amount}g`;
            if (e.type === 'adjust_affection') return `${e.npc} affection ${e.amount >= 0 ? '+' : ''}${e.amount}`;
            return e.type;
        }).join(', ');
    }

    /**
     * Who will answer the player's line — ONE resolver, used both by the
     * reply loop and by the GM narration gate (they disagreed once, and the
     * GM narrated fluff over a woman who was about to answer a charm ask).
     * Priority: a directly-named NPC (the analyzer's single target_npc guess
     * is unreliable with 2+ present) → the analyzer's target resolved through
     * the same alias rules → whoever was already holding the conversation
     * (mid-conversation you stop using her name; she must still be here and
     * awake to take it).
     */
    function resolveReplyTargets(playerText, intent, dismissed = [], replied = []) {
        const addressed = detectAddressedNpcs(playerText);
        const analyzerTarget = resolveNpcName(intent?.target_npc);
        const stillHere = (n) => n && getNpcsAt(currentGameState.currentLocation).some(x => x.name === n)
            && !getRelationship(n).npcUnconscious;
        const holdingTheFloor = stillHere(currentGameState.lastReplier) ? currentGameState.lastReplier : null;
        const targets = (addressed.length ? addressed
            : analyzerTarget ? [analyzerTarget]
            : holdingTheFloor ? [holdingTheFloor] : [])
            .filter(n => !dismissed.includes(n))    // a dismissed companion already said her goodbye
            .filter(n => !replied.includes(n));     // …as has anyone who answered before we left
        return { addressed, targets };
    }

    async function narrateResult(playerText, intent, check) {
        const sys = `You are the GAME MASTER narrator of a fantasy RPG. In 1-2 vivid sentences, narrate the RESULT of the player's action from the mechanical outcome given. Keep it grounded in WHERE the scene is happening (the stated location) — do not drift the action to another place. Narrate only the world and the player's action/outcome. You NEVER give a named NPC dialogue, expressions, gestures, reactions, or movements — not one spoken word, not a frozen smirk, not a turn away. Each NPC responds for HERSELF after you; your narration must END before any NPC reacts, covering only the player's side and the ambient scene. If you need to reason first, do it inside <think></think> tags; the narration itself is pure prose. Be concise.`;
        let outcome;
        if (check) {
            const TIER_NOTE = {
                critical: 'CRITICAL SUCCESS — it works better than he dared hope; give him something extra.',
                success: 'SUCCESS — it works.',
                mixed: 'NEAR MISS — this is a FAILURE, not a partial win: he does NOT get what he wanted. Narrate it as "no, but…" — he falls just short, and only some small consolation or opening survives. Never award the thing he was reaching for.',
                failure: 'FAILURE — it does not work.',
                fumble: 'CRITICAL FAILURE — it goes badly, comically, or dangerously wrong. Make it COST him something beyond the failure itself.',
            };
            // Doubles are the world's thumb on the scale, so they get narrated
            // as something OUTSIDE him — luck, not skill. A plain success on
            // double sixes is the sweetest case: it only worked by a whisker of
            // fortune, so name the small miracle that carried it.
            // No example list here, deliberately. An earlier draft offered "a
            // gust at the right instant" as the first of four examples and got
            // a gust in every single sample — the model reaches for whatever it
            // is handed. State the CATEGORY and the constraint instead, and
            // require the luck to come from what this scene already contains,
            // which is also what stops it inventing props that make no sense
            // (a ledger being written on during a spoken request).
            const LUCK_RULE = 'The thing that intervenes must ALREADY EXIST in this scene — this place, this hour, someone else present, an object actually in use, his own body or gear — and it must act at the precise instant that matters. Name that specific thing and exactly what it did.';
            const swingNote = check.swing > 0
                ? (check.tier === 'success'
                    ? ` DOUBLE SIXES — by rights this should NOT have worked; only luck carried it. ${LUCK_RULE} The credit belongs to the world, not to him, and the prose should leave that unmistakable.`
                    : ` DOUBLE SIXES — fortune intervened on his side. ${LUCK_RULE}`)
                : check.swing < 0
                    ? ` SNAKE EYES — misfortune intervened against him; this was luck turning, not a lack of effort or skill. ${LUCK_RULE}`
                    : '';
            outcome = `${check.statName} check (DC ${check.difficulty}): rolled ${check.total} → ${TIER_NOTE[check.tier] || (check.success ? 'SUCCESS' : 'FAILURE')}${swingNote}`;
        }
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
        const prompt = `Setting (keep the scene HERE): ${currentSceneLabel()}.${currentLocationDesc() ? ` ${currentLocationDesc()}` : ''}${gmAreaNotesLine()}
RECENT STORY (continuity — the scene as it stands; narrate ONLY the new action's result, consistent with where this finds everyone):
${recentStoryWindow(8000)}
Player attempted: "${playerText}" (${intent?.narration_hint || ''})
Mechanical outcome: ${outcome}${eff ? `\nState change: ${eff}` : ''}${koNote}${freshNote}${travelIssueNote ? `\n${travelIssueNote}` : ''}
Narrate the result briefly, grounded in this location and the story's current beat.`;
        try {
            return await generateProse({ prompt, systemPrompt: sys, budget: 400, rescuePrefill: 'The ' });
        } catch (e) { console.error('RPG Custodian: narration failed', e); return null; }
    }

    async function triggerNpcReply(npcName, opts = {}) {
        if (!npcName) return false;
        const present = getNpcsAt(currentGameState.currentLocation).map(n => n.name);
        // Normally only someone in the room may speak. The exception is someone
        // the player addressed while they WERE in the room, whom the turn's own
        // effects have since moved apart from — she answers rather than vanishing.
        if (!present.includes(npcName) && !opts.wasAddressedHere) return false;
        // A KO'd NPC can't respond — skip her generation (the KO-aware GM
        // narration covers the scene); log a quiet note.
        // A newly-felled NPC gets ONE reply on the way down — the collapse is
        // hers to play (the climax that wrung her empty, the blow that felled
        // her). Only AFTER that swan song does unconsciousness mean silence.
        let swanSong = false;
        {
            const relKo = getRelationship(npcName);
            if (relKo.npcUnconscious) {
                if (relKo.koReplyOwed) {
                    swanSong = true;
                    relKo.koReplyOwed = null;
                    savePlayer();
                } else {
                    sendGhostMessage(`💤 ${npcName} is unconscious and cannot respond.`);
                    return false;
                }
            }
        }
        // Wait for any in-flight generation to finish before /trigger (avoids the
        // "cannot run while reply is generating" toast); quietly skip if it never
        // frees up rather than spamming an error.
        // Be patient here: with several people answering one line, each reply is
        // followed by a reaction-judge call, and on a slow connection the next
        // trigger can arrive while the pipeline is still settling. Ten seconds
        // was enough to drop the SECOND speaker in a group scene — and it did so
        // silently, which is the worst part. Wait properly, and if it really is
        // stuck, say so out loud instead of quietly swallowing her turn.
        if (!(await waitForGenerationIdle(45000))) {
            console.warn('RPG Custodian: generation still busy — skipping NPC trigger for', npcName);
            sendGhostMessage(`⏳ ${npcName} did not get a turn — the previous reply was still generating. Address her again and she will answer.`);
            return false;
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
        // Secret area notes SHE is privy to — hers alone, injected only for
        // her own generation (the shared status block carries the public ones).
        const areaSecrets = secretAreaNotesFor(npcName);
        if (areaSecrets.length) {
            context.setExtensionPrompt(AREANOTE_PROMPT_KEY, `[${npcName} KNOWS this about this place — NOT common knowledge; others present may not know it, and she reveals it only as she herself would: ${areaSecrets.join(' · ')}]`, 1, 0);
        }
        if (swanSong) {
            // Depth-0 and explicit, because the shared status block already
            // calls her UNCONSCIOUS — for this one reply, that line is wrong.
            context.setExtensionPrompt(KO_SWANSONG_PROMPT_KEY, `[DISREGARD any status line saying ${npcName} is unconscious — she is passing out DURING this reply, not before it. This is her LAST conscious moment: whatever just felled her — a climax that wrung her utterly empty, a blow, the end of her strength — is pulling her under NOW. Play the collapse honestly and vividly in her own nature: the shudder, the gasp, the words that trail off — and END the reply with her slipping fully into unconsciousness, limp and spent. She does not get back up.]`, 1, 0);
        }
        const preReplyLen = (getCtx().chat || []).length;
        const doneReply = perfStage(`reply:${npcName}`);
        try {
            await context.executeSlashCommandsWithOptions(`/trigger await=true ${npcName}`, { source: 'rpg-custodian' });
            doneReply({ chars: String((getCtx().chat || [])[preReplyLen]?.mes || '').length });
            perfMarkVisible();   // she is on the page — everything after this is tail
        } catch (e) { console.error('RPG Custodian: trigger NPC failed', e); }
        finally {
            if (reunion) context.setExtensionPrompt(REUNION_PROMPT_KEY, '', 1, 0);     // one-shot: clear after this reply
            if (charmNote) context.setExtensionPrompt(CHARM_PROMPT_KEY, '', 1, 0);
            if (whereNote) context.setExtensionPrompt(WHEREABOUTS_PROMPT_KEY, '', 1, 0);
            if (statusNote) context.setExtensionPrompt(STATUSREACT_PROMPT_KEY, '', 1, 0);
            if (areaSecrets.length) context.setExtensionPrompt(AREANOTE_PROMPT_KEY, '', 1, 0);
            if (swanSong) context.setExtensionPrompt(KO_SWANSONG_PROMPT_KEY, '', 1, 0);
            noteSeen(npcName);                                                         // she has now seen him this moment
            savePlayer();
        }
        // Her reply is on the page — read it against her bands (reaction judge).
        // Stamp the index so the out-of-band handler can't judge it twice.
        getRelationship(npcName).lastJudgedMesId = preReplyLen;
        currentGameState.lastReplier = npcName;   // she holds the conversation
        // Within a turn: ASK now, APPLY at the barrier — so the next woman can
        // start speaking while this one is still being judged. Calling without
        // awaiting is safe because everything that reads the chat (finding her
        // reply, building the prompt) happens synchronously before the request's
        // first await; only the model round trip is deferred.
        if (currentGameState.rpgOrchestrating && concurrentJudges) {
            pendingTurnJudges.push({ npc: npcName, verdict: requestReactionVerdict(npcName, preReplyLen) });
        } else {
            await judgeNpcReaction(npcName, preReplyLen);
        }
        return true;
    }

    // Reaction verdicts requested during the current turn, in speaker order.
    let pendingTurnJudges = [];
    // Off puts judging back on the critical path — kept so the concurrent and
    // sequential paths can be A/B'd against each other on the live backend.
    let concurrentJudges = true;

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
        pendingTurnJudges = [];                        // a previous turn's barrier already drained these
        let pendingConds = null, condVerdict = null;   // resolved at the barrier below
        const dismissedThisTurn = [];   // companions dismissed this turn (already gave their farewell)
        currentGameState.npcClimaxedThisTurn = [];   // so one climax is never counted twice
        // Who the player spoke TO, judged while they are all still in the room.
        // Effects run before anyone replies, so a turn that walks away would
        // otherwise leave the person he just addressed with no chance to answer.
        const addressedAtStart = detectAddressedNpcs(playerText)
            .filter(n => getNpcsAt(currentGameState.currentLocation).some(p => p.name === n));
        const repliedThisTurn = [];
        try {
            // ACTION MODE: a menu-armed action replaces the whole freeform
            // pipeline for this one message. The menu already declared WHAT;
            // the judge reads WHO and HOW from the words + scene. One-shot:
            // disarm first, so a thrown error can never leave a stale arm.
            const armedNow = currentGameState.armedAction;
            if (armedNow) {
                disarmAction();
                const doneAction = perfStage(`action:${armedNow.id}`);
                await runArmedAction(armedNow, playerText);
                doneAction();
                return;   // the finally barrier still drains her reply's reaction judge
            }
            const doneAnalyze = perfStage('analyze');
            const intent = await analyzeIntent(playerText);
            doneAnalyze({ mechanical: !!intent?.mechanical, check: intent?.check?.stat || null });
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
                        // Leaving is a beat in the sequence like any other, and
                        // anyone spoken to before it must answer BEFORE the door
                        // shuts — otherwise "say goodbye, then head out" moves
                        // first and her farewell is dropped for not being present.
                        case 'move':
                            for (const n of addressedAtStart) {
                                if (repliedThisTurn.includes(n) || dismissedThisTurn.includes(n)) continue;
                                repliedThisTurn.push(n);
                                await triggerNpcReply(n);
                            }
                            moved = await doNlMove(e.destination) || moved; break;
                        case 'event_teleport':
                            for (const n of addressedAtStart) {
                                if (repliedThisTurn.includes(n) || dismissedThisTurn.includes(n)) continue;
                                repliedThisTurn.push(n);
                                await triggerNpcReply(n);
                            }
                            moved = await doEventTeleport(e.destination) || moved; break;
                        case 'rest': await doRest(); break;
                        case 'milk_attempt': await resolveMilkAttempt(e); break;
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
                // Judged by WHO WILL ACTUALLY REPLY, not by whether he typed
                // her name: mid-conversation asks drop the name, and the old
                // detectAddressedNpcs-only gate let the GM paint the steam
                // curling off a teacup while she was already drawing breath
                // to answer (live, 2026-08-10).
                const charmExchange = intent?.check?.stat === 'charm'
                    && resolveReplyTargets(playerText, intent, dismissedThisTurn, repliedThisTurn).targets.length > 0;
                // The cervix_press contest is resolved between the check line
                // and HER reply — the GM narrating it would speak her body for
                // her (Dyna: "don't have the gm narrate this result"). The
                // milk_attempt likewise runs its OWN dedicated GM beat inside
                // the resolver; the generic narration would double-speak it.
                const intimatePress = (effects || []).some(e => e.type === 'cervix_press' || e.type === 'milk_attempt' || e.type === 'belly_massage');
                // The GM narrates RESOLVED GAME ACTIONS — nothing else. Asked to
                // narrate a turn that resolved nothing, it has no outcome to
                // report and paints the room instead ("the scarred prep island
                // waits between the hanging herbs…"), which reads as the
                // narrator barging into a conversation. So it speaks only when
                // dice were rolled or the world actually changed.
                const SELF_ANNOUNCING = new Set(['examine', 'whereabouts']);
                const substantive = (effects || []).filter(e => !SELF_ANNOUNCING.has(e.type));
                // ALONE is the exception. With nobody here to answer, the GM is
                // the only voice the world has — making camp, picking through a
                // ruin, listening at a door all deserve prose. The restraint
                // above exists to stop it talking OVER people, not to leave a
                // solitary scene silent.
                const resolvedSomething = !!check || substantive.length > 0 || aloneHere();
                if (!pureMove && !pureExamine && !charmExchange && !intimatePress && resolvedSomething) {
                    const doneNarr = perfStage('narrate');
                    const gm = await narrateResult(playerText, intent, check);
                    doneNarr();
                    if (gm) sendGameMasterMessage(gm);
                } else if (!resolvedSomething) {
                    console.log('RPG Custodian: nothing was resolved this turn — GM stays quiet.');
                }
            }

            // React. Who replies is decided DETERMINISTICALLY from the player's
            // words — same resolver the narration gate consulted, so the GM
            // can never narrate over someone this resolver says will speak.
            const { targets } = resolveReplyTargets(playerText, intent, dismissedThisTurn, repliedThisTurn);
            if (targets.length) {
                // Someone addressed while present still gets to answer even if
                // the turn has since separated them: silence should never be the
                // side-effect of a sequencing accident.
                let anySpoke = false;
                for (const name of targets) {
                    if (await triggerNpcReply(name, { wasAddressedHere: addressedAtStart.includes(name) })) anySpoke = true;
                }
                // Everyone he spoke to is out cold: the room has no voice but
                // the narrator's, so give the moment its due rather than
                // leaving it on a bare "she is unconscious" line.
                if (!anySpoke && aloneHere() && intent && !intent.mechanical) {
                    const gm = await narrateResult(playerText, intent, null);
                    if (gm) sendGameMasterMessage(gm);
                }
            } else if (intent && !intent.mechanical && aloneHere()) {
                // Solitary beat: nobody is here to react, so the narrator gives
                // the moment its due.
                const gm = await narrateResult(playerText, intent, null);
                if (gm) sendGameMasterMessage(gm);
            }
            // Note the absence of a broader `else`: with people PRESENT, a line
            // that resolved nothing and named nobody gets SILENCE. That fallback
            // is how the narrator used to scene-set over ordinary conversation.
            // SillyTavern's own group controls are there if you want someone to
            // speak anyway.

            // Now that the turn's story is on the page, let the Custodian judge
            // whether any status/curse break-condition was just satisfied. This
            // needs only the finished story, so it is STARTED here and left to
            // run alongside the reaction judges still in flight rather than
            // queueing behind them.
            const doneCond = perfStage('conditions');
            pendingConds = collectPendingConditions();
            condVerdict = pendingConds.length
                ? evaluateConditions(pendingConds.map(p => ({ id: p.id, text: p.text }))).then(v => { doneCond(); return v; })
                : (doneCond(), null);
        } catch (e) {
            console.error('RPG Custodian: orchestration error', e);
        } finally {
            // The barrier. Nothing the turn started is allowed to outlive it,
            // and everything lands in one fixed order: reaction verdicts in
            // speaker order, then condition outcomes. Anything else would let a
            // "💗 affection +1" or a "⚖️ condition met" surface against whatever
            // reply happened to be on screen when its call returned.
            try {
                const judges = pendingTurnJudges; pendingTurnJudges = [];
                for (const j of judges) applyReactionVerdict(j.npc, await j.verdict);
                if (condVerdict) applyConditionVerdicts(pendingConds, await condVerdict);
            } catch (e) { console.error('RPG Custodian: turn barrier failed', e); }
            perfEnd();
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
            {   // stamp first, whatever else we decide to do with it
                const c = getCtx().chat || [];
                stampWitnesses(c[typeof mesId === 'number' ? mesId : c.length - 1]);
            }
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
            perfBegin(msg.mes);    // the clock starts the moment he hits send
            stampWitnesses(msg);   // who was in the room to hear him say it
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
        cycleLine: (n) => cycleAwarenessLine(n),
        gold: () => getGold(),
        effectiveStat: (s) => effectiveStat(s),
        analyze: (t) => analyzeIntent(t),                       // DC calibration probes
        rest: () => doRest(),
        // telemetry: perf() for the table, perfRaw() for everything, perfExport() to save
        perfRaw: () => (context.extensionSettings[extensionName].perf || []),
        perfClear: () => { context.extensionSettings[extensionName].perf = []; context.saveSettingsDebounced(); },
        perf: () => (context.extensionSettings[extensionName].perf || []).map(t => ({
            at: t.startedAt, mes: t.chatIndex, total: t.totalMs, lastLine: t.visibleMs, judging: t.judgeMs, afterLast: t.afterLastMs,
            calls: t.calls.length, present: (t.present || []).length,
            custodian: t.analyzer || '—',
            slowest: (t.stages || []).slice().sort((a, b) => (b.ms || 0) - (a.ms || 0))[0]?.label,
            action: t.action,
        })),
        // The turns where the Custodian never answered: the player acted and
        // the engine applied nothing. Silent by construction, so make them
        // easy to ask for.
        perfDead: () => (context.extensionSettings[extensionName].perf || [])
            .filter(t => t.analyzer === 'dead')
            .map(t => ({ at: t.startedAt, mes: t.chatIndex, why: t.analyzerDetail || '', action: t.action })),
        perfExport: () => {
            const blob = new Blob([JSON.stringify(context.extensionSettings[extensionName].perf || [], null, 1)], { type: 'application/json' });
            const a2 = document.createElement('a');
            a2.href = URL.createObjectURL(blob);
            a2.download = `rpg-custodian-perf-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`;
            a2.click(); setTimeout(() => URL.revokeObjectURL(a2.href), 30000);
            return (context.extensionSettings[extensionName].perf || []).length + ' turns exported';
        },
        addressed: (t) => detectAddressedNpcs(t),
        resolveNpc: (n) => resolveNpcName(n),
        rewind: () => rewindTimeStep(),
        canRewind: () => canRewindTime(),
        undoDepth: () => (currentGameState.timeUndo || []).length,
        narrate: (intent, check) => narrateResult(intent?.narration_hint || 'an action', intent, check),
        awardXp: (c) => awardCheckXp(c),
        levelUp: () => openLevelUp(),
        save: () => savePlayer(),
        checkLine: (c, label) => skillCheckLine(c, label || 'probe'),
        odds: (mod, dc) => successChance(mod, dc),
        createCharacter: () => createRPGCharacterCommand(),
        newGame: (w) => newGame(w),
        continueGame: (w) => continueGame(w),
        boost: (stat, amt) => addBoost(stat, amt, 'debug'),
        rollCheck: (stat, dc) => { const c = skillCheck(stat, dc || 8); consumeCheckEffects(stat); return c; },
        addGold: (n) => addGold(n),
        teleport: async (locId) => { currentGameState.currentLocation = locId; await syncPresence(); },
        // Faithful to a typed turn. onUserMessage starts the turn clock BEFORE
        // it orchestrates; a debug turn skipped perfBegin, so perfEnd bailed on
        // a null turn and act() recorded no telemetry at all — which is also
        // why none of it could be tested headlessly.
        act: (text) => { perfBegin(text); return orchestratePlayerAction(text); },
        busy: () => !!currentGameState.rpgOrchestrating,
        orgasm: (npc, internal, count) => resolvePlayerOrgasm(npc, internal !== false, count || 1),
        buff: (target, stat, amt, source) => addCustomStatus(target || 'player', { name: source || 'debug elixir', kind: amt >= 0 ? 'buff' : 'debuff', polarity: amt >= 0 ? 'positive' : 'negative', mods: [{ stat, amount: amt }], duration: 4 }),
        heal: (target, amt) => healStamina(target || 'player', amt),
        eat: () => applySustenance(),
        npcFx: (n) => openNpcEffectsPanel(n),
        replyTargets: (text, intent) => resolveReplyTargets(text, intent),
        cervixPress: (n) => resolveCervixPress(n),
        milk: (n, channel) => resolveMilkAttempt({ npc: n, channel: channel || 'vaginal' }),
        bellyMassage: (n) => resolveBellyMassage(n),
        armRomance: (id) => armAction({ kind: 'romance', id, label: ROMANCE_ACTIONS[id].label, desc: ROMANCE_ACTIONS[id].desc }),
        armSummon: (w) => armAction({ kind: 'spell', id: 'summon_lover', woman: w, label: `Summon Lover: ${w}`, desc: SPELL_CATALOG.summon_lover.desc, cost: SPELL_CATALOG.summon_lover.cost }),
        armed: () => currentGameState.armedAction,
        disarm: () => disarmAction(),
        spells: () => knownSpells(),
        verbDict: () => VERB_DICTIONARY,
        setMana: (n) => { const rd = getPlayerRpgData(); if (rd) { rd.stats.mana = Math.max(0, Math.min(maxMana(), n)); savePlayer(); } return getPlayerRpgData()?.stats.mana; },
        reunionNote: (n) => buildReunionNote(n),
        sched: (n) => scheduleSummary((currentGameState.npcRoster || []).find(x => x.name === n) || {}),
        rel: (n) => getRelationship(n),
        presence: (loc) => getNpcsAt(loc || currentGameState.currentLocation).map(n => n.name),
        tick: (n) => { for (let i = 0; i < (n || 1); i++) advanceTime(false); syncPresence(); },
        addParty: (n) => addToParty(n),
        removeParty: (n, opts) => removeFromParty(n, opts),
        reunionNote2: (n) => buildReunionNote(n),
        birth: (n, count, kind) => resolveBirth(n, count || 1, kind, true),
        curse: (target, duration) => applyCrystalCurse(target || 'player', duration),
        castCurse: (eff) => tryApplyCrystalCurse(eff || {}),
        uncurse: (target) => liftCrystalCurse(target || 'player'),
        isCursed: (target) => isCrystalCursed(target || 'player'),
        mana: () => ({ cur: getPlayerRpgData()?.stats.mana, max: maxMana() }),
        addStatus: (target, spec) => addCustomStatus(target || 'player', spec || {}),
        fertilityOf: (n) => fertilityPercent(n),
        applyEffects: (list) => applyEffects(Array.isArray(list) ? list : [list]),
        removeStatus: (target, name) => removeCustomStatus(target || 'player', name, 'debug'),
        presets: () => Object.keys(PRESET_STATUSES),
        addObjective: (spec) => addCustomStatus('player', { ...(spec || {}), category: 'quest' }),
        objectives: () => playerObjectives(),
        xp: () => getPlayerRpgData()?.stats?.experience || 0,
        completeQuest: (name) => {
            const e = playerObjectives().find(o => o.name.toLowerCase().includes(String(name || '').toLowerCase()));
            if (e) completeObjective('player', e);
            return e ? e.name : null;
        },
        statuses: (target) => ((!target || target === 'player') ? getPlayerRpgData()?.customEffects : getRelationship(target).customEffects) || [],
        statusNote: (n) => renderStatusReactionNotes(getRelationship(n)),
        eventTeleport: (d) => doEventTeleport(d),
        areaNotes: (loc) => areaNotesAt(loc || currentGameState.currentLocation),
        areaNoteAdd: (spec, loc) => {
            const l = loc || currentGameState.currentLocation;
            currentGameState.areaNotes = currentGameState.areaNotes || {};
            const list = currentGameState.areaNotes[l] = currentGameState.areaNotes[l] || [];
            list.push({ id: `an-${Date.now().toString(36)}-${list.length}`, text: spec?.text || '', secret: !!spec?.secret, privy: spec?.privy || [] });
            saveCurrentState(); projectPlayerStatus();
            return list;
        },
        areaNoteClear: (loc) => { const l = loc || currentGameState.currentLocation; if (currentGameState.areaNotes) delete currentGameState.areaNotes[l]; saveCurrentState(); projectPlayerStatus(); },
        areaSecretsFor: (viewer, loc) => secretAreaNotesFor(viewer, loc || currentGameState.currentLocation),
        gmAreaLine: () => gmAreaNotesLine(),
        analyzerAreaNotes: () => areaNotesForAnalyzer(),
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
        setConcurrentJudges: (v) => { concurrentJudges = v !== false; return concurrentJudges; },
        appraise: (item) => appraiseItem(item),
        equipped: () => equippedItemsSummary(),
        items: () => (getPlayerRpgData()?.inventory.items || []).map(i => ({ name: i.name, equipped: !!i.equipped, effect: i.effectText, usage: i.usage, mod: i.mod })),
        curseWithBreak: (target, cond) => applyCrystalCurse(target || 'player', null, cond),
        giveItem: (name) => addItem({ id: `${String(name).toLowerCase().replace(/\s+/g, '-')}-${Date.now()}`, name, desc: '' }),
        useItemNamed: (name) => useItemByName(name),
        conceptionKind: (n) => resolveConceptionKind(n),
        pregBand: (n, person) => pregnancyBand(n, person || 'third'),
        slot: (n, day, period) => npcSlotByName(n, day, period),
        pursuits: (n, elapsed) => absencePursuits((currentGameState.npcRoster || []).find(x => x.name === n), elapsed ?? 8),
        schedSummary: (n) => scheduleSummary((currentGameState.npcRoster || []).find(x => x.name === n) || {}),
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
        look: () => lookCommand({}, ''),
        pinChat: (ms) => pinChatToBottom(ms),
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