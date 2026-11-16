// In-page navigation. A full page load would throw away the click that unlocked audio,
// so moving from the home menu into a table keeps the same document (sound + voice start right away).
import { useEffect, useState } from 'react';

const EVT = 'nah:navigate';

export function navigate(path: string) {
  if (location.pathname === path) return;
  history.pushState(null, '', path);
  window.dispatchEvent(new Event(EVT));
}

export function usePath(): string {
  const [path, setPath] = useState(() => location.pathname);
  useEffect(() => {
    const on = () => setPath(location.pathname);
    window.addEventListener(EVT, on);
    window.addEventListener('popstate', on);
    return () => { window.removeEventListener(EVT, on); window.removeEventListener('popstate', on); };
  }, []);
  return path;
}
