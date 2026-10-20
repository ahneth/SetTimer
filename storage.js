/* ==========================================================================
   SetTimer - Local Storage Module (storage.js)
   Handles saving, auto-loading, creating, and updating routines & volume in localStorage
   ========================================================================== */

(function (global) {
  'use strict';

  const ROUTINES_STORAGE_KEY = 'settimer_routines_v1';
  const ACTIVE_ROUTINE_KEY = 'settimer_active_routine_id_v1';
  const VOLUME_STORAGE_KEY = 'settimer_volume_v1';

  function generateId(prefix) {
    return (prefix || 'id') + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 7);
  }

  function createDefaultRoutines() {
    const defaultRoutineId = 'routine_default_hiit';
    const strengthRoutineId = 'routine_default_strength';
    return [
      {
        id: defaultRoutineId,
        name: 'Full Body HIIT Circuit',
        betweenActivityRest: 20,
        updatedAt: new Date().toISOString(),
        activities: [
          {
            id: generateId('act'),
            name: 'Push-Ups',
            sets: 3,
            timePerSet: 30,
            restBetweenSets: 15,
            restAfterActivity: 20
          },
          {
            id: generateId('act'),
            name: 'Bodyweight Squats',
            sets: 3,
            timePerSet: 40,
            restBetweenSets: 15,
            restAfterActivity: 20
          },
          {
            id: generateId('act'),
            name: 'Forearm Plank',
            sets: 2,
            timePerSet: 45,
            restBetweenSets: 15,
            restAfterActivity: 20
          }
        ]
      },
      {
        id: strengthRoutineId,
        name: 'Quick Morning Express (Test Timer)',
        betweenActivityRest: 5,
        updatedAt: new Date().toISOString(),
        activities: [
          {
            id: generateId('act'),
            name: 'Jumping Jacks',
            sets: 2,
            timePerSet: 5,
            restBetweenSets: 3,
            restAfterActivity: 5
          },
          {
            id: generateId('act'),
            name: 'High Knees',
            sets: 2,
            timePerSet: 5,
            restBetweenSets: 3,
            restAfterActivity: 5
          }
        ]
      }
    ];
  }

  function sanitizeActivity(act, fallbackBetweenRest) {
    const sets = Math.max(1, parseInt(act.sets, 10) || 1);
    const timePerSet = Math.max(1, parseInt(act.timePerSet, 10) || 30);
    const restBetweenSets = Math.max(0, parseInt(act.restBetweenSets !== undefined ? act.restBetweenSets : 15, 10));
    const defaultBetween = Math.max(0, parseInt(fallbackBetweenRest !== undefined ? fallbackBetweenRest : 20, 10));
    const restAfterActivity = act.restAfterActivity !== undefined && act.restAfterActivity !== null && act.restAfterActivity !== ''
      ? Math.max(0, parseInt(act.restAfterActivity, 10))
      : defaultBetween;

    return {
      id: act.id || generateId('act'),
      name: String(act.name !== undefined ? act.name : 'Exercise').trim() || 'Exercise',
      sets: sets,
      timePerSet: timePerSet,
      restBetweenSets: isNaN(restBetweenSets) ? 15 : restBetweenSets,
      restAfterActivity: isNaN(restAfterActivity) ? defaultBetween : restAfterActivity
    };
  }

  function sanitizeRoutine(routine) {
    const betweenRest = Math.max(0, parseInt(routine.betweenActivityRest !== undefined ? routine.betweenActivityRest : 20, 10));
    const safeBetweenRest = isNaN(betweenRest) ? 20 : betweenRest;
    const rawActivities = Array.isArray(routine.activities) ? routine.activities : [];

    return {
      id: routine.id || generateId('routine'),
      name: String(routine.name !== undefined ? routine.name : 'Untitled Routine').trim() || 'Untitled Routine',
      betweenActivityRest: safeBetweenRest,
      updatedAt: routine.updatedAt || new Date().toISOString(),
      activities: rawActivities.map(function (a) {
        return sanitizeActivity(a, safeBetweenRest);
      })
    };
  }

  function loadRoutines() {
    try {
      const raw = localStorage.getItem(ROUTINES_STORAGE_KEY);
      if (!raw) {
        const defaults = createDefaultRoutines();
        saveRoutines(defaults);
        return defaults;
      }
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed) || parsed.length === 0) {
        const defaults = createDefaultRoutines();
        saveRoutines(defaults);
        return defaults;
      }
      return parsed.map(sanitizeRoutine);
    } catch (err) {
      console.warn('SetTimer Storage: Fallback to in-memory default routines', err);
      return createDefaultRoutines();
    }
  }

  /**
   * Saves routines to localStorage WITHOUT replacing the live in-memory object
   * references so active event listeners and inputs never become detached.
   */
  function saveRoutines(routines) {
    const list = Array.isArray(routines) ? routines : [];
    const serializedPayload = list.map(sanitizeRoutine);
    try {
      localStorage.setItem(ROUTINES_STORAGE_KEY, JSON.stringify(serializedPayload));
    } catch (err) {
      console.warn('SetTimer Storage: Unable to write routines to localStorage', err);
    }
    return list;
  }

  function loadActiveRoutineId(routines) {
    const list = routines || loadRoutines();
    try {
      const savedId = localStorage.getItem(ACTIVE_ROUTINE_KEY);
      if (savedId && list.some(function (r) { return r.id === savedId; })) {
        return savedId;
      }
    } catch (err) {
      // Ignore storage read errors
    }
    return list.length > 0 ? list[0].id : null;
  }

  function saveActiveRoutineId(routineId) {
    try {
      if (routineId) {
        localStorage.setItem(ACTIVE_ROUTINE_KEY, String(routineId));
      }
    } catch (err) {
      // Ignore storage write errors
    }
  }

  function loadVolume() {
    try {
      const raw = localStorage.getItem(VOLUME_STORAGE_KEY);
      if (raw === null || raw === undefined || raw === '') {
        return 80;
      }
      const parsed = parseInt(raw, 10);
      if (isNaN(parsed)) return 80;
      return Math.max(0, Math.min(100, parsed));
    } catch (err) {
      return 80;
    }
  }

  function saveVolume(volumePercent) {
    const parsed = parseInt(volumePercent, 10);
    const clamped = isNaN(parsed) ? 80 : Math.max(0, Math.min(100, parsed));
    try {
      localStorage.setItem(VOLUME_STORAGE_KEY, String(clamped));
    } catch (err) {
      // Ignore storage write errors
    }
    return clamped;
  }

  function createEmptyRoutine(name) {
    return sanitizeRoutine({
      id: generateId('routine'),
      name: name || 'New Workout Routine',
      betweenActivityRest: 20,
      updatedAt: new Date().toISOString(),
      activities: [
        {
          id: generateId('act'),
          name: 'Activity 1',
          sets: 3,
          timePerSet: 30,
          restBetweenSets: 15,
          restAfterActivity: 20
        }
      ]
    });
  }

  function createBlankActivity(betweenActivityRest) {
    const between = Math.max(0, parseInt(betweenActivityRest !== undefined ? betweenActivityRest : 20, 10)) || 0;
    return sanitizeActivity({
      id: generateId('act'),
      name: 'New Exercise',
      sets: 3,
      timePerSet: 30,
      restBetweenSets: 15,
      restAfterActivity: between
    }, between);
  }

  global.SetTimerStorage = {
    generateId: generateId,
    loadRoutines: loadRoutines,
    saveRoutines: saveRoutines,
    loadActiveRoutineId: loadActiveRoutineId,
    saveActiveRoutineId: saveActiveRoutineId,
    loadVolume: loadVolume,
    saveVolume: saveVolume,
    sanitizeRoutine: sanitizeRoutine,
    sanitizeActivity: sanitizeActivity,
    createEmptyRoutine: createEmptyRoutine,
    createBlankActivity: createBlankActivity,
    createDefaultRoutines: createDefaultRoutines
  };
})(window);
