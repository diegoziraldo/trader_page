const express = require('express');
const router = express.Router();
const controller = require('../controllers/checklist.controller');

router.get('/', controller.getAll);
router.post('/', controller.create);
router.put('/:id', controller.update);
router.delete('/:id', controller.remove);

router.post('/:tickerId/indicators', controller.addIndicator);
router.put('/indicators/:id', controller.updateIndicator);
router.delete('/indicators/:id', controller.removeIndicator);

module.exports = router;