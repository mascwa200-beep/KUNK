--- test_movement.lua -- the pathfinding movement mode.
---
--- This is the fallback that keeps the keyboard UI, and it works by re-issuing
--- a move order towards a point in front of the camera. The things worth
--- pinning are that the point is genuinely camera-relative, that releasing the
--- keys stops the orders, and that it does not spam an order every tick -- that
--- last one is what makes the character stutter in place.
local H = ...
local mock = dofile("tests/lua/mock_ext.lua")

local function fresh(options)
    options = options or {}
    local moves = {}
    local osi = {
        GetPosition = function(_) return 0, 0, 0 end,
        CharacterMoveToPosition = function(character, x, y, z, speed, event)
            table.insert(moves, { character = character, x = x, y = y, z = z,
                                  speed = speed, event = event })
            return true
        end,
    }
    if options.noMoveCall then
        osi.CharacterMoveToPosition = nil
    end
    if options.position then
        osi.GetPosition = function(_)
            return options.position[1], options.position[2], options.position[3]
        end
    end

    mock.install({ osi = osi })
    local Config = Ext.Require("Shared/Config.lua")
    Config.Load()
    local Movement = Ext.Require("Server/Movement.lua")
    return Movement, moves
end

-- A published DLL state: first person on, moveto mode, facing +Z.
local function native(intentX, intentY, overrides)
    local payload = {
        firstPerson = true,
        movementMode = "moveto",
        forward = { 0, 0, 1 },
        right = { 1, 0, 0 },
        moveIntent = { intentX, intentY },
        moveToDistance = 6.0,
        moveToRateHz = 10.0,
    }
    for key, value in pairs(overrides or {}) do payload[key] = value end
    return payload
end

H.test("issues a move ahead of the camera", function()
    local Movement, moves = fresh()
    Movement.Update(1.0, "hero", native(0, 1))
    H.equal(#moves, 1)
    H.equal(moves[1].character, "hero")
    H.near(moves[1].z, 6.0, 1e-4, "should aim moveToDistance along forward")
    H.near(moves[1].x, 0, 1e-4)
end)

H.test("strafing goes sideways, not forwards", function()
    local Movement, moves = fresh()
    Movement.Update(1.0, "hero", native(1, 0))
    H.equal(#moves, 1)
    H.near(moves[1].x, 6.0, 1e-4, "should aim along the camera right vector")
    H.near(moves[1].z, 0, 1e-4)
end)

H.test("diagonal intent composes both axes", function()
    local Movement, moves = fresh()
    Movement.Update(1.0, "hero", native(0.7071, 0.7071))
    H.equal(#moves, 1)
    -- Normalised, so the destination stays moveToDistance away rather than
    -- 1.41 times further on the diagonal.
    local distance = math.sqrt(moves[1].x ^ 2 + moves[1].z ^ 2)
    H.near(distance, 6.0, 1e-3)
    H.near(moves[1].x, moves[1].z, 1e-3)
end)

H.test("the destination is relative to the character, not the world origin", function()
    local Movement, moves = fresh({ position = { 100, 5, -200 } })
    Movement.Update(1.0, "hero", native(0, 1))
    H.equal(#moves, 1)
    H.near(moves[1].x, 100, 1e-3)
    H.near(moves[1].z, -194, 1e-3, "6 metres ahead of z=-200")
end)

H.test("looking up does not aim into the ceiling", function()
    -- The forward vector is flattened, so a steep camera angle still produces a
    -- destination on the ground.
    local Movement, moves = fresh()
    local payload = native(0, 1, { forward = { 0, 0.95, 0.31 } })
    Movement.Update(1.0, "hero", payload)
    H.equal(#moves, 1)
    H.near(moves[1].y, 0, 1e-6, "the destination must stay at ground level")
    H.near(moves[1].z, 6.0, 1e-3)
end)

H.test("releasing the keys stops the orders", function()
    local Movement, moves = fresh()
    Movement.Update(1.0, "hero", native(0, 1))
    H.equal(#moves, 1)
    Movement.Update(1.0, "hero", native(0, 0))
    H.equal(#moves, 1, "a zero intent must not issue another order")
end)

H.test("does not issue an order every tick", function()
    -- Re-issuing at frame rate is what makes the character stutter in place.
    -- With a 10 Hz rate, sixty 1/60s ticks should produce far fewer orders.
    local Movement, moves = fresh()
    for _ = 1, 60 do
        Movement.Update(1.0 / 60.0, "hero", native(0, 1))
    end
    H.check(#moves <= 12,
        "expected at most ~10 orders in one second, got " .. #moves)
    H.check(#moves >= 1, "expected at least one order")
end)

H.test("does not re-issue when the destination barely moved", function()
    local Movement, moves = fresh()
    Movement.Update(1.0, "hero", native(0, 1))
    local first = #moves
    -- Same position, same heading: the destination is unchanged, so another
    -- order would only interrupt the one in flight.
    Movement.Update(1.0, "hero", native(0, 1))
    H.equal(#moves, first)
end)

H.test("re-issues when the camera turns", function()
    local Movement, moves = fresh()
    Movement.Update(1.0, "hero", native(0, 1))
    local first = #moves
    Movement.Update(1.0, "hero", native(0, 1, { forward = { 1, 0, 0 } }))
    H.check(#moves > first, "turning should produce a new destination")
end)

H.test("does nothing in the other movement modes", function()
    local Movement, moves = fresh()
    Movement.Update(1.0, "hero", native(0, 1, { movementMode = "xinput" }))
    Movement.Update(1.0, "hero", native(0, 1, { movementMode = "none" }))
    H.equal(#moves, 0)
end)

H.test("does nothing while first person is off", function()
    local Movement, moves = fresh()
    Movement.Update(1.0, "hero", native(0, 1, { firstPerson = false }))
    H.equal(#moves, 0)
end)

H.test("tolerates missing state without raising", function()
    local Movement, moves = fresh()

    H.noError(function() Movement.Update(1.0, "hero", nil) end)
    H.noError(function() Movement.Update(1.0, nil, native(0, 1)) end)

    -- Built by hand rather than via native(): assigning nil to a key in a Lua
    -- table literal does not create the key, so an overrides table cannot be
    -- used to *remove* a field.
    H.noError(function()
        Movement.Update(1.0, "hero", {
            firstPerson = true, movementMode = "moveto",
            forward = { 0, 0, 1 }, right = { 1, 0, 0 },
            moveToDistance = 6.0, moveToRateHz = 10.0,
            -- moveIntent deliberately absent
        })
    end)

    H.noError(function()
        Movement.Update(1.0, "hero", {
            firstPerson = true, movementMode = "moveto",
            moveIntent = { 0, 1 },
            moveToDistance = 6.0, moveToRateHz = 10.0,
            -- forward and right deliberately absent
        })
    end)

    H.equal(#moves, 0, "none of these should have produced a move order")
end)

H.test("reports once when no move call exists on this build", function()
    local Movement, moves = fresh({ noMoveCall = true })
    H.noError(function() Movement.Update(1.0, "hero", native(0, 1)) end)
    H.equal(#moves, 0)
    H.contains(mock.log(), "xinput")
end)

return H.run("Movement")
