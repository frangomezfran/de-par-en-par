/**
 * Servicio de clima usando la API pública Open-Meteo.
 * Mapea códigos WMO al modelo canónico de Amelia con caché en sessionStorage y fallback sin red.
 * Basado en las secciones §3 y §6 del contrato técnico.
 */

const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutos

/**
 * Mapea códigos meteorológicos WMO a las condiciones canónicas de Amelia:
 * soleado, nublado, lluvioso, tormenta, nevado, niebla.
 *
 * @param {number|string} code - Código WMO
 * @returns {'soleado'|'nublado'|'lluvioso'|'tormenta'|'nevado'|'niebla'}
 */
export function mapWeatherCode(code) {
  const c = Number(code);
  if (c >= 0 && c <= 1) return 'soleado';
  if (c >= 2 && c <= 3) return 'nublado';
  if (c === 45 || c === 48) return 'niebla';
  if ((c >= 51 && c <= 67) || (c >= 80 && c <= 82)) return 'lluvioso';
  if ((c >= 71 && c <= 77) || (c >= 85 && c <= 86)) return 'nevado';
  if (c >= 95 && c <= 99) return 'tormenta';
  return 'soleado';
}

/**
 * Genera el clima por defecto cuando no hay conexión o falla la API.
 * @returns {{ condition: 'soleado', isDay: boolean, code: number, temperature: null, fetchedAt: string, source: 'fallback' }}
 */
function getFallbackWeather() {
  const now = new Date();
  const hour = now.getHours();
  const isDay = hour >= 7 && hour < 20;
  return {
    condition: 'soleado',
    isDay,
    code: 0,
    temperature: null,
    fetchedAt: now.toISOString(),
    source: 'fallback'
  };
}

/**
 * Obtiene el estado del clima actual.
 * Admite override por URL: ?cielo=<condicion>&noche=1 para pruebas.
 * Consulta la API Open-Meteo con timeout de 5s y caché de 15 minutos en sessionStorage.
 *
 * @param {{ lat?: number, lon?: number }} [coords]
 * @returns {Promise<{ condition: string, isDay: boolean, code: number|null, temperature: number|null, fetchedAt: string, source: 'open-meteo'|'cache'|'fallback'|'override' }>}
 */
export async function getWeather({ lat = -34.6037, lon = -58.3816 } = {}) {
  // 1. Override de testing por parámetros de URL (?cielo=lluvioso&noche=1)
  if (typeof window !== 'undefined' && window.location && window.location.search) {
    const urlParams = new URLSearchParams(window.location.search);
    const cieloParam = urlParams.get('cielo');
    if (cieloParam) {
      const nocheParam = urlParams.get('noche');
      const isDay = !(nocheParam === '1' || nocheParam === 'true');
      return {
        condition: cieloParam,
        isDay,
        code: null,
        temperature: null,
        fetchedAt: new Date().toISOString(),
        source: 'override'
      };
    }
  }

  // 2. Caché en sessionStorage por lat/lon redondeado
  const roundedLat = Number(lat).toFixed(2);
  const roundedLon = Number(lon).toFixed(2);
  const cacheKey = `amelia_weather_${roundedLat}_${roundedLon}`;

  if (typeof sessionStorage !== 'undefined') {
    try {
      const cachedRaw = sessionStorage.getItem(cacheKey);
      if (cachedRaw) {
        const cached = JSON.parse(cachedRaw);
        if (Date.now() - cached.timestamp < CACHE_TTL_MS && cached.data) {
          return {
            ...cached.data,
            source: 'cache'
          };
        }
      }
    } catch {
      // Ignora errores de lectura de sessionStorage (ej. modo incógnito restringido)
    }
  }

  // 3. Consulta a Open-Meteo con AbortController (timeout de 5 s)
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000);

  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=weather_code,is_day,temperature_2m`;
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);

    if (!res.ok) {
      throw new Error(`Open-Meteo HTTP ${res.status}`);
    }

    const data = await res.json();
    const current = data.current || data.current_weather || {};
    const code = current.weather_code ?? current.weathercode ?? 0;
    const isDay = current.is_day !== undefined ? Boolean(current.is_day) : Boolean(current.isday);
    const temperature = current.temperature_2m ?? current.temperature ?? null;

    const result = {
      condition: mapWeatherCode(code),
      isDay,
      code,
      temperature,
      fetchedAt: new Date().toISOString(),
      source: 'open-meteo'
    };

    if (typeof sessionStorage !== 'undefined') {
      try {
        sessionStorage.setItem(
          cacheKey,
          JSON.stringify({
            timestamp: Date.now(),
            data: result
          })
        );
      } catch {
        // Ignora errores de escritura en sessionStorage
      }
    }

    return result;
  } catch {
    clearTimeout(timeoutId);
    return getFallbackWeather();
  }
}
