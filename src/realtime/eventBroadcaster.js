const { EVENTS } = require('./eventTypes');

/**
 * Broadcast ticket created event to all relevant namespaces
 * @param {Object} io - Socket.IO instance
 * @param {Object} ticketData - The ticket information
 * @param {Object} queueData - Current queue statistics
 */
function broadcastTicketCreated(io, ticketData, queueData) {
    const eventData = {
        ticket: ticketData,
        queue: queueData,
        timestamp: new Date().toISOString()
    };

    // Broadcast to kiosk namespace - all-updates room for confirmation
    io.of('/kiosk').to('all-updates').emit(EVENTS.TICKET_CREATED, eventData);
    io.of('/kiosk').to(`service-${ticketData.service_id}`).emit(EVENTS.TICKET_CREATED, eventData);

    // Broadcast to terminal namespace - both all-updates and service-specific rooms
    io.of('/terminal').to('all-updates').emit(EVENTS.TICKET_CREATED, eventData);
    io.of('/terminal').to(`service-${ticketData.service_id}`).emit(EVENTS.TICKET_CREATED, eventData);

    // Broadcast to monitor namespace - both all-updates and service-specific rooms
    io.of('/monitor').to('all-updates').emit(EVENTS.QUEUE_UPDATED, {
        serviceId: ticketData.service_id,
        queue: queueData,
        timestamp: new Date().toISOString()
    });
    io.of('/monitor').to(`service-${ticketData.service_id}`).emit(EVENTS.QUEUE_UPDATED, {
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
    const ticketCalledData = {
        ticket: ticketData,
        counter: counterData,
        agent: agentData,
        timestamp: new Date().toISOString()
    };

    // Broadcast to monitor namespace - all rooms
    io.of('/monitor').to('all-updates').emit(EVENTS.TICKET_CALLED, ticketCalledData);
    io.of('/monitor').to(`service-${ticketData.service_id}`).emit(EVENTS.TICKET_CALLED, ticketCalledData);
    io.of('/monitor').to(`counter-${counterData.id}`).emit(EVENTS.TICKET_CALLED, ticketCalledData);

    // Broadcast to customer namespace - counter-specific room
    io.of('/customer').to(`counter-${counterData.id}`).emit(EVENTS.TICKET_CALLED, {
        ticket: ticketData,
        counter: counterData,
        timestamp: new Date().toISOString()
    });

    // Broadcast to terminal namespace - all rooms
    io.of('/terminal').to('all-updates').emit(EVENTS.TICKET_CALLED, ticketCalledData);
    io.of('/terminal').to(`service-${ticketData.service_id}`).emit(EVENTS.TICKET_CALLED, ticketCalledData);
    io.of('/terminal').to(`counter-${counterData.id}`).emit(EVENTS.TICKET_CALLED, ticketCalledData);

    // Update counter status
    const counterUpdateData = {
        counter: counterData,
        status: 'serving',
        currentTicket: ticketData,
        timestamp: new Date().toISOString()
    };
    io.of('/monitor').to('all-updates').emit(EVENTS.COUNTER_UPDATED, counterUpdateData);
    io.of('/monitor').to(`counter-${counterData.id}`).emit(EVENTS.COUNTER_UPDATED, counterUpdateData);
}

/**
 * Broadcast ticket completed event to all relevant namespaces
 * @param {Object} io - Socket.IO instance
 * @param {Object} ticketData - The ticket information
 * @param {Object} queueData - Updated queue statistics
 */
function broadcastTicketCompleted(io, ticketData, queueData) {
    const completedData = {
        ticket: ticketData,
        queue: queueData,
        timestamp: new Date().toISOString()
    };

    // Broadcast to terminal namespace - both all-updates and service-specific rooms
    io.of('/terminal').to('all-updates').emit(EVENTS.TICKET_COMPLETED, completedData);
    io.of('/terminal').to(`service-${ticketData.service_id}`).emit(EVENTS.TICKET_COMPLETED, completedData);

    // Broadcast to monitor namespace - both all-updates and service-specific rooms
    io.of('/monitor').to('all-updates').emit(EVENTS.TICKET_COMPLETED, {
        ticket: ticketData,
        timestamp: new Date().toISOString()
    });
    io.of('/monitor').to(`service-${ticketData.service_id}`).emit(EVENTS.TICKET_COMPLETED, {
        ticket: ticketData,
        timestamp: new Date().toISOString()
    });

    // Update queue on monitor
    const queueUpdateData = {
        serviceId: ticketData.service_id,
        queue: queueData,
        timestamp: new Date().toISOString()
    };
    io.of('/monitor').to('all-updates').emit(EVENTS.QUEUE_UPDATED, queueUpdateData);
    io.of('/monitor').to(`service-${ticketData.service_id}`).emit(EVENTS.QUEUE_UPDATED, queueUpdateData);

    // Update counter status (now available)
    if (ticketData.counter_id) {
        const counterUpdateData = {
            counterId: ticketData.counter_id,
            status: 'available',
            currentTicket: null,
            timestamp: new Date().toISOString()
        };
        io.of('/monitor').to('all-updates').emit(EVENTS.COUNTER_UPDATED, counterUpdateData);
        io.of('/monitor').to(`counter-${ticketData.counter_id}`).emit(EVENTS.COUNTER_UPDATED, counterUpdateData);
    }
}

/**
 * Broadcast queue update to all relevant namespaces
 * @param {Object} io - Socket.IO instance
 * @param {Number} serviceId - The service ID
 * @param {Object} queueData - Current queue statistics
 */
function broadcastQueueUpdated(io, serviceId, queueData) {
    const queueUpdateData = {
        serviceId: serviceId,
        queue: queueData,
        timestamp: new Date().toISOString()
    };

    // Broadcast to monitor namespace - service-specific room only
    io.of('/monitor').to(`service-${serviceId}`).emit(EVENTS.QUEUE_UPDATED, queueUpdateData);

    // Broadcast to terminal namespace - service-specific room only
    io.of('/terminal').to(`service-${serviceId}`).emit(EVENTS.QUEUE_UPDATED, queueUpdateData);

    // Broadcast to kiosk namespace - service-specific room only
    io.of('/kiosk').to(`service-${serviceId}`).emit(EVENTS.QUEUE_UPDATED, queueUpdateData);
}

module.exports = {
    broadcastTicketCreated,
    broadcastTicketCalled,
    broadcastTicketCompleted,
    broadcastQueueUpdated
};