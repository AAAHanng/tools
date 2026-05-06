const HOTKEY_MODIFIER_KEYS = new Set([
  "Alt",
  "Control",
  "Ctrl",
  "Meta",
  "Shift"
]);

function getHotkeyKeyLabel(event: KeyboardEvent) {
  if (event.code.startsWith("Key")) {
    return event.code.slice(3);
  }

  if (event.code.startsWith("Digit")) {
    return event.code.slice(5);
  }

  if (event.code.startsWith("Numpad")) {
    return event.code;
  }

  return event.key.length === 1 ? event.key.toUpperCase() : event.key;
}

export function normalizeHotkeyFromKeyboardEvent(event: KeyboardEvent) {
  const key = getHotkeyKeyLabel(event);

  if (HOTKEY_MODIFIER_KEYS.has(key)) {
    return "";
  }

  if (!event.metaKey && !event.ctrlKey && !event.altKey) {
    return "";
  }

  return [
    event.metaKey ? "Meta" : "",
    event.ctrlKey ? "Ctrl" : "",
    event.altKey ? "Alt" : "",
    event.shiftKey ? "Shift" : "",
    key === " " ? "Space" : key
  ]
    .filter(Boolean)
    .join("+");
}
