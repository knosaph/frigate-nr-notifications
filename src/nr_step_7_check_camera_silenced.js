// ============================================================================
// Step 7: User-Initiated Camera Silence Check
// ============================================================================
// Pipeline position: After quality filtering (step 6). Requires a preceding
//                    Node-RED node that fetches the HA entity defined in
//                    config.silence_table and stores its value in
//                    msg.silenceTable.
// Purpose:  Checks whether the current camera has been manually silenced by
//           the user (via the "Silence" action button on a notification).
//           The silence table is a JSON object stored in an HA input_text
//           entity, mapping camera names to Unix timestamps (silence-until).
//           Only user-initiated silences are checked here — there is no
//           automatic post-notification silencing.
// Input:    msg.eventData + msg.silenceTable (raw string from HA entity).
// Output:   msg if camera is not silenced, or null to drop.
// ============================================================================

const data = msg.eventData;
const config = data.config;

// --- Parse silence table ---
// The HA input_text entity stores JSON as a string. Single quotes may appear
// depending on how the value was written, so they're normalized to double
// quotes before parsing. Values of "unknown" or "unavailable" indicate the
// entity hasn't been initialized yet.
let silenceTable = {};
try {
    const raw = msg.silenceTable || '{}';
    if (raw && raw !== 'unknown' && raw !== 'unavailable') {
        silenceTable = JSON.parse(raw.replace(/'/g, '"'));
    }
} catch (e) {
    if (config.debug) {
        node.warn(`[Frigate:SilenceCheck] Failed to parse silence table: ${e.message}`);
    }
    silenceTable = {};
}

// --- Check if camera is currently silenced by user ---
const until = silenceTable[data.camera] || 0;
const nowTs = Math.floor(Date.now() / 1000);

if (nowTs < until) {
    if (config.debug) {
        const remaining = until - nowTs;
        node.warn(`[Frigate:SilenceCheck] Camera "${data.camera}" silenced for ${remaining}s more (until ${new Date(until * 1000).toISOString()})`);
    }
    return null;
}

return msg;