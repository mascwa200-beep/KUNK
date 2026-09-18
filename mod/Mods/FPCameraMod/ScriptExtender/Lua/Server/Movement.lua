--- Movement.lua -- the `moveto` movement mode.
---
--- This is the fallback movement path, and it is worth being clear about what
--- it is and is not. The DLL's `xinput` mode reuses the engine's own analog
--- controller movement and feels like a first-person game. This mode instead
--- re-issues a move order towards a point in front of the camera several times
--- a second. It keeps the keyboard-and-mouse UI, but every step goes through
--- the pathfinder, so it stutters on stairs and ledges and will occasionally
--- route around an obstacle you meant to walk over.
---
--- It exists because the `xinput` mode switches the game's UI prompts to
--- controller glyphs, which some people would rather not live with. Neither
--- option is free; pick the trade-off you prefer in FPCamera.json.
local Compat = Ext.Require("Shared/Compat.lua")
local Config = Ext.Require("Shared/Config.lua")
local Log = Ext.Require("Shared/Log.lua")
local Vec = Ext.Require("Shared/Vec.lua")

local Movement = {}

local accumulator = 0.0
local lastOrderTarget = nil
local wasMoving = false

--- Reads the controlled character's world position.
local function characterPosition(character)
    local ok, x, y, z = Compat.CallOsi("GetPosition", character)
    if not ok or x == nil then return nil end
    return Vec.new(x, y, z)
end

--- Issues a move order, probing the call shapes Osiris has used for this across
--- versions. The first one that does not raise wins, and the choice is cached
--- by Compat so the probing cost is paid once.
local function issueMove(character, target)
    if Compat.HasOsi("CharacterMoveToPosition") then
        -- (character, x, y, z, speed, event)
        if Compat.CallOsi("CharacterMoveToPosition", character, target.x,
                target.y, target.z, "Run", "") then
            return true
        end
    end
    if Compat.HasOsi("CharacterMoveTo") then
        if Compat.CallOsi("CharacterMoveTo", character, target.x, target.y,
                target.z, "Run", "") then
            return true
        end
    end
    Log.Once("move:none", "Warn",
        "No usable Osiris move call was found, so `moveto` movement cannot "
        .. "work on this build. Switch movement.mode to \"xinput\" in "
        .. "FPCamera.json.")
    return false
end

--- Called from the server tick. `native` is the DLL's published state, or nil.
function Movement.Update(deltaTime, character, native)
    if native == nil or native.movementMode ~= "moveto" then
        wasMoving = false
        return
    end
    if not native.firstPerson then
        wasMoving = false
        return
    end
    if character == nil then return end

    local intent = native.moveIntent
    if type(intent) ~= "table" then return end

    local strafe = tonumber(intent[1]) or 0.0
    local forwardAmount = tonumber(intent[2]) or 0.0

    if math.abs(strafe) < 0.01 and math.abs(forwardAmount) < 0.01 then
        -- Keys released. Stop re-issuing; the character finishes its last order
        -- and halts, which is the closest this mode gets to "let go and stop".
        if wasMoving then
            Log.Debug("moveto: movement keys released.")
            wasMoving = false
            lastOrderTarget = nil
        end
        return
    end

    local rate = native.moveToRateHz or Config.current.tickRateHz
    if rate <= 0 then rate = 10.0 end

    accumulator = accumulator + deltaTime
    if accumulator < (1.0 / rate) then return end
    accumulator = 0.0

    local position = characterPosition(character)
    if position == nil then return end

    -- Flattened: looking at the ceiling must not make the character try to walk
    -- up into it.
    local forward = Vec.flatten(Vec.from(native.forward))
    local right = Vec.flatten(Vec.from(native.right))

    local direction = Vec.flatten(Vec.add(
        Vec.scale(forward, forwardAmount),
        Vec.scale(right, strafe)))

    if Vec.length(direction) < 0.01 then return end

    local distance = native.moveToDistance or 6.0
    local target = Vec.add(position, Vec.scale(direction, distance))

    -- Skip an order that would barely change the destination: re-issuing the
    -- same move every tick makes the character stutter in place.
    if lastOrderTarget ~= nil and
       Vec.horizontalDistance(lastOrderTarget, target) < 0.5 then
        return
    end

    if issueMove(character, target) then
        lastOrderTarget = target
        wasMoving = true
        Log.Trace("moveto: %s -> %s", Vec.tostring(position), Vec.tostring(target))
    end
end

return Movement
