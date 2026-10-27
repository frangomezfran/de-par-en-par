/**
 * Clasificador de ayuda para el alta de ítems: a partir de lo que trae la
 * búsqueda (géneros, título, descripción, año) sugiere clima, momento del día,
 * estación, ánimo, etapa, edad y festividad. Son sugerencias: en el formulario
 * quedan tildadas y la persona las puede cambiar.
 */

const norm = (s) =>
  String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

// Cada regla: patrón (sobre géneros + título + descripción, en español o inglés) => sugerencias
const RULES = [
  {
    re: /terror|horror|miedo|fantasma|ghost|zombi|vampir|bruj|witch|hallowe|monstru|monster|calabaza|pumpkin|haunt|embruj|gotic|gothic|creepy|scream|pesadilla|nightmare|supernatural|sobrenatural|paranormal/,
    date: ['halloween', 'tiene algo de miedo'],
    weather: ['tormenta', 'niebla'],
    daytime: 'nocturno',
    moods: ['valiente', 'oscuro', 'tenso'],
    audience: '+16',
    stages: ['adolescencia'],
    seasons: ['otono'],
  },
  {
    re: /navidad|christmas|xmas|santa claus|papa noel|villancico|pesebre|reno\b|reindeer|holiday|nochebuena|arbolito/,
    date: ['navidad', 'habla de la Navidad'],
    moods: ['tierno', 'nostalgico'],
    seasons: ['verano'],
  },
  {
    re: /ano nuevo|new year|fiesta|party|disco\b|dance|baile|bailar|celebra|brindis|champ|fuegos artificiales|firework|time travel|viaje en el tiempo|reggaeton|cumbia/,
    date: ['anio-nuevo', 'es para festejar'],
    moods: ['alegre', 'energico', 'euforico', 'sociable'],
    daytime: 'nocturno',
  },
  {
    re: /animacion|animated|animation|infantil|children|kids|familiar|family|cuento|fairy|disney|pixar|dreamworks|ghibli|dibujos|muñec|toy|juguete|plataformas|platform|nintendo|pokemon|mario/,
    date: ['cumple-amelia', 'es ideal para Amelia'],
    weather: ['soleado'],
    daytime: 'diurno',
    moods: ['tierno', 'alegre'],
    stages: ['primeros-anios', 'ninez'],
    audience: 'ATP',
  },
  { re: /juvenil|young adult|teen|adolesc|coming of age|secundari|high school/, stages: ['adolescencia'], moods: ['nostalgico'] },
  { re: /comedia|comedy|humor|sitcom|divertid|funny|parodi/, weather: ['soleado'], moods: ['divertido', 'alegre'] },
  { re: /romance|romantic|romantica|amor\b|love/, weather: ['lluvioso'], moods: ['tierno'], seasons: ['otono'] },
  { re: /drama|melancol|tragedi|tragedy|duelo|grief|nostalgi/, weather: ['lluvioso', 'nublado'], moods: ['melancolico', 'nostalgico', 'catartico', 'reflexivo'], seasons: ['otono', 'invierno'] },
  { re: /accion|action|aventura|adventure|superhero|superheroe|guerra|war\b|epic|epica|fantasia|fantasy/, weather: ['soleado'], moods: ['energico', 'valiente', 'adrenalinico'] },
  { re: /thriller|suspens|crimen|crime|policial|noir|detective|mafia|gangster|misterio|mystery|perturbad|psicologico/, weather: ['niebla', 'lluvioso'], daytime: 'nocturno', moods: ['valiente', 'tenso', 'ansioso', 'incomodo'], audience: '+13' },
  { re: /ciencia ficcion|science fiction|sci-fi|espacio|space|futur|robot|alien/, weather: ['nublado'], daytime: 'nocturno', moods: ['valiente', 'cerebral', 'reflexivo'] },
  { re: /documental|documentary|historia\b|history|biograf/, weather: ['nublado'], moods: ['tranquilo'] },
  { re: /musical|music\b|pop\b|country/, weather: ['soleado'], moods: ['alegre'] },
  { re: /rock|punk|metal|grunge|nu metal|hard rock|electronic|electronica|techno|house\b/, moods: ['energico', 'rebelde'], daytime: 'nocturno', stages: ['adolescencia'] },
  { re: /jazz|blues|bossa|soul|ambient|acustic|acoustic|folk|lo-?fi|clasica|classical|piano|instrumental|bolero|tango/, weather: ['lluvioso', 'nublado'], moods: ['tranquilo', 'nostalgico', 'relajado', 'reconfortante'], daytime: 'nocturno' },
  { re: /verano|summer|playa|beach|mar\b|sea\b|sol\b|sunny|surf/, weather: ['soleado'], seasons: ['verano'], moods: ['alegre'] },
  { re: /invierno|winter|nieve|snow|frio|cold|montana|mountain|esqui|ski/, weather: ['nevado'], seasons: ['invierno'], moods: ['tranquilo'] },
  { re: /primavera|spring|flor|flower|jardin|garden|bloom/, weather: ['soleado'], seasons: ['primavera'], moods: ['tierno', 'alegre'] },
  { re: /otono|autumn|fall\b|hojas/, weather: ['nublado'], seasons: ['otono'], moods: ['nostalgico'] },
  { re: /deporte|sport|tenis|tennis|futbol|football|soccer|natacion|swim|correr|running|padel|bici|cicl|basquet|rugby|hockey|voley|gimnasia/, weather: ['soleado'], daytime: 'diurno', moods: ['energico', 'valiente', 'motivador', 'adrenalinico'] },
  { re: /rpg|role-playing|estrategia|strategy|simulaci|simulation|puzzle/, weather: ['lluvioso'], daytime: 'nocturno', moods: ['tranquilo'] },
  // café
  { re: /espresso|ristretto|cafe solo/, daytime: 'diurno', moods: ['energico'] },
  { re: /con leche|latte|capuchino|cappuccino|lagrima|flat white|cortado|macchiato|merienda/, weather: ['lluvioso', 'nublado'], moods: ['tierno', 'tranquilo', 'reconfortante', 'relajado'], seasons: ['otono', 'invierno'] },
  { re: /cold brew|frio|iced/, weather: ['soleado'], seasons: ['verano'] },
  { re: /cafeteria|coffee shop|bar\b|cafe\b/, moods: ['tranquilo'] },
];

/** Defaults por contenedor cuando no matchea nada en particular */
const CONTAINER_DEFAULTS = {
  cafe: { weather: ['lluvioso'], moods: ['tranquilo'] },
  flores: { weather: ['soleado'], seasons: ['primavera'], moods: ['tierno'] },
  actividades: { weather: ['soleado'], daytime: 'diurno', moods: ['energico'] },
  libros: { weather: ['lluvioso'], moods: ['tranquilo'] },
  musica: { moods: ['alegre'] },
};

/**
 * @param {{ container: string, roomId?: string, title?: string, originalTitle?: string, genres?: string[], description?: string, year?: number, tags?: string[] }} info
 * @returns {{ weather: string[], daytime: string|null, seasons: string[], moods: string[], stages: string[], specialDates: string[], audience: string|null, tags: string[], reasons: Record<string,string> }}
 */
export function suggestClassification(info) {
  const text = norm([info.title, info.originalTitle, ...(info.genres ?? []), info.description].filter(Boolean).join(' · '));
  const out = { weather: [], daytime: null, seasons: [], moods: [], stages: [], specialDates: [], audience: null, tags: [...(info.tags ?? [])], reasons: {} };
  const add = (key, values) => {
    for (const v of values ?? []) if (!out[key].includes(v)) out[key].push(v);
  };

  for (const r of RULES) {
    if (!r.re.test(text)) continue;
    if (r.date && !out.specialDates.includes(r.date[0])) {
      out.specialDates.push(r.date[0]);
      out.reasons[r.date[0]] = r.date[1];
    }
    add('weather', r.weather);
    add('seasons', r.seasons);
    add('moods', r.moods);
    add('stages', r.stages);
    if (r.daytime && !out.daytime) out.daytime = r.daytime;
    if (r.audience && !out.audience) out.audience = r.audience;
  }

  // Lo que ninguna regla completó, lo completa el contenedor (ej. el café es para días de lluvia)
  const d = CONTAINER_DEFAULTS[info.container];
  if (d) {
    for (const key of ['weather', 'seasons', 'moods']) if (!out[key].length) add(key, d[key]);
    if (d.daytime && !out.daytime) out.daytime = d.daytime;
  }

  // Lo viejito da nostalgia
  if (info.year && info.year < 1995 && !out.moods.includes('nostalgico')) out.moods.push('nostalgico');

  // Si no hay etapa, es para siempre
  if (!out.stages.length) out.stages.push('siempre');

  // Recortes: que no se llene todo de tildes
  out.weather = out.weather.slice(0, 2);
  out.moods = out.moods.slice(0, 3);
  out.seasons = out.seasons.slice(0, 2);
  out.stages = out.stages.slice(0, 2);
  out.daytime = out.daytime ?? 'cualquiera';
  return out;
}
