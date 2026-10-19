/* ==========================================================================
   SetTimer - Main Application Controller Module (app.js)
   Coordinates Edit Mode, LocalStorage sync, Drag-and-Drop reordering,
   Excel Backup/Restore, and the Full-Screen Run Mode countdown view.
   ========================================================================== */

(function (global) {
  'use strict';

  let routines = [];
  let activeRoutineId = null;
  let timerController = null;
  let toastTimeout = null;

  function getActiveRoutine() {
    return routines.find(function (r) { return r.id === activeRoutineId; }) || routines[0] || null;
  }

  function persistAll(showFeedback, message) {
    routines = global.SetTimerStorage.saveRoutines(routines);
    global.SetTimerStorage.saveActiveRoutineId(activeRoutineId);
    updateStorageBadge();
    renderRoutineSummaryBar();
    if (showFeedback) {
      showToast(message || 'Routine saved locally.');
    }
  }

  function showToast(message, isError) {
    const toastEl = document.getElementById('toast-notification');
    const toastText = document.getElementById('toast-message');
    if (!toastEl || !toastText) return;

    toastText.textContent = message;
    toastEl.className = 'fixed bottom-5 right-5 z-50 px-4 py-3 rounded-xl shadow-2xl border flex items-center gap-2.5 text-sm font-medium toast-enter ' +
      (isError
        ? 'bg-red-950/95 border-red-500/60 text-red-100'
        : 'bg-slate-900/95 border-emerald-500/60 text-emerald-100');

    toastEl.classList.remove('hidden');
    if (toastTimeout) clearTimeout(toastTimeout);
    toastTimeout = setTimeout(function () {
      toastEl.classList.add('hidden');
    }, 3200);
  }

  function updateStorageBadge() {
    const badge = document.getElementById('auto-save-status');
    if (!badge) return;
    const now = new Date();
    const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    badge.textContent = 'Auto-saved locally • ' + timeStr;
  }

  function renderRoutineSelector() {
    const selectEl = document.getElementById('routine-selector');
    if (!selectEl) return;

    selectEl.innerHTML = '';
    routines.forEach(function (routine) {
      const opt = document.createElement('option');
      opt.value = routine.id;
      const summary = global.SetTimerEngine.calculateRoutineSummary(routine);
      opt.textContent = routine.name + ' (' + routine.activities.length + ' activities • ' + global.SetTimerEngine.formatSeconds(summary.totalSeconds) + ')';
      if (routine.id === activeRoutineId) {
        opt.selected = true;
      }
      selectEl.appendChild(opt);
    });
  }

  function renderRoutineHeader() {
    const routine = getActiveRoutine();
    if (!routine) return;

    const nameInput = document.getElementById('routine-name-input');
    const betweenRestInput = document.getElementById('between-activity-rest-input');

    if (nameInput && document.activeElement !== nameInput) {
      nameInput.value = routine.name;
    }
    if (betweenRestInput && document.activeElement !== betweenRestInput) {
      betweenRestInput.value = routine.betweenActivityRest;
    }
  }

  function renderRoutineSummaryBar() {
    const routine = getActiveRoutine();
    if (!routine) return;

    const summary = global.SetTimerEngine.calculateRoutineSummary(routine);
    const actCountEl = document.getElementById('summary-activities-count');
    const setCountEl = document.getElementById('summary-sets-count');
    const totalTimeEl = document.getElementById('summary-total-duration');
    const stepsCountEl = document.getElementById('summary-steps-count');

    if (actCountEl) actCountEl.textContent = String(summary.activityCount);
    if (setCountEl) setCountEl.textContent = String(summary.totalSets);
    if (totalTimeEl) totalTimeEl.textContent = global.SetTimerEngine.formatSeconds(summary.totalSeconds);
    if (stepsCountEl) stepsCountEl.textContent = String(summary.totalSteps);

    renderRoutineSelector();
  }

  function escapeHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function renderActivitiesList() {
    const container = document.getElementById('activities-list-container');
    const emptyState = document.getElementById('activities-empty-state');
    const routine = getActiveRoutine();
    if (!container || !routine) return;

    if (!Array.isArray(routine.activities) || routine.activities.length === 0) {
      container.innerHTML = '';
      if (emptyState) emptyState.classList.remove('hidden');
      renderRoutineSummaryBar();
      return;
    }

    if (emptyState) emptyState.classList.add('hidden');

    const total = routine.activities.length;
    const htmlParts = [];

    routine.activities.forEach(function (act, idx) {
      const isLast = (idx === total - 1);
      const actTotalWork = (parseInt(act.sets, 10) || 1) * (parseInt(act.timePerSet, 10) || 0);
      const actTotalSetRest = Math.max(0, ((parseInt(act.sets, 10) || 1) - 1)) * (parseInt(act.restBetweenSets, 10) || 0);
      const actSubtotalSec = actTotalWork + actTotalSetRest;
      const betweenRestVal = act.restAfterActivity !== undefined ? act.restAfterActivity : routine.betweenActivityRest;

      htmlParts.push(
        '<div class="activity-card bg-slate-800/90 border border-slate-700/80 rounded-xl p-4 shadow-sm hover:border-slate-600" data-activity-index="' + idx + '" data-activity-id="' + escapeHtml(act.id) + '" draggable="true">' +
          '<div class="flex flex-wrap items-center justify-between gap-2 mb-3 pb-2.5 border-b border-slate-700/60">' +
            '<div class="flex items-center gap-2.5">' +
              '<span class="drag-handle inline-flex items-center justify-center w-8 h-8 rounded-lg bg-slate-900/90 border border-slate-700 text-slate-400 hover:text-white hover:border-slate-500" title="Drag to reorder exercise">' +
                '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 8h16M4 16h16"/></svg>' +
              '</span>' +
              '<span class="inline-flex items-center justify-center px-2.5 py-0.5 rounded-md text-xs font-bold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">' +
                'Exercise #' + (idx + 1) +
              '</span>' +
              '<span class="text-xs text-slate-400 font-medium">' +
                'Subtotal: ' + global.SetTimerEngine.formatSeconds(actSubtotalSec) +
              '</span>' +
            '</div>' +
            '<div class="flex items-center gap-1.5">' +
              '<button type="button" class="btn-move-up px-2 py-1 rounded-lg bg-slate-900 border border-slate-700 text-slate-300 hover:text-white hover:bg-slate-700 text-xs disabled:opacity-35 disabled:pointer-events-none" data-index="' + idx + '" ' + (idx === 0 ? 'disabled' : '') + ' title="Move Up">' +
                '↑ Up' +
              '</button>' +
              '<button type="button" class="btn-move-down px-2 py-1 rounded-lg bg-slate-900 border border-slate-700 text-slate-300 hover:text-white hover:bg-slate-700 text-xs disabled:opacity-35 disabled:pointer-events-none" data-index="' + idx + '" ' + (isLast ? 'disabled' : '') + ' title="Move Down">' +
                '↓ Down' +
              '</button>' +
              '<button type="button" class="btn-duplicate-activity px-2.5 py-1 rounded-lg bg-slate-900 border border-slate-700 text-slate-300 hover:text-emerald-300 hover:border-emerald-500/40 text-xs" data-index="' + idx + '" title="Duplicate Activity">' +
                'Duplicate' +
              '</button>' +
              '<button type="button" class="btn-remove-activity px-2.5 py-1 rounded-lg bg-red-950/60 border border-red-500/30 text-red-300 hover:bg-red-900/70 hover:text-white text-xs" data-index="' + idx + '" title="Remove Activity">' +
                'Remove' +
              '</button>' +
            '</div>' +
          '</div>' +

          '<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-12 gap-3 items-end">' +
            '<div class="lg:col-span-5">' +
              '<label class="block text-xs font-semibold uppercase tracking-wider text-slate-300 mb-1">Activity Name</label>' +
              '<input type="text" class="field-input input-activity-name" data-index="' + idx + '" placeholder="e.g., Push-Ups, Burpees, Plank" value="' + escapeHtml(act.name) + '" />' +
            '</div>' +
            '<div class="lg:col-span-2">' +
              '<label class="block text-xs font-semibold uppercase tracking-wider text-emerald-300 mb-1">Number of Sets</label>' +
              '<input type="number" min="1" max="99" class="field-input input-activity-sets" data-index="' + idx + '" value="' + escapeHtml(act.sets) + '" />' +
            '</div>' +
            '<div class="lg:col-span-2">' +
              '<label class="block text-xs font-semibold uppercase tracking-wider text-emerald-300 mb-1">Time per Set (sec)</label>' +
              '<input type="number" min="1" max="3600" class="field-input input-activity-time" data-index="' + idx + '" value="' + escapeHtml(act.timePerSet) + '" />' +
            '</div>' +
            '<div class="lg:col-span-3">' +
              '<label class="block text-xs font-semibold uppercase tracking-wider text-amber-300 mb-1">Rest Between Sets (sec)</label>' +
              '<input type="number" min="0" max="3600" class="field-input input-activity-rest" data-index="' + idx + '" value="' + escapeHtml(act.restBetweenSets) + '" />' +
            '</div>' +
          '</div>' +
        '</div>'
      );

      // Connector bar for "In between activities, user can set rest time"
      if (!isLast) {
        const nextAct = routine.activities[idx + 1];
        htmlParts.push(
          '<div class="my-2 px-4 py-2 rounded-lg bg-yellow-500/10 border border-yellow-400/30 flex flex-wrap items-center justify-between gap-2 text-xs">' +
            '<div class="flex items-center gap-2 text-yellow-200 font-medium">' +
              '<span class="inline-block w-2.5 h-2.5 rounded-full bg-yellow-400"></span>' +
              '<span>Rest in between Activities (before <strong>' + escapeHtml(nextAct ? nextAct.name : 'Next Activity') + '</strong>):</span>' +
            '</div>' +
            '<div class="flex items-center gap-2">' +
              '<input type="number" min="0" max="3600" class="w-24 bg-slate-900 border border-yellow-400/40 rounded-md px-2.5 py-1 text-yellow-100 font-semibold text-right input-between-activity-rest-item" data-index="' + idx + '" value="' + escapeHtml(betweenRestVal) + '" />' +
              '<span class="text-yellow-200/80">sec (Yellow Screen)</span>' +
            '</div>' +
          '</div>'
        );
      }
    });

    container.innerHTML = htmlParts.join('');

    // Attach input listeners
    container.querySelectorAll('.input-activity-name').forEach(function (input) {
      input.addEventListener('input', function (e) {
        const idx = parseInt(e.target.getAttribute('data-index'), 10);
        if (routine.activities[idx]) {
          routine.activities[idx].name = e.target.value;
          persistAll(false);
        }
      });
      input.addEventListener('change', function () {
        renderActivitiesList();
      });
    });

    container.querySelectorAll('.input-activity-sets').forEach(function (input) {
      input.addEventListener('input', function (e) {
        const idx = parseInt(e.target.getAttribute('data-index'), 10);
        const val = Math.max(1, parseInt(e.target.value, 10) || 1);
        if (routine.activities[idx]) {
          routine.activities[idx].sets = val;
          persistAll(false);
        }
      });
      input.addEventListener('change', function () {
        renderActivitiesList();
      });
    });

    container.querySelectorAll('.input-activity-time').forEach(function (input) {
      input.addEventListener('input', function (e) {
        const idx = parseInt(e.target.getAttribute('data-index'), 10);
        const val = Math.max(1, parseInt(e.target.value, 10) || 1);
        if (routine.activities[idx]) {
          routine.activities[idx].timePerSet = val;
          persistAll(false);
        }
      });
      input.addEventListener('change', function () {
        renderActivitiesList();
      });
    });

    container.querySelectorAll('.input-activity-rest').forEach(function (input) {
      input.addEventListener('input', function (e) {
        const idx = parseInt(e.target.getAttribute('data-index'), 10);
        const raw = parseInt(e.target.value, 10);
        const val = isNaN(raw) ? 0 : Math.max(0, raw);
        if (routine.activities[idx]) {
          routine.activities[idx].restBetweenSets = val;
          persistAll(false);
        }
      });
      input.addEventListener('change', function () {
        renderActivitiesList();
      });
    });

    container.querySelectorAll('.input-between-activity-rest-item').forEach(function (input) {
      input.addEventListener('input', function (e) {
        const idx = parseInt(e.target.getAttribute('data-index'), 10);
        const raw = parseInt(e.target.value, 10);
        const val = isNaN(raw) ? 0 : Math.max(0, raw);
        if (routine.activities[idx]) {
          routine.activities[idx].restAfterActivity = val;
          persistAll(false);
        }
      });
    });

    // Move Up / Move Down / Duplicate / Remove buttons
    container.querySelectorAll('.btn-move-up').forEach(function (btn) {
      btn.addEventListener('click', function () {
        const idx = parseInt(btn.getAttribute('data-index'), 10);
        if (idx > 0) {
          reorderActivities(idx, idx - 1);
        }
      });
    });

    container.querySelectorAll('.btn-move-down').forEach(function (btn) {
      btn.addEventListener('click', function () {
        const idx = parseInt(btn.getAttribute('data-index'), 10);
        if (idx < routine.activities.length - 1) {
          reorderActivities(idx, idx + 1);
        }
      });
    });

    container.querySelectorAll('.btn-duplicate-activity').forEach(function (btn) {
      btn.addEventListener('click', function () {
        const idx = parseInt(btn.getAttribute('data-index'), 10);
        const src = routine.activities[idx];
        if (!src) return;
        const copy = global.SetTimerStorage.sanitizeActivity({
          id: global.SetTimerStorage.generateId('act'),
          name: src.name + ' (Copy)',
          sets: src.sets,
          timePerSet: src.timePerSet,
          restBetweenSets: src.restBetweenSets,
          restAfterActivity: src.restAfterActivity
        }, routine.betweenActivityRest);
        routine.activities.splice(idx + 1, 0, copy);
        persistAll(true, 'Duplicated "' + src.name + '".');
        renderActivitiesList();
      });
    });

    container.querySelectorAll('.btn-remove-activity').forEach(function (btn) {
      btn.addEventListener('click', function () {
        const idx = parseInt(btn.getAttribute('data-index'), 10);
        const removed = routine.activities.splice(idx, 1)[0];
        persistAll(true, 'Removed activity "' + (removed ? removed.name : '') + '".');
        renderActivitiesList();
      });
    });

    // Attach Drag and Drop handlers
    global.SetTimerDragDrop.attachDragAndDrop(container, reorderActivities);
    renderRoutineSummaryBar();
  }

  function reorderActivities(fromIndex, toIndex) {
    const routine = getActiveRoutine();
    if (!routine || !Array.isArray(routine.activities)) return;
    if (fromIndex < 0 || fromIndex >= routine.activities.length) return;
    const clampedTo = Math.max(0, Math.min(routine.activities.length - 1, toIndex));
    if (fromIndex === clampedTo) return;

    const moved = routine.activities.splice(fromIndex, 1)[0];
    routine.activities.splice(clampedTo, 0, moved);
    persistAll(true, 'Updated exercise order.');
    renderActivitiesList();
  }

  function renderAllEditMode() {
    renderRoutineSelector();
    renderRoutineHeader();
    renderActivitiesList();
    renderRoutineSummaryBar();
  }

  /* ==========================================================================
     Run Mode UI & State Screen Coloring
     ========================================================================== */
  function applyRunScreenStateClasses(runSectionEl, snapshot) {
    if (!runSectionEl || !snapshot) return;

    runSectionEl.classList.remove(
      'run-state-activity',
      'run-state-set-rest',
      'run-state-between',
      'run-state-end',
      'run-state-paused'
    );

    // Requirement: "When paused, the screen still shows the status of what activity
    // is running and the count down, but a text PAUSED is shown, and the screen becomes grey.
    // The screen color returns to its state color when user Resumes"
    if (snapshot.isPaused) {
      runSectionEl.classList.add('run-state-paused');
      return;
    }

    if (snapshot.isFinished || snapshot.phase === global.SetTimerEngine.PHASE_END) {
      runSectionEl.classList.add('run-state-end');
    } else if (snapshot.phase === global.SetTimerEngine.PHASE_ACTIVITY) {
      runSectionEl.classList.add('run-state-activity');
    } else if (snapshot.phase === global.SetTimerEngine.PHASE_SET_REST) {
      runSectionEl.classList.add('run-state-set-rest');
    } else if (snapshot.phase === global.SetTimerEngine.PHASE_BETWEEN) {
      runSectionEl.classList.add('run-state-between');
    }
  }

  function renderRunScreen(snapshot) {
    const runSection = document.getElementById('run-mode-screen');
    const routineTitleEl = document.getElementById('run-routine-title');
    const phaseBadgeEl = document.getElementById('run-phase-badge');
    const pausedBannerEl = document.getElementById('run-paused-banner');
    const mainHeadingEl = document.getElementById('run-main-heading');
    const subHeadingEl = document.getElementById('run-sub-heading');
    const countdownEl = document.getElementById('run-countdown-display');
    const upNextCardEl = document.getElementById('run-up-next-card');
    const upNextTextEl = document.getElementById('run-up-next-text');
    const progressBarEl = document.getElementById('run-progress-bar');
    const stepCounterEl = document.getElementById('run-step-counter');
    const pauseBtnEl = document.getElementById('btn-run-pause-toggle');
    const pauseBtnTextEl = document.getElementById('btn-run-pause-text');
    const activeControlsEl = document.getElementById('run-active-controls');
    const endControlsEl = document.getElementById('run-end-controls');

    const routine = getActiveRoutine();
    if (!runSection || !snapshot) return;

    applyRunScreenStateClasses(runSection, snapshot);

    if (routineTitleEl && routine) {
      routineTitleEl.textContent = routine.name;
    }

    // Show/hide PAUSED banner
    if (pausedBannerEl) {
      if (snapshot.isPaused) {
        pausedBannerEl.classList.remove('hidden');
      } else {
        pausedBannerEl.classList.add('hidden');
      }
    }

    // Update Pause / Resume button label
    if (pauseBtnEl && pauseBtnTextEl) {
      if (snapshot.isPaused) {
        pauseBtnTextEl.textContent = 'Resume';
        pauseBtnEl.setAttribute('aria-label', 'Resume Timer');
      } else {
        pauseBtnTextEl.textContent = 'Pause';
        pauseBtnEl.setAttribute('aria-label', 'Pause Timer');
      }
    }

    // Handle END state (Bright Red screen showing END)
    if (snapshot.isFinished || snapshot.phase === global.SetTimerEngine.PHASE_END) {
      if (phaseBadgeEl) phaseBadgeEl.textContent = 'ROUTINE COMPLETE';
      if (mainHeadingEl) mainHeadingEl.textContent = 'END';
      if (subHeadingEl) {
        subHeadingEl.textContent = routine
          ? ('Completed all ' + routine.activities.length + ' activities in "' + routine.name + '"!')
          : 'Workout Complete!';
      }
      if (countdownEl) countdownEl.textContent = 'END';
      if (upNextCardEl) upNextCardEl.classList.add('hidden');
      if (progressBarEl) progressBarEl.style.width = '100%';
      if (stepCounterEl) stepCounterEl.textContent = 'Finished (' + snapshot.totalSteps + ' / ' + snapshot.totalSteps + ' intervals)';
      if (activeControlsEl) activeControlsEl.classList.add('hidden');
      if (endControlsEl) endControlsEl.classList.remove('hidden');
      return;
    }

    if (activeControlsEl) activeControlsEl.classList.remove('hidden');
    if (endControlsEl) endControlsEl.classList.add('hidden');

    const step = snapshot.step;
    if (!step) return;

    if (countdownEl) {
      countdownEl.textContent = snapshot.remainingFormatted;
    }

    if (progressBarEl) {
      progressBarEl.style.width = snapshot.progressPercent.toFixed(1) + '%';
    }

    if (stepCounterEl) {
      stepCounterEl.textContent =
        'Interval ' + (snapshot.stepIndex + 1) + ' of ' + snapshot.totalSteps +
        ' • Exercise ' + step.activityIndex + ' of ' + step.totalActivities;
    }

    if (step.phase === global.SetTimerEngine.PHASE_ACTIVITY) {
      if (phaseBadgeEl) {
        phaseBadgeEl.textContent = snapshot.isPaused ? 'ACTIVITY (PAUSED)' : 'WORK — ACTIVE SET';
      }
      if (mainHeadingEl) {
        mainHeadingEl.textContent = step.activityName;
      }
      if (subHeadingEl) {
        subHeadingEl.textContent = 'Set ' + step.currentSet + ' of ' + step.totalSets;
      }
      if (upNextCardEl && upNextTextEl) {
        upNextCardEl.classList.remove('hidden');
        upNextTextEl.textContent = 'Next: ' + (step.upNextHint || 'Routine Complete');
      }
    } else if (step.phase === global.SetTimerEngine.PHASE_SET_REST) {
      if (phaseBadgeEl) {
        phaseBadgeEl.textContent = snapshot.isPaused ? 'REST BETWEEN SETS (PAUSED)' : 'REST TIME — BETWEEN SETS';
      }
      if (mainHeadingEl) {
        mainHeadingEl.textContent = 'REST';
      }
      if (subHeadingEl) {
        subHeadingEl.textContent = step.activityName + ' • Preparing for Set ' + step.nextSet + ' of ' + step.totalSets;
      }
      if (upNextCardEl && upNextTextEl) {
        upNextCardEl.classList.remove('hidden');
        upNextTextEl.textContent = 'Up Next: ' + step.upNextHint;
      }
    } else if (step.phase === global.SetTimerEngine.PHASE_BETWEEN) {
      // Requirement: "In between Activities, it shows yellow screen, a count down and what is Up Next."
      if (phaseBadgeEl) {
        phaseBadgeEl.textContent = snapshot.isPaused ? 'BETWEEN ACTIVITIES (PAUSED)' : 'REST BETWEEN ACTIVITIES';
      }
      if (mainHeadingEl) {
        mainHeadingEl.textContent = 'UP NEXT: ' + step.upNextName;
      }
      if (subHeadingEl) {
        subHeadingEl.textContent = 'Get Ready • ' + (step.upNextDetails || '');
      }
      if (upNextCardEl && upNextTextEl) {
        upNextCardEl.classList.remove('hidden');
        upNextTextEl.textContent = 'Up Next: ' + step.upNextName + ' (' + (step.upNextDetails || '') + ')';
      }
    }
  }

  function startRoutineRun() {
    const routine = getActiveRoutine();
    if (!routine || !Array.isArray(routine.activities) || routine.activities.length === 0) {
      showToast('Please add at least one Activity before starting the timer.', true);
      return;
    }

    // Ensure any current edits are saved locally before running
    persistAll(false);

    const editScreen = document.getElementById('edit-mode-screen');
    const runScreen = document.getElementById('run-mode-screen');
    if (editScreen) editScreen.classList.add('hidden');
    if (runScreen) runScreen.classList.remove('hidden');

    timerController.start(routine);
  }

  function exitRunMode() {
    timerController.stop();
    const editScreen = document.getElementById('edit-mode-screen');
    const runScreen = document.getElementById('run-mode-screen');
    if (runScreen) runScreen.classList.add('hidden');
    if (editScreen) editScreen.classList.remove('hidden');
  }

  function initApp() {
    // 1. Auto-load saved routines from localStorage on page open
    routines = global.SetTimerStorage.loadRoutines();
    activeRoutineId = global.SetTimerStorage.loadActiveRoutineId(routines);

    // 2. Initialize Timer Controller
    timerController = global.SetTimerEngine.createTimerController({
      onTick: renderRunScreen,
      onPhaseChange: renderRunScreen
    });

    // 3. Render Edit Mode
    renderAllEditMode();
    updateStorageBadge();

    // 4. Bind Edit Mode Header Controls
    const routineSelector = document.getElementById('routine-selector');
    if (routineSelector) {
      routineSelector.addEventListener('change', function (e) {
        activeRoutineId = e.target.value;
        global.SetTimerStorage.saveActiveRoutineId(activeRoutineId);
        renderAllEditMode();
        showToast('Loaded routine "' + (getActiveRoutine() ? getActiveRoutine().name : '') + '".');
      });
    }

    const routineNameInput = document.getElementById('routine-name-input');
    if (routineNameInput) {
      routineNameInput.addEventListener('input', function (e) {
        const routine = getActiveRoutine();
        if (!routine) return;
        routine.name = e.target.value;
        routine.updatedAt = new Date().toISOString();
        persistAll(false);
      });
      routineNameInput.addEventListener('change', function () {
        renderRoutineSelector();
      });
    }

    const betweenRestInput = document.getElementById('between-activity-rest-input');
    if (betweenRestInput) {
      betweenRestInput.addEventListener('input', function (e) {
        const routine = getActiveRoutine();
        if (!routine) return;
        const raw = parseInt(e.target.value, 10);
        const val = isNaN(raw) ? 0 : Math.max(0, raw);
        routine.betweenActivityRest = val;
        // Also sync all activities in this routine to the updated default between-activity rest
        routine.activities.forEach(function (act) {
          act.restAfterActivity = val;
        });
        persistAll(false);
        renderActivitiesList();
      });
    }

    const btnNewRoutine = document.getElementById('btn-new-routine');
    if (btnNewRoutine) {
      btnNewRoutine.addEventListener('click', function () {
        const newR = global.SetTimerStorage.createEmptyRoutine('Routine #' + (routines.length + 1));
        routines.push(newR);
        activeRoutineId = newR.id;
        persistAll(true, 'Created "' + newR.name + '".');
        renderAllEditMode();
        const nameInput = document.getElementById('routine-name-input');
        if (nameInput) {
          nameInput.focus();
          nameInput.select();
        }
      });
    }

    const btnDeleteRoutine = document.getElementById('btn-delete-routine');
    if (btnDeleteRoutine) {
      btnDeleteRoutine.addEventListener('click', function () {
        if (routines.length <= 1) {
          const resetR = global.SetTimerStorage.createEmptyRoutine('My Exercise Routine');
          routines = [resetR];
          activeRoutineId = resetR.id;
          persistAll(true, 'Reset routine to a clean slate.');
          renderAllEditMode();
          return;
        }
        const curr = getActiveRoutine();
        routines = routines.filter(function (r) { return r.id !== activeRoutineId; });
        activeRoutineId = routines[0].id;
        persistAll(true, 'Deleted routine "' + (curr ? curr.name : '') + '".');
        renderAllEditMode();
      });
    }

    const btnSaveRoutine = document.getElementById('btn-save-routine');
    if (btnSaveRoutine) {
      btnSaveRoutine.addEventListener('click', function () {
        persistAll(true, 'Routine "' + (getActiveRoutine() ? getActiveRoutine().name : '') + '" saved to local storage!');
      });
    }

    const btnAddActivity = document.getElementById('btn-add-activity');
    if (btnAddActivity) {
      btnAddActivity.addEventListener('click', function () {
        const routine = getActiveRoutine();
        if (!routine) return;
        const nextNum = routine.activities.length + 1;
        const newAct = global.SetTimerStorage.createBlankActivity(routine.betweenActivityRest);
        newAct.name = 'Exercise ' + nextNum;
        routine.activities.push(newAct);
        persistAll(true, 'Added "' + newAct.name + '".');
        renderActivitiesList();
      });
    }

    // 5. Excel Backup & Restore Controls
    const btnExportExcel = document.getElementById('btn-export-excel');
    if (btnExportExcel) {
      btnExportExcel.addEventListener('click', function () {
        try {
          persistAll(false);
          const res = global.SetTimerExcel.exportToExcel(routines, 'SetTimer_Backup');
          showToast('Exported ' + routines.length + ' routine(s) to ' + res.filename);
        } catch (err) {
          showToast('Export error: ' + err.message, true);
        }
      });
    }

    const fileInputRestore = document.getElementById('file-input-restore-excel');
    const btnTriggerRestore = document.getElementById('btn-restore-excel');
    if (btnTriggerRestore && fileInputRestore) {
      btnTriggerRestore.addEventListener('click', function () {
        fileInputRestore.value = '';
        fileInputRestore.click();
      });

      fileInputRestore.addEventListener('change', function (e) {
        const file = e.target.files && e.target.files[0];
        if (!file) return;
        global.SetTimerExcel.importFromExcelFile(file)
          .then(function (importedRoutines) {
            routines = importedRoutines;
            activeRoutineId = routines[0].id;
            persistAll(true, 'Restored ' + importedRoutines.length + ' routine(s) from "' + file.name + '"!');
            renderAllEditMode();
          })
          .catch(function (err) {
            showToast(err.message || 'Could not restore backup file.', true);
          });
      });
    }

    // 6. Start Routine & Run Mode Controls
    const btnStartRoutine = document.getElementById('btn-start-routine');
    if (btnStartRoutine) {
      btnStartRoutine.addEventListener('click', startRoutineRun);
    }

    const btnStartRoutineBottom = document.getElementById('btn-start-routine-bottom');
    if (btnStartRoutineBottom) {
      btnStartRoutineBottom.addEventListener('click', startRoutineRun);
    }

    const btnPauseToggle = document.getElementById('btn-run-pause-toggle');
    if (btnPauseToggle) {
      btnPauseToggle.addEventListener('click', function () {
        timerController.togglePause();
      });
    }

    const btnRunPrev = document.getElementById('btn-run-prev');
    if (btnRunPrev) {
      btnRunPrev.addEventListener('click', function () {
        timerController.skipPrev();
      });
    }

    const btnRunNext = document.getElementById('btn-run-next');
    if (btnRunNext) {
      btnRunNext.addEventListener('click', function () {
        timerController.skipNext();
      });
    }

    const btnRunExit = document.getElementById('btn-run-exit');
    if (btnRunExit) {
      btnRunExit.addEventListener('click', exitRunMode);
    }

    const btnEndRestart = document.getElementById('btn-end-restart');
    if (btnEndRestart) {
      btnEndRestart.addEventListener('click', startRoutineRun);
    }

    const btnEndBackEdit = document.getElementById('btn-end-back-edit');
    if (btnEndBackEdit) {
      btnEndBackEdit.addEventListener('click', exitRunMode);
    }

    const btnSoundToggle = document.getElementById('btn-sound-toggle');
    const soundLabelEl = document.getElementById('sound-toggle-label');
    if (btnSoundToggle) {
      btnSoundToggle.addEventListener('click', function () {
        const muted = global.SetTimerEngine.setMuted(!global.SetTimerEngine.isMuted());
        if (soundLabelEl) {
          soundLabelEl.textContent = muted ? 'Sound: Off' : 'Sound: On';
        }
      });
    }

    // Keyboard shortcut in Run Mode: Space to Pause/Resume, Escape to exit
    document.addEventListener('keydown', function (e) {
      const runScreen = document.getElementById('run-mode-screen');
      if (!runScreen || runScreen.classList.contains('hidden')) return;
      if (e.code === 'Space') {
        const state = timerController.getState();
        if (!state.isFinished) {
          e.preventDefault();
          timerController.togglePause();
        }
      } else if (e.code === 'Escape') {
        e.preventDefault();
        exitRunMode();
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initApp);
  } else {
    initApp();
  }
})(window);
