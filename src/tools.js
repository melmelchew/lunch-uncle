/**
 * Tool definitions and implementations for Lunch Uncle.
 *
 * Each tool is split in two: a fetch function that talks to the network,
 * and a pure format function that shapes the response for the model.
 * The format functions are the ones covered by tests.
 */

// CT Hub 2, 114 Lavender Street.
export const CT_HUB_2 = { latitude: 1.3115, longitude: 103.8615 };

const SEARCH_RADIUS_METRES = 800;
const MAX_PLACES = 6;
const MAX_REVIEW_SNIPPETS = 3;
const REVIEW_SNIPPET_CHARS = 200;
const FORECAST_AREA = "Kallang";

const PLACES_URL = "https://places.googleapis.com/v1/places:searchText";
const FORECAST_URL =
  "https://api-open.data.gov.sg/v2/real-time/api/two-hr-forecast";
const BUS_URL = "https://arrivelah2.busrouter.sg/";

// ---------------------------------------------------------------------------
// Definitions sent to the model
// ---------------------------------------------------------------------------

export const toolDefinitions = [
  {
    type: "function",
    function: {
      name: "find_lunch_places",
      description:
        "Search for places to eat near CT Hub 2. Returns name, rating, distance, whether it is open now, price level and range, a short description, and snippets from recent reviews.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description:
              'What to search for, e.g. "chicken rice", "japanese", "cheap lunch".',
          },
          open_now: {
            type: "boolean",
            description: "Only return places that are open right now.",
          },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_rain_forecast",
      description:
        "Get the two-hour weather forecast for the Kallang area, which covers CT Hub 2.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "get_bus_arrivals",
      description:
        "Get the next bus arrivals at a Singapore bus stop, by five-digit stop code.",
      parameters: {
        type: "object",
        properties: {
          stop_code: {
            type: "string",
            description: 'Five-digit bus stop code, e.g. "07371".',
          },
        },
        required: ["stop_code"],
      },
    },
  },
];

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

/**
 * Run one tool call requested by the model and return the result as a string.
 */
export async function executeTool(name, args, env) {
  switch (name) {
    case "find_lunch_places":
      return JSON.stringify(await findLunchPlaces(args, env));
    case "get_rain_forecast":
      return JSON.stringify(await getRainForecast());
    case "get_bus_arrivals":
      return JSON.stringify(await getBusArrivals(args));
    default:
      return JSON.stringify({ error: `Unknown tool: ${name}` });
  }
}

// ---------------------------------------------------------------------------
// find_lunch_places
// ---------------------------------------------------------------------------

async function findLunchPlaces({ query, open_now = false }, env) {
  const body = {
    textQuery: query,
    includedType: "restaurant",
    openNow: open_now,
    pageSize: MAX_PLACES,
    locationBias: {
      circle: { center: CT_HUB_2, radius: SEARCH_RADIUS_METRES },
    },
  };

  const res = await fetch(PLACES_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "X-Goog-Api-Key": env.GOOGLE_PLACES_API_KEY,
      "X-Goog-FieldMask":
        "places.id,places.displayName,places.location,places.rating,places.currentOpeningHours," +
        "places.priceLevel,places.priceRange,places.editorialSummary,places.reviews",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    return { error: `Places API returned ${res.status}` };
  }

  const data = await res.json();
  return { places: formatPlaces(data.places ?? [], CT_HUB_2) };
}

/**
 * Shape Places API results into the fields Uncle needs.
 */
export function formatPlaces(places, origin) {
  return places.map((place) => ({
    name: place.displayName?.text ?? "Unnamed",
    rating: place.rating ?? null,
    distance_m: place.location
      ? Math.round(haversineMetres(origin, place.location))
      : null,
    open_now: place.currentOpeningHours?.openNow ?? null,
    price_level: formatPriceLevel(place.priceLevel),
    price_range: formatPriceRange(place.priceRange),
    description: place.editorialSummary?.text ?? null,
    review_snippets: formatReviewSnippets(place.reviews),
  }));
}

const PRICE_LEVELS = {
  PRICE_LEVEL_FREE: "free",
  PRICE_LEVEL_INEXPENSIVE: "cheap",
  PRICE_LEVEL_MODERATE: "moderate",
  PRICE_LEVEL_EXPENSIVE: "expensive",
  PRICE_LEVEL_VERY_EXPENSIVE: "very expensive",
};

/**
 * Turn a Places priceLevel enum into a plain word, or null if unknown.
 */
export function formatPriceLevel(priceLevel) {
  return PRICE_LEVELS[priceLevel] ?? null;
}

/**
 * Turn a Places priceRange into text like "SGD 10-20" or "SGD 50+".
 */
export function formatPriceRange(priceRange) {
  const start = priceRange?.startPrice;
  if (!start?.units) {
    return null;
  }
  const currency = start.currencyCode ?? "";
  const end = priceRange.endPrice?.units;
  const amount = end ? `${start.units}-${end}` : `${start.units}+`;
  return `${currency} ${amount}`.trim();
}

/**
 * Keep a few short review texts so Uncle can mention dishes people talk about.
 */
export function formatReviewSnippets(reviews) {
  return (reviews ?? [])
    .map((r) => (r.text?.text ?? r.originalText?.text ?? "").trim())
    .filter(Boolean)
    .slice(0, MAX_REVIEW_SNIPPETS)
    .map((text) =>
      text.length > REVIEW_SNIPPET_CHARS
        ? `${text.slice(0, REVIEW_SNIPPET_CHARS).trimEnd()}...`
        : text,
    );
}

/**
 * Great-circle distance between two {latitude, longitude} points, in metres.
 */
export function haversineMetres(a, b) {
  const R = 6371000;
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// ---------------------------------------------------------------------------
// get_rain_forecast
// ---------------------------------------------------------------------------

async function getRainForecast() {
  const res = await fetch(FORECAST_URL);
  if (!res.ok) {
    return { error: `Forecast API returned ${res.status}` };
  }
  return formatForecast(await res.json(), FORECAST_AREA);
}

/**
 * Pull one area's forecast out of the data.gov.sg two-hour forecast payload.
 */
export function formatForecast(payload, area) {
  const item = payload?.data?.items?.[0];
  if (!item) {
    return { error: "No forecast available" };
  }
  const entry = item.forecasts.find((f) => f.area === area);
  return {
    area,
    forecast: entry?.forecast ?? "Unknown",
    valid_period: item.valid_period?.text ?? null,
  };
}

// ---------------------------------------------------------------------------
// get_bus_arrivals
// ---------------------------------------------------------------------------

async function getBusArrivals({ stop_code }) {
  const url = `${BUS_URL}?id=${encodeURIComponent(stop_code)}`;
  const res = await fetch(url);
  if (!res.ok) {
    return { error: `Bus API returned ${res.status}` };
  }
  return formatBusArrivals(await res.json(), stop_code);
}

/**
 * Reduce an arrivelah response to service numbers and minutes to arrival.
 */
export function formatBusArrivals(payload, stopCode) {
  const services = payload?.services ?? [];
  return {
    stop_code: stopCode,
    services: services.map((s) => ({
      service: s.no,
      next_min: minutesFromNow(s.next),
      subsequent_min: minutesFromNow(s.subsequent),
    })),
  };
}

function minutesFromNow(arrival) {
  if (!arrival || typeof arrival.duration_ms !== "number") {
    return null;
  }
  return Math.max(0, Math.round(arrival.duration_ms / 60000));
}
