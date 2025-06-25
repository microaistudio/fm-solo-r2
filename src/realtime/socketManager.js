// src/realtime/socketManager.js
// UPDATED VERSION with connection management for Phase 2.3

const connectionManager = require('./connectionManager');
const { INBOUND_EVENTS } = require('./eventTypes');
const { setupHeartbeatHandlers } = require('./heartbeat');

// Store reference to io instance (NEW)
let io = null;

// Setup Socket.IO with namespaces (UPDATED SIGNATURE)
function setupSocketIO(socketIO) {
  io = socketIO;  // Store reference (NEW)
  
  // Setup namespaces as defined in architecture
  const namespaces = [
    '/kiosk',
    '/terminal', 
    '/monitor',
    '/customer'
  ];

  namespaces.forEach(namespace => {
    io.of(namespace).on('connection', (socket) => {
      // Add to connection manager (NEW)
      connectionManager.addConnection(namespace, socket);
      
      console.log(`Client connected to ${namespace}: ${socket.id}`);

      // Handle disconnection
      socket.on('disconnect', (reason) => {
        console.log(`Client disconnected from ${namespace}: ${socket.id} (${reason})`);
        connectionManager.removeConnection(namespace, socket.id); // NEW
      });

      // NEW: Handle join-service event (for targeted broadcasts)
      socket.on(INBOUND_EVENTS.JOIN_SERVICE, (data) => {
        if (data && data.serviceId) {
          const room = `service-${data.serviceId}`;
          socket.join(room);
          connectionManager.joinRoom(socket.id, room);
          console.log(`Socket ${socket.id} joined room: ${room}`);
          
          // Send acknowledgment
          socket.emit('joined', { room, serviceId: data.serviceId });
        }
      });

      // NEW: Handle join-counter event (for counter-specific updates)
      socket.on(INBOUND_EVENTS.JOIN_COUNTER, (data) => {
        if (data && data.counterId) {
          const room = `counter-${data.counterId}`;
          socket.join(room);
          connectionManager.joinRoom(socket.id, room);
          console.log(`Socket ${socket.id} joined room: ${room}`);
          
          // Send acknowledgment
          socket.emit('joined', { room, counterId: data.counterId });
        }
      });

      // NEW: Handle join-all event (for monitoring all updates)
      socket.on(INBOUND_EVENTS.JOIN_ALL, () => {
        const room = 'all-updates';
        socket.join(room);
        connectionManager.joinRoom(socket.id, room);
        console.log(`Socket ${socket.id} joined room: ${room}`);
        
        // Send acknowledgment
        socket.emit('joined', { room });
      });

      // NEW: Update activity on any event
      socket.onAny(() => {
        connectionManager.updateActivity(socket.id);
      });

      // NEW: Setup heartbeat handlers
      setupHeartbeatHandlers(socket, namespace);
      
      // NEW: Send welcome message with connection info
      socket.emit('welcome', {
        namespace,
        socketId: socket.id,
        connectedAt: new Date(),
        server: 'FlowMatic-SOLO R2'
      });
    });
  });

  // NEW: Add admin endpoint for connection stats
  io.of('/admin').on('connection', (socket) => {
    console.log(`Admin connected: ${socket.id}`);
    
    socket.on('get-stats', () => {
      socket.emit('stats', connectionManager.getStats());
    });

    socket.on('get-connections', () => {
      socket.emit('connections', connectionManager.getAllCounts());
    });

    socket.on('disconnect', () => {
      console.log(`Admin disconnected: ${socket.id}`);
    });
  });

  console.log('Socket.IO namespaces initialized with connection tracking');
}

// NEW: Get Socket.IO instance
function getIO() {
  if (!io) {
    throw new Error('Socket.IO not initialized. Call setupSocketIO first.');
  }
  return io;
}

// NEW: Get specific namespace
function getNamespace(namespace) {
  const io = getIO();
  return io.of(namespace);
}

// NEW: Get connection stats
function getConnectionStats() {
  return connectionManager.getStats();
}

// NEW: Get connections in a specific room
function getRoomConnections(room) {
  return connectionManager.getConnectionsInRoom(room);
}

module.exports = {
  setupSocketIO,
  getIO,           // NEW export
  getNamespace,    // NEW export
  getConnectionStats,  // NEW export
  getRoomConnections   // NEW export
};