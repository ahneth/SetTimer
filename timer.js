/* ==========================================================================
   SetTimer - Recursive Tree Traversal Interval Timer & Sound Engine (timer.js)
   Traverses up to 3 levels of Groups/Subgroups/Exercises depth-first,
   prepend Prepare Time (Bright Blue screen), and drives audio & state cues.
   ========================================================================== */

(function (global) {
  'use strict';

  const PHASE_PREPARE = 'PREPARE';           // Bright Blue screen at start
  const PHASE_ACTIVITY = 'ACTIVITY';         // Bright Green screen
  const PHASE_SET_REST = 'SET_REST';         // Bright Orange screen
  const PHASE_BETWEEN = 'BETWEEN_ACTIVITY';  // Yellow screen (Between Exercises or Group Repeats)
  const PHASE_END = 'END';                   // Bright Red screen with END

  let audioCtx = null;
  let masterGainNode = null;
  let limiterNode = null;
  let soundMuted = false;
  let soundVolume = 80; // 0 to 100 percentage

  function getVolumeGainMultiplier() {
    if (soundMuted || soundVolume <= 0) return 0;
    const normalized = Math.max(0, Math.min(100, soundVolume)) / 100;
    return Math.pow(normalized, 1.75) * 2.8;
  }

  function syncMasterGain() {
    if (!audioCtx || !masterGainNode) return;
    try {
      const targetGain = getVolumeGainMultiplier();
      masterGainNode.gain.setTargetAtTime(targetGain, audioCtx.currentTime, 0.008);
    } catch (e) {
      // Ignore audio parameter errors
    }
  }

  function ensureAudioContext() {
    if (soundMuted || soundVolume <= 0) return null;
    try {
      const AudioContextClass = global.AudioContext || global.webkitAudioContext;
      if (!AudioContextClass) return null;
      if (!audioCtx) {
        audioCtx = new AudioContextClass();

        limiterNode = audioCtx.createDynamicsCompressor();
        limiterNode.threshold.setValueAtTime(-2.0, audioCtx.currentTime);
        limiterNode.knee.setValueAtTime(6.0, audioCtx.currentTime);
        limiterNode.ratio.setValueAtTime(12.0, audioCtx.currentTime);
        limiterNode.attack.setValueAtTime(0.001, audioCtx.currentTime);
        limiterNode.release.setValueAtTime(0.06, audioCtx.currentTime);

        masterGainNode = audioCtx.createGain();
        masterGainNode.gain.setValueAtTime(getVolumeGainMultiplier(), audioCtx.currentTime);

        masterGainNode.connect(limiterNode);
        limiterNode.connect(audioCtx.destination);
      }
      if (audioCtx.state === 'suspended') {
        audioCtx.resume();
      }
      syncMasterGain();
      return audioCtx;
    } catch (e) {
      return null;
    }
  }

  function playTone(freq, durationMs, type, gainVal, delayMs) {
    if (soundMuted || soundVolume <= 0) return;
    const ctx = ensureAudioContext();
    if (!ctx || !masterGainNode) return;
    try {
      const startDelaySec = Math.max(0, (delayMs || 0) / 1000);
      const startTime = ctx.currentTime + startDelaySec;
      const durationSec = Math.max(0.04, (durationMs || 150) / 1000);
      const attackSec = Math.min(0.005, durationSec * 0.1);
      const sustainEndTime = startTime + durationSec * 0.8;
      const stopTime = startTime + durationSec;

      const peakGain = Math.max(0.05, Math.min(1.2, gainVal !== undefined ? gainVal : 0.85));

      const osc1 = ctx.createOscillator();
      osc1.type = type || 'triangle';
      osc1.frequency.setValueAtTime(freq, startTime);

      const osc2 = ctx.createOscillator();
      osc2.type = (type === 'square' || type === 'sawtooth') ? 'sawtooth' : 'triangle';
      osc2.frequency.setValueAtTime(freq * 2, startTime);

      const harmonicGain = ctx.createGain();
      harmonicGain.gain.setValueAtTime(0.45, startTime);

      const voiceGain = ctx.createGain();
      voiceGain.gain.setValueAtTime(0.0001, startTime);
      voiceGain.gain.linearRampToValueAtTime(peakGain, startTime + attackSec);
      voiceGain.gain.setValueAtTime(peakGain, sustainEndTime);
      voiceGain.gain.exponentialRampToValueAtTime(0.0008, stopTime);

      osc1.connect(voiceGain);
      osc2.connect(harmonicGain);
      harmonicGain.connect(voiceGain);
      voiceGain.connect(masterGainNode);

      osc1.start(startTime);
      osc2.start(startTime);
      osc1.stop(stopTime + 0.01);
      osc2.stop(stopTime + 0.01);
    } catch (e) {
      // Ignore audio errors if blocked
    }
  }

  function playCountdownTick() {
    playTone(880, 130, 'triangle', 0.80, 0);
  }

  function playVolumePreviewTone() {
    playTone(880, 105, 'triangle', 0.85, 0);
  }

  function playPhaseTransition(phase) {
    if (phase === PHASE_PREPARE) {
      // Crisp double-chime for PREPARE start
      playTone(659.25, 130, 'triangle', 0.85, 0);
      playTone(783.99, 220, 'triangle', 0.90, 145);
    } else if (phase === PHASE_ACTIVITY) {
      // Energetic rising double whistle/bell for WORK start
      playTone(880, 140, 'sawtooth', 0.90, 0);
      playTone(1174.66, 300, 'sawtooth', 1.0, 150);
    } else if (phase === PHASE_SET_REST || phase === PHASE_BETWEEN) {
      // Distinct two-tone descending gym horn for REST start
      playTone(659.25, 140, 'triangle', 0.90, 0);
      playTone(523.25, 280, 'sawtooth', 0.95, 150);
    } else if (phase === PHASE_END) {
      // Loud 3-note victory fanfare for ROUTINE END
      playTone(587.33, 160, 'sawtooth', 0.95, 0);
      playTone(880, 160, 'sawtooth', 0.95, 175);
      playTone(1174.66, 480, 'sawtooth', 1.05, 350);
    }
  }

  function nodeHasValidExercises(node) {
    if (!node || typeof node !== 'object') return false;
    if (node.type === 'group') {
      return Array.isArray(node.children) && node.children.some(nodeHasValidExercises);
    }
    return (parseInt(node.sets, 10) || 0) > 0 && (parseInt(node.timePerSet, 10) || 0) > 0;
  }

  function formatBreadcrumb(ancestors) {
    if (!Array.isArray(ancestors) || ancestors.length === 0) return '';
    return ancestors.map(function (a) {
      return a.name + ' (Repeat ' + a.currentRepeat + '/' + a.totalRepeats + ')';
    }).join(' › ');
  }

  /**
   * Depth-first traversal of the routine's exercise/group tree to produce
   * a flat list of exercise execution runs and boundary rest metadata.
   */
  function expandRoutineTreeToRuns(routine) {
    const runs = [];
    if (!routine || !Array.isArray(routine.activities)) return runs;
    const defaultRest = Math.max(0, parseInt(routine.betweenActivityRest !== undefined ? routine.betweenActivityRest : 20, 10) || 0);

    function traverseList(nodes, ancestors) {
      const validNodes = (nodes || []).filter(nodeHasValidExercises);
      validNodes.forEach(function (node, idx) {
        const isLastSibling = (idx === validNodes.length - 1);
        const afterNodeRest = node.restAfterActivity !== undefined && node.restAfterActivity !== null
          ? Math.max(0, parseInt(node.restAfterActivity, 10))
          : defaultRest;

        if (node.type === 'group') {
          const groupName = String(node.name || '').trim() || 'Group';
          const repeats = Math.max(1, parseInt(node.sets, 10) || 1);
          const restBetweenRepeats = node.restBetweenSets !== undefined && node.restBetweenSets !== null
            ? Math.max(0, parseInt(node.restBetweenSets, 10))
            : defaultRest;

          for (let r = 1; r <= repeats; r++) {
            const nextAncestors = ancestors.concat([{
              id: node.id,
              name: groupName,
              currentRepeat: r,
              totalRepeats: repeats
            }]);
            const beforeLen = runs.length;
            traverseList(node.children, nextAncestors);
            if (runs.length > beforeLen) {
              const lastRunInRound = runs[runs.length - 1];
              if (r < repeats) {
                lastRunInRound.restAfterRun = restBetweenRepeats;
                lastRunInRound.transitionType = 'GROUP_REPEAT_REST';
                lastRunInRound.transitionLabel = 'Rest Between Group Repeats — ' + groupName + ' (Next: Repeat ' + (r + 1) + ' of ' + repeats + ')';
                lastRunInRound.transitionGroupContext = groupName + ' • Repeat ' + (r + 1) + ' of ' + repeats;
              } else if (!isLastSibling) {
                lastRunInRound.restAfterRun = afterNodeRest;
                lastRunInRound.transitionType = 'AFTER_GROUP_REST';
                lastRunInRound.transitionLabel = 'Rest After ' + groupName;
                lastRunInRound.transitionGroupContext = 'Completed ' + groupName;
              }
            }
          }
        } else {
          const actName = String(node.name || '').trim() || 'Exercise';
          const sets = Math.max(1, parseInt(node.sets, 10) || 1);
          const timePerSet = Math.max(1, parseInt(node.timePerSet, 10) || 30);
          const restBetweenSets = Math.max(0, parseInt(node.restBetweenSets !== undefined ? node.restBetweenSets : 15, 10));

          runs.push({
            id: node.id,
            name: actName,
            sets: sets,
            timePerSet: timePerSet,
            restBetweenSets: restBetweenSets,
            restAfterRun: afterNodeRest,
            transitionType: 'BETWEEN_EXERCISES',
            transitionLabel: 'Rest Between Exercises',
            transitionGroupContext: formatBreadcrumb(ancestors),
            ancestors: ancestors.slice(),
            breadcrumb: formatBreadcrumb(ancestors)
          });
        }
      });
    }

    traverseList(routine.activities, []);
    return runs;
  }

  function buildTimeline(routine) {
    const steps = [];
    if (!routine) return steps;

    const runs = expandRoutineTreeToRuns(routine);
    const totalRuns = runs.length;
    if (totalRuns === 0) return steps;

    const prepSec = routine.prepareTime !== undefined && routine.prepareTime !== null
      ? Math.max(0, parseInt(routine.prepareTime, 10) || 0)
      : 0;

    // 1. Optional Opening Prepare Time (Bright Blue Screen)
    if (prepSec > 0) {
      const firstRun = runs[0];
      const firstHint = firstRun.breadcrumb
        ? (firstRun.name + ' (' + firstRun.breadcrumb + ')')
        : (firstRun.name + ' (' + firstRun.sets + (firstRun.sets === 1 ? ' Set' : ' Sets') + ' × ' + firstRun.timePerSet + 's)');
      steps.push({
        phase: PHASE_PREPARE,
        duration: prepSec,
        activityIndex: 1,
        totalActivities: totalRuns,
        activityName: 'PREPARE',
        currentSet: 1,
        totalSets: 1,
        breadcrumb: firstRun.breadcrumb || 'Routine Start',
        upNextName: firstRun.name,
        upNextDetails: firstRun.sets + (firstRun.sets === 1 ? ' Set' : ' Sets') + ' × ' + firstRun.timePerSet + 's',
        upNextHint: firstHint
      });
    }

    // 2. Flatten Exercise Runs & Intra-Exercise Sets + Inter-Exercise / Group Repeat Rests
    runs.forEach(function (run, runIdx) {
      const nextRun = (runIdx + 1 < totalRuns) ? runs[runIdx + 1] : null;
      const betweenRest = Math.max(0, parseInt(run.restAfterRun, 10) || 0);

      for (let s = 1; s <= run.sets; s++) {
        let nextLabelAfterSet = 'Routine Complete';
        if (s < run.sets) {
          nextLabelAfterSet = run.restBetweenSets > 0
            ? ('Set Rest (' + run.restBetweenSets + 's) → ' + run.name + ' (Set ' + (s + 1) + '/' + run.sets + ')')
            : (run.name + ' (Set ' + (s + 1) + '/' + run.sets + ')');
        } else if (nextRun) {
          const nextRunContext = nextRun.breadcrumb ? (' [' + nextRun.breadcrumb + ']') : '';
          nextLabelAfterSet = betweenRest > 0
            ? ((run.transitionType === 'GROUP_REPEAT_REST' ? 'Group Repeat Rest' : 'Rest') + ' (' + betweenRest + 's) → ' + nextRun.name + nextRunContext)
            : (nextRun.name + nextRunContext);
        }

        steps.push({
          phase: PHASE_ACTIVITY,
          duration: run.timePerSet,
          activityIndex: runIdx + 1,
          totalActivities: totalRuns,
          activityName: run.name,
          currentSet: s,
          totalSets: run.sets,
          breadcrumb: run.breadcrumb,
          upNextName: nextRun ? nextRun.name : null,
          upNextHint: nextLabelAfterSet
        });

        if (s < run.sets && run.restBetweenSets > 0) {
          steps.push({
            phase: PHASE_SET_REST,
            duration: run.restBetweenSets,
            activityIndex: runIdx + 1,
            totalActivities: totalRuns,
            activityName: run.name,
            currentSet: s,
            nextSet: s + 1,
            totalSets: run.sets,
            breadcrumb: run.breadcrumb,
            upNextName: run.name + ' — Set ' + (s + 1) + ' of ' + run.sets,
            upNextHint: run.name + ' (Set ' + (s + 1) + ' of ' + run.sets + ' • ' + run.timePerSet + 's)'
          });
        }
      }

      if (nextRun && betweenRest > 0) {
        const nextDetails = nextRun.sets + (nextRun.sets === 1 ? ' Set' : ' Sets') + ' × ' + nextRun.timePerSet + 's' +
          (nextRun.breadcrumb ? (' • ' + nextRun.breadcrumb) : '');
        steps.push({
          phase: PHASE_BETWEEN,
          duration: betweenRest,
          activityIndex: runIdx + 1,
          totalActivities: totalRuns,
          activityName: run.transitionLabel || 'Rest Between Activities',
          transitionType: run.transitionType || 'BETWEEN_EXERCISES',
          completedActivityName: run.name,
          currentSet: run.sets,
          totalSets: run.sets,
          breadcrumb: nextRun.breadcrumb || run.breadcrumb,
          upNextName: nextRun.name,
          upNextDetails: nextDetails,
          upNextHint: nextRun.name + ' (' + nextDetails + ')'
        });
      }
    });

    return steps;
  }

  /**
   * Computes the exact duration in seconds of an individual Exercise or Group node
   * (including all sets, child nodes, and group repeats) for its Edit Mode card badge.
   */
  function calculateNodeSubtotalSeconds(node, fallbackBetweenRest) {
    if (!node || typeof node !== 'object') return 0;
    const defaultRest = Math.max(0, parseInt(fallbackBetweenRest !== undefined ? fallbackBetweenRest : 20, 10) || 0);
    const tempRoutine = {
      id: 'temp',
      name: 'temp',
      prepareTime: 0,
      betweenActivityRest: defaultRest,
      activities: [node]
    };
    const steps = buildTimeline(tempRoutine);
    return steps.reduce(function (acc, st) { return acc + (st.duration || 0); }, 0);
  }

  function calculateRoutineSummary(routine) {
    const steps = buildTimeline(routine);
    const runs = expandRoutineTreeToRuns(routine);
    const totalSeconds = steps.reduce(function (acc, st) { return acc + (st.duration || 0); }, 0);
    const totalSets = runs.reduce(function (acc, r) { return acc + (r.sets || 0); }, 0);
    return {
      totalSteps: steps.length,
      totalSeconds: totalSeconds,
      totalSets: totalSets,
      activityCount: runs.length
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
    syncMasterGain();
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
    syncMasterGain();
    return soundVolume;
  }

  function getVolume() {
    return soundMuted ? 0 : soundVolume;
  }

  global.SetTimerEngine = {
    PHASE_PREPARE: PHASE_PREPARE,
    PHASE_ACTIVITY: PHASE_ACTIVITY,
    PHASE_SET_REST: PHASE_SET_REST,
    PHASE_BETWEEN: PHASE_BETWEEN,
    PHASE_END: PHASE_END,
    buildTimeline: buildTimeline,
    expandRoutineTreeToRuns: expandRoutineTreeToRuns,
    calculateNodeSubtotalSeconds: calculateNodeSubtotalSeconds,
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
