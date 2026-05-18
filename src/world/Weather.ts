import * as THREE from 'three';

/**
 * Weather / time-of-day presets. Each preset is a complete lighting +
 * atmosphere set — sun direction & colour, hemisphere bounce, sky shader
 * uniforms, fog tint + range, and renderer exposure. Applied once at
 * scene-build time.
 */

export type WeatherId = 'day' | 'overcast' | 'sunset' | 'night';

export interface WeatherPreset {
  id: WeatherId;
  label: string;
  /** Direction the sun light points FROM (i.e. where the sun appears). */
  sunOffset: THREE.Vector3;
  sunColor: number;
  sunIntensity: number;
  hemiSky: number;
  hemiGround: number;
  hemiIntensity: number;
  /** Sky shader colours. */
  skyTop: number;
  skyHorizon: number;
  /** Sun-disc tint in the sky shader (super-1 components drive bloom). */
  skySunColor: THREE.Color;
  /** Fog + background base tint. */
  fogColor: number;
  fogNear: number;
  fogFar: number;
  /** Renderer tonemap exposure. */
  exposure: number;
}

export const WEATHER_PRESETS: Record<WeatherId, WeatherPreset> = {
  day: {
    id: 'day',
    label: 'Day',
    sunOffset: new THREE.Vector3(60, 75, 35),
    sunColor: 0xffe1b0,
    sunIntensity: 2.7,
    hemiSky: 0xbcd8ff,
    hemiGround: 0x6a5436,
    hemiIntensity: 0.85,
    skyTop: 0x6b88c4,
    skyHorizon: 0xe5cda3,
    skySunColor: new THREE.Color(2.0, 1.65, 1.15),
    fogColor: 0xc8b491,
    fogNear: 120,
    fogFar: 480,
    exposure: 1.08,
  },
  overcast: {
    id: 'overcast',
    label: 'Overcast',
    sunOffset: new THREE.Vector3(40, 130, 25),
    sunColor: 0xd6d8db,
    sunIntensity: 1.0,
    hemiSky: 0xc8d0d8,
    hemiGround: 0x5a5048,
    hemiIntensity: 1.45,
    skyTop: 0x99a4af,
    skyHorizon: 0xbfc5cb,
    skySunColor: new THREE.Color(0.55, 0.55, 0.6),
    fogColor: 0xb6bcc4,
    fogNear: 80,
    fogFar: 360,
    exposure: 0.9,
  },
  sunset: {
    id: 'sunset',
    label: 'Sunset',
    sunOffset: new THREE.Vector3(70, 22, 40),
    sunColor: 0xff8a4a,
    sunIntensity: 2.5,
    hemiSky: 0x6c5482,
    hemiGround: 0x4a2818,
    hemiIntensity: 0.75,
    skyTop: 0x3d2c5c,
    skyHorizon: 0xff7044,
    skySunColor: new THREE.Color(3.0, 1.4, 0.55),
    fogColor: 0xc06542,
    fogNear: 100,
    fogFar: 420,
    exposure: 1.18,
  },
  night: {
    id: 'night',
    label: 'Night',
    sunOffset: new THREE.Vector3(60, 75, 35),
    sunColor: 0x8ea3c8,
    sunIntensity: 0.45,
    hemiSky: 0x1a2438,
    hemiGround: 0x0c1014,
    hemiIntensity: 0.55,
    skyTop: 0x070b14,
    skyHorizon: 0x121d34,
    skySunColor: new THREE.Color(1.4, 1.4, 1.7), // moon disc
    fogColor: 0x0c1220,
    fogNear: 80,
    fogFar: 340,
    exposure: 1.25,
  },
};

const STORAGE_KEY = 'stuntline:weather';

export function loadWeather(): WeatherId {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v && v in WEATHER_PRESETS) return v as WeatherId;
  } catch {
    /* ignore */
  }
  return 'day';
}

export function saveWeather(id: WeatherId): void {
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch {
    /* ignore */
  }
}
