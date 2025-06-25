const http = require('http');
const app = require('./app');
const { initializeDatabase, closeDatabase } = require('./database/connection');
const { setupSocketIO } = require('./realtime/socketManager');

const PORT = process.env.PORT || 5050;

async function startServer() {
    try {
        await initializeDatabase();
        
        const server = http.createServer(app);
        const io = setupSocketIO(server);
        
        server.listen(PORT, () => {
            console.log(`FlowMatic-SOLO server running on port ${PORT}`);
            console.log('Socket.IO server ready');
        });
        
        return server;
    } catch (error) {
        console.error('Failed to start server:', error);
        process.exit(1);
    }
}

let server;
startServer().then(s => { server = s; });

process.on('SIGTERM', async () => {
    console.log('SIGTERM signal received: closing HTTP server');
    if (server) {
        server.close(async () => {
            await closeDatabase();
            console.log('HTTP server closed');
        });
    }
});

process.on('SIGINT', async () => {
    console.log('SIGINT signal received: closing HTTP server');
    if (server) {
        server.close(async () => {
            await closeDatabase();
            console.log('HTTP server closed');
        });
    }
});