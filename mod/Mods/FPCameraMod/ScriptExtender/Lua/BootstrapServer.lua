--- BootstrapServer.lua -- server context entry point.
---
--- Loaded automatically by Script Extender from
---   Data/Mods/FPCameraMod/ScriptExtender/Lua/BootstrapServer.lua
--- once the mod is listed in modsettings.lsx. See INSTALL.md.
---
--- Responsibilities, all of which need Osiris and so cannot live client-side:
---   * publish the controlled character, its race and position, and whether the
---     player is in combat or dialogue, for the DLL to read;
---   * drive the `moveto` movement mode;
---   * run the look-at interaction assist.
local Bridge = Ext.Require("Shared/Bridge.lua")
local Compat = Ext.Require("Shared/Compat.lua")
local Config = Ext.Require("Shared/Config.lua")
local Interaction = Ext.Require("Server/Interaction.lua")
local Log = Ext.Require("Shared/Log.lua")
local Movement = Ext.Require("Server/Movement.lua")
local Vec = Ext.Require("Shared/Vec.lua")

local state = {
    inDialog = false,
    inCombat = false,
    accumulator = 0.0,
}

local function hostCharacter()
    local ok, character = Compat.CallOsi("GetHostCharacter")
    if ok and character ~= nil then return character end
    return nil
end

--- Race name, used to pick an eye height. Not available on every build, and the
--- global camera.eyeHeight is a perfectly good fallback, so this stays quiet
--- after one notice.
local function characterRace(character)
    if character == nil then return "" end

    local ok, entity = Compat.Call("Ext.Entity.Get", character)
    if ok and entity ~= nil then
        local probed, race = pcall(function()
            local component = entity.Race
            if component == nil then return nil end
            return component.Name or component.Race
        end)
        if probed and race ~= nil then return tostring(race) end
    end

    Log.Once("race:none", "Info",
        "Character race is not readable from Lua on this build, so the global "
        .. "camera.eyeHeight in FPCamera.json is used for every race. Adjust it "
        .. "by hand if you are playing a gnome or a dragonborn.")
    return ""
end

local function publish(character)
    local payload = {
        inDialog = state.inDialog,
        inCombat = state.inCombat,
        controlledCharacter = character and tostring(character) or "",
        race = characterRace(character),
    }

    if character ~= nil then
        local ok, x, y, z = Compat.CallOsi("GetPosition", character)
        if ok and x ~= nil then
            payload.position = { x, y, z }
        end
    end

    Bridge.Publish("server", payload)
end

--- Osiris story events are the reliable way to know about dialogue and combat.
--- Both matter to the cursor lock: you cannot click a dialogue option with the
--- cursor pinned to the middle of the screen.
local function registerStoryListeners()
    local register = Compat.Resolve("Ext.Osiris.RegisterListener")
    if type(register) ~= "function" then
        Log.Warn("Ext.Osiris.RegisterListener is unavailable, so dialogue and "
            .. "combat will not release the cursor automatically. Use the "
            .. "toggleCursorLock hotkey (F2 by default).")
        return
    end

    local listeners = {
        { "DialogStarted", 2, function() state.inDialog = true end },
        { "DialogEnded", 2, function() state.inDialog = false end },
        { "EnteredCombat", 2, function() state.inCombat = true end },
        { "LeftCombat", 2, function() state.inCombat = false end },
    }

    for _, entry in ipairs(listeners) do
        local name, arity, handler = entry[1], entry[2], entry[3]
        local ok = pcall(register, name, arity, "after", function(...)
            handler(...)
            Log.Debug("story event: %s (dialog=%s combat=%s)", name,
                tostring(state.inDialog), tostring(state.inCombat))
        end)
        if not ok then
            Log.Once("story:" .. name, "Info",
                "Osiris event '%s' could not be subscribed on this build; "
                .. "skipping it.", name)
        end
    end
end

local function onTick(event)
    local deltaTime = 1.0 / 30.0
    local ok, value = pcall(function() return event.Time.DeltaTime end)
    if ok and type(value) == "number" and value > 0 then deltaTime = value end

    local character = hostCharacter()
    local native = Bridge.ReadNative()

    Movement.Update(deltaTime, character, native)

    -- File IO is cheap but not free; publish at the configured rate rather than
    -- every tick.
    state.accumulator = state.accumulator + deltaTime
    local period = 1.0 / math.max(1.0, Config.current.tickRateHz)
    if state.accumulator >= period then
        state.accumulator = 0.0
        publish(character)
    end
end

local function start()
    Config.Load()
    Log.Info("FPCameraMod server context starting.")
    Compat.Report("server")

    registerStoryListeners()
    Interaction.Register()

    local tick = Compat.Resolve("Ext.Events.Tick")
    if tick ~= nil and type(tick.Subscribe) == "function" then
        tick:Subscribe(onTick)
        Log.Info("Server tick subscribed; publishing state at %.0f Hz.",
            Config.current.tickRateHz)
    else
        Log.Error("Ext.Events.Tick is unavailable. Movement and state "
            .. "publishing are disabled; only the console commands will work.")
    end

    Log.Info("Ready. Console commands: !fpinteract, !fplook, !fpstatus")
end

Compat.Call("Ext.RegisterConsoleCommand", "fpstatus", function()
    local native = Bridge.ReadNative()
    if native == nil then
        Log.Info("status: FPCamera.dll is not publishing. Is it in "
            .. "bin/NativeMods, and is the game running in DirectX 11 mode?")
        return
    end
    Log.Info("status: firstPerson=%s cursorLocked=%s mode=%s yaw=%.1f "
        .. "pitch=%.1f cameraObject=%s",
        tostring(native.firstPerson), tostring(native.cursorLocked),
        tostring(native.movementMode), native.yaw or 0.0, native.pitch or 0.0,
        tostring(native.cameraObjectResolved))
    Log.Info("status: forward=%s dialog=%s combat=%s",
        Vec.tostring(Vec.from(native.forward or { 0, 0, 0 })),
        tostring(state.inDialog), tostring(state.inCombat))
end)

local sessionLoaded = Compat.Resolve("Ext.Events.SessionLoaded")
if sessionLoaded ~= nil and type(sessionLoaded.Subscribe) == "function" then
    sessionLoaded:Subscribe(start)
else
    -- Older builds without the event: start immediately and accept that Osiris
    -- may not be ready for the first few ticks.
    start()
end
