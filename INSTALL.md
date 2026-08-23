# Manual installation

No mod manager. No Vortex, no Nexus client, no BG3MM. Every step below is a file
you copy or a line you paste, and the "Uninstall" section at the bottom reverses
all of it.

Throughout, `<BG3>` means your Baldur's Gate 3 install folder — the one that
contains `bin` and `Data`. Typically:

```
C:\Program Files (x86)\Steam\steamapps\common\Baldurs Gate 3
```

and `<APPDATA>` means:

```
%LOCALAPPDATA%\Larian Studios\Baldur's Gate 3
```

Paste that into the Explorer address bar and press Enter; it expands on its own.

---

## Before you start

Three things that will save you time:

- **Back up `<APPDATA>\modsettings.lsx`.** Step 5 edits it. If you mistype the
  XML the game refuses to load your saves until you fix it, and having the
  original to hand turns that from a problem into an undo.
- **Use a separate profile or at least a separate save slot.** Script Extender
  disables achievements, and this mod changes how your character moves. Do not
  put a run you care about at risk.
- **Single-player only.** The camera is client-side, but the synthetic gamepad
  input changes actual character state, so it will desync a multiplayer session.

---

## Step 1 — Install BG3 Script Extender

The Script Extender is what loads this mod. Both halves need it: it provides the
Lua runtime, and its native-mod loader is what loads the DLL.

1. Download it from Norbyte's releases page.
2. Copy `DWrite.dll` into:

   ```
   <BG3>\bin\
   ```

   Next to `bg3.exe` and `bg3_dx11.exe`. Not in `Data`, not in the root.

3. Launch the game once and quit. This lets the Extender create
   `<APPDATA>\Script Extender\`, which the mod uses for its bridge files.

Verify before continuing: the folder `<APPDATA>\Script Extender\` now exists.
If it does not, the Extender is not loading and nothing below will work.

---

## Step 2 — Build `FPCamera.dll`

You need Visual Studio 2022 with the "Desktop development with C++" workload and
the Windows SDK. CMake fetches MinHook and nlohmann/json itself — you do not
need to download or install either.

From a Developer Command Prompt, in this repository:

```
cmake -S . -B build -G "Visual Studio 17 2022" -A x64
cmake --build build --config Release
```

The result is:

```
build\native\Release\FPCamera.dll
```

The build also stages the DLL together with its two config files in
`build\native\Release\NativeMods\`, so you can copy that folder's contents
in one go in the next step.

If the build fails with "FPCamera must be built for x64", you left off `-A x64`.
Baldur's Gate 3 is a 64-bit process and will not load a 32-bit DLL.

---

## Step 3 — Install the native plugin

Create this folder if it does not exist:

```
<BG3>\bin\NativeMods\
```

Copy three files into it:

```
<BG3>\bin\NativeMods\FPCamera.dll
<BG3>\bin\NativeMods\FPCamera.json
<BG3>\bin\NativeMods\FPCamera.signatures.json
```

The DLL comes from your build; the two JSON files come from `config/` in this
repository. All three must sit in the same folder — the plugin looks for its
config next to itself, not in the working directory.

---

## Step 4 — Install the Script Extender mod

Copy the contents of this repository's `mod/` folder into `<BG3>\Data\`, so
that you end up with exactly this layout:

```
<BG3>\Data\Mods\FPCameraMod\meta.lsx
<BG3>\Data\Mods\FPCameraMod\ScriptExtender\Config.json
<BG3>\Data\Mods\FPCameraMod\ScriptExtender\Lua\BootstrapServer.lua
<BG3>\Data\Mods\FPCameraMod\ScriptExtender\Lua\BootstrapClient.lua
<BG3>\Data\Mods\FPCameraMod\ScriptExtender\Lua\Shared\Bridge.lua
<BG3>\Data\Mods\FPCameraMod\ScriptExtender\Lua\Shared\Compat.lua
<BG3>\Data\Mods\FPCameraMod\ScriptExtender\Lua\Shared\Config.lua
<BG3>\Data\Mods\FPCameraMod\ScriptExtender\Lua\Shared\Log.lua
<BG3>\Data\Mods\FPCameraMod\ScriptExtender\Lua\Shared\Vec.lua
<BG3>\Data\Mods\FPCameraMod\ScriptExtender\Lua\Server\Interaction.lua
<BG3>\Data\Mods\FPCameraMod\ScriptExtender\Lua\Server\Movement.lua
<BG3>\Data\Mods\FPCameraMod\ScriptExtender\Lua\Server\Targeting.lua
<BG3>\Data\Mods\FPCameraMod\ScriptExtender\Lua\Client\HeadHide.lua
<BG3>\Data\Mods\FPCameraMod\ScriptExtender\Lua\Client\Input.lua
<BG3>\Data\Mods\FPCameraMod\ScriptExtender\Lua\Client\UIState.lua
<BG3>\Data\Public\FPCameraMod\Stats\Generated\Data\FPCameraMod_Interaction.txt
```

Two folder names people get wrong here:

- It is `Data\Mods\FPCameraMod\ScriptExtender\Lua\`. Script Extender does
  **not** read `Data\Public\<Mod>\Scripts\`.
- The folder must be named `FPCameraMod`, matching the `Folder` attribute in
  `meta.lsx`. Renaming it breaks the mod.

---

## Step 5 — Register the mod in `modsettings.lsx`

Loose files under `Data\` are read by the game, but the Lua half only loads if
the mod is in your load order.

Open:

```
<APPDATA>\modsettings.lsx
```

in a text editor (Notepad works). Find the `<node id="Mods">` block. It already
contains a `GustavDev` entry and looks roughly like this:

```xml
<node id="Mods">
    <children>
        <node id="ModuleShortDesc">
            <attribute id="Folder" type="LSString" value="GustavDev" />
            ...
        </node>
    </children>
</node>
```

Paste this block **inside** `<children>`, immediately after the closing
`</node>` of the `GustavDev` entry:

```xml
        <node id="ModuleShortDesc">
            <attribute id="Folder" type="LSString" value="FPCameraMod" />
            <attribute id="MD5" type="LSString" value="" />
            <attribute id="Name" type="LSString" value="FPCameraMod" />
            <attribute id="UUID" type="FixedString" value="3bb15c92-690d-4c45-a374-834a44354ca5" />
            <attribute id="Version64" type="int64" value="36028797018963968" />
        </node>
```

That UUID is the one in `Data\Mods\FPCameraMod\meta.lsx`. If you change it in
one file you must change it in both.

Save the file. Do **not** mark it read-only — that advice circulates for other
mods and will stop the game writing legitimate settings.

---

## Step 6 — Launch in DirectX 11

**This matters.** The plugin hooks the DirectX 11 swapchain to get its per-frame
callback. In Vulkan mode there is no swapchain to hook and the camera does
nothing.

Launch `<BG3>\bin\bg3_dx11.exe` directly, or pick "DirectX 11" when Steam asks.

---

## Step 7 — Verify the install

In this order. Each check tells you which step failed if it does.

1. **The plugin loaded.** After reaching the main menu, open:

   ```
   <BG3>\bin\NativeMods\FPCamera.log
   ```

   It should contain `FPCamera ... starting` and
   `D3D11 present hook installed`. No file at all means Step 1 or Step 3
   failed. A file that stops after "Could not create a dummy D3D11 device"
   means you launched the Vulkan executable — see Step 6.

2. **The Lua mod loaded.** Open the Script Extender console window and load a
   save. You should see `FPCameraMod server context starting` followed by a
   capability report. Nothing means Step 4 or Step 5 failed.

3. **The bridge is connected.** Type `!fpstatus` into the Extender console. It
   should print the camera's current yaw and pitch. "FPCamera.dll is not
   publishing" means the two halves are not seeing each other's files.

4. **First person.** Press **F1**. The mouse should now turn the camera with no
   button held. If the view rotates but does not move to eye level, that is
   expected on a fresh install — see the next section.

5. **Run the self-test.** Press **F7** and open
   `<BG3>\bin\NativeMods\FPCamera.selftest.log`. It reports every check as
   PASS, FAIL or SKIP.

   Read SKIP as "not configured yet", not as a fault: on a fresh install the
   signature and eye-placement checks are expected to skip, because the offsets
   for your game build have not been filled in. FAIL means something is wrong
   and the report says what. This is the file to paste when reporting a
   problem.

---

## Step 8 — Make the camera actually go first-person

Everything so far works out of the box. The one thing that does not is moving
the viewpoint to the character's eyes, because that needs a memory offset that
is specific to your exact game build. There is no way around this and no
shipped value that would work: Baldur's Gate 3's executable is stripped and
re-linked every patch.

What you get without doing anything: free mouse look, the centred cursor and
its targeting fix, WASD movement, and the interaction assist.

What needs the offsets: the viewpoint moving to eye level and the zoom going
to zero.

The plugin includes a discovery tool that does the hard part for you. Press
**F3** in game, rotate the camera for a few seconds, and read `FPCamera.log`:
it prints every camera matrix the game uploaded to the GPU, decoded into a
world position and a facing. The row that tracks your camera gives you real
numbers to search for.

`docs/SIGNATURES.md` walks through the rest.

---

## Default hotkeys

| Key | Does |
|-----|------|
| F1  | Toggle first person |
| F2  | Release / re-grab the mouse cursor |
| F3  | Toggle camera-matrix discovery logging |
| F4  | Reload `FPCamera.json` without restarting |
| F7  | Run the self-test and write `FPCamera.selftest.log` |
| F8  | Panic: turn everything off |

All rebindable in `FPCamera.json`. Console commands, typed into the Script
Extender console: `!fpstatus`, `!fplook`, `!fpinteract`.

---

## Uninstall

1. Delete `<BG3>\bin\NativeMods\FPCamera.dll` and the two JSON files.
2. Delete `<BG3>\Data\Mods\FPCameraMod\` and
   `<BG3>\Data\Public\FPCameraMod\`.
3. Remove the `ModuleShortDesc` block you added to `modsettings.lsx`, or
   restore your backup.
4. Optionally delete `fpcamera_*.json` from `<APPDATA>\Script Extender\`.

Removing only the DLL (step 1) is enough to get the vanilla camera back
immediately, and is the right first move if something is wrong.

To remove Script Extender itself, delete `<BG3>\bin\DWrite.dll`.
