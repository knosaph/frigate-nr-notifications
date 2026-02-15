// ============================================================================
// Step 8: Build Notification Payloads
// ============================================================================
// Pipeline position: After silence check (step 7), before notification
//                    dispatch.
// Purpose:  Constructs platform-specific notification payloads for each
//           configured device. Outputs an array of HA service call objects
//           in msg.notifications, ready to be iterated and dispatched by a
//           downstream Node-RED "call service" node.
// Input:    msg.eventData (fully filtered and validated).
// Output:   msg.notifications — array of {action, data} service call objects.
// ============================================================================

const data = msg.eventData;
const config = data.config;
const nowTs = Math.floor(Date.now() / 1000);

// --- Pre-compute values shared across platforms ---
const cameraEntityId = `camera.${data.camera}`;
const silenceAction = `SILENCE_frigate_ai__${data.camera}`;

// Notification tag — uses the Frigate event ID so each tracked object gets
// its own notification. Concurrent detections on the same camera (e.g., two
// people or three cars) each maintain independent notifications that update
// and expire on their own lifecycle. The group field still uses the camera
// name so the OS groups related notifications together visually.
const notificationTag = data.id;

// Android icon_url — label-based image shown as the notification's large
// icon (the circular "profile picture"). Place icon files in /local/icons/
// named by label (e.g., person.png, car.png, dog.png). Falls back to the
// label name; if the file doesn't exist, Android shows a default icon.
const LABEL_ICON_URLS = {
    person:        '/local/icons/person.png',
    car:           '/local/icons/car.png',
    dog:           '/local/icons/dog.png',
    cat:           '/local/icons/cat.png',
    truck:         '/local/icons/truck.png',
    bicycle:       '/local/icons/bicycle.png',
    motorcycle:    '/local/icons/motorcycle.png',
    package:       '/local/icons/package.png'
};
const iconUrl = LABEL_ICON_URLS[data.label] || `/local/icons/${data.label}.png`;

const notifications = [];

for (const device of config.notify_devices) {
    // Normalize service name to "notify.<service>" format
    const notifyService = device[0].startsWith('notify.')
        ? device[0]
        : `notify.${device[0]}`;
    const platform = device[1];

    if (platform === 'android') {
        notifications.push({
            action: notifyService,
            data: {
                title: data.title,
                message: data.message,
                data: {
                    // --- Notification channel & priority ---
                    channel: `${data.cameraName} Notifications`,
                    importance: 'high',
                    ttl: 0,
                    priority: 'high',

                    // --- Grouping & deduplication ---
                    // tag: per-event ID so concurrent detections don't clobber
                    // group: per-camera so the OS groups them visually
                    // alert_once: suppresses sound/vibration on updates
                    tag: notificationTag,
                    group: data.cameraName,
                    alert_once: true,

                    // --- Auto-dismiss ---
                    timeout: data.timeoutSecs,

                    // --- Visual customization ---
                    notification_icon: data.icon,
                    sticky: true,
                    color: 'red',
                    icon_url: iconUrl,

                    // --- Media attachment ---
                    // Cache-busted thumbnail for inline preview
                    image: `${data.thumbnailAndroid}&t=${nowTs}`,

                    // --- Click action ---
                    clickAction: data.hasClip ? data.clipUrl : data.snapshotUrl,

                    // --- Inline action buttons ---
                    actions: [
                        {
                            action: 'URI',
                            title: 'View Live',
                            uri: `entityId:${cameraEntityId}`
                        },
                        {
                            action: 'URI',
                            title: 'View Clip',
                            uri: data.clipUrl
                        },
                        {
                            action: silenceAction,
                            title: 'Silence'
                        }
                    ],

                    // --- Timestamp ---
                    when: nowTs
                }
            }
        });
    } else if (platform === 'ios') {
        notifications.push({
            action: notifyService,
            data: {
                title: data.title,
                message: data.message,
                data: {
                    // --- Subtitle ---
                    subtitle: 'Expand me, or just click for a live view.',

                    // --- Grouping & deduplication ---
                    tag: notificationTag,
                    group: data.cameraName,

                    // --- Click action ---
                    // iOS uses "url" instead of Android's "clickAction".
                    // HLS stream (videoIos) provides native iOS video playback.
                    url: data.hasClip ? data.videoIos : data.snapshotUrl,

                    // --- Media attachment ---
                    attachment: {
                        url: `${data.thumbnailUrl}?t=${nowTs}`
                    },

                    // --- Push / sound configuration ---
                    push: {
                        sound: {
                            name: 'Alarm_Haptic.caf',
                            critical: 1,
                            volume: 1
                        }
                    },

                    // --- APNS collapse (deduplication at OS level) ---
                    apns_headers: {
                        'apns-collapse-id': notificationTag
                    },

                    // --- Entity context ---
                    entity_id: cameraEntityId,

                    // --- Inline action buttons ---
                    actions: [
                        {
                            action: 'URI',
                            title: 'View Live',
                            uri: `entityId:${cameraEntityId}`
                        },
                        {
                            action: 'URI',
                            title: 'View Clip',
                            uri: data.hasClip ? data.videoIos : data.snapshotUrl
                        },
                        {
                            // Silence action with optional duration input.
                            // iOS supports inline text input on action buttons;
                            // the user can type a custom silence duration.
                            action: silenceAction,
                            title: 'Silence',
                            textInputButtonTitle: 'Submit',
                            textInputPlaceholder: 'Duration (minutes)'
                        }
                    ]
                }
            }
        });
    } else if (config.debug) {
        node.warn(`[Frigate:BuildNotify] Unknown device platform "${platform}" for service "${notifyService}" — skipping`);
    }
}

msg.notifications = notifications;
msg.eventData.bestScoreSent = data.score;

return msg;