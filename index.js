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
    checkFrequency: 3,
    characterStats: {
        stat1: 1,
        stat2: 1,
        stat3: 1,
        stat4: 1,
        location: 'Starting Town',
        inventory: [],
    },
    statLabels: {
        stat1: 'Level',
        stat2: 'XP',
        stat3: 'Health',
        stat4: 'Max Health',
    },
    updatePrompt: `Please analyze the recent conversation and update the character stats if needed. Current stats:
{{stat1Label}}: {{stat-1}}
{{stat2Label}}: {{stat-2}}
{{stat3Label}}: {{stat-3}}
{{stat4Label}}: {{stat-4}}
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
    const labels = extension_settings[extensionName].statLabels || defaultSettings.statLabels;
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
                    <label id="rpg-stat-1-label">${labels.stat1}:</label>
                    <span id="rpg-stat-1">${currentStats.stat1}</span>
                </div>
                <div class="stat-row">
                    <label id="rpg-stat-2-label">${labels.stat2}:</label>
                    <span id="rpg-stat-2">${currentStats.stat2}</span>
                </div>
                <div class="stat-row">
                    <label id="rpg-stat-3-label">${labels.stat3}:</label>
                    <span id="rpg-stat-3">${currentStats.stat3}</span>
                </div>
                <div class="stat-row">
                    <label id="rpg-stat-4-label">${labels.stat4}:</label>
                    <span id="rpg-stat-4">${currentStats.stat4}</span>
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
    const labels = extension_settings[extensionName].statLabels || defaultSettings.statLabels;
    const html = `
        <div id="rpg-settings-menu" class="rpg-settings-menu" style="display: none;">
            <div class="rpg-settings-header">
                <h3>RPG Custodian Settings</h3>
                <div class="header-buttons">
                    <button id="rpg-settings-stats-btn" class="menu_button active">Stats</button>
                    <button id="rpg-settings-labels-btn" class="menu_button">Labels</button>
                    <button id="rpg-settings-prompt-btn" class="menu_button">Prompt</button>
                    <button id="rpg-settings-close" class="menu_button">✕</button>
                </div>
            </div>
            <div id="rpg-settings-content" class="rpg-settings-content">
                <div id="rpg-stats-editor" class="settings-section">
                    <div class="stat-input-row">
                        <label id="settings-stat-1-label">${labels.stat1}:</label>
                        <input type="number" id="rpg-stat-1-input" min="0" />
                    </div>
                    <div class="stat-input-row">
                        <label id="settings-stat-2-label">${labels.stat2}:</label>
                        <input type="number" id="rpg-stat-2-input" min="0" />
                    </div>
                    <div class="stat-input-row">
                        <label id="settings-stat-3-label">${labels.stat3}:</label>
                        <input type="number" id="rpg-stat-3-input" min="0" />
                    </div>
                    <div class="stat-input-row">
                        <label id="settings-stat-4-label">${labels.stat4}:</label>
                        <input type="number" id="rpg-stat-4-input" min="0" />
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
                <div id="rpg-labels-editor" class="settings-section" style="display: none;">
                    <div class="stat-input-row">
                        <label>Stat 1 Label:</label>
                        <input type="text" id="rpg-stat-1-label-input" value="${labels.stat1}" />
                    </div>
                    <div class="stat-input-row">
                        <label>Stat 2 Label:</label>
                        <input type="text" id="rpg-stat-2-label-input" value="${labels.stat2}" />
                    </div>
                    <div class="stat-input-row">
                        <label>Stat 3 Label:</label>
                        <input type="text" id="rpg-stat-3-label-input" value="${labels.stat3}" />
                    </div>
                    <div class="stat-input-row">
                        <label>Stat 4 Label:</label>
                        <input type="text" id="rpg-stat-4-label-input" value="${labels.stat4}" />
                    </div>
                </div>
                <div id="rpg-prompt-editor" class="settings-section" style="display: none;">
                    <textarea id="rpg-prompt-input" rows="10"></textarea>
                </div>
            </div>
            <div id="rpg-general-settings" class="settings-section">
                <div class="stat-input-row">
                    <label>Check Message Frequency:</label>
                    <input 
                        type="number" 
                        id="rpg-frequency-input" 
                        min="1" 
                        value="${extension_settings[extensionName].checkFrequency}"
                    />
                    <span class="helper-text">Number of messages before checking for stat updates</span>
                </div>
            </div>
        </div>
    `;
    
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
    
    createSettingsMenu();
    
    const settingsMenu = $('#rpg-settings-menu');
    const statsEditor = $('#rpg-stats-editor');
    const labelsEditor = $('#rpg-labels-editor');
    const promptEditor = $('#rpg-prompt-editor');
    const statsBtn = $('#rpg-settings-stats-btn');
    const labelsBtn = $('#rpg-settings-labels-btn');
    const promptBtn = $('#rpg-settings-prompt-btn');
    
    function onSettingsClick() {
        // Load current values
        $('#rpg-stat-1-input').val(currentStats.stat1);
        $('#rpg-stat-2-input').val(currentStats.stat2);
        $('#rpg-stat-3-input').val(currentStats.stat3);
        $('#rpg-stat-4-input').val(currentStats.stat4);
        $('#rpg-location-input').val(currentStats.location);
        $('#rpg-inventory-input').val(currentStats.inventory.join(', '));
        $('#rpg-prompt-input').val(extension_settings[extensionName].updatePrompt);
        
        // Load current labels
        const labels = extension_settings[extensionName].statLabels;
        $('#rpg-stat-1-label-input').val(labels.stat1);
        $('#rpg-stat-2-label-input').val(labels.stat2);
        $('#rpg-stat-3-label-input').val(labels.stat3);
        $('#rpg-stat-4-label-input').val(labels.stat4);
        
        settingsMenu.show();
    }
    
    // Close button handler
    $('#rpg-settings-close').on('click', () => {
        settingsMenu.hide();
    });
    
      // Tab switching
    statsBtn.on('click', () => {
        statsBtn.addClass('active');
        labelsBtn.removeClass('active');
        promptBtn.removeClass('active');
        statsEditor.show();
        labelsEditor.hide();
        promptEditor.hide();
    });
    
    labelsBtn.on('click', () => {
        labelsBtn.addClass('active');
        statsBtn.removeClass('active');
        promptBtn.removeClass('active');
        labelsEditor.show();
        statsEditor.hide();
        promptEditor.hide();
    });
    
    promptBtn.on('click', () => {
        promptBtn.addClass('active');
        statsBtn.removeClass('active');
        labelsBtn.removeClass('active');
        promptEditor.show();
        statsEditor.hide();
        labelsEditor.hide();
    });
    
     function saveSettings() {
        const newStats = {
            stat1: parseInt($('#rpg-stat-1-input').val()) || 0,
            stat2: parseInt($('#rpg-stat-2-input').val()) || 0,
            stat3: parseInt($('#rpg-stat-3-input').val()) || 0,
            stat4: parseInt($('#rpg-stat-4-input').val()) || 0,
            location: $('#rpg-location-input').val(),
            inventory: $('#rpg-inventory-input').val().split(',').map(item => item.trim()).filter(item => item)
        };
        
        const newLabels = {
            stat1: $('#rpg-stat-1-label-input').val() || 'Stat 1',
            stat2: $('#rpg-stat-2-label-input').val() || 'Stat 2',
            stat3: $('#rpg-stat-3-label-input').val() || 'Stat 3',
            stat4: $('#rpg-stat-4-label-input').val() || 'Stat 4'
        };
        
        const newPrompt = $('#rpg-prompt-input').val();

        // Update current stats and labels
        currentStats = newStats;
        extension_settings[extensionName].characterStats = newStats;
        extension_settings[extensionName].statLabels = newLabels;
        extension_settings[extensionName].updatePrompt = newPrompt;
        
        // Save settings
        saveSettingsDebounced();
        
        // Update UI
        updateUI();
        
        // Update settings menu labels
        for (let i = 1; i <= 4; i++) {
            $(`#settings-stat-${i}-label`).text(`${newLabels[`stat${i}`]}:`);
        }
    }
    
    
      // Input change handler with debounce
    $('.rpg-settings-content input, .rpg-settings-content textarea').on('input', function() {
        clearTimeout(saveTimeout);
        saveTimeout = setTimeout(saveSettings, 1000);
    });
    
    $('#rpg-settings-btn').off('click').on('click', onSettingsClick);
    $('#rpg-settings-close').on('click', () => settingsMenu.hide());
}

function loadSettings() {
    console.log(`[${extensionName}] Loading settings...`);
    
    if (Object.keys(extension_settings[extensionName]).length === 0) {
        console.log(`[${extensionName}] No existing settings found. Initializing with defaults...`);
        extension_settings[extensionName] = defaultSettings;
        saveSettingsDebounced();
    } else {
        console.log(`[${extensionName}] Existing settings found:`, extension_settings[extensionName]);
        // Ensure statLabels exists, initialize with defaults if it doesn't
        if (!extension_settings[extensionName].statLabels) {
            extension_settings[extensionName].statLabels = defaultSettings.statLabels;
            saveSettingsDebounced();
        }
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
    
    const labels = extension_settings[extensionName].statLabels || defaultSettings.statLabels;
    
    // Update stat values and labels
    for (let i = 1; i <= 4; i++) {
        $(`#rpg-stat-${i}`).text(currentStats[`stat${i}`]);
        $(`#rpg-stat-${i}-label`).text(`${labels[`stat${i}`]}:`);
    }
    
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
    
    // Register event handlers
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