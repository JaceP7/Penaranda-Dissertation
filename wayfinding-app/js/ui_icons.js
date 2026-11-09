/**
 * ui_icons.js - small line icons for the citizen view, replacing emoji.
 *
 * Emoji render differently on every phone, can't be coloured to match the
 * button, and read out oddly on screen readers ("staircase emoji"). These are
 * drawn here (24 x 24, 2 px strokes in currentColor), so they take the button's
 * text colour and need no icon library or licence.
 *
 *   uiIcon(name)          -> '<svg ... aria-hidden="true">...</svg>'
 *   uiHydrateIcons(root)  -> fills every <span data-icon="name"> under root
 *
 * Every button that shows an icon also keeps a text label; the icon is
 * decoration and is hidden from screen readers.
 */
"use strict";

const UI_ICON_PATHS = {
  "arrow-right": '<path d="M5 12h14M13 6l6 6-6 6"/>',
  "arrow-left":  '<path d="M19 12H5M11 6l-6 6 6 6"/>',
  "arrow-up":    '<path d="M12 19V5M6 11l6-6 6 6"/>',
  "u-turn":      '<path d="M9 14L4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
  "flag":        '<path d="M5 22V4"/><path d="M5 4h12l-2.5 4L17 12H5"/>',
  "walk":        '<circle cx="13" cy="4" r="2"/><path d="M11 21l2-7 3 3v4M9 12l2-4 4 2 2 3M11 8l-3 4"/>',
  "stairs":      '<path d="M3 20h4v-4h4v-4h4V8h4V4h2"/>',
  "camera":      '<path d="M4 8h3l2-3h6l2 3h3v12H4z"/><circle cx="12" cy="13.5" r="3.5"/>',
  "map-pin":     '<path d="M12 22s7-6.4 7-12a7 7 0 0 0-14 0c0 5.6 7 12 7 12z"/><circle cx="12" cy="10" r="2.5"/>',
  "check":       '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  "x":           '<path d="M6 6l12 12M18 6L6 18"/>',
  "message":     '<path d="M20 12a8 8 0 0 1-11.6 7.1L4 20l1-4.2A8 8 0 1 1 20 12z"/>',
  "home":        '<path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/>',
  "alert":       '<path d="M12 3l10 18H2z"/><path d="M12 10v5M12 18h.01"/>',
  "up":          '<path d="M12 20V4M5 11l7-7 7 7"/>',
  "down":        '<path d="M12 4v16M5 13l7 7 7-7"/>',
};

function uiIcon(name, extraClass) {
  const body = UI_ICON_PATHS[name];
  if (!body) return "";
  return '<svg class="ui-icon' + (extraClass ? " " + extraClass : "") + '" viewBox="0 0 24 24" ' +
         'width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" ' +
         'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' +
         body + "</svg>";
}

function uiHydrateIcons(root) {
  (root || document).querySelectorAll("[data-icon]").forEach((el) => {
    if (!el.firstElementChild) el.innerHTML = uiIcon(el.getAttribute("data-icon"));
  });
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => uiHydrateIcons(document));
  } else {
    uiHydrateIcons(document);
  }
}
