# Troubleshooting

Work down the list — each check rules out everything above it. The two things
worth opening first are `<BG3>/bin/NativeMods/FPCamera.log` and the Script
Extender console window; between them they explain almost every failure.

If something has gone badly wrong mid-session, press **F8**. That disables first
person, releases the cursor and stops synthetic input, without unloading
anything.

---

## `FPCamera.log` does not exist

The DLL never loaded.

- Is `FPCamera.dll` in `<BG3>/bin/NativeMods/` (not `bin/`, not `Data/`)?
- Is `DWrite.dll` in `<BG3>/bin/`? The native-mod loader is part of Script
  Extender; without it nothing in `NativeMods` is loaded.
- Did you build x64? A 32-bit DLL is silently skipped. Check with
  `dumpbin /headers FPCamera.dll | findstr machine` — it should say `x64`.

## The log stops after "Could not create a dummy D3D11 device"

You launched the Vulkan executable. Quit and launch `bin/bg3_dx11.exe`.

The plugin gets its per-frame callback by hooking the DirectX 11 swapchain.
Under Vulkan there is no swapchain, so there is nothing to hook. This is a hard
requirement, not a bug to work around.

## The log says "MH_Initialize failed"

Another mod has already initialised MinHook in a way that conflicts. Try
removing other native plugins from `bin/NativeMods/` one at a time.

## The Script Extender console shows nothing from FPCameraMod

The Lua half is not loading.

- Is the folder exactly `Data/Mods/FPCameraMod/ScriptExtender/Lua/`? Script
  Extender does not read `Data/Public/<Mod>/Scripts/`.
- Did you add the `ModuleShortDesc` block to `modsettings.lsx`, and does its
  UUID match the one in `meta.lsx`?
- Is `modsettings.lsx` still valid XML? A missing `>` makes the game ignore the
  whole file. Restore your backup and redo the edit carefully.

## `!fpstatus` says "FPCamera.dll is not publishing"

The two halves cannot see each other's files.

- Confirm `<APPDATA>/Script Extender/` exists and contains `fpcamera_native.json`.
- If it does not, check the log for a `bridge:` warning. The usual cause is that
  the folder does not exist yet because Script Extender has not run once.
- If your install is somewhere unusual, set `bridge.directory` in
  `FPCamera.json` to the absolute path.

## Mouse look does nothing

- Is first person actually on? Press **F1** and check the log.
- Look for `Input hook attached to window` in the log. If it is missing, the
  plugin never found the game window — this is normal for the first second or
  two after launch and retries automatically.
- Absolute-position input devices (drawing tablets, some remote-desktop setups)
  report positions rather than deltas and are skipped. Use a normal mouse.

## The view rotates but stays in third person

Expected on a fresh install. Moving the viewpoint to eye level needs a memory
offset specific to your game build, and no shipped value can supply it.

Check the scan report in the log. If it says `[FAIL] CameraManagerInstance`,
follow `docs/SIGNATURES.md` — the plugin's discovery mode (**F3**) does the
hard part for you.

## The camera jitters or fights itself

- With `clampBypass: "postWrite"` the plugin and the engine both write the same
  fields every frame, and at low frame rates you can see it. Try
  `clampBypass: "patchClamp"` once you have verified clamp signatures.
- If `camera.fieldOffsets` names a field that is not actually what you think it
  is, you get exactly this. Set the suspect field back to `-1` and see if the
  jitter stops.

## I can see the inside of my own head

- Raise `camera.nearPlane` (try `0.25`), and `camera.forwardOffset` (try `0.2`).
- Too high and you start seeing through walls you stand against. There is a
  narrow band that works; it depends on your character's race.
- `headHide.luaHeadHide` is an experimental extra that may do nothing on your
  Script Extender version. The near-plane push is the reliable fix.

## WASD does nothing

**`xinput` mode:**
- Check the log for `xinput: hooked XINPUT1_4.dll`. If it says no XInput DLL is
  loaded, the game has not initialised its controller support — plug in a
  controller once, or switch to `moveto` mode.
- Is `movement.reportControllerConnected` still `true`? With it off, the game
  never polls for a pad and the synthetic stick is never read.
- A physical controller always takes priority. Unplug it, or accept that it
  overrides the keyboard.

**`moveto` mode:**
- Check the Script Extender console for
  `No usable Osiris move call was found`. If you see it, this mode cannot work
  on your build — use `xinput`.
- Movement will stutter. That is inherent to re-issuing pathfinder orders, not
  a misconfiguration.

## The UI shows controller prompts

That is `xinput` mode working as designed: the game switches its prompts when a
pad reports input. Switch `movement.mode` to `"moveto"` if you would rather have
keyboard prompts and pathfinder stutter.

## The cursor is stuck and I cannot use my inventory

Press **F2** to release it, or **F8** to turn everything off.

Automatic release depends on the Lua side detecting the open panel, and Script
Extender does not expose panel visibility to Lua on every version. Check the
capability report in the console — if it says panel visibility is unavailable,
F2 is your mechanism, and that is not going to change without a new SE API.

Dialogue and combat are detected through Osiris story events instead and are
much more reliable.

## Interaction does nothing

- Try `!fplook` in the console. If it reports what you are looking at, targeting
  works and the problem is the interaction call.
- If the log says `No direct interaction call is available on this build`, the
  assist walks you to the object instead; press your normal interact key when
  you arrive.
- Raise `interaction.range` in `fpcamera_gameplay.json` — but note the assist has
  no line-of-sight check, so a large range lets you reach through thin walls.

## It worked yesterday and broke after a game patch

The signature no longer matches. Everything that does not need a signature —
mouse look, cursor lock, movement, interaction — keeps working; only the
first-person viewpoint stops.

Re-derive it with `docs/SIGNATURES.md`. The scan report's
`Declared build` versus `Running build` lines confirm this is what happened.

---

## Reporting a problem

Include: the whole `FPCamera.log` (it contains the scan report, the effective
config and the capability list), the Script Extender console output, your game
version, and which of `xinput` / `moveto` you were using.
