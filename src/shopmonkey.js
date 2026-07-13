// Shopmonkey v3 API client for Move Over Outfitters.
// Exports everything src/tools.js imports. Read functions use the
// POST /{entity}/search pattern with { where, limit } bodies.
//
// Env vars (set in Railway):
//   SHOPMONKEY_API_KEY     - API bearer token (SHOPMONKEY_API_TOKEN also accepted)
//   SHOPMONKEY_BASE_URL    - optional, defaults to https://api.shopmonkey.cloud/v3
//   SHOPMONKEY_PART_ENTITY - optional, inventory entity name (default "part")

const BASE_URL = (process.env.SHOPMONKEY_BASE_URL || "https://api.shopmonkey.cloud/v3").replace(/\/$/, "");
const TOKEN = process.env.SHOPMONKEY_API_KEY || process.env.SHOPMONKEY_API_TOKEN || "";
const PART_ENTITY = process.env.SHOPMONKEY_PART_ENTITY || "part";

async function request(method, path, body) {
  if (!TOKEN) throw new Error("SHOPMONKEY_API_KEY is not set");
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  if (!res.ok) {
    const msg = json?.message || json?.error || text || res.statusText;
    throw new Error(`Shopmonkey ${method} ${path} -> ${res.status}: ${msg}`);
  }
  // v3 responses wrap payloads in { data: ... }
  return json?.data !== undefined ? json.data : json;
}

const get = (path) => request("GET", path);
const post = (path, body) => request("POST", path, body);

// Build an OR "contains" clause across several text fields.
function textSearch(q, fields) {
  return { OR: fields.map((f) => ({ [f]: { contains: q } })) };
}

async function search(entity, { where, limit } = {}) {
  return post(`/${entity}/search`, {
    ...(where && Object.keys(where).length ? { where } : {}),
    limit: limit || 25,
  });
}

// ---------------------------------------------------------------------------
// Read functions (imported by tools.js)
// ---------------------------------------------------------------------------

export async function listOrders({ q, status, locationId, limit } = {}) {
  const where = {};
  if (q) {
    const asNumber = Number(q);
    where.OR = [
      ...(Number.isInteger(asNumber) ? [{ number: { equals: asNumber } }] : []),
      { name: { contains: q } },
      { customerName: { contains: q } },
      { vehicleName: { contains: q } },
    ];
  }
  if (status) where.status = { equals: status };
  if (locationId) where.locationId = { equals: locationId };
  return search("order", { where, limit: limit || 25 });
}

export async function getOrder(id) {
  return get(`/order/${id}`);
}

export async function listCustomers({ q, limit } = {}) {
  const where = q
    ? textSearch(q, ["firstName", "lastName", "companyName", "email", "phone"])
    : undefined;
  return search("customer", { where, limit: limit || 25 });
}

export async function getCustomer(id) {
  return get(`/customer/${id}`);
}

export async function listInventoryParts({ q, limit } = {}) {
  const where = q ? textSearch(q, ["name", "number", "brand"]) : undefined;
  return search(PART_ENTITY, { where, limit: limit || 25 });
}

export async function listAppointments({ startDate, endDate, locationId, limit } = {}) {
  const where = {};
  if (startDate || endDate) {
    where.startDate = {
      ...(startDate ? { gte: startDate } : {}),
      ...(endDate ? { lte: endDate } : {}),
    };
  }
  if (locationId) where.locationId = { equals: locationId };
  return search("appointment", { where, limit: limit || 20 });
}

export async function listLocations() {
  return search("location", { limit: 50 });
}

// ---------------------------------------------------------------------------
// Write functions (new in v1.1 — estimate creation from intake forms)
// ---------------------------------------------------------------------------

export async function createCustomer({ firstName, lastName, companyName, email, phone, locationId }) {
  const body = {
    ...(firstName ? { firstName } : {}),
    ...(lastName ? { lastName } : {}),
    ...(companyName ? { companyName, customerType: "COMMERCIAL" } : {}),
    ...(locationId ? { locationId } : {}),
    ...(email ? { emails: [{ email, primary: true }] } : {}),
    ...(phone ? { phoneNumbers: [{ number: phone, primary: true }] } : {}),
  };
  return post("/customer", body);
}

export async function createVehicle({ customerId, year, make, model, submodel, vin, unitNumber, color }) {
  const body = {
    customerId,
    ...(year ? { year: Number(year) } : {}),
    ...(make ? { make } : {}),
    ...(model ? { model } : {}),
    ...(submodel ? { submodel } : {}),
    ...(vin ? { vin } : {}),
    ...(unitNumber ? { unitNumber: String(unitNumber) } : {}),
    ...(color ? { color } : {}),
  };
  return post("/vehicle", body);
}

// Creates a work order in Estimate status, then adds one service per entry.
// Services are created by name (with optional note); pricing is attached in
// Shopmonkey afterward from canned services / labor rates.
export async function createEstimate({ locationId, customerId, vehicleId, name, note, services = [] }) {
  const order = await post("/order", {
    locationId,
    customerId,
    ...(vehicleId ? { vehicleId } : {}),
    status: "Estimate",
    ...(name ? { name } : {}),
    ...(note ? { note } : {}),
  });

  const orderId = order?.id;
  if (!orderId) throw new Error("Order created but no id returned; check response shape.");

  const created = [];
  const failed = [];
  for (const svc of services) {
    try {
      const result = await post("/service", {
        orderId,
        name: svc.name,
        ...(svc.note ? { note: svc.note } : {}),
      });
      created.push({ name: svc.name, id: result?.id });
    } catch (err) {
      failed.push({ name: svc.name, error: err.message });
    }
  }

  return { order, servicesCreated: created, servicesFailed: failed };
}

