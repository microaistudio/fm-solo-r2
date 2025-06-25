const { EVENTS } = require('./eventTypes');

/**
 * Broadcast ticket created event to all relevant namespaces
 * @param {Object} io - Socket.IO instance
 * @param {Object} ticketData - The ticket information
 * @param {Object} queueData - Current queue statistics
 */
function broadcastTicketCreated(io, ticketData, queueData) {
    // Broadcast to kiosk namespace (for confirmation)
    io.of('/kiosk').emit(EVENTS.TICKET_CREATED, {
        ticket: ticketData,
        queue: queueData,
        timestamp: new Date().toISOString()
    });

    // Broadcast to terminal namespace (agents see new ticket in queue)
    io.of('/terminal').to(`service-${ticketData.service_id}`).emit(EVENTS.TICKET_CREATED, {
        ticket: ticketData,
        queue: queueData,
        timestamp: new Date().toISOString()
    });

    // Broadcast to monitor namespace (update display screens)
    io.of('/monitor').emit(EVENTS.QUEUE_UPDATED, {
        serviceId: ticketData.service_id,
        queue: queueData,
        timestamp: new Date().toISOString()
    });
}

/**
 * Broadcast ticket called event to all relevant namespaces
 * @param {Object} io - Socket.IO instance
 * @param {Object} ticketData - The ticket information
 * @param {Object} counterData - The counter information
 * @param {Object} agentData - The agent information
 */
function broadcastTicketCalled(io, ticketData, counterData, agentData) {
    // Broadcast to monitor namespace (main display)
    io.of('/monitor').emit(EVENTS.TICKET_CALLED, {
        ticket: ticketData,
        counter: counterData,
        agent: agentData,
        timestamp: new Date().toISOString()
    });

    // Broadcast to customer namespace (counter-specific display)
    io.of('/customer').to(`counter-${counterData.id}`).emit(EVENTS.TICKET_CALLED, {
        ticket: ticketData,
        counter: counterData,
        timestamp: new Date().toISOString()
    });

    // Broadcast to terminal namespace (update other agents)
    io.of('/terminal').to(`service-${ticketData.service_id}`).emit(EVENTS.TICKET_CALLED, {
        ticket: ticketData,
        counter: counterData,
        agent: agentData,
        timestamp: new Date().toISOString()
    });

    // Update counter status
    io.of('/monitor').emit(EVENTS.COUNTER_UPDATED, {
        counter: counterData,
        status: 'serving',
        currentTicket: ticketData,
        timestamp: new Date().toISOString()
    });
}

/**
 * Broadcast ticket completed event to all relevant namespaces
 * @param {Object} io - Socket.IO instance
 * @param {Object} ticketData - The ticket information
 * @param {Object} queueData - Updated queue statistics
 */
function broadcastTicketCompleted(io, ticketData, queueData) {
    // Broadcast to terminal namespace (agents see completed ticket)
    io.of('/terminal').to(`service-${ticketData.service_id}`).emit(EVENTS.TICKET_COMPLETED, {
        ticket: ticketData,
        queue: queueData,
        timestamp: new Date().toISOString()
    });

    // Broadcast to monitor namespace (update displays)
    io.of('/monitor').emit(EVENTS.TICKET_COMPLETED, {
        ticket: ticketData,
        timestamp: new Date().toISOString()
    });

    // Update queue on monitor
    io.of('/monitor').emit(EVENTS.QUEUE_UPDATED, {
        serviceId: ticketData.service_id,
        queue: queueData,
        timestamp: new Date().toISOString()
    });

    // Update counter status (now available)
    if (ticketData.counter_id) {
        io.of('/monitor').emit(EVENTS.COUNTER_UPDATED, {
            counterId: ticketData.counter_id,
            status: 'available',
            currentTicket: null,
            timestamp: new Date().toISOString()
        });
    }
}

/**
 * Broadcast queue update to all relevant namespaces
 * @param {Object} io - Socket.IO instance
 * @param {Number} serviceId - The service ID
 * @param {Object} queueData - Current queue statistics
 */
function broadcastQueueUpdated(io, serviceId, queueData) {
    // Broadcast to monitor namespace
    io.of('/monitor').emit(EVENTS.QUEUE_UPDATED, {
        serviceId: serviceId,
        queue: queueData,
        timestamp: new Date().toISOString()
    });

    // Broadcast to terminal namespace (service-specific room)
    io.of('/terminal').to(`service-${serviceId}`).emit(EVENTS.QUEUE_UPDATED, {
        serviceId: serviceId,
        queue: queueData,
        timestamp: new Date().toISOString()
    });

    // Broadcast to kiosk namespace (for queue length display)
    io.of('/kiosk').emit(EVENTS.QUEUE_UPDATED, {
        serviceId: serviceId,
        queue: queueData,
        timestamp: new Date().toISOString()
    });
}

module.exports = {
    broadcastTicketCreated,
    broadcastTicketCalled,
    broadcastTicketCompleted,
    broadcastQueueUpdated
};