import { PLACES } from '../geo/geo.js';

/** Brisbane logistics network used by the dashboard simulation (all businesses are fictional). */
export const HUBS = [
  { id: 'EFD', name: 'Eagle Farm DC', kind: 'warehouse', lon: 153.08, lat: -27.43, capacity: 12_000, unit: 'pallets' },
  { id: 'ACR', name: 'Acacia Ridge Intermodal', kind: 'warehouse', lon: 153.03, lat: -27.58, capacity: 18_000, unit: 'pallets' },
  { id: 'YTL', name: 'Yatala Distribution', kind: 'warehouse', lon: 153.22, lat: -27.74, capacity: 9_000, unit: 'pallets' },
  { id: 'PBNE', name: 'Port of Brisbane', kind: 'seaport', lon: 153.17, lat: -27.38, capacity: 6_000, unit: 'TEU' },
  { id: 'BNEC', name: 'Brisbane Airport Cargo', kind: 'airport', lon: 153.12, lat: -27.39, capacity: 900, unit: 'ULD' },
];

export const ROAD_DESTINATIONS = [
  { id: 'GC', name: 'Gold Coast', km: 79 },
  { id: 'SC', name: 'Sunshine Coast', km: 105 },
  { id: 'TWB', name: 'Toowoomba', km: 125 },
  { id: 'IPS', name: 'Ipswich', km: 40 },
  { id: 'LGN', name: 'Logan', km: 30 },
  { id: 'RDC', name: 'Redcliffe', km: 36 },
  { id: 'BYR', name: 'Byron Bay', km: 165 },
  { id: 'SYDR', name: 'Sydney', km: 917 },
  { id: 'TSV', name: 'Townsville', km: 1_360 },
];

function greatCircleKm(a, b) {
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

const bne = PLACES.find((p) => p.id === 'BNE');
const pbne = PLACES.find((p) => p.id === 'PBNE');

export const AIR_DESTINATIONS = PLACES.filter((p) => p.kind === 'air' && p.id !== 'BNE').map((p) => ({
  id: p.id,
  name: p.name,
  km: Math.round(greatCircleKm(bne, p)),
}));

// sea lanes run ~25% longer than the great circle around coasts and reefs
export const SEA_DESTINATIONS = PLACES.filter((p) => p.kind === 'sea' && p.id !== 'PBNE').map((p) => ({
  id: p.id,
  name: p.name,
  km: Math.round(greatCircleKm(pbne, p) * 1.25 + 30),
}));

export const CARRIERS = {
  road: ['Jacaranda Haulage', 'Bunya Express', 'Moreton Freight Co.'],
  air: ['Brolga Air Cargo', 'Coral Wing'],
  sea: ['Coral Sea Lines', 'Southern Cross Shipping'],
};

export const CUSTOMERS = [
  'Bean & Bunya Coffee', 'Paddington Paper Co.', 'Wynnum Wharf Fish', 'Kangaroo Point Climbing', 'Valley Vinyl',
  'Mt Coot-tha Botanics', 'West End Woolworks', 'Story Bridge Brewing', 'Southbank Solar', 'Toowong Tools',
  'Bulimba Bikes', 'New Farm Florals', 'Woolloongabba Wheels', 'Spring Hill Spices',
];

export const DELAY_REASONS = {
  road: ['Traffic on the M1', 'Driver fatigue break', 'Mechanical fault', 'Roadworks', 'Loading dock queue'],
  air: ['Storm cell en route', 'Slot congestion', 'Customs hold', 'Late ULD build-up'],
  sea: ['Port congestion', 'Swell warning', 'Customs hold', 'Crane outage', 'Pilot boarding delay'],
};

/** kg CO2e per tonne-km (typical published averages). */
export const EMISSIONS = { road: 0.105, air: 0.602, sea: 0.016 };
/** effective km/h including handling */
export const SPEED_KMH = { road: 62, air: 640, sea: 27 };
export const HANDLING_H = { road: 1, air: 7, sea: 30 };
export const RATE_AUD_TKM = { road: 0.21, air: 2.6, sea: 0.045 };
export const FIXED_AUD = { road: 45, air: 180, sea: 420 };
/** shipments created per simulated hour (scaled by fleet size). */
export const SPAWN_PER_HOUR = { road: 14, air: 3, sea: 1.2 };
export const DELAY_P_PER_HOUR = { road: 0.012, air: 0.008, sea: 0.006 };

export const MODES = /** @type {const} */ (['road', 'air', 'sea']);
export const STATUSES = /** @type {const} */ (['Booked', 'In Transit', 'At Hub', 'Delayed', 'Delivered', 'Exception']);
