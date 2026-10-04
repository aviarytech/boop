import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { initDeepLinks } from '../lib/deeplinks';

/** Route changes update navigation without re-registering native listeners. */
export function useNativeLinks() {
  const navigate = useNavigate();
  const currentNavigate = useRef(navigate);
  useEffect(() => { currentNavigate.current = navigate; }, [navigate]);
  useEffect(() => {
    const controller = new AbortController();
    void initDeepLinks(path => currentNavigate.current(path), controller.signal)
      .catch(error => { if (!controller.signal.aborted) console.error('Native link initialization failed', error); });
    return () => controller.abort();
  }, []);
}
