// ============================================================================
// Step 10: Build LLM-Enhanced Updated Notifications
// ============================================================================
// Pipeline position: Called after an "end" event has been processed by an LLM
//                    to generate a richer summary of the overall detection.
//                    Replaces the original notification (same tag) with an
//                    updated version containing the LLM-generated title and
//                    message.
// Input:    msg.eventData + msg.llmResponse (from LLM processing stage).
// Output:   msg.notifications — array of {action, data} service call objects,
//           matching the format used by step 8.
// ============================================================================

const data = msg.eventData;
const config = data.config;
const response = msg.llmResponse || {};
const nowTs = Math.floor(Date.now() / 1000);

// --- LLM-enhanced title and message ---
// Use the LLM-generated content if available, otherwise fall back to the
// default title/message constructed in step 2.
const title = (config.generate_title && response.response_title)
    ? response.response_title
    : data.title;

// Append the short event ID for debug correlation. data.message already
// includes it (set in step 2), so only append when using LLM text.
const rawMessage = response.response_text || data.message;
const message = response.response_text
    ? `${rawMessage} [${data.shortId}]`
    : rawMessage;

// --- Pre-compute values shared across platforms ---
const cameraEntityId = `camera.${data.camera}`;
const silenceAction = `SILENCE_frigate_ai__${data.camera}`;

// Must match the tag used in step 8 so this replaces the original
// notification for the same tracked object.
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
                title,
                message,
                data: {
                    // --- Notification channel & priority ---
                    channel: `${data.cameraName} Notifications`,
                    importance: 'high',
                    ttl: 0,
                    priority: 'high',

                    // --- Grouping & deduplication ---
                    tag: notificationTag,
                    group: data.cameraName,
                    alert_once: true,

                    // --- Auto-dismiss ---
                    timeout: data.timeoutSecs,

                    // --- Visual customization ---
                    notification_icon: data.icon,
                    sticky: false,
                    color: 'red',
                    icon_url: iconUrl,

                    // --- Media attachment ---
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
                title,
                message,
                data: {
                    // --- Subtitle ---
                    subtitle: 'Tap to view clip.',

                    // --- Grouping & deduplication ---
                    tag: notificationTag,
                    group: data.cameraName,

                    // --- Click action ---
                    url: data.hasClip ? data.videoIos : data.snapshotUrl,

                    // --- Media attachment ---
                    attachment: {
                        url: `${data.thumbnailUrl}?t=${nowTs}`
                    },

                    // --- Push / sound configuration ---
                    // No sound — this is a silent content update replacing the
                    // original notification with the LLM summary. The initial
                    // alert (step 8) already notified the user; re-alerting
                    // here would buzz them twice for every detection.
                    push: {},

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
        node.warn(`[Frigate:UpdateNotify] Unknown device platform "${platform}" for service "${notifyService}" — skipping`);
    }
}

msg.notifications = notifications;
return msg;