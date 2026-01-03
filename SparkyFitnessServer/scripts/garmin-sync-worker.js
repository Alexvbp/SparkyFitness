#!/usr/bin/env node

/**
 * Garmin Sync Worker
 *
 * A lightweight background worker that polls for pending sync jobs and processes them.
 * Runs separately from the main web server to avoid memory issues.
 *
 * Usage:
 *   node scripts/garmin-sync-worker.js
 *
 * Or with Docker:
 *   docker exec -d docker-sparkyfitness-server-1 node /app/SparkyFitnessServer/scripts/garmin-sync-worker.js
 */

// Load .env file if it exists (for local development)
// In Docker, environment variables are provided by docker-compose
const path = require('path');
const fs = require('fs');
const envPath = path.resolve(__dirname, '../../.env');
if (fs.existsSync(envPath)) {
  require('dotenv').config({ path: envPath });
}

const moment = require('moment');
const { getClient, getSystemClient } = require('../db/poolManager');
const garminConnectService = require('../integrations/garminconnect/garminConnectService');
const garminService = require('../services/garminService');
const { log } = require('../config/logging');

const POLL_INTERVAL_MS = 5000; // Check for jobs every 5 seconds
const CHUNK_SIZE_DAYS = 7; // Use smaller chunks to avoid API timeouts

let isShuttingDown = false;

// Calculate chunks for a date range
function calculateChunks(startDate, endDate, chunkSizeDays = CHUNK_SIZE_DAYS) {
  console.log('[WORKER-CHUNKS] Starting with:', startDate, 'to', endDate);
  const chunks = [];
  let currentStart = moment(startDate);
  const end = moment(endDate);

  console.log('[WORKER-CHUNKS] Parsed - currentStart:', currentStart.format('YYYY-MM-DD'), 'end:', end.format('YYYY-MM-DD'));

  let iteration = 0;
  const maxIterations = 1000; // Safety limit

  while (currentStart.isSameOrBefore(end)) {
    iteration++;
    if (iteration > maxIterations) {
      console.error('[WORKER-CHUNKS] ERROR: Exceeded max iterations!');
      break;
    }

    const chunkEnd = moment.min(
      moment(currentStart).add(chunkSizeDays - 1, 'days'),
      end
    );
    chunks.push({
      start: currentStart.format('YYYY-MM-DD'),
      end: chunkEnd.format('YYYY-MM-DD')
    });
    // Clone before mutating to avoid reference issues
    currentStart = moment(chunkEnd).add(1, 'day');
  }

  console.log('[WORKER-CHUNKS] Done, total chunks:', chunks.length);
  return chunks;
}

// Get pending or running jobs
async function getPendingJob() {
  const client = await getSystemClient();
  try {
    const result = await client.query(`
      SELECT * FROM public.garmin_sync_jobs
      WHERE status IN ('pending', 'running')
      ORDER BY created_at ASC
      LIMIT 1
    `);
    return result.rows[0] || null;
  } finally {
    client.release();
  }
}

// Update job status
async function updateJobStatus(jobId, status, additionalFields = {}) {
  const client = await getSystemClient();
  try {
    const updates = ['status = $2', 'updated_at = NOW()'];
    const values = [jobId, status];
    let paramIndex = 3;

    if (status === 'running') {
      updates.push('started_at = COALESCE(started_at, NOW())');
    }

    if (status === 'completed' || status === 'failed') {
      updates.push('completed_at = NOW()');
    }

    for (const [key, value] of Object.entries(additionalFields)) {
      updates.push(`${key} = $${paramIndex}`);
      values.push(value);
      paramIndex++;
    }

    await client.query(
      `UPDATE public.garmin_sync_jobs SET ${updates.join(', ')} WHERE id = $1`,
      values
    );
  } finally {
    client.release();
  }
}

// Update job progress
async function updateJobProgress(jobId, progressData) {
  const client = await getSystemClient();
  try {
    const { current_chunk_start, current_chunk_end, chunks_completed, last_successful_date } = progressData;
    await client.query(`
      UPDATE public.garmin_sync_jobs SET
        current_chunk_start = $2,
        current_chunk_end = $3,
        chunks_completed = $4,
        last_successful_date = $5,
        updated_at = NOW()
      WHERE id = $1
    `, [jobId, current_chunk_start, current_chunk_end, chunks_completed, last_successful_date]);
  } finally {
    client.release();
  }
}

// Add failed chunk
async function addFailedChunk(jobId, chunkData) {
  const client = await getSystemClient();
  try {
    await client.query(`
      UPDATE public.garmin_sync_jobs SET
        failed_chunks = failed_chunks || $2::jsonb,
        updated_at = NOW()
      WHERE id = $1
    `, [jobId, JSON.stringify([chunkData])]);
  } finally {
    client.release();
  }
}

// Update last sync date in external_data_providers (only if new date is later)
async function updateLastSyncDate(userId, syncDate) {
  const client = await getSystemClient();
  try {
    await client.query(`
      UPDATE external_data_providers
      SET last_successful_sync_date = $2, updated_at = NOW()
      WHERE user_id = $1 AND provider_type = 'garmin'
        AND (last_successful_sync_date IS NULL OR last_successful_sync_date < $2)
    `, [userId, syncDate]);
  } finally {
    client.release();
  }
}

// Check if Garmin data exists for a date range
async function hasGarminDataForDateRange(userId, startDate, endDate) {
  const client = await getSystemClient();
  try {
    // Check multiple tables for Garmin-sourced data
    const result = await client.query(`
      SELECT EXISTS (
        SELECT 1 FROM exercise_entries
        WHERE user_id = $1 AND source = 'garmin'
        AND entry_date >= $2 AND entry_date <= $3
        LIMIT 1
      ) OR EXISTS (
        SELECT 1 FROM sleep_entries
        WHERE user_id = $1 AND source = 'garmin'
        AND entry_date >= $2 AND entry_date <= $3
        LIMIT 1
      ) OR EXISTS (
        SELECT 1 FROM exercise_preset_entries
        WHERE user_id = $1 AND source = 'garmin'
        AND entry_date >= $2 AND entry_date <= $3
        LIMIT 1
      ) AS has_data
    `, [userId, startDate, endDate]);
    return result.rows[0]?.has_data || false;
  } finally {
    client.release();
  }
}

// Process a single job
async function processJob(job) {
  const jobId = job.id;
  const userId = job.user_id;
  const skipExisting = job.skip_existing !== false; // Default to true

  console.log(`[WORKER] Processing job ${jobId} for user ${userId}`);
  console.log(`[WORKER] Date range: ${job.start_date} to ${job.end_date}`);
  console.log(`[WORKER] Skip existing data: ${skipExisting}`);

  try {
    console.log('[WORKER] Updating job status to running...');
    await updateJobStatus(jobId, 'running');
    console.log('[WORKER] Job status updated, calculating chunks...');

    // Calculate chunks
    const allChunks = calculateChunks(job.start_date, job.end_date);
    console.log('[WORKER] Chunks calculated:', allChunks.length);
    const startFromDate = job.last_successful_date
      ? moment(job.last_successful_date).add(1, 'day')
      : moment(job.start_date);

    const remainingChunks = allChunks.filter(chunk =>
      moment(chunk.start).isSameOrAfter(startFromDate)
    );

    console.log(`[WORKER] Total chunks: ${allChunks.length}, Remaining: ${remainingChunks.length}`);

    for (let i = 0; i < remainingChunks.length; i++) {
      if (isShuttingDown) {
        console.log('[WORKER] Shutdown requested, pausing job');
        await updateJobStatus(jobId, 'paused');
        return;
      }

      const chunk = remainingChunks[i];
      const chunkNum = job.chunks_completed + i + 1;

      console.log(`[WORKER] Chunk ${chunkNum}/${allChunks.length}: ${chunk.start} to ${chunk.end}`);

      try {
        // Check if we should skip this chunk (existing data)
        if (skipExisting) {
          const hasData = await hasGarminDataForDateRange(userId, chunk.start, chunk.end);
          if (hasData) {
            console.log(`[WORKER] ⏭ Chunk ${chunkNum} skipped (data exists)`);
            // Update progress to mark chunk as complete
            await updateJobProgress(jobId, {
              current_chunk_start: chunk.start,
              current_chunk_end: chunk.end,
              chunks_completed: job.chunks_completed + i + 1,
              last_successful_date: chunk.end
            });
            continue;
          }
        }

        // Update progress before processing
        await updateJobProgress(jobId, {
          current_chunk_start: chunk.start,
          current_chunk_end: chunk.end,
          chunks_completed: job.chunks_completed + i,
          last_successful_date: job.last_successful_date
        });

        // Fetch and process health data
        const healthData = await garminConnectService.syncGarminHealthAndWellness(
          userId,
          chunk.start,
          chunk.end,
          job.metric_types
        );

        if (healthData && healthData.data) {
          await garminService.processGarminHealthAndWellnessData(
            userId,
            userId,
            healthData.data,
            chunk.start,
            chunk.end
          );

          if (healthData.data.sleep && healthData.data.sleep.length > 0) {
            await garminService.processGarminSleepData(
              userId,
              userId,
              healthData.data.sleep,
              chunk.start,
              chunk.end
            );
          }
        }

        // Fetch and process activities
        const activityData = await garminConnectService.fetchGarminActivitiesAndWorkouts(
          userId,
          chunk.start,
          chunk.end,
          null
        );

        if (activityData) {
          await garminService.processActivitiesAndWorkouts(
            userId,
            activityData,
            chunk.start,
            chunk.end
          );
        }

        // Update progress after success
        await updateJobProgress(jobId, {
          current_chunk_start: chunk.start,
          current_chunk_end: chunk.end,
          chunks_completed: job.chunks_completed + i + 1,
          last_successful_date: chunk.end
        });

        console.log(`[WORKER] ✓ Chunk ${chunkNum} complete`);

      } catch (chunkError) {
        console.error(`[WORKER] ✗ Chunk error: ${chunkError.message}`);
        await addFailedChunk(jobId, {
          start: chunk.start,
          end: chunk.end,
          error: chunkError.message
        });
      }

      // Small delay between chunks
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    // Job complete
    await updateJobStatus(jobId, 'completed');
    await updateLastSyncDate(userId, job.end_date);
    console.log(`[WORKER] ✓ Job ${jobId} completed successfully`);

  } catch (error) {
    console.error(`[WORKER] ✗ Job failed: ${error.message}`);
    await updateJobStatus(jobId, 'failed', { error_message: error.message });
  }
}

// Main worker loop
async function runWorker() {
  console.log('[WORKER] Garmin Sync Worker starting...');
  console.log('[WORKER] Polling interval:', POLL_INTERVAL_MS, 'ms');

  while (!isShuttingDown) {
    try {
      const job = await getPendingJob();

      if (job) {
        await processJob(job);
      }
    } catch (error) {
      console.error('[WORKER] Error in worker loop:', error.message);
    }

    // Wait before next poll
    await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
  }

  console.log('[WORKER] Worker shutting down');
  process.exit(0);
}

// Handle shutdown signals
process.on('SIGINT', () => {
  console.log('\n[WORKER] Received SIGINT, shutting down gracefully...');
  isShuttingDown = true;
});

process.on('SIGTERM', () => {
  console.log('[WORKER] Received SIGTERM, shutting down gracefully...');
  isShuttingDown = true;
});

// Start the worker
runWorker().catch(error => {
  console.error('[WORKER] Fatal error:', error);
  process.exit(1);
});
