/* ==========================================================================
   SetTimer - Excel Backup & Restore Module (excel.js)
   Exports routines into an Excel (.xlsx) workbook for backup and restores
   routines from uploaded Excel (.xlsx / .xls / .csv) backup files.
   ========================================================================== */

(function (global) {
  'use strict';

  function routinesToRows(routines) {
    const rows = [];
    (routines || []).forEach(function (routine) {
      const activities = Array.isArray(routine.activities) ? routine.activities : [];
      if (activities.length === 0) {
        rows.push({
          'Routine ID': routine.id,
          'Routine Name': routine.name,
          'Rest Between Activities (s)': routine.betweenActivityRest,
          'Activity Order': 1,
          'Activity': 'Activity 1',
          'Number of Sets': 3,
          'Time per Set (s)': 30,
          'Rest Between Sets (s)': 15,
          'Rest After Activity (s)': routine.betweenActivityRest
        });
      } else {
        activities.forEach(function (act, idx) {
          rows.push({
            'Routine ID': routine.id,
            'Routine Name': routine.name,
            'Rest Between Activities (s)': routine.betweenActivityRest,
            'Activity Order': idx + 1,
            'Activity': act.name,
            'Number of Sets': act.sets,
            'Time per Set (s)': act.timePerSet,
            'Rest Between Sets (s)': act.restBetweenSets,
            'Rest After Activity (s)': act.restAfterActivity !== undefined
              ? act.restAfterActivity
              : routine.betweenActivityRest
          });
        });
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
      // Support flexible column naming so user-edited Excel sheets also import cleanly
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

      if (!routineMap[routineKey]) {
        routineMap[routineKey] = {
          id: String(row['Routine ID'] || global.SetTimerStorage.generateId('routine')),
          name: routineName,
          betweenActivityRest: safeBetweenRest,
          updatedAt: new Date().toISOString(),
          activities: []
        };
        routineOrder.push(routineKey);
      }

      const activityNameRaw =
        row['Activity'] !== undefined ? row['Activity'] :
        row['Activity Name'] !== undefined ? row['Activity Name'] :
        row['Exercise'] !== undefined ? row['Exercise'] : '';

      const setsRaw =
        row['Number of Sets'] !== undefined ? row['Number of Sets'] :
        row['Sets'] !== undefined ? row['Sets'] : 3;

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

      routineMap[routineKey].activities.push({
        _order: isNaN(orderVal) ? (idx + 1) : orderVal,
        id: global.SetTimerStorage.generateId('act'),
        name: String(activityNameRaw || ('Activity ' + (idx + 1))).trim(),
        sets: Math.max(1, parseInt(setsRaw, 10) || 1),
        timePerSet: Math.max(1, parseInt(timePerSetRaw, 10) || 30),
        restBetweenSets: isNaN(parseInt(restBetweenSetsRaw, 10)) ? 15 : Math.max(0, parseInt(restBetweenSetsRaw, 10)),
        restAfterActivity: isNaN(parseInt(restAfterActivityRaw, 10)) ? safeBetweenRest : Math.max(0, parseInt(restAfterActivityRaw, 10))
      });
    });

    return routineOrder.map(function (key) {
      const r = routineMap[key];
      r.activities.sort(function (a, b) { return a._order - b._order; });
      r.activities.forEach(function (a) { delete a._order; });
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

      // Set readable column widths
      ws['!cols'] = [
        { wch: 24 }, // Routine ID
        { wch: 28 }, // Routine Name
        { wch: 26 }, // Rest Between Activities (s)
        { wch: 15 }, // Activity Order
        { wch: 26 }, // Activity
        { wch: 16 }, // Number of Sets
        { wch: 18 }, // Time per Set (s)
        { wch: 22 }, // Rest Between Sets (s)
        { wch: 24 }  // Rest After Activity (s)
      ];

      global.XLSX.utils.book_append_sheet(wb, ws, 'SetTimer_Routines');
      global.XLSX.writeFile(wb, baseName + '.xlsx');
      return { format: 'xlsx', filename: baseName + '.xlsx', count: rows.length };
    } else {
      // Fallback CSV export if offline / CDN blocked
      const headers = [
        'Routine ID',
        'Routine Name',
        'Rest Between Activities (s)',
        'Activity Order',
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
