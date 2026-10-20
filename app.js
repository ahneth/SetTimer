/* ==========================================================================
   SetTimer - Main Application Controller Module (app.js)
   Coordinates Edit Mode, LocalStorage sync, Drag-and-Drop reordering,
   Excel Backup/Restore, Sound Volume Sliders, PWA Service Worker registration,
   and the Full-Screen Run Mode countdown view.
   ========================================================================== */

(function (global) {
  'use strict';

  let routines = [];
  let activeRoutineId = null;
  let timerController = null;
  let toastTimeout = null;
  let lastNonZeroVolume = 80;
  let deferredInstallPrompt = null;

  function getActiveRoutine() {
    return routines.find(function (r) { return r.id === activeRoutineId; }) || routines[0] || null;
  }

  /**
   * Saves all routines to localStorage in-place without replacing live object
   * references or destroying focused DOM inputs.
   */
  function persistAll(showFeedback, message) {
    global.SetTimerStorage.saveRoutines(routines);
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

  /* ==========================================================================
     Synchronized Volume Control (Edit Mode & Run Mode Top Bars)
     ========================================================================== */
  function syncVolumeUI(volumePercent) {
    const vol = Math.max(0, Math.min(100, parseInt(volumePercent, 10) || 0));
    const isMuted = (vol === 0) || global.SetTimerEngine.isMuted();
    const displayVol = isMuted ? 0 : vol;

    const editSlider = document.getElementById('edit-volume-slider');
    const runSlider = document.getElementById('run-volume-slider');
    const editLabel = document.getElementById('edit-volume-label');
    const runLabel = document.getElementById('run-volume-label');
    const editIcon = document.getElementById('edit-sound-icon');
    const runIcon = document.getElementById('run-sound-icon');
    const runSoundToggleLabel = document.getElementById('sound-toggle-label');

    if (editSlider && Number(editSlider.value) !== displayVol) {
      editSlider.value = String(displayVol);
    }
    if (runSlider && Number(runSlider.value) !== displayVol) {
      runSlider.value = String(displayVol);
    }
    if (editLabel) {
      editLabel.textContent = displayVol + '%';
    }
    if (runLabel) {
      runLabel.textContent = displayVol + '%';
    }

    const iconChar = displayVol === 0 ? '🔇' : (displayVol < 45 ? '🔉' : '🔊');
    if (editIcon) editIcon.textContent = iconChar;
    if (runIcon) runIcon.textContent = iconChar;
    if (runSoundToggleLabel) {
      runSoundToggleLabel.textContent = displayVol === 0 ? 'Muted' : 'Vol';
    }
  }

  function applyVolumeChange(newVolumePercent, playPreview) {
    const clamped = Math.max(0, Math.min(100, parseInt(newVolumePercent, 10) || 0));
    if (clamped > 0) {
      lastNonZeroVolume = clamped;
    }
    global.SetTimerEngine.setVolume(clamped);
    global.SetTimerStorage.saveVolume(clamped);
    syncVolumeUI(clamped);
    if (playPreview && clamped > 0) {
      global.SetTimerEngine.playVolumePreviewTone();
    }
  }

  function toggleMuteVolume() {
    const currentVol = global.SetTimerEngine.getVolume();
    if (currentVol > 0 && !global.SetTimerEngine.isMuted()) {
      lastNonZeroVolume = currentVol;
      global.SetTimerEngine.setVolume(0);
      global.SetTimerStorage.saveVolume(0);
      syncVolumeUI(0);
    } else {
      const restored = lastNonZeroVolume > 0 ? lastNonZeroVolume : 80;
      global.SetTimerEngine.setVolume(restored);
      global.SetTimerStorage.saveVolume(restored);
      syncVolumeUI(restored);
      global.SetTimerEngine.playVolumePreviewTone();
    }
  }

  function renderRoutineSelector() {
    const selectEl = document.getElementById('routine-selector');
    if (!selectEl) return;

    // Update options in-place if count & IDs match so we don't disrupt an open dropdown
    const existingOptions = selectEl.querySelectorAll('option');
    const sameList = existingOptions.length === routines.length &&
      Array.from(existingOptions).every(function (opt, i) { return opt.value === routines[i].id; });

    if (sameList) {
      routines.forEach(function (routine, i) {
        const summary = global.SetTimerEngine.calculateRoutineSummary(routine);
        existingOptions[i].textContent = routine.name + ' (' + routine.activities.length + ' activities • ' + global.SetTimerEngine.formatSeconds(summary.totalSeconds) + ')';
        existingOptions[i].selected = (routine.id === activeRoutineId);
      });
      return;
    }

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

  /**
   * Updates an individual Activity card's subtotal badge and connector label
   * in-place without re-rendering container.innerHTML (preserving input focus).
   */
  function updateActivityCardInPlace(idx) {
    const routine = getActiveRoutine();
    if (!routine || !routine.activities[idx]) return;

    const act = routine.activities[idx];
    const actTotalWork = (Math.max(1, parseInt(act.sets, 10) || 1)) * (Math.max(1, parseInt(act.timePerSet, 10) || 1));
    const actTotalSetRest = Math.max(0, (Math.max(1, parseInt(act.sets, 10) || 1) - 1)) * Math.max(0, parseInt(act.restBetweenSets, 10) || 0);
    const actSubtotalSec = actTotalWork + actTotalSetRest;

    const container = document.getElementById('activities-list-container');
    if (!container) return;

    const subtotalEl = container.querySelector('[data-subtotal-index="' + idx + '"]');
    if (subtotalEl) {
      subtotalEl.textContent = 'Subtotal: ' + global.SetTimerEngine.formatSeconds(actSubtotalSec);
    }

    // If this activity's name changed and there is a preceding connector bar, update its "before <Name>" label
    if (idx > 0) {
      const prevConnectorNameEl = container.querySelector('[data-next-activity-name-for="' + (idx - 1) + '"]');
      if (prevConnectorNameEl) {
        prevConnectorNameEl.textContent = act.name || ('Exercise #' + (idx + 1));
      }
    }
  }

  function escapeHtml(str) {
    return String(str !== undefined && str !== null ? str : '')
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
        '<div class="activity-card bg-slate-800/90 border border-slate-700/80 rounded-xl p-4 shadow-sm hover:border-slate-600" data-activity-index="' + idx + '" data-activity-id="' + escapeHtml(act.id) + '" draggable="false">' +
          '<div class="flex flex-wrap items-center justify-between gap-2 mb-3 pb-2.5 border-b border-slate-700/60">' +
            '<div class="flex items-center gap-2.5">' +
              '<span class="drag-handle inline-flex items-center justify-center w-8 h-8 rounded-lg bg-slate-900/90 border border-slate-700 text-slate-400 hover:text-white hover:border-slate-500" title="Drag to reorder exercise">' +
                '<svg class="w-4 h-4 pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 8h16M4 16h16"/></svg>' +
              '</span>' +
              '<span class="inline-flex items-center justify-center px-2.5 py-0.5 rounded-md text-xs font-bold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">' +
                'Exercise #' + (idx + 1) +
              '</span>' +
              '<span class="text-xs text-slate-400 font-medium" data-subtotal-index="' + idx + '">' +
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
              '<span>Rest in between Activities (before <strong data-next-activity-name-for="' + idx + '">' + escapeHtml(nextAct ? nextAct.name : 'Next Activity') + '</strong>):</span>' +
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

    // Attach input listeners that dynamically resolve getActiveRoutine() and update in-place
    container.querySelectorAll('.input-activity-name').forEach(function (input) {
      input.addEventListener('input', function (e) {
        const currentRoutine = getActiveRoutine();
        const idx = parseInt(e.target.getAttribute('data-index'), 10);
        if (currentRoutine && currentRoutine.activities[idx]) {
          currentRoutine.activities[idx].name = e.target.value;
          updateActivityCardInPlace(idx);
          persistAll(false);
        }
      });
      input.addEventListener('blur', function (e) {
        const currentRoutine = getActiveRoutine();
        const idx = parseInt(e.target.getAttribute('data-index'), 10);
        if (currentRoutine && currentRoutine.activities[idx]) {
          const trimmed = String(e.target.value || '').trim() || ('Exercise ' + (idx + 1));
          currentRoutine.activities[idx].name = trimmed;
          e.target.value = trimmed;
          updateActivityCardInPlace(idx);
          persistAll(false);
        }
      });
    });

    container.querySelectorAll('.input-activity-sets').forEach(function (input) {
      input.addEventListener('input', function (e) {
        const currentRoutine = getActiveRoutine();
        const idx = parseInt(e.target.getAttribute('data-index'), 10);
        const parsed = parseInt(e.target.value, 10);
        if (currentRoutine && currentRoutine.activities[idx] && !isNaN(parsed) && parsed >= 1) {
          currentRoutine.activities[idx].sets = parsed;
          updateActivityCardInPlace(idx);
          persistAll(false);
        }
      });
      input.addEventListener('blur', function (e) {
        const currentRoutine = getActiveRoutine();
        const idx = parseInt(e.target.getAttribute('data-index'), 10);
        if (currentRoutine && currentRoutine.activities[idx]) {
          const parsed = parseInt(e.target.value, 10);
          const safeVal = (!isNaN(parsed) && parsed >= 1) ? parsed : (currentRoutine.activities[idx].sets || 1);
          currentRoutine.activities[idx].sets = safeVal;
          e.target.value = String(safeVal);
          updateActivityCardInPlace(idx);
          persistAll(false);
        }
      });
    });

    container.querySelectorAll('.input-activity-time').forEach(function (input) {
      input.addEventListener('input', function (e) {
        const currentRoutine = getActiveRoutine();
        const idx = parseInt(e.target.getAttribute('data-index'), 10);
        const parsed = parseInt(e.target.value, 10);
        if (currentRoutine && currentRoutine.activities[idx] && !isNaN(parsed) && parsed >= 1) {
          currentRoutine.activities[idx].timePerSet = parsed;
          updateActivityCardInPlace(idx);
          persistAll(false);
        }
      });
      input.addEventListener('blur', function (e) {
        const currentRoutine = getActiveRoutine();
        const idx = parseInt(e.target.getAttribute('data-index'), 10);
        if (currentRoutine && currentRoutine.activities[idx]) {
          const parsed = parseInt(e.target.value, 10);
          const safeVal = (!isNaN(parsed) && parsed >= 1) ? parsed : (currentRoutine.activities[idx].timePerSet || 30);
          currentRoutine.activities[idx].timePerSet = safeVal;
          e.target.value = String(safeVal);
          updateActivityCardInPlace(idx);
          persistAll(false);
        }
      });
    });

    container.querySelectorAll('.input-activity-rest').forEach(function (input) {
      input.addEventListener('input', function (e) {
        const currentRoutine = getActiveRoutine();
        const idx = parseInt(e.target.getAttribute('data-index'), 10);
        const parsed = parseInt(e.target.value, 10);
        if (currentRoutine && currentRoutine.activities[idx] && !isNaN(parsed) && parsed >= 0) {
          currentRoutine.activities[idx].restBetweenSets = parsed;
          updateActivityCardInPlace(idx);
          persistAll(false);
        }
      });
      input.addEventListener('blur', function (e) {
        const currentRoutine = getActiveRoutine();
        const idx = parseInt(e.target.getAttribute('data-index'), 10);
        if (currentRoutine && currentRoutine.activities[idx]) {
          const parsed = parseInt(e.target.value, 10);
          const safeVal = (!isNaN(parsed) && parsed >= 0) ? parsed : (currentRoutine.activities[idx].restBetweenSets !== undefined ? currentRoutine.activities[idx].restBetweenSets : 15);
          currentRoutine.activities[idx].restBetweenSets = safeVal;
          e.target.value = String(safeVal);
          updateActivityCardInPlace(idx);
          persistAll(false);
        }
      });
    });

    container.querySelectorAll('.input-between-activity-rest-item').forEach(function (input) {
      input.addEventListener('input', function (e) {
        const currentRoutine = getActiveRoutine();
        const idx = parseInt(e.target.getAttribute('data-index'), 10);
        const parsed = parseInt(e.target.value, 10);
        if (currentRoutine && currentRoutine.activities[idx] && !isNaN(parsed) && parsed >= 0) {
          currentRoutine.activities[idx].restAfterActivity = parsed;
          persistAll(false);
        }
      });
      input.addEventListener('blur', function (e) {
        const currentRoutine = getActiveRoutine();
        const idx = parseInt(e.target.getAttribute('data-index'), 10);
        if (currentRoutine && currentRoutine.activities[idx]) {
          const parsed = parseInt(e.target.value, 10);
          const safeVal = (!isNaN(parsed) && parsed >= 0)
            ? parsed
            : (currentRoutine.activities[idx].restAfterActivity !== undefined ? currentRoutine.activities[idx].restAfterActivity : currentRoutine.betweenActivityRest);
          currentRoutine.activities[idx].restAfterActivity = safeVal;
          e.target.value = String(safeVal);
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
        const currentRoutine = getActiveRoutine();
        const idx = parseInt(btn.getAttribute('data-index'), 10);
        if (currentRoutine && idx < currentRoutine.activities.length - 1) {
          reorderActivities(idx, idx + 1);
        }
      });
    });

    container.querySelectorAll('.btn-duplicate-activity').forEach(function (btn) {
      btn.addEventListener('click', function () {
        const currentRoutine = getActiveRoutine();
        if (!currentRoutine) return;
        const idx = parseInt(btn.getAttribute('data-index'), 10);
        const src = currentRoutine.activities[idx];
        if (!src) return;
        const copy = global.SetTimerStorage.sanitizeActivity({
          id: global.SetTimerStorage.generateId('act'),
          name: src.name + ' (Copy)',
          sets: src.sets,
          timePerSet: src.timePerSet,
          restBetweenSets: src.restBetweenSets,
          restAfterActivity: src.restAfterActivity
        }, currentRoutine.betweenActivityRest);
        currentRoutine.activities.splice(idx + 1, 0, copy);
        persistAll(true, 'Duplicated "' + src.name + '".');
        renderActivitiesList();
      });
    });

    container.querySelectorAll('.btn-remove-activity').forEach(function (btn) {
      btn.addEventListener('click', function () {
        const currentRoutine = getActiveRoutine();
        if (!currentRoutine) return;
        const idx = parseInt(btn.getAttribute('data-index'), 10);
        const removed = currentRoutine.activities.splice(idx, 1)[0];
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

    if (pausedBannerEl) {
      if (snapshot.isPaused) {
        pausedBannerEl.classList.remove('hidden');
      } else {
        pausedBannerEl.classList.add('hidden');
      }
    }

    if (pauseBtnEl && pauseBtnTextEl) {
      if (snapshot.isPaused) {
        pauseBtnTextEl.textContent = 'Resume';
        pauseBtnEl.setAttribute('aria-label', 'Resume Timer');
      } else {
        pauseBtnTextEl.textContent = 'Pause';
        pauseBtnEl.setAttribute('aria-label', 'Pause Timer');
      }
    }

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

  function syncInputsToStateBeforeRun() {
    const routine = getActiveRoutine();
    if (!routine) return;

    const nameInput = document.getElementById('routine-name-input');
    if (nameInput && String(nameInput.value || '').trim()) {
      routine.name = String(nameInput.value).trim();
    }

    const betweenInput = document.getElementById('between-activity-rest-input');
    if (betweenInput) {
      const parsedBetween = parseInt(betweenInput.value, 10);
      if (!isNaN(parsedBetween) && parsedBetween >= 0) {
        routine.betweenActivityRest = parsedBetween;
      }
    }

    const container = document.getElementById('activities-list-container');
    if (container) {
      container.querySelectorAll('.activity-card[data-activity-index]').forEach(function (card) {
        const idx = parseInt(card.getAttribute('data-activity-index'), 10);
        const act = routine.activities[idx];
        if (!act) return;
        const nameEl = card.querySelector('.input-activity-name');
        const setsEl = card.querySelector('.input-activity-sets');
        const timeEl = card.querySelector('.input-activity-time');
        const restEl = card.querySelector('.input-activity-rest');

        if (nameEl) act.name = String(nameEl.value || '').trim() || ('Exercise ' + (idx + 1));
        if (setsEl) act.sets = Math.max(1, parseInt(setsEl.value, 10) || 1);
        if (timeEl) act.timePerSet = Math.max(1, parseInt(timeEl.value, 10) || 1);
        if (restEl) {
          const r = parseInt(restEl.value, 10);
          act.restBetweenSets = (!isNaN(r) && r >= 0) ? r : 0;
        }
      });

      container.querySelectorAll('.input-between-activity-rest-item').forEach(function (el) {
        const idx = parseInt(el.getAttribute('data-index'), 10);
        const act = routine.activities[idx];
        if (!act) return;
        const r = parseInt(el.value, 10);
        act.restAfterActivity = (!isNaN(r) && r >= 0) ? r : routine.betweenActivityRest;
      });
    }
  }

  function startRoutineRun() {
    syncInputsToStateBeforeRun();
    const routine = getActiveRoutine();
    if (!routine || !Array.isArray(routine.activities) || routine.activities.length === 0) {
      showToast('Please add at least one Activity before starting the timer.', true);
      return;
    }

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

  function registerPwaServiceWorker() {
    // Show helpful warning if user opened via file:// or content:// on Android
    const protocol = global.location && global.location.protocol ? global.location.protocol : '';
    const warningBanner = document.getElementById('local-file-pwa-warning');
    if (protocol === 'file:' || protocol === 'content:') {
      if (warningBanner) warningBanner.classList.remove('hidden');
      return;
    }

    if ('serviceWorker' in navigator && (protocol === 'https:' || protocol === 'http:')) {
      navigator.serviceWorker.register('./sw.js', { scope: './' })
        .then(function (registration) {
          if (registration && typeof registration.update === 'function') {
            registration.update().catch(function () {});
          }
        })
        .catch(function (err) {
          console.warn('SetTimer ServiceWorker registration skipped:', err);
        });
    }

    const installBtn = document.getElementById('btn-install-pwa');
    global.addEventListener('beforeinstallprompt', function (e) {
      e.preventDefault();
      deferredInstallPrompt = e;
      if (installBtn) {
        installBtn.classList.remove('hidden');
      }
    });

    if (installBtn) {
      installBtn.addEventListener('click', function () {
        if (!deferredInstallPrompt) return;
        deferredInstallPrompt.prompt();
        deferredInstallPrompt.userChoice.then(function () {
          deferredInstallPrompt = null;
          installBtn.classList.add('hidden');
        });
      });
    }

    global.addEventListener('appinstalled', function () {
      deferredInstallPrompt = null;
      if (installBtn) installBtn.classList.add('hidden');
      showToast('SetTimer installed as an App!');
    });
  }

  function initApp() {
    routines = global.SetTimerStorage.loadRoutines();
    activeRoutineId = global.SetTimerStorage.loadActiveRoutineId(routines);

    // Initialize saved sound volume (0 - 100%)
    const savedVol = global.SetTimerStorage.loadVolume();
    if (savedVol > 0) {
      lastNonZeroVolume = savedVol;
    }
    global.SetTimerEngine.setVolume(savedVol);
    syncVolumeUI(savedVol);

    timerController = global.SetTimerEngine.createTimerController({
      onTick: renderRunScreen,
      onPhaseChange: renderRunScreen
    });

    renderAllEditMode();
    updateStorageBadge();
    registerPwaServiceWorker();

    // Edit Mode & Run Mode Volume Slide Bar Listeners
    const editVolumeSlider = document.getElementById('edit-volume-slider');
    if (editVolumeSlider) {
      editVolumeSlider.addEventListener('input', function (e) {
        applyVolumeChange(e.target.value, false);
      });
      editVolumeSlider.addEventListener('change', function (e) {
        applyVolumeChange(e.target.value, true);
      });
    }

    const runVolumeSlider = document.getElementById('run-volume-slider');
    if (runVolumeSlider) {
      runVolumeSlider.addEventListener('input', function (e) {
        applyVolumeChange(e.target.value, false);
      });
      runVolumeSlider.addEventListener('change', function (e) {
        applyVolumeChange(e.target.value, true);
      });
    }

    const btnEditSoundToggle = document.getElementById('btn-edit-sound-toggle');
    if (btnEditSoundToggle) {
      btnEditSoundToggle.addEventListener('click', toggleMuteVolume);
    }

    const btnSoundToggle = document.getElementById('btn-sound-toggle');
    if (btnSoundToggle) {
      btnSoundToggle.addEventListener('click', toggleMuteVolume);
    }

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
      routineNameInput.addEventListener('blur', function (e) {
        const routine = getActiveRoutine();
        if (!routine) return;
        const trimmed = String(e.target.value || '').trim() || 'Untitled Routine';
        routine.name = trimmed;
        e.target.value = trimmed;
        persistAll(false);
      });
    }

    const betweenRestInput = document.getElementById('between-activity-rest-input');
    if (betweenRestInput) {
      betweenRestInput.addEventListener('input', function (e) {
        const routine = getActiveRoutine();
        if (!routine) return;
        const raw = parseInt(e.target.value, 10);
        if (isNaN(raw) || raw < 0) return;
        routine.betweenActivityRest = raw;
        routine.activities.forEach(function (act) {
          act.restAfterActivity = raw;
        });
        // Update connector inputs in-place without destroying DOM focus
        const container = document.getElementById('activities-list-container');
        if (container) {
          container.querySelectorAll('.input-between-activity-rest-item').forEach(function (el) {
            if (document.activeElement !== el) {
              el.value = String(raw);
            }
          });
        }
        persistAll(false);
      });
      betweenRestInput.addEventListener('blur', function (e) {
        const routine = getActiveRoutine();
        if (!routine) return;
        const raw = parseInt(e.target.value, 10);
        const safeVal = (!isNaN(raw) && raw >= 0) ? raw : (routine.betweenActivityRest || 0);
        routine.betweenActivityRest = safeVal;
        e.target.value = String(safeVal);
        persistAll(false);
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
        syncInputsToStateBeforeRun();
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

    const btnExportExcel = document.getElementById('btn-export-excel');
    if (btnExportExcel) {
      btnExportExcel.addEventListener('click', function () {
        try {
          syncInputsToStateBeforeRun();
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
