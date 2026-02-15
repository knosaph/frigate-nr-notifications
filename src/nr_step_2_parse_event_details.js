// ============================================================================
// Step 2: Parse Event Details
// ============================================================================
// Pipeline position: After change detection (step 1), before all filters.
// Purpose:  Extracts and normalizes every relevant field from the raw Frigate
//           event, builds notification/media URLs, constructs display text,
//           and packages everything into msg.eventData for downstream use.
// Input:    msg.payload — raw Frigate MQTT event.
// Output:   msg.eventData — structured object consumed by steps 3-6+.
// ============================================================================

const config = global.get('frigate_config') || {};
const event = msg.payload;
const before = event.before || {};
const after = event.after || {};
const type = event.type || '';

// --- Basic Event Identity ---
const camera = (after.camera || before.camera || '').toLowerCase().replace(/-/g, '_');
const id = after.id || before.id || '';
const label = (after.label || '').toLowerCase();
// Sub-label — Frigate sends null, a plain string, or [name, score].
// Extract the name for clean display and downstream filtering.
const subLabelRaw = after.sub_label;
let subLabelName = '';
if (Array.isArray(subLabelRaw)) {
    subLabelName = String(subLabelRaw[0] || '');
} else if (subLabelRaw) {
    subLabelName = String(subLabelRaw);
}

// --- Detection Quality ---
const score = (after.top_score !== null && after.top_score !== undefined)
    ? after.top_score
    : (after.score || 0);

// --- Zone Data ---
// IMPORTANT: Frigate populates entered_zones in traversal order — the first
// element is the zone the tracked object initially appeared in. This ordering
// is relied upon by directional filtering in step 5 (exclude_initial_zones /
// require_initial_zones) to determine direction of approach.
const enteredZones = (after.entered_zones || []).map(z => z.toLowerCase());
const currentZones = (after.current_zones || []).map(z => z.toLowerCase());

// --- Clip & False Positive ---
const hasClip = after.has_clip || false;
const falsePositive = after.false_positive;

// --- Camera Display Name ---
let cameraName = camera.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
if (config.expand_cam) {
    cameraName = cameraName.replace(/\bcam\b/gi, 'Camera');
}
if (config.append_camera && !/camera$/i.test(cameraName)) {
    cameraName += ' Camera';
}

// --- Notification URLs ---
const baseUrl = config.base_url || '';
const clipUrl = baseUrl + `/api/frigate/notifications/${id}/${camera}/clip.mp4`;
const snapshotUrl = baseUrl + `/api/frigate/notifications/${id}/snapshot.jpg`;
const thumbnailUrl = baseUrl + `/api/frigate/notifications/${id}/thumbnail.jpg`;
const thumbnailAndroid = thumbnailUrl + '?format=android';
const videoIos = baseUrl + `/api/frigate/notifications/${id}/${camera}/master.m3u8`;

// --- Frigate Review URL ---
// When frigate_url is set, link directly to the Frigate UI.
// Otherwise fall back to the Home Assistant proxy path.
let frigateReviewUrl;
if (config.frigate_url) {
    const frigateBase = config.frigate_url.replace(/\/+$/, '').replace(/\/review$/, '');
    frigateReviewUrl = `${frigateBase}/review?camera=${camera}&id=${id}`;
} else {
    frigateReviewUrl = `${baseUrl}/api/frigate/review?camera=${camera}&id=${id}`;
}

// --- Icon Based on Label ---
const LABEL_ICONS = {
    person:        'mdi:account-outline',
    car:           'mdi:car',
    dog:           'mdi:dog',
    cat:           'mdi:cat',
    bird:          'mdi:bird',
    horse:         'mdi:horse',
    bicycle:       'mdi:bicycle',
    motorcycle:    'mdi:motorbike',
    bus:           'mdi:bus',
    truck:         'mdi:truck',
    boat:          'mdi:sail-boat',
    package:       'mdi:package-variant-closed',
    face:          'mdi:face-recognition',
    license_plate: 'mdi:card-text-outline'
};
const icon = LABEL_ICONS[label] || 'mdi:home-assistant';

// --- Notification Content ---
const labelTitle = label.charAt(0).toUpperCase() + label.slice(1);

// Short event ID suffix for debug correlation in notifications.
// E.g., "1771004900.390988-m5tkiw" → "m5tkiw"
const shortId = id.includes('-') ? id.split('-').pop() : id.slice(-6);

// Title includes sub-label when available so concurrent detections are
// distinguishable (e.g., "Camera 6 - Car (Tom)" vs "Camera 6 - Car").
let title = subLabelName
    ? `${cameraName} - ${labelTitle} (${subLabelName})`
    : `${cameraName} - ${labelTitle}`;

let message;

if (type === 'new') {
    message = `A new ${label} has been detected. [${shortId}]`;
} else if (type === 'update') {
    message = `A ${label} is still being detected. [${shortId}]`;
} else if (type === 'end') {
    message = `A ${label} is no longer detected. [${shortId}]`;
} else {
    message = `A ${label} has been detected. [${shortId}]`;
}

// --- Timeout ---
const timeoutSecs = (config.notification_timeout_hours || 10) * 3600;

// --- Package everything for downstream filters ---
msg.eventData = {
    config,
    event,
    camera,
    id,
    shortId,
    label,
    labelTitle,
    subLabelRaw,
    subLabelName,
    score,
    enteredZones,
    currentZones,
    hasClip,
    falsePositive,
    cameraName,
    clipUrl,
    snapshotUrl,
    thumbnailUrl,
    thumbnailAndroid,
    videoIos,
    frigateReviewUrl,
    icon,
    title,
    message,
    timeoutSecs,
    baseUrl,
    nowTs: Math.floor(Date.now() / 1000),
    bestScoreSent: 0
};

return msg;