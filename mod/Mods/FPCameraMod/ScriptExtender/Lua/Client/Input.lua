--- Input.lua -- relays the interact key to the server context.
---
--- The look-at interaction assist has to run server-side, because that is where
--- Osiris lives. Key presses only exist client-side. This bridges the two.
---
--- If this Script Extender version does not expose key input to Lua, the assist
--- is still fully usable through the `!fpinteract` console command -- you just
--- do not get it on a key. That is logged once at startup so you know which of
--- the two you have.
local Compat = Ext.Require("Shared/Compat.lua")
local Config = Ext.Require("Shared/Config.lua")
local Log = Ext.Require("Shared/Log.lua")

local Input = {}

Input.NET_CHANNEL = "FPCameraMod_Interact"

local function keyName()
    local configured = Config.current.interaction.key
    if type(configured) ~= "string" or configured == "" then return "E" end
    return configured:upper()
end

function Input.Register()
    if not Config.current.interaction.enabled then
        Log.Info("Interaction assist disabled in the gameplay config.")
        return
    end

    local keyInput = Compat.Resolve("Ext.Events.KeyInput")
    if keyInput == nil or type(keyInput.Subscribe) ~= "function" then
        Log.Info("Ext.Events.KeyInput is not available on this Script Extender "
            .. "version, so the interaction assist has no key binding. Use the "
            .. "console command '!fpinteract' instead.")
        return
    end

    local bound = keyName()

    keyInput:Subscribe(function(event)
        -- Field names have varied across versions; accept whichever is present
        -- rather than assuming one.
        local key = event and (event.Key or event.key)
        local action = event and (event.Event or event.event or event.State)
        if key == nil then return end
        if tostring(key):upper() ~= bound then return end
        -- Fire on the press, not the release, so holding the key does not queue
        -- a second interaction.
        if action ~= nil and tostring(action) ~= "KeyDown" then return end

        Compat.Call("Ext.Net.PostMessageToServer", Input.NET_CHANNEL, "")
    end)

    Log.Info("Interaction assist bound to '%s'.", bound)
end

return Input
