const socketIO = require('socket.io');

/**
 * Setup Socket.IO with 4 namespaces as per architecture
 * @param {Object} server - HTTP server instance
 * @returns {Object} Socket.IO instance
 */
function setupSocketIO(server) {
    const io = socketIO(server, {
        cors: {
            origin: '*',
            methods: ['GET', 'POST']
        }
    });

    // 1. Kiosk namespace - for ticket printers
    const kioskNS = io.of('/kiosk');
    kioskNS.on('connection', (socket) => {
        console.log(`[Kiosk] Client connected: ${socket.id}`);
        
        socket.on('disconnect', () => {
            console.log(`[Kiosk] Client disconnected: ${socket.id}`);
        });
    });

    // 2. Terminal namespace - for agent stations
    const terminalNS = io.of('/terminal');
    terminalNS.on('connection', (socket) => {
        console.log(`[Terminal] Client connected: ${socket.id}`);
        
        socket.on('disconnect', () => {
            console.log(`[Terminal] Client disconnected: ${socket.id}`);
        });
    });

    // 3. Monitor namespace - for display screens
    const monitorNS = io.of('/monitor');
    monitorNS.on('connection', (socket) => {
        console.log(`[Monitor] Client connected: ${socket.id}`);
        
        socket.on('disconnect', () => {
            console.log(`[Monitor] Client disconnected: ${socket.id}`);
        });
    });

    // 4. Customer namespace - for counter display
    const customerNS = io.of('/customer');
    customerNS.on('connection', (socket) => {
        console.log(`[Customer] Client connected: ${socket.id}`);
        
        socket.on('disconnect', () => {
            console.log(`[Customer] Client disconnected: ${socket.id}`);
        });
    });

    return io;
}

module.exports = {
    setupSocketIO
};