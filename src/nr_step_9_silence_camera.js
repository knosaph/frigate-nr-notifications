// ============================================================================
// Step 9: Post-Notification Camera Silencing
// ============================================================================
// Pipeline position: Final step, runs after notifications have been sent.
// Purpose:  Updates the silence table in HA so that the camera that just
//           triggered a notification is temporarily silenced, preventing
//           rapid-fire duplicate notifications for the same camera.
//           The silence duration is config.auto_silence_secs (default 25s).
//           If the camera already has a longer silence window (e.g., the user
//           manually silenced it for 5 minutes), the longer window is kept.
//
// Dual output (Node-RED function node with 2 outputs):
//   Output 1 → HA "call service" node to persist the updated silence table.
//   Output 2 → Passes eventData downstream for any post-notification logic
//              (e.g., LLM summary generation, logging).
//
// Input:    msg.eventData (with silenceTable from step 7).
// Output:   [serviceCallMsg, eventDataMsg] or [null, msg] if disabled.
// ============================================================================

const data = msg.eventData;
const config = data.config;

// If no silence table entity is configured, skip the HA update but still
// pass eventData through on the second output for downstream processing.
if (!config.silence_table) {
    return [null, msg];
}

// --- Update silence table ---
const silenceTable = data.silenceTable || {};
const nowTs = Math.floor(Date.now() / 1000);
const autoSilenceSecs = config.auto_silence_secs || 25;

// Preserve any existing silence that extends beyond the auto-silence window
// (e.g., a user-initiated silence of several minutes).
const existing = silenceTable[data.camera] || 0;
const until = Math.max(existing, nowTs + autoSilenceSecs);
silenceTable[data.camera] = until;

if (config.debug) {
    node.warn(`[Frigate:Silence] Camera "${data.camera}" silenced until ${new Date(until * 1000).toISOString()} (${autoSilenceSecs}s auto-silence)`);
}

// --- Build HA service call to persist the silence table ---
msg.payload = {
    action: 'input_text.set_value',
    data: {
        entity_id: config.silence_table,
        value: JSON.stringify(silenceTable)
    }
};

return [msg, { eventData: data }];