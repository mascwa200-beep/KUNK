--- Targeting.lua -- "what am I looking at?"
---
--- Scope, stated up front so nobody expects more than this delivers. Baldur's
--- Gate 3 computes spell and attack line-of-sight inside the engine, and
--- Script Extender does not expose those rules to Lua. This file cannot and
--- does not rewrite them.
---
--- What actually fixes first-person targeting is on the native side: the DLL
--- pins the mouse cursor to the centre of the screen, and because the engine
--- already casts its picking ray from the cursor, that ray becomes a reticle
--- ray for free. No engine internals involved, nothing to re-derive per patch.
---
--- What this file adds on top is a cone query the interaction assist uses to
--- answer "which entity is the player looking at", and a console command that
--- reports the same thing so you can sanity-check where the reticle is
--- pointing. It changes which entity gets chosen, never whether the engine
--- thinks a shot is legal.
local Compat = Ext.Require("Shared/Compat.lua")
local Log = Ext.Require("Shared/Log.lua")
local Vec = Ext.Require("Shared/Vec.lua")

local Targeting = {}

--- Component names differ across Script Extender versions and game patches.
--- Probed in order; the first that returns entities wins, and the result is
--- remembered.
local CHARACTER_COMPONENTS = { "ServerCharacter", "IsCharacter", "Character" }
local ITEM_COMPONENTS = { "ServerItem", "IsItem", "Item" }

local resolvedComponent = {}

local function entitiesWith(kind, candidates)
    if resolvedComponent[kind] == false then return nil end

    local names = resolvedComponent[kind] and { resolvedComponent[kind] }
        or candidates

    for _, name in ipairs(names) do
        local ok, entities =
            Compat.Call("Ext.Entity.GetAllEntitiesWithComponent", name)
        if ok and type(entities) == "table" and next(entities) ~= nil then
            resolvedComponent[kind] = name
            return entities
        end
    end

    resolvedComponent[kind] = false
    Log.Once("entities:" .. kind, "Warn",
        "None of the %s components (%s) is queryable on this build, so the "
        .. "look-at assist cannot enumerate them. The cursor lock still aims "
        .. "the game's own picking ray at the screen centre, which is the part "
        .. "that matters most.", kind, table.concat(candidates, ", "))
    return nil
end

--- World position of an entity, trying the component route first and falling
--- back to Osiris.
local function entityPosition(entity)
    local ok, translate = pcall(function()
        return entity.Transform.Transform.Translate
    end)
    if ok and translate ~= nil then
        local vector = Vec.from(translate)
        if vector.x ~= 0 or vector.y ~= 0 or vector.z ~= 0 then return vector end
    end

    local uuid = Targeting.EntityUuid(entity)
    if uuid == nil then return nil end

    local gotPosition, x, y, z = Compat.CallOsi("GetPosition", uuid)
    if gotPosition and x ~= nil then return Vec.new(x, y, z) end
    return nil
end

function Targeting.EntityUuid(entity)
    local ok, uuid = pcall(function() return entity.Uuid.EntityUuid end)
    if ok and uuid ~= nil then return uuid end
    return nil
end

--- Picks the entity closest to the centre of the reticle.
---
--- `filter(entity, uuid)` may return false to reject a candidate. Returns
--- entity, uuid, distance -- or nil when nothing qualifies.
function Targeting.PickAlongReticle(origin, forward, range, coneDegrees, kinds,
                                    filter)
    if origin == nil or forward == nil then return nil end

    local direction = Vec.normalize(forward)
    if Vec.length(direction) < 0.5 then return nil end

    -- A cone test rather than a true raycast: Lua has no ray query, and for
    -- "the thing I am looking at" a cone is both cheaper and more forgiving,
    -- which is what you want when a barrel is half behind a doorframe.
    local minimumDot = math.cos(math.rad(coneDegrees))

    local bestEntity, bestUuid, bestScore, bestDistance = nil, nil, -1.0, nil

    for _, kind in ipairs(kinds) do
        local candidates = entitiesWith(kind,
            kind == "character" and CHARACTER_COMPONENTS or ITEM_COMPONENTS)
        if candidates ~= nil then
            for _, entity in pairs(candidates) do
                local position = entityPosition(entity)
                if position ~= nil then
                    local offset = Vec.sub(position, origin)
                    local distance = Vec.length(offset)
                    if distance > 0.05 and distance <= range then
                        local dot = Vec.dot(Vec.normalize(offset), direction)
                        if dot >= minimumDot then
                            local uuid = Targeting.EntityUuid(entity)
                            if filter == nil or filter(entity, uuid) then
                                -- Prefer whatever is nearest the centre of the
                                -- reticle; break ties towards the closer one.
                                local score = dot - (distance / range) * 0.15
                                if score > bestScore then
                                    bestEntity = entity
                                    bestUuid = uuid
                                    bestScore = score
                                    bestDistance = distance
                                end
                            end
                        end
                    end
                end
            end
        end
    end

    if bestEntity == nil then return nil end
    return bestEntity, bestUuid, bestDistance
end

--- The camera ray as published by the DLL, offset up to roughly eye height so
--- the cone starts at the player's eyes and not at their feet.
function Targeting.ReticleRay(native, characterPosition)
    if native == nil or characterPosition == nil then return nil, nil end
    local forward = Vec.from(native.forward)
    if Vec.length(forward) < 0.5 then return nil, nil end

    local origin = Vec.new(characterPosition.x, characterPosition.y + 1.6,
        characterPosition.z)
    return origin, forward
end

return Targeting
