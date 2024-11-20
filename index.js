// index.js
// Minimal version to test loading
import { extension_settings } from "../../../extensions.js";

const extensionName = "rpg-custodian";

// Initialize extension
jQuery(() => {
    console.log("RPG Custodian attempting to load...");
    
    // Minimal settings
    extension_settings[extensionName] = extension_settings[extensionName] || {};
    
    // Test UI element
    $('#right-nav-panel').append(`
        <div>RPG Custodian Test</div>
    `);
});