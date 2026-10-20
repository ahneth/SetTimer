/* ==========================================================================
   SetTimer - Interval Timer Engine & Sound Module (timer.js)
   Builds the timeline of steps from a Routine configuration and drives the
   countdown, state transitions, audio cues, volume control, Pause and Resume.
   ========================================================================== */

(function (global) {
  'use strict';

  const PHASE_ACTIVITY = 'ACTIVITY';         // Bright Green screen
  const PHASE_SET_REST = 'SET_REST';         // Bright Orange screen
  const PHASE_BETWEEN = 'BETWEEN_ACTIVITY';  // Yellow screen with Up Next
  const PHASE_END = 'END';                   // Bright Red screen with END

  let audioCtx = null;
  let soundMuted = false;
  let soundVolume = 80; // 0 to 100 percentage

  function ensureAudioContext() {
    if (soundMuted || soundVolume <= 0) return null;
    try {
      const AudioContextClass = global.AudioContext || global.webkitAudioContext;
      if (!AudioContextClass) return null;
      if (!audioCtx) {
        audioCtx = new AudioContextClass();
      }
      if (audioCtx.state === 'suspended') {
        audioCtx.resume();
      }
      return audioCtx;
    } catch (e) {
      return null;
    }
  }

  function playTone(freq, durationMs, type, gainVal) {
    if (soundMuted || soundVolume <= 0) return;
    const ctx = ensureAudioContext();
    if (!ctx) return;
    try {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type || 'sine';
      osc.frequency.setValueAtTime(freq, ctx.currentTime);

      const baseGain = gainVal || 0.18;
      // Scale gain by volume slider (0-100%), with 100% allowing up to 1.5x standard gain
      const scaledGain = Math.max(0.002, Math.min(0.6, baseGain * (soundVolume / 80)));

      gain.gain.setValueAtTime(scaledGain, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0008, ctx.currentTime + durationMs / 1000);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + durationMs / 1000);
    } catch (e) {
      // Ignore audio errors if blocked
    }
  }

  function playCountdownTick() {
    playTone(660, 110, 'sine', 0.14);
  }

  function playVolumePreviewTone() {
    playTone(740, 90, 'sine', 0.16);
  }

  function playPhaseTransition(phase) {
    if (phase === PHASE_ACTIVITY) {
      playTone(880, 260, 'triangle', 0.22);
    } else if (phase === PHASE_SET_REST || phase === PHASE_BETWEEN) {
      playTone(520, 240, 'sine', 0.2);
    } else if (phase === PHASE_END) {
      playTone(587.33, 180, 'triangle', 0.22);
      setTimeout(function () { playTone(880, 420, 'triangle', 0.25); }, 190);
    }
  }

  function buildTimeline(routine) {
    const steps = [];
    if (!routine || !Array.isArray(routine.activities)) {
      return steps;
    }

    const validActivities = routine.activities.filter(function (a) {
      return a && (parseInt(a.sets, 10) || 0) > 0 && (parseInt(a.timePerSet, 10) || 0) > 0;
    });

    const totalActivities = validActivities.length;

    validActivities.forEach(function (act, actIdx) {
      const actName = String(act.name || '').trim() || ('Exercise #' + (actIdx + 1));
      const sets = Math.max(1, parseInt(act.sets, 10) || 1);
      const timePerSet = Math.max(1, parseInt(act.timePerSet, 10) || 30);
      const restBetweenSets = Math.max(0, parseInt(act.restBetweenSets !== undefined ? act.restBetweenSets : 15, 10));
      const betweenRest = act.restAfterActivity !== undefined && act.restAfterActivity !== null
        ? Math.max(0, parseInt(act.restAfterActivity, 10))
        : Math.max(0, parseInt(routine.betweenActivityRest !== undefined ? routine.betweenActivityRest : 20, 10));

      const nextActivity = (actIdx + 1 < totalActivities) ? validActivities[actIdx + 1] : null;
      const nextActivityName = nextActivity ? (String(nextActivity.name || '').trim() || ('Exercise #' + (actIdx + 2))) : null;

      for (let s = 1; s <= sets; s++) {
        let nextLabelAfterSet = 'Routine Complete';
        if (s < sets) {
          nextLabelAfterSet = restBetweenSets > 0
            ? ('Rest (' + restBetweenSets + 's) → ' + actName + ' (Set ' + (s + 1) + '/' + sets + ')')
            : (actName + ' (Set ' + (s + 1) + '/' + sets + ')');
        } else if (nextActivityName) {
          nextLabelAfterSet = betweenRest > 0
            ? ('Between Activities Rest (' + betweenRest + 's) → ' + nextActivityName)
            : nextActivityName;
        }

        steps.push({
          phase: PHASE_ACTIVITY,
          duration: timePerSet,
          activityIndex: actIdx + 1,
          totalActivities: totalActivities,
          activityName: actName,
          currentSet: s,
          totalSets: sets,
          upNextName: nextActivityName,
          upNextHint: nextLabelAfterSet
        });

        if (s < sets && restBetweenSets > 0) {
          steps.push({
            phase: PHASE_SET_REST,
            duration: restBetweenSets,
            activityIndex: actIdx + 1,
            totalActivities: totalActivities,
            activityName: actName,
            currentSet: s,
            nextSet: s + 1,
            totalSets: sets,
            upNextName: actName + ' — Set ' + (s + 1) + ' of ' + sets,
            upNextHint: actName + ' (Set ' + (s + 1) + ' of ' + sets + ' • ' + timePerSet + 's)'
          });
        }
      }

      if (nextActivity && betweenRest > 0) {
        const nextSets = Math.max(1, parseInt(nextActivity.sets, 10) || 1);
        const nextTime = Math.max(1, parseInt(nextActivity.timePerSet, 10) || 30);
        steps.push({
          phase: PHASE_BETWEEN,
          duration: betweenRest,
          activityIndex: actIdx + 1,
          totalActivities: totalActivities,
          activityName: 'Rest Between Activities',
          completedActivityName: actName,
          currentSet: sets,
          totalSets: sets,
          upNextName: nextActivityName,
          upNextDetails: nextSets + (nextSets === 1 ? ' Set' : ' Sets') + ' × ' + nextTime + 's',
          upNextHint: nextActivityName + ' (' + nextSets + ' × ' + nextTime + 's)'
        });
      }
    });

    return steps;
  }

  function calculateRoutineSummary(routine) {
    const steps = buildTimeline(routine);
    const totalSeconds = steps.reduce(function (acc, st) { return acc + (st.duration || 0); }, 0);
    const totalSets = (routine && Array.isArray(routine.activities))
      ? routine.activities.reduce(function (acc, a) { return acc + (Math.max(1, parseInt(a.sets, 10) || 1)); }, 0)
      : 0;
    return {
      totalSteps: steps.length,
      totalSeconds: totalSeconds,
      totalSets: totalSets,
      activityCount: (routine && Array.isArray(routine.activities)) ? routine.activities.length : 0
    };
  }

  function formatSeconds(sec) {
    const safeSec = Math.max(0, Math.ceil(sec));
    const mins = Math.floor(safeSec / 60);
    const rem = safeSec % 60;
    return String(mins).padStart(2, '0') + ':' + String(rem).padStart(2, '0');
  }

  function createTimerController(callbacks) {
    let steps = [];
    let currentStepIndex = 0;
    let remainingMs = 0;
    let stepDurationMs = 0;
    let isRunning = false;
    let isPaused = false;
    let isFinished = false;
    let intervalId = null;
    let lastTickTimestamp = null;
    let lastWholeSecondAnnounced = null;

    function stopInterval() {
      if (intervalId !== null) {
        clearInterval(intervalId);
        intervalId = null;
      }
      lastTickTimestamp = null;
    }

    function getStateSnapshot() {
      if (isFinished) {
        return {
          phase: PHASE_END,
          isRunning: false,
          isPaused: false,
          isFinished: true,
          stepIndex: steps.length,
          totalSteps: steps.length,
          remainingSeconds: 0,
          remainingFormatted: '00:00',
          progressPercent: 100,
          step: null
        };
      }

      const currentStep = steps[currentStepIndex] || null;
      const remSec = Math.max(0, Math.ceil(remainingMs / 1000));
      const progress = stepDurationMs > 0
        ? Math.min(100, Math.max(0, ((stepDurationMs - remainingMs) / stepDurationMs) * 100))
        : 0;

      return {
        phase: currentStep ? currentStep.phase : PHASE_END,
        isRunning: isRunning,
        isPaused: isPaused,
        isFinished: isFinished,
        stepIndex: currentStepIndex,
        totalSteps: steps.length,
        remainingMs: remainingMs,
        remainingSeconds: remSec,
        remainingFormatted: formatSeconds(remSec),
        progressPercent: progress,
        step: currentStep
      };
    }

    function notifyUpdate() {
      if (callbacks && typeof callbacks.onTick === 'function') {
        callbacks.onTick(getStateSnapshot());
      }
    }

    function loadStep(index) {
      if (index >= steps.length) {
        stopInterval();
        isRunning = false;
        isPaused = false;
        isFinished = true;
        playPhaseTransition(PHASE_END);
        if (callbacks && typeof callbacks.onPhaseChange === 'function') {
          callbacks.onPhaseChange(getStateSnapshot());
        }
        notifyUpdate();
        return;
      }

      currentStepIndex = Math.max(0, index);
      const step = steps[currentStepIndex];
      stepDurationMs = (step.duration || 1) * 1000;
      remainingMs = stepDurationMs;
      lastWholeSecondAnnounced = Math.ceil(remainingMs / 1000);
      isFinished = false;

      playPhaseTransition(step.phase);
      if (callbacks && typeof callbacks.onPhaseChange === 'function') {
        callbacks.onPhaseChange(getStateSnapshot());
      }
      notifyUpdate();
    }

    function tick() {
      if (!isRunning || isPaused || isFinished) return;
      const now = performance.now();
      const delta = lastTickTimestamp ? (now - lastTickTimestamp) : 100;
      lastTickTimestamp = now;

      remainingMs = Math.max(0, remainingMs - delta);
      const wholeSec = Math.ceil(remainingMs / 1000);

      if (wholeSec !== lastWholeSecondAnnounced) {
        lastWholeSecondAnnounced = wholeSec;
        if (wholeSec >= 1 && wholeSec <= 3) {
          playCountdownTick();
        }
      }

      if (remainingMs <= 0) {
        loadStep(currentStepIndex + 1);
      } else {
        notifyUpdate();
      }
    }

    function start(routine) {
      stopInterval();
      ensureAudioContext();
      steps = buildTimeline(routine);
      if (steps.length === 0) {
        return false;
      }
      isRunning = true;
      isPaused = false;
      isFinished = false;
      loadStep(0);
      lastTickTimestamp = performance.now();
      intervalId = setInterval(tick, 80);
      return true;
    }

    function pause() {
      if (!isRunning || isPaused || isFinished) return;
      if (lastTickTimestamp) {
        const elapsed = performance.now() - lastTickTimestamp;
        remainingMs = Math.max(0, remainingMs - elapsed);
      }
      isPaused = true;
      stopInterval();
      notifyUpdate();
    }

    function resume() {
      if (!isRunning || !isPaused || isFinished) return;
      ensureAudioContext();
      isPaused = false;
      lastTickTimestamp = performance.now();
      intervalId = setInterval(tick, 80);
      notifyUpdate();
    }

    function togglePause() {
      if (isPaused) {
        resume();
      } else {
        pause();
      }
      return isPaused;
    }

    function skipNext() {
      if (steps.length === 0 || isFinished) return;
      loadStep(currentStepIndex + 1);
      if (isRunning && !isPaused && !isFinished) {
        lastTickTimestamp = performance.now();
      }
    }

    function skipPrev() {
      if (steps.length === 0) return;
      if (isFinished) {
        isFinished = false;
        isRunning = true;
        isPaused = false;
        loadStep(steps.length - 1);
        lastTickTimestamp = performance.now();
        intervalId = setInterval(tick, 80);
        return;
      }
      if (stepDurationMs - remainingMs > 2000 || currentStepIndex === 0) {
        loadStep(currentStepIndex);
      } else {
        loadStep(currentStepIndex - 1);
      }
      if (isRunning && !isPaused) {
        lastTickTimestamp = performance.now();
      }
    }

    function stop() {
      stopInterval();
      isRunning = false;
      isPaused = false;
      isFinished = false;
    }

    return {
      start: start,
      pause: pause,
      resume: resume,
      togglePause: togglePause,
      skipNext: skipNext,
      skipPrev: skipPrev,
      stop: stop,
      getState: getStateSnapshot
    };
  }

  function setMuted(muted) {
    soundMuted = !!muted;
    return soundMuted;
  }

  function isMuted() {
    return soundMuted || soundVolume <= 0;
  }

  function setVolume(volPercent) {
    const parsed = parseInt(volPercent, 10);
    soundVolume = isNaN(parsed) ? 80 : Math.max(0, Math.min(100, parsed));
    if (soundVolume === 0) {
      soundMuted = true;
    } else {
      soundMuted = false;
    }
    return soundVolume;
  }

  function getVolume() {
    return soundMuted ? 0 : soundVolume;
  }

  global.SetTimerEngine = {
    PHASE_ACTIVITY: PHASE_ACTIVITY,
    PHASE_SET_REST: PHASE_SET_REST,
    PHASE_BETWEEN: PHASE_BETWEEN,
    PHASE_END: PHASE_END,
    buildTimeline: buildTimeline,
    calculateRoutineSummary: calculateRoutineSummary,
    formatSeconds: formatSeconds,
    createTimerController: createTimerController,
    setMuted: setMuted,
    isMuted: isMuted,
    setVolume: setVolume,
    getVolume: getVolume,
    playVolumePreviewTone: playVolumePreviewTone
  };
})(window);
