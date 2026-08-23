# Finding the camera on your game build

## Why nothing here ships pre-solved

Baldur's Gate 3's executable is stripped of symbols and re-linked on every
patch. There is no exported function, no debug symbol and no stable address for
the camera. The only way a mod reaches it is by recognising a byte pattern in
the compiled code, and a byte pattern is only valid for the exact build it was
derived from — a hotfix that changes an unrelated function can shift the
instruction encodings around the camera code and invalidate it.

So the patterns in `FPCamera.signatures.json` are **templates, not answers**.
The opcodes in them are real: `48 8B 05` genuinely is `mov rax, [rip+disp32]`,
`F3 0F 5D` genuinely is `minss`. The surrounding context is a guess. On a fresh
install you should expect the scan report to say "no match" or
"ambiguous: N matches" for most of them.

That is the designed behaviour, not a failure. The scanner treats multiple
matches as a failure rather than taking the first one, because a pattern that
happens to match two sites will resolve to the wrong one on some future build,
and writing floats into the wrong structure is a great deal worse than not
switching to first person.

## What already works with no signatures at all

Before you spend an evening in a disassembler, know what you are actually
buying. These need no signature and work on any build:

- free mouse look, no button held
- the cursor pinned to screen centre — which is the entire first-person
  targeting fix, because the engine already casts its picking ray from the
  cursor
- WASD movement in both modes
- the look-at interaction assist
- the camera basis, decoded from the view matrix the game uploads to the GPU

What signatures buy you is exactly two things: the viewpoint moving to the
character's eyes, and the zoom going to zero. Worth having, but it is the last
20%, not the foundation.

Press **F7** in game at any point to see where you stand: the self-test reports
each capability as PASS, FAIL or SKIP, and SKIP is what an unconfigured
signature looks like.

## Step 1 — Let the plugin find the camera matrix for you

This is the part that is usually hard, and the plugin automates it.

Every frame, the game must upload a view matrix to the GPU. That happens through
Direct3D 11, whose ABI never changes. `MatrixProbe` watches every constant
buffer write, tests each 64-byte block for the properties only a view matrix
has — an orthonormal rotation, a last row of `(0,0,0,1)` — and decodes the ones
that qualify into a camera position and facing.

In game:

1. Press **F3**.
2. Rotate the camera around for a few seconds and walk a short distance.
3. Open `bin/NativeMods/FPCamera.log`.

You will see a table like:

```
============ VIEW MATRIX CANDIDATES (frame 3600) ============
  -> res=000001F2A4C31A80 off=0x000 hits=3512  motion=  84.31  pos=( 214.66,   32.10,  411.28)  yaw= -47.30 pitch= -31.05
     res=000001F2A4C2F900 off=0x040 hits=3512  motion=   0.02  pos=(   0.00,  100.00,    0.00)  yaw=   0.00 pitch= -90.00
```

The row marked `->` is the one the plugin locked on to. Confirm it by watching
the `yaw` change as you turn. The static row with near-zero motion in that
example is a shadow cascade, which is exactly the kind of false positive the
motion score exists to reject.

**You now have your character's live world position and the camera's exact
orientation, as floating-point numbers.** That is the search key for everything
that follows.

## Step 2 — Find the camera object with Cheat Engine

1. Attach Cheat Engine to `bg3_dx11.exe`.
2. New scan, value type **Float**, search for the `pitch` value from the log
   (say `-31.05`) with "Value between" and a tolerance of about 0.5.
3. Rotate the camera vertically. Next scan for the new pitch. Repeat four or
   five times.
4. You should be down to a handful of addresses. The camera's own pitch field
   is the one that changes smoothly and continuously as you move the mouse.
5. Right-click it → "Find out what accesses this address", then move the mouse.
   The instructions that show up are inside the camera update code.

While you are here, find the neighbouring fields — they are almost always packed
together in the same structure:

- **yaw**: repeat the search using the log's `yaw` value.
- **distance**: scroll the camera in and out and search for the changing value.
- **fov**: usually a constant near 1.2 (radians) or 70 (degrees).
- **positionX**: the camera's own world position, and the one that actually
  makes this first person. Search for the `pos=` X value from the discovery log
  and walk around; the address that tracks you is it. It must be the *first* of
  three contiguous floats — confirm y and z sit at +4 and +8 before using it.

A word of warning specific to `positionX`: the plugin adds eye height to
whatever it finds there and writes it back every frame. Pointing it at
something that is not a position produces nonsense, so leave it at `-1` until
you have confirmed all three components. There is a guard against the read-back
feedback loop this could otherwise cause (see `core/EyePlacement.h`), and a
sanity bound that refuses implausible values, but neither can tell a plausible
wrong field from the right one.

Note the byte offsets *between* them. If pitch is at `0x120` and yaw at `0x124`,
those two offsets go straight into `camera.fieldOffsets` in `FPCamera.json`.

## Step 3 — Get from an instruction to a stable pointer

An address found in Cheat Engine is useless on its own: it changes every launch.
What you need is an instruction that *references* the camera, because that
instruction lives in the executable's code section at a fixed offset from the
module base.

From the "what accesses this address" window, note an instruction and use Cheat
Engine's disassembler to walk backwards until you find where the pointer came
from. You are looking for something of this shape:

```
mov rax, [bg3_dx11.exe+04A1B2C0]     ; a global holding the camera manager
test rax, rax
je  short somewhere
mov rcx, [rax+18]                    ; ...and a field within it
```

Two things to record:

- The **module-relative address** of the `mov rax, [rip+...]` instruction. Cheat
  Engine shows it as `bg3_dx11.exe+XXXXXXX`.
- The chain of `[rax+NN]` dereferences between that global and the object whose
  pitch you found. Those become `camera.pointerChain`.

## Step 4 — Write it into the config

You have two options, and the second is both easier and more reliable.

### Option A — a manual address (recommended to start)

In `FPCamera.signatures.json`:

```json
{
  "name": "CameraManagerInstance",
  "required": true,
  "manualAddress": "0x4A1B2C0",
  "manualIsRelative": true,
  "resolve": [
    { "op": "rip32", "value": 3, "instructionLength": 7 }
  ]
}
```

`manualIsRelative` means the address is an offset from the module base, which is
what Cheat Engine displays and what survives ASLR between launches. It does not
survive a game patch — but neither does a pattern, and this takes thirty seconds
to re-derive.

### Option B — a byte pattern

Copy 12–20 bytes starting at that instruction out of the disassembler,
wildcarding anything that looks like an address or an offset:

```json
"pattern": "48 8B 05 ?? ?? ?? ?? 48 85 C0 74 ?? 48 8B 48 ??"
```

Then check the scan report on the next launch. If it says "ambiguous", extend
the pattern with more following bytes until it is unique. If it says "no match",
you wildcarded too little — some of those bytes were build-specific.

### Either way, fill in `FPCamera.json`

```json
"camera": {
  "pointerChain": [ "0x18", "0x40" ],
  "fieldOffsets": {
    "pitch": "0x120",
    "yaw": "0x124",
    "distance": "0x128",
    "fov": "0x12C",
    "nearPlane": -1,
    "positionX": "0x100"
  }
}
```

`-1` means "I do not know this one" and the field is simply not written. Getting
a field wrong is worse than leaving it out.

Press **F4** in game to reload both files without restarting, then **F7** to
confirm: `camera/pointer chain` and `camera/eye placement` should both turn from
SKIP into PASS.

## The resolve op-chain

Each signature turns a matched instruction address into the address the plugin
actually wants, by applying these in order:

| op | Effect |
|----|--------|
| `add` / `sub` | `address ± value` |
| `deref` | `address = *(uintptr_t*)address` |
| `rip32` | Read the `int32` at `address + value`, then `address += instructionLength + that` |
| `rel32` | Read the `int32` at `address + value`, then `address += that` |

`rip32` is the one you will use. x64 code reaches a global through a
RIP-relative operand, so `mov rax, [rip+disp32]` encodes the *displacement from
the end of the instruction*, not the address. For the 7-byte `48 8B 05 xx xx xx
xx`, the displacement starts 3 bytes in and the instruction is 7 bytes long —
hence `{"op": "rip32", "value": 3, "instructionLength": 7}`.

Get the instruction length wrong and you land somewhere plausible-looking but
incorrect, which is exactly the failure mode the readability check at the end of
resolution is there to catch.

## Reading the scan report

Emitted to `FPCamera.log` on every launch:

```
================ SIGNATURE SCAN REPORT ================
Signature file : C:\...\bin\NativeMods\FPCamera.signatures.json
Declared build : UNVERIFIED-TEMPLATE
Running build  : 4.1.1.6997871
-------------------------------------------------------
  [ OK ] CameraManagerInstance        bg3_dx11.exe+0x4A1B2C0  via rip32(3, len=7)
  [FAIL] CameraPitchClampSite         ambiguous: 8 matches; make the pattern longer or more specific  (optional)
-------------------------------------------------------
1 of 5 resolved; 0 required signature(s) missing.
```

`Declared build` versus `Running build` is the fastest way to notice that a
patch has invalidated your work. Set `gameBuild` in the signature file to your
version once you have things working, and set `"verified": true` on the entries
you confirmed — the report flags anything still marked unverified.

## `patchClamp` — only once everything else works

The default `clampBypass` is `postWrite`: the plugin overwrites pitch, yaw and
zoom every frame, after the game has clamped them. It needs no extra signatures
and is what you should use.

`patchClamp` instead NOPs out the clamp instructions. It is cleaner — the engine
stops fighting you — but it requires you to identify the exact clamp site *and*
its exact instruction length:

```json
"clampPatches": [
  { "signature": "CameraPitchClampSite", "nopLength": 8 }
]
```

**A wrong `nopLength` corrupts the instruction stream and crashes the game.**
Count the bytes in the disassembler, do not estimate. The plugin refuses lengths
outside 1–16 and restores the original bytes when it unloads, but it cannot
protect you from a length that is wrong-but-plausible.

## When a patch breaks everything

Symptoms: the camera stops going first person, and the scan report shows
`[FAIL] CameraManagerInstance`.

Nothing is broken beyond repair. Mouse look, the cursor lock, movement and the
interaction assist all keep working — they never depended on this. Re-run
Steps 1–4; with the discovery tool doing the search for you it is usually a
ten-minute job, not an evening.

## A note on tooling

Cheat Engine is the path of least resistance and the one described above. Ghidra
and IDA give you better patterns — you can see which bytes are genuinely
build-specific and wildcard exactly those instead of guessing — but they need
you to load a 150 MB stripped binary and wait for the auto-analysis. Use
whichever you already know.
