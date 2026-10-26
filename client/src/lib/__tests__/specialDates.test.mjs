import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getSeason,
  getActiveSpecialDates,
  FAMILY_BIRTHDAYS,
  currentContext
} from '../specialDates.js';
import { mapWeatherCode } from '../weather.js';

test('getSeason: estaciones en el hemisferio sur', () => {
  // Verano: 21 dic - 20 mar
  assert.equal(getSeason(new Date(2026, 11, 21)), 'verano'); // 21 Dic
  assert.equal(getSeason(new Date(2026, 0, 15)), 'verano');  // 15 Ene
  assert.equal(getSeason(new Date(2026, 2, 20)), 'verano');  // 20 Mar

  // Otoño: 21 mar - 20 jun
  assert.equal(getSeason(new Date(2026, 2, 21)), 'otono');   // 21 Mar
  assert.equal(getSeason(new Date(2026, 3, 10)), 'otono');   // 10 Abr
  assert.equal(getSeason(new Date(2026, 5, 20)), 'otono');   // 20 Jun

  // Invierno: 21 jun - 20 sep
  assert.equal(getSeason(new Date(2026, 5, 21)), 'invierno'); // 21 Jun
  assert.equal(getSeason(new Date(2026, 6, 9)), 'invierno');  // 9 Jul
  assert.equal(getSeason(new Date(2026, 8, 20)), 'invierno'); // 20 Sep

  // Primavera: 21 sep - 20 dic
  assert.equal(getSeason(new Date(2026, 8, 21)), 'primavera'); // 21 Sep (Día de la Primavera)
  assert.equal(getSeason(new Date(2026, 9, 15)), 'primavera'); // 15 Oct
  assert.equal(getSeason(new Date(2026, 11, 20)), 'primavera'); // 20 Dic
});

test('getActiveSpecialDates: ventana de Halloween (25 al 31 de octubre)', () => {
  assert.deepEqual(getActiveSpecialDates(new Date(2026, 9, 24)), []);
  assert.deepEqual(getActiveSpecialDates(new Date(2026, 9, 25)), ['halloween']);
  assert.deepEqual(getActiveSpecialDates(new Date(2026, 9, 31)), ['halloween']);
  assert.deepEqual(getActiveSpecialDates(new Date(2026, 10, 1)), []);
});

test('getActiveSpecialDates: ventana de Navidad (20 al 26 de diciembre)', () => {
  assert.deepEqual(getActiveSpecialDates(new Date(2026, 11, 19)), []);
  assert.deepEqual(getActiveSpecialDates(new Date(2026, 11, 20)), ['navidad']);
  assert.deepEqual(getActiveSpecialDates(new Date(2026, 11, 25)), ['navidad']);
  assert.deepEqual(getActiveSpecialDates(new Date(2026, 11, 26)), ['navidad']);
  assert.deepEqual(getActiveSpecialDates(new Date(2026, 11, 27)), []);
});

test('getActiveSpecialDates: ventana de Año Nuevo con cambio de año (28 dic al 2 ene)', () => {
  assert.deepEqual(getActiveSpecialDates(new Date(2026, 11, 27)), []);
  assert.deepEqual(getActiveSpecialDates(new Date(2026, 11, 28)), ['anio-nuevo']);
  assert.deepEqual(getActiveSpecialDates(new Date(2026, 11, 31)), ['anio-nuevo']);
  assert.deepEqual(getActiveSpecialDates(new Date(2027, 0, 1)), ['anio-nuevo']);
  assert.deepEqual(getActiveSpecialDates(new Date(2027, 0, 2)), ['anio-nuevo']);
  assert.deepEqual(getActiveSpecialDates(new Date(2027, 0, 3)), []);
});

test('getActiveSpecialDates: cumpleaños familiares omiten placeholders nulos', () => {
  assert.equal(FAMILY_BIRTHDAYS.amelia, null);
  assert.equal(FAMILY_BIRTHDAYS.mariana, null);
  assert.equal(FAMILY_BIRTHDAYS.franco, null);

  // En una fecha aleatoria sin festividades no hay fechas especiales activas
  const active = getActiveSpecialDates(new Date(2026, 6, 15));
  assert.deepEqual(active, []);
});

test('getActiveSpecialDates: cumpleaños activo dentro de ventana ±3 días con cambio de año', () => {
  // Simulamos temporalmente una fecha para validar la ventana ±3 días y wrap-around
  FAMILY_BIRTHDAYS.amelia = '01-02';

  try {
    // 31 de diciembre del año anterior está a 2 días del 2 de enero
    const activeEve = getActiveSpecialDates(new Date(2026, 11, 31));
    assert.ok(activeEve.includes('cumple-amelia'));

    // 5 de enero está a 3 días del 2 de enero
    const activeAfter = getActiveSpecialDates(new Date(2027, 0, 5));
    assert.ok(activeAfter.includes('cumple-amelia'));

    // 6 de enero está a 4 días -> fuera de ventana
    const inactive = getActiveSpecialDates(new Date(2027, 0, 6));
    assert.ok(!inactive.includes('cumple-amelia'));
  } finally {
    FAMILY_BIRTHDAYS.amelia = null;
  }
});

test('currentContext: devuelve estructura consolidada', () => {
  const ctx = currentContext({ condition: 'lluvioso', isDay: false });
  assert.equal(ctx.weather, 'lluvioso');
  assert.equal(ctx.daytime, 'nocturno');
  assert.ok(['verano', 'otono', 'invierno', 'primavera'].includes(ctx.season));
  assert.ok(Array.isArray(ctx.specialDates));
});

test('mapWeatherCode: mapeo WMO canónico de Amelia', () => {
  // 0–1 soleado
  assert.equal(mapWeatherCode(0), 'soleado');
  assert.equal(mapWeatherCode(1), 'soleado');

  // 2–3 nublado
  assert.equal(mapWeatherCode(2), 'nublado');
  assert.equal(mapWeatherCode(3), 'nublado');

  // 45, 48 niebla
  assert.equal(mapWeatherCode(45), 'niebla');
  assert.equal(mapWeatherCode(48), 'niebla');

  // 51–67, 80–82 lluvioso
  assert.equal(mapWeatherCode(51), 'lluvioso');
  assert.equal(mapWeatherCode(61), 'lluvioso');
  assert.equal(mapWeatherCode(67), 'lluvioso');
  assert.equal(mapWeatherCode(80), 'lluvioso');
  assert.equal(mapWeatherCode(82), 'lluvioso');

  // 71–77, 85–86 nevado
  assert.equal(mapWeatherCode(71), 'nevado');
  assert.equal(mapWeatherCode(75), 'nevado');
  assert.equal(mapWeatherCode(77), 'nevado');
  assert.equal(mapWeatherCode(85), 'nevado');
  assert.equal(mapWeatherCode(86), 'nevado');

  // 95–99 tormenta
  assert.equal(mapWeatherCode(95), 'tormenta');
  assert.equal(mapWeatherCode(96), 'tormenta');
  assert.equal(mapWeatherCode(99), 'tormenta');

  // Códigos no contemplados o inválidos
  assert.equal(mapWeatherCode(999), 'soleado');
});
