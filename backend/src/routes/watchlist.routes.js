const express = require('express');
const router = express.Router();
const controller = require('../controllers/watchlist.controller');

router.get('/us', controller.getAll);
router.post('/us', controller.create);
router.delete('/us/:symbol', controller.remove);

module.exports = router;