/**
 * Cliente API REST para la aplicación Amelia.
 * Basado en las secciones §5 y §6 del contrato técnico.
 */

/**
 * Función auxiliar para realizar peticiones HTTP a rutas relativas.
 * Parsea respuestas JSON y adjunta detalles de error (status, likes) en caso de fallo.
 *
 * @param {string} url - Ruta relativa o URL a consultar.
 * @param {RequestInit} [options] - Opciones de fetch.
 * @returns {Promise<any>}
 */
/** Clave de la sesión (se lee directo para no importar session.js y armar un ciclo) */
function sessionPass() {
  try {
    return JSON.parse(sessionStorage.getItem('amelia_session') || 'null')?.passcode ?? null;
  } catch {
    return null;
  }
}

async function request(url, options = {}) {
  // el servidor necesita saber quién mira: los ítems privados solo los ven Mariana y Franco
  const pass = sessionPass();
  const headers = { ...(options.headers || {}) };
  if (pass) headers['X-Amelia-Pass'] = pass;
  const res = await fetch(url, { ...options, headers });
  let data = null;
  const contentType = res.headers.get('content-type');
  if (contentType && contentType.includes('application/json')) {
    data = await res.json().catch(() => null);
  } else {
    data = await res.text().catch(() => null);
  }

  if (!res.ok) {
    const message = (data && typeof data === 'object' && data.error)
      ? data.error
      : (typeof data === 'string' && data ? data : 'Che, hubo un problema al comunicarse con el servidor');
    const err = new Error(message);
    err.status = res.status;
    if (data && typeof data === 'object') {
      err.data = data;
      if (data.likes !== undefined) {
        err.likes = data.likes;
      }
    }
    throw err;
  }

  return data;
}

/**
 * Obtiene la lista de habitaciones disponibles.
 * @returns {Promise<Array>}
 */
export async function getRooms() {
  return request('/api/rooms');
}

/**
 * Obtiene el detalle de una habitación específica junto con sus contenedores y conteos.
 * @param {string} roomId
 * @returns {Promise<Object>}
 */
export async function getRoom(roomId) {
  return request(`/api/rooms/${encodeURIComponent(roomId)}`);
}

/**
 * Obtiene la lista de ítems filtrados desde el servidor.
 * @param {Object} [params] - Filtros opcionales (room, container, weather, daytime, decade, genre, mood, stage, date, tag, q, sort).
 * @returns {Promise<Array>}
 */
export async function getItems(params = {}) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== null && value !== undefined && value !== '') {
      search.set(key, String(value));
    }
  }
  const queryStr = search.toString();
  return request(`/api/items${queryStr ? `?${queryStr}` : ''}`);
}

/**
 * Obtiene el ítem completo por su identificador.
 * @param {string} id
 * @returns {Promise<Object>}
 */
export async function getItem(id) {
  return request(`/api/items/${encodeURIComponent(id)}`);
}

/**
 * Obtiene los comentarios de un ítem ordenados cronológicamente de forma ascendente.
 * @param {string} id
 * @returns {Promise<Array>}
 */
export async function getComments(id) {
  return request(`/api/items/${encodeURIComponent(id)}/comments`);
}

/**
 * Publica un nuevo comentario en un ítem.
 * @param {string} id
 * @param {{ passcode: string, body: string }} data
 * @returns {Promise<Object>}
 */
export async function postComment(id, { passcode, body, rating = null }) {
  return request(`/api/items/${encodeURIComponent(id)}/comments`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ passcode, body, rating })
  });
}

/**
 * Registra un "me gusta" para un ítem.
 * Si se repite dentro de la ventana de 12h, el servidor responde 429 y se lanza un Error con .status y .likes adjuntos.
 * @param {string} id
 * @returns {Promise<{ likes: number }>}
 */
export async function likeItem(id) {
  return request(`/api/items/${encodeURIComponent(id)}/like`, {
    method: 'POST'
  });
}

/**
 * Valida un código de acceso familiar o de dueño de habitación.
 * @param {string} passcode
 * @returns {Promise<{ name: string, role: 'familia'|'owner', roomId?: string }>}
 */
export async function checkPasscode(passcode) {
  return request('/api/auth/check', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ passcode })
  });
}

/**
 * Crea un nuevo ítem enviando FormData con archivo opcional (cover).
 * @param {FormData} formData
 * @returns {Promise<Object>}
 */
export async function createItem(formData) {
  return request('/api/items', {
    method: 'POST',
    body: formData
  });
}

/**
 * Obtiene las estadísticas agregadas de una habitación o contenedor.
 * @param {{ room?: string, container?: string }} [params]
 * @returns {Promise<Object>}
 */
export async function getStats({ room, container } = {}) {
  const search = new URLSearchParams();
  if (room) search.set('room', room);
  if (container) search.set('container', container);
  const queryStr = search.toString();
  return request(`/api/stats${queryStr ? `?${queryStr}` : ''}`);
}

/**
 * Asistente del alta: busca en internet (iTunes, TVmaze, Open Library, Wikipedia,
 * OpenStreetMap, Open Food Facts) a través del servidor.
 * @param {string} container
 * @param {string} q
 * @param {AbortSignal} [signal]
 * @returns {Promise<Array>}
 */
export async function lookupMedia(container, q, signal) {
  const search = new URLSearchParams({ container, q });
  return request(`/api/lookup?${search}`, { signal });
}

/**
 * Modifica un ítem (solo quien lo agregó). FormData con los campos que cambian;
 * keepGallery (JSON), removeCover / removeAudio ("1") y archivos cover/gallery/audio.
 * @param {string} id
 * @param {FormData} formData
 */
export async function updateItem(id, formData) {
  return request(`/api/items/${encodeURIComponent(id)}`, { method: 'PUT', body: formData });
}

/** Borra un ítem (solo quien lo agregó) */
export async function deleteItem(id) {
  return request(`/api/items/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

/** Coincidencias entre las dos piezas (el espejo) */
export async function getCoincidences() {
  return request('/api/coincidences');
}
