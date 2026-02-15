// ============================================================================
// Step 3: Camera Filtering + Override Merging
// ============================================================================
// Pipeline position: First filter after event parsing.
// Purpose:  1. Validates the event's camera against the configured allow list.
//           2. If the camera has entries in camera_overrides, shallow-merges
//              those overrides into msg.eventData.config. This means ALL
//              downstream filters (label, zone, quality) automatically use
//              camera-specific rules without any per-filter changes.
// Input:    msg.eventData (from step 2).
// Output:   msg with (optionally merged) config, or null to drop.
// ============================================================================

const data = msg.eventData;
const config = data.config;

// --- Validate camera against allow list ---
const configuredCameras = config.cameras.map(c => c.toLowerCase().replace(/-/g, '_'));

if (!configuredCameras.includes(data.camera)) {
    if (config.debug) {
        node.warn(`[Frigate:CameraFilter] Camera "${data.camera}" not in allowed list: [${configuredCameras.join(', ')}]`);
    }
    return null;
}

// --- Merge camera-specific overrides ---
// Any key present in the override replaces the global default for this camera.
// Example: camera_overrides.camera_8.exclude_initial_zones = ["Entryway"]
// would override the global exclude_initial_zones for camera_8 only.
const overrides = (config.camera_overrides || {})[data.camera] || {};

if (Object.keys(overrides).length > 0) {
    msg.eventData.config = { ...config, ...overrides };
    if (config.debug) {
        node.warn(`[Frigate:CameraFilter] Applied overrides for "${data.camera}": ${Object.keys(overrides).join(', ')}`);
    }
}

return msg;