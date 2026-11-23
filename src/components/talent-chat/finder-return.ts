/**
 * Getting back to the candidate finder after opening somebody's profile.
 *
 * When a result is clicked, the page it was clicked on is remembered for this
 * tab. Coming back to exactly that page (the browser's back button or "Back
 * to search results") reopens the finder with the same conversation; going
 * anywhere else forgets it. sessionStorage, so it is per tab and gone with it;
 * every access is guarded because storage can be blocked.
 */
const RETURN_KEY = "talent-finder:return-to";
const CHAT_KEY = "talent-finder:chat";

/** The query parameter a profile opened from the finder carries. */
export const FROM_FINDER = "finder";

export function currentHref(): string {
  return window.location.pathname + window.location.search;
}

export function rememberReturn(): void {
  try {
    sessionStorage.setItem(RETURN_KEY, currentHref());
  } catch {}
}

export function returnTarget(): string | null {
  try {
    return sessionStorage.getItem(RETURN_KEY);
  } catch {
    return null;
  }
}

export function forgetReturn(): void {
  try {
    sessionStorage.removeItem(RETURN_KEY);
  } catch {}
}

export function saveChat(value: unknown): void {
  try {
    sessionStorage.setItem(CHAT_KEY, JSON.stringify(value));
  } catch {}
}

export function loadChat<T>(): T | null {
  try {
    const raw = sessionStorage.getItem(CHAT_KEY);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export function clearChat(): void {
  try {
    sessionStorage.removeItem(CHAT_KEY);
  } catch {}
}
