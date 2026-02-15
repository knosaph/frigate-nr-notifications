// ============================================================================
// Step 6: Quality Filtering
// ============================================================================
// Pipeline position: Final filter before notification dispatch.
// Purpose:  Validates detection quality metrics: confidence score, clip
//           availability, and false positive status. Camera-specific
//           thresholds (e.g., a higher min_score for a noisy camera) are
//           applied automatically via config overrides merged in step 3.
// Input:    msg.eventData (with potentially merged camera config).
// Output:   msg if all quality checks pass, or null to drop.
// ============================================================================

const data = msg.eventData;
const config = data.config;

// --- Minimum confidence score ---
const minScore = config.min_score || 0.6;

if (data.score < minScore) {
    if (config.debug) {
        node.warn(`[Frigate:QualityFilter] Score ${data.score.toFixed(3)} below minimum ${minScore} — dropping`);
    }
    return null;
}

// --- Clip availability ---
if (config.require_clip && !data.hasClip) {
    if (config.debug) {
        node.warn('[Frigate:QualityFilter] Clip required but not available — dropping');
    }
    return null;
}

// --- False positive flag ---
if (config.require_not_false_positive && data.falsePositive === true) {
    if (config.debug) {
        node.warn('[Frigate:QualityFilter] Event flagged as false positive — dropping');
    }
    return null;
}

return msg;