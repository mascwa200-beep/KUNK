--- Interaction.lua -- reach and the look-at pickup assist.
---
--- The problem this solves: in the isometric view you click the thing you want,
--- so short reach is fine. In first person you are looking ahead rather than
--- down, and vanilla reach means standing on top of an object and staring at
--- the floor to pick it up.
---
--- The assist finds whatever is inside a cone around the camera forward and
--- interacts with it. Two honest limitations, neither of which is worked
--- around here:
---   * it has no line-of-sight test of its own, so a large `range` will let you
---     reach through a thin wall. The default is deliberately conservative.
---   * which Osiris call actually performs an interaction differs between game
---     builds. Several shapes are probed; if none works, the assist walks you
---     to the object instead and says so, rather than failing silently.
local Bridge = Ext.Require("Shared/Bridge.lua")
local Compat = Ext.Require("Shared/Compat.lua")
local Config = Ext.Require("Shared/Config.lua")
local Log = Ext.Require("Shared/Log.lua")
local Targeting = Ext.Require("Server/Targeting.lua")
local Vec = Ext.Require("Shared/Vec.lua")

local Interaction = {}

Interaction.NET_CHANNEL = "FPCameraMod_Interact"

local function hostCharacter()
    local ok, character = Compat.CallOsi("GetHostCharacter")
    if ok and character ~= nil then return character end
    return nil
end

local function characterPosition(character)
    local ok, x, y, z = Compat.CallOsi("GetPosition", character)
    if not ok or x == nil then return nil end
    return Vec.new(x, y, z)
end

--- Tries the interaction call shapes Osiris has used across builds. Returns
--- true once one of them succeeds.
local function useTarget(character, targetUuid)
    local attempts = {
        { "CharacterUseItem", character, targetUuid, "" },
        { "UseItem", character, targetUuid },
        { "CharacterUse", character, targetUuid },
    }
    for _, attempt in ipairs(attempts) do
        local name = attempt[1]
        if Compat.HasOsi(name) then
            if Compat.CallOsi(table.unpack(attempt)) then
                Log.Debug("interact: used Osi.%s on %s", name, tostring(targetUuid))
                return true
            end
        end
    end
    return false
end

--- Walks the character to within arm's reach of the target. Used when no direct
--- "use" call is available, so the assist still saves you the aiming even if it
--- cannot press the button for you.
local function approachTarget(character, targetUuid)
    if Compat.HasOsi("CharacterMoveToObject") then
        if Compat.CallOsi("CharacterMoveToObject", character, targetUuid, "Run", "") then
            Log.Once("interact:approach", "Info",
                "No direct interaction call is available on this build, so the "
                .. "assist walks you to what you are looking at instead. Press "
                .. "your normal interact key once you arrive.")
            return true
        end
    end
    return false
end

--- Interacts with whatever the player is looking at. Returns a short status
--- string, which the console command prints.
function Interaction.InteractAlongReticle()
    local settings = Config.current.interaction
    if not settings.enabled then return "interaction assist is disabled" end

    local character = hostCharacter()
    if character == nil then return "no controlled character" end

    local position = characterPosition(character)
    if position == nil then return "character position unavailable" end

    local native = Bridge.ReadNative()
    if native == nil then
        return "FPCamera.dll is not publishing a camera heading"
    end

    local origin, forward = Targeting.ReticleRay(native, position)
    if origin == nil then return "camera heading unavailable" end

    local entity, uuid, distance = Targeting.PickAlongReticle(
        origin, forward, settings.range, settings.coneDegrees,
        { "item", "character" },
        function(_, candidateUuid)
            -- Never target yourself, which is otherwise the closest entity to
            -- the ray origin by a wide margin.
            return candidateUuid ~= nil and candidateUuid ~= character
        end)

    if entity == nil then
        return string.format("nothing within %.1fm inside a %.0f degree cone",
            settings.range, settings.coneDegrees)
    end

    if useTarget(character, uuid) then
        return string.format("interacted with %s at %.1fm", tostring(uuid),
            distance)
    end
    if approachTarget(character, uuid) then
        return string.format("walking to %s at %.1fm", tostring(uuid), distance)
    end

    return string.format("found %s at %.1fm but no usable interaction call",
        tostring(uuid), distance)
end

--- Reports what is under the reticle without acting on it. Useful for checking
--- that the camera heading and the cone settings agree with what you see.
function Interaction.DescribeReticleTarget()
    local character = hostCharacter()
    if character == nil then return "no controlled character" end

    local position = characterPosition(character)
    local native = Bridge.ReadNative()
    if position == nil or native == nil then return "no camera data" end

    local origin, forward = Targeting.ReticleRay(native, position)
    if origin == nil then return "camera heading unavailable" end

    local settings = Config.current.targeting
    local _, uuid, distance = Targeting.PickAlongReticle(
        origin, forward, settings.range, settings.coneDegrees,
        { "character", "item" }, nil)

    if uuid == nil then
        return string.format("reticle at yaw %.1f: nothing within %.0fm",
            native.yaw or 0.0, settings.range)
    end
    return string.format("reticle at yaw %.1f: %s at %.1fm", native.yaw or 0.0,
        tostring(uuid), distance)
end

function Interaction.Register()
    -- Console commands work on every Script Extender version and need no key
    -- API, so they are the baseline. Type these into the SE console window.
    Compat.Call("Ext.RegisterConsoleCommand", "fpinteract", function()
        Log.Info("interact: %s", Interaction.InteractAlongReticle())
    end)
    Compat.Call("Ext.RegisterConsoleCommand", "fplook", function()
        Log.Info("look: %s", Interaction.DescribeReticleTarget())
    end)

    -- The client relays its interact key here when its Script Extender version
    -- exposes key input to Lua. See Client/Input.lua.
    Compat.Call("Ext.RegisterNetListener", Interaction.NET_CHANNEL,
        function(_, _)
            Log.Debug("interact: %s", Interaction.InteractAlongReticle())
        end)
end

return Interaction
