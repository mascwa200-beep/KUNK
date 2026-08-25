--- BootstrapClient.lua -- client context entry point.
---
--- Loaded automatically by Script Extender from
---   Data/Mods/FPCameraMod/ScriptExtender/Lua/BootstrapClient.lua
---
--- The client context knows two things the server does not: whether a UI panel
--- is in the way of the cursor, and which keys the player pressed. Both are
--- published for the DLL and the server context to act on.
local Bridge = Ext.Require("Shared/Bridge.lua")
local Compat = Ext.Require("Shared/Compat.lua")
local Config = Ext.Require("Shared/Config.lua")
local HeadHide = Ext.Require("Client/HeadHide.lua")
local Input = Ext.Require("Client/Input.lua")
local Log = Ext.Require("Shared/Log.lua")
local UIState = Ext.Require("Client/UIState.lua")

local accumulator = 0.0

local function onTick(event)
    local deltaTime = 1.0 / 30.0
    local ok, value = pcall(function() return event.Time.DeltaTime end)
    if ok and type(value) == "number" and value > 0 then deltaTime = value end

    accumulator = accumulator + deltaTime
    local period = 1.0 / math.max(1.0, Config.current.tickRateHz)
    if accumulator < period then return end
    accumulator = 0.0

    local ui = UIState.Poll()
    Bridge.Publish("client", {
        uiOpen = ui.uiOpen,
        gameState = ui.gameState,
    })

    -- Cheap no-op once it has either succeeded or given up.
    HeadHide.Apply()
end

local function start()
    Config.Load()
    Log.Info("FPCameraMod client context starting.")
    Compat.Report("client")

    UIState.Register()
    Input.Register()
    HeadHide.Reset()

    local tick = Compat.Resolve("Ext.Events.Tick")
    if tick ~= nil and type(tick.Subscribe) == "function" then
        tick:Subscribe(onTick)
        Log.Info("Client tick subscribed; publishing UI state at %.0f Hz.",
            Config.current.tickRateHz)
    else
        Log.Warn("Ext.Events.Tick is unavailable in the client context. The "
            .. "cursor will not release itself for menus -- use the "
            .. "toggleCursorLock hotkey (F2 by default).")
    end
end

-- A level load replaces the character entity, so any head visual we hid is
-- gone and the attempt has to be made again.
local gameStateChanged = Compat.Resolve("Ext.Events.GameStateChanged")
if gameStateChanged ~= nil and type(gameStateChanged.Subscribe) == "function" then
    gameStateChanged:Subscribe(function(event)
        local toState = event and event.ToState
        if toState ~= nil and tostring(toState) == "Running" then
            HeadHide.Reset()
        end
    end)
end

local sessionLoaded = Compat.Resolve("Ext.Events.SessionLoaded")
if sessionLoaded ~= nil and type(sessionLoaded.Subscribe) == "function" then
    sessionLoaded:Subscribe(start)
else
    start()
end
