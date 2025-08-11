/**
 * RPG Custodian Extension for SillyTavern
 * A comprehensive RPG system bringing game mechanics and living world features
 */

jQuery(async () => {
    'use strict';

    const extensionName = 'rpg-custodian';
    
    // Get SillyTavern context
    const context = SillyTavern.getContext();
    
    /**
     * Initialize the extension
     */
    async function init() {
        console.log('RPG Custodian: Initializing extension');
        
        // Ensure Game Master character exists
        await ensureGameMasterExists();
        
        // Add RPG menu button
        addRpgMenuButton();
        
        console.log('RPG Custodian: Extension initialized');
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
        
        button.on('click', async function() {
            console.log('RPG menu button clicked - switching to Game Master');
            await switchToGameMaster();
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
        
        // Touch events for mobile - simpler approach to avoid dimension changes
        button.on('touchstart', function(e) {
            e.preventDefault(); // Prevent default touch behavior
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
     * Ensure Game Master character exists, create from template if not
     */
    async function ensureGameMasterExists() {
        try {
            // Check if Game Master already exists
            const characters = context.characters;
            const gameMasterExists = characters.some(char => 
                char.avatar === 'Game Master.json'
            );
            
            if (gameMasterExists) {
                console.log('RPG Custodian: Game Master character already exists');
                return;
            }
            
            console.log('RPG Custodian: Game Master not found, creating from template...');
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
            
            // Use the data object from the template (Character Card V3 format)
            const charData = templateData.data || templateData;
            
            // Create FormData for character creation (following SillyTavern's API)
            const formData = new FormData();
            formData.append('ch_name', charData.name || 'Game Master');
            formData.append('file_name', 'Game Master');
            formData.append('description', charData.description || '');
            formData.append('personality', charData.personality || '');
            formData.append('scenario', charData.scenario || '');
            formData.append('first_mes', charData.first_mes || '');
            formData.append('mes_example', charData.mes_example || '');
            formData.append('creator_notes', charData.creator_notes || '');
            formData.append('system_prompt', charData.system_prompt || '');
            formData.append('post_history_instructions', charData.post_history_instructions || '');
            formData.append('creator', charData.creator || '');
            formData.append('character_version', charData.character_version || '');
            
            // Handle alternate greetings
            if (charData.alternate_greetings && charData.alternate_greetings.length > 0) {
                charData.alternate_greetings.forEach(greeting => {
                    formData.append('alternate_greetings', greeting);
                });
            }
            
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
            
            console.log('RPG Custodian: Game Master character created successfully');
            
        } catch (error) {
            console.error('RPG Custodian: Error creating Game Master from template:', error);
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
                char.avatar === 'Game Master.json'
            );
            
            if (gameMasterIndex === -1) {
                console.error('RPG Custodian: Game Master character not found, attempting to create...');
                await ensureGameMasterExists();
                
                // Try to find again after creation attempt
                const updatedCharacters = context.characters;
                const newGameMasterIndex = updatedCharacters.findIndex(char => 
                    char.avatar === 'Game Master.json'
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

    // Initialize the extension when loaded
    init();
});