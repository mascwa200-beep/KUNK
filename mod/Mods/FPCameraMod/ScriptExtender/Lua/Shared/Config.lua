--- Config.lua -- gameplay tunables for the Script Extender half of the mod.
---
--- Separate from the DLL's FPCamera.json on purpose: these values affect
--- gameplay reach and targeting, the DLL's affect the camera. Drop a
--- fpcamera_gameplay.json into
---   %LOCALAPPDATA%\Larian Studios\Baldur's Gate 3\Script Extender\
--- to override any of them without touching this file.
local Compat = Ext.Require("Shared/Compat.lua")
local Log = Ext.Require("Shared/Log.lua")

local Config = {}

Config.OVERRIDE_FILE = "fpcamera_gameplay.json"

Config.defaults = {
    logLevel = "info",

    -- How often the server context republishes its state and re-issues a move
    -- order in `moveto` mode.
    tickRateHz = 10.0,

    interaction = {
        -- Metres. In first person you are looking ahead rather than down at
        -- your feet, so the vanilla reach is uncomfortably short. Raising this
        -- too far lets you grab things through walls, since the assist has no
        -- line-of-sight test of its own.
        range = 4.0,
        -- Half-angle of the cone around the camera forward, in degrees. Only
        -- things you are actually looking at are considered.
        coneDegrees = 25.0,
        -- Bind the assist to a key if this Script Extender version exposes key
        -- input to Lua. Otherwise use the console command (see Interaction.lua).
        key = "E",
        enabled = true,
    },

    targeting = {
        -- Applied to spells and ranged attacks. Longer and narrower than the
        -- interaction cone: you aim at things much further away than you pick
        -- up, and want the reticle to be precise about which one.
        range = 30.0,
        coneDegrees = 12.0,
        enabled = true,
    },

    -- Experimental head hiding on the client. The reliable fix is the near
    -- plane push in FPCamera.json; this is a best-effort extra whose success
    -- depends on your Script Extender version's entity API.
    headHide = {
        enabled = false,
    },
}

--- Deep-merges `override` into `base`, in place.
local function merge(base, override)
    for key, value in pairs(override) do
        if type(value) == "table" and type(base[key]) == "table" then
            merge(base[key], value)
        else
            base[key] = value
        end
    end
end

local function deepCopy(source)
    if type(source) ~= "table" then return source end
    local copy = {}
    for key, value in pairs(source) do copy[key] = deepCopy(value) end
    return copy
end

Config.current = deepCopy(Config.defaults)

function Config.Load()
    Config.current = deepCopy(Config.defaults)

    local ok, contents = Compat.Call("Ext.IO.LoadFile", Config.OVERRIDE_FILE, "user")
    if not ok or contents == nil or contents == "" then
        Log.Info("No %s found; using built-in gameplay defaults.",
            Config.OVERRIDE_FILE)
    else
        local parsed, decoded = Compat.Call("Ext.Json.Parse", contents)
        if parsed and type(decoded) == "table" then
            merge(Config.current, decoded)
            Log.Info("Gameplay overrides loaded from %s.", Config.OVERRIDE_FILE)
        else
            Log.Warn("%s could not be parsed; using defaults.",
                Config.OVERRIDE_FILE)
        end
    end

    Log.level = Config.current.logLevel or "info"

    Log.Info("Gameplay config: interact range=%.1fm cone=%.0f deg | target "
        .. "range=%.1fm cone=%.0f deg",
        Config.current.interaction.range, Config.current.interaction.coneDegrees,
        Config.current.targeting.range, Config.current.targeting.coneDegrees)

    return Config.current
end

return Config
