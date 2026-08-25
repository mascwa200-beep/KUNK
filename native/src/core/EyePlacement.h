// EyePlacement.h -- putting the viewpoint at the character's eyes.
//
// The camera object carries a position that the engine updates every frame.
// First person needs that raised to eye height and nudged forward out of the
// head mesh. Both are small deltas on a value the engine already smooths for
// us, which is why they are applied here rather than being driven from the
// character position the Lua bridge publishes -- that arrives at 10 Hz and
// would visibly stutter while walking.
//
// The hazard, and the reason this is its own tested unit:
//
//   read position -> add eyeHeight -> write it back
//
// is a feedback loop the moment the engine does *not* refresh the field between
// our writes. Next frame we read our own output, add eyeHeight again, and the
// camera climbs into the sky at eyeHeight per frame. It would not show up in a
// quick test either, because the engine usually does refresh -- until a paused
// frame, a loading screen or a cutscene where it does not.
//
// The guard is to remember exactly what was written and compare against it. If
// this frame's read is that same value, the engine left our write in place, so
// the base to build on is the remembered pre-modification value, not what was
// read. The test suite runs 10,000 frames in each regime and asserts the eye
// position never drifts.
#pragma once

#include "Vec3.h"

namespace fpcam::core {

struct EyePlacementInput {
    Vec3 enginePosition;   // what was just read out of the camera object
    Vec3 forward;          // camera forward; flattened internally
    float eyeHeight = 1.62f;
    float forwardOffset = 0.12f;
    // Reads further than this from the last known base are treated as a genuine
    // engine update (a teleport, a level load) rather than as drift.
    float sanityRadius = 10000.0f;
};

struct EyePlacementOutput {
    bool write = false;   // false means "leave the game's value alone"
    Vec3 position;        // the value to write, when write is true
    // True when the engine had not refreshed the field and the remembered base
    // was used instead. Surfaced for the status log and the self-test.
    bool reusedBase = false;
};

class EyePlacement {
public:
    // Computes the eye position for this frame and records what will be
    // written. Call exactly once per frame, and only when the write actually
    // happens -- recording a write that did not occur would desynchronise the
    // guard.
    EyePlacementOutput Solve(const EyePlacementInput& input);

    // Forgets the remembered write. Call when first person is switched off, on
    // a level transition, or whenever the camera object pointer changes, since
    // a stale base would be compared against an unrelated structure.
    void Reset();

    bool HasBase() const { return hasBase_; }
    Vec3 Base() const { return base_; }

private:
    Vec3 base_;          // last engine-supplied position, before our delta
    Vec3 lastWritten_;   // exactly what we wrote last frame
    bool hasBase_ = false;
};

}  // namespace fpcam::core
