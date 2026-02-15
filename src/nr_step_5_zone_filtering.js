// ============================================================================
// Step 5: Zone Filtering
// ============================================================================
// Pipeline position: After label filtering (step 4).
// Purpose:  Applies zone-based filtering in four sequential stages:
//
//   Stage 1 — Directional filtering (exclude_initial_zones):
//       Drops event if the FIRST zone the object entered matches any pattern.
//       Frigate populates entered_zones in traversal order, so the first
//       element indicates where the object originated. This enables filtering
//       by direction of approach (e.g., ignore people leaving via "Entryway").
//
//   Stage 2 — Directional filtering (require_initial_zones):
//       Drops event if the first entered zone does NOT match any pattern.
//       Inverse of stage 1 (e.g., only notify for objects arriving from
//       "Street" or "Driveway").
//
//   Stage 3 — Zone exclusion (zones_exclude):
//       Drops event if the object is currently in or has entered any
//       excluded zone.
//
//   Stage 4 — Zone inclusion (zones):
//       If configured, requires the object to be in at least one (or all,
//       depending on zone_logic) of the specified zones.
//
// Pattern matching: Supports glob-style * (any chars) and ? (single char).
//                   Patterns are anchored (^...$) and case-insensitive.
//
// Input:    msg.eventData (with potentially merged camera config).
// Output:   msg with zoneMatch=true, or null to drop.
// ============================================================================

const data = msg.eventData;
const config = data.config;

/**
 * Converts a glob-style pattern to an anchored, case-insensitive RegExp.
 * Escapes all regex special characters except * and ?, then converts:
 *   * → .* (match any sequence of characters)
 *   ? → .  (match exactly one character)
 * Anchored with ^...$ to prevent partial matches.
 */
function globToRegex(pattern) {
    const escaped = pattern
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\*/g, '.*')
        .replace(/\?/g, '.');
    return new RegExp('^' + escaped + '$', 'i');
}

// ---- Stage 1: Directional Exclusion (exclude_initial_zones) ----
// Drop if the object's FIRST entered zone matches any exclusion pattern.
const excludeInitial = config.exclude_initial_zones || [];

if (excludeInitial.length > 0 && data.enteredZones.length > 0) {
    const firstZone = data.enteredZones[0];
    const matched = excludeInitial.find(p => globToRegex(p).test(firstZone));
    if (matched) {
        if (config.debug) {
            node.warn(`[Frigate:ZoneFilter] Initial zone "${firstZone}" matched exclude_initial_zones pattern "${matched}" — dropping`);
        }
        return null;
    }
}

// ---- Stage 2: Directional Requirement (require_initial_zones) ----
// Drop if a requirement is set but the first entered zone doesn't match.
const requireInitial = config.require_initial_zones || [];

if (requireInitial.length > 0) {
    if (data.enteredZones.length === 0) {
        if (config.debug) {
            node.warn('[Frigate:ZoneFilter] require_initial_zones is set but object has not entered any zones — dropping');
        }
        return null;
    }
    const firstZone = data.enteredZones[0];
    if (!requireInitial.some(p => globToRegex(p).test(firstZone))) {
        if (config.debug) {
            node.warn(`[Frigate:ZoneFilter] Initial zone "${firstZone}" did not match any require_initial_zones: [${requireInitial.join(', ')}] — dropping`);
        }
        return null;
    }
}

// ---- Determine which zones to evaluate for stages 3 & 4 ----
const matchType = config.zone_match_type || 'either';
let zonesToCheck;

if (matchType === 'entered') {
    zonesToCheck = data.enteredZones;
} else if (matchType === 'current') {
    zonesToCheck = data.currentZones;
} else {
    // "either" — union of both lists, deduplicated
    zonesToCheck = [...new Set([...data.enteredZones, ...data.currentZones])];
}

// ---- Stage 3: Zone Exclusion (zones_exclude) ----
// Drop if the object is in any excluded zone.
const excludeZones = config.zones_exclude || [];

for (const zone of zonesToCheck) {
    const matched = excludeZones.find(p => globToRegex(p).test(zone));
    if (matched) {
        if (config.debug) {
            node.warn(`[Frigate:ZoneFilter] Zone "${zone}" matched exclude pattern "${matched}" — dropping`);
        }
        return null;
    }
}

// ---- Stage 4: Zone Inclusion (zones) ----
// If no include zones are configured, all zones pass.
const includeZones = config.zones || [];

if (includeZones.length === 0) {
    msg.eventData.zoneMatch = true;
    return msg;
}

// Check with configured logic: "any" (at least one match) or "all" (every
// include pattern must match at least one zone the object is in).
const logic = config.zone_logic || 'any';
let includeOk;

if (logic === 'all') {
    includeOk = includeZones.every(pattern =>
        zonesToCheck.some(zone => globToRegex(pattern).test(zone))
    );
} else {
    includeOk = includeZones.some(pattern =>
        zonesToCheck.some(zone => globToRegex(pattern).test(zone))
    );
}

if (!includeOk) {
    if (config.debug) {
        node.warn(`[Frigate:ZoneFilter] Zones [${zonesToCheck.join(', ')}] did not match include zones [${includeZones.join(', ')}] (logic: ${logic}) — dropping`);
    }
    return null;
}

msg.eventData.zoneMatch = true;
return msg;