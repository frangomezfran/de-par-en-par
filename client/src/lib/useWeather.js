import { useState, useEffect } from 'react';
import { getWeather } from './weather.js';

/**
 * Hook de React para consultar y suscribirse al clima actual.
 * Devuelve `weather: null` y `loading: true` mientras realiza la carga.
 *
 * @param {{ lat?: number, lon?: number }} [options]
 * @returns {{ weather: Object|null, loading: boolean }}
 */
export default function useWeather(options) {
  const [weather, setWeather] = useState(null);
  const [loading, setLoading] = useState(true);

  const lat = options?.lat;
  const lon = options?.lon;

  useEffect(() => {
    let isMounted = true;
    setLoading(true);

    const opts = (lat !== undefined || lon !== undefined) ? { lat, lon } : undefined;

    getWeather(opts)
      .then((data) => {
        if (isMounted) {
          setWeather(data);
          setLoading(false);
        }
      })
      .catch(() => {
        if (isMounted) {
          setLoading(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [lat, lon]);

  return { weather, loading };
}
