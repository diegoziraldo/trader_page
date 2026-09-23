const express = require('express');
const router = express.Router();
const controller = require('../controllers/portfolios.controller');

router.get('/', controller.getAllPortfolios);
router.post('/', controller.createPortfolio);
router.put('/:id', controller.updatePortfolio);
router.delete('/:id', controller.removePortfolio);

router.get('/:id/positions', controller.getPositions);
router.post('/:id/positions', controller.createPosition);
router.put('/positions/:positionId', controller.updatePosition);
router.delete('/positions/:positionId', controller.removePosition);

module.exports = router;
