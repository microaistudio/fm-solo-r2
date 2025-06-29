// FlowMatic Print Manager - Production Mode Support
class PrintManager {
    constructor() {
        this.settings = {};
        this.loadSettings();
    }

    async loadSettings() {
        try {
            const response = await fetch('/api/admin/settings');
            if (response.ok) {
                const allSettings = await response.json();
                console.log('Raw settings response:', allSettings);
                
                // Handle both array and object responses
                if (Array.isArray(allSettings)) {
                    // Convert array to object
                    this.settings = {};
                    allSettings.forEach(setting => {
                        this.settings[setting.key] = setting.value;
                    });
                } else {
                    // Already an object
                    this.settings = allSettings;
                }
                console.log('Settings loaded:', this.settings);
            }
        } catch (error) {
            console.error('Error loading settings:', error);
            this.settings = {
                'feature.production_mode': 'false',
                'config.auto_print': 'false'
            };
        }
    }
    isProductionMode() {
        return this.settings['feature.production_mode'] === 'true';
    }

    async printTicket(ticketData) {
        if (this.isProductionMode()) {
            console.log('Production mode: Direct print');
            this.directPrint(ticketData);
        } else {
            console.log('Development mode: Show confirmation');
            this.showPrintConfirmation(ticketData);
        }
    }

    directPrint(ticketData) {
        console.log('Printing ticket directly:', ticketData);
        // Direct print implementation
        window.print();
    }

    showPrintConfirmation(ticketData) {
        console.log('Showing print confirmation for:', ticketData);
        // Show confirmation dialog
        if (confirm('Print ticket ' + ticketData.number + '?')) {
            window.print();
        }
    }
}

// Create global print manager
window.printManager = new PrintManager();
console.log('Print Manager initialized');