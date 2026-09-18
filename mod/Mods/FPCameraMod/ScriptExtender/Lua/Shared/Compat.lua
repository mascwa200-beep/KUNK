--- Compat.lua -- feature detection for Script Extender and Osiris.
---
--- Why this file exists, stated plainly: the exact set of Osiris calls and
--- Ext APIs available differs between Script Extender versions and between game
--- patches, and this mod is not in a position to verify any of them against the
--- user's install. So nothing is called blind. Every entry point is probed
--- once, the results are printed at session start, and anything missing
--- degrades to a logged notice instead of a Lua error that takes the rest of
--- the mod down with it.
---
--- Read the capability report in the console after loading a save: it tells you
--- exactly which parts of the gameplay half are active on your setup.
local Log = Ext.Require("Shared/Log.lua")

local Compat = {}

local probeCache = {}

--- True if Osi.<name> exists and is callable.
function Compat.HasOsi(name)
    if probeCache[name] ~= nil then return probeCache[name] end
    local ok, value = pcall(function() return Osi and Osi[name] end)
    local present = ok and value ~= nil
    probeCache[name] = present
    return present
end

--- Calls Osi.<name>(...) if it exists. Returns ok, result... -- never raises.
function Compat.CallOsi(name, ...)
    if not Compat.HasOsi(name) then
        Log.Once("osi:" .. name, "Warn",
            "Osiris call '%s' is not available on this game build; the feature "
            .. "that needs it is disabled.", name)
        return false
    end
    local results = table.pack(pcall(Osi[name], ...))
    if not results[1] then
        Log.Once("osierr:" .. name, "Warn",
            "Osiris call '%s' raised: %s", name, tostring(results[2]))
        return false
    end
    return true, table.unpack(results, 2, results.n)
end

--- Walks a dotted path such as "Ext.Entity.GetAllEntitiesWithComponent" and
--- returns the value, or nil.
function Compat.Resolve(path)
    local current = _G
    for part in string.gmatch(path, "[^%.]+") do
        if type(current) ~= "table" then return nil end
        current = current[part]
        if current == nil then return nil end
    end
    return current
end

function Compat.Has(path)
    return Compat.Resolve(path) ~= nil
end

--- Calls a dotted-path function if present. Returns ok, result...
function Compat.Call(path, ...)
    local fn = Compat.Resolve(path)
    if type(fn) ~= "function" then
        Log.Once("ext:" .. path, "Warn",
            "'%s' is not available on this Script Extender version; the "
            .. "feature that needs it is disabled.", path)
        return false
    end
    local results = table.pack(pcall(fn, ...))
    if not results[1] then
        Log.Once("exterr:" .. path, "Warn", "'%s' raised: %s", path,
            tostring(results[2]))
        return false
    end
    return true, table.unpack(results, 2, results.n)
end

--- Prints what this install can and cannot do. Worth reading once.
function Compat.Report(context)
    Log.Info("---- capability report (%s) ----", context)

    local extPaths = {
        "Ext.IO.LoadFile", "Ext.IO.SaveFile",
        "Ext.Json.Parse", "Ext.Json.Stringify",
        "Ext.Entity.Get", "Ext.Entity.GetAllEntitiesWithComponent",
        "Ext.Events.Tick", "Ext.Events.SessionLoaded",
        "Ext.Events.KeyInput", "Ext.Timer.WaitFor",
        "Ext.RegisterConsoleCommand",
    }
    for _, path in ipairs(extPaths) do
        Log.Info("  %-42s %s", path, Compat.Has(path) and "yes" or "MISSING")
    end

    if context == "server" then
        local osiCalls = {
            "GetHostCharacter", "GetPosition", "CharacterMoveToPosition",
            "CharacterMoveTo", "GetDistanceTo", "IsInCombat", "IsInForceTurnBasedMode",
        }
        for _, name in ipairs(osiCalls) do
            Log.Info("  Osi.%-38s %s", name,
                Compat.HasOsi(name) and "yes" or "MISSING")
        end
    end

    Log.Info("--------------------------------")
end

return Compat
