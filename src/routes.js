const express = require('express');
const router = express.Router();
const { getDb } = require('./database/connection');
const { logEvent, EventTypes } = require('./database/events');

router.get('/kiosk/services', (req, res) => {
    res.json({ message: 'GET /api/kiosk/services - Not implemented' });
});

router.post('/kiosk/tickets', (req, res) => {
    const { serviceId, customerName, customerPhone, customerEmail } = req.body;
    
    if (!serviceId) {
        return res.status(400).json({ error: 'serviceId is required' });
    }
    
    const db = getDb();
    
    db.serialize(() => {
        db.run('BEGIN TRANSACTION');
        
        db.get(
            'SELECT * FROM services WHERE id = ? AND is_active = 1',
            [serviceId],
            (err, service) => {
                if (err) {
                    db.run('ROLLBACK');
                    return res.status(500).json({ error: 'Database error' });
                }
                
                if (!service) {
                    db.run('ROLLBACK');
                    return res.status(400).json({ error: 'Invalid or inactive service' });
                }
                
                const nextNumber = service.current_number + 1;
                const ticketNumber = `${service.prefix}${String(nextNumber).padStart(3, '0')}`;
                
                db.run(
                    'UPDATE services SET current_number = ? WHERE id = ?',
                    [nextNumber, serviceId],
                    (err) => {
                        if (err) {
                            db.run('ROLLBACK');
                            return res.status(500).json({ error: 'Failed to update service counter' });
                        }
                        
                        const estimatedWait = nextNumber * service.estimated_service_time;
                        
                        db.run(
                            `INSERT INTO tickets (
                                ticket_number, service_id, state, customer_name, 
                                customer_phone, customer_email, estimated_wait
                            ) VALUES (?, ?, 'waiting', ?, ?, ?, ?)`,
                            [ticketNumber, serviceId, customerName, customerPhone, customerEmail, estimatedWait],
                            function(err) {
                                if (err) {
                                    db.run('ROLLBACK');
                                    return res.status(500).json({ error: 'Failed to create ticket' });
                                }
                                
                                const ticketId = this.lastID;
                                
                                // Log the event
                                logEvent(
                                    EventTypes.TICKET_CREATED,
                                    'ticket',
                                    ticketId,
                                    {
                                        ticketNumber,
                                        serviceId,
                                        serviceName: service.name,
                                        customerName: customerName || 'Anonymous'
                                    }
                                ).catch(err => console.error('Event logging failed:', err));
                                
                                db.run('COMMIT', (err) => {
                                            if (err) {
                                                return res.status(500).json({ error: 'Failed to commit transaction' });
                                            }
                                            
                                            res.status(201).json({
                                                id: ticketId,
                                                ticketNumber,
                                                serviceId,
                                                serviceName: service.name,
                                                state: 'waiting',
                                                estimatedWaitMinutes: Math.ceil(estimatedWait / 60),
                                                createdAt: new Date().toISOString()
                                            });
                                        });
                                    }
                                );
                            }
                        );
                    }
                );
            }
        );
    });
});

router.post('/terminal/call-next', (req, res) => {
    const { counterId, agentId } = req.body;
    
    if (!counterId || !agentId) {
        return res.status(400).json({ error: 'counterId and agentId are required' });
    }
    
    const db = getDb();
    
    db.serialize(() => {
        db.run('BEGIN TRANSACTION');
        
        db.get(
            `SELECT service_id, priority 
             FROM agent_services
             WHERE agent_id = ?
             ORDER BY priority`,
            [agentId],
            (err, agentService) => {
                if (err) {
                    console.error('Error querying agent_services:', err);
                    db.run('ROLLBACK');
                    return res.status(500).json({ error: 'Database error', details: err.message });
                }
                
                if (!agentService) {
                    db.run('ROLLBACK');
                    return res.status(400).json({ error: 'Agent has no assigned services' });
                }
                
                db.get(
                    `SELECT t.*, s.name as service_name, s.prefix 
                     FROM tickets t
                     JOIN services s ON t.service_id = s.id
                     WHERE t.service_id = ? AND t.state = 'waiting'
                     ORDER BY t.created_at
                     LIMIT 1`,
                    [agentService.service_id],
                    (err, ticket) => {
                        if (err) {
                            console.error('Error finding next ticket:', err);
                            db.run('ROLLBACK');
                            return res.status(500).json({ error: 'Failed to find next ticket', details: err.message });
                        }
                        
                        if (!ticket) {
                            db.run('ROLLBACK');
                            return res.status(404).json({ error: 'No tickets waiting in queue' });
                        }
                        
                        const now = new Date().toISOString();
                        
                        db.run(
                            `UPDATE tickets 
                             SET state = 'called', 
                                 called_at = ?,
                                 served_at = ?,
                                 counter_id = ?,
                                 agent_id = ?,
                                 recall_count = recall_count + 1
                             WHERE id = ?`,
                            [now, now, counterId, agentId, ticket.id],
                            (err) => {
                                if (err) {
                                    db.run('ROLLBACK');
                                    return res.status(500).json({ error: 'Failed to update ticket' });
                                }
                                
                                db.run(
                                    `UPDATE counters 
                                     SET current_ticket_id = ?,
                                         current_agent_id = ?,
                                         state = 'serving'
                                     WHERE id = ?`,
                                    [ticket.id, agentId, counterId],
                                    (err) => {
                                        if (err) {
                                            db.run('ROLLBACK');
                                            return res.status(500).json({ error: 'Failed to update counter' });
                                        }
                                        
                                        // Log the event
                                        logEvent(
                                            EventTypes.TICKET_CALLED,
                                            'ticket',
                                            ticket.id,
                                            {
                                                ticketNumber: ticket.ticket_number,
                                                serviceId: ticket.service_id,
                                                counterId,
                                                agentId,
                                                previousState: 'waiting'
                                            },
                                            agentId,
                                            counterId
                                        ).catch(err => console.error('Event logging failed:', err));
                                        
                                        db.run('COMMIT', (err) => {
                                                    if (err) {
                                                        return res.status(500).json({ error: 'Failed to commit transaction' });
                                                    }
                                                    
                                                    res.json({
                                                        id: ticket.id,
                                                        ticketNumber: ticket.ticket_number,
                                                        serviceId: ticket.service_id,
                                                        serviceName: ticket.service_name,
                                                        state: 'called',
                                                        counterId,
                                                        agentId,
                                                        customerName: ticket.customer_name,
                                                        calledAt: now
                                                    });
                                                });
                                            }
                                        );
                                    }
                                );
                            }
                        );
                    }
                );
            }
        );
    });
});

router.post('/terminal/complete', (req, res) => {
    const { ticketId, counterId, agentId, notes } = req.body;
    
    if (!ticketId || !counterId || !agentId) {
        return res.status(400).json({ error: 'ticketId, counterId, and agentId are required' });
    }
    
    const db = getDb();
    
    db.serialize(() => {
        db.run('BEGIN TRANSACTION');
        
        db.get(
            `SELECT * FROM tickets WHERE id = ? AND counter_id = ? AND agent_id = ?`,
            [ticketId, counterId, agentId],
            (err, ticket) => {
                if (err) {
                    db.run('ROLLBACK');
                    return res.status(500).json({ error: 'Database error' });
                }
                
                if (!ticket) {
                    db.run('ROLLBACK');
                    return res.status(404).json({ error: 'Ticket not found or not assigned to this counter/agent' });
                }
                
                if (ticket.state === 'completed') {
                    db.run('ROLLBACK');
                    return res.status(400).json({ error: 'Ticket already completed' });
                }
                
                const now = new Date();
                const completedAt = now.toISOString();
                const servedAt = ticket.served_at || ticket.called_at;
                
                let actualWait = null;
                let serviceDuration = null;
                
                if (ticket.created_at && servedAt) {
                    actualWait = Math.floor((new Date(servedAt) - new Date(ticket.created_at)) / 1000);
                }
                
                if (servedAt) {
                    serviceDuration = Math.floor((now - new Date(servedAt)) / 1000);
                }
                
                db.run(
                    `UPDATE tickets 
                     SET state = 'completed',
                         completed_at = ?,
                         actual_wait = ?,
                         service_duration = ?,
                         notes = ?
                     WHERE id = ?`,
                    [completedAt, actualWait, serviceDuration, notes, ticketId],
                    (err) => {
                        if (err) {
                            db.run('ROLLBACK');
                            return res.status(500).json({ error: 'Failed to update ticket' });
                        }
                        
                        db.run(
                            `UPDATE counters 
                             SET current_ticket_id = NULL,
                                 state = 'available'
                             WHERE id = ?`,
                            [counterId],
                            (err) => {
                                if (err) {
                                    db.run('ROLLBACK');
                                    return res.status(500).json({ error: 'Failed to update counter' });
                                }
                                
                                // Log the event
                                logEvent(
                                    EventTypes.TICKET_COMPLETED,
                                    'ticket',
                                    ticketId,
                                    {
                                        ticketNumber: ticket.ticket_number,
                                        serviceId: ticket.service_id,
                                        serviceDurationSeconds: serviceDuration,
                                        actualWaitSeconds: actualWait
                                    },
                                    agentId,
                                    counterId
                                ).catch(err => console.error('Event logging failed:', err));
                                
                                db.run('COMMIT', (err) => {
                                            if (err) {
                                                return res.status(500).json({ error: 'Failed to commit transaction' });
                                            }
                                            
                                            res.json({
                                                id: ticketId,
                                                ticketNumber: ticket.ticket_number,
                                                state: 'completed',
                                                completedAt,
                                                serviceDurationSeconds: serviceDuration,
                                                actualWaitSeconds: actualWait
                                            });
                                        });
                                    }
                                );
                            }
                        );
                    }
                );
            }
        );
    });
});

router.get('/terminal/queue/:serviceId', (req, res) => {
    res.json({ 
        message: 'GET /api/terminal/queue/:serviceId - Not implemented',
        serviceId: req.params.serviceId 
    });
});

router.post('/terminal/login', (req, res) => {
    res.json({ message: 'POST /api/terminal/login - Not implemented' });
});

router.post('/terminal/recall', (req, res) => {
    res.json({ message: 'POST /api/terminal/recall - Not implemented' });
});

router.post('/terminal/no-show', (req, res) => {
    res.json({ message: 'POST /api/terminal/no-show - Not implemented' });
});

router.get('/monitor/now-serving', (req, res) => {
    res.json({ message: 'GET /api/monitor/now-serving - Not implemented' });
});

router.get('/admin/settings', (req, res) => {
    res.json({ message: 'GET /api/admin/settings - Not implemented' });
});

router.put('/admin/settings', (req, res) => {
    res.json({ message: 'PUT /api/admin/settings - Not implemented' });
});

module.exports = router;