import axios from 'axios';
import { config } from '../config/env.js';

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

export async function findNearbyClinics(homeAddress, specialty = null) {
  const { lat, lng } = await geocodeAddress(homeAddress);
  const keyword = specialty ? `${specialty} hospital` : 'clinic';
  const { results, nextPageToken } = await searchNearby(lat, lng, keyword);
  const clinics = await formatPlaces(results.slice(0, 5));
  return { clinics, nextPageToken, lat, lng, keyword };
}

export async function findMoreClinics(pageToken) {
  // Google requires a short delay before using a page token
  await new Promise(resolve => setTimeout(resolve, 2000));
  const { results, nextPageToken } = await searchNearby(null, null, null, pageToken);
  const clinics = await formatPlaces(results.slice(0, 5));
  return { clinics, nextPageToken };
}
