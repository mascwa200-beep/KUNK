# BG3 First-Person Camera

A first-person camera and movement overhaul for Baldur's Gate 3, installed by
hand. No Vortex, no Nexus client, no mod manager of any kind — see
[INSTALL.md](INSTALL.md).

Two halves that work together:

- **`FPCamera.dll`** — a native plugin in `bin/NativeMods/` that owns the
  camera, raw mouse look, the cursor lock and synthetic gamepad movement.
- **`FPCameraMod`** — a Script Extender mod in `Data/` that handles the
  gameplay side: the movement fallback, look-at interaction, and telling the
  DLL when to let go of the cursor.

Requires [BG3 Script Extender](https://github.com/Norbyte/bg3se) and the
**DirectX 11** executable (`bg3_dx11.exe`). Single-player only.

---

## What works out of the box, and what needs setup

This is the first thing to understand about this mod, so it is not buried at the
bottom of a page.

**Works immediately, on any game build, no configuration:**

| | |
|---|---|
| Free mouse look | Raw mouse deltas drive yaw and pitch. No middle-mouse button to hold. |
| Screen-centre cursor | The cursor is pinned to the middle of the window and doubles as a crosshair. |
| First-person targeting | Falls out of the above for free — see below. |
| WASD movement | Continuous, camera-relative, two implementations to choose between. |
| Look-at interaction | Interacts with whatever is inside a cone around where you are looking. |

**Needs a one-time setup step per game build:**

| | |
|---|---|
| The viewpoint moving to eye level | Requires a memory offset specific to your exact build. |
| Zoom forced to zero | Same. |

That second group needs work because BG3's executable is stripped and re-linked
every patch, so no shipped address or byte pattern can be correct for your
install. Rather than pretend otherwise, the plugin ships a discovery tool that
does the hard part: press **F3**, rotate the camera, and it prints every camera
matrix the game uploaded to the GPU, decoded into a world position and facing.
[docs/SIGNATURES.md](docs/SIGNATURES.md) covers the rest, and it is usually a
ten-minute job.

---

## How the interesting parts work

### Targeting, solved by not solving it

Making spells and attacks aim from a first-person reticle sounds like it needs
the engine's line-of-sight code rewritten. It does not, and Script Extender
could not do that anyway.

Baldur's Gate 3 already casts its picking ray from the mouse cursor. Pin the
cursor to the centre of the screen and the engine's own ray becomes a reticle
ray. Nothing is hooked, nothing is patched, and there is nothing to re-derive
when the game updates. The Lua side adds a cone query on top so the interaction
assist picks what you are *looking at* rather than what is *nearest*, but the
load-bearing part is one `SetCursorPos` call per frame.

### Movement, by borrowing the controller path

BG3 is click-to-move with a keyboard, but it already ships true analog,
camera-relative free movement — for gamepads. So the default movement mode
(`xinput`) synthesises left-stick deflection from WASD and lets the engine's own
implementation do the work. No pathfinding, no stutter, and nothing to break on
a patch, since XInput is a documented exported API.

The visible cost, stated plainly: **the game switches its UI prompts to
controller glyphs while a pad is reporting input.** If you would rather not live
with that, `moveto` mode keeps the keyboard prompts by re-issuing move orders
ahead of the camera instead — at the price of pathfinder stutter on stairs and
ledges. Set `movement.mode` in `FPCamera.json`; neither option is free.

A physical controller always takes priority over the synthetic one.

### Finding the camera, without hardcoded addresses

Every frame the game must upload a view matrix to the GPU, through a Direct3D 11
ABI that cannot change. The plugin watches constant-buffer writes, tests each
64-byte block for the properties only a rigid view matrix has, and decodes the
ones that qualify. That gives a live camera basis with **zero** signature
scanning — which is why camera-relative movement works before you have done any
setup — and it is also the search key that makes finding the camera object
tractable.

It deliberately never writes the matrix back. That would move the picture
without moving the camera the game reasons about, leaving targeting, culling and
occlusion computed from the isometric view. Changing what you see without
changing what the game thinks you see is a trap, not a shortcut.

---

## Default controls

| Key | Does |
|-----|------|
| **F1** | Toggle first person |
| **F2** | Release / re-grab the cursor (for inventory and menus) |
| **F3** | Toggle camera-matrix discovery logging |
| **F4** | Reload `FPCamera.json` without restarting |
| **F8** | Panic: turn everything off |
| **W A S D** | Move, relative to the camera |
| **Shift** | Walk |

All rebindable. Script Extender console commands: `!fpstatus`, `!fplook`,
`!fpinteract`.

---

## Configuration

| File | Lives in | Controls |
|------|----------|----------|
| `FPCamera.json` | `bin/NativeMods/` | Camera, mouse, movement, hotkeys, discovery |
| `FPCamera.signatures.json` | `bin/NativeMods/` | Byte patterns and manual addresses |
| `fpcamera_gameplay.json` | `%LOCALAPPDATA%/…/Script Extender/` | Interaction and targeting ranges (optional) |

The first two accept `//` comments and ship heavily annotated. **F4** reloads
both in game.

---

## Building

Visual Studio 2022 with the C++ workload and the Windows SDK. MinHook and
nlohmann/json are fetched automatically; nothing to install.

```
cmake -S . -B build -G "Visual Studio 17 2022" -A x64
cmake --build build --config Release
```

Output: `build/native/Release/FPCamera.dll`, staged alongside its config files
in `build/native/Release/NativeMods/`.

---

## Repository layout

```
CMakeLists.txt          root build script
native/src/             the DLL
  D3D11Hook             per-frame callback via the swapchain vtable
  MatrixProbe           view-matrix discovery and the camera basis
  CameraHook            the first-person camera state machine
  InputHook             raw mouse look and the cursor lock
  XInputSpoof           WASD to synthetic gamepad
  MemoryScanner         AOB scanning and guarded memory access
  Signatures            the config-driven signature registry
  Bridge                file exchange with the Lua mod
config/                 the two JSON files that install next to the DLL
mod/                    copied into <BG3>/Data/
  Mods/FPCameraMod/     meta.lsx, SE config, Lua
  Public/FPCameraMod/   stat overrides (ships inert; see the file)
docs/                   SIGNATURES.md, TROUBLESHOOTING.md
INSTALL.md              step-by-step manual install
```

---

## Known limitations

Listed because you will hit them, not because they are theoretical.

- **DirectX 11 only.** Vulkan has no swapchain to hook. The plugin detects this
  and says so rather than failing quietly.
- **Eye height is an approximation.** There is no readable head-bone offset
  without resolving the character skeleton, so `camera.eyeHeight` is a per-race
  value you tune. Bone-accurate head tracking is not implemented.
- **`xinput` mode switches the UI to controller prompts.** Inherent to reusing
  the game's controller path.
- **`moveto` mode stutters.** Inherent to re-issuing pathfinder orders.
- **The interaction assist has no line-of-sight test.** A large
  `interaction.range` will let you reach through thin walls.
- **Automatic cursor release depends on your Script Extender version.**
  Dialogue and combat are detected reliably through Osiris events; UI panels are
  not exposed to Lua on every version. F2 always works.
- **Signatures break on game patches.** Only the eye-level viewpoint is
  affected; everything else keeps working.
- **Not for multiplayer.** Synthetic movement changes character state, not just
  the local view.

---

## Licence

See [LICENSE](LICENSE).
