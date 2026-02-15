# Frigate Notification Pipeline for Node-RED

A modular, highly configurable notification pipeline that connects [Frigate NVR](https://frigate.video/) to iOS and Android devices via [Home Assistant](https://www.home-assistant.io/) and [Node-RED](https://nodered.org/). It extends Frigate's MQTT events system with multi-stage filtering and optional LLM-powered event summaries.

## What It Does

Frigate generates a high volume of MQTT events for every tracked object — often 20+ updates for a single person walking across a camera's field of view. Without filtering, every one of those updates would buzz your phone. This pipeline reduces that to **2-3 meaningful notifications per detection**, with rich context, platform-optimized formatting, and per-camera control.

**Key capabilities:**

- **Intelligent change detection** — Only processes events with meaningful state changes (confirmed detection, new zones entered, clip availability, score improvements)
- **6-stage filtering** — Camera, label, sub-label, zone (including directional), and quality filters run in sequence
- **Per-camera overrides** — Any global filter setting can be overridden for individual cameras
- **Directional zone filtering** — Filter based on *where an object came from*, not just where it is (e.g., ignore people leaving via the front door, only alert on arrivals from the driveway)
- **Concurrent detection support** — Multiple objects on the same camera get independent notifications that update and expire on their own lifecycle
- **User-initiated silence** — Tap "Silence" on any notification to mute that camera for a configurable duration
- **LLM-enhanced summaries** — When a detection ends, optionally send frames to an LLM for a natural-language summary that replaces the notification text
- **Platform-optimized** — Separate notification payloads for iOS (critical alerts, HLS video, inline text input) and Android (channels, sticky, icon_url, timeout)

## Frigate's Filtering vs. This Pipeline

Frigate's own configuration (`frigate.yml`) provides zone filtering, score thresholds, label selection, and more — but those settings control what Frigate **tracks, records, and shows in its Review UI**. The `frigate/events` MQTT topic that this pipeline consumes still receives events for *all* tracked objects, regardless of `required_zones` or per-zone filters.

This pipeline operates one layer above: it filters which detections become **phone notifications**, independently of what Frigate tracks. This separation is useful when you want Frigate to record everything but only bother you about specific scenarios:

- **Your own car** — Frigate records it (useful for reviewing when you left/arrived), but `exclude_sub_labels: [["car", "MyTesla"]]` prevents a notification every time you pull into the driveway
- **People leaving the house** — Frigate records them (security value), but `exclude_initial_zones: ["Foyer"]` means you only get notified about arrivals, not departures
- **Low-confidence detections** — Frigate tracks them with a low `min_score` to avoid missing real events, but this pipeline's `min_score` can be set higher so only confident detections reach your phone
- **Backyard wildlife** — Frigate tracks dogs/cats on your backyard camera for fun, but a camera override with `labels: ["person"]` ensures only people trigger a notification there

Features like directional zone filtering, sub-label exclusion, per-notification silence, and LLM summaries have no Frigate-side equivalent — they're purely additive.

## Pipeline Architecture

```
Frigate MQTT Event
      |
      v
[Step 1: Change Detection]      ← Drops trivial/redundant updates
      |
      v
[Step 2: Parse Event Details]   ← Extracts fields, builds URLs, constructs display text
      |
      v
[Step 3: Camera Filter]         ← Validates camera + merges per-camera overrides
      |
      v
[Step 4: Label Filter]          ← Validates label + checks sub-label exclusions
      |
      v
[Step 5: Zone Filter]           ← 4-stage: directional exclude → directional require
      |                              → zone exclude → zone include
      v
[Step 6: Quality Filter]        ← Score threshold, clip requirement, false positive check
      |
      v
[Step 7: Silence Check]         ← Checks user-initiated camera silence
      |
      v
[Step 8: Build Notifications]   ← Constructs platform-specific payloads (iOS + Android)
      |
      v
[Dispatch to HA notify services]
      |
      v
[Step 10: LLM Summary]          ← (On "end" events only) Replaces notification with
                                     LLM-generated summary
```

A separate **Silence Action Flow** handles the "Silence" button pressed on notifications — it listens for `mobile_app_notification_action` events, updates a silence table stored in an HA `input_text` entity, and clears the notification on all devices.

## Files

| File | Purpose |
|------|---------|
| `nr_step_0_config.json` | Central configuration (stored in Node-RED global context as `frigate_config`) |
| `nr_step_1_worth_using.js` | Event change detection — first filter |
| `nr_step_2_parse_event_details.js` | Event parsing, URL construction, display text |
| `nr_step_3_camera_filtering.js` | Camera validation + per-camera override merging |
| `nr_step_4_label_filtering.js` | Label allow-list + sub-label exclusion |
| `nr_step_5_zone_filtering.js` | 4-stage zone filtering with directional support |
| `nr_step_6_quality_filtering.js` | Score, clip, and false positive checks |
| `nr_step_7_check_camera_silenced.js` | User-initiated silence check |
| `nr_step_8_build_notifications.js` | Platform-specific notification payloads |
| `nr_step_10_build_updated_notifications.js` | LLM-enhanced notification update |
| `nr_silence_flow.json` | Complete Node-RED flow for the silence action handler |

Each JavaScript file is a self-contained Node-RED function node. The comments at the top of each file describe its inputs, outputs, and pipeline position.

<img width="3245" height="1895" alt="Flow" src="https://github.com/user-attachments/assets/2b0165f9-0f3b-4923-b7d3-263ce79e1d88" />

## Setup

### Prerequisites

- **Frigate NVR** with MQTT enabled
- **Home Assistant** with the [Frigate integration](https://github.com/blakeblackshear/frigate-hass-integration)
- **Node-RED** with `node-red-contrib-home-assistant-websocket`
- **HA Companion App** on iOS and/or Android

### Installation

1. **Create the silence table entity** in Home Assistant (`Settings > Helpers > Text`):
   - Entity ID: `input_text.frigate_silence_table`
   - Max length: 255
   - Initial value: `{}`

2. **Load the config** into Node-RED global context. Create an inject node (fires on startup) wired to a function node that sets:
   ```javascript
   global.set('frigate_config', /* paste contents of nr_step_0_config.json */);
   ```

3. **Create the pipeline** in Node-RED:
   - Add an **MQTT In** node subscribed to `frigate/events`
   - Wire it through **function nodes** for steps 1-8 in sequence
   - After step 8, add a **split node** (to iterate `msg.notifications`) wired to an **HA call-service node**
   - For LLM support: branch `type === 'end'` events after step 8 to your LLM processing flow, then to step 10

4. **Import the silence flow** from `nr_silence_flow.json` via Node-RED's import menu

5. **Customize `nr_step_0_config.json`** for your environment (cameras, devices, URLs, etc.)

### Optional: Notification Icons

For Android's `icon_url` feature (label-based notification icons), place PNG images in your Home Assistant `www/icons/` directory:

```
www/icons/person.png
www/icons/car.png
www/icons/dog.png
www/icons/cat.png
www/icons/truck.png
www/icons/bicycle.png
www/icons/motorcycle.png
www/icons/package.png
```

These appear as the circular "profile picture" on Android notifications.

## Configuration Reference

All settings live in `nr_step_0_config.json` and are accessed at runtime via `global.get('frigate_config')`.

### Detection Filters

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `cameras` | `string[]` | `[]` | Camera names to process. Events from unlisted cameras are dropped. Names are normalized (lowercased, hyphens to underscores). |
| `labels` | `string[]` | `[]` | Object labels to process (e.g., `"person"`, `"car"`, `"dog"`). Empty list = accept all labels. |
| `exclude_sub_labels` | `[string, string][]` | `[]` | Label + sub-label pairs to exclude. Each entry is `[label, sub_label_name]`. Case-insensitive. Example: `[["car", "Chris"]]` drops events for a car recognized as "Chris". |

### Zone Filters

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `zones` | `string[]` | `[]` | Zone inclusion list. If non-empty, the object must be in at least one (or all, per `zone_logic`) of these zones. Supports glob patterns (`*`, `?`). Empty list = no zone requirement. |
| `zones_exclude` | `string[]` | `[]` | Zone exclusion list. Events are dropped if the object is in any of these zones. Supports glob patterns. |
| `zone_match_type` | `string` | `"either"` | Which zone list to evaluate for include/exclude checks: `"entered"` (all zones ever visited), `"current"` (zones the object is in right now), or `"either"` (union of both). |
| `zone_logic` | `string` | `"any"` | Logic for the zone inclusion list: `"any"` (at least one zone matches) or `"all"` (every listed zone must match). |
| `exclude_initial_zones` | `string[]` | `[]` | **Directional filtering.** Drops events where the object's *first* entered zone matches any pattern. Useful for ignoring objects that originated from inside the house (e.g., `["Entryway"]`). |
| `require_initial_zones` | `string[]` | `[]` | **Directional filtering.** Drops events where the object's first entered zone does *not* match any pattern. Useful for only alerting on objects arriving from specific directions (e.g., `["Driveway", "Street"]`). |

#### How Directional Filtering Works

Frigate populates `entered_zones` in traversal order — the first element is the zone where the tracked object was initially detected. This ordering allows filtering based on the *direction of approach*, not just presence:

- A person walking **from the street to your front door** would have `entered_zones: ["Street", "Walkway", "Porch"]` — first zone is `"Street"`
- The same person walking **from inside to the street** would have `entered_zones: ["Porch", "Walkway", "Street"]` — first zone is `"Porch"`

With `exclude_initial_zones: ["Porch"]`, the second scenario (leaving) would be filtered out while the first (arriving) would pass through.

#### Glob Pattern Syntax

Zone name patterns support:
- `*` — matches any sequence of characters (e.g., `"Front*"` matches `"Front Yard"`, `"Front Porch"`)
- `?` — matches exactly one character
- Patterns are **anchored** and **case-insensitive** — `"Deck"` matches only `"Deck"`, not `"DeckStairs"`

### Quality Filters

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `min_score` | `number` | `0.6` | Minimum detection confidence score (0-1). Events below this threshold are dropped. |
| `score_improvement_pct` | `number` | `0.02` | For change detection (step 1): minimum percentage improvement in score required before a sub-label or current-zone change triggers a pass-through. Prevents noise from minor fluctuations. `0.02` = 2%. |
| `require_clip` | `boolean` | `false` | If `true`, drops events that don't have a clip available. |
| `require_not_false_positive` | `boolean` | `true` | If `true`, drops events that Frigate has flagged as false positives. |

### Camera Overrides

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `camera_overrides` | `object` | `{}` | Per-camera configuration overrides. Keys are camera names; values are objects containing any config keys to override. |

Any key from the global config can be overridden per camera. Overrides are shallow-merged in step 3, so all downstream filters automatically use the camera-specific values.

**Example:** Give `camera_8` its own directional zone filter and a higher score threshold:

```json
{
    "camera_overrides": {
        "camera_8": {
            "exclude_initial_zones": ["Entryway"],
            "min_score": 0.75
        }
    }
}
```

You can also override labels, zones, sub-label exclusions, or any other filter setting per camera:

```json
{
    "camera_overrides": {
        "driveway_cam": {
            "labels": ["person", "car", "truck", "package"],
            "min_score": 0.5,
            "zones": ["Driveway", "Street"],
            "exclude_sub_labels": [["car", "MyTruck"]]
        },
        "backyard_cam": {
            "labels": ["person", "dog", "cat"],
            "exclude_initial_zones": ["DogDoor"]
        }
    }
}
```

### Notification Settings

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `notify_devices` | `[string, string][]` | `[]` | Devices to notify. Each entry is `[service_name, platform]`. The service name can be with or without the `notify.` prefix. Platform must be `"android"` or `"ios"`. |
| `notification_timeout_hours` | `number` | `10` | Auto-dismiss notifications after this many hours (Android only). |
| `silence_table` | `string` | `"input_text.frigate_silence_table"` | HA entity ID for the silence table (JSON stored as text). |

**Example notify_devices:**
```json
{
    "notify_devices": [
        ["mobile_app_pixel_8", "android"],
        ["mobile_app_my_iphone", "ios"]
    ]
}
```

### Display Settings

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `expand_cam` | `boolean` | `true` | Expand "cam" to "Camera" in display names (e.g., "Front Cam" becomes "Front Camera"). |
| `append_camera` | `boolean` | `false` | Append "Camera" to display names that don't already end with it (e.g., "Driveway" becomes "Driveway Camera"). |

### LLM Settings

These control the optional LLM-enhanced notification feature (step 10). When a detection ends (`type === 'end'`), frames from the event can be sent to an LLM to generate a natural-language summary.

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `provider` | `string` | — | LLM provider identifier. |
| `model` | `string` | — | LLM model to use (e.g., `"gemini-2.0-flash"`). |
| `max_frames` | `number` | `3` | Maximum number of frames to send to the LLM. |
| `max_tokens` | `number` | `20` | Maximum tokens in LLM response. |
| `temperature` | `number` | `0.1` | LLM temperature (lower = more deterministic). |
| `target_width` | `number` | `1920` | Target width for frame resizing before LLM processing. |
| `prompt` | `string` | — | System prompt for the LLM summarization. |
| `generate_title` | `boolean` | `true` | Whether the LLM should also generate a replacement title. |
| `expose_images` | `boolean` | `true` | Whether to expose image URLs in the LLM request. |
| `include_filename` | `boolean` | `false` | Whether to include the source filename in LLM context. |
| `frigate_retry_attempts` | `number` | `5` | Number of retries when fetching frames from Frigate. |
| `frigate_retry_seconds` | `number` | `60` | Total timeout for Frigate frame fetching retries. |
| `busy_helper` | `string` | — | HA `input_boolean` entity ID used to indicate the LLM is processing (prevents concurrent requests). |

### URL Settings

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `base_url` | `string` | — | External Home Assistant URL (used for notification links). |
| `local_url` | `string` | — | Internal Home Assistant URL (used for server-side API calls). |
| `frigate_url` | `string` | — | Direct Frigate URL (used for review links). If unset, falls back to the HA proxy path. |

### Debug

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `debug` | `boolean` | `false` | Enables verbose debug logging via `node.warn()` in every pipeline stage. Logs include a `[Frigate:<Stage>]` prefix for easy filtering. |

## Example Use Cases

### Basic Setup — Person and Car Detection

Notify on people and cars across all cameras:

```json
{
    "cameras": ["front_door", "driveway", "backyard"],
    "labels": ["person", "car"],
    "min_score": 0.6,
    "notify_devices": [
        ["mobile_app_my_phone", "android"]
    ],
    "base_url": "https://my-ha-instance.duckdns.org"
}
```

### Ignore Your Own Car

Your car is recognized by Frigate's sub-label feature. Exclude it from notifications:

```json
{
    "labels": ["person", "car"],
    "exclude_sub_labels": [
        ["car", "MyTesla"],
        ["car", "WifeHonda"]
    ]
}
```

### Directional Filtering — Front Door Camera

Only alert when someone is **arriving** (approaching from the street), not when household members are **leaving** (coming from inside):

```json
{
    "camera_overrides": {
        "front_door": {
            "exclude_initial_zones": ["Foyer", "Hallway"]
        }
    }
}
```

Or the inverse — only notify for objects arriving from specific zones:

```json
{
    "camera_overrides": {
        "front_door": {
            "require_initial_zones": ["Sidewalk", "Street"]
        }
    }
}
```

### Zone-Based Filtering

Only notify when a person reaches the porch (not just passing on the sidewalk):

```json
{
    "zones": ["Porch", "Front Door"],
    "zone_match_type": "entered",
    "zone_logic": "any"
}
```

Exclude detections in the garage (automatic opener triggers false positives):

```json
{
    "zones_exclude": ["Garage*"]
}
```

### Different Rules Per Camera

Driveway needs cars and people; backyard only needs people with a higher score threshold:

```json
{
    "cameras": ["driveway", "backyard", "front_door"],
    "labels": ["person"],
    "min_score": 0.6,
    "camera_overrides": {
        "driveway": {
            "labels": ["person", "car", "truck", "package"],
            "min_score": 0.5
        },
        "backyard": {
            "min_score": 0.8,
            "labels": ["person"]
        }
    }
}
```

Each device gets a platform-optimized notification:
- **Android**: Notification channels, auto-dismiss timeout, sticky during active tracking, icon_url, cache-busted thumbnails
- **iOS**: Critical alerts with haptic sound, HLS video playback, APNS collapse ID, inline text input on the Silence button for custom duration

## Notification Features

### Notification Content

- **Title**: `"Camera Name - Label"` or `"Camera Name - Label (SubLabel)"` when a sub-label is present
- **Message**: `"A new person has been detected. [m5tkiw]"` — includes a short event ID suffix for debug correlation
- **LLM update** (step 10): When the detection ends, the title and message are replaced with an LLM-generated summary. The update is delivered silently (no re-alert).

### Action Buttons

Each notification includes three action buttons:

1. **View Live** — Opens the camera's live view in the HA Companion App
2. **View Clip** — Opens the event clip (MP4 on Android, HLS on iOS) or falls back to snapshot
3. **Silence** — Silences the camera for a configurable duration. On iOS, a text input allows typing a custom duration in minutes (1-120). Default is 15 minutes.

### Concurrent Detections

Each tracked object gets its own notification (tagged by Frigate event ID). If three cars arrive on the same camera simultaneously, you get three independent notifications that each update and expire on their own lifecycle. The OS groups them visually by camera name.

Sub-labels (when available) and short event IDs help distinguish concurrent detections of the same label type.

### Silence Behavior

The **Silence** button on notifications triggers a flow (`nr_silence_flow.json`) that:

1. Captures the button press via HA's `mobile_app_notification_action` event
2. Extracts the camera name from the action identifier (`SILENCE_frigate_ai__<camera>`)
3. Parses the duration from iOS text input (or uses the 15-minute default)
4. Merges the silence entry into the silence table, preserving any longer existing silence
5. Persists the table to an HA `input_text` entity
6. Clears the notification on all configured devices

While silenced, all notifications for that camera are suppressed (checked in step 7). Other cameras continue to notify normally.

## How Change Detection Works (Step 1)

Frigate sends many update events per tracked object. Step 1 acts as a gatekeeper, only passing events with meaningful changes:

| Condition | Always Passes? | Notes |
|-----------|:--------------:|-------|
| `type === 'end'` | Yes | Detection ended — triggers LLM summary |
| `false_positive` flipped `true → false` | Yes | Frigate confirmed the detection is real. More reliable than `type === 'new'`. |
| `has_clip` flipped `false → true` | Yes | Clip became available |
| `entered_zones` changed | Yes | Object crossed into a new zone (append-only list, so always significant) |
| `sub_label` or `current_zones` changed | Only if score also improved | Prevents noise from minor zone-boundary fluttering |

All other update events (path data changes, minor score fluctuations, etc.) are dropped.
