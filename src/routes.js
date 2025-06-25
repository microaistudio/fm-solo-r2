const express = require('express');
const router = express.Router();
const { getDb } = require('./database/connection');
const { logEvent, EventTypes } = require('./database/events');
const { broadcastTicketCreated, broadcastTicketCalled, broadcastTicketCompleted, broadcastQueueUpdated } = require('./realtime/eventBroadcaster');

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
                                    
                                    // Get queue count for the service
                                    db.get('SELECT COUNT(*) as count FROM tickets WHERE service_id = ? AND state = ?', 
                                        [serviceId, 'waiting'], 
                                        (err, result) => {
                                            const queueCount = result ? result.count : 0;
                                            
                                            // Broadcast the event
                                            const io = req.app.get('io');
                                            if (io) {
                                                broadcastTicketCreated(io, {
                                                    id: ticketId,
                                                    ticket_number: ticketNumber,
                                                    service_id: serviceId,
                                                    service_name: service.name,
                                                    state: 'waiting',
                                                    customer_name: customerName || 'Anonymous',
                                                    created_at: new Date().toISOString()
                                                }, {
                                                    serviceId: serviceId,
                                                    waiting: queueCount
                                                });
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
                                        }
                                    );
                                });
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
                                            
                                            // Get counter and agent info (hardcoded for now)
                                            const counterData = { id: counterId, name: `Counter ${counterId}`, number: counterId };
                                            const agentData = { id: agentId, name: 'Agent' };
                                            
                                            // Broadcast the event
                                            const io = req.app.get('io');
                                            if (io) {
                                                broadcastTicketCalled(io, {
                                                    id: ticket.id,
                                                    ticket_number: ticket.ticket_number,
                                                    service_id: ticket.service_id,
                                                    service_name: ticket.service_name,
                                                    state: 'called',
                                                    counter_id: counterId,
                                                    agent_id: agentId,
                                                    customer_name: ticket.customer_name,
                                                    called_at: now
                                                }, counterData, agentData);
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
            });
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
                                    
                                    // Get updated queue count
                                    db.get('SELECT COUNT(*) as count FROM tickets WHERE service_id = ? AND state = ?',
                                        [ticket.service_id, 'waiting'],
                                        (err, result) => {
                                            const queueCount = result ? result.count : 0;
                                            
                                            // Broadcast completion event
                                            const io = req.app.get('io');
                                            if (io) {
                                                broadcastTicketCompleted(io, {
                                                    id: ticketId,
                                                    ticket_number: ticket.ticket_number,
                                                    service_id: ticket.service_id,
                                                    state: 'completed',
                                                    counter_id: counterId,
                                                    agent_id: agentId,
                                                    completed_at: completedAt,
                                                    service_duration: serviceDuration,
                                                    actual_wait: actualWait
                                                }, {
                                                    serviceId: ticket.service_id,
                                                    waiting: queueCount
                                                });
                                            }
                                            
                                            res.json({
                                                id: ticketId,
                                                ticketNumber: ticket.ticket_number,
                                                state: 'completed',
                                                completedAt,
                                                serviceDurationSeconds: serviceDuration,
                                                actualWaitSeconds: actualWait
                                            });
                                        }
                                    );
                                });
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

// GET /api/admin/settings - Get all settings
router.get('/admin/settings', (req, res) => {
  const { category } = req.query; // Optional category filter
  const db = getDb();
  
  let sql = 'SELECT * FROM settings';
  const params = [];
  
  if (category) {
    sql += ' WHERE category = ?';
    params.push(category);
  }
  
  sql += ' ORDER BY category, key';
  
  db.all(sql, params, (err, settings) => {
    if (err) {
      console.error('Settings fetch error:', err);
      return res.status(500).json({ error: 'Failed to fetch settings' });
    }
    
    res.json({ settings });
  });
});

// PUT /api/admin/settings - Update settings
router.put('/admin/settings', (req, res) => {
  const { updates } = req.body; // Array of {key, value} objects
  const db = getDb();
  
  if (!updates || !Array.isArray(updates)) {
    return res.status(400).json({ error: 'Updates array required' });
  }
  
  // Start transaction
  db.run('BEGIN TRANSACTION', (err) => {
    if (err) {
      return res.status(500).json({ error: 'Transaction failed' });
    }
    
    let completedUpdates = 0;
    let hasError = false;
    
    if (updates.length === 0) {
      db.run('COMMIT', (commitErr) => {
        if (commitErr) {
          return res.status(500).json({ error: 'Failed to commit updates' });
        }
        res.json({ message: 'No settings to update', count: 0 });
      });
      return;
    }
    
    updates.forEach((update, index) => {
      if (hasError) return;
      
      const { key, value } = update;
      if (!key || value === undefined) {
        hasError = true;
        db.run('ROLLBACK', () => {
          res.status(400).json({ error: 'Invalid update format' });
        });
        return;
      }
      
      const sql = 'UPDATE settings SET value = ?, updated_at = CURRENT_TIMESTAMP WHERE key = ?';
      db.run(sql, [value, key], function(updateErr) {
        if (updateErr || this.changes === 0) {
          hasError = true;
          db.run('ROLLBACK', () => {
            res.status(400).json({ error: `Failed to update setting: ${key}` });
          });
          return;
        }
        
        completedUpdates++;
        
        // If all updates complete, commit
        if (completedUpdates === updates.length) {
          db.run('COMMIT', (commitErr) => {
            if (commitErr) {
              return res.status(500).json({ error: 'Failed to commit updates' });
            }
            res.json({ message: 'Settings updated successfully', count: updates.length });
          });
        }
      });
    });
  });
});

module.exports = router;
