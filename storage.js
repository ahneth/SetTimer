/* ==========================================================================
   SetTimer - Local Storage & Tree Model Module (storage.js)
   Handles saving, auto-loading, creating, and sanitizing hierarchical routines
   (up to 3 levels: Group -> Subgroup -> Exercise) & Prepare Time in localStorage
   ========================================================================== */

(function (global) {
  'use strict';

  const ROUTINES_STORAGE_KEY = 'settimer_routines_v1';
  const ACTIVE_ROUTINE_KEY = 'settimer_active_routine_id_v1';
  const VOLUME_STORAGE_KEY = 'settimer_volume_v1';
  const MAX_TREE_DEPTH = 3; // Level 1 (Root), Level 2 (Child of Group), Level 3 (Child of Subgroup)

  function generateId(prefix) {
    return (prefix || 'id') + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 7);
  }

  function createDefaultRoutines() {
    const defaultRoutineId = 'routine_default_hiit';
    const strengthRoutineId = 'routine_default_strength';
    return [
      {
        id: defaultRoutineId,
        name: 'Full Body HIIT Circuit (Tree Demo)',
        prepareTime: 15,
        betweenActivityRest: 20,
        updatedAt: new Date().toISOString(),
        activities: [
          {
            id: generateId('grp'),
            type: 'group',
            name: 'Group A — Upper Body & Core',
            sets: 2,
            restBetweenSets: 20,
            restAfterActivity: 25,
            collapsed: false,
            children: [
              {
                id: generateId('act'),
                type: 'exercise',
                name: 'Push-Ups',
                sets: 2,
                timePerSet: 30,
                restBetweenSets: 10,
                restAfterActivity: 15
              },
              {
                id: generateId('act'),
                type: 'exercise',
                name: 'Crunches',
                sets: 2,
                timePerSet: 25,
                restBetweenSets: 10,
                restAfterActivity: 15
              }
            ]
          },
          {
            id: generateId('grp'),
            type: 'group',
            name: 'Group B — Lower Body & Finisher',
            sets: 2,
            restBetweenSets: 20,
            restAfterActivity: 20,
            collapsed: false,
            children: [
              {
                id: generateId('act'),
                type: 'exercise',
                name: 'Bodyweight Squats',
                sets: 2,
                timePerSet: 35,
                restBetweenSets: 15,
                restAfterActivity: 15
              },
              {
                id: generateId('subgrp'),
                type: 'group',
                name: 'Subgroup B1 — Core Burnout',
                sets: 2,
                restBetweenSets: 10,
                restAfterActivity: 15,
                collapsed: false,
                children: [
                  {
                    id: generateId('act'),
                    type: 'exercise',
                    name: 'Forearm Plank',
                    sets: 1,
                    timePerSet: 30,
                    restBetweenSets: 0,
                    restAfterActivity: 10
                  },
                  {
                    id: generateId('act'),
                    type: 'exercise',
                    name: 'Mountain Climbers',
                    sets: 1,
                    timePerSet: 20,
                    restBetweenSets: 0,
                    restAfterActivity: 10
                  }
                ]
              }
            ]
          }
        ]
      },
      {
        id: strengthRoutineId,
        name: 'Quick Morning Express (Test Timer)',
        prepareTime: 5,
        betweenActivityRest: 5,
        updatedAt: new Date().toISOString(),
        activities: [
          {
            id: generateId('act'),
            type: 'exercise',
            name: 'Jumping Jacks',
            sets: 2,
            timePerSet: 5,
            restBetweenSets: 3,
            restAfterActivity: 5
          },
          {
            id: generateId('act'),
            type: 'exercise',
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

  function sanitizeActivity(node, fallbackBetweenRest, depth) {
    const currentDepth = typeof depth === 'number' && depth >= 1 ? depth : 1;
    const defaultBetween = Math.max(0, parseInt(fallbackBetweenRest !== undefined ? fallbackBetweenRest : 20, 10));
    const safeDefaultBetween = isNaN(defaultBetween) ? 20 : defaultBetween;

    if (!node || typeof node !== 'object') {
      return {
        id: generateId('act'),
        type: 'exercise',
        name: 'Exercise',
        sets: 3,
        timePerSet: 30,
        restBetweenSets: 15,
        restAfterActivity: safeDefaultBetween
      };
    }

    const isGroupNode = (node.type === 'group' || (node.type === undefined && Array.isArray(node.children))) && currentDepth < MAX_TREE_DEPTH;
    const sets = Math.max(1, parseInt(node.sets !== undefined ? node.sets : (node.repeats !== undefined ? node.repeats : (isGroupNode ? 2 : 3)), 10) || 1);
    const restBetweenSetsRaw = node.restBetweenSets !== undefined ? node.restBetweenSets : (node.restBetweenRepeats !== undefined ? node.restBetweenRepeats : 15);
    const restBetweenSets = Math.max(0, parseInt(restBetweenSetsRaw, 10));
    const restAfterRaw = node.restAfterActivity !== undefined && node.restAfterActivity !== null && node.restAfterActivity !== ''
      ? node.restAfterActivity
      : safeDefaultBetween;
    const restAfterActivity = Math.max(0, parseInt(restAfterRaw, 10));

    if (isGroupNode) {
      const rawChildren = Array.isArray(node.children) ? node.children : [];
      return {
        id: node.id || generateId('grp'),
        type: 'group',
        name: String(node.name !== undefined ? node.name : (currentDepth === 1 ? 'Exercise Group' : 'Subgroup')).trim() || 'Exercise Group',
        sets: sets,
        restBetweenSets: isNaN(restBetweenSets) ? 15 : restBetweenSets,
        restAfterActivity: isNaN(restAfterActivity) ? safeDefaultBetween : restAfterActivity,
        collapsed: !!node.collapsed,
        children: rawChildren.map(function (child) {
          return sanitizeActivity(child, safeDefaultBetween, currentDepth + 1);
        })
      };
    }

    const timePerSet = Math.max(1, parseInt(node.timePerSet !== undefined ? node.timePerSet : 30, 10) || 30);
    return {
      id: node.id || generateId('act'),
      type: 'exercise',
      name: String(node.name !== undefined ? node.name : 'Exercise').trim() || 'Exercise',
      sets: sets,
      timePerSet: timePerSet,
      restBetweenSets: isNaN(restBetweenSets) ? 15 : restBetweenSets,
      restAfterActivity: isNaN(restAfterActivity) ? safeDefaultBetween : restAfterActivity
    };
  }

  function sanitizeRoutine(routine) {
    const r = routine && typeof routine === 'object' ? routine : {};
    const betweenRest = Math.max(0, parseInt(r.betweenActivityRest !== undefined ? r.betweenActivityRest : 20, 10));
    const safeBetweenRest = isNaN(betweenRest) ? 20 : betweenRest;

    const prepRaw = r.prepareTime !== undefined && r.prepareTime !== null && r.prepareTime !== ''
      ? parseInt(r.prepareTime, 10)
      : 15;
    const safePrepareTime = isNaN(prepRaw) ? 15 : Math.max(0, prepRaw);

    const rawActivities = Array.isArray(r.activities) ? r.activities : [];

    return {
      id: r.id || generateId('routine'),
      name: String(r.name !== undefined ? r.name : 'Untitled Routine').trim() || 'Untitled Routine',
      prepareTime: safePrepareTime,
      betweenActivityRest: safeBetweenRest,
      updatedAt: r.updatedAt || new Date().toISOString(),
      activities: rawActivities.map(function (a) {
        return sanitizeActivity(a, safeBetweenRest, 1);
      })
    };
  }

  function cloneTreeNode(node, fallbackBetweenRest, depth) {
    const d = typeof depth === 'number' ? depth : 1;
    const sanitized = sanitizeActivity(node, fallbackBetweenRest, d);
    sanitized.id = generateId(sanitized.type === 'group' ? 'grp' : 'act');
    if (sanitized.type === 'group' && Array.isArray(sanitized.children)) {
      sanitized.children = sanitized.children.map(function (c) {
        return cloneTreeNode(c, fallbackBetweenRest, d + 1);
      });
    }
    return sanitized;
  }

  function getSubtreeHeight(node) {
    if (!node || node.type !== 'group' || !Array.isArray(node.children) || node.children.length === 0) {
      return 1;
    }
    let maxChild = 0;
    node.children.forEach(function (c) {
      const h = getSubtreeHeight(c);
      if (h > maxChild) maxChild = h;
    });
    return 1 + maxChild;
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
      prepareTime: 15,
      betweenActivityRest: 20,
      updatedAt: new Date().toISOString(),
      activities: [
        {
          id: generateId('act'),
          type: 'exercise',
          name: 'Activity 1',
          sets: 3,
          timePerSet: 30,
          restBetweenSets: 15,
          restAfterActivity: 20
        }
      ]
    });
  }

  function createBlankActivity(betweenActivityRest, customName) {
    const between = Math.max(0, parseInt(betweenActivityRest !== undefined ? betweenActivityRest : 20, 10)) || 0;
    return sanitizeActivity({
      id: generateId('act'),
      type: 'exercise',
      name: customName || 'New Exercise',
      sets: 3,
      timePerSet: 30,
      restBetweenSets: 15,
      restAfterActivity: between
    }, between, 1);
  }

  function createBlankGroup(betweenActivityRest, depth, customName) {
    const d = typeof depth === 'number' ? depth : 1;
    const between = Math.max(0, parseInt(betweenActivityRest !== undefined ? betweenActivityRest : 20, 10)) || 0;
    return sanitizeActivity({
      id: generateId(d === 1 ? 'grp' : 'subgrp'),
      type: 'group',
      name: customName || (d === 1 ? 'New Group' : 'New Subgroup'),
      sets: 2,
      restBetweenSets: between,
      restAfterActivity: between,
      collapsed: false,
      children: [
        createBlankActivity(between, 'Exercise 1')
      ]
    }, between, d);
  }

  global.SetTimerStorage = {
    MAX_TREE_DEPTH: MAX_TREE_DEPTH,
    generateId: generateId,
    loadRoutines: loadRoutines,
    saveRoutines: saveRoutines,
    loadActiveRoutineId: loadActiveRoutineId,
    saveActiveRoutineId: saveActiveRoutineId,
    loadVolume: loadVolume,
    saveVolume: saveVolume,
    sanitizeRoutine: sanitizeRoutine,
    sanitizeActivity: sanitizeActivity,
    cloneTreeNode: cloneTreeNode,
    getSubtreeHeight: getSubtreeHeight,
    createEmptyRoutine: createEmptyRoutine,
    createBlankActivity: createBlankActivity,
    createBlankGroup: createBlankGroup,
    createDefaultRoutines: createDefaultRoutines
  };
})(window);
