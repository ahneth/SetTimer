/* ==========================================================================
   SetTimer - Main Application Controller Module (app.js)
   Coordinates 3-Level Tree Edit Mode, Prepare Time, LocalStorage sync,
   Drag-and-Drop reordering, Excel Backup/Restore, Sound Volume Sliders,
   PWA Service Worker registration, and the Full-Screen Run Mode view.
   ========================================================================== */

(function (global) {
  'use strict';

  let routines = [];
  let activeRoutineId = null;
  let timerController = null;
  let toastTimeout = null;
  let lastNonZeroVolume = 80;
  let deferredInstallPrompt = null;
  let lastPreviewTimestamp = 0;

  function getActiveRoutine() {
    return routines.find(function (r) { return r.id === activeRoutineId; }) || routines[0] || null;
  }

  /**
   * Resolves a dot-separated index path (e.g. "0", "0.1", "1.0.2") inside a routine's tree.
   */
  function resolveNodeByPath(routine, pathStr) {
    if (!routine || !Array.isArray(routine.activities)) return null;
    if (pathStr === '' || pathStr === null || pathStr === undefined) {
      return {
        node: null,
        parentList: routine.activities,
        parentNode: null,
        index: -1,
        depth: 0
      };
    }
    const parts = String(pathStr).split('.').map(function (p) { return parseInt(p, 10); });
    let currentList = routine.activities;
    let parentNode = null;
    let currentNode = null;

    for (let i = 0; i < parts.length; i++) {
      const idx = parts[i];
      if (!Array.isArray(currentList) || isNaN(idx) || idx < 0 || idx >= currentList.length) {
        return null;
      }
      currentNode = currentList[idx];
      if (i < parts.length - 1) {
        parentNode = currentNode;
        currentList = currentNode && Array.isArray(currentNode.children) ? currentNode.children : null;
      } else {
        return {
          node: currentNode,
          parentList: currentList,
          parentNode: parentNode,
          index: idx,
          depth: parts.length
        };
      }
    }
    return null;
  }

  function getSiblingListByParentPath(routine, parentPathStr) {
    if (!routine) return null;
    if (!parentPathStr) return routine.activities;
    const resolved = resolveNodeByPath(routine, parentPathStr);
    if (resolved && resolved.node && resolved.node.type === 'group') {
      if (!Array.isArray(resolved.node.children)) {
        resolved.node.children = [];
      }
      return resolved.node.children;
    }
    return null;
  }

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
      const now = Date.now();
      if (now - lastPreviewTimestamp >= 110) {
        lastPreviewTimestamp = now;
        global.SetTimerEngine.playVolumePreviewTone();
      }
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

    const existingOptions = selectEl.querySelectorAll('option');
    const sameList = existingOptions.length === routines.length &&
      Array.from(existingOptions).every(function (opt, i) { return opt.value === routines[i].id; });

    if (sameList) {
      routines.forEach(function (routine, i) {
        const summary = global.SetTimerEngine.calculateRoutineSummary(routine);
        existingOptions[i].textContent = routine.name + ' (' + summary.activityCount + ' exercise runs • ' + global.SetTimerEngine.formatSeconds(summary.totalSeconds) + ')';
        existingOptions[i].selected = (routine.id === activeRoutineId);
      });
      return;
    }

    selectEl.innerHTML = '';
    routines.forEach(function (routine) {
      const opt = document.createElement('option');
      opt.value = routine.id;
      const summary = global.SetTimerEngine.calculateRoutineSummary(routine);
      opt.textContent = routine.name + ' (' + summary.activityCount + ' exercise runs • ' + global.SetTimerEngine.formatSeconds(summary.totalSeconds) + ')';
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
    const prepInput = document.getElementById('prepare-time-input');
    const betweenRestInput = document.getElementById('between-activity-rest-input');

    if (nameInput && document.activeElement !== nameInput) {
      nameInput.value = routine.name;
    }
    if (prepInput && document.activeElement !== prepInput) {
      prepInput.value = routine.prepareTime !== undefined ? routine.prepareTime : 15;
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
   * Refresh all visible node subtotal badges and connector labels in-place
   * without destroying DOM focus when the user types in an input field.
   */
  function refreshAllNodeSubtotalsInPlace() {
    const routine = getActiveRoutine();
    const container = document.getElementById('activities-list-container');
    if (!routine || !container) return;

    container.querySelectorAll('[data-subtotal-path]').forEach(function (el) {
      const p = el.getAttribute('data-subtotal-path');
      const resolved = resolveNodeByPath(routine, p);
      if (resolved && resolved.node) {
        const sec = global.SetTimerEngine.calculateNodeSubtotalSeconds(resolved.node, routine.betweenActivityRest);
        el.textContent = 'Subtotal: ' + global.SetTimerEngine.formatSeconds(sec);
      }
    });

    container.querySelectorAll('[data-next-node-name-for]').forEach(function (el) {
      const p = el.getAttribute('data-next-node-name-for');
      const resolved = resolveNodeByPath(routine, p);
      if (resolved && resolved.parentList && resolved.index + 1 < resolved.parentList.length) {
        const nextNode = resolved.parentList[resolved.index + 1];
        if (nextNode) {
          el.textContent = nextNode.name || (nextNode.type === 'group' ? 'Next Group' : 'Next Exercise');
        }
      }
    });
  }

  function escapeHtml(str) {
    return String(str !== undefined && str !== null ? str : '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /**
   * Recursively renders the 3-level Exercise & Group tree.
   * Level 1: Root (Exercises & Groups)
   * Level 2: Inside a Group (Exercises & Subgroups)
   * Level 3: Inside a Subgroup (Exercises only; max depth = 3)
   */
  function renderTreeNodesHtml(nodes, parentPath, depth, routine) {
    const list = Array.isArray(nodes) ? nodes : [];
    const total = list.length;
    const htmlParts = [];

    list.forEach(function (node, idx) {
      const isLast = (idx === total - 1);
      const pathStr = parentPath ? (parentPath + '.' + idx) : String(idx);
      const subtotalSec = global.SetTimerEngine.calculateNodeSubtotalSeconds(node, routine.betweenActivityRest);
      const betweenRestVal = node.restAfterActivity !== undefined ? node.restAfterActivity : routine.betweenActivityRest;
      const isGroup = (node.type === 'group');

      // Can this node be moved into an adjacent sibling group? (Respects 3-level limit)
      let canIndentIntoSiblingGroup = false;
      const nodeHeight = global.SetTimerStorage.getSubtreeHeight(node);
      if (idx > 0 && list[idx - 1] && list[idx - 1].type === 'group') {
        if (depth + nodeHeight <= global.SetTimerStorage.MAX_TREE_DEPTH) {
          canIndentIntoSiblingGroup = true;
        }
      }
      const canOutdentToParent = (depth > 1);

      if (isGroup) {
        const isSubgroup = (depth >= 2);
        const canAddNestedGroup = (depth < global.SetTimerStorage.MAX_TREE_DEPTH - 1); // Only Level 1 Groups can add Level 2 Subgroups
        const borderTheme = isSubgroup
          ? 'bg-purple-950/25 border-purple-500/45 hover:border-purple-400/60'
          : 'bg-indigo-950/25 border-indigo-500/45 hover:border-indigo-400/60';
        const badgeTheme = isSubgroup
          ? 'bg-purple-500/20 text-purple-200 border-purple-400/40'
          : 'bg-indigo-500/20 text-indigo-200 border-indigo-400/40';
        const groupLabel = isSubgroup ? ('Subgroup #' + (idx + 1) + ' (Level ' + depth + ')') : ('Group #' + (idx + 1) + ' (Level ' + depth + ')');
        const childList = Array.isArray(node.children) ? node.children : [];

        htmlParts.push(
          '<div class="activity-card group-card border-2 rounded-2xl p-4 sm:p-5 shadow-md ' + borderTheme + '" data-node-path="' + pathStr + '" data-activity-id="' + escapeHtml(node.id) + '" draggable="false">' +
            '<div class="flex flex-wrap items-center justify-between gap-2 mb-3 pb-2.5 border-b border-slate-700/70">' +
              '<div class="flex flex-wrap items-center gap-2">' +
                '<span class="drag-handle inline-flex items-center justify-center w-8 h-8 rounded-lg bg-slate-900/90 border border-slate-700 text-slate-400 hover:text-white hover:border-slate-500" title="Drag to reorder">' +
                  '<svg class="w-4 h-4 pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 8h16M4 16h16"/></svg>' +
                '</span>' +
                '<button type="button" class="btn-toggle-collapse inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-900/80 border border-slate-700 text-slate-200 hover:text-white text-xs font-bold" data-path="' + pathStr + '" title="Collapse or expand group">' +
                  '<span>' + (node.collapsed ? '▶ Expand' : '▼ Collapse') + '</span>' +
                '</button>' +
                '<span class="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md text-xs font-bold border ' + badgeTheme + '">' +
                  '📁 ' + groupLabel +
                '</span>' +
                '<span class="text-xs text-slate-300 font-semibold" data-subtotal-path="' + pathStr + '">' +
                  'Subtotal: ' + global.SetTimerEngine.formatSeconds(subtotalSec) +
                '</span>' +
                '<span class="text-xs text-slate-400">(' + childList.length + (childList.length === 1 ? ' item' : ' items') + ')</span>' +
              '</div>' +

              '<div class="flex flex-wrap items-center gap-1.5">' +
                '<button type="button" class="btn-move-up px-2 py-1 rounded-lg bg-slate-900 border border-slate-700 text-slate-300 hover:text-white hover:bg-slate-700 text-xs disabled:opacity-35 disabled:pointer-events-none" data-path="' + pathStr + '" ' + (idx === 0 ? 'disabled' : '') + ' title="Move Up">' +
                  '↑ Up' +
                '</button>' +
                '<button type="button" class="btn-move-down px-2 py-1 rounded-lg bg-slate-900 border border-slate-700 text-slate-300 hover:text-white hover:bg-slate-700 text-xs disabled:opacity-35 disabled:pointer-events-none" data-path="' + pathStr + '" ' + (isLast ? 'disabled' : '') + ' title="Move Down">' +
                  '↓ Down' +
                '</button>' +
                (canIndentIntoSiblingGroup
                  ? '<button type="button" class="btn-indent-node px-2 py-1 rounded-lg bg-slate-900 border border-indigo-500/40 text-indigo-200 hover:bg-indigo-900/50 text-xs" data-path="' + pathStr + '" title="Move into preceding Group">↳ Into Group</button>'
                  : '') +
                (canOutdentToParent
                  ? '<button type="button" class="btn-outdent-node px-2 py-1 rounded-lg bg-slate-900 border border-amber-500/40 text-amber-200 hover:bg-amber-900/50 text-xs" data-path="' + pathStr + '" title="Move out to parent level">↰ Out of Group</button>'
                  : '') +
                '<button type="button" class="btn-duplicate-activity px-2.5 py-1 rounded-lg bg-slate-900 border border-slate-700 text-slate-300 hover:text-emerald-300 hover:border-emerald-500/40 text-xs" data-path="' + pathStr + '" title="Duplicate Group">' +
                  'Duplicate' +
                '</button>' +
                '<button type="button" class="btn-remove-activity px-2.5 py-1 rounded-lg bg-red-950/60 border border-red-500/30 text-red-300 hover:bg-red-900/70 hover:text-white text-xs" data-path="' + pathStr + '" title="Remove Group">' +
                  'Remove' +
                '</button>' +
              '</div>' +
            '</div>' +

            '<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-12 gap-3 items-end">' +
              '<div class="lg:col-span-6">' +
                '<label class="block text-xs font-semibold uppercase tracking-wider text-indigo-200 mb-1">Group / Branch Name</label>' +
                '<input type="text" class="field-input input-activity-name" data-path="' + pathStr + '" placeholder="e.g., Group A — Core Circuit" value="' + escapeHtml(node.name) + '" />' +
              '</div>' +
              '<div class="lg:col-span-3">' +
                '<label class="block text-xs font-semibold uppercase tracking-wider text-indigo-300 mb-1">Group Repeats / Sets</label>' +
                '<input type="number" min="1" max="99" class="field-input input-activity-sets" data-path="' + pathStr + '" value="' + escapeHtml(node.sets) + '" />' +
              '</div>' +
              '<div class="lg:col-span-3">' +
                '<label class="block text-xs font-semibold uppercase tracking-wider text-yellow-300 mb-1">Rest Between Group Repeats (sec)</label>' +
                '<input type="number" min="0" max="3600" class="field-input input-activity-rest" data-path="' + pathStr + '" value="' + escapeHtml(node.restBetweenSets) + '" />' +
              '</div>' +
            '</div>' +

            (node.collapsed
              ? '<div class="mt-3 pt-2.5 border-t border-slate-700/50 text-xs text-slate-400 flex items-center justify-between">' +
                  '<span>Group collapsed (' + childList.length + ' nested item' + (childList.length === 1 ? '' : 's') + ' hidden)</span>' +
                  '<button type="button" class="btn-toggle-collapse text-indigo-300 hover:underline font-semibold" data-path="' + pathStr + '">Show Items ▼</button>' +
                '</div>'
              : '<div class="mt-4 pl-3 sm:pl-5 border-l-2 ' + (isSubgroup ? 'border-purple-500/50' : 'border-indigo-500/50') + ' space-y-3">' +
                  (childList.length > 0
                    ? renderTreeNodesHtml(childList, pathStr, depth + 1, routine)
                    : '<div class="p-3 rounded-xl bg-slate-900/60 border border-dashed border-slate-700 text-xs text-slate-400 text-center">No exercises in this group yet. Add an exercise below.</div>') +
                  '<div class="pt-2 flex flex-wrap items-center gap-2">' +
                    '<button type="button" class="btn-add-child-exercise inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/40 text-emerald-300 text-xs font-bold transition" data-path="' + pathStr + '">' +
                      '+ Add Exercise to ' + escapeHtml(node.name || 'Group') +
                    '</button>' +
                    (canAddNestedGroup
                      ? '<button type="button" class="btn-add-child-group inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-purple-500/20 hover:bg-purple-500/30 border border-purple-500/40 text-purple-200 text-xs font-bold transition" data-path="' + pathStr + '">' +
                          '📁 + Add Subgroup (Level ' + (depth + 1) + ')' +
                        '</button>'
                      : '') +
                  '</div>' +
                '</div>'
            ) +
          '</div>'
        );
      } else {
        // Exercise Leaf Card (Matches user screenshot layout)
        htmlParts.push(
          '<div class="activity-card bg-slate-800/90 border border-slate-700/80 rounded-xl p-4 shadow-sm hover:border-slate-600" data-node-path="' + pathStr + '" data-activity-id="' + escapeHtml(node.id) + '" draggable="false">' +
            '<div class="flex flex-wrap items-center justify-between gap-2 mb-3 pb-2.5 border-b border-slate-700/60">' +
              '<div class="flex items-center gap-2.5">' +
                '<span class="drag-handle inline-flex items-center justify-center w-8 h-8 rounded-lg bg-slate-900/90 border border-slate-700 text-slate-400 hover:text-white hover:border-slate-500" title="Drag to reorder exercise">' +
                  '<svg class="w-4 h-4 pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 8h16M4 16h16"/></svg>' +
                '</span>' +
                '<span class="inline-flex items-center justify-center px-2.5 py-0.5 rounded-md text-xs font-bold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">' +
                  'Exercise #' + (idx + 1) + (depth > 1 ? ' (L' + depth + ')' : '') +
                '</span>' +
                '<span class="text-xs text-slate-400 font-medium" data-subtotal-path="' + pathStr + '">' +
                  'Subtotal: ' + global.SetTimerEngine.formatSeconds(subtotalSec) +
                '</span>' +
              '</div>' +
              '<div class="flex flex-wrap items-center gap-1.5">' +
                '<button type="button" class="btn-move-up px-2 py-1 rounded-lg bg-slate-900 border border-slate-700 text-slate-300 hover:text-white hover:bg-slate-700 text-xs disabled:opacity-35 disabled:pointer-events-none" data-path="' + pathStr + '" ' + (idx === 0 ? 'disabled' : '') + ' title="Move Up">' +
                  '↑ Up' +
                '</button>' +
                '<button type="button" class="btn-move-down px-2 py-1 rounded-lg bg-slate-900 border border-slate-700 text-slate-300 hover:text-white hover:bg-slate-700 text-xs disabled:opacity-35 disabled:pointer-events-none" data-path="' + pathStr + '" ' + (isLast ? 'disabled' : '') + ' title="Move Down">' +
                  '↓ Down' +
                '</button>' +
                (canIndentIntoSiblingGroup
                  ? '<button type="button" class="btn-indent-node px-2 py-1 rounded-lg bg-slate-900 border border-indigo-500/40 text-indigo-200 hover:bg-indigo-900/50 text-xs" data-path="' + pathStr + '" title="Move into preceding Group">↳ Into Group</button>'
                  : '') +
                (canOutdentToParent
                  ? '<button type="button" class="btn-outdent-node px-2 py-1 rounded-lg bg-slate-900 border border-amber-500/40 text-amber-200 hover:bg-amber-900/50 text-xs" data-path="' + pathStr + '" title="Move out to parent level">↰ Out of Group</button>'
                  : '') +
                '<button type="button" class="btn-duplicate-activity px-2.5 py-1 rounded-lg bg-slate-900 border border-slate-700 text-slate-300 hover:text-emerald-300 hover:border-emerald-500/40 text-xs" data-path="' + pathStr + '" title="Duplicate Activity">' +
                  'Duplicate' +
                '</button>' +
                '<button type="button" class="btn-remove-activity px-2.5 py-1 rounded-lg bg-red-950/60 border border-red-500/30 text-red-300 hover:bg-red-900/70 hover:text-white text-xs" data-path="' + pathStr + '" title="Remove Activity">' +
                  'Remove' +
                '</button>' +
              '</div>' +
            '</div>' +

            '<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-12 gap-3 items-end">' +
              '<div class="lg:col-span-5">' +
                '<label class="block text-xs font-semibold uppercase tracking-wider text-slate-300 mb-1">Activity Name</label>' +
                '<input type="text" class="field-input input-activity-name" data-path="' + pathStr + '" placeholder="e.g., Push-Ups, Crunches, Plank" value="' + escapeHtml(node.name) + '" />' +
              '</div>' +
              '<div class="lg:col-span-2">' +
                '<label class="block text-xs font-semibold uppercase tracking-wider text-emerald-300 mb-1">Number of Sets</label>' +
                '<input type="number" min="1" max="99" class="field-input input-activity-sets" data-path="' + pathStr + '" value="' + escapeHtml(node.sets) + '" />' +
              '</div>' +
              '<div class="lg:col-span-2">' +
                '<label class="block text-xs font-semibold uppercase tracking-wider text-emerald-300 mb-1">Time per Set (sec)</label>' +
                '<input type="number" min="1" max="3600" class="field-input input-activity-time" data-path="' + pathStr + '" value="' + escapeHtml(node.timePerSet) + '" />' +
              '</div>' +
              '<div class="lg:col-span-3">' +
                '<label class="block text-xs font-semibold uppercase tracking-wider text-amber-300 mb-1">Rest Between Sets (sec)</label>' +
                '<input type="number" min="0" max="3600" class="field-input input-activity-rest" data-path="' + pathStr + '" value="' + escapeHtml(node.restBetweenSets) + '" />' +
              '</div>' +
            '</div>' +
          '</div>'
        );
      }

      // Connector bar between sibling items (Exercises or Groups)
      if (!isLast) {
        const nextNode = list[idx + 1];
        const connectorLabel = isGroup ? 'Rest after Group' : 'Rest in between Activities';
        htmlParts.push(
          '<div class="my-2 px-4 py-2 rounded-lg bg-yellow-500/10 border border-yellow-400/30 flex flex-wrap items-center justify-between gap-2 text-xs">' +
            '<div class="flex items-center gap-2 text-yellow-200 font-medium">' +
              '<span class="inline-block w-2.5 h-2.5 rounded-full bg-yellow-400"></span>' +
              '<span>' + connectorLabel + ' (before <strong data-next-node-name-for="' + pathStr + '">' + escapeHtml(nextNode ? nextNode.name : 'Next Item') + '</strong>):</span>' +
            '</div>' +
            '<div class="flex items-center gap-2">' +
              '<input type="number" min="0" max="3600" class="w-24 bg-slate-900 border border-yellow-400/40 rounded-md px-2.5 py-1 text-yellow-100 font-semibold text-right input-between-activity-rest-item" data-path="' + pathStr + '" value="' + escapeHtml(betweenRestVal) + '" />' +
              '<span class="text-yellow-200/80">sec (Yellow Screen)</span>' +
            '</div>' +
          '</div>'
        );
      }
    });

    return htmlParts.join('');
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

    container.innerHTML = renderTreeNodesHtml(routine.activities, '', 1, routine);

    // Attach input listeners for Exercise and Group fields
    container.querySelectorAll('.input-activity-name').forEach(function (input) {
      input.addEventListener('input', function (e) {
        const currentRoutine = getActiveRoutine();
        const pathStr = e.target.getAttribute('data-path');
        const resolved = resolveNodeByPath(currentRoutine, pathStr);
        if (resolved && resolved.node) {
          resolved.node.name = e.target.value;
          refreshAllNodeSubtotalsInPlace();
          persistAll(false);
        }
      });
      input.addEventListener('blur', function (e) {
        const currentRoutine = getActiveRoutine();
        const pathStr = e.target.getAttribute('data-path');
        const resolved = resolveNodeByPath(currentRoutine, pathStr);
        if (resolved && resolved.node) {
          const fallback = resolved.node.type === 'group' ? ('Group ' + (resolved.index + 1)) : ('Exercise ' + (resolved.index + 1));
          const trimmed = String(e.target.value || '').trim() || fallback;
          resolved.node.name = trimmed;
          e.target.value = trimmed;
          refreshAllNodeSubtotalsInPlace();
          persistAll(false);
        }
      });
    });

    container.querySelectorAll('.input-activity-sets').forEach(function (input) {
      input.addEventListener('input', function (e) {
        const currentRoutine = getActiveRoutine();
        const pathStr = e.target.getAttribute('data-path');
        const resolved = resolveNodeByPath(currentRoutine, pathStr);
        const parsed = parseInt(e.target.value, 10);
        if (resolved && resolved.node && !isNaN(parsed) && parsed >= 1) {
          resolved.node.sets = parsed;
          refreshAllNodeSubtotalsInPlace();
          persistAll(false);
        }
      });
      input.addEventListener('blur', function (e) {
        const currentRoutine = getActiveRoutine();
        const pathStr = e.target.getAttribute('data-path');
        const resolved = resolveNodeByPath(currentRoutine, pathStr);
        if (resolved && resolved.node) {
          const parsed = parseInt(e.target.value, 10);
          const safeVal = (!isNaN(parsed) && parsed >= 1) ? parsed : (resolved.node.sets || 1);
          resolved.node.sets = safeVal;
          e.target.value = String(safeVal);
          refreshAllNodeSubtotalsInPlace();
          persistAll(false);
        }
      });
    });

    container.querySelectorAll('.input-activity-time').forEach(function (input) {
      input.addEventListener('input', function (e) {
        const currentRoutine = getActiveRoutine();
        const pathStr = e.target.getAttribute('data-path');
        const resolved = resolveNodeByPath(currentRoutine, pathStr);
        const parsed = parseInt(e.target.value, 10);
        if (resolved && resolved.node && !isNaN(parsed) && parsed >= 1) {
          resolved.node.timePerSet = parsed;
          refreshAllNodeSubtotalsInPlace();
          persistAll(false);
        }
      });
      input.addEventListener('blur', function (e) {
        const currentRoutine = getActiveRoutine();
        const pathStr = e.target.getAttribute('data-path');
        const resolved = resolveNodeByPath(currentRoutine, pathStr);
        if (resolved && resolved.node) {
          const parsed = parseInt(e.target.value, 10);
          const safeVal = (!isNaN(parsed) && parsed >= 1) ? parsed : (resolved.node.timePerSet || 30);
          resolved.node.timePerSet = safeVal;
          e.target.value = String(safeVal);
          refreshAllNodeSubtotalsInPlace();
          persistAll(false);
        }
      });
    });

    container.querySelectorAll('.input-activity-rest').forEach(function (input) {
      input.addEventListener('input', function (e) {
        const currentRoutine = getActiveRoutine();
        const pathStr = e.target.getAttribute('data-path');
        const resolved = resolveNodeByPath(currentRoutine, pathStr);
        const parsed = parseInt(e.target.value, 10);
        if (resolved && resolved.node && !isNaN(parsed) && parsed >= 0) {
          resolved.node.restBetweenSets = parsed;
          refreshAllNodeSubtotalsInPlace();
          persistAll(false);
        }
      });
      input.addEventListener('blur', function (e) {
        const currentRoutine = getActiveRoutine();
        const pathStr = e.target.getAttribute('data-path');
        const resolved = resolveNodeByPath(currentRoutine, pathStr);
        if (resolved && resolved.node) {
          const parsed = parseInt(e.target.value, 10);
          const safeVal = (!isNaN(parsed) && parsed >= 0) ? parsed : (resolved.node.restBetweenSets !== undefined ? resolved.node.restBetweenSets : 15);
          resolved.node.restBetweenSets = safeVal;
          e.target.value = String(safeVal);
          refreshAllNodeSubtotalsInPlace();
          persistAll(false);
        }
      });
    });

    container.querySelectorAll('.input-between-activity-rest-item').forEach(function (input) {
      input.addEventListener('input', function (e) {
        const currentRoutine = getActiveRoutine();
        const pathStr = e.target.getAttribute('data-path');
        const resolved = resolveNodeByPath(currentRoutine, pathStr);
        const parsed = parseInt(e.target.value, 10);
        if (resolved && resolved.node && !isNaN(parsed) && parsed >= 0) {
          resolved.node.restAfterActivity = parsed;
          refreshAllNodeSubtotalsInPlace();
          persistAll(false);
        }
      });
      input.addEventListener('blur', function (e) {
        const currentRoutine = getActiveRoutine();
        const pathStr = e.target.getAttribute('data-path');
        const resolved = resolveNodeByPath(currentRoutine, pathStr);
        if (resolved && resolved.node) {
          const parsed = parseInt(e.target.value, 10);
          const safeVal = (!isNaN(parsed) && parsed >= 0)
            ? parsed
            : (resolved.node.restAfterActivity !== undefined ? resolved.node.restAfterActivity : currentRoutine.betweenActivityRest);
          resolved.node.restAfterActivity = safeVal;
          e.target.value = String(safeVal);
          refreshAllNodeSubtotalsInPlace();
          persistAll(false);
        }
      });
    });

    // Collapse / Expand Group
    container.querySelectorAll('.btn-toggle-collapse').forEach(function (btn) {
      btn.addEventListener('click', function () {
        const currentRoutine = getActiveRoutine();
        const pathStr = btn.getAttribute('data-path');
        const resolved = resolveNodeByPath(currentRoutine, pathStr);
        if (resolved && resolved.node && resolved.node.type === 'group') {
          resolved.node.collapsed = !resolved.node.collapsed;
          persistAll(false);
          renderActivitiesList();
        }
      });
    });

    // Add Child Exercise inside Group/Subgroup
    container.querySelectorAll('.btn-add-child-exercise').forEach(function (btn) {
      btn.addEventListener('click', function () {
        const currentRoutine = getActiveRoutine();
        const pathStr = btn.getAttribute('data-path');
        const resolved = resolveNodeByPath(currentRoutine, pathStr);
        if (resolved && resolved.node && resolved.node.type === 'group') {
          if (!Array.isArray(resolved.node.children)) resolved.node.children = [];
          const nextNum = resolved.node.children.length + 1;
          const newAct = global.SetTimerStorage.createBlankActivity(currentRoutine.betweenActivityRest, 'Exercise ' + nextNum);
          resolved.node.children.push(newAct);
          resolved.node.collapsed = false;
          persistAll(true, 'Added "' + newAct.name + '" to "' + resolved.node.name + '".');
          renderActivitiesList();
        }
      });
    });

    // Add Child Subgroup inside Level 1 Group
    container.querySelectorAll('.btn-add-child-group').forEach(function (btn) {
      btn.addEventListener('click', function () {
        const currentRoutine = getActiveRoutine();
        const pathStr = btn.getAttribute('data-path');
        const resolved = resolveNodeByPath(currentRoutine, pathStr);
        if (resolved && resolved.node && resolved.node.type === 'group') {
          if (resolved.depth >= global.SetTimerStorage.MAX_TREE_DEPTH - 1) {
            showToast('Maximum nesting depth (3 levels) reached.', true);
            return;
          }
          if (!Array.isArray(resolved.node.children)) resolved.node.children = [];
          const subCount = resolved.node.children.filter(function (c) { return c.type === 'group'; }).length + 1;
          const newSub = global.SetTimerStorage.createBlankGroup(currentRoutine.betweenActivityRest, resolved.depth + 1, 'Subgroup ' + subCount);
          resolved.node.children.push(newSub);
          resolved.node.collapsed = false;
          persistAll(true, 'Added "' + newSub.name + '" inside "' + resolved.node.name + '".');
          renderActivitiesList();
        }
      });
    });

    // Move Up / Down within same parent
    container.querySelectorAll('.btn-move-up').forEach(function (btn) {
      btn.addEventListener('click', function () {
        const pathStr = btn.getAttribute('data-path');
        const parts = String(pathStr).split('.');
        const idx = parseInt(parts.pop(), 10);
        const parentPath = parts.join('.');
        if (idx > 0) {
          reorderTreeNodes(parentPath, idx, idx - 1);
        }
      });
    });

    container.querySelectorAll('.btn-move-down').forEach(function (btn) {
      btn.addEventListener('click', function () {
        const currentRoutine = getActiveRoutine();
        const pathStr = btn.getAttribute('data-path');
        const parts = String(pathStr).split('.');
        const idx = parseInt(parts.pop(), 10);
        const parentPath = parts.join('.');
        const siblingList = getSiblingListByParentPath(currentRoutine, parentPath);
        if (siblingList && idx < siblingList.length - 1) {
          reorderTreeNodes(parentPath, idx, idx + 1);
        }
      });
    });

    // Move into preceding Group (Indent)
    container.querySelectorAll('.btn-indent-node').forEach(function (btn) {
      btn.addEventListener('click', function () {
        const currentRoutine = getActiveRoutine();
        const pathStr = btn.getAttribute('data-path');
        const resolved = resolveNodeByPath(currentRoutine, pathStr);
        if (!resolved || !resolved.parentList || resolved.index <= 0) return;
        const prevSibling = resolved.parentList[resolved.index - 1];
        if (!prevSibling || prevSibling.type !== 'group') return;
        const nodeHeight = global.SetTimerStorage.getSubtreeHeight(resolved.node);
        if (resolved.depth + nodeHeight > global.SetTimerStorage.MAX_TREE_DEPTH) {
          showToast('Cannot move deeper than 3 tree levels.', true);
          return;
        }
        const moved = resolved.parentList.splice(resolved.index, 1)[0];
        if (!Array.isArray(prevSibling.children)) prevSibling.children = [];
        prevSibling.children.push(moved);
        prevSibling.collapsed = false;
        persistAll(true, 'Moved "' + moved.name + '" into "' + prevSibling.name + '".');
        renderActivitiesList();
      });
    });

    // Move out of Group to parent level (Outdent)
    container.querySelectorAll('.btn-outdent-node').forEach(function (btn) {
      btn.addEventListener('click', function () {
        const currentRoutine = getActiveRoutine();
        const pathStr = btn.getAttribute('data-path');
        const parts = String(pathStr).split('.');
        if (parts.length < 2) return;
        const childIdx = parseInt(parts.pop(), 10);
        const parentPath = parts.join('.');
        const parentResolved = resolveNodeByPath(currentRoutine, parentPath);
        if (!parentResolved || !parentResolved.node || !parentResolved.parentList) return;
        const moved = parentResolved.node.children.splice(childIdx, 1)[0];
        parentResolved.parentList.splice(parentResolved.index + 1, 0, moved);
        persistAll(true, 'Moved "' + moved.name + '" out of "' + parentResolved.node.name + '".');
        renderActivitiesList();
      });
    });

    // Duplicate Exercise or Group (deep clone)
    container.querySelectorAll('.btn-duplicate-activity').forEach(function (btn) {
      btn.addEventListener('click', function () {
        const currentRoutine = getActiveRoutine();
        if (!currentRoutine) return;
        const pathStr = btn.getAttribute('data-path');
        const resolved = resolveNodeByPath(currentRoutine, pathStr);
        if (!resolved || !resolved.node || !resolved.parentList) return;
        const copy = global.SetTimerStorage.cloneTreeNode(resolved.node, currentRoutine.betweenActivityRest, resolved.depth);
        copy.name = resolved.node.name + ' (Copy)';
        resolved.parentList.splice(resolved.index + 1, 0, copy);
        persistAll(true, 'Duplicated "' + resolved.node.name + '".');
        renderActivitiesList();
      });
    });

    // Remove Exercise or Group
    container.querySelectorAll('.btn-remove-activity').forEach(function (btn) {
      btn.addEventListener('click', function () {
        const currentRoutine = getActiveRoutine();
        if (!currentRoutine) return;
        const pathStr = btn.getAttribute('data-path');
        const resolved = resolveNodeByPath(currentRoutine, pathStr);
        if (!resolved || !resolved.parentList) return;
        const removed = resolved.parentList.splice(resolved.index, 1)[0];
        persistAll(true, 'Removed "' + (removed ? removed.name : '') + '".');
        renderActivitiesList();
      });
    });

    global.SetTimerDragDrop.attachDragAndDrop(container, reorderTreeNodes);
    renderRoutineSummaryBar();
  }

  function reorderTreeNodes(parentPath, fromIndex, toIndex) {
    const routine = getActiveRoutine();
    const list = getSiblingListByParentPath(routine, parentPath);
    if (!list || !Array.isArray(list)) return;
    if (fromIndex < 0 || fromIndex >= list.length) return;
    const clampedTo = Math.max(0, Math.min(list.length - 1, toIndex));
    if (fromIndex === clampedTo) return;

    const moved = list.splice(fromIndex, 1)[0];
    list.splice(clampedTo, 0, moved);
    persistAll(true, 'Updated order.');
    renderActivitiesList();
  }

  function renderAllEditMode() {
    renderRoutineSelector();
    renderRoutineHeader();
    renderActivitiesList();
    renderRoutineSummaryBar();
  }

  /* ==========================================================================
     Run Mode UI & State Screen Coloring (Includes Bright Blue Prepare State)
     ========================================================================== */
  function applyRunScreenStateClasses(runSectionEl, snapshot) {
    if (!runSectionEl || !snapshot) return;

    runSectionEl.classList.remove(
      'run-state-prepare',
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
    } else if (snapshot.phase === global.SetTimerEngine.PHASE_PREPARE) {
      runSectionEl.classList.add('run-state-prepare');
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
    const treeBreadcrumbEl = document.getElementById('run-tree-breadcrumb');
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
      if (treeBreadcrumbEl) treeBreadcrumbEl.classList.add('hidden');
      if (phaseBadgeEl) phaseBadgeEl.textContent = 'ROUTINE COMPLETE';
      if (mainHeadingEl) mainHeadingEl.textContent = 'END';
      if (subHeadingEl) {
        subHeadingEl.textContent = routine
          ? ('Completed all intervals in "' + routine.name + '"!')
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

    if (treeBreadcrumbEl) {
      if (step.breadcrumb) {
        treeBreadcrumbEl.textContent = '📁 ' + step.breadcrumb;
        treeBreadcrumbEl.classList.remove('hidden');
      } else {
        treeBreadcrumbEl.classList.add('hidden');
      }
    }

    if (countdownEl) {
      countdownEl.textContent = snapshot.remainingFormatted;
    }

    if (progressBarEl) {
      progressBarEl.style.width = snapshot.progressPercent.toFixed(1) + '%';
    }

    if (stepCounterEl) {
      stepCounterEl.textContent =
        'Interval ' + (snapshot.stepIndex + 1) + ' of ' + snapshot.totalSteps +
        ' • Exercise Run ' + step.activityIndex + ' of ' + step.totalActivities;
    }

    if (step.phase === global.SetTimerEngine.PHASE_PREPARE) {
      if (phaseBadgeEl) {
        phaseBadgeEl.textContent = snapshot.isPaused ? 'PREPARE TIME (PAUSED)' : 'GET READY — PREPARE TIME';
      }
      if (mainHeadingEl) {
        mainHeadingEl.textContent = 'PREPARE';
      }
      if (subHeadingEl) {
        subHeadingEl.textContent = 'First Exercise: ' + (step.upNextName || 'Workout');
      }
      if (upNextCardEl && upNextTextEl) {
        upNextCardEl.classList.remove('hidden');
        upNextTextEl.textContent = 'Up First: ' + (step.upNextHint || step.upNextName || '');
      }
    } else if (step.phase === global.SetTimerEngine.PHASE_ACTIVITY) {
      if (phaseBadgeEl) {
        phaseBadgeEl.textContent = snapshot.isPaused ? 'ACTIVITY (PAUSED)' : 'WORK — ACTIVE SET';
      }
      if (mainHeadingEl) {
        mainHeadingEl.textContent = step.activityName;
      }
      if (subHeadingEl) {
        subHeadingEl.textContent = 'Set ' + step.currentSet + ' of ' + step.totalSets +
          (step.breadcrumb ? (' • ' + step.breadcrumb) : '');
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
        if (step.transitionType === 'GROUP_REPEAT_REST') {
          phaseBadgeEl.textContent = snapshot.isPaused ? 'GROUP REPEAT REST (PAUSED)' : 'REST BETWEEN GROUP REPEATS';
        } else {
          phaseBadgeEl.textContent = snapshot.isPaused ? 'BETWEEN ACTIVITIES (PAUSED)' : 'REST BETWEEN ACTIVITIES';
        }
      }
      if (mainHeadingEl) {
        mainHeadingEl.textContent = 'UP NEXT: ' + step.upNextName;
      }
      if (subHeadingEl) {
        subHeadingEl.textContent = (step.activityName || 'Get Ready') + ' • ' + (step.upNextDetails || '');
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

    const prepInput = document.getElementById('prepare-time-input');
    if (prepInput) {
      const parsedPrep = parseInt(prepInput.value, 10);
      if (!isNaN(parsedPrep) && parsedPrep >= 0) {
        routine.prepareTime = parsedPrep;
      }
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
      container.querySelectorAll('.input-activity-name[data-path]').forEach(function (el) {
        const resolved = resolveNodeByPath(routine, el.getAttribute('data-path'));
        if (resolved && resolved.node) {
          resolved.node.name = String(el.value || '').trim() || (resolved.node.type === 'group' ? 'Group' : 'Exercise');
        }
      });
      container.querySelectorAll('.input-activity-sets[data-path]').forEach(function (el) {
        const resolved = resolveNodeByPath(routine, el.getAttribute('data-path'));
        if (resolved && resolved.node) {
          resolved.node.sets = Math.max(1, parseInt(el.value, 10) || 1);
        }
      });
      container.querySelectorAll('.input-activity-time[data-path]').forEach(function (el) {
        const resolved = resolveNodeByPath(routine, el.getAttribute('data-path'));
        if (resolved && resolved.node && resolved.node.type !== 'group') {
          resolved.node.timePerSet = Math.max(1, parseInt(el.value, 10) || 1);
        }
      });
      container.querySelectorAll('.input-activity-rest[data-path]').forEach(function (el) {
        const resolved = resolveNodeByPath(routine, el.getAttribute('data-path'));
        if (resolved && resolved.node) {
          const r = parseInt(el.value, 10);
          resolved.node.restBetweenSets = (!isNaN(r) && r >= 0) ? r : 0;
        }
      });
      container.querySelectorAll('.input-between-activity-rest-item[data-path]').forEach(function (el) {
        const resolved = resolveNodeByPath(routine, el.getAttribute('data-path'));
        if (resolved && resolved.node) {
          const r = parseInt(el.value, 10);
          resolved.node.restAfterActivity = (!isNaN(r) && r >= 0) ? r : routine.betweenActivityRest;
        }
      });
    }
  }

  function startRoutineRun() {
    syncInputsToStateBeforeRun();
    const routine = getActiveRoutine();
    const runs = global.SetTimerEngine.expandRoutineTreeToRuns(routine);
    if (!routine || runs.length === 0) {
      showToast('Please add at least one Exercise before starting the timer.', true);
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
        applyVolumeChange(e.target.value, true);
      });
      editVolumeSlider.addEventListener('change', function (e) {
        lastPreviewTimestamp = 0;
        applyVolumeChange(e.target.value, true);
      });
    }

    const runVolumeSlider = document.getElementById('run-volume-slider');
    if (runVolumeSlider) {
      runVolumeSlider.addEventListener('input', function (e) {
        applyVolumeChange(e.target.value, true);
      });
      runVolumeSlider.addEventListener('change', function (e) {
        lastPreviewTimestamp = 0;
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

    const prepareTimeInput = document.getElementById('prepare-time-input');
    if (prepareTimeInput) {
      prepareTimeInput.addEventListener('input', function (e) {
        const routine = getActiveRoutine();
        if (!routine) return;
        const raw = parseInt(e.target.value, 10);
        if (isNaN(raw) || raw < 0) return;
        routine.prepareTime = raw;
        persistAll(false);
      });
      prepareTimeInput.addEventListener('blur', function (e) {
        const routine = getActiveRoutine();
        if (!routine) return;
        const raw = parseInt(e.target.value, 10);
        const safeVal = (!isNaN(raw) && raw >= 0) ? raw : (routine.prepareTime !== undefined ? routine.prepareTime : 15);
        routine.prepareTime = safeVal;
        e.target.value = String(safeVal);
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

        function updateAllRests(nodes) {
          (nodes || []).forEach(function (n) {
            n.restAfterActivity = raw;
            if (n.type === 'group' && Array.isArray(n.children)) {
              updateAllRests(n.children);
            }
          });
        }
        updateAllRests(routine.activities);

        const container = document.getElementById('activities-list-container');
        if (container) {
          container.querySelectorAll('.input-between-activity-rest-item').forEach(function (el) {
            if (document.activeElement !== el) {
              el.value = String(raw);
            }
          });
        }
        refreshAllNodeSubtotalsInPlace();
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
        const newAct = global.SetTimerStorage.createBlankActivity(routine.betweenActivityRest, 'Exercise ' + nextNum);
        routine.activities.push(newAct);
        persistAll(true, 'Added "' + newAct.name + '".');
        renderActivitiesList();
      });
    }

    const btnAddGroup = document.getElementById('btn-add-group');
    if (btnAddGroup) {
      btnAddGroup.addEventListener('click', function () {
        const routine = getActiveRoutine();
        if (!routine) return;
        const groupCount = routine.activities.filter(function (a) { return a.type === 'group'; }).length + 1;
        const letter = String.fromCharCode(64 + Math.min(26, groupCount));
        const newGrp = global.SetTimerStorage.createBlankGroup(routine.betweenActivityRest, 1, 'Group ' + letter);
        routine.activities.push(newGrp);
        persistAll(true, 'Added "' + newGrp.name + '".');
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
