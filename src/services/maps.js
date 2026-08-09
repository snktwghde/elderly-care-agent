import axios from 'axios';
import { config } from '../config/env.js';
import { getCachedClinics, cacheClinics } from './supabase.js';

const MAPS_API = 'https://maps.googleapis.com/maps/api';

async function geocodeAddress(address) {
  const response = await axios.get(`${MAPS_API}/geocode/json`, {
    params: { address, key: config.maps.apiKey },
  });

  const result = response.data.results?.[0];
  if (!result) throw new Error(`Could not geocode address: ${address}`);

  return result.geometry.location; // { lat, lng }
}

async function searchNearby(lat, lng, keyword, pageToken = null) {
  const params = pageToken
    ? { pagetoken: pageToken, key: config.maps.apiKey }
    : { location: `${lat},${lng}`, rankby: 'distance', keyword, key: config.maps.apiKey };

  const response = await axios.get(`${MAPS_API}/place/nearbysearch/json`, { params });

  return {
    results: response.data.results || [],
    nextPageToken: response.data.next_page_token || null,
  };
}

async function getPlacePhone(placeId) {
  try {
    const response = await axios.get(`${MAPS_API}/place/details/json`, {
      params: {
        place_id: placeId,
        fields: 'formatted_phone_number',
        key: config.maps.apiKey,
      },
    });
    return response.data.result?.formatted_phone_number || null;
  } catch {
    return null;
  }
}

async function formatPlaces(places) {
  const phones = await Promise.all(places.map(p => getPlacePhone(p.place_id)));
  return places.map((place, i) => ({
    name: place.name,
    address: place.vicinity,
    rating: place.rating || null,
    reviews: place.user_ratings_total || null,
    phone: phones[i],
  }));
}

function mapSpecialtyKeyword(specialty) {
  const s = specialty.toLowerCase().trim();
  if (/bone|bones|ortho|hadde|हाडे|हड्डी/.test(s)) return 'orthopaedic hospital';
  if (/teeth|tooth|dental|dentist|dant|दात|daant|दाँत/.test(s)) return 'dental clinic';
  if (/eye|eyes|ophthal|dole|डोळे|aankh|आँख/.test(s)) return 'eye hospital';
  if (/heart|cardio|hruday|हृदय|dil|दिल/.test(s)) return 'cardiology hospital';
  if (/skin|derma|twacha|त्वचा/.test(s)) return 'dermatology clinic';
  if (/ent|ear\b|nose|throat|kan\b|कान|नाक|घसा/.test(s)) return 'ENT clinic';
  if (/neuro|brain|dimag/.test(s)) return 'neurology hospital';
  if (/gynae|gynec|women|mahila/.test(s)) return 'gynaecology hospital';
  if (/kidney|renal/.test(s)) return 'kidney hospital';
  if (/lung|chest|pulmon/.test(s)) return 'chest hospital';
  return `${specialty} hospital`;
}

export async function findNearbyClinics(homeAddress, specialty = null) {
  const cacheKey = `${homeAddress.toLowerCase().trim()}::${specialty || 'general'}`;

  const cached = await getCachedClinics(cacheKey).catch(() => null);
  if (cached) {
    return {
      clinics: cached.clinics,
      nextPageToken: null, // page tokens expire in minutes — never return a cached one
      lat: cached.lat,
      lng: cached.lng,
      keyword: cached.keyword,
    };
  }

  const { lat, lng } = await geocodeAddress(homeAddress);
  const keyword = specialty ? mapSpecialtyKeyword(specialty) : 'clinic';
  const { results } = await searchNearby(lat, lng, keyword);
  const clinics = await formatPlaces(results); // fetch phones for all results upfront

  const result = { clinics, lat, lng, keyword };
  cacheClinics(cacheKey, result).catch(e => console.error('[Maps cache write]', e.message));

  return result;
}
