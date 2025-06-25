const express = require('express');
const router = express.Router();

router.get('/kiosk/services', (req, res) => {
    res.json({ message: 'GET /api/kiosk/services - Not implemented' });
});

router.post('/kiosk/tickets', (req, res) => {
    res.json({ message: 'POST /api/kiosk/tickets - Not implemented' });
});

router.post('/terminal/call-next', (req, res) => {
    res.json({ message: 'POST /api/terminal/call-next - Not implemented' });
});

router.post('/terminal/complete', (req, res) => {
    res.json({ message: 'POST /api/terminal/complete - Not implemented' });
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