const garminSyncJobRepository = require('../models/garminSyncJobRepository');
const garminConnectService = require('../integrations/garminconnect/garminConnectService');
const garminService = require('./garminService');
const externalProviderRepository = require('../models/externalProviderRepository');
const { log } = require('../config/logging');
const moment = require('moment');

const CHUNK_SIZE_DAYS = 7; // Use smaller chunks to avoid API timeouts

// Track active job processing to prevent duplicates
const activeProcessing = new Map();

/**
 * Calculate chunks for a date range
 */
function calculateChunks(startDate, endDate, chunkSizeDays = CHUNK_SIZE_DAYS) {
  console.log('[CHUNKS] Starting with:', startDate, 'to', endDate);
  const chunks = [];
  let currentStart = moment(startDate);
  const end = moment(endDate);

  console.log('[CHUNKS] Parsed dates - currentStart:', currentStart.format('YYYY-MM-DD'), 'end:', end.format('YYYY-MM-DD'));

  let iteration = 0;
  const maxIterations = 1000; // Safety limit

  while (currentStart.isSameOrBefore(end)) {
    iteration++;
    if (iteration > maxIterations) {
      console.error('[CHUNKS] ERROR: Exceeded max iterations!');
      break;
    }

    const chunkEnd = moment.min(
      moment(currentStart).add(chunkSizeDays - 1, 'days'),
      end
    );

    console.log('[CHUNKS] Iteration', iteration, '- currentStart:', currentStart.format('YYYY-MM-DD'), 'chunkEnd:', chunkEnd.format('YYYY-MM-DD'));

    chunks.push({
      start: currentStart.format('YYYY-MM-DD'),
      end: chunkEnd.format('YYYY-MM-DD')
    });

    // Clone before mutating to avoid reference issues
    currentStart = moment(chunkEnd).add(1, 'day');
  }

  console.log('[CHUNKS] Done, total chunks:', chunks.length);
  return chunks;
}

/**
 * Start an incremental sync (from last successful sync to today)
 */
async function startIncrementalSync(userId, metricTypes = null) {
  // Check for existing active job
  const activeJob = await garminSyncJobRepository.getActiveJob(userId);
  if (activeJob) {
    return {
      status: 'already_running',
      jobId: activeJob.id,
      message: 'A sync job is already in progress'
    };
  }

  // Get last successful sync date from provider
  const provider = await externalProviderRepository.getGarminProvider(userId);
  if (!provider) {
    throw new Error('Garmin not connected. Please link your Garmin account first.');
  }

  const endDate = moment().format('YYYY-MM-DD');
  let startDate;

  if (provider.last_successful_sync_date) {
    // Start from day after last sync
    startDate = moment(provider.last_successful_sync_date).add(1, 'day').format('YYYY-MM-DD');
  } else {
    // No previous sync, default to last 7 days
    startDate = moment().subtract(7, 'days').format('YYYY-MM-DD');
  }

  // If start is after end, nothing to sync
  if (moment(startDate).isAfter(moment(endDate))) {
    return {
      status: 'up_to_date',
      message: 'Already synced up to today'
    };
  }

  const chunks = calculateChunks(startDate, endDate);

  const job = await garminSyncJobRepository.createJob(userId, {
    start_date: startDate,
    end_date: endDate,
    sync_type: 'incremental',
    metric_types: metricTypes,
    chunks_total: chunks.length,
    skip_existing: false // Incremental sync always fetches latest data
  });

  // Job will be picked up by the sync worker service
  log('info', `Created incremental sync job ${job.id} - will be processed by worker (always refreshes)`);

  return {
    status: 'started',
    jobId: job.id,
    message: `Syncing from ${startDate} to ${endDate}`,
    chunksTotal: chunks.length
  };
}

/**
 * Start a historical sync with custom date range
 */
async function startHistoricalSync(userId, startDate, endDate, metricTypes = null, skipExisting = true) {
  console.log('[HISTORICAL_SYNC] startHistoricalSync called');
  // Validate dates
  if (!startDate || !endDate) {
    throw new Error('startDate and endDate are required');
  }
  console.log('[HISTORICAL_SYNC] Dates validated, skipExisting:', skipExisting);

  const start = moment(startDate);
  const end = moment(endDate);

  if (!start.isValid() || !end.isValid()) {
    throw new Error('Invalid date format. Use YYYY-MM-DD');
  }

  if (start.isAfter(end)) {
    throw new Error('startDate must be before endDate');
  }

  if (end.isAfter(moment())) {
    throw new Error('endDate cannot be in the future');
  }

  // Check for existing active job
  console.log('[HISTORICAL_SYNC] Checking for active job...');
  const activeJob = await garminSyncJobRepository.getActiveJob(userId);
  console.log('[HISTORICAL_SYNC] Active job check done:', activeJob ? 'found' : 'none');
  if (activeJob) {
    return {
      status: 'already_running',
      jobId: activeJob.id,
      message: 'A sync job is already in progress'
    };
  }

  // Verify Garmin is connected
  console.log('[HISTORICAL_SYNC] Checking Garmin provider...');
  const provider = await externalProviderRepository.getGarminProvider(userId);
  console.log('[HISTORICAL_SYNC] Provider check done:', provider ? 'found' : 'none');
  if (!provider) {
    throw new Error('Garmin not connected. Please link your Garmin account first.');
  }

  console.log('[HISTORICAL_SYNC] About to call calculateChunks with:', startDate, 'to', endDate);
  let chunks;
  try {
    chunks = calculateChunks(startDate, endDate);
    console.log('[HISTORICAL_SYNC] calculateChunks returned:', chunks.length, 'chunks');
  } catch (chunkErr) {
    console.error('[HISTORICAL_SYNC] calculateChunks threw error:', chunkErr);
    throw chunkErr;
  }
  const estimatedMinutes = Math.ceil(chunks.length * 0.5); // ~30 seconds per chunk
  console.log('[HISTORICAL_SYNC] Chunks calculated:', chunks.length);

  console.log('[HISTORICAL_SYNC] Creating job...');
  const job = await garminSyncJobRepository.createJob(userId, {
    start_date: startDate,
    end_date: endDate,
    sync_type: 'historical',
    metric_types: metricTypes,
    chunks_total: chunks.length,
    skip_existing: skipExisting
  });

  // Job will be picked up by the sync worker service
  log('info', `Created historical sync job ${job.id} - will be processed by worker (skipExisting: ${skipExisting})`);

  return {
    status: 'started',
    jobId: job.id,
    chunksTotal: chunks.length,
    estimatedMinutes,
    message: `Starting historical sync from ${startDate} to ${endDate}`
  };
}

/**
 * Get current sync status for a user
 */
async function getJobStatus(userId) {
  const activeJob = await garminSyncJobRepository.getActiveJob(userId);
  const provider = await externalProviderRepository.getGarminProvider(userId);

  if (!activeJob) {
    return {
      hasActiveJob: false,
      job: null,
      lastSuccessfulSync: provider?.last_successful_sync_date || null
    };
  }

  const percentComplete = activeJob.chunks_total > 0
    ? Math.round((activeJob.chunks_completed / activeJob.chunks_total) * 100)
    : 0;

  let currentChunkRange = null;
  if (activeJob.current_chunk_start && activeJob.current_chunk_end) {
    const startFormatted = moment(activeJob.current_chunk_start).format('MMM YYYY');
    const endFormatted = moment(activeJob.current_chunk_end).format('MMM YYYY');
    currentChunkRange = startFormatted === endFormatted ? startFormatted : `${startFormatted} - ${endFormatted}`;
  }

  return {
    hasActiveJob: true,
    job: {
      id: activeJob.id,
      status: activeJob.status,
      syncType: activeJob.sync_type,
      startDate: activeJob.start_date,
      endDate: activeJob.end_date,
      chunksCompleted: activeJob.chunks_completed,
      chunksTotal: activeJob.chunks_total,
      percentComplete,
      currentChunkRange,
      errorMessage: activeJob.error_message,
      failedChunks: activeJob.failed_chunks || [],
      createdAt: activeJob.created_at,
      startedAt: activeJob.started_at
    },
    lastSuccessfulSync: provider?.last_successful_sync_date || null
  };
}

/**
 * Resume a paused or failed job
 */
async function resumeJob(userId, jobId) {
  const job = await garminSyncJobRepository.getJobById(userId, jobId);

  if (!job) {
    throw new Error('Job not found');
  }

  if (job.status !== 'paused' && job.status !== 'failed') {
    throw new Error(`Cannot resume job with status: ${job.status}`);
  }

  await garminSyncJobRepository.updateJobStatus(userId, jobId, 'running');

  // Start processing in background
  setImmediate(() => processJob(userId, jobId));

  return {
    status: 'resumed',
    jobId
  };
}

/**
 * Cancel an active job
 */
async function cancelJob(userId, jobId) {
  const job = await garminSyncJobRepository.getJobById(userId, jobId);

  if (!job) {
    throw new Error('Job not found');
  }

  if (job.status !== 'pending' && job.status !== 'running' && job.status !== 'paused') {
    throw new Error(`Cannot cancel job with status: ${job.status}`);
  }

  // Stop processing if active
  activeProcessing.delete(jobId);

  await garminSyncJobRepository.updateJobStatus(userId, jobId, 'cancelled');

  return {
    status: 'cancelled',
    jobId
  };
}

/**
 * Process a sync job (runs in background)
 */
async function processJob(userId, jobId) {
  // Prevent duplicate processing
  if (activeProcessing.has(jobId)) {
    log('info', `Job ${jobId} is already being processed`);
    return;
  }

  activeProcessing.set(jobId, true);

  try {
    const job = await garminSyncJobRepository.getJobById(userId, jobId);
    if (!job) {
      log('error', `Job ${jobId} not found`);
      return;
    }

    if (job.status === 'cancelled' || job.status === 'completed') {
      log('info', `Job ${jobId} is ${job.status}, skipping`);
      return;
    }

    // Mark as running
    await garminSyncJobRepository.updateJobStatus(userId, jobId, 'running');

    // Calculate remaining chunks
    const allChunks = calculateChunks(job.start_date, job.end_date);
    const startFromDate = job.last_successful_date
      ? moment(job.last_successful_date).add(1, 'day')
      : moment(job.start_date);

    const remainingChunks = allChunks.filter(chunk =>
      moment(chunk.start).isSameOrAfter(startFromDate)
    );

    log('info', `Processing job ${jobId}: ${remainingChunks.length} chunks remaining`);

    for (let i = 0; i < remainingChunks.length; i++) {
      // Check if cancelled
      if (!activeProcessing.has(jobId)) {
        log('info', `Job ${jobId} was cancelled, stopping`);
        return;
      }

      const chunk = remainingChunks[i];

      try {
        // Update current chunk
        await garminSyncJobRepository.updateJobProgress(userId, jobId, {
          current_chunk_start: chunk.start,
          current_chunk_end: chunk.end,
          chunks_completed: job.chunks_completed + i,
          last_successful_date: job.last_successful_date
        });

        // Sync this chunk
        log('info', `Job ${jobId}: Processing chunk ${chunk.start} to ${chunk.end}`);

        // Fetch health and wellness data
        const healthData = await garminConnectService.syncGarminHealthAndWellness(
          userId,
          chunk.start,
          chunk.end,
          job.metric_types
        );

        // Process the data
        if (healthData && healthData.data) {
          await garminService.processGarminHealthAndWellnessData(
            userId,
            userId,
            healthData.data,
            chunk.start,
            chunk.end
          );

          // Process sleep data if present
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

        // Fetch activities
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

        // Update progress
        await garminSyncJobRepository.updateJobProgress(userId, jobId, {
          current_chunk_start: chunk.start,
          current_chunk_end: chunk.end,
          chunks_completed: job.chunks_completed + i + 1,
          last_successful_date: chunk.end
        });

        log('info', `Job ${jobId}: Completed chunk ${chunk.start} to ${chunk.end}`);

      } catch (chunkError) {
        log('error', `Job ${jobId}: Error processing chunk ${chunk.start} to ${chunk.end}:`, chunkError);

        // Record failed chunk but continue
        await garminSyncJobRepository.addFailedChunk(userId, jobId, {
          start: chunk.start,
          end: chunk.end,
          error: chunkError.message
        });
      }

      // Yield to event loop between chunks
      await new Promise(resolve => setImmediate(resolve));
    }

    // All chunks processed
    await garminSyncJobRepository.updateJobStatus(userId, jobId, 'completed');

    // Update provider's last successful sync date
    await externalProviderRepository.updateLastSyncDate(userId, 'garmin', job.end_date);

    log('info', `Job ${jobId} completed successfully`);

  } catch (error) {
    log('error', `Job ${jobId} failed:`, error);
    await garminSyncJobRepository.updateJobStatus(userId, jobId, 'failed', {
      error_message: error.message
    });
  } finally {
    activeProcessing.delete(jobId);
  }
}

module.exports = {
  calculateChunks,
  startIncrementalSync,
  startHistoricalSync,
  getJobStatus,
  resumeJob,
  cancelJob,
  processJob
};
