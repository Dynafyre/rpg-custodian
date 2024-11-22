// Import required dependencies
import { extension_settings, getContext, saveMetadataDebounced } from '../../../extensions.js';
import { saveSettingsDebounced, eventSource, event_types } from '../../../../script.js';
import { registerSlashCommand } from '../../../slash-commands.js';
import { dragElement, isMobile } from '../../../../scripts/RossAscends-mods.js';

// Extension name and settings
const extensionName = 'rpg-custodian';
console.log(`[${extensionName}] Loading extension...`);

const defaultSettings = {
    enabled: true,
    checkFrequency: 3, // How many messages before checking for updates
    characterStats: {
        level: 1,
        experience: 0,
        health: 100,
        maxHealth: 100,
        location: 'Starting Town',
        inventory: [],
    },
    // System prompt template for the AI to check for updates
    updatePrompt: `Please analyze the recent conversation and update the character stats if needed. Current stats:
Level: {{level}}
XP: {{experience}}
Health: {{health}}/{{maxHealth}}
Location: {{location}}
Inventory: {{inventory}}

Look for:
1. Changes in health from combat or healing
2. New items acquired or used
3. Location changes
4. Experience gained from completing tasks

Respond ONLY with a JSON object containing updated stats, or "NO_CHANGE" if nothing has changed.`
};

let currentStats = {};
let checkCounter = 0;

// Character Sheet Creation
function createCharacterSheet() {
    const html = `
    <div id="rpg-custodian-panel" class="rpg-panel">
            <div id="rpg-custodian-panelheader" class="rpg-header">
                <h3>Character Sheet</h3>
                <div class="header-buttons">
                    <span id="rpg-toggle-btn" class="fas fa-minus" title="Minimize/Maximize"></span>
                    <button id="rpg-settings-btn" class="menu_button">⚙️</button>
                </div>
            </div>
            <div class="rpg-stats">
                <div class="stat-row">
                    <label>Level:</label>
                    <span id="rpg-level">${currentStats.level}</span>
                </div>
                <div class="stat-row">
                    <label>Experience:</label>
                    <span id="rpg-xp">${currentStats.experience}</span>
                </div>
                <div class="stat-row">
                    <label>Health:</label>
                    <span id="rpg-health">${currentStats.health}/${currentStats.maxHealth}</span>
                </div>
                <div class="stat-row">
                    <label>Location:</label>
                    <span id="rpg-location">${currentStats.location}</span>
                </div>
                <div class="stat-row">
                    <label>Inventory:</label>
                    <div id="rpg-inventory" class="inventory-list">
                        ${currentStats.inventory.map(item => `<div class="inventory-item">${item}</div>`).join('')}
                    </div>
                </div>
            </div>
        </div>`;
    return html;
}

// Create the settings HTML template
function createSettingsMenu() {
    const html = `
        <div id="rpg-settings-menu" class="rpg-settings-menu" style="display: none;">
            <div class="rpg-settings-header">
                <h3>RPG Custodian Settings</h3>
                <div class="header-buttons">
                    <button id="rpg-settings-stats-btn" class="menu_button active">Stats</button>
                    <button id="rpg-settings-prompt-btn" class="menu_button">Prompt</button>
                    <button id="rpg-settings-close" class="menu_button">✕</button>
                </div>
            </div>
            <div id="rpg-settings-content" class="rpg-settings-content">
                <div id="rpg-stats-editor" class="settings-section">
                    <div class="stat-input-row">
                        <label>Level:</label>
                        <input type="number" id="rpg-level-input" min="1" />
                    </div>
                    <div class="stat-input-row">
                        <label>Experience:</label>
                        <input type="number" id="rpg-xp-input" min="0" />
                    </div>
                    <div class="stat-input-row">
                        <label>Health:</label>
                        <input type="number" id="rpg-health-input" min="0" />
                    </div>
                    <div class="stat-input-row">
                        <label>Max Health:</label>
                        <input type="number" id="rpg-maxhealth-input" min="0" />
                    </div>
                    <div class="stat-input-row">
                        <label>Location:</label>
                        <input type="text" id="rpg-location-input" />
                    </div>
                    <div class="stat-input-row">
                        <label>Inventory:</label>
                        <textarea id="rpg-inventory-input" rows="4" placeholder="Enter items separated by commas"></textarea>
                    </div>
                </div>
                <div id="rpg-prompt-editor" class="settings-section" style="display: none;">
                    <textarea id="rpg-prompt-input" rows="10"></textarea>
                </div>
            </div>
        </div>
    `;
    
    // Add the settings menu to the body
    $('body').append(html);
    
    
}

// Panel Management Functions
function initializePanel() {
    console.log(`[${extensionName}] Initializing character panel...`);
    
    // Add panel to body
    $('body').append(createCharacterSheet());
    
	// Make panel draggable - note the jQuery selector
    dragElement($('#rpg-custodian-panel'));
    
    // Initialize minimize/maximize functionality
    $('#rpg-toggle-btn').on('click', function() {
        const panel = $('#rpg-custodian-panel');
        const icon = $(this);
        
        console.log(`[${extensionName}] Toggling panel visibility`);
        
        if (panel.hasClass('minimized')) {
            panel.removeClass('minimized');
            icon.removeClass('fa-plus').addClass('fa-minus');
        } else {
            panel.addClass('minimized');
            icon.removeClass('fa-minus').addClass('fa-plus');
        }
    });
}

function savePanelPosition() {
    const panel = document.getElementById('rpg-custodian-panel');
    if (panel) {
        extension_settings[extensionName].panelPosition = {
            x: panel.offsetLeft,
            y: panel.offsetTop
        };
        saveSettingsDebounced();
    }
}

// Settings Management Functions
function initializeSettings() {
    let saveTimeout;
    
    // Create and initialize the settings menu
    createSettingsMenu();
    
    // Get elements
    const settingsMenu = $('#rpg-settings-menu');
    const statsEditor = $('#rpg-stats-editor');
    const promptEditor = $('#rpg-prompt-editor');
    const statsBtn = $('#rpg-settings-stats-btn');
    const promptBtn = $('#rpg-settings-prompt-btn');
    
    // Settings button click handler
    function onSettingsClick() {
        // Load current values
        $('#rpg-level-input').val(currentStats.level);
        $('#rpg-xp-input').val(currentStats.experience);
        $('#rpg-health-input').val(currentStats.health);
        $('#rpg-maxhealth-input').val(currentStats.maxHealth);
        $('#rpg-location-input').val(currentStats.location);
        $('#rpg-inventory-input').val(currentStats.inventory.join(', '));
        $('#rpg-prompt-input').val(extension_settings[extensionName].updatePrompt);
        
        // Show the settings menu
        settingsMenu.show();
    }
    
    // Close button handler
    $('#rpg-settings-close').on('click', () => {
        settingsMenu.hide();
    });
    
    // Tab switching
    statsBtn.on('click', () => {
        statsBtn.addClass('active');
        promptBtn.removeClass('active');
        statsEditor.show();
        promptEditor.hide();
    });
    
    promptBtn.on('click', () => {
        promptBtn.addClass('active');
        statsBtn.removeClass('active');
        promptEditor.show();
        statsEditor.hide();
    });
    
    // Save function
    function saveSettings() {
        const newStats = {
            level: parseInt($('#rpg-level-input').val()) || 1,
            experience: parseInt($('#rpg-xp-input').val()) || 0,
            health: parseInt($('#rpg-health-input').val()) || 0,
            maxHealth: parseInt($('#rpg-maxhealth-input').val()) || 100,
            location: $('#rpg-location-input').val(),
            inventory: $('#rpg-inventory-input').val().split(',').map(item => item.trim()).filter(item => item)
        };
        
        const newPrompt = $('#rpg-prompt-input').val();
        
        // Update current stats
        currentStats = newStats;
        extension_settings[extensionName].characterStats = newStats;
        extension_settings[extensionName].updatePrompt = newPrompt;
        
        // Save settings
        saveSettingsDebounced();
        
        // Update UI
        updateUI();
    }
    
    // Input change handler with debounce
    $('.rpg-settings-content input, .rpg-settings-content textarea').on('input', function() {
        clearTimeout(saveTimeout);
        saveTimeout = setTimeout(saveSettings, 1000);
    });
    
    // Replace the existing onSettingsClick function
    $('#rpg-settings-btn').off('click').on('click', onSettingsClick);
}

function loadSettings() {
    console.log(`[${extensionName}] Loading settings...`);
    
    if (Object.keys(extension_settings[extensionName]).length === 0) {
        console.log(`[${extensionName}] No existing settings found. Initializing with defaults...`);
        extension_settings[extensionName] = defaultSettings;
        saveSettingsDebounced();
    } else {
        console.log(`[${extensionName}] Existing settings found:`, extension_settings[extensionName]);
    }
    
    currentStats = extension_settings[extensionName].characterStats;
    checkCounter = extension_settings[extensionName].checkFrequency;
    
    console.log(`[${extensionName}] Current stats loaded:`, currentStats);
    console.log(`[${extensionName}] Check counter set to:`, checkCounter);
}

function saveState() {
    console.log(`[${extensionName}] Saving state...`);
    const context = getContext();
    
    if (!context.chatId) {
        console.warn(`[${extensionName}] No chat ID found, skipping save`);
        return;
    }
    
    console.log(`[${extensionName}] Saving for chat ID:`, context.chatId);
    console.log(`[${extensionName}] Saving stats:`, currentStats);
    
    extension_settings[extensionName].characterStats = currentStats;
    saveSettingsDebounced();
    saveMetadataDebounced();
}

// UI Update Function
function updateUI() {
    console.log(`[${extensionName}] Updating UI with current stats:`, currentStats);
    
    $('#rpg-level').text(currentStats.level);
    $('#rpg-xp').text(currentStats.experience);
    $('#rpg-health').text(`${currentStats.health}/${currentStats.maxHealth}`);
    $('#rpg-location').text(currentStats.location);
    
    const inventoryHtml = currentStats.inventory
        .map(item => `<div class="inventory-item">${item}</div>`)
        .join('');
    $('#rpg-inventory').html(inventoryHtml);
    
    console.log(`[${extensionName}] UI update complete`);
}

// Check for stat updates
async function checkForUpdates() {
    console.log(`[${extensionName}] Checking for character stat updates...`);
    console.log(`[${extensionName}] Current stats before check:`, currentStats);
    // TODO: Implement the quiet prompt generation to check for updates
}

// Initialize Extension
jQuery(async () => {
    console.log(`[${extensionName}] Initializing extension...`);
    
    // Load settings
    loadSettings();
    
    // Initialize the panel
    initializePanel();
    
    // Initialize settings menu and functionality
    initializeSettings();
    
    // Register event handlers (removed redundant settings button click handler as it's now handled in initializeSettings)
    console.log(`[${extensionName}] Setting up message received listener...`);
    eventSource.on(event_types.MESSAGE_RECEIVED, () => {
        console.log(`[${extensionName}] Message received, check counter:`, checkCounter);
        
        if (checkCounter <= 0) {
            console.log(`[${extensionName}] Check counter reached 0, initiating stat update check`);
            checkForUpdates();
            checkCounter = extension_settings[extensionName].checkFrequency;
            console.log(`[${extensionName}] Reset check counter to:`, checkCounter);
        }
        checkCounter--;
    });
    
    // Register slash commands
    console.log(`[${extensionName}] Registering slash commands...`);
    registerSlashCommand('stats', () => {
        console.log(`[${extensionName}] /stats command executed`);
        updateUI();
        console.log(`[${extensionName}] Current character stats:`, currentStats);
    }, [], '– display character stats', true, true);
    
    // Add panel position save on window unload
    $(window).on('beforeunload', savePanelPosition);
    
    console.log(`[${extensionName}] Extension initialization complete`);
});