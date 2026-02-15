// ============================================================================
// Step 4: Label & Sub-Label Filtering
// ============================================================================
// Pipeline position: After camera filtering (step 3).
// Purpose:  1. Validates the detected object's label against the configured
//              allow list. An empty list means all labels are accepted.
//           2. Checks label + sub-label combinations against an exclusion list
//              (exclude_sub_labels). This allows filtering out known/expected
//              detections like a household member's car.
//           Camera-specific overrides for both labels and exclude_sub_labels
//           are applied automatically via the config merge in step 3.
// Input:    msg.eventData (with potentially merged camera config).
// Output:   msg if label/sub-label passes, or null to drop.
// ============================================================================

const data = msg.eventData;
const config = data.config;

// --- Label allow list ---
// Empty labels list = accept all labels
if (config.labels && config.labels.length > 0) {
    const allowedLabels = config.labels.map(l => l.toLowerCase());
    if (!allowedLabels.includes(data.label)) {
        if (config.debug) {
            node.warn(`[Frigate:LabelFilter] Label "${data.label}" not in allowed list: [${allowedLabels.join(', ')}]`);
        }
        return null;
    }
}

// --- Label + sub-label exclusion ---
// Each entry is a [label, sub_label_name] pair. If the event's label and
// sub-label name both match (case-insensitive), the event is dropped.
// Example config: "exclude_sub_labels": [["car", "Tom"]]
const excludeSubLabels = config.exclude_sub_labels || [];

if (excludeSubLabels.length > 0 && data.subLabelName) {
    const eventSubLabel = data.subLabelName.toLowerCase();
    const matched = excludeSubLabels.find(([label, subLabel]) =>
        label.toLowerCase() === data.label && subLabel.toLowerCase() === eventSubLabel
    );
    if (matched) {
        if (config.debug) {
            node.warn(`[Frigate:LabelFilter] Label "${data.label}" + sub-label "${data.subLabelName}" matched exclude_sub_labels — dropping`);
        }
        return null;
    }
}

return msg;