/* ==========================================================================
   SetTimer - Excel Backup & Restore Module (excel.js)
   Exports hierarchical exercise trees & Prepare Time into an Excel (.xlsx)
   workbook and restores routines from both tree and legacy flat backups.
   ========================================================================== */

(function (global) {
  'use strict';

  function routinesToRows(routines) {
    const rows = [];

    function flattenNodes(routine, nodes, parentId, depth, pathPrefix, orderCounter) {
      (nodes || []).forEach(function (node, idx) {
        orderCounter.val += 1;
        const isGroup = node.type === 'group';
        const currentPath = pathPrefix ? (pathPrefix + ' > ' + node.name) : node.name;
        rows.push({
          'Routine ID': routine.id,
          'Routine Name': routine.name,
          'Prepare Time (s)': routine.prepareTime !== undefined ? routine.prepareTime : 15,
          'Rest Between Activities (s)': routine.betweenActivityRest,
          'Activity Order': orderCounter.val,
          'Sibling Order': idx + 1,
          'Node ID': node.id,
          'Parent Group ID': parentId || '',
          'Node Type': isGroup ? 'GROUP' : 'EXERCISE',
          'Tree Level': depth,
          'Tree Path': currentPath,
          'Activity': node.name,
          'Number of Sets': node.sets,
          'Time per Set (s)': isGroup ? 0 : node.timePerSet,
          'Rest Between Sets (s)': node.restBetweenSets,
          'Rest After Activity (s)': node.restAfterActivity !== undefined
            ? node.restAfterActivity
            : routine.betweenActivityRest
        });
        if (isGroup && Array.isArray(node.children) && node.children.length > 0) {
          flattenNodes(routine, node.children, node.id, depth + 1, currentPath, orderCounter);
        }
      });
    }

    (routines || []).forEach(function (routine) {
      const activities = Array.isArray(routine.activities) ? routine.activities : [];
      if (activities.length === 0) {
        rows.push({
          'Routine ID': routine.id,
          'Routine Name': routine.name,
          'Prepare Time (s)': routine.prepareTime !== undefined ? routine.prepareTime : 15,
          'Rest Between Activities (s)': routine.betweenActivityRest,
          'Activity Order': 1,
          'Sibling Order': 1,
          'Node ID': global.SetTimerStorage.generateId('act'),
          'Parent Group ID': '',
          'Node Type': 'EXERCISE',
          'Tree Level': 1,
          'Tree Path': 'Activity 1',
          'Activity': 'Activity 1',
          'Number of Sets': 3,
          'Time per Set (s)': 30,
          'Rest Between Sets (s)': 15,
          'Rest After Activity (s)': routine.betweenActivityRest
        });
      } else {
        flattenNodes(routine, activities, '', 1, '', { val: 0 });
      }
    });
    return rows;
  }

  function rowsToRoutines(rows) {
    if (!Array.isArray(rows) || rows.length === 0) {
      return [];
    }

    const routineMap = {};
    const routineOrder = [];

    rows.forEach(function (row, idx) {
      const routineNameRaw =
        row['Routine Name'] !== undefined ? row['Routine Name'] :
        row['Routine'] !== undefined ? row['Routine'] :
        row['routine_name'] !== undefined ? row['routine_name'] : 'Imported Routine';

      const routineName = String(routineNameRaw || 'Imported Routine').trim() || 'Imported Routine';
      const routineIdRaw = row['Routine ID'] || row['routine_id'] || ('routine_' + routineName.toLowerCase().replace(/[^a-z0-9]+/g, '_'));
      const routineKey = String(routineIdRaw) + '::' + routineName;

      const betweenRestRaw =
        row['Rest Between Activities (s)'] !== undefined ? row['Rest Between Activities (s)'] :
        row['Rest Between Activities'] !== undefined ? row['Rest Between Activities'] :
        row['Between Activities Rest'] !== undefined ? row['Between Activities Rest'] : 20;
      const betweenRest = Math.max(0, parseInt(betweenRestRaw, 10));
      const safeBetweenRest = isNaN(betweenRest) ? 20 : betweenRest;

      const prepareTimeRaw =
        row['Prepare Time (s)'] !== undefined ? row['Prepare Time (s)'] :
        row['Prepare Time'] !== undefined ? row['Prepare Time'] :
        row['prepare_time'] !== undefined ? row['prepare_time'] : 15;
      const parsedPrep = parseInt(prepareTimeRaw, 10);
      const safePrep = isNaN(parsedPrep) ? 15 : Math.max(0, parsedPrep);

      if (!routineMap[routineKey]) {
        routineMap[routineKey] = {
          id: String(row['Routine ID'] || global.SetTimerStorage.generateId('routine')),
          name: routineName,
          prepareTime: safePrep,
          betweenActivityRest: safeBetweenRest,
          updatedAt: new Date().toISOString(),
          _rawNodes: [],
          activities: []
        };
        routineOrder.push(routineKey);
      }

      const nodeTypeRaw = String(row['Node Type'] || row['Type'] || 'EXERCISE').trim().toUpperCase();
      const isGroup = (nodeTypeRaw === 'GROUP' || nodeTypeRaw === 'SUBGROUP');

      const activityNameRaw =
        row['Activity'] !== undefined ? row['Activity'] :
        row['Activity Name'] !== undefined ? row['Activity Name'] :
        row['Exercise'] !== undefined ? row['Exercise'] : '';

      const setsRaw =
        row['Number of Sets'] !== undefined ? row['Number of Sets'] :
        row['Sets'] !== undefined ? row['Sets'] : (isGroup ? 2 : 3);

      const timePerSetRaw =
        row['Time per Set (s)'] !== undefined ? row['Time per Set (s)'] :
        row['Time per Set'] !== undefined ? row['Time per Set'] :
        row['Duration'] !== undefined ? row['Duration'] : 30;

      const restBetweenSetsRaw =
        row['Rest Between Sets (s)'] !== undefined ? row['Rest Between Sets (s)'] :
        row['Rest in between Sets'] !== undefined ? row['Rest in between Sets'] :
        row['Rest Between Sets'] !== undefined ? row['Rest Between Sets'] : 15;

      const restAfterActivityRaw =
        row['Rest After Activity (s)'] !== undefined ? row['Rest After Activity (s)'] :
        row['Rest After Activity'] !== undefined ? row['Rest After Activity'] : safeBetweenRest;

      const orderVal = parseInt(row['Activity Order'] !== undefined ? row['Activity Order'] : (idx + 1), 10);
      const nodeId = String(row['Node ID'] || '').trim() || global.SetTimerStorage.generateId(isGroup ? 'grp' : 'act');
      const parentId = String(row['Parent Group ID'] || '').trim();

      routineMap[routineKey]._rawNodes.push({
        _order: isNaN(orderVal) ? (idx + 1) : orderVal,
        _parentId: parentId,
        id: nodeId,
        type: isGroup ? 'group' : 'exercise',
        name: String(activityNameRaw || (isGroup ? 'Group ' + (idx + 1) : 'Activity ' + (idx + 1))).trim(),
        sets: Math.max(1, parseInt(setsRaw, 10) || 1),
        timePerSet: isGroup ? 0 : Math.max(1, parseInt(timePerSetRaw, 10) || 30),
        restBetweenSets: isNaN(parseInt(restBetweenSetsRaw, 10)) ? 15 : Math.max(0, parseInt(restBetweenSetsRaw, 10)),
        restAfterActivity: isNaN(parseInt(restAfterActivityRaw, 10)) ? safeBetweenRest : Math.max(0, parseInt(restAfterActivityRaw, 10)),
        collapsed: false,
        children: isGroup ? [] : undefined
      });
    });

    return routineOrder.map(function (key) {
      const r = routineMap[key];
      r._rawNodes.sort(function (a, b) { return a._order - b._order; });
      const byId = {};
      r._rawNodes.forEach(function (n) {
        byId[n.id] = n;
      });
      const roots = [];
      r._rawNodes.forEach(function (n) {
        const pId = n._parentId;
        delete n._order;
        delete n._parentId;
        if (pId && byId[pId] && byId[pId].type === 'group' && byId[pId] !== n) {
          byId[pId].children.push(n);
        } else {
          roots.push(n);
        }
      });
      delete r._rawNodes;
      r.activities = roots;
      return global.SetTimerStorage.sanitizeRoutine(r);
    });
  }

  function exportToExcel(routines, filenamePrefix) {
    const rows = routinesToRows(routines);
    const now = new Date();
    const pad = function (n) { return String(n).padStart(2, '0'); };
    const stamp = now.getFullYear() + pad(now.getMonth() + 1) + pad(now.getDate()) + '_' + pad(now.getHours()) + pad(now.getMinutes());
    const baseName = (filenamePrefix || 'SetTimer_Backup') + '_' + stamp;

    if (typeof global.XLSX !== 'undefined') {
      const wb = global.XLSX.utils.book_new();
      const ws = global.XLSX.utils.json_to_sheet(rows);

      ws['!cols'] = [
        { wch: 22 },
        { wch: 28 },
        { wch: 18 },
        { wch: 26 },
        { wch: 15 },
        { wch: 14 },
        { wch: 22 },
        { wch: 22 },
        { wch: 14 },
        { wch: 12 },
        { wch: 36 },
        { wch: 26 },
        { wch: 16 },
        { wch: 18 },
        { wch: 22 },
        { wch: 24 }
      ];

      global.XLSX.utils.book_append_sheet(wb, ws, 'SetTimer_Routines');
      global.XLSX.writeFile(wb, baseName + '.xlsx');
      return { format: 'xlsx', filename: baseName + '.xlsx', count: rows.length };
    } else {
      const headers = [
        'Routine ID',
        'Routine Name',
        'Prepare Time (s)',
        'Rest Between Activities (s)',
        'Activity Order',
        'Sibling Order',
        'Node ID',
        'Parent Group ID',
        'Node Type',
        'Tree Level',
        'Tree Path',
        'Activity',
        'Number of Sets',
        'Time per Set (s)',
        'Rest Between Sets (s)',
        'Rest After Activity (s)'
      ];
      const csvLines = [headers.join(',')];
      rows.forEach(function (row) {
        const vals = headers.map(function (h) {
          const val = String(row[h] !== undefined ? row[h] : '').replace(/"/g, '""');
          return '"' + val + '"';
        });
        csvLines.push(vals.join(','));
      });
      const blob = new Blob([csvLines.join('\n')], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = baseName + '.csv';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      return { format: 'csv', filename: baseName + '.csv', count: rows.length };
    }
  }

  function parseCsvFallback(text) {
    const lines = text.split(/\r?\n/).filter(function (l) { return l.trim().length > 0; });
    if (lines.length < 2) return [];
    const parseLine = function (line) {
      const result = [];
      let current = '';
      let inQuotes = false;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') {
          if (inQuotes && line[i + 1] === '"') {
            current += '"';
            i++;
          } else {
            inQuotes = !inQuotes;
          }
        } else if (ch === ',' && !inQuotes) {
          result.push(current);
          current = '';
        } else {
          current += ch;
        }
      }
      result.push(current);
      return result;
    };

    const headers = parseLine(lines[0]).map(function (h) { return h.trim(); });
    const rows = [];
    for (let i = 1; i < lines.length; i++) {
      const cols = parseLine(lines[i]);
      const obj = {};
      headers.forEach(function (h, idx) {
        obj[h] = cols[idx] !== undefined ? cols[idx].trim() : '';
      });
      rows.push(obj);
    }
    return rows;
  }

  function importFromExcelFile(file) {
    return new Promise(function (resolve, reject) {
      if (!file) {
        reject(new Error('No file selected.'));
        return;
      }

      const reader = new FileReader();
      const isCsv = file.name.toLowerCase().endsWith('.csv');

      reader.onload = function (e) {
        try {
          let rows = [];
          if (typeof global.XLSX !== 'undefined' && !isCsv) {
            const data = new Uint8Array(e.target.result);
            const workbook = global.XLSX.read(data, { type: 'array' });
            const firstSheetName = workbook.SheetNames[0];
            if (!firstSheetName) {
              throw new Error('The Excel file does not contain any worksheets.');
            }
            const worksheet = workbook.Sheets[firstSheetName];
            rows = global.XLSX.utils.sheet_to_json(worksheet, { defval: '' });
          } else {
            const text = typeof e.target.result === 'string'
              ? e.target.result
              : new TextDecoder('utf-8').decode(e.target.result);
            rows = parseCsvFallback(text);
          }

          const importedRoutines = rowsToRoutines(rows);
          if (!importedRoutines || importedRoutines.length === 0) {
            throw new Error('No valid routine activities found in the backup file.');
          }
          resolve(importedRoutines);
        } catch (err) {
          reject(err);
        }
      };

      reader.onerror = function () {
        reject(new Error('Failed to read the uploaded backup file.'));
      };

      if (typeof global.XLSX !== 'undefined' && !isCsv) {
        reader.readAsArrayBuffer(file);
      } else {
        reader.readAsText(file);
      }
    });
  }

  global.SetTimerExcel = {
    exportToExcel: exportToExcel,
    importFromExcelFile: importFromExcelFile,
    routinesToRows: routinesToRows,
    rowsToRoutines: rowsToRoutines
  };
})(window);
