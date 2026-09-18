--- UIState.lua -- tells the DLL when to let go of the mouse cursor.
---
--- The cursor lock is what makes first-person aiming work, and it is also the
--- thing that makes an inventory screen unusable if it stays on. So the client
--- context reports when the player is somewhere that needs a free cursor.
---
--- Honest about coverage: Script Extender's client-side UI surface varies a
--- lot between versions, and there is no version-independent "is a panel open"
--- query. Game state transitions are detected reliably; individual panels are
--- attempted and may not be available on your build. The F2 hotkey in
--- FPCamera.json releases the cursor manually and always works -- treat that as
--- the guarantee and everything here as convenience on top.
local Compat = Ext.Require("Shared/Compat.lua")
local Log = Ext.Require("Shared/Log.lua")

local UIState = {}

--- Anything other than a running game means menus, loading screens or the
--- character creator, none of which should have a pinned cursor.
local RUNNING_STATES = {
    Running = true,
}

UIState.current = {
    uiOpen = false,
    gameState = "unknown",
}

local function gameState()
    local ok, state = Compat.Call("Ext.Client.GetGameState")
    if ok and state ~= nil then return tostring(state) end

    ok, state = Compat.Call("Ext.Utils.GetGameState")
    if ok and state ~= nil then return tostring(state) end

    return nil
end

--- Best-effort panel detection. Returns nil when this build gives us nothing
--- to go on, which is different from "no panel is open" and is treated as such.
local function anyPanelOpen()
    local ok, root = Compat.Call("Ext.UI.GetRoot")
    if not ok or root == nil then return nil end

    -- Deliberately shallow: walking the whole widget tree every tick is not
    -- worth it, and the names below are the ones that matter for a cursor lock.
    local names = { "inventory", "characterSheet", "journal", "map", "spellbook" }
    for _, name in ipairs(names) do
        local probed, visible = pcall(function()
            local child = root[name]
            return child ~= nil and child.Visible == true
        end)
        if probed and visible then return true end
    end
    return false
end

function UIState.Poll()
    local state = gameState()
    if state ~= nil then
        UIState.current.gameState = state
        if RUNNING_STATES[state] ~= true then
            UIState.current.uiOpen = true
            return UIState.current
        end
    end

    local panelOpen = anyPanelOpen()
    if panelOpen == nil then
        Log.Once("ui:nopanels", "Info",
            "This Script Extender version does not expose panel visibility to "
            .. "Lua, so the cursor will not release itself when you open the "
            .. "inventory. Use the toggleCursorLock hotkey (F2 by default).")
        UIState.current.uiOpen = false
    else
        UIState.current.uiOpen = panelOpen
    end

    return UIState.current
end

function UIState.Register()
    -- A state change is the strongest signal available, so react to it
    -- immediately rather than waiting for the next poll.
    local event = Compat.Resolve("Ext.Events.GameStateChanged")
    if event ~= nil and type(event.Subscribe) == "function" then
        event:Subscribe(function(payload)
            local toState = payload and payload.ToState
            if toState ~= nil then
                UIState.current.gameState = tostring(toState)
                Log.Debug("game state -> %s", tostring(toState))
            end
        end)
    else
        Log.Once("ui:nostate", "Info",
            "Ext.Events.GameStateChanged is unavailable; falling back to "
            .. "polling.")
    end
end

return UIState
