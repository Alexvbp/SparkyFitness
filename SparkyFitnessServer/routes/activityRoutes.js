const express = require('express');
const router = express.Router();
const activityRepository = require('../models/activityRepository');
const { log } = require('../config/logging');

/**
 * GET /api/activities
 * Get activities for current user within date range
 */
router.get('/', async (req, res) => {
    try {
        const userId = req.userId;
        const { startDate, endDate } = req.query;

        if (!startDate || !endDate) {
            return res.status(400).json({ error: 'startDate and endDate query parameters are required' });
        }

        const activities = await activityRepository.getActivitiesByDateRange(userId, startDate, endDate);
        res.json(activities);
    } catch (error) {
        log('error', 'Error fetching activities:', error);
        res.status(500).json({ error: 'Failed to fetch activities' });
    }
});

/**
 * GET /api/activities/:id
 * Get single activity with full details
 */
router.get('/:id', async (req, res) => {
    try {
        const userId = req.userId;
        const activityId = req.params.id;

        const activity = await activityRepository.getActivityById(userId, activityId);

        if (!activity) {
            return res.status(404).json({ error: 'Activity not found' });
        }

        res.json(activity);
    } catch (error) {
        log('error', `Error fetching activity ${req.params.id}:`, error);
        res.status(500).json({ error: 'Failed to fetch activity' });
    }
});

/**
 * DELETE /api/activities
 * Delete activities by source and date range (for re-syncing)
 */
router.delete('/', async (req, res) => {
    try {
        const userId = req.userId;
        const { source, startDate, endDate } = req.query;

        if (!source || !startDate || !endDate) {
            return res.status(400).json({ error: 'source, startDate, and endDate query parameters are required' });
        }

        const result = await activityRepository.deleteActivitiesBySourceAndDateRange(
            userId, source, startDate, endDate
        );

        res.json(result);
    } catch (error) {
        log('error', 'Error deleting activities:', error);
        res.status(500).json({ error: 'Failed to delete activities' });
    }
});

module.exports = router;
