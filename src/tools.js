import { z } from "zod";
import * as sm from "./shopmonkey.js";

// Trim noisy fields from list responses so Claude's context stays lean.
const DROP_KEYS = new Set([
  "meta",
  "metadata",
  "customFields",
  "createdById",
  "updatedById",
]);

function slim(value, depth = 0) {
  if (Array.isArray(value)) return value.map((v) => slim(v, depth));
  if (value && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (DROP_KEYS.has(k)) continue;
      if (v === null || v === undefined) continue;
      out[k] = slim(v, depth + 1);
    }
    return out;
  }
  return value;
}

function ok(data) {
  return { content: [{ type: "text", text: JSON.stringify(slim(data), null, 1) }] };
}

function fail(err) {
  return {
    isError: true,
    content: [{ type: "text", text: `Error: ${err.message}` }],
  };
}

const wrap = (fn) => async (args) => {
  try {
    return ok(await fn(args));
  } catch (err) {
    return fail(err);
  }
};

export function registerTools(server) {
  server.tool(
    "list_orders",
    "Search Shopmonkey work orders by free text (order number, customer, vehicle), optionally filtered by status or location.",
    {
      q: z.string().optional().describe("Search text: order number, customer name, or vehicle"),
      status: z.string().optional().describe("Order status filter, e.g. Estimate, WorkInProgress, Invoice, Complete"),
      locationId: z.string().optional().describe("Filter to a specific shop location ID"),
      limit: z.number().int().min(1).max(100).optional().describe("Max results (default 25)"),
    },
    wrap(sm.listOrders)
  );

  server.tool(
    "get_order",
    "Get full details for a single Shopmonkey work order by ID, including services, line items, and totals.",
    { id: z.string().describe("Shopmonkey order ID") },
    wrap(({ id }) => sm.getOrder(id))
  );

  server.tool(
    "list_customers",
    "Search Shopmonkey customers by name, company, phone, or email.",
    {
      q: z.string().optional().describe("Search text: name, company, phone, or email"),
      limit: z.number().int().min(1).max(100).optional(),
    },
    wrap(sm.listCustomers)
  );

  server.tool(
    "get_customer",
    "Get full details for a single Shopmonkey customer by ID, including vehicles on file.",
    { id: z.string().describe("Shopmonkey customer ID") },
    wrap(({ id }) => sm.getCustomer(id))
  );

  server.tool(
    "list_inventory_parts",
    "Search Shopmonkey parts inventory by part name, number, or brand. Returns quantity on hand, cost, and pricing.",
    {
      q: z.string().optional().describe("Part name, part number, or brand"),
      limit: z.number().int().min(1).max(100).optional(),
    },
    wrap(sm.listInventoryParts)
  );

  server.tool(
    "list_appointments",
    "List Shopmonkey appointments, optionally filtered by date range and location.",
    {
      startDate: z.string().optional().describe("ISO date/datetime — appointments starting on/after this"),
      endDate: z.string().optional().describe("ISO date/datetime — appointments starting on/before this"),
      locationId: z.string().optional().describe("Filter to a specific shop location ID"),
      limit: z.number().int().min(1).max(100).optional().describe("Max results (default 20)"),
    },
    wrap(sm.listAppointments)
  );

  server.tool(
    "list_locations",
    "List all shop locations (use to resolve location IDs for L1, L2, L3, Topeka, etc.).",
    {},
    wrap(() => sm.listLocations())
  );
}
