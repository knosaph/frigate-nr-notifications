// ============================================================================
// Step 1: Event Change Detection
// ============================================================================
// Pipeline position: First filter after event ingestion.
// Purpose:  Determines whether a Frigate event contains meaningful changes
//           worth processing further. Drops trivial/redundant update messages
//           to prevent notification spam.
// Input:    msg.payload — raw Frigate MQTT event (before/after/type).
// Output:   msg with shouldSendUpdate=true, or null to drop the event.
// Drops:    Update events with no significant change in snapshot, sub-label,
//           zones, clip availability, or score.
// ============================================================================

const config = global.get('frigate_config') || {};
const event = msg.payload;

// --- Input validation ---
if (!event || !event.after) {
    if (config.debug) {
        node.warn('[Frigate:ChangeDetect] Missing event payload or after state');
    }
    return null;
}

const after = event.after || {};
const before = event.before || {};
const type = event.type || '';

// --- End events are always significant ---
if (type === 'end') {
    msg.shouldSendUpdate = true;
    return msg;
}

// --- For "new" and "update" events, require a meaningful change ---

// False positive cleared — Frigate initially marks every new detection as a
// false positive until score crosses its confidence threshold, then flips to
// false. This transition (true→false) is the real "confirmed detection"
// signal and is more reliable than type==="new" alone, which can fire before
// Frigate is confident. Happens exactly once per tracked object.
const fpCleared = before.false_positive === true && after.false_positive === false;

// Sub-label changed (e.g., face recognition updated)
const subLabelChanged = after.sub_label !== before.sub_label;

// Clip became available
const hasClipBecameTrue = !before.has_clip && after.has_clip;

// Current zones changed (can flutter at zone boundaries, so gated by score)
const currentZonesBefore = (before.current_zones || []).join(',');
const currentZonesAfter = (after.current_zones || []).join(',');
const currentZonesChanged = currentZonesBefore !== currentZonesAfter;

// Entered zones changed — this list is append-only in Frigate, so a change
// always means the object crossed into a genuinely new zone. Passed through
// unconditionally because directional zone filtering (step 5) depends on
// seeing every entered_zones update.
const enteredZonesBefore = (before.entered_zones || []).join(',');
const enteredZonesAfter = (after.entered_zones || []).join(',');
const enteredZonesChanged = enteredZonesBefore !== enteredZonesAfter;

// Score improved beyond configurable threshold
const scoreBefore = before.top_score || before.score || 0;
const scoreAfter = after.top_score || after.score || 0;
const improvementPct = config.score_improvement_pct || 0.02;
const scoreImproved = scoreAfter > scoreBefore * (1 + improvementPct);

// --- Decision ---
// Always pass: detection confirmed (FP cleared), clip became available,
// or object entered a new zone.
// Conditionally pass: sub-label or current-zone change, but only if score
// also improved (prevents noise from minor zone-boundary fluttering).
const shouldUpdate =
    fpCleared ||
    hasClipBecameTrue ||
    enteredZonesChanged ||
    ((subLabelChanged || currentZonesChanged) && scoreImproved);

if (!shouldUpdate) {
    return null;
}

msg.shouldSendUpdate = true;
return msg;