--- test_targeting.lua -- "what am I looking at?"
---
--- This picks which entity the interaction assist acts on. Getting it wrong is
--- not catastrophic but it is deeply annoying: you look at a chest and loot the
--- barrel behind you. The cone test, the range bound and the self-exclusion are
--- all pinned here.
local H = ...
local mock = dofile("tests/lua/mock_ext.lua")

local function fresh(entities, options)
    mock.install(options or {})
    if entities then
        for component, list in pairs(entities) do
            mock.state.entities[component] = list
        end
    end
    return Ext.Require("Server/Targeting.lua")
end

-- Looking along +Z from the origin, at roughly eye height.
local ORIGIN = { x = 0, y = 0, z = 0 }
local FORWARD = { x = 0, y = 0, z = 1 }

H.test("picks an entity straight ahead", function()
    local Targeting = fresh({
        ServerItem = { mock.entity("chest", 0, 0, 3) },
    })
    local entity, uuid, distance = Targeting.PickAlongReticle(
        ORIGIN, FORWARD, 10, 25, { "item" }, nil)
    H.check(entity ~= nil, "should have found the chest")
    H.equal(uuid, "chest")
    H.near(distance, 3, 1e-6)
end)

H.test("ignores what is behind you", function()
    local Targeting = fresh({
        ServerItem = { mock.entity("behind", 0, 0, -3) },
    })
    local entity = Targeting.PickAlongReticle(ORIGIN, FORWARD, 10, 25,
        { "item" }, nil)
    H.equal(entity, nil)
end)

H.test("ignores what is outside the cone", function()
    -- 45 degrees off-axis, inside a 25 degree cone: must be rejected.
    local Targeting = fresh({
        ServerItem = { mock.entity("offAxis", 3, 0, 3) },
    })
    H.equal(Targeting.PickAlongReticle(ORIGIN, FORWARD, 10, 25, { "item" }, nil),
        nil)
    -- Widen the cone past 45 degrees and the same entity becomes valid.
    local _, uuid = Targeting.PickAlongReticle(ORIGIN, FORWARD, 10, 50,
        { "item" }, nil)
    H.equal(uuid, "offAxis")
end)

H.test("ignores what is out of range", function()
    local Targeting = fresh({
        ServerItem = { mock.entity("far", 0, 0, 50) },
    })
    H.equal(Targeting.PickAlongReticle(ORIGIN, FORWARD, 10, 25, { "item" }, nil),
        nil)
    local _, uuid = Targeting.PickAlongReticle(ORIGIN, FORWARD, 100, 25,
        { "item" }, nil)
    H.equal(uuid, "far")
end)

H.test("prefers what is nearest the centre of the reticle", function()
    -- The whole point of a reticle: the thing you are looking straight at wins
    -- over something closer but off to the side.
    local Targeting = fresh({
        ServerItem = {
            mock.entity("offToTheSide", 1.2, 0, 2.0),  -- closer, ~31 deg off
            mock.entity("deadAhead", 0, 0, 4.0),       -- further, dead centre
        },
    })
    local _, uuid = Targeting.PickAlongReticle(ORIGIN, FORWARD, 10, 40,
        { "item" }, nil)
    H.equal(uuid, "deadAhead")
end)

H.test("breaks ties towards the closer entity", function()
    local Targeting = fresh({
        ServerItem = {
            mock.entity("near", 0, 0, 2),
            mock.entity("far", 0, 0, 8),
        },
    })
    local _, uuid = Targeting.PickAlongReticle(ORIGIN, FORWARD, 20, 25,
        { "item" }, nil)
    H.equal(uuid, "near")
end)

H.test("honours the filter, which is how you avoid targeting yourself", function()
    local Targeting = fresh({
        ServerCharacter = {
            mock.entity("self", 0, 0, 0.1),
            mock.entity("goblin", 0, 0, 5),
        },
    })
    local _, uuid = Targeting.PickAlongReticle(
        ORIGIN, FORWARD, 20, 25, { "character" },
        function(_, candidate) return candidate ~= "self" end)
    H.equal(uuid, "goblin")
end)

H.test("searches several entity kinds", function()
    local Targeting = fresh({
        ServerItem = { mock.entity("barrel", 0.2, 0, 6) },
        ServerCharacter = { mock.entity("goblin", 0, 0, 3) },
    })
    local _, uuid = Targeting.PickAlongReticle(ORIGIN, FORWARD, 20, 25,
        { "item", "character" }, nil)
    H.equal(uuid, "goblin")
end)

H.test("degrades when the entity API is unavailable", function()
    -- Older Script Extender versions cannot enumerate components. The assist
    -- has to go quiet, not take the server context down with it.
    local Targeting = fresh(nil, { entityQueryRaises = true })
    local entity
    H.noError(function()
        entity = Targeting.PickAlongReticle(ORIGIN, FORWARD, 10, 25,
            { "item" }, nil)
    end)
    H.equal(entity, nil)
    H.contains(mock.log(), "cursor lock")
end)

H.test("rejects a degenerate ray instead of picking arbitrarily", function()
    local Targeting = fresh({
        ServerItem = { mock.entity("chest", 0, 0, 3) },
    })
    H.equal(Targeting.PickAlongReticle(ORIGIN, { x = 0, y = 0, z = 0 }, 10, 25,
        { "item" }, nil), nil)
    H.equal(Targeting.PickAlongReticle(nil, FORWARD, 10, 25, { "item" }, nil),
        nil)
end)

H.test("the reticle ray starts at eye height, not at the feet", function()
    -- Casting from the feet is exactly the isometric assumption this mod exists
    -- to undo.
    local Targeting = fresh()
    local origin, forward = Targeting.ReticleRay(
        { forward = { 0, 0, 1 } }, { x = 10, y = 5, z = 20 })
    H.check(origin ~= nil)
    H.equal(origin.x, 10)
    H.check(origin.y > 5, "the ray should start above the character's feet")
    H.near(forward.z, 1, 1e-9)

    -- No camera data at all must yield no ray rather than a default one.
    H.equal((Targeting.ReticleRay(nil, { x = 0, y = 0, z = 0 })), nil)
end)

return H.run("Targeting")
