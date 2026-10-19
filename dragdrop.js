/* ==========================================================================
   SetTimer - Drag & Drop Module (dragdrop.js)
   Enables drag-and-drop reordering of exercise Activity cards in Edit Mode
   without interfering with text selection or focus changes in input fields.
   ========================================================================== */

(function (global) {
  'use strict';

  let draggedIndex = null;

  function attachDragAndDrop(containerEl, onReorderCallback) {
    if (!containerEl) return;

    const cards = containerEl.querySelectorAll('.activity-card[data-activity-index]');
    cards.forEach(function (card) {
      const index = parseInt(card.getAttribute('data-activity-index'), 10);
      const handle = card.querySelector('.drag-handle');

      // Keep draggable="false" by default so input selection, focus, and blur
      // work natively without HTML5 drag-and-drop hijacking mouse events.
      card.setAttribute('draggable', 'false');

      if (handle) {
        handle.addEventListener('mousedown', function () {
          card.setAttribute('draggable', 'true');
        });
        handle.addEventListener('mouseup', function () {
          card.setAttribute('draggable', 'false');
        });
        handle.addEventListener('mouseleave', function () {
          if (draggedIndex === null) {
            card.setAttribute('draggable', 'false');
          }
        });
      }

      card.addEventListener('dragstart', function (e) {
        if (card.getAttribute('draggable') !== 'true') {
          e.preventDefault();
          return;
        }
        draggedIndex = index;
        card.classList.add('dragging');
        if (e.dataTransfer) {
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/plain', String(index));
        }
      });

      card.addEventListener('dragend', function () {
        draggedIndex = null;
        card.setAttribute('draggable', 'false');
        card.classList.remove('dragging');
        clearDropIndicators(containerEl);
      });

      card.addEventListener('dragover', function (e) {
        if (draggedIndex === null) return;
        e.preventDefault();
        if (draggedIndex === index) return;
        if (e.dataTransfer) {
          e.dataTransfer.dropEffect = 'move';
        }
        const rect = card.getBoundingClientRect();
        const midpoint = rect.top + rect.height / 2;
        clearDropIndicators(containerEl);
        if (e.clientY < midpoint) {
          card.classList.add('drag-over-top');
        } else {
          card.classList.add('drag-over-bottom');
        }
      });

      card.addEventListener('dragleave', function () {
        card.classList.remove('drag-over-top', 'drag-over-bottom');
      });

      card.addEventListener('drop', function (e) {
        if (draggedIndex === null) return;
        e.preventDefault();
        clearDropIndicators(containerEl);
        const fromIndex = draggedIndex !== null
          ? draggedIndex
          : parseInt(e.dataTransfer ? e.dataTransfer.getData('text/plain') : '-1', 10);

        card.setAttribute('draggable', 'false');

        if (isNaN(fromIndex) || fromIndex < 0 || fromIndex === index) {
          draggedIndex = null;
          return;
        }

        const rect = card.getBoundingClientRect();
        const dropAfter = e.clientY >= (rect.top + rect.height / 2);
        let toIndex = index;
        if (dropAfter && fromIndex < index) {
          toIndex = index;
        } else if (!dropAfter && fromIndex > index) {
          toIndex = index;
        } else if (dropAfter && fromIndex > index) {
          toIndex = index + 1;
        } else if (!dropAfter && fromIndex < index) {
          toIndex = index - 1;
        }

        draggedIndex = null;
        if (typeof onReorderCallback === 'function') {
          onReorderCallback(fromIndex, toIndex);
        }
      });
    });
  }

  function clearDropIndicators(containerEl) {
    if (!containerEl) return;
    const cards = containerEl.querySelectorAll('.activity-card');
    cards.forEach(function (c) {
      c.classList.remove('drag-over-top', 'drag-over-bottom');
    });
  }

  global.SetTimerDragDrop = {
    attachDragAndDrop: attachDragAndDrop
  };
})(window);
